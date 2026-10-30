import { FileText, MessageSquareText, ShieldCheck } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';

import { useAuth } from '../../features/auth/use-auth';
import { EnvironmentBadge } from './environment-badge';
import { OnlineStatusBanner } from './online-status-banner';
import { UserMenu } from './user-menu';

interface NavItem {
  to: string;
  label: string;
  icon: typeof MessageSquareText;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/chat', label: 'Chat', icon: MessageSquareText },
  { to: '/documents', label: 'Documents', icon: FileText },
  { to: '/admin', label: 'Admin', icon: ShieldCheck, adminOnly: true },
];

function useNavItems(): NavItem[] {
  const { user } = useAuth();
  return NAV_ITEMS.filter((item) => !item.adminOnly || user?.role === 'admin');
}

export function AppShell() {
  const items = useNavItems();

  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink-900">
      <OnlineStatusBanner />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:bg-surface focus:px-4 focus:py-2 focus:text-label-md focus:text-action focus:shadow-dropdown"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1500px] items-center gap-4 px-4 sm:px-6 lg:px-8">
          <NavLink
            to="/chat"
            className="flex shrink-0 items-center gap-2.5 rounded-control focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-accent/30"
          >
            <img
              src="/verity-logo.png"
              alt="Verity"
              className="size-8"
            />
            <span className="leading-tight">
              <span className="block font-display text-[17px] font-semibold tracking-[-0.02em] text-ink-900">
                Verity
              </span>
              <span className="hidden text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-400 sm:block">
                Knowledge, verified
              </span>
            </span>
          </NavLink>

          <nav aria-label="Primary" className="ml-2 hidden md:block">
            <div className="inline-flex items-center gap-1 rounded-control border border-line bg-inset p-1">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `inline-flex items-center gap-2 rounded-[6px] px-3 py-1.5 text-label-md transition-colors ${
                      isActive
                        ? 'bg-surface text-ink-900 shadow-xs'
                        : 'text-ink-500 hover:text-ink-700'
                    }`
                  }
                >
                  <item.icon aria-hidden="true" className="size-4" />
                  {item.label}
                </NavLink>
              ))}
            </div>
          </nav>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <span className="hidden sm:inline-flex">
              <EnvironmentBadge />
            </span>
            <UserMenu />
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1 pb-20 md:pb-0">
        <Outlet />
      </main>

      <footer className="hidden border-t border-line bg-surface/60 md:block">
        <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-2 px-6 py-4 text-body-sm text-ink-500 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <span>Verity · local demo environment</span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span>Grounded answers, cited sources</span>
            <span aria-hidden="true" className="hidden size-1 rounded-full bg-ink-400 sm:block" />
            <span>Nothing here invents an answer</span>
          </span>
        </div>
      </footer>

      <nav
        aria-label="Mobile primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <div className="mx-auto flex max-w-md items-stretch justify-around px-2">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex min-w-20 flex-col items-center gap-1 px-3 py-2.5 text-[11px] font-medium transition-colors ${
                  isActive ? 'text-action' : 'text-ink-500'
                }`
              }
            >
              <item.icon aria-hidden="true" className="size-5" />
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
