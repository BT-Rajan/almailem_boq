import { useCallback } from 'react';
import {
  fils,
  formatFils,
  type ExpenseHistoryAction,
  type ExpenseHistoryChange,
  type ExpenseHistoryField,
} from '@boq/shared';
import { attachmentUrl, getExpenseDetail } from '../../api/expenses';
import { useLoad } from '../../api/use-load';
import { expenseStatusLabel, formatDate, formatDateTime } from '../../components/format';
import { ErrorText } from '../../components/SlideOver';

const ACTION_LABELS: Record<ExpenseHistoryAction, string> = {
  CREATED: 'Created',
  MODIFIED: 'Modified',
  BILL_UPLOADED: 'Bill uploaded',
  REVERSED: 'Reversed',
  APPROVAL_REQUESTED: 'Approval requested',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Approval cancelled',
  DELETED: 'Deleted',
};
const FIELD_LABELS: Record<ExpenseHistoryField, string> = {
  costHead: 'Cost head',
  vendor: 'Vendor',
  invoiceNo: 'Invoice',
  expenseDate: 'Date',
  amountFils: 'Amount',
  description: 'Description',
  bill: 'Bill',
};

function value(field: ExpenseHistoryField, v: string | number | null): string {
  if (v === null || v === '') return '—';
  if (field === 'amountFils' && typeof v === 'number') return `${formatFils(fils(v))} KWD`;
  if (field === 'expenseDate' && typeof v === 'string') return formatDate(v);
  return String(v);
}
const change = (c: ExpenseHistoryChange, created: boolean) =>
  created || c.from === null
    ? `${FIELD_LABELS[c.field]}: ${value(c.field, c.to)}`
    : `${FIELD_LABELS[c.field]}: ${value(c.field, c.from)} → ${value(c.field, c.to)}`;

/** One expense: what it is, where it belongs, its bill, and its history from the audit trail. */
export function ExpenseDetailView(props: { projectId: string; expenseId: string }) {
  const { projectId, expenseId } = props;
  const load = useLoad(
    useCallback(() => getExpenseDetail(projectId, expenseId), [projectId, expenseId]),
  );
  const d = load.data;
  if (!d) return <ErrorText message={load.error} />;
  const e = d.expense;
  const status = d.deleted
    ? 'Deleted'
    : e.reversalOf
      ? 'Reversal entry'
      : e.reversedAt
        ? 'Reversed'
        : expenseStatusLabel(e.status);
  return (
    <div className="form">
      {d.deleted && (
        <p className="notice rejected" role="status">
          Deleted by {d.deleted.by?.name ?? 'the system'} on {formatDateTime(d.deleted.at)}. It no
          longer counts and is kept on record only.
        </p>
      )}
      <dl className="facts wide">
        <dt>Amount</dt>
        <dd className={e.amountFils < 0 ? 'num negative' : 'num'}>
          {formatFils(e.amountFils)} KWD
        </dd>
        <dt>Date</dt>
        <dd>{formatDate(e.expenseDate)}</dd>
        <dt>Vendor</dt>
        <dd>{e.vendor}</dd>
        <dt>Invoice</dt>
        <dd>{e.invoiceNo}</dd>
        <dt>Description</dt>
        <dd className="prewrap">{e.description ?? '—'}</dd>
        <dt>Project</dt>
        <dd>
          {d.project.systemNo} · {d.project.name}
        </dd>
        <dt>Cost head</dt>
        <dd>
          {d.costHead.systemNo} · {d.costHead.name}
        </dd>
        <dt>Status</dt>
        <dd>{status}</dd>
        <dt>Entered by</dt>
        <dd>{e.createdBy.name}</dd>
        <dt>Created</dt>
        <dd>{formatDateTime(e.createdAt)}</dd>
        {e.modifiedBy && (
          <>
            <dt>Modified by</dt>
            <dd>{e.modifiedBy.name}</dd>
            <dt>Modified</dt>
            <dd>{formatDateTime(e.modifiedAt)}</dd>
          </>
        )}
        <dt>Bill</dt>
        <dd>
          {e.attachment && !d.deleted ? (
            <a href={attachmentUrl(projectId, e.id)} target="_blank" rel="noopener">
              View {e.attachment.name}
            </a>
          ) : e.attachment ? (
            e.attachment.name
          ) : (
            <span className="muted">No bill uploaded</span>
          )}
        </dd>
      </dl>

      <h2>History</h2>
      <ol className="history" aria-label="History">
        {d.history.map((h, i) => (
          <li key={i}>
            <div>
              <strong>{ACTION_LABELS[h.action]}</strong>{' '}
              <span className="muted">
                {h.by?.name ?? 'System'}, {formatDateTime(h.at)}
              </span>
            </div>
            {h.changes
              .filter((c) => h.action !== 'CREATED' || c.to !== null)
              .map((c) => (
                <div key={c.field} className="muted">
                  {change(c, h.action === 'CREATED')}
                </div>
              ))}
            {h.note && <div className="muted prewrap">“{h.note}”</div>}
          </li>
        ))}
        {d.history.length === 0 && <li className="muted">No history recorded.</li>}
      </ol>
    </div>
  );
}
