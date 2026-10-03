import {
  approvalStatusSchema,
  expenseStatusSchema,
  fils,
  type AttachmentType,
  type ExpenseApproval,
  type ExpenseStatus,
  type EXPENSE_SORTS,
  type Fils,
} from '@boq/shared';
import { runList, type ListInput, type ListSpec } from '../query/list';
import { guarded } from '../db/errors';
import type { Db } from '../db/pool';
import { exec, selectOne, selectRows, type Row } from '../db/sql';
import { buildSet, countsTowardActual, str, strOrNull, toDate, toDateOrNull } from './shared';

export type ExpenseRecord = {
  id: string;
  projectId: string;
  costHeadId: string;
  costHeadCode: string;
  costHeadName: string;
  vendor: string;
  invoiceNo: string;
  expenseDate: string;
  amountFils: Fils;
  description: string | null;
  attachment: { key: string; type: AttachmentType; size: number; name: string } | null;
  createdBy: string;
  createdByName: string;
  updatedBy: string | null;
  updatedByName: string | null;
  updatedAt: Date;
  deletedAt: Date | null;
  deletedBy: string | null;
  deletedByName: string | null;
  reversalOf: string | null;
  reversedAt: Date | null;
  status: ExpenseStatus;
  approval: ExpenseApproval | null;
  createdAt: Date;
};
export type NewExpense = {
  projectId: string;
  costHeadId: string;
  vendor: string;
  invoiceNo: string;
  expenseDate: string;
  amountFils: Fils;
  description: string | null;
  createdBy: string;
  reversalOf?: string | null;
  /** POSTED unless it is held for approval. */
  status?: ExpenseStatus;
};
export type ExpensePatch = Partial<
  Pick<
    NewExpense,
    'costHeadId' | 'vendor' | 'invoiceNo' | 'expenseDate' | 'amountFils' | 'description'
  >
>;

/** BIGINT money: a number when safe, a string when not, and fils() rejects the latter. */
const money = (v: unknown): Fils => fils(Number(v));

type ExpenseSort = (typeof EXPENSE_SORTS)[number];

const map = (r: Row): ExpenseRecord => ({
  id: str(r, 'id'),
  projectId: str(r, 'project_id'),
  costHeadId: str(r, 'cost_head_id'),
  costHeadCode: str(r, 'cost_head_code'),
  costHeadName: str(r, 'cost_head_name'),
  vendor: str(r, 'vendor'),
  invoiceNo: str(r, 'invoice_no'),
  expenseDate: str(r, 'expense_date'),
  amountFils: money(r['amount_fils']),
  description: strOrNull(r, 'description'),
  attachment:
    r['attachment_key'] === null
      ? null
      : {
          key: str(r, 'attachment_key'),
          type: str(r, 'attachment_type') as AttachmentType,
          size: Number(r['attachment_size']),
          name: str(r, 'attachment_name'),
        },
  createdBy: str(r, 'created_by'),
  createdByName: str(r, 'created_by_name'),
  updatedBy: strOrNull(r, 'updated_by'),
  updatedByName: strOrNull(r, 'updated_by_name'),
  updatedAt: toDate(r['updated_at']),
  deletedAt: toDateOrNull(r['deleted_at']),
  deletedBy: strOrNull(r, 'deleted_by'),
  deletedByName: strOrNull(r, 'deleted_by_name'),
  reversalOf: strOrNull(r, 'reversal_of'),
  reversedAt: toDateOrNull(r['reversed_at']),
  status: expenseStatusSchema.parse(r['status']),
  approval:
    r['approval_id'] === null
      ? null
      : {
          id: str(r, 'approval_id'),
          status: approvalStatusSchema.parse(r['approval_status']),
          reason: str(r, 'approval_reason'),
          requestedBy: { id: str(r, 'approval_requested_by'), name: str(r, 'approval_requester') },
          decidedBy:
            r['approval_decided_by'] === null
              ? null
              : { id: str(r, 'approval_decided_by'), name: str(r, 'approval_decider') },
          decidedAt: toDateOrNull(r['approval_decided_at'])?.toISOString() ?? null,
          decisionComment: strOrNull(r, 'approval_comment'),
        },
  createdAt: toDate(r['created_at']),
});

