import { useCallback, useState, type FormEvent } from 'react';
import { formatFils, sumFils, type CostStructure, type Fils, type ProjectBoq } from '@boq/shared';
import { getCostStructure, submitCostStructure } from '../../api/cost-structure';
import { getBoq } from '../../api/estimates';
import { attempt, useLoad } from '../../api/use-load';
import { formatDate } from '../../components/format';
import { parseKwdInput } from '../../components/kwd';
import { navigate } from '../../components/navigate';
import { ErrorText, SlideOver } from '../../components/SlideOver';

export type CostPhase = 'select' | 'estimate';
type Head = { id: string; systemNo: string; code: string; name: string };

/**
 * A project's cost structure: select the cost heads, enter an estimate for each, and submit it
 * for an administrator's approval. Used to set up a new project and to propose a change to an
 * approved budget (add a head, change an estimate, remove a head without expenses). The approved
 * budget only changes when the request is approved (server); this screen only proposes.
 */
export function CostStructureEditor(props: {
  projectId: string;
  onPhase?: (phase: CostPhase) => void;
}) {
  const { projectId } = props;
  const boq = useLoad(useCallback(() => getBoq(projectId), [projectId]));
  const structure = useLoad(useCallback(() => getCostStructure(projectId), [projectId]));
  if (!boq.data || !structure.data) return <ErrorText message={boq.error ?? structure.error} />;
  return (
    <Editor
      projectId={projectId}
      boq={boq.data}
      structure={structure.data}
      {...(props.onPhase && { onPhase: props.onPhase })}
    />
  );
}

