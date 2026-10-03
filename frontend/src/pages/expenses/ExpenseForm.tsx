import { useCallback, useState, type FormEvent } from 'react';
import {
  ATTACHMENT_TYPES,
  formatFils,
  formatUtilisation,
  type BudgetProjection,
  type Expense,
  type Fils,
} from '@boq/shared';
import { getBoq } from '../../api/estimates';
import { createExpense, getProjection, updateExpense, uploadAttachment } from '../../api/expenses';
import { useDebounced } from '../../api/use-debounced';
import { attempt, useLoad } from '../../api/use-load';
import { todayIso } from '../../components/format';
import { parseKwdInput } from '../../components/kwd';
import { ErrorText } from '../../components/SlideOver';
import { StatusDot } from '../../components/StatusDot';

/**
 * The short Add Expense form, also used to correct one. The bill (PDF, JPG or PNG) is optional.
 * Validation is the server's; this only converts KWD to fils at the edge. When the server's
 * projection says the expense reaches the approval level, it asks for the reason the approval
 * request must carry (the server decides again when saving).
 */
export function ExpenseForm(props: {
  projectId: string;
  expense?: Expense;
  /** Pre-selected head when adding from a cost-head page. */
  costHeadId?: string;
  onSaved: () => void;
}) {
  const { projectId, expense: e } = props;
  const boq = useLoad(useCallback(() => getBoq(projectId), [projectId]));
  const [v, setV] = useState({
    costHeadId: e?.costHead.id ?? props.costHeadId ?? '',
    vendor: e?.vendor ?? '',
    invoiceNo: e?.invoiceNo ?? '',
    expenseDate: e?.expenseDate ?? todayIso(),
    amount: e ? formatFils(e.amountFils) : '',
    description: e?.description ?? '',
    approvalReason: '',
  });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof v) => (ev: { target: { value: string } }) =>
    setV({ ...v, [key]: ev.target.value });

  const amountFils = v.amount.trim() ? parseKwdInput(v.amount) : null;
  // Only heads in the approved budget take expenses (server); keep the current one when editing.
  const heads = (boq.data?.rows ?? []).filter(
    (r) => (r.costHead.active && r.inBudget) || r.costHead.id === v.costHeadId,
  );
  const projection = useProjection(projectId, e ? '' : v.costHeadId, amountFils);
  const needsApproval = projection?.projected.status === 'APPROVAL_REQUIRED';

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (amountFils === null) return;
    setBusy(true);
    const body = {
      costHeadId: v.costHeadId,
      vendor: v.vendor,
      invoiceNo: v.invoiceNo,
      expenseDate: v.expenseDate,
      amountFils,
      description: v.description.trim() ? v.description : null,
    };
    try {
      const saved = e
        ? await updateExpense(projectId, e.id, body)
        : await createExpense(projectId, {
            ...body,
            ...(needsApproval && { approvalReason: v.approvalReason }),
          });
      if (file) {
        const err = await attempt(() => uploadAttachment(projectId, saved.id, file));
        if (err) throw new Error(`Expense saved, but the bill was not attached: ${err}`);
      }
      props.onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="form" onSubmit={submit}>
      <label>
        Cost head
        <select value={v.costHeadId} onChange={set('costHeadId')} required>
          <option value="">Choose…</option>
          {heads.map((r) => (
            <option key={r.costHead.id} value={r.costHead.id}>
              {r.costHead.code} · {r.costHead.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Vendor
        <input value={v.vendor} onChange={set('vendor')} required maxLength={200} />
      </label>
      <div className="row">
        <label>
          Invoice no.
          <input value={v.invoiceNo} onChange={set('invoiceNo')} required maxLength={60} />
        </label>
        <label>
          Date
          <input type="date" value={v.expenseDate} onChange={set('expenseDate')} required />
        </label>
      </div>
      <label>
        Amount (KWD)
        <input
          className={v.amount.trim() && amountFils === null ? 'amount invalid' : 'amount'}
          inputMode="decimal"
          value={v.amount}
          onChange={set('amount')}
          required
        />
      </label>
      {projection && <Preview projected={projection.projected} />}
      {needsApproval && (
        <label>
          Reason for approval
          <textarea
            value={v.approvalReason}
            onChange={set('approvalReason')}
            required
            rows={2}
            maxLength={500}
          />
          <small className="muted">
            It is held outside Actual until an administrator approves it.
          </small>
        </label>
      )}
      <label>
        Description
        <textarea value={v.description} onChange={set('description')} rows={2} maxLength={2000} />
      </label>
      <div className="bill">
        <label>
          Bill (PDF, JPG or PNG)
          {e?.attachment && <small className="muted"> replaces {e.attachment.name}</small>}
          <input
            type="file"
            accept={ATTACHMENT_TYPES.join(',')}
            onChange={(ev) => setFile(ev.target.files?.[0] ?? null)}
          />
        </label>
        {/* On a tablet or phone this opens the rear camera straight away. */}
        <label className="camera">
          Take photo
          <input
            type="file"
            accept="image/jpeg,image/png"
            capture="environment"
            aria-label="Take a photo of the bill"
            onChange={(ev) => setFile(ev.target.files?.[0] ?? null)}
          />
        </label>
        {file && <small className="muted">Attaching {file.name}</small>}
      </div>
      <ErrorText message={error ?? boq.error} />
      <button
        className="btn-primary"
        type="submit"
        disabled={busy || amountFils === null || (needsApproval && !v.approvalReason.trim())}
      >
        {e ? 'Save changes' : needsApproval ? 'Send for approval' : 'Add expense'}
      </button>
    </form>
  );
}

export function ReverseForm(props: {
  expense: Expense;
  onReversed: () => void;
  reverse: (reason: string) => Promise<unknown>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setBusy(true);
    const err = await attempt(() => props.reverse(reason));
    setBusy(false);
    if (err) setError(err);
    else props.onReversed();
  };
  return (
    <form className="form" onSubmit={submit}>
      <p>
        Reversing {props.expense.vendor} · {props.expense.invoiceNo} ·{' '}
        {formatFils(props.expense.amountFils)} KWD adds a matching negative entry. The original
        stays on record.
      </p>
      <label>
        Reason
        <textarea
          value={reason}
          onChange={(ev) => setReason(ev.target.value)}
          required
          maxLength={500}
          rows={2}
        />
      </label>
      <ErrorText message={error} />
      <button className="btn-danger" type="submit" disabled={busy || !reason.trim()}>
        Reverse expense
      </button>
    </form>
  );
}

/**
 * The server's projection for a new expense once typing pauses: what it would do to the head.
 * Null until there is a head and a valid amount (and always for an edit: pass no head).
 */
function useProjection(
  projectId: string,
  costHeadIdNow: string,
  amountFilsNow: Fils | null,
): BudgetProjection | null {
  const costHeadId = useDebounced(costHeadIdNow);
  const amountFils = useDebounced(amountFilsNow);
  const ready = costHeadId !== '' && amountFils !== null && amountFils > 0;
  const projection = useLoad(
    useCallback(
      () => (ready ? getProjection(projectId, costHeadId, amountFils) : Promise.resolve(null)),
      [ready, projectId, costHeadId, amountFils],
    ),
  );
  return (ready && projection.data) || null;
}

/** What this expense would do to the head, before it is saved. All figures are the server's. */
function Preview(props: { projected: BudgetProjection['projected'] }) {
  const p = props.projected;
  return (
    <div
      className={`preview preview-${p.status.toLowerCase()}`}
      role="status"
      aria-label="After this expense"
    >
      <span className="muted">After this expense:</span> Actual {formatFils(p.metrics.actual)} ·
      Remaining {formatFils(p.metrics.remaining)} · Used{' '}
      {formatUtilisation(p.metrics.utilisationBp)} <StatusDot status={p.status} />
      {p.status === 'APPROVAL_REQUIRED' && (
        <div>This takes the head to its approval level, so it needs approval.</div>
      )}
    </div>
  );
}
