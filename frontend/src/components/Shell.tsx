import { useEffect, useState, type ReactNode } from 'react';
import {
  ClipboardCheck,
  FolderKanban,
  LayoutDashboard,
  ListTree,
  LogOut,
  Menu,
  ShieldCheck,
  SlidersHorizontal,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Brand, BrandMark } from './BrandMark';
import { GlobalSearch } from './GlobalSearch';

type NavItem = { href: string; label: string; icon: LucideIcon };

/** Navigation: daily work first, Administration after. The server enforces access. */
export const NAV: { group: string | null; items: NavItem[] }[] = [
  {
    group: null,
    items: [
      { href: '#/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { href: '#/projects', label: 'Projects', icon: FolderKanban },
      { href: '#/approvals', label: 'Approvals', icon: ClipboardCheck },
    ],
  },
  {
    group: 'Administration',
    items: [
      { href: '#/admin/users', label: 'Users', icon: Users },
      { href: '#/admin/roles', label: 'Roles', icon: ShieldCheck },
      { href: '#/admin/cost-heads', label: 'Cost heads', icon: ListTree },
      { href: '#/admin/approval-rules', label: 'Approval rules', icon: SlidersHorizontal },
    ],
  },
];

function NavLinks(props: { active: string; onNavigate?: () => void }) {
  return (
    <nav className="side-nav" aria-label="Main">
      {NAV.map((section) => (
        <div key={section.group ?? 'main'}>
          {section.group && <div className="side-nav-group">{section.group}</div>}
          {section.items.map(({ href, label, icon: Icon }) => (
            <a
              key={href}
              href={href}
              className={href === props.active ? 'active' : undefined}
              aria-current={href === props.active ? 'page' : undefined}
              onClick={props.onNavigate}
            >
              <Icon size={20} aria-hidden="true" />
              {label}
            </a>
          ))}
        </div>
      ))}
    </nav>
  );
}

/**
 * The signed-in frame: sidebar on wide screens, a menu drawer otherwise, and a top bar with search
 * and the user. Layout only; pages bring their own content.
 */
export function Shell(props: {
  active: string;
  userName: string;
  onSignOut: () => void;
  children: ReactNode;
}) {
  const [drawer, setDrawer] = useState(false);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Brand />
        </div>
        <NavLinks active={props.active} />
      </aside>

      {drawer && (
        <>
          <div className="drawer-backdrop" onClick={() => setDrawer(false)} />
          <aside className="drawer" role="dialog" aria-label="Menu">
            <div className="sidebar-brand">
              <Brand />
              <span className="spacer" />
              <button
                type="button"
                className="icon-button"
                aria-label="Close menu"
                onClick={() => setDrawer(false)}
              >
                <X size={20} />
              </button>
            </div>
            <NavLinks active={props.active} onNavigate={() => setDrawer(false)} />
          </aside>
        </>
      )}

      <div className="shell-body">
        <header className="topbar">
          <button
            type="button"
            className="icon-button menu-button"
            aria-label="Open menu"
            onClick={() => setDrawer(true)}
          >
            <Menu size={20} />
          </button>
          <span className="topbar-brand">
            <BrandMark size={32} />
          </span>
          <GlobalSearch />
          <span className="spacer" />
          <span className="user-chip">
            <span className="avatar" aria-hidden="true">
              {props.userName.trim().charAt(0).toUpperCase()}
            </span>
            <span className="user-name">{props.userName}</span>
          </span>
          <button
            type="button"
            className="icon-button"
            aria-label="Sign out"
            title="Sign out"
            onClick={props.onSignOut}
          >
            <LogOut size={18} />
          </button>
        </header>
        <main className="shell-main">{props.children}</main>
      </div>
    </div>
  );
}
