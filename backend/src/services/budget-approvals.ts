import {
  fils,
  projectStatusSchema,
  sumFils,
  type ApprovalStatus,
  type BudgetChange,
  type BudgetProposal,
  type BudgetProposalPage,
  type CostStructure,
  type Fils,
  type ListBudgetApprovalsQuery,
  type SubmitBudgetRequest,
} from '@boq/shared';
import { recordAudit, type AuditActor } from '../audit/record-audit';
import type { Db, DbPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { canTransitionApproval, INITIAL_APPROVAL_STATUS } from '../domain/approval-status';
import { acceptsFinancialChanges } from '../domain/project-status';
import { AppError } from '../errors/app-error';
import {
  approvalsRepository,
  budgetApprovalsRepository,
  costHeadsRepository,
  estimatesRepository,
  expensesRepository,
  projectsRepository,
  type BudgetApprovalRecord,
} from '../repositories';
import { lockProjectForBudget, writeEstimates } from './estimates';
import { lockProject } from './spend';

/**
 * Budget (cost structure) approval: setting up a project's budget, and every later change to it.
 * A member proposes the whole structure (heads and estimates); the server records, head by head,
 * the approved value then and the proposed value, and an administrator approves or rejects.
 * Only an approval writes the approved budget (project_estimates), so a proposal never counts as
 * budget. It uses the approvals table, its state machine, its history and the audit trail, like
 * spend approval. One request may wait per project (database), so changes cannot conflict.
 */

const approvalEntity = (id: string) => ({ type: 'approval', id });

function changeOf(approved: Fils | null, proposed: Fils | null): BudgetChange {
  if (approved === null) return 'ADDED';
  if (proposed === null) return 'REMOVED';
  return approved === proposed ? 'UNCHANGED' : 'CHANGED';
}

const present = (v: Fils | null): v is Fils => v !== null;

function toProposal(a: BudgetApprovalRecord): BudgetProposal {
  return {
    id: a.id,
    status: a.status,
    project: a.project,
    lines: a.lines.map((l) => ({ ...l, change: changeOf(l.approvedFils, l.amountFils) })),
    approvedTotalFils: sumFils(a.lines.map((l) => l.approvedFils).filter(present)),
    proposedTotalFils: sumFils(a.lines.map((l) => l.amountFils).filter(present)),
    requestedBy: { id: a.requestedBy, name: a.requestedByName },
    requestedAt: a.createdAt.toISOString(),
    decidedBy: a.decidedBy ? { id: a.decidedBy, name: a.decidedByName ?? '' } : null,
    decidedAt: a.decidedAt?.toISOString() ?? null,
    decisionComment: a.decisionComment,
  };
}

async function requireProposal(db: Db, id: string): Promise<BudgetApprovalRecord> {
  const a = await budgetApprovalsRepository(db).findById(id);
  if (!a) throw AppError.notFound('Approval request not found');
  return a;
}

/** Heads with expenses stay in the budget: refuse a structure that would drop one. */
async function refuseRemovingSpentHeads(
  db: Db,
  projectId: string,
  removed: string[],
): Promise<void> {
  if (!removed.length) return;
  const spent = await expensesRepository(db).headsWithExpenses(projectId);
  for (const headId of removed) {
    if (!spent.has(headId)) continue;
    const head = await costHeadsRepository(db).findById(headId, { includeDeleted: true });
    throw new AppError(
      'HEAD_HAS_EXPENSES',
      `Cost head ${head?.systemNo ?? headId} cannot be removed because expenses exist`,
      409,
    );
  }
}

/** Apply an approved request: every head gets its proposed value, removals leave the budget. */
async function applyLines(tx: Db, actor: AuditActor, a: BudgetApprovalRecord): Promise<void> {
  const current = await estimatesRepository(tx).listForProject(a.project.id);
  // The request was made against an approved budget that must not have moved since.
  for (const l of a.lines) {
    if ((current.get(l.costHead.id) ?? null) !== l.approvedFils) {
      throw AppError.conflict(
        `The approved budget of ${l.costHead.systemNo} changed after this request; reject it and resubmit`,
      );
    }
  }
  const removals = a.lines.filter((l) => l.amountFils === null);
  await refuseRemovingSpentHeads(
    tx,
    a.project.id,
    removals.map((l) => l.costHead.id),
  );
  await writeEstimates(
    tx,
    actor,
    a.project.id,
    a.lines.flatMap((l) =>
      l.amountFils === null ? [] : [{ costHeadId: l.costHead.id, amountFils: l.amountFils }],
    ),
    { rowIsMembership: true },
  );
  for (const l of removals) {
    await estimatesRepository(tx).remove(a.project.id, l.costHead.id);
    await recordAudit(
      tx,
      'estimate.removed',
      actor,
      { type: 'project', id: a.project.id },
      { costHeadId: l.costHead.id, code: l.costHead.code, amountFils: l.approvedFils },
      { costHeadId: l.costHead.id, code: l.costHead.code, amountFils: null },
    );
  }
}

export function createBudgetApprovalService(pool: DbPool) {
  return {
    /**
     * Propose the project's whole cost structure (first set-up, or a change to an approved one).
     * Heads left out are proposed for removal; the approved budget is untouched until approval.
     */
    async submit(
      actor: { userId: string },
      projectId: string,
      input: SubmitBudgetRequest,
    ): Promise<BudgetProposal> {
      return withTransaction(pool, async (tx) => {
        await lockProjectForBudget(tx, projectId);
        // The unique key also refuses a second waiting request; this says so in plain words.
        if (
          (await budgetApprovalsRepository(tx).latestForProject(projectId))?.status === 'PENDING'
        ) {
          throw new AppError(
            'BUDGET_PENDING',
            'This budget is awaiting Admin approval. Only one change can wait at a time.',
            409,
          );
        }
        const approved = await estimatesRepository(tx).listForProject(projectId);
        for (const line of input.lines) {
          const head = await costHeadsRepository(tx).findById(line.costHeadId);
          if (!head) throw AppError.notFound('Cost head not found');
          // A head already in the budget may keep its place even if it was retired since.
          if (!head.active && !approved.has(head.id)) {
            throw AppError.conflict(`Cost head ${head.systemNo} is inactive`);
          }
        }
        const proposed = new Set(input.lines.map((l) => l.costHeadId));
        const removed = [...approved.keys()].filter((id) => !proposed.has(id));
        await refuseRemovingSpentHeads(tx, projectId, removed);
        const lines = [
          ...input.lines.map((l) => ({
            costHeadId: l.costHeadId,
            approvedFils: approved.get(l.costHeadId) ?? null,
            amountFils: fils(l.amountFils),
          })),
          ...removed.map((id) => ({
            costHeadId: id,
            approvedFils: approved.get(id) ?? null,
            amountFils: null,
          })),
        ];
        if (lines.every((l) => l.approvedFils === l.amountFils)) {
          throw AppError.conflict('Nothing changed: this is the approved budget');
        }
        const id = await budgetApprovalsRepository(tx).create({
          projectId,
          requestedBy: actor.userId,
          lines,
        });
        await approvalsRepository(tx).addAction({
          approvalId: id,
          action: 'REQUESTED',
          from: null,
          to: INITIAL_APPROVAL_STATUS,
          actorUserId: actor.userId,
          comment: null,
          projectedBp: null,
        });
        const proposal = toProposal(await requireProposal(tx, id));
        await recordAudit(tx, 'approval.requested', actor, approvalEntity(id), undefined, {
          kind: 'BUDGET',
          status: INITIAL_APPROVAL_STATUS,
          projectId,
          changes: proposal.lines
            .filter((l) => l.change !== 'UNCHANGED')
            .map((l) => ({
              costHeadId: l.costHead.id,
              change: l.change,
              approvedFils: l.approvedFils,
              proposedFils: l.amountFils,
            })),
          approvedTotalFils: proposal.approvedTotalFils,
          proposedTotalFils: proposal.proposedTotalFils,
        });
        return proposal;
      });
    },

    /** The approved budget, which heads must stay in it, and the latest request. */
    async costStructure(projectId: string): Promise<CostStructure> {
      const project = await projectsRepository(pool).findById(projectId);
      if (!project) throw AppError.notFound('Project not found');
      const [approved, heads, spent, latest] = await Promise.all([
        estimatesRepository(pool).listForProject(projectId),
        costHeadsRepository(pool).list({ includeInactive: true }),
        expensesRepository(pool).headsWithExpenses(projectId),
        budgetApprovalsRepository(pool).latestForProject(projectId),
      ]);
      const lines = heads.flatMap((h) => {
        const amountFils = approved.get(h.id);
        return amountFils === undefined
          ? []
          : [
              {
                costHead: { id: h.id, systemNo: h.systemNo, code: h.code, name: h.name },
                amountFils,
              },
            ];
      });
      return {
        approved: lines,
        approvedTotalFils: sumFils(lines.map((l) => l.amountFils)),
        lockedHeadIds: [...spent],
        latest: latest ? toProposal(latest) : null,
        editable: acceptsFinancialChanges(projectStatusSchema.parse(project.status)),
      };
    },

    async list(query: ListBudgetApprovalsQuery): Promise<BudgetProposalPage> {
      const { rows, total } = await budgetApprovalsRepository(pool).list(query);
      return { items: rows.map(toProposal), total, page: query.page, pageSize: query.pageSize };
    },

    /**
     * Approve (apply every line atomically: the proposed values become the approved budget) or
     * reject (nothing changes). Lock order: project, then approval.
     */
    async decide(
      actor: { userId: string },
      approvalId: string,
      to: 'APPROVED' | 'REJECTED',
      comment: string | null,
    ): Promise<BudgetProposal> {
      const found = await requireProposal(pool, approvalId); // before the transaction (see approvals.ts)
      return withTransaction(pool, async (tx) => {
        // Only approving writes budgets, so only approving needs a project that still accepts them.
        if (to === 'APPROVED') await lockProjectForBudget(tx, found.project.id);
        else await lockProject(tx, found.project.id);
        await approvalsRepository(tx).lock(approvalId);
        const a = await requireProposal(tx, approvalId);
        if (!canTransitionApproval(a.status, to)) {
          throw new AppError(
            'INVALID_TRANSITION',
            `This request is already ${a.status.toLowerCase()} and cannot be ${to.toLowerCase()}`,
            409,
          );
        }
        if (a.requestedBy === actor.userId) {
          throw new AppError('SELF_APPROVAL', 'You cannot decide on your own request', 403);
        }
        if (to === 'APPROVED') await applyLines(tx, actor, a);
        await approvalsRepository(tx).decide(approvalId, {
          status: to,
          decidedBy: actor.userId,
          decidedBp: null,
          comment,
        });
        await approvalsRepository(tx).addAction({
          approvalId,
          action: to,
          from: a.status as ApprovalStatus,
          to,
          actorUserId: actor.userId,
          comment,
          projectedBp: null,
        });
        await recordAudit(
          tx,
          `approval.${to.toLowerCase()}`,
          actor,
          approvalEntity(approvalId),
          { status: a.status },
          { kind: 'BUDGET', status: to, projectId: a.project.id, comment },
        );
        return toProposal(await requireProposal(tx, approvalId));
      });
    },
  };
}
