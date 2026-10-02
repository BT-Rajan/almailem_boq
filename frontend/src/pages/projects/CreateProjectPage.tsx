import { createProject } from '../../api/projects';
import { attempt } from '../../api/use-load';
import { ProjectForm, toRequest } from './ProjectForm';

/**
 * Create Project flow. Chunk 06 builds step 1 (Details) only.
 * SEAM: Chunk 07 adds 'boq' (an estimate per cost head, running total) and 'review' to
 * CREATE_PROJECT_STEPS and renders them after Details, using the project id step 1 returns.
 */
export const CREATE_PROJECT_STEPS = [{ key: 'details', label: 'Details' }] as const;

export function CreateProjectPage() {
  return (
    <section className="panel narrow">
      <div className="toolbar">
        <h1>New project</h1>
        <ol className="steps" aria-label="Steps">
          {CREATE_PROJECT_STEPS.map((s, i) => (
            <li key={s.key} className="active">
              {i + 1}. {s.label}
            </li>
          ))}
        </ol>
      </div>
      <ProjectForm
        project={null}
        submitLabel="Create project"
        onSubmit={async (v) => {
          let id = '';
          const err = await attempt(async () => {
            id = (await createProject({ code: v.code, ...toRequest(v) })).id;
          });
          if (!err) window.location.hash = `#/projects/${id}`;
          return err;
        }}
      />
    </section>
  );
}
