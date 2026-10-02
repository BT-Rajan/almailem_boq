import { useEffect, useState } from 'react';
import type { SessionInfo } from '@boq/shared';
import { fetchSession, logout } from './api/auth';
import { LoginPage } from './pages/LoginPage';
import { RolesPage } from './pages/admin/RolesPage';
import { UsersPage } from './pages/admin/UsersPage';

const PAGES = {
  '#/admin/users': { label: 'Users', Page: UsersPage },
  '#/admin/roles': { label: 'Roles', Page: RolesPage },
} as const;
type Route = keyof typeof PAGES;

const routeOf = (hash: string): Route => (hash in PAGES ? (hash as Route) : '#/admin/users');

function useHashRoute(): Route {
  const [route, setRoute] = useState(() => routeOf(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(routeOf(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/** Application shell: session, navigation, page. No business logic lives here. */
export function App() {
  // undefined = still checking, null = signed out
  const [session, setSession] = useState<SessionInfo | null | undefined>(undefined);
  const route = useHashRoute();

  useEffect(() => {
    fetchSession().then(setSession, () => setSession(null));
  }, []);

  const { Page } = PAGES[route];
  return (
    <div className="shell">
      <header className="shell-header">
        <span className="brand">Almailem BoQ Manager</span>
        {session && (
          <>
            <nav className="nav" aria-label="Administration">
              {Object.entries(PAGES).map(([href, p]) => (
                <a key={href} href={href} className={href === route ? 'active' : undefined}>
                  {p.label}
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
        {session && <Page />}
      </main>
    </div>
  );
}