const EXPENSE_COLUMNS = `SELECT e.*, h.code AS cost_head_code, h.name AS cost_head_name,
  u.name AS created_by_name, um.name AS updated_by_name, ux.name AS deleted_by_name, a.id AS approval_id, a.status AS approval_status,
  a.reason AS approval_reason, a.requested_by AS approval_requested_by,
  ar.name AS approval_requester, a.decided_by AS approval_decided_by, ad.name AS approval_decider,
  a.decided_at AS approval_decided_at, a.decision_comment AS approval_comment`;
const EXPENSE_FROM = `FROM expenses e
  JOIN cost_heads h ON h.id = e.cost_head_id
  JOIN users u ON u.id = e.created_by
  LEFT JOIN users um ON um.id = e.updated_by
  LEFT JOIN users ux ON ux.id = e.deleted_by
  LEFT JOIN approvals a ON a.expense_id = e.id
  LEFT JOIN users ar ON ar.id = a.requested_by
  LEFT JOIN users ad ON ad.id = a.decided_by`;
const SELECT = `${EXPENSE_COLUMNS} ${EXPENSE_FROM}`;

const EXPENSE_LIST: ListSpec<ExpenseSort, 'costHeadId'> = {
  select: EXPENSE_COLUMNS,
  from: EXPENSE_FROM,
  where: ['e.deleted_at IS NULL'], // a deleted expense leaves every list (it stays on record)
  search: ['e.vendor', 'e.invoice_no', 'e.description'],
  sorts: {
    date: 'e.expense_date',
    amount: 'e.amount_fils',
    vendor: 'e.vendor',
    invoice: 'e.invoice_no',
  },
  defaultSort: { key: 'date', dir: 'desc' },
  tiebreaker: 'e.created_at DESC, e.id', // same date: newest entry first
  filters: { costHeadId: 'e.cost_head_id' },
};

const COLUMNS = {
  costHeadId: 'cost_head_id',
  vendor: 'vendor',
  invoiceNo: 'invoice_no',
  expenseDate: 'expense_date',
  amountFils: 'amount_fils',
  description: 'description',
};

/** Duplicate-key errors here can only be the vendor + invoice rule. */
const DUPLICATE_LABEL = 'An invoice with this vendor and number';

