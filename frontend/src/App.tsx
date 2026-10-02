import { useEffect, useState, type ReactNode } from 'react';
import type { SessionInfo } from '@boq/shared';
import { fetchSession, logout } from './api/auth';
import { LoginPage } from './pages/LoginPage';
import { CostHeadsPage } from './pages/admin/CostHeadsPage';
import { RolesPage } from './pages/admin/RolesPage';
import { UsersPage } from './pages/admin/UsersPage';
import { CreateProjectPage } from './pages/projects/CreateProjectPage';
import { ProjectPage } from './pages/projects/ProjectPage';
import { ProjectsPage } from './pages/projects/ProjectsPage';

/** Top navigation. Projects first; Administration pages after. */
const NAV = [
  { href: '#/projects', label: 'Projects' },
  { href: '#/admin/users', label: 'Users' },
  { href: '#/admin/roles', label: 'Roles' },
  { href: '#/admin/cost-heads', label: 'Cost heads' },
] as const;

/** Map a location hash to the page to show and the nav entry to highlight. */
function resolve(hash: string): { nav: string; page: ReactNode } {
  const setup = /^#\/projects\/([0-9a-f-]{36})\/setup\/(boq|review)$/i.exec(hash);
  if (setup)
    return {
      nav: '#/projects',
      page: (
        <CreateProjectPage projectId={setup[1] as string} step={setup[2] as 'boq' | 'review'} />
      ),
    };
  const project = /^#\/projects\/([0-9a-f-]{36})$/i.exec(hash);
  if (project)
    return { nav: '#/projects', page: <ProjectPage key={project[1]} id={project[1] as string} /> };
  switch (hash) {
    case '#/projects/new':
      return { nav: '#/projects', page: <CreateProjectPage /> };
    case '#/admin/users':
      return { nav: hash, page: <UsersPage /> };
    case '#/admin/roles':
      return { nav: hash, page: <RolesPage /> };
    case '#/admin/cost-heads':
      return { nav: hash, page: <CostHeadsPage /> };
    default:
      return { nav: '#/projects', page: <ProjectsPage /> };
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

/** Application shell: session, navigation, page. No business logic lives here. */
export function App() {
  // undefined = still checking, null = signed out
  const [session, setSession] = useState<SessionInfo | null | undefined>(undefined);
  const { nav, page } = resolve(useHash());

  useEffect(() => {
    fetchSession().then(setSession, () => setSession(null));
  }, []);

  return (
    <div className="shell">
      <header className="shell-header">
        <span className="brand">Almailem BoQ Manager</span>
        {session && (
          <>
            <nav className="nav" aria-label="Main">
              {NAV.map((n) => (
                <a key={n.href} href={n.href} className={n.href === nav ? 'active' : undefined}>
                  {n.label}
                </a>
              ))}
            </nav>
            <span className="spacer" />
            <span className="muted">{session.user.name}</span>
            <button
              type="button"
              className="btn-link"
              onClick={() => logout().finally(() => setSession(null))}
            >
              Sign out
            </button>
          </>
        )}
      </header>
      <main className="shell-main">
        {session === null && <LoginPage onSignedIn={setSession} />}
        {session && page}
      </main>
    </div>
  );
}
