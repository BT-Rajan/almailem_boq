import { useCallback, useState, type FormEvent } from 'react';
import {
  APPROVAL_STATUSES,
  formatFils,
  type ApprovalStatus,
  type BUDGET_APPROVAL_SORTS,
  type BudgetChange,
  type BudgetProposal,
  type Fils,
  type ListParams,
} from '@boq/shared';
import { approveRequest, rejectRequest } from '../api/approvals';
import { listCostStructureApprovals } from '../api/cost-structure';
import { attempt } from '../api/use-load';
import { approvalStatusLabel, formatDate } from '../components/format';
import { Pager, SortHeader, useList } from '../components/list';
import { ErrorText, SlideOver } from '../components/SlideOver';

const CHANGE_LABELS: Record<BudgetChange, string> = {
  ADDED: 'Added',
  REMOVED: 'Removed',
  CHANGED: 'Changed',
  UNCHANGED: 'Unchanged',
};
const money = (v: Fils | null) => (v === null ? '—' : formatFils(v));

/**
 * Project budgets (cost structures) waiting for an administrator: each head's approved and
 * proposed estimate, and the totals. Approving makes the proposal the approved budget (server).
 */
export function BudgetApprovals() {
  const [status, setStatus] = useState<ApprovalStatus>('PENDING');
  const list = useList(
    useCallback(
      (p: ListParams<(typeof BUDGET_APPROVAL_SORTS)[number]>) =>
        listCostStructureApprovals({ ...p, status }),
      [status],
    ),
  );
  const [open, setOpen] = useState<BudgetProposal | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const done = useCallback(() => {
    setOpen(null);
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
          placeholder="Search project"
          aria-label="Search budget requests"
          value={list.q}
          onChange={(e) => list.setQ(e.target.value)}
        />
      </div>
      <ErrorText message={list.error} />
      <div className="table-scroll">
        <table className="table money">
          <thead>
            <tr>
              <SortHeader label="Project" sortKey="project" list={list} />
              <th className="num">Changes</th>
              <th className="num">Approved total</th>
              <th className="num">Proposed total</th>
              <th>By</th>
              <SortHeader label="Requested" sortKey="requested" list={list} />
              <th className="num">Action</th>
            </tr>
          </thead>
          <tbody>
            {d?.items.map((b) => (
              <tr key={b.id} className="clickable" onClick={() => setOpen(b)}>
                <td
                  className="name"
                  title={`${b.project.systemNo} · ${b.project.code} · ${b.project.name}`}
                >
                  {b.project.systemNo} · {b.project.name}
                </td>
                <td className="num">{b.lines.filter((l) => l.change !== 'UNCHANGED').length}</td>
                <td className="num">{formatFils(b.approvedTotalFils)}</td>
                <td className="num">{formatFils(b.proposedTotalFils)}</td>
                <td>{b.requestedBy.name}</td>
                <td>{formatDate(b.requestedAt.slice(0, 10))}</td>
                <td className="num">
                  <button type="button" onClick={() => setOpen(b)}>
                    {b.status === 'PENDING' ? 'Review' : 'View'}
                  </button>
                </td>
              </tr>
            ))}
            {d && d.items.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
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
      {open && (
        <SlideOver
          title={`Budget: ${open.project.systemNo} · ${open.project.name}`}
          onClose={close}
          sheet
        >
          <BudgetDecision proposal={open} onDone={done} />
        </SlideOver>
      )}
    </>
  );
}

function BudgetDecision(props: { proposal: BudgetProposal; onDone: () => void }) {
  const b = props.proposal;
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const decide = async (verb: 'approve' | 'reject') => {
    setBusy(true);
    const err = await attempt(() =>
      verb === 'approve' ? approveRequest(b.id, comment) : rejectRequest(b.id, comment),
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
      <p className="muted">
        {b.requestedBy.name}, {formatDate(b.requestedAt.slice(0, 10))} ·{' '}
        {approvalStatusLabel(b.status)}
        {b.decisionComment && ` · ${b.decidedBy?.name ?? ''}: ${b.decisionComment}`}
      </p>
      <div className="table-scroll">
        <table className="table money" aria-label="Proposed cost structure">
          <thead>
            <tr>
              <th>Cost Code</th>
              <th>Cost Head</th>
              <th className="num">Approved</th>
              <th className="num">Proposed</th>
              <th>Change</th>
            </tr>
          </thead>
          <tbody>
            {b.lines.map((l) => (
              <tr key={l.costHead.id} className={l.change === 'UNCHANGED' ? 'inactive' : undefined}>
                <td>{l.costHead.systemNo}</td>
                <td className="name" title={l.costHead.name}>
                  {l.costHead.name}
                </td>
                <td className="num">{money(l.approvedFils)}</td>
                <td className="num">{money(l.amountFils)}</td>
                <td>{CHANGE_LABELS[l.change]}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={2}>Total</th>
              <th className="num">{formatFils(b.approvedTotalFils)}</th>
              <th className="num">{formatFils(b.proposedTotalFils)}</th>
              <th />
            </tr>
          </tfoot>
        </table>
      </div>
      {b.status === 'PENDING' && (
        <>
          <p>Approving makes the proposed values the approved budget. Rejecting changes nothing.</p>
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
        </>
      )}
    </form>
  );
}