export function expensesRepository(db: Db) {
  return {
    async create(input: NewExpense): Promise<string> {
      return guarded(DUPLICATE_LABEL, async () => {
        const row = await selectOne(
          db,
          `INSERT INTO expenses
             (project_id, cost_head_id, vendor, invoice_no, expense_date, amount_fils, description, created_by, reversal_of, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
          [
            input.projectId,
            input.costHeadId,
            input.vendor,
            input.invoiceNo,
            input.expenseDate,
            input.amountFils,
            input.description,
            input.createdBy,
            input.reversalOf ?? null,
            input.status ?? 'POSTED',
          ],
        );
        return str(row as Row, 'id');
      });
    },
    /**
     * An expense of this project, or null (an id from another project is "not found"). A deleted
     * one only with includeDeleted: for reading its record and history, never for changing it.
     */
    async findInProject(
      projectId: string,
      id: string,
      opts: { includeDeleted?: boolean } = {},
    ): Promise<ExpenseRecord | null> {
      const row = await selectOne(
        db,
        `${SELECT} WHERE e.id = ? AND e.project_id = ?${opts.includeDeleted ? '' : ' AND e.deleted_at IS NULL'}`,
        [id, projectId],
      );
      return row ? map(row) : null;
    },
    /** The deleted expenses of one project head, newest deletion first. */
    async listDeleted(projectId: string, costHeadId: string): Promise<ExpenseRecord[]> {
      const rows = await selectRows(
        db,
        `${SELECT} WHERE e.project_id = ? AND e.cost_head_id = ? AND e.deleted_at IS NOT NULL
          ORDER BY e.deleted_at DESC, e.id`,
        [projectId, costHeadId],
      );
      return rows.map(map);
    },
    /** Row-lock one expense until the transaction ends. */
    async lock(id: string): Promise<void> {
      await selectOne(db, 'SELECT id FROM expenses WHERE id = ? FOR UPDATE', [id]);
    },
    /** Every change records who made it (updated_by); updated_at moves by itself. */
    async update(id: string, patch: ExpensePatch, userId: string | null): Promise<void> {
      const set = buildSet(patch, COLUMNS);
      if (!set) return;
      await guarded(DUPLICATE_LABEL, () =>
        exec(db, `UPDATE expenses SET ${set.sql}, updated_by = ? WHERE id = ?`, [
          ...set.params,
          userId,
          id,
        ]),
      );
    },
    async setStatus(id: string, status: ExpenseStatus, userId: string | null): Promise<void> {
      await exec(db, 'UPDATE expenses SET status = ?, updated_by = ? WHERE id = ?', [
        status,
        userId,
        id,
      ]);
    },
    async markReversed(id: string, userId: string | null): Promise<void> {
      await exec(
        db,
        'UPDATE expenses SET reversed_at = CURRENT_TIMESTAMP(3), updated_by = ? WHERE id = ?',
        [userId, id],
      );
    },
    /** Soft delete: the row and its audit history stay; it leaves every figure and list. */
    async softDelete(id: string, userId: string): Promise<void> {
      await exec(
        db,
        'UPDATE expenses SET deleted_at = CURRENT_TIMESTAMP(3), deleted_by = ?, updated_by = ? WHERE id = ?',
        [userId, userId, id],
      );
    },
    async setAttachment(
      id: string,
      a: { key: string; type: AttachmentType; size: number; name: string },
      userId: string | null,
    ): Promise<void> {
      await exec(
        db,
        `UPDATE expenses SET attachment_key = ?, attachment_type = ?, attachment_size = ?, attachment_name = ?,
                updated_by = ?
          WHERE id = ?`,
        [a.key, a.type, a.size, a.name, userId, id],
      );
    },
    /** A project's entries, reversals included, through the shared list builder. Newest first. */
    async list(
      projectId: string,
      input: ListInput<ExpenseSort, 'costHeadId'>,
    ): Promise<{ rows: ExpenseRecord[]; total: number }> {
      const { rows, total } = await runList(db, EXPENSE_LIST, input, [
        { sql: 'e.project_id = ?', params: [projectId] },
      ]);
      return { rows: rows.map(map), total };
    },
    /**
     * Actual per cost head: the sum of the expenses that count toward Actual (countsTowardActual).
     */
    /**
     * Heads of a project with any expense against them (whatever its status, reversals included;
     * deleted ones aside): they cannot be removed from the project's budget, by anyone.
     */
    async headsWithExpenses(projectId: string): Promise<Set<string>> {
      const rows = await selectRows(
        db,
        `SELECT DISTINCT cost_head_id FROM expenses
          WHERE project_id = ? AND deleted_at IS NULL`,
        [projectId],
      );
      return new Set(rows.map((r) => str(r, 'cost_head_id')));
    },
    async actualsByHead(projectId: string): Promise<Map<string, Fils>> {
      const rows = await selectRows(
        db,
        `SELECT cost_head_id, CAST(SUM(amount_fils) AS SIGNED) AS actual
           FROM expenses
          WHERE project_id = ? AND ${countsTowardActual('expenses')}
          GROUP BY cost_head_id`,
        [projectId],
      );
      return new Map(rows.map((r) => [str(r, 'cost_head_id'), money(r['actual'])]));
    },
  };
}
