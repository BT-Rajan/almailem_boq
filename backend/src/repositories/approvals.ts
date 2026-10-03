import {
  approvalStatusSchema,
  fils,
  type APPROVAL_SORTS,
  type ApprovalStatus,
  type Fils,
} from '@boq/shared';
import type { Db } from '../db/pool';
import { exec, selectOne, selectRows, type Row } from '../db/sql';
import { andConditions, memberScope, runList, type ListInput, type ListSpec } from '../query/list';
import { str, strOrNull, toDate, toDateOrNull } from './shared';

/** Approval requests and their append-only history (approval_actions). */

export type ApprovalAction = 'REQUESTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

export type ApprovalActionRecord = {
  action: ApprovalAction;
  from: ApprovalStatus | null;
  to: ApprovalStatus;
  actorUserId: string;
  comment: string | null;
  projectedBp: number | null;
};

export type ApprovalRecord = {
  id: string;
  status: ApprovalStatus;
  reason: string;
  requestedBp: number;
  requestedBy: string;
  requestedByName: string;
  decidedBp: number | null;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  decisionComment: string | null;
  createdAt: Date;
  project: { id: string; systemNo: string; name: string };
  costHead: { id: string; code: string; name: string };
  expense: {
    id: string;
    vendor: string;
    invoiceNo: string;
    expenseDate: string;
    amountFils: Fils;
    hasAttachment: boolean;
  };
};

type ApprovalSort = (typeof APPROVAL_SORTS)[number];

const map = (r: Row): ApprovalRecord => ({
  id: str(r, 'id'),
  status: approvalStatusSchema.parse(r['status']),
  reason: str(r, 'reason'),
  requestedBp: Number(r['requested_bp']),
  requestedBy: str(r, 'requested_by'),
  requestedByName: str(r, 'requested_by_name'),
  decidedBp: r['decided_bp'] === null ? null : Number(r['decided_bp']),
  decidedBy: strOrNull(r, 'decided_by'),
  decidedByName: strOrNull(r, 'decided_by_name'),
  decidedAt: toDateOrNull(r['decided_at']),
  decisionComment: strOrNull(r, 'decision_comment'),
  createdAt: toDate(r['created_at']),
  project: {
    id: str(r, 'project_id'),
    systemNo: str(r, 'project_system_no'),
    name: str(r, 'project_name'),
  },
  costHead: {
    id: str(r, 'cost_head_id'),
    code: str(r, 'cost_head_code'),
    name: str(r, 'cost_head_name'),
  },
  expense: {
    id: str(r, 'expense_id'),
    vendor: str(r, 'vendor'),
    invoiceNo: str(r, 'invoice_no'),
    expenseDate: str(r, 'expense_date'),
    amountFils: fils(Number(r['amount_fils'])),
    hasAttachment: r['attachment_key'] !== null,
  },
});

const COLUMNS = `SELECT a.*, p.system_no AS project_system_no, p.name AS project_name,
  e.cost_head_id, h.code AS cost_head_code, h.name AS cost_head_name,
  e.vendor, e.invoice_no, e.expense_date, e.amount_fils, e.attachment_key,
  ur.name AS requested_by_name, ud.name AS decided_by_name`;
const FROM = `FROM approvals a
  JOIN projects p ON p.id = a.project_id AND p.deleted_at IS NULL
  JOIN expenses e ON e.id = a.expense_id
  JOIN cost_heads h ON h.id = e.cost_head_id
  JOIN users ur ON ur.id = a.requested_by
  LEFT JOIN users ud ON ud.id = a.decided_by`;

const LIST: ListSpec<ApprovalSort, 'status'> = {
  select: COLUMNS,
  from: FROM,
  search: ['p.system_no', 'p.name', 'e.vendor', 'e.invoice_no', 'a.reason'],
  sorts: { requested: 'a.created_at', amount: 'e.amount_fils', project: 'p.system_no' },
  defaultSort: { key: 'requested', dir: 'asc' }, // oldest waiting first
  tiebreaker: 'a.id',
  filters: { status: 'a.status' },
};

export function approvalsRepository(db: Db) {
  return {
    async create(input: {
      expenseId: string;
      projectId: string;
      reason: string;
      requestedBp: number;
      requestedBy: string;
    }): Promise<string> {
      const row = await selectOne(
        db,
        `INSERT INTO approvals (expense_id, project_id, reason, requested_bp, requested_by)
         VALUES (?, ?, ?, ?, ?) RETURNING id`,
        [input.expenseId, input.projectId, input.reason, input.requestedBp, input.requestedBy],
      );
      return str(row as Row, 'id');
    },
    async findById(id: string): Promise<ApprovalRecord | null> {
      const row = await selectOne(db, `${COLUMNS} ${FROM} WHERE a.id = ?`, [id]);
      return row ? map(row) : null;
    },
    /** Row-lock one request until the transaction ends. */
    async lock(id: string): Promise<void> {
      await selectOne(db, 'SELECT id FROM approvals WHERE id = ? FOR UPDATE', [id]);
    },
    async decide(
      id: string,
      d: {
        status: ApprovalStatus;
        decidedBy: string | null;
        decidedBp: number | null;
        comment: string | null;
      },
    ): Promise<void> {
      await exec(
        db,
        `UPDATE approvals
            SET status = ?, decided_by = ?, decided_bp = ?, decided_at = CURRENT_TIMESTAMP(3),
                decision_comment = ?
          WHERE id = ?`,
        [d.status, d.decidedBy, d.decidedBp, d.comment, id],
      );
    },
    /** One step of a request's history. The table refuses updates and deletes. */
    async addAction(a: {
      approvalId: string;
      action: ApprovalAction;
      from: ApprovalStatus | null;
      to: ApprovalStatus;
      actorUserId: string;
      comment: string | null;
      projectedBp: number | null;
    }): Promise<void> {
      await exec(
        db,
        `INSERT INTO approval_actions
           (approval_id, action, from_status, to_status, actor_user_id, comment, projected_bp)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [a.approvalId, a.action, a.from, a.to, a.actorUserId, a.comment, a.projectedBp],
      );
    },
    /** A request's history, oldest first. */
    async listActions(approvalId: string): Promise<ApprovalActionRecord[]> {
      const rows = await selectRows(
        db,
        'SELECT * FROM approval_actions WHERE approval_id = ? ORDER BY id',
        [approvalId],
      );
      return rows.map((r) => ({
        action: str(r, 'action') as ApprovalAction,
        from: r['from_status'] === null ? null : approvalStatusSchema.parse(r['from_status']),
        to: approvalStatusSchema.parse(r['to_status']),
        actorUserId: str(r, 'actor_user_id'),
        comment: strOrNull(r, 'comment'),
        projectedBp: r['projected_bp'] === null ? null : Number(r['projected_bp']),
      }));
    },
    /** Requests in live projects, through the shared list builder. */
    async list(
      input: ListInput<ApprovalSort, 'status'>,
    ): Promise<{ rows: ApprovalRecord[]; total: number }> {
      const { rows, total } = await runList(db, LIST, input);
      return { rows: rows.map(map), total };
    },
    /** Requests waiting for a decision in the projects this user can see (null = all). */
    async countPending(memberUserId: string | null): Promise<number> {
      const s = andConditions(memberScope('a.project_id', memberUserId));
      const row = await selectOne(
        db,
        `SELECT COUNT(*) AS n
           FROM approvals a JOIN projects p ON p.id = a.project_id AND p.deleted_at IS NULL
          WHERE a.status = 'PENDING'${s.sql}`,
        s.params,
      );
      return Number(row?.['n'] ?? 0);
    },
  };
}