function Editor(props: {
  projectId: string;
  boq: ProjectBoq;
  structure: CostStructure;
  onPhase?: (phase: CostPhase) => void;
}) {
  const { projectId, structure } = props;
  const approved = new Map(structure.approved.map((l) => [l.costHead.id, l.amountFils]));
  const locked = new Set(structure.lockedHeadIds.filter((id) => approved.has(id)));
  // Every active head can be chosen; a head already in the budget stays listed even if retired.
  const heads: Head[] = props.boq.rows
    .filter((r) => r.costHead.active || approved.has(r.costHead.id))
    .map((r) => r.costHead);
  const latest = structure.latest;
  // After a rejection, start from the rejected proposal so it can be corrected and resubmitted.
  const start =
    latest?.status === 'REJECTED'
      ? new Map(
          latest.lines.flatMap((l) =>
            l.amountFils === null ? [] : [[l.costHead.id, l.amountFils] as const],
          ),
        )
      : approved;

  const [phase, setPhaseState] = useState<CostPhase>('select');
  const [selected, setSelected] = useState<Set<string>>(() => new Set(start.keys()));
  const [amounts, setAmounts] = useState<Map<string, Fils>>(() => new Map(start));
  const [editing, setEditing] = useState<Head | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const closeEdit = useCallback(() => setEditing(null), []);
  const setPhase = (p: CostPhase) => {
    setPhaseState(p);
    props.onPhase?.(p);
  };

  if (latest?.status === 'PENDING') {
    return (
      <div className="narrow">
        <p className="notice">
          A budget request from {latest.requestedBy.name} (
          {formatDate(latest.requestedAt.slice(0, 10))}) is waiting for an administrator. Only one
          may wait at a time.
        </p>
        <a href={`#/projects/${projectId}`}>Back to the project</a>
      </div>
    );
  }
  if (!structure.editable)
    return <p className="muted">This project's budget can no longer change.</p>;

  const chosen = heads.filter((h) => selected.has(h.id));
  const removed = heads.filter((h) => approved.has(h.id) && !selected.has(h.id));
  const missing = chosen.filter((h) => !amounts.has(h.id));
  const changed =
    removed.length > 0 ||
    chosen.some((h) => !approved.has(h.id) || approved.get(h.id) !== amounts.get(h.id));
  const proposedTotal = sumFils(chosen.flatMap((h) => amounts.get(h.id) ?? []));

  const toggle = (id: string) => {
    if (locked.has(id)) return;
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const submit = async () => {
    setBusy(true);
    const err = await attempt(() =>
      submitCostStructure(projectId, {
        lines: chosen.map((h) => ({ costHeadId: h.id, amountFils: amounts.get(h.id) as Fils })),
      }),
    );
    setBusy(false);
    if (err) setError(err);
    else navigate(`#/projects/${projectId}`);
  };

  if (phase === 'select') {
    return (
      <div>
        {latest?.status === 'REJECTED' && (
          <p className="notice">
            Rejected by {latest.decidedBy?.name}: {latest.decisionComment}. Correct it and submit
            again.
          </p>
        )}
        <p className="muted">Select the cost heads that apply to this project.</p>
        <div className="check-grid" role="group" aria-label="Cost heads">
          {heads.map((h) => (
            <label key={h.id} className={locked.has(h.id) ? 'check-card locked' : 'check-card'}>
              <input
                type="checkbox"
                checked={selected.has(h.id)}
                disabled={locked.has(h.id)}
                onChange={() => toggle(h.id)}
              />
              <span className="code">{h.systemNo}</span>
              <span className="name">{h.name}</span>
              {locked.has(h.id) && <small className="muted">has expenses</small>}
            </label>
          ))}
          {heads.length === 0 && (
            <p className="muted">
              No active cost heads yet. An administrator adds them in Cost heads.
            </p>
          )}
        </div>
        <div className="row actions">
          <span className="muted">{chosen.length} selected</span>
          <span className="spacer" />
          <button
            type="button"
            className="btn-primary"
            disabled={chosen.length === 0}
            onClick={() => setPhase('estimate')}
          >
            Next: Enter estimates
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <p className="muted">Tap a row to enter its estimated amount (KWD).</p>
      <div className="table-scroll">
        <table className="table money">
          <thead>
            <tr>
              <th>Cost Code</th>
              <th>Cost Head</th>
              <th className="num">Estimated Amount</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {chosen.map((h) => {
              const amount = amounts.get(h.id);
              const was = approved.get(h.id);
              const status =
                amount === undefined
                  ? 'Not entered'
                  : was === undefined
                    ? 'New'
                    : was === amount
                      ? 'Approved'
                      : `Changed (approved ${formatFils(was)})`;
              return (
                <tr
                  key={h.id}
                  className="clickable"
                  onClick={() => setEditing(h)}
                  aria-label={`Estimate for ${h.systemNo}`}
                >
                  <td>{h.systemNo}</td>
                  <td className="name" title={h.name}>
                    {h.name}
                  </td>
                  <td className="num">{amount === undefined ? '—' : formatFils(amount)}</td>
                  <td className={amount === undefined ? 'negative' : undefined}>{status}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th colSpan={2}>Total estimated</th>
              <th className="num">{formatFils(proposedTotal)}</th>
              <th className="muted">approved {formatFils(structure.approvedTotalFils)}</th>
            </tr>
          </tfoot>
        </table>
      </div>
      {removed.length > 0 && (
        <p className="muted">
          To be removed from the budget:{' '}
          {removed
            .map((h) => `${h.systemNo} ${h.name} (${formatFils(approved.get(h.id) as Fils)})`)
            .join(', ')}
        </p>
      )}
      <ErrorText message={error} />
      <div className="row actions">
        <button type="button" onClick={() => setPhase('select')}>
          Back: Select costs
        </button>
        <span className="spacer" />
        <button
          type="button"
          className="btn-primary"
          disabled={busy || missing.length > 0 || !changed}
          onClick={() => void submit()}
        >
          Submit for approval
        </button>
      </div>
      {missing.length > 0 && (
        <p className="muted">Enter an amount for every selected head ({missing.length} left).</p>
      )}
      {!changed && missing.length === 0 && (
        <p className="muted">Nothing changed from the approved budget.</p>
      )}

      {editing && (
        <SlideOver title={`${editing.systemNo} · ${editing.name}`} onClose={closeEdit} sheet>
          <AmountForm
            initial={amounts.get(editing.id)}
            approved={approved.get(editing.id)}
            onSave={(fils) => {
              setAmounts(new Map(amounts).set(editing.id, fils));
              closeEdit();
            }}
          />
        </SlideOver>
      )}
    </div>
  );
}

/** One head's estimate, in KWD. Converted to fils exactly; an invalid amount is not accepted. */
function AmountForm(props: {
  initial: Fils | undefined;
  approved: Fils | undefined;
  onSave: (fils: Fils) => void;
}) {
  const [text, setText] = useState(props.initial === undefined ? '' : formatFils(props.initial));
  const amount = parseKwdInput(text);
  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (amount !== null) props.onSave(amount);
  };
  return (
    <form className="form" onSubmit={submit}>
      {props.approved !== undefined && (
        <p className="muted">Approved estimate: {formatFils(props.approved)} KWD</p>
      )}
      <label>
        Estimated amount (KWD)
        <input
          className={text.trim() && amount === null ? 'amount invalid' : 'amount'}
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
          required
        />
      </label>
      {text.trim() && amount === null && (
        <p className="error">Enter a non-negative amount with at most 3 decimals.</p>
      )}
      <button className="btn-primary" type="submit" disabled={amount === null}>
        Save estimate
      </button>
    </form>
  );
}
