import type { ReactNode } from 'react';
import {
  FolderKanban,
  Gauge,
  Hourglass,
  PiggyBank,
  Receipt,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { formatFils, formatUtilisation, type BudgetStatus } from '@boq/shared';
import { getDashboard } from '../api/dashboard';
import { useLoad } from '../api/use-load';
import { statusLabel } from '../components/format';
import { navigate } from '../components/navigate';
import { ErrorText } from '../components/SlideOver';
import { StatusDot } from '../components/StatusDot';

type Tone = 'primary' | 'success' | 'warning' | 'danger' | 'info';

/** Tile colour for a status the server decided. Display only. */
const TONE: Record<BudgetStatus, Tone> = {
  NORMAL: 'success',
  WARNING: 'warning',
  APPROVAL_REQUIRED: 'danger',
};

function Tile(props: {
  icon: LucideIcon;
  label: ReactNode;
  value: string;
  tone?: Tone;
  href?: string;
}) {
  const { icon: Icon, tone = 'primary' } = props;
  const body = (
    <>
      {/* jdk_erp's stat card: the label, then the figure, the icon at the side. */}
      <div className="tile-text">
        <div className="tile-label">{props.label}</div>
        <div className="tile-value">{props.value}</div>
      </div>
      <span className="tile-icon" aria-hidden="true">
        <Icon size={20} />
      </span>
    </>
  );
  const className = tone === 'primary' ? 'tile' : `tile tile-${tone}`;
  return props.href ? (
    <a className={className} href={props.href}>
      {body}
    </a>
  ) : (
    <div className={className}>{body}</div>
  );
}

function greeting(now = new Date()): string {
  const h = now.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

/**
 * Home: where is the money going, and where do I act? Every figure and status is the server's.
 * Looks like the Almailem roadmap UI's dashboard: greeting banner, figure tiles, then the table.
 */
export function DashboardPage(props: { userName?: string }) {
  const { data, error } = useLoad(getDashboard);
  const first = props.userName?.trim().split(/\s+/)[0] ?? '';
  return (
    <div className="page">
      <section className="hero">
        <div>
          <p className="greeting">
            {greeting()}
            {first && `, ${first}`}
          </p>
          <h1>Dashboard</h1>
          <p className="sub">Budget and spend across your projects.</p>
        </div>
        {first && <span className="avatar-lg">{first.charAt(0).toUpperCase()}</span>}
      </section>

      <ErrorText message={error} />
      {data && (
        <>
          <div className="tiles" role="group" aria-label="Portfolio figures">
            <Tile
              icon={Wallet}
              label="Budget (KWD)"
              value={formatFils(data.summary.metrics.budget)}
              tone="info"
            />
            <Tile
              icon={Receipt}
              label="Actual (KWD)"
              value={formatFils(data.summary.metrics.actual)}
            />
            <Tile
              icon={PiggyBank}
              label="Remaining (KWD)"
              value={formatFils(data.summary.metrics.remaining)}
              tone={data.summary.metrics.remaining < 0 ? 'danger' : 'success'}
            />
            <Tile
              icon={Gauge}
              label={
                <>
                  Used · <StatusDot status={data.summary.status} />
                </>
              }
              value={formatUtilisation(data.summary.metrics.utilisationBp)}
              tone={TONE[data.summary.status]}
            />
            <Tile
              icon={FolderKanban}
              label="Projects"
              value={String(data.summary.projects)}
              href="#/projects"
            />
            <Tile
              icon={Hourglass}
              label="Pending approvals"
              value={String(data.summary.pendingApprovals)}
              tone={data.summary.pendingApprovals > 0 ? 'warning' : 'success'}
              href="#/approvals"
            />
          </div>

          <section className="panel">
            <div className="card-header">
              <h2>Projects</h2>
              <span className="muted">{data.projects.length}</span>
              <span className="spacer" />
              <a href="#/projects">View all</a>
            </div>
            <div className="table-scroll">
              <table className="table money">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th className="num">Budget</th>
                    <th className="num">Actual</th>
                    <th className="num">Remaining</th>
                    <th className="num">Used</th>
                    <th>Status</th>
                    <th className="num">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {data.projects.map((p) => (
                    <tr
                      key={p.id}
                      className="clickable"
                      onClick={() => navigate(`#/projects/${p.id}`)}
                    >
                      <td className="name" title={`${p.systemNo} · ${p.name}`}>
                        {p.systemNo} · {p.name}{' '}
                        <span className="tag muted">{statusLabel(p.projectStatus)}</span>
                      </td>
                      <td className="num">{formatFils(p.metrics.budget)}</td>
                      <td className="num">{formatFils(p.metrics.actual)}</td>
                      <td className={p.metrics.remaining < 0 ? 'num negative' : 'num'}>
                        {formatFils(p.metrics.remaining)}
                      </td>
                      <td className="num">{formatUtilisation(p.metrics.utilisationBp)}</td>
                      <td>
                        <StatusDot status={p.status} />
                      </td>
                      <td className="num">
                        <a href={`#/projects/${p.id}`} aria-label={`Open ${p.systemNo}`}>
                          Open
                        </a>
                      </td>
                    </tr>
                  ))}
                  {data.projects.length === 0 && (
                    <tr>
                      <td colSpan={7} className="muted">
                        No projects yet
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
