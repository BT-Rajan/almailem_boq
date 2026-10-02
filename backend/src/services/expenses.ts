import type { ReadStream } from 'node:fs';
import {
  fils,
  projectStatusSchema,
  type AttachmentType,
  type BudgetProjection,
  type CostHeadDetail,
  type CreateExpenseInput,
  type Expense,
  type ExpensePage,
  type ListExpensesQuery,
  type UpdateExpenseInput,
} from '@boq/shared';
import { recordAudit, type AuditActor } from '../audit/record-audit';
import { cleanFileName, sniffType } from '../attachments/sniff';
import type { AttachmentStorage } from '../attachments/storage';
import type { Db, DbPool } from '../db/pool';
import { withTransaction } from '../db/transaction';
import { calculateBudgetStatus, projectedStatus } from '../domain/control';
import { budgetMetrics } from '../domain/metrics';
import { acceptsFinancialChanges } from '../domain/project-status';
import { AppError } from '../errors/app-error';
import {
  costHeadsRepository,
  expensesRepository,
  projectsRepository,
  thresholdsRepository,
  type ExpenseRecord,
} from '../repositories';
import { loadBoq } from './estimates';

/**
 * Expenses (bills): record, correct, reverse, attach. Never deleted: a reversal is a negative entry
 * linked to the original, and the original stops counting toward Actual.
 * Lock order everywhere: project row, then expense row.
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
  };
}

/** Lock the project and check it still accepts spend changes. */
async function lockOpenProject(tx: Db, projectId: string): Promise<void> {
  const p = await projectsRepository(tx).lockById(projectId);
  if (!p) throw AppError.notFound('Project not found');
  const status = projectStatusSchema.parse(p.status);
  if (!acceptsFinancialChanges(status)) {
    throw new AppError('PROJECT_CLOSED', `A ${status} project's spend cannot change`, 409);
  }
}

/** New spend may only go to an active head. */
async function requireActiveHead(tx: Db, costHeadId: string): Promise<void> {
  const head = await costHeadsRepository(tx).findById(costHeadId);
  if (!head) throw AppError.notFound('Cost head not found');
  if (!head.active)
    throw AppError.conflict(`Cost head ${head.code} is inactive and cannot take spend`);
}

/** Lock and re-read an expense of this project. Re-reading after the lock sees the latest state. */
async function lockExpense(tx: Db, projectId: string, id: string): Promise<ExpenseRecord> {
  await expensesRepository(tx).lock(id);
  const e = await expensesRepository(tx).findInProject(projectId, id);
  if (!e) throw AppError.notFound('Expense not found');
  return e;
}

/**
 * One head's row from the project figures, so it always matches the BoQ. A head the BoQ does not
 * show (inactive, no budget, no spend) has zero figures.
 */
async function headFigures(db: Db, projectId: string, costHeadId: string) {
  const boq = await loadBoq(db, projectId);
  const row = boq.rows.find((r) => r.costHead.id === costHeadId);
  if (row) return { boq, row };
  const metrics = budgetMetrics({ budget: fils(0), actual: fils(0) });
  const thresholds = await thresholdsRepository(db).get();
  return {
    boq,
    row: { metrics, status: calculateBudgetStatus(metrics.utilisationBp, thresholds) },
  };
}

/** Today in UTC as YYYY-MM-DD: the date of a reversal entry. */
const todayUtc = () => new Date().toISOString().slice(0, 10);

export function createExpenseService(pool: DbPool, storage: AttachmentStorage) {
  async function get(db: Db, projectId: string, id: string): Promise<Expense> {
    const e = await expensesRepository(db).findInProject(projectId, id);
    if (!e) throw AppError.notFound('Expense not found');
    return toExpense(e);
  }

  async function page(projectId: string, query: ListExpensesQuery): Promise<ExpensePage> {
    const { rows, total } = await expensesRepository(pool).list({
      projectId,
      costHeadId: query.costHeadId,
      limit: query.pageSize,
      offset: (query.page - 1) * query.pageSize,
    });
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
      const { boq, row } = await headFigures(pool, projectId, costHeadId);
      return {
        costHead: { id: head.id, code: head.code, name: head.name, active: head.active },
        metrics: row.metrics,
        status: row.status,
        expenses: await page(projectId, { ...query, costHeadId }),
        editable: boq.editable,
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
      const { row } = await headFigures(pool, projectId, costHeadId);
      const thresholds = await thresholdsRepository(pool).get();
      return {
        current: { metrics: row.metrics, status: row.status },
        projected: projectedStatus(
          {
            budget: row.metrics.budget,
            currentActual: row.metrics.actual,
            newAmount: fils(amountFils),
          },
          thresholds,
        ),
      };
    },

    async create(
      actor: { userId: string },
      projectId: string,
      input: CreateExpenseInput,
    ): Promise<Expense> {
      return withTransaction(pool, async (tx) => {
        await lockOpenProject(tx, projectId);
        await requireActiveHead(tx, input.costHeadId);
        const id = await expensesRepository(tx).create({
          projectId,
          costHeadId: input.costHeadId,
          vendor: input.vendor,
          invoiceNo: input.invoiceNo,
          expenseDate: input.expenseDate,
          amountFils: fils(input.amountFils),
          description: input.description ?? null,
          createdBy: actor.userId,
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
        });
        return created;
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
        const changed = EDITABLE.filter((f) => patch[f] !== undefined && patch[f] !== current[f]);
        if (!changed.length) return toExpense(current);
        if (changed.includes('costHeadId') && patch.costHeadId)
          await requireActiveHead(tx, patch.costHeadId);

        const before = Object.fromEntries(changed.map((f) => [f, current[f]]));
        const after = Object.fromEntries(changed.map((f) => [f, patch[f]]));
        await expensesRepository(tx).update(id, after);
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
        await expensesRepository(tx).markReversed(original.id);
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
          await expensesRepository(tx).setAttachment(id, {
            key,
            type,
            size: upload.data.length,
            name,
          });
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
