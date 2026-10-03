import type { ReadStream } from 'node:fs';
import {
  fils,
  type AttachmentType,
  type BudgetProjection,
  type CostHeadDetail,
  type CreateExpenseInput,
  type DeletedExpenseRef,
  type Expense,
  type ExpenseDetail,
  type ExpensePage,
  type ListExpensesQuery,
  type UpdateExpenseInput,
} from '@boq/shared';
import { recordAudit, type AuditActor } from '../audit/record-audit';
import { cleanFileName, sniffType } from '../attachments/sniff';
import type { AttachmentStorage } from '../attachments/storage';
import type { Db, DbPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { expenseStatusFor, INITIAL_APPROVAL_STATUS } from '../domain/approval-status';
import { AppError } from '../errors/app-error';
import {
  costHeadsRepository,
  estimatesRepository,
  expensesRepository,
  projectsRepository,
  thresholdsRepository,
  type ExpenseRecord,
} from '../repositories';
import { openApprovalRequest } from './approvals';
import { expenseHistory } from './expense-history';
import { loadBoq } from './estimates';
import { headRow, lockOpenProject, projectSpend } from './spend';

/**
 * Expenses (bills): record, correct, reverse, attach. Corrections are reversals: a negative entry
 * linked to the original, which stops counting toward Actual. Only an administrator deletes (soft).
 * An expense that would take its head to the approval level is held for approval (./approvals).
 * Lock order everywhere: project row, then expense row (./spend).
 */

const EDITABLE = [
  'costHeadId',
  'vendor',
  'invoiceNo',
  'expenseDate',
  'amountFils',
  'description',
] as const;
const expenseEntity = (id: string) => ({ type: 'expense', id });

function toExpense(e: ExpenseRecord): Expense {
  return {
    id: e.id,
    costHead: { id: e.costHeadId, code: e.costHeadCode, name: e.costHeadName },
    vendor: e.vendor,
    invoiceNo: e.invoiceNo,
    expenseDate: e.expenseDate,
    amountFils: e.amountFils,
    description: e.description,
    attachment: e.attachment && {
      name: e.attachment.name,
      type: e.attachment.type,
      size: e.attachment.size,
    },
    createdBy: { id: e.createdBy, name: e.createdByName },
    createdAt: e.createdAt.toISOString(),
    reversalOf: e.reversalOf,
    reversedAt: e.reversedAt?.toISOString() ?? null,
    modifiedBy: e.updatedBy ? { id: e.updatedBy, name: e.updatedByName ?? '' } : null,
    modifiedAt: e.updatedAt.toISOString(),
    status: e.status,
    approval: e.approval,
  };
}

function toDeletedRef(e: ExpenseRecord): DeletedExpenseRef {
  return {
    id: e.id,
    invoiceNo: e.invoiceNo,
    expenseDate: e.expenseDate,
    amountFils: e.amountFils,
    deletedBy: e.deletedBy ? { id: e.deletedBy, name: e.deletedByName ?? '' } : null,
    deletedAt: (e.deletedAt ?? e.updatedAt).toISOString(),
  };
}

/** Held, rejected and cancelled expenses are settled through their approval request only. */
function requirePosted(e: ExpenseRecord, doing: string): void {
  if (e.status !== 'POSTED') {
    throw AppError.conflict(
      e.status === 'PENDING_APPROVAL'
        ? `An expense waiting for approval cannot be ${doing}. Cancel the request instead.`
        : `A ${e.status.toLowerCase()} expense cannot be ${doing}`,
    );
  }
}

/** New spend may only go to an active head that is in the project's approved budget (D31). */
async function requireBudgetHead(tx: Db, projectId: string, costHeadId: string): Promise<void> {
  const head = await costHeadsRepository(tx).findById(costHeadId);
  if (!head) throw AppError.notFound('Cost head not found');
  if (!head.active)
    throw AppError.conflict(`Cost head ${head.code} is inactive and cannot take spend`);
  if (!(await estimatesRepository(tx).listForProject(projectId)).has(costHeadId)) {
    throw new AppError(
      'HEAD_NOT_IN_BUDGET',
      `Cost head ${head.systemNo} is not in this project's approved budget`,
      409,
    );
  }
}

/** Lock and re-read an expense of this project. Re-reading after the lock sees the latest state. */
async function lockExpense(tx: Db, projectId: string, id: string): Promise<ExpenseRecord> {
  await expensesRepository(tx).lock(id);
  const e = await expensesRepository(tx).findInProject(projectId, id);
  if (!e) throw AppError.notFound('Expense not found');
  return e;
}

/**
 * An edit must not move a head to the approval level without approval: if the change adds spend to
 * a head (a larger amount, or a move to another head) and the control engine says that head would
 * then need approval, the edit is refused. Less spend is always allowed.
 */
async function refuseEditPastApproval(
  tx: Db,
  projectId: string,
  current: ExpenseRecord,
  patch: UpdateExpenseInput,
): Promise<void> {
  const head = patch.costHeadId ?? current.costHeadId;
  const amount = patch.amountFils ?? current.amountFils;
  const added = head === current.costHeadId ? amount - current.amountFils : amount;
  if (added <= 0) return;
  const projection = await projectSpend(tx, projectId, head, fils(added));
  if (projection.projected.status === 'APPROVAL_REQUIRED') {
    throw new AppError(
      'APPROVAL_REQUIRED',
      'This change takes the head to its approval level. Reverse the expense and enter it again with a reason, so it goes for approval.',
      409,
    );
  }
}

const APPROVAL_REASON_MESSAGE =
  'This expense takes the head to its approval level. Give a reason for the approval request.';

/** Today in UTC as YYYY-MM-DD: the date of a reversal entry. */
const todayUtc = () => new Date().toISOString().slice(0, 10);

export function createExpenseService(pool: DbPool, storage: AttachmentStorage) {
  async function get(db: Db, projectId: string, id: string): Promise<Expense> {
    const e = await expensesRepository(db).findInProject(projectId, id);
    if (!e) throw AppError.notFound('Expense not found');
    return toExpense(e);
  }

  async function page(projectId: string, query: ListExpensesQuery): Promise<ExpensePage> {
    const { rows, total } = await expensesRepository(pool).list(projectId, query);
    return { items: rows.map(toExpense), total, page: query.page, pageSize: query.pageSize };
  }

  return {
    list: page,

    /** One head: its figures (the same numbers as the BoQ row) and its expenses. */
    async costHeadDetail(
      projectId: string,
      costHeadId: string,
      query: ListExpensesQuery,
    ): Promise<CostHeadDetail> {
      const head = await costHeadsRepository(pool).findById(costHeadId);
      if (!head) throw AppError.notFound('Cost head not found');
      const [boq, thresholds] = await Promise.all([
        loadBoq(pool, projectId),
        thresholdsRepository(pool).get(),
      ]);
      const row = headRow(boq, costHeadId, thresholds);
      return {
        costHead: {
          id: head.id,
          systemNo: head.systemNo,
          code: head.code,
          name: head.name,
          active: head.active,
        },
        metrics: row.metrics,
        status: row.status,
        expenses: await page(projectId, { ...query, costHeadId }),
        deleted: (await expensesRepository(pool).listDeleted(projectId, costHeadId)).map(
          toDeletedRef,
        ),
        editable: boq.editable,
      };
    },

    /**
     * One expense of this project with its project, cost head and history. A deleted expense is
     * still shown (marked deleted), so its record and history stay reachable.
     */
    async detail(projectId: string, id: string): Promise<ExpenseDetail> {
      const e = await expensesRepository(pool).findInProject(projectId, id, {
        includeDeleted: true,
      });
      if (!e) throw AppError.notFound('Expense not found');
      const [project, head, history] = await Promise.all([
        projectsRepository(pool).findById(projectId),
        costHeadsRepository(pool).findById(e.costHeadId, { includeDeleted: true }),
        expenseHistory(pool, e),
      ]);
      if (!project || !head) throw AppError.notFound('Expense not found');
      return {
        expense: toExpense(e),
        project: {
          id: project.id,
          systemNo: project.systemNo,
          code: project.code,
          name: project.name,
        },
        costHead: { id: head.id, systemNo: head.systemNo, code: head.code, name: head.name },
        deleted: e.deletedAt
          ? {
              by: e.deletedBy ? { id: e.deletedBy, name: e.deletedByName ?? '' } : null,
              at: e.deletedAt.toISOString(),
            }
          : null,
        history,
      };
    },

    /** What adding `amountFils` to this head would do, before it is saved (Add Expense preview). */
    async projection(
      projectId: string,
      costHeadId: string,
      amountFils: number,
    ): Promise<BudgetProjection> {
      if (!(await costHeadsRepository(pool).findById(costHeadId))) {
        throw AppError.notFound('Cost head not found');
      }
      return projectSpend(pool, projectId, costHeadId, fils(amountFils));
    },

    /**
     * Record an expense. One that would take its head to the approval level (domain/control) is
     * saved as held, outside Actual, with an approval request carrying the mandatory reason.
     * Warning needs no approval.
     */
    async create(
      actor: { userId: string },
      projectId: string,
      input: CreateExpenseInput,
    ): Promise<Expense> {
      return withTransaction(pool, async (tx) => {
        await lockOpenProject(tx, projectId);
        await requireBudgetHead(tx, projectId, input.costHeadId);
        const projection = await projectSpend(
          tx,
          projectId,
          input.costHeadId,
          fils(input.amountFils),
        );
        const needsApproval = projection.projected.status === 'APPROVAL_REQUIRED';
        if (needsApproval && !input.approvalReason) {
          throw AppError.validation('Approval reason required', [
            { path: 'approvalReason', message: APPROVAL_REASON_MESSAGE },
          ]);
        }
        const id = await expensesRepository(tx).create({
          projectId,
          costHeadId: input.costHeadId,
          vendor: input.vendor,
          invoiceNo: input.invoiceNo,
          expenseDate: input.expenseDate,
          amountFils: fils(input.amountFils),
          description: input.description ?? null,
          createdBy: actor.userId,
          status: needsApproval ? expenseStatusFor(INITIAL_APPROVAL_STATUS) : 'POSTED',
        });
        const created = await get(tx, projectId, id);
        await recordAudit(tx, 'expense.created', actor, expenseEntity(id), undefined, {
          projectId,
          costHeadId: input.costHeadId,
          vendor: created.vendor,
          invoiceNo: created.invoiceNo,
          expenseDate: created.expenseDate,
          amountFils: created.amountFils,
          description: created.description,
          status: created.status,
        });
        if (needsApproval && input.approvalReason) {
          await openApprovalRequest(tx, {
            expenseId: id,
            projectId,
            reason: input.approvalReason,
            requestedBy: actor.userId,
            projection,
          });
        }
        return get(tx, projectId, id);
      });
    },

    async update(
      actor: AuditActor,
      projectId: string,
      id: string,
      patch: UpdateExpenseInput,
    ): Promise<Expense> {
      return withTransaction(pool, async (tx) => {
        await lockOpenProject(tx, projectId);
        const current = await lockExpense(tx, projectId, id);
        if (current.reversalOf || current.reversedAt) {
          throw AppError.conflict('A reversed expense or a reversal entry cannot be edited');
        }
        requirePosted(current, 'edited');
        const changed = EDITABLE.filter((f) => patch[f] !== undefined && patch[f] !== current[f]);
        if (!changed.length) return toExpense(current);
        if (changed.includes('costHeadId') && patch.costHeadId)
          await requireBudgetHead(tx, projectId, patch.costHeadId);
        await refuseEditPastApproval(tx, projectId, current, patch);

        const before = Object.fromEntries(changed.map((f) => [f, current[f]]));
        const after = Object.fromEntries(changed.map((f) => [f, patch[f]]));
        await expensesRepository(tx).update(id, after, actor?.userId ?? null);
        await recordAudit(tx, 'expense.updated', actor, expenseEntity(id), before, after);
        return get(tx, projectId, id);
      });
    },

    /** Cancel an expense with a linked negative entry. The original stays, marked reversed. */
    async reverse(
      actor: { userId: string },
      projectId: string,
      id: string,
      reason: string,
    ): Promise<Expense> {
      return withTransaction(pool, async (tx) => {
        await lockOpenProject(tx, projectId);
        const original = await lockExpense(tx, projectId, id);
        if (original.reversalOf)
          throw AppError.conflict('A reversal entry cannot itself be reversed');
        if (original.reversedAt) throw AppError.conflict('This expense is already reversed');
        requirePosted(original, 'reversed');

        const reversalId = await expensesRepository(tx).create({
          projectId,
          costHeadId: original.costHeadId,
          vendor: original.vendor,
          invoiceNo: original.invoiceNo,
          expenseDate: todayUtc(),
          amountFils: fils(-original.amountFils),
          description: reason,
          createdBy: actor.userId,
          reversalOf: original.id,
        });
        await expensesRepository(tx).markReversed(original.id, actor.userId);
        await recordAudit(
          tx,
          'expense.reversed',
          actor,
          expenseEntity(original.id),
          { reversedAt: null, amountFils: original.amountFils },
          { reversalId, reason },
        );
        return get(tx, projectId, reversalId);
      });
    },

    /**
     * Store a bill (PDF, JPG or PNG). The bytes decide the type, and they must agree with what the
     * client declared. Replacing an attachment removes the old file after the change commits.
     */
    async attach(
      actor: AuditActor,
      projectId: string,
      id: string,
      upload: { data: Buffer; declaredType: string; rawName: string | undefined },
    ): Promise<Expense> {
      const type = sniffType(upload.data);
      if (!type || type !== upload.declaredType) {
        throw new AppError('UNSUPPORTED_FILE', 'Only PDF, JPG and PNG files are accepted', 415);
      }
      const name = cleanFileName(upload.rawName, type);
      const key = await storage.save(upload.data);
      let replaced: string | null = null;
      try {
        const result = await withTransaction(pool, async (tx) => {
          const e = await lockExpense(tx, projectId, id);
          if (e.reversalOf) throw AppError.conflict('A reversal entry has no attachment');
          replaced = e.attachment?.key ?? null;
          await expensesRepository(tx).setAttachment(
            id,
            { key, type, size: upload.data.length, name },
            actor?.userId ?? null,
          );
          await recordAudit(
            tx,
            'expense.attachment_added',
            actor,
            expenseEntity(id),
            e.attachment ? { name: e.attachment.name } : undefined,
            { name, type, size: upload.data.length },
          );
          return get(tx, projectId, id);
        });
        if (replaced) await storage.remove(replaced);
        return result;
      } catch (err) {
        await storage.remove(key); // never leave an unreferenced file behind
        throw err;
      }
    },

    /**
     * Administrators only (route): soft-delete an expense entered by mistake. It leaves Actual and
     * every list; the row, its bill and its audit history stay. A held expense is settled through
     * its approval request instead, and a reversed pair is already neutral.
     */
    async remove(actor: { userId: string }, projectId: string, id: string): Promise<void> {
      await withTransaction(pool, async (tx) => {
        await lockOpenProject(tx, projectId);
        const e = await lockExpense(tx, projectId, id);
        if (e.reversalOf || e.reversedAt) {
          throw AppError.conflict('A reversed expense or a reversal entry cannot be deleted');
        }
        if (e.status === 'PENDING_APPROVAL') {
          throw AppError.conflict(
            'This expense is waiting for approval: decide on its request first',
          );
        }
        await expensesRepository(tx).softDelete(id, actor.userId);
        await recordAudit(
          tx,
          'expense.deleted',
          actor,
          expenseEntity(id),
          {
            costHeadId: e.costHeadId,
            vendor: e.vendor,
            invoiceNo: e.invoiceNo,
            amountFils: e.amountFils,
            status: e.status,
          },
          { deleted: true },
        );
      });
    },

    async openAttachment(
      projectId: string,
      id: string,
    ): Promise<{ stream: ReadStream; type: AttachmentType; name: string; size: number }> {
      const e = await expensesRepository(pool).findInProject(projectId, id);
      if (!e?.attachment) throw AppError.notFound('Attachment not found');
      const { key, type, name, size } = e.attachment;
      return { stream: storage.open(key), type, name, size };
    },
  };
}
