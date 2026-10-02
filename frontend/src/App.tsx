import { useEffect, useState, type ReactNode } from 'react';
import type { SessionInfo } from '@boq/shared';
import { fetchSession, logout } from './api/auth';
import { Shell } from './components/Shell';
import { LoginPage } from './pages/LoginPage';
import { ApprovalRulesPage } from './pages/admin/ApprovalRulesPage';
import { ApprovalsPage } from './pages/ApprovalsPage';
import { DashboardPage } from './pages/DashboardPage';
import { CostHeadsPage } from './pages/admin/CostHeadsPage';
import { CostHeadPage } from './pages/expenses/CostHeadPage';
import { RolesPage } from './pages/admin/RolesPage';
import { UsersPage } from './pages/admin/UsersPage';
import { CreateProjectPage } from './pages/projects/CreateProjectPage';
import { ProjectPage } from './pages/projects/ProjectPage';
import { ProjectsPage } from './pages/projects/ProjectsPage';

/** Map a location hash to the page to show and the nav entry to highlight. */
function resolve(hash: string, userName: string): { nav: string; page: ReactNode } {
  const setup = /^#\/projects\/([0-9a-f-]{36})\/setup\/(boq|review)$/i.exec(hash);
  if (setup)
    return {
      nav: '#/projects',
      page: (
        <CreateProjectPage projectId={setup[1] as string} step={setup[2] as 'boq' | 'review'} />
      ),
    };
  const head = /^#\/projects\/([0-9a-f-]{36})\/heads\/([0-9a-f-]{36})$/i.exec(hash);
  if (head)
    return {
      nav: '#/projects',
      page: (
        <CostHeadPage key={hash} projectId={head[1] as string} costHeadId={head[2] as string} />
      ),
    };
  const project = /^#\/projects\/([0-9a-f-]{36})$/i.exec(hash);
  if (project)
    return { nav: '#/projects', page: <ProjectPage key={project[1]} id={project[1] as string} /> };
  switch (hash) {
    case '#/projects/new':
      return { nav: '#/projects', page: <CreateProjectPage /> };
    case '#/projects':
      return { nav: hash, page: <ProjectsPage /> };
    case '#/approvals':
      return { nav: hash, page: <ApprovalsPage /> };
    case '#/admin/users':
      return { nav: hash, page: <UsersPage /> };
    case '#/admin/roles':
      return { nav: hash, page: <RolesPage /> };
    case '#/admin/cost-heads':
      return { nav: hash, page: <CostHeadsPage /> };
    case '#/admin/approval-rules':
      return { nav: hash, page: <ApprovalRulesPage /> };
    default:
      return { nav: '#/dashboard', page: <DashboardPage userName={userName} /> };
  }
}

function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

/** Application: session, then the page inside the shell. No business logic lives here. */
export function App() {
  // undefined = still checking, null = signed out
  const [session, setSession] = useState<SessionInfo | null | undefined>(undefined);
  const { nav, page } = resolve(useHash(), session?.user.name ?? '');

  useEffect(() => {
    fetchSession().then(setSession, () => setSession(null));
  }, []);

  if (session === undefined) return null; // checking the session: show nothing rather than flash the sign-in
  if (session === null) return <LoginPage onSignedIn={setSession} />;
  return (
    <Shell
      active={nav}
      userName={session.user.name}
      onSignOut={() => void logout().finally(() => setSession(null))}
    >
      {page}
    </Shell>
  );
}
