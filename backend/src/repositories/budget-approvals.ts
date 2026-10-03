import {
  approvalStatusSchema,
  fils,
  type ApprovalStatus,
  type BUDGET_APPROVAL_SORTS,
  type Fils,
} from '@boq/shared';
import { guarded } from '../db/errors';
import type { Db } from '../db/pool';
import { exec, selectOne, selectRows, type Row } from '../db/sql';
import { runList, type ListInput, type ListSpec } from '../query/list';
import { placeholders, str, strOrNull, toDate, toDateOrNull } from './shared';

/**
 * Budget (cost structure) requests: rows of `approvals` with kind BUDGET, and their proposed lines
 * in approval_budget_lines (append-only). Decisions and history use approvalsRepository.
 */

export type BudgetLineRecord = {
  costHead: { id: string; systemNo: string; code: string; name: string };
  /** Approved estimate when the request was made; null: the head is being added. */
  approvedFils: Fils | null;
  /** Proposed estimate; null: the head is being removed. */
  amountFils: Fils | null;
};
const moneyOrNull = (v: unknown): Fils | null => (v === null ? null : fils(Number(v)));
export type BudgetApprovalRecord = {
  id: string;
  status: ApprovalStatus;
  project: { id: string; systemNo: string; code: string; name: string };
  requestedBy: string;
  requestedByName: string;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  decisionComment: string | null;
  createdAt: Date;
  lines: BudgetLineRecord[];
};

type BudgetSort = (typeof BUDGET_APPROVAL_SORTS)[number];

const COLUMNS = `SELECT a.id, a.status, a.requested_by, a.decided_by, a.decided_at, a.decision_comment,
  a.created_at, p.id AS project_id, p.system_no AS project_system_no, p.code AS project_code,
  p.name AS project_name, ur.name AS requested_by_name, ud.name AS decided_by_name`;
const FROM = `FROM approvals a
  JOIN projects p ON p.id = a.project_id AND p.deleted_at IS NULL
  JOIN users ur ON ur.id = a.requested_by
  LEFT JOIN users ud ON ud.id = a.decided_by`;

const LIST: ListSpec<BudgetSort, 'status'> = {
  select: COLUMNS,
  from: FROM,
  where: ["a.kind = 'BUDGET'"],
  search: ['p.system_no', 'p.code', 'p.name'],
  sorts: { requested: 'a.created_at', project: 'p.system_no' },
  defaultSort: { key: 'requested', dir: 'asc' }, // oldest waiting first
  tiebreaker: 'a.id',
  filters: { status: 'a.status' },
};

const mapHeader = (r: Row): Omit<BudgetApprovalRecord, 'lines'> => ({
  id: str(r, 'id'),
  status: approvalStatusSchema.parse(r['status']),
  project: {
    id: str(r, 'project_id'),
    systemNo: str(r, 'project_system_no'),
    code: str(r, 'project_code'),
    name: str(r, 'project_name'),
  },
  requestedBy: str(r, 'requested_by'),
  requestedByName: str(r, 'requested_by_name'),
  decidedBy: strOrNull(r, 'decided_by'),
  decidedByName: strOrNull(r, 'decided_by_name'),
  decidedAt: toDateOrNull(r['decided_at']),
  decisionComment: strOrNull(r, 'decision_comment'),
  createdAt: toDate(r['created_at']),
});

export function budgetApprovalsRepository(db: Db) {
  /** Attach each request's lines, in cost-head display order. */
  async function withLines(rows: Row[]): Promise<BudgetApprovalRecord[]> {
    const headers = rows.map(mapHeader);
    if (!headers.length) return [];
    const lineRows = await selectRows(
      db,
      `SELECT l.approval_id, l.approved_fils, l.amount_fils, h.id, h.system_no, h.code, h.name
         FROM approval_budget_lines l JOIN cost_heads h ON h.id = l.cost_head_id
        WHERE l.approval_id IN (${placeholders(headers.length)})
        ORDER BY h.display_order, h.system_no`,
      headers.map((h) => h.id),
    );
    const byApproval = new Map<string, BudgetLineRecord[]>();
    for (const l of lineRows) {
      const list = byApproval.get(str(l, 'approval_id')) ?? [];
      list.push({
        costHead: {
          id: str(l, 'id'),
          systemNo: str(l, 'system_no'),
          code: str(l, 'code'),
          name: str(l, 'name'),
        },
        approvedFils: moneyOrNull(l['approved_fils']),
        amountFils: moneyOrNull(l['amount_fils']),
      });
      byApproval.set(str(l, 'approval_id'), list);
    }
    return headers.map((h) => ({ ...h, lines: byApproval.get(h.id) ?? [] }));
  }

  return {
    /** A new waiting request. A second one for the same project is refused by the database. */
    async create(input: {
      projectId: string;
      requestedBy: string;
      lines: { costHeadId: string; approvedFils: Fils | null; amountFils: Fils | null }[];
    }): Promise<string> {
      return guarded('A budget request waiting for this project', async () => {
        const row = await selectOne(
          db,
          `INSERT INTO approvals (kind, project_id, reason, requested_by)
           VALUES ('BUDGET', ?, 'Project cost structure', ?) RETURNING id`,
          [input.projectId, input.requestedBy],
        );
        const id = str(row as Row, 'id');
        for (const line of input.lines) {
          await exec(
            db,
            `INSERT INTO approval_budget_lines (approval_id, cost_head_id, approved_fils, amount_fils)
             VALUES (?, ?, ?, ?)`,
            [id, line.costHeadId, line.approvedFils, line.amountFils],
          );
        }
        return id;
      });
    },
    async findById(id: string): Promise<BudgetApprovalRecord | null> {
      const rows = await selectRows(db, `${COLUMNS} ${FROM} WHERE a.id = ? AND a.kind = 'BUDGET'`, [
        id,
      ]);
      return (await withLines(rows))[0] ?? null;
    },
    /** The project's most recent budget request, if any. */
    async latestForProject(projectId: string): Promise<BudgetApprovalRecord | null> {
      const rows = await selectRows(
        db,
        `${COLUMNS} ${FROM} WHERE a.project_id = ? AND a.kind = 'BUDGET'
          ORDER BY a.created_at DESC, a.id DESC LIMIT 1`,
        [projectId],
      );
      return (await withLines(rows))[0] ?? null;
    },
    async list(
      input: ListInput<BudgetSort, 'status'>,
    ): Promise<{ rows: BudgetApprovalRecord[]; total: number }> {
      const { rows, total } = await runList(db, LIST, input);
      return { rows: await withLines(rows), total };
    },
    /** Which kind of request an id is, or null when there is none. */
    async kindOf(id: string): Promise<'EXPENSE' | 'BUDGET' | null> {
      const row = await selectOne(db, 'SELECT kind FROM approvals WHERE id = ?', [id]);
      return row ? (str(row, 'kind') as 'EXPENSE' | 'BUDGET') : null;
    },
  };
}
