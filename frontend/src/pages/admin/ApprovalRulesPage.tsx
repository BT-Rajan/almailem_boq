import { useState, type FormEvent } from 'react';
import { formatUtilisation, percentToBp, type ThresholdSettings } from '@boq/shared';
import { getApprovalRules, setApprovalRules } from '../../api/approval-rules';
import { attempt, useLoad } from '../../api/use-load';
import { StatusDot } from '../../components/StatusDot';
import { ErrorText } from '../../components/SlideOver';

/** Administration > Approval Rules: the warning and approval levels, as a share of each budget. */
export function ApprovalRulesPage() {
  const { data, error, reload } = useLoad(getApprovalRules);
  return (
    <section className="panel narrow">
      <div className="toolbar">
        <h1>Approval rules</h1>
      </div>
      <ErrorText message={error} />
      {data && <RulesForm key={data.updatedAt} rules={data} onSaved={reload} />}
    </section>
  );
}

function RulesForm(props: { rules: ThresholdSettings; onSaved: () => void }) {
  const { rules } = props;
  const toText = (bp: number) => formatUtilisation(bp).replace('%', '');
  const [warning, setWarning] = useState(toText(rules.warningBp));
  const [approval, setApproval] = useState(toText(rules.approvalBp));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const warningBp = percentToBp(warning);
  const approvalBp = percentToBp(approval);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (warningBp === null || approvalBp === null) return;
    setBusy(true);
    const err = await attempt(() => setApprovalRules({ warningBp, approvalBp }));
    setBusy(false);
    if (err) setError(err);
    else props.onSaved();
  };

  return (
    <form className="form" onSubmit={submit}>
      <p className="muted">
        Each cost head's status follows how much of its budget is used. A head with spend but no
        budget always needs approval.
      </p>
      <table className="table">
        <tbody>
          <tr>
            <td>
              <StatusDot status="NORMAL" />
            </td>
            <td>below the warning level</td>
          </tr>
          <tr>
            <td>
              <StatusDot status="WARNING" />
            </td>
            <td>
              <label className="inline">
                from{' '}
                <input
                  className={warningBp === null ? 'amount invalid' : 'amount'}
                  inputMode="decimal"
                  aria-label="Warning level (%)"
                  value={warning}
                  onChange={(e) => setWarning(e.target.value)}
                />{' '}
                % of budget
              </label>
            </td>
          </tr>
          <tr>
            <td>
              <StatusDot status="APPROVAL_REQUIRED" />
            </td>
            <td>
              <label className="inline">
                from{' '}
                <input
                  className={approvalBp === null ? 'amount invalid' : 'amount'}
                  inputMode="decimal"
                  aria-label="Approval level (%)"
                  value={approval}
                  onChange={(e) => setApproval(e.target.value)}
                />{' '}
                % of budget (at most 100)
              </label>
            </td>
          </tr>
        </tbody>
      </table>
      <ErrorText message={error} />
      <button
        className="btn-primary"
        type="submit"
        disabled={busy || warningBp === null || approvalBp === null}
      >
        Save rules
      </button>
      <small className="muted">Last changed {new Date(rules.updatedAt).toLocaleString()}</small>
    </form>
  );
}
