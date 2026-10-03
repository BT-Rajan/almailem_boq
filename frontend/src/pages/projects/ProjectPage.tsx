import { useCallback, useState } from 'react';
import { formatFils, type ProjectDetail } from '@boq/shared';
import { getCostStructure } from '../../api/cost-structure';
import { getBoq } from '../../api/estimates';
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
import { EstimateActualChart } from '../../components/EstimateActualChart';
import { Figures } from '../../components/Figures';
import { formatDate, statusLabel } from '../../components/format';
import { navigate } from '../../components/navigate';
import { ErrorText, SlideOver } from '../../components/SlideOver';
import { UserPicker } from '../../components/UserPicker';
import { ExpenseForm } from '../expenses/ExpenseForm';
import { ProjectForm, toRequest } from './ProjectForm';

type Tab = 'boq' | 'details' | 'members';
const TABS: { key: Tab; label: string }[] = [
  { key: 'boq', label: 'Summary' },
  { key: 'details', label: 'Details' },
  { key: 'members', label: 'Members' },
];

/** Project page: header, status actions, and the Summary, Details and Members tabs. */
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
          {p.systemNo} · {p.code} · {p.name}
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

/**
 * Where the project's budget stands. The figures above are always the approved budget; a
 * waiting request is shown here, never counted. Changes are proposed, not made (D31).
 */
function BudgetStatus(props: { projectId: string }) {
  const { projectId } = props;
  const s = useLoad(useCallback(() => getCostStructure(projectId), [projectId])).data;
  if (!s) return null;
  const latest = s.latest;
  const edit = `#/projects/${projectId}/setup/boq`;
  if (latest?.status === 'PENDING')
    return (
      <p className="notice pending" role="status">
        Budget {s.approved.length ? 'change' : ''} waiting for approval: proposed{' '}
        {formatFils(latest.proposedTotalFils)} KWD (approved {formatFils(s.approvedTotalFils)}), by{' '}
        {latest.requestedBy.name} on {formatDate(latest.requestedAt.slice(0, 10))}.
      </p>
    );
  return (
    <p
      className={latest?.status === 'REJECTED' ? 'notice rejected row' : 'notice row'}
      role="status"
    >
      <span>
        {latest?.status === 'REJECTED'
          ? `Last budget request rejected by ${latest.decidedBy?.name ?? ''}: ${latest.decisionComment ?? ''}`
          : s.approved.length
            ? `Budget approved: ${s.approved.length} cost heads, ${formatFils(s.approvedTotalFils)} KWD.`
            : 'No approved budget yet.'}
      </span>
      <span className="spacer" />
      {s.editable && (
        <a href={edit}>
          {latest?.status === 'REJECTED'
            ? 'Correct and resubmit'
            : s.approved.length
              ? 'Propose a change'
              : 'Set up budget'}
        </a>
      )}
    </p>
  );
}

function Boq(props: { projectId: string }) {
  const { projectId } = props;
  const [attentionFirst, setAttentionFirst] = useState(false);
  const boq = useLoad(
    useCallback(
      () => getBoq(projectId, attentionFirst ? 'attention' : 'display'),
      [projectId, attentionFirst],
    ),
  );
  const [adding, setAdding] = useState(false);
  const closeAdd = useCallback(() => setAdding(false), []);
  if (!boq.data) return <ErrorText message={boq.error} />;
  return (
    <>
      <Figures
        metrics={boq.data.total}
        status={boq.data.totalStatus}
        label="Project figures"
        totals
      />
      <div className="row boq-actions">
        <label className="check">
          <input
            type="checkbox"
            checked={attentionFirst}
            onChange={(e) => setAttentionFirst(e.target.checked)}
          />
          Needs attention first
        </label>
        <span className="spacer" />
        {boq.data.editable && (
          <button
            type="button"
            className="btn-primary primary-action"
            onClick={() => setAdding(true)}
          >
            Add expense
          </button>
        )}
      </div>
      <BudgetStatus projectId={projectId} />
      <BoqTable boq={boq.data} projectId={projectId} />
      <EstimateActualChart boq={boq.data} projectId={projectId} />
      {adding && (
        <SlideOver title="Add expense" onClose={closeAdd} sheet>
          <ExpenseForm
            projectId={projectId}
            onSaved={() => {
              closeAdd();
              boq.reload();
            }}
          />
        </SlideOver>
      )}
    </>
  );
}

function Details(props: { project: ProjectDetail }) {
  const p = props.project;
  return (
    <dl className="facts wide">
      <dt>Number</dt>
      <dd>{p.systemNo}</dd>
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
      <div className="table-scroll">
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
      </div>
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
