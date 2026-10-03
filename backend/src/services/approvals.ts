import type {
  ApprovalItem,
  ApprovalPage,
  ApprovalStatus,
  BudgetProjection,
  BudgetProposal,
  ListApprovalsQuery,
} from '@boq/shared';
import { recordAudit } from '../audit/record-audit';
import type { Db, DbPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import {
  canTransitionApproval,
  expenseStatusFor,
  INITIAL_APPROVAL_STATUS,
} from '../domain/approval-status';
import { AppError } from '../errors/app-error';
import {
  approvalsRepository,
  budgetApprovalsRepository,
  expensesRepository,
  thresholdsRepository,
  type ApprovalRecord,
} from '../repositories';
import { createBudgetApprovalService } from './budget-approvals';
import { loadBoq } from './estimates';
import { lockOpenProject, lockProject, projectOnto, projectSpend } from './spend';

/**
 * Approval of spend beyond the approval level. This module never compares thresholds: whether an
 * expense needs approval, and what it would do to its head, always come from domain/control
 * (through ./spend). Transitions come from domain/approval-status. Each step is one transaction
 * that writes the request, its expense, an approval_actions row and an audit event together.
 */

const approvalEntity = (id: string) => ({ type: 'approval', id });

function toItem(a: ApprovalRecord, now: BudgetProjection | null): ApprovalItem {
  return {
    id: a.id,
    status: a.status,
    project: a.project,
    costHead: a.costHead,
    expense: a.expense,
    reason: a.reason,
    requestedBy: { id: a.requestedBy, name: a.requestedByName },
    requestedAt: a.createdAt.toISOString(),
    requestedBp: a.requestedBp,
    decidedBy: a.decidedBy ? { id: a.decidedBy, name: a.decidedByName ?? '' } : null,
    decidedAt: a.decidedAt?.toISOString() ?? null,
    decidedBp: a.decidedBp,
    decisionComment: a.decisionComment,
    now,
  };
}

/**
 * Open a request for an expense that was just saved as held. Runs inside the caller's transaction
 * (Add Expense), so the expense and its request exist together or not at all.
 */
export async function openApprovalRequest(
  tx: Db,
  input: {
    expenseId: string;
    projectId: string;
    reason: string;
    requestedBy: string;
    projection: BudgetProjection;
  },
): Promise<string> {
  const requestedBp = input.projection.projected.metrics.utilisationBp;
  const id = await approvalsRepository(tx).create({
    expenseId: input.expenseId,
    projectId: input.projectId,
    reason: input.reason,
    requestedBp,
    requestedBy: input.requestedBy,
  });
  await approvalsRepository(tx).addAction({
    approvalId: id,
    action: 'REQUESTED',
    from: null,
    to: INITIAL_APPROVAL_STATUS,
    actorUserId: input.requestedBy,
    comment: input.reason,
    projectedBp: requestedBp,
  });
  await recordAudit(
    tx,
    'approval.requested',
    { userId: input.requestedBy },
    approvalEntity(id),
    undefined,
    {
      status: INITIAL_APPROVAL_STATUS,
      expenseId: input.expenseId,
      reason: input.reason,
      projectedBp: requestedBp,
    },
  );
  return id;
}

/**
 * Lock a request with its project and expense (in the shared lock order) and re-read it.
 * `found` must be read OUTSIDE the transaction: under REPEATABLE READ the first plain read fixes
 * the transaction's snapshot, so reading before the locks would make every later read (the
 * request's status, the head's figures) stale, and two concurrent approvals could both succeed.
 */
async function lockRequest(
  tx: Db,
  found: ApprovalRecord | null,
  opts: { requireOpenProject: boolean },
): Promise<ApprovalRecord> {
  if (!found) throw AppError.notFound('Approval request not found');
  if (opts.requireOpenProject) await lockOpenProject(tx, found.project.id);
  else await lockProject(tx, found.project.id);
  await expensesRepository(tx).lock(found.expense.id);
  await approvalsRepository(tx).lock(found.id);
  const current = await approvalsRepository(tx).findById(found.id);
  if (!current) throw AppError.notFound('Approval request not found');
  return current;
}

function requireTransition(a: ApprovalRecord, to: ApprovalStatus): void {
  if (!canTransitionApproval(a.status, to)) {
    throw new AppError(
      'INVALID_TRANSITION',
      `This request is already ${a.status.toLowerCase()} and cannot be ${to.toLowerCase()}`,
      409,
    );
  }
}

export function createApprovalService(pool: DbPool) {
  /** Write a decision: the request, its expense, its history and the audit trail, together. */
  async function settle(
    tx: Db,
    a: ApprovalRecord,
    step: {
      to: ApprovalStatus;
      actorUserId: string;
      comment: string | null;
      projectedBp: number | null;
      decided: boolean;
    },
  ): Promise<ApprovalItem> {
    const repo = approvalsRepository(tx);
    await repo.decide(a.id, {
      status: step.to,
      decidedBy: step.decided ? step.actorUserId : null,
      decidedBp: step.projectedBp,
      comment: step.comment,
    });
    await expensesRepository(tx).setStatus(
      a.expense.id,
      expenseStatusFor(step.to),
      step.actorUserId,
    );
    await repo.addAction({
      approvalId: a.id,
      action: step.to as 'APPROVED' | 'REJECTED' | 'CANCELLED',
      from: a.status,
      to: step.to,
      actorUserId: step.actorUserId,
      comment: step.comment,
      projectedBp: step.projectedBp,
    });
    await recordAudit(
      tx,
      `approval.${step.to.toLowerCase()}`,
      { userId: step.actorUserId },
      approvalEntity(a.id),
      { status: a.status },
      {
        status: step.to,
        expenseId: a.expense.id,
        comment: step.comment,
        projectedBp: step.projectedBp,
      },
    );
    const updated = await repo.findById(a.id);
    if (!updated) throw AppError.notFound('Approval request not found');
    return toItem(updated, null);
  }

  /** The same approve and reject for both kinds of request: spend here, budgets in their service. */
  async function decideAnyKind(
    actor: { userId: string },
    approvalId: string,
    to: 'APPROVED' | 'REJECTED',
    comment: string | null,
  ): Promise<ApprovalItem | BudgetProposal> {
    if ((await budgetApprovalsRepository(pool).kindOf(approvalId)) === 'BUDGET') {
      return createBudgetApprovalService(pool).decide(actor, approvalId, to, comment);
    }
    return decide(actor, approvalId, to, comment);
  }

  /** Approve or reject. Re-evaluated now with the control engine: the budget may have changed. */
  async function decide(
    actor: { userId: string },
    approvalId: string,
    to: 'APPROVED' | 'REJECTED',
    comment: string | null,
  ): Promise<ApprovalItem> {
    const found = await approvalsRepository(pool).findById(approvalId); // before the transaction
    return withTransaction(pool, async (tx) => {
      // Only approving adds spend, so only approving needs a project that still accepts it.
      const a = await lockRequest(tx, found, { requireOpenProject: to === 'APPROVED' });
      requireTransition(a, to);
      if (a.requestedBy === actor.userId) {
        throw new AppError('SELF_APPROVAL', 'You cannot decide on your own request', 403);
      }
      const projection = await projectSpend(tx, a.project.id, a.costHead.id, a.expense.amountFils);
      return settle(tx, a, {
        to,
        actorUserId: actor.userId,
        comment,
        projectedBp: projection.projected.metrics.utilisationBp,
        decided: true,
      });
    });
  }

  return {
    /**
     * Requests, oldest waiting first. Pending ones carry the head's figures now and after this
     * expense, re-evaluated with today's budget, actual and thresholds.
     */
    async list(query: ListApprovalsQuery): Promise<ApprovalPage> {
      const { rows, total } = await approvalsRepository(pool).list(query);
      const pending = rows.filter((a) => a.status === 'PENDING');
      const projectIds = [...new Set(pending.map((a) => a.project.id))];
      const [boqs, thresholds] = await Promise.all([
        Promise.all(projectIds.map(async (id) => [id, await loadBoq(pool, id)] as const)),
        thresholdsRepository(pool).get(),
      ]);
      const boqOf = new Map(boqs);
      const items = rows.map((a) => {
        const boq = a.status === 'PENDING' ? boqOf.get(a.project.id) : undefined;
        return toItem(
          a,
          boq ? projectOnto(boq, a.costHead.id, a.expense.amountFils, thresholds) : null,
        );
      });
      return { items, total, page: query.page, pageSize: query.pageSize };
    },

    approve(actor: { userId: string }, approvalId: string, comment: string | null) {
      return decideAnyKind(actor, approvalId, 'APPROVED', comment);
    },

    reject(actor: { userId: string }, approvalId: string, comment: string) {
      return decideAnyKind(actor, approvalId, 'REJECTED', comment);
    },

    /** The requester withdraws a request that is still waiting. The expense stays out of Actual. */
    async cancel(
      actor: { userId: string },
      projectId: string,
      expenseId: string,
    ): Promise<ApprovalItem> {
      // Found before the transaction (see lockRequest).
      const e = await expensesRepository(pool).findInProject(projectId, expenseId);
      const found = e?.approval ? await approvalsRepository(pool).findById(e.approval.id) : null;
      return withTransaction(pool, async (tx) => {
        const a = await lockRequest(tx, found, { requireOpenProject: false });
        requireTransition(a, 'CANCELLED');
        if (a.requestedBy !== actor.userId) {
          throw AppError.forbidden('Only the person who asked can cancel this request');
        }
        return settle(tx, a, {
          to: 'CANCELLED',
          actorUserId: actor.userId,
          comment: null,
          projectedBp: null,
          decided: false,
        });
      });
    },
  };
}

export type ApprovalService = ReturnType<typeof createApprovalService>;
