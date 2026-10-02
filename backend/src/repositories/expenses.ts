import { fils, type AttachmentType, type Fils } from '@boq/shared';
import { guarded } from '../db/errors';
import type { Db } from '../db/pool';
import { exec, selectOne, selectRows, type Row } from '../db/sql';
import { buildSet, str, strOrNull, toDate, toDateOrNull } from './shared';

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
  reversalOf: string | null;
  reversedAt: Date | null;
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
};
export type ExpensePatch = Partial<
  Pick<
    NewExpense,
    'costHeadId' | 'vendor' | 'invoiceNo' | 'expenseDate' | 'amountFils' | 'description'
  >
>;

/** BIGINT money: a number when safe, a string when not, and fils() rejects the latter. */
const money = (v: unknown): Fils => fils(Number(v));

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
  reversalOf: strOrNull(r, 'reversal_of'),
  reversedAt: toDateOrNull(r['reversed_at']),
  createdAt: toDate(r['created_at']),
});

const SELECT = `SELECT e.*, h.code AS cost_head_code, h.name AS cost_head_name, u.name AS created_by_name
  FROM expenses e
  JOIN cost_heads h ON h.id = e.cost_head_id
  JOIN users u ON u.id = e.created_by`;

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
             (project_id, cost_head_id, vendor, invoice_no, expense_date, amount_fils, description, created_by, reversal_of)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
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
          ],
        );
        return str(row as Row, 'id');
      });
    },
    /** An expense of this project, or null (an id from another project is "not found"). */
    async findInProject(projectId: string, id: string): Promise<ExpenseRecord | null> {
      const row = await selectOne(db, `${SELECT} WHERE e.id = ? AND e.project_id = ?`, [
        id,
        projectId,
      ]);
      return row ? map(row) : null;
    },
    /** Row-lock one expense until the transaction ends. */
    async lock(id: string): Promise<void> {
      await selectOne(db, 'SELECT id FROM expenses WHERE id = ? FOR UPDATE', [id]);
    },
    async update(id: string, patch: ExpensePatch): Promise<void> {
      const set = buildSet(patch, COLUMNS);
      if (!set) return;
      await guarded(DUPLICATE_LABEL, () =>
        exec(db, `UPDATE expenses SET ${set.sql} WHERE id = ?`, [...set.params, id]),
      );
    },
    async markReversed(id: string): Promise<void> {
      await exec(db, 'UPDATE expenses SET reversed_at = CURRENT_TIMESTAMP(3) WHERE id = ?', [id]);
    },
    async setAttachment(
      id: string,
      a: { key: string; type: AttachmentType; size: number; name: string },
    ): Promise<void> {
      await exec(
        db,
        `UPDATE expenses SET attachment_key = ?, attachment_type = ?, attachment_size = ?, attachment_name = ?
          WHERE id = ?`,
        [a.key, a.type, a.size, a.name, id],
      );
    },
    /** Newest first. Reversal entries are listed too, so the record is complete. */
    async list(opts: {
      projectId: string;
      costHeadId?: string | undefined;
      limit: number;
      offset: number;
    }): Promise<{ rows: ExpenseRecord[]; total: number }> {
      const where = opts.costHeadId
        ? 'e.project_id = ? AND e.cost_head_id = ?'
        : 'e.project_id = ?';
      const params = opts.costHeadId ? [opts.projectId, opts.costHeadId] : [opts.projectId];
      const count = await selectOne(
        db,
        `SELECT COUNT(*) AS n FROM expenses e WHERE ${where}`,
        params,
      );
      const rows = await selectRows(
        db,
        `${SELECT} WHERE ${where} ORDER BY e.expense_date DESC, e.created_at DESC, e.id LIMIT ? OFFSET ?`,
        [...params, opts.limit, opts.offset],
      );
      return { rows: rows.map(map), total: Number(count?.['n'] ?? 0) };
    },
    /**
     * Actual per cost head: the sum of original expenses that have not been reversed.
     * (Reversal entries are the record of the correction and are not counted again.)
     */
    async actualsByHead(projectId: string): Promise<Map<string, Fils>> {
      const rows = await selectRows(
        db,
        `SELECT cost_head_id, CAST(SUM(amount_fils) AS SIGNED) AS actual
           FROM expenses
          WHERE project_id = ? AND reversal_of IS NULL AND reversed_at IS NULL
          GROUP BY cost_head_id`,
        [projectId],
      );
      return new Map(rows.map((r) => [str(r, 'cost_head_id'), money(r['actual'])]));
    },
  };
}
