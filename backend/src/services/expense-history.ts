import type {
  ExpenseHistoryAction,
  ExpenseHistoryChange,
  ExpenseHistoryEntry,
  ExpenseHistoryField,
} from '@boq/shared';
import type { Db } from '../db/pool';
import {
  auditLogRepository,
  costHeadsRepository,
  usersRepository,
  type AuditRecord,
  type ExpenseRecord,
} from '../repositories';

/**
 * An expense's history, read from the audit trail (the expense's own events and those of its
 * approval request) and put in user terms: what was done, by whom, when, and what changed.
 * Nothing is recorded here; the audit trail is the only record.
 */

const ACTIONS: Record<string, ExpenseHistoryAction> = {
  'expense.created': 'CREATED',
  'expense.updated': 'MODIFIED',
  'expense.attachment_added': 'BILL_UPLOADED',
  'expense.reversed': 'REVERSED',
  'expense.deleted': 'DELETED',
  'approval.requested': 'APPROVAL_REQUESTED',
  'approval.approved': 'APPROVED',
  'approval.rejected': 'REJECTED',
  'approval.cancelled': 'CANCELLED',
};

/** Audit field names to the fields a person sees. */
const FIELDS: Record<string, ExpenseHistoryField> = {
  costHeadId: 'costHead',
  vendor: 'vendor',
  invoiceNo: 'invoiceNo',
  expenseDate: 'expenseDate',
  amountFils: 'amountFils',
  description: 'description',
};

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj => (v !== null && typeof v === 'object' ? (v as Obj) : {});
const plain = (v: unknown): string | number | null =>
  typeof v === 'string' || typeof v === 'number' ? v : null;
const text = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

/** The changes an event records, by field; `from` only where the event kept the old value. */
function changesOf(r: AuditRecord): ExpenseHistoryChange[] {
  const before = asObj(r.before);
  const after = asObj(r.after);
  if (r.event === 'expense.attachment_added') {
    return [{ field: 'bill', from: plain(before['name']), to: plain(after['name']) }];
  }
  if (r.event !== 'expense.created' && r.event !== 'expense.updated') return [];
  return Object.keys(after).flatMap((k) => {
    const field = FIELDS[k];
    return field ? [{ field, from: plain(before[k]), to: plain(after[k]) }] : [];
  });
}

function noteOf(r: AuditRecord): string | null {
  const after = asObj(r.after);
  return text(after['reason']) ?? text(after['comment']);
}

export async function expenseHistory(db: Db, e: ExpenseRecord): Promise<ExpenseHistoryEntry[]> {
  const audit = auditLogRepository(db);
  const records = [
    ...(await audit.listForEntity('expense', e.id)),
    ...(e.approval ? await audit.listForEntity('approval', e.approval.id) : []),
  ]
    .filter((r) => ACTIONS[r.event])
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id - b.id);

  // Names for the people and cost heads the entries mention (deleted ones included).
  const names = new Map<string, string>();
  for (const id of new Set(records.flatMap((r) => r.actorUserId ?? []))) {
    names.set(id, (await usersRepository(db).findById(id, { includeDeleted: true }))?.name ?? '');
  }
  const heads = new Map<string, string>();
  const headLabel = async (v: string | number | null) => {
    if (typeof v !== 'string') return v;
    if (!heads.has(v)) {
      const h = await costHeadsRepository(db).findById(v, { includeDeleted: true });
      heads.set(v, h ? `${h.systemNo} · ${h.name}` : v);
    }
    return heads.get(v) ?? v;
  };

  const out: ExpenseHistoryEntry[] = [];
  for (const r of records) {
    const changes = [];
    for (const c of changesOf(r)) {
      changes.push(
        c.field === 'costHead'
          ? { ...c, from: await headLabel(c.from), to: await headLabel(c.to) }
          : c,
      );
    }
    out.push({
      action: ACTIONS[r.event] as ExpenseHistoryAction,
      by: r.actorUserId ? { id: r.actorUserId, name: names.get(r.actorUserId) ?? '' } : null,
      at: r.createdAt.toISOString(),
      changes,
      note: noteOf(r),
    });
  }
  return out;
}
