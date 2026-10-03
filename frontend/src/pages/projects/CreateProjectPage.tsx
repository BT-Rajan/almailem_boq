import { useState } from 'react';
import { createProject } from '../../api/projects';
import { attempt } from '../../api/use-load';
import { navigate } from '../../components/navigate';
import { CostStructureEditor, type CostPhase } from './CostStructurePage';
import { ProjectForm, toRequest } from './ProjectForm';

/**
 * Create Project: 1 Details (creates the project), then the cost structure on that project:
 * 2 Select costs, 3 Enter estimates, 4 Review and submit, 5 Admin approval (pending). Until
 * approved the project has no budget. The same cost-structure screen proposes later changes.
 */
export const CREATE_PROJECT_STEPS = [
  { key: 'details', label: 'Details' },
  { key: 'select', label: 'Select costs' },
  { key: 'estimate', label: 'Enter estimates' },
  { key: 'review', label: 'Review' },
  { key: 'pending', label: 'Admin approval' },
] as const;
/** URL steps: details, then the cost structure (`boq`; `review` is kept for old links). */
export type CreateStep = 'details' | 'boq' | 'review';

const setupUrl = (id: string) => `#/projects/${id}/setup/boq`;

export function CreateProjectPage(props: { step?: CreateStep; projectId?: string }) {
  const urlStep = props.step ?? 'details';
  const [phase, setPhase] = useState<CostPhase>('select');
  const step = urlStep === 'details' ? 'details' : phase;
  return (
    <section className="panel">
      <div className="toolbar">
        <h1>{urlStep === 'details' ? 'New project' : 'Project budget'}</h1>
        <ol className="steps" aria-label="Steps">
          {CREATE_PROJECT_STEPS.map((s, i) => (
            <li key={s.key} className={s.key === step ? 'active' : undefined}>
              {i + 1}. {s.label}
            </li>
          ))}
        </ol>
      </div>
      {urlStep === 'details' && <DetailsStep />}
      {urlStep !== 'details' && props.projectId && (
        <CostStructureEditor projectId={props.projectId} onPhase={setPhase} />
      )}
    </section>
  );
}

function DetailsStep() {
  return (
    <div className="narrow">
      <ProjectForm
        project={null}
        submitLabel="Next: Select costs"
        onSubmit={async (v) => {
          let id = '';
          const err = await attempt(async () => {
            id = (await createProject(toRequest(v))).id;
          });
          if (!err) navigate(setupUrl(id));
          return err;
        }}
      />
    </div>
  );
}
