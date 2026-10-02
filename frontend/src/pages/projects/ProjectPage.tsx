import { useCallback, useState, type FormEvent } from 'react';
import { formatFils, type BoqRow, type ProjectDetail } from '@boq/shared';
import { getBoq, setEstimates } from '../../api/estimates';
import {
  addMember,
  changeProjectStatus,
  deleteProject,
  getProject,
  listMembers,
  removeMember,
  updateProject,
} from '../../api/projects';
import { attempt, useLoad } from '../../api/use-load';
import { BoqTable } from '../../components/BoqTable';
import { formatDate, statusLabel } from '../../components/format';
import { parseKwdInput } from '../../components/kwd';
import { navigate } from '../../components/navigate';
import { ErrorText, SlideOver } from '../../components/SlideOver';
import { UserPicker } from '../../components/UserPicker';
import { ProjectForm, toRequest } from './ProjectForm';

type Tab = 'boq' | 'details' | 'members';
const TABS: { key: Tab; label: string }[] = [
  { key: 'boq', label: 'BoQ' },
  { key: 'details', label: 'Details' },
  { key: 'members', label: 'Members' },
];

/** Project page: header, status actions, and the BoQ, Details and Members tabs. */
export function ProjectPage(props: { id: string }) {
  const { id } = props;
  const project = useLoad(useCallback(() => getProject(id), [id]));
  const [tab, setTab] = useState<Tab>('boq');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const closeEdit = useCallback(() => setEditing(false), []);

  const p = project.data;
  if (!p) return <ErrorText message={project.error} />;

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(await attempt(action));
    setBusy(false);
    project.reload();
  };

  return (
    <section className="panel">
      <div className="toolbar">
        <a href="#/projects" className="muted">
          Projects
        </a>
        <span className="muted">/</span>
        <h1>
          {p.code} · {p.name}
        </h1>
        <span className="tag">{statusLabel(p.status)}</span>
        <span className="spacer" />
        {p.nextStatuses.map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => run(() => changeProjectStatus(p.id, s))}
          >
            Mark {statusLabel(s).toLowerCase()}
          </button>
        ))}
        <button type="button" onClick={() => setEditing(true)}>
          Edit
        </button>
      </div>
      <ErrorText message={error} />

      <nav className="tabs" aria-label="Project sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={tab === t.key ? 'active' : undefined}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'boq' && <Boq projectId={p.id} />}
      {tab === 'details' && <Details project={p} />}
      {tab === 'members' && <Members projectId={p.id} />}

      {editing && (
        <SlideOver title="Edit project" onClose={closeEdit}>
          <ProjectForm
            project={p}
            submitLabel="Save"
            onSubmit={async (v) => {
              const err = await attempt(() => updateProject(p.id, toRequest(v)));
              if (!err) {
                closeEdit();
                project.reload();
              }
              return err;
            }}
          />
          <hr />
          <button
            type="button"
            className="btn-danger"
            onClick={async () => {
              if (!window.confirm(`Delete ${p.code}? It disappears for everyone.`)) return;
              const err = await attempt(() => deleteProject(p.id));
              if (err) setError(err);
              else navigate('#/projects');
              closeEdit();
            }}
          >
            Delete project
          </button>
        </SlideOver>
      )}
    </section>
  );
}

function Boq(props: { projectId: string }) {
  const { projectId } = props;
  const boq = useLoad(useCallback(() => getBoq(projectId), [projectId]));
  const [editing, setEditing] = useState<BoqRow | null>(null);
  const close = useCallback(() => setEditing(null), []);
  if (!boq.data) return <ErrorText message={boq.error} />;
  return (
    <>
      <BoqTable boq={boq.data} onEdit={setEditing} />
      {editing && (
        <SlideOver title={`Budget: ${editing.costHead.code}`} onClose={close}>
          <BudgetForm
            projectId={projectId}
            row={editing}
            onSaved={() => {
              close();
              boq.reload();
            }}
          />
        </SlideOver>
      )}
    </>
  );
}

function BudgetForm(props: { projectId: string; row: BoqRow; onSaved: () => void }) {
  const { row } = props;
  const [text, setText] = useState(row.metrics.budget === 0 ? '' : formatFils(row.metrics.budget));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const amount = parseKwdInput(text);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (amount === null) return;
    setBusy(true);
    const err = await attempt(() =>
      setEstimates(props.projectId, {
        estimates: [{ costHeadId: row.costHead.id, amountFils: amount }],
      }),
    );
    setBusy(false);
    if (err) setError(err);
    else props.onSaved();
  };

  return (
    <form className="form" onSubmit={submit}>
      <p>{row.costHead.name}</p>
      <label>
        Budget (KWD)
        <input
          className={amount === null ? 'amount invalid' : 'amount'}
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <ErrorText message={error ?? (amount === null ? 'Enter an amount of zero or more' : null)} />
      <button className="btn-primary" type="submit" disabled={busy || amount === null}>
        Save budget
      </button>
    </form>
  );
}

function Details(props: { project: ProjectDetail }) {
  const p = props.project;
  return (
    <dl className="facts wide">
      <dt>Code</dt>
      <dd>{p.code}</dd>
      <dt>Owner</dt>
      <dd>{p.ownerName}</dd>
      <dt>Start</dt>
      <dd>{formatDate(p.startDate) || '—'}</dd>
      <dt>End</dt>
      <dd>{formatDate(p.endDate) || '—'}</dd>
      <dt>Description</dt>
      <dd className="prewrap">{p.description ?? '—'}</dd>
    </dl>
  );
}

function Members(props: { projectId: string }) {
  const { projectId } = props;
  const members = useLoad(useCallback(() => listMembers(projectId), [projectId]));
  const [userId, setUserId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(await attempt(action));
    setBusy(false);
    members.reload();
  };
  const present = new Set(members.data?.map((m) => m.id));

  return (
    <div>
      <ErrorText message={error ?? members.error} />
      <table className="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role in project</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {members.data?.map((m) => (
            <tr key={m.id}>
              <td>{m.name}</td>
              <td>{m.email}</td>
              <td className="muted">
                {m.isOwner ? 'Owner' : m.removable ? 'Member' : 'Administrator'}
              </td>
              <td className="num">
                {m.removable && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => removeMember(projectId, m.id))}
                  >
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row add-member">
        <UserPicker label="Person to add" value={userId} onChange={setUserId} exclude={present} />
        <button
          type="button"
          disabled={busy || !userId}
          onClick={() =>
            run(async () => {
              await addMember(projectId, userId);
              setUserId('');
            })
          }
        >
          Add member
        </button>
      </div>
    </div>
  );
}
