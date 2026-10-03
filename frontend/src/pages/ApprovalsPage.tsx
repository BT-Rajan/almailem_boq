import { useCallback, useState, type FormEvent } from 'react';
import {
  APPROVAL_STATUSES,
  formatFils,
  formatUtilisation,
  type ApprovalItem,
  type APPROVAL_SORTS,
  type ApprovalStatus,
  type ListParams,
} from '@boq/shared';
import { approveRequest, listApprovals, rejectRequest } from '../api/approvals';
import { attempt } from '../api/use-load';
import { approvalStatusLabel, formatDate } from '../components/format';
import { Pager, SortHeader, useList } from '../components/list';
import { Figures } from '../components/Figures';
import { ErrorText, SlideOver } from '../components/SlideOver';
import { BudgetApprovals } from './BudgetApprovals';
import { StatusDot } from '../components/StatusDot';

/**
 * Spend waiting for an administrator's decision, oldest first. For each waiting request the server
 * re-evaluates the head now: Budget, Actual, and Remaining, Used and status after this expense.
 * Who asked and when are in the reason's tooltip, so the money columns and Action fit a landscape
 * iPad without scrolling.
 */
/** Approvals: spend past the approval level, and project budgets (cost structures). */
export function ApprovalsPage() {
  const [kind, setKind] = useState<'spend' | 'budget'>('spend');
  return (
    <section className="panel">
      <div className="toolbar">
        <h1>Approvals</h1>
      </div>
      <div className="tabs" role="tablist">
        {(
          [
            ['spend', 'Spend'],
            ['budget', 'Budgets'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={kind === key}
            className={kind === key ? 'active' : undefined}
            onClick={() => setKind(key)}
          >
            {label}
          </button>
        ))}
      </div>
      {kind === 'spend' ? <SpendApprovals /> : <BudgetApprovals />}
    </section>
  );
}

function SpendApprovals() {
  const [status, setStatus] = useState<ApprovalStatus>('PENDING');
  const list = useList(
    useCallback(
      (p: ListParams<(typeof APPROVAL_SORTS)[number]>) => listApprovals({ ...p, status }),
      [status],
    ),
  );
  const [deciding, setDeciding] = useState<ApprovalItem | null>(null);
  const close = useCallback(() => setDeciding(null), []);
  const done = useCallback(() => {
    setDeciding(null);
    list.reload();
  }, [list]);

  const d = list.data;
  return (
    <>
      <div className="toolbar">
        <select
          aria-label="Show"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as ApprovalStatus);
            list.setPage(1);
          }}
        >
          {APPROVAL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {approvalStatusLabel(s)}
            </option>
          ))}
        </select>
        <span className="spacer" />
        <input
          type="search"
          placeholder="Search project, vendor, invoice, reason"
          aria-label="Search approvals"
          value={list.q}
          onChange={(e) => list.setQ(e.target.value)}
        />
      </div>
      <ErrorText message={list.error} />

      <div className="table-scroll">
        <table className="table money">
          <thead>
            <tr>
              <SortHeader label="Project · Head" sortKey="project" list={list} />
              <th>Invoice</th>
              <SortHeader label="Amount" sortKey="amount" list={list} className="num" />
              <th className="num">Budget</th>
              <th className="num">Actual</th>
              <th className="num">Remaining after</th>
              <th className="num">Used after</th>
              <th>Status</th>
              <th>Reason</th>
              <th className="num">Action</th>
            </tr>
          </thead>
          <tbody>
            {d?.items.map((a) => (
              <Row key={a.id} a={a} onDecide={() => setDeciding(a)} />
            ))}
            {d && d.items.length === 0 && (
              <tr>
                <td colSpan={10} className="muted">
                  Nothing {approvalStatusLabel(status).toLowerCase()}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager
        data={d}
        page={list.page}
        setPage={list.setPage}
        noun="requests"
        loading={list.loading}
      />

      {deciding && (
        <SlideOver title="Decide on spend" onClose={close} sheet>
          <DecisionForm item={deciding} onDone={done} />
        </SlideOver>
      )}
    </>
  );
}

