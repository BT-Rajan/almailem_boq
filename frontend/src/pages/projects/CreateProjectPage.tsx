import { useCallback, useState } from 'react';
import { formatFils, sumFils, type Fils } from '@boq/shared';
import { getBoq, setEstimates } from '../../api/estimates';
import { createProject } from '../../api/projects';
import { attempt, useLoad } from '../../api/use-load';
import { BoqTable } from '../../components/BoqTable';
import { parseKwdInput } from '../../components/kwd';
import { navigate } from '../../components/navigate';
import { ErrorText } from '../../components/SlideOver';
import { ProjectForm, toRequest } from './ProjectForm';

/**
 * Create Project: 1 Details (creates the project), 2 BoQ (a budget per cost head, with a running
 * total), 3 Review (the server's figures). Steps 2 and 3 work on the project step 1 created.
 */
export const CREATE_PROJECT_STEPS = [
  { key: 'details', label: 'Details' },
  { key: 'boq', label: 'BoQ' },
  { key: 'review', label: 'Review' },
] as const;
export type CreateStep = (typeof CREATE_PROJECT_STEPS)[number]['key'];

const setupUrl = (id: string, step: Exclude<CreateStep, 'details'>) =>
  `#/projects/${id}/setup/${step}`;

export function CreateProjectPage(props: { step?: CreateStep; projectId?: string }) {
  const step = props.step ?? 'details';
  return (
    <section className="panel">
      <div className="toolbar">
        <h1>New project</h1>
        <ol className="steps" aria-label="Steps">
          {CREATE_PROJECT_STEPS.map((s, i) => (
            <li key={s.key} className={s.key === step ? 'active' : undefined}>
              {i + 1}. {s.label}
            </li>
          ))}
        </ol>
      </div>
      {step === 'details' && <DetailsStep />}
      {step === 'boq' && props.projectId && <BoqStep projectId={props.projectId} />}
      {step === 'review' && props.projectId && <ReviewStep projectId={props.projectId} />}
    </section>
  );
}

function DetailsStep() {
  return (
    <div className="narrow">
      <ProjectForm
        project={null}
        submitLabel="Next: BoQ"
        onSubmit={async (v) => {
          let id = '';
          const err = await attempt(async () => {
            id = (await createProject({ code: v.code, ...toRequest(v) })).id;
          });
          if (!err) navigate(setupUrl(id, 'boq'));
          return err;
        }}
      />
    </div>
  );
}

function BoqStep(props: { projectId: string }) {
  const { projectId } = props;
  const boq = useLoad(useCallback(() => getBoq(projectId), [projectId]));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!boq.data) return <ErrorText message={boq.error} />;
  const rows = boq.data.rows.filter((r) => r.costHead.active);
  const textOf = (id: string, current: Fils) =>
    drafts[id] ?? (current === 0 ? '' : formatFils(current));
  const parsed = rows.map((r) => ({
    id: r.costHead.id,
    value: parseKwdInput(textOf(r.costHead.id, r.metrics.budget)),
  }));
  const invalid = parsed.some((p) => p.value === null);
  // Running total of what has been typed so far; the saved total comes from the server on review.
  const draftTotal = invalid ? null : sumFils(parsed.map((p) => p.value as Fils));

  const next = async () => {
    setBusy(true);
    const err = rows.length
      ? await attempt(() =>
          setEstimates(projectId, {
            estimates: parsed.map((p) => ({ costHeadId: p.id, amountFils: p.value as Fils })),
          }),
        )
      : null;
    setBusy(false);
    if (err) setError(err);
    else navigate(setupUrl(projectId, 'review'));
  };

  return (
    <div>
      <p className="muted">Budget per cost head in KWD. Leave empty for no budget.</p>
      <table className="table money">
        <thead>
          <tr>
            <th>Code</th>
            <th>Cost head</th>
            <th className="num">Budget (KWD)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.costHead.id}>
              <td>{r.costHead.code}</td>
              <td>{r.costHead.name}</td>
              <td className="num">
                <input
                  className={parsed[i]?.value === null ? 'amount invalid' : 'amount'}
                  inputMode="decimal"
                  aria-label={`Budget ${r.costHead.code}`}
                  value={textOf(r.costHead.id, r.metrics.budget)}
                  onChange={(e) => setDrafts({ ...drafts, [r.costHead.id]: e.target.value })}
                />
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={3} className="muted">
                No active cost heads yet. An administrator adds them in Cost heads.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr>
            <th colSpan={2}>Total</th>
            <th className="num" aria-label="Running total">
              {draftTotal === null ? 'Check the highlighted amounts' : formatFils(draftTotal)}
            </th>
          </tr>
        </tfoot>
      </table>
      <ErrorText message={error} />
      <div className="row actions">
        <span className="spacer" />
        <button type="button" className="btn-primary" disabled={busy || invalid} onClick={next}>
          Next: Review
        </button>
      </div>
    </div>
  );
}

function ReviewStep(props: { projectId: string }) {
  const { projectId } = props;
  const boq = useLoad(useCallback(() => getBoq(projectId), [projectId]));
  if (!boq.data) return <ErrorText message={boq.error} />;
  return (
    <div>
      <BoqTable boq={boq.data} />
      <div className="row actions">
        <a href={setupUrl(projectId, 'boq')}>Back to BoQ</a>
        <span className="spacer" />
        <a className="btn-primary button-link" href={`#/projects/${projectId}`}>
          Finish
        </a>
      </div>
    </div>
  );
}