function Row(props: { a: ApprovalItem; onDecide: () => void }) {
  const { a } = props;
  const now = a.now; // waiting requests only: the head re-evaluated by the server
  const usedBp = now?.projected.metrics.utilisationBp ?? a.decidedBp ?? a.requestedBp;
  const dash = <span className="muted">—</span>;
  const asked = `${a.requestedBy.name}, ${formatDate(a.requestedAt.slice(0, 10))}: ${a.reason}`;
  return (
    <tr>
      <td
        className="name short"
        title={`${a.project.code} · ${a.project.name} / ${a.costHead.code} · ${a.costHead.name}`}
      >
        <a href={`#/projects/${a.project.id}`}>{a.project.code}</a> ·{' '}
        <a href={`#/projects/${a.project.id}/heads/${a.costHead.id}`}>{a.costHead.code}</a>
      </td>
      <td className="name short" title={`${a.expense.vendor} · ${a.expense.invoiceNo}`}>
        {a.expense.invoiceNo}
      </td>
      <td className="num">{formatFils(a.expense.amountFils)}</td>
      <td className="num">{now ? formatFils(now.current.metrics.budget) : dash}</td>
      <td className="num">{now ? formatFils(now.current.metrics.actual) : dash}</td>
      <td className={now && now.projected.metrics.remaining < 0 ? 'num negative' : 'num'}>
        {now ? formatFils(now.projected.metrics.remaining) : dash}
      </td>
      <td className="num" title={now ? undefined : 'When decided'}>
        {formatUtilisation(usedBp)}
      </td>
      <td>
        {now ? <StatusDot status={now.projected.status} compact /> : approvalStatusLabel(a.status)}
      </td>
      <td
        className="muted name short"
        title={a.decisionComment ? `${asked} — ${a.decidedBy?.name}: ${a.decisionComment}` : asked}
      >
        {a.reason}
      </td>
      <td className="num">
        {a.status === 'PENDING' ? (
          <button type="button" onClick={props.onDecide}>
            Decide
          </button>
        ) : (
          <span className="muted">{a.decidedBy?.name ?? a.requestedBy.name}</span>
        )}
      </td>
    </tr>
  );
}

/** The decision itself: approve (comment optional) or reject (comment required). */
function DecisionForm(props: { item: ApprovalItem; onDone: () => void }) {
  const { item } = props;
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const decide = async (verb: 'approve' | 'reject') => {
    setBusy(true);
    const err = await attempt(() =>
      verb === 'approve' ? approveRequest(item.id, comment) : rejectRequest(item.id, comment),
    );
    setBusy(false);
    if (err) setError(err);
    else props.onDone();
  };
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    void decide('approve');
  };
  return (
    <form className="form" onSubmit={submit}>
      <p>
        {item.project.code} · {item.costHead.code} · {item.expense.vendor} ·{' '}
        {item.expense.invoiceNo} · {formatFils(item.expense.amountFils)} KWD
      </p>
      <p className="muted">
        {item.requestedBy.name}, {formatDate(item.requestedAt.slice(0, 10))}: {item.reason}
      </p>
      {item.now && (
        <Figures
          label="After this expense"
          metrics={item.now.projected.metrics}
          status={item.now.projected.status}
        />
      )}
      <p>Approving adds it to Actual now. Rejecting keeps it out for good.</p>
      <label>
        Comment <small className="muted">(required to reject)</small>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          maxLength={1000}
          rows={2}
        />
      </label>
      <ErrorText message={error} />
      <div className="row">
        <button
          className="btn-danger"
          type="button"
          disabled={busy || !comment.trim()}
          onClick={() => void decide('reject')}
        >
          Reject
        </button>
        <button className="btn-primary primary-action" type="submit" disabled={busy}>
          Approve
        </button>
      </div>
    </form>
  );
}
