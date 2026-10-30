import { FileText, MessageSquareText, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';

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

function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  return isOnline;
}

export function AppShell() {
  const items = useNavItems();
  const isOnline = useOnlineStatus();
  const location = useLocation();
  const isChat = location.pathname.startsWith('/chat');

  return (
    <div className="app-canvas flex min-h-screen flex-col text-ink-700">
      <OnlineStatusBanner />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-control focus:border focus:border-action-border focus:bg-surface focus:px-4 focus:py-2 focus:text-body-sm focus:text-action focus:shadow-elevated"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-line/80 bg-surface/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <NavLink
            to="/chat"
            aria-label="Verity home"
            className="flex shrink-0 items-center gap-2.5 rounded-control py-1 pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-accent/30"
          >
            <img
              src="/verity-logo.png"
              alt=""
              className="size-9 rounded-[10px] border border-line bg-surface object-contain shadow-xs"
            />
            <span className="leading-tight">
              <span className="block font-display text-[15px] font-semibold tracking-[-0.02em] text-ink-900">
                Verity
              </span>
              <span className="hidden text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-400 sm:block">
                Enterprise knowledge
              </span>
            </span>
          </NavLink>

          <nav aria-label="Primary" className="ml-2 hidden md:block">
            <div className="inline-flex items-center gap-0.5 rounded-control border border-line bg-canvas-subtle p-1 shadow-inset">
              {items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-label-sm transition-fluid ${
                      isActive
                        ? 'border border-action-border bg-surface text-action shadow-xs'
                        : 'border border-transparent text-ink-500 hover:bg-surface/70 hover:text-ink-900'
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
            <span
              className="hidden items-center gap-2 rounded-full border border-line bg-surface px-3 py-1.5 text-[11px] font-medium text-ink-600 shadow-xs lg:inline-flex"
              title={isOnline ? 'Your browser is connected' : 'Your browser is offline'}
            >
              <span
                aria-hidden="true"
                className={`size-1.5 rounded-full ${
                  isOnline ? 'bg-verified animate-pulse-soft' : 'bg-danger'
                }`}
              />
              {isOnline ? 'Workspace online' : 'Offline'}
            </span>
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

      <footer
        className={`border-t border-line bg-surface/60 ${isChat ? 'hidden' : 'hidden md:block'}`}
      >
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-2 px-6 py-4 text-body-sm text-ink-500 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <span className="flex items-center gap-2">
            <img src="/verity-logo.png" alt="" className="size-4 rounded-[4px] opacity-80" />
            Verity · grounded enterprise knowledge
          </span>
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
            <span>Every answer cites its sources</span>
            <span
              aria-hidden="true"
              className="hidden size-1 rounded-full bg-line-strong sm:block"
            />
            <span>Read-only data queries</span>
            <span
              aria-hidden="true"
              className="hidden size-1 rounded-full bg-line-strong sm:block"
            />
            <span>© 2026 Verity</span>
          </span>
        </div>
      </footer>

      <nav
        aria-label="Mobile primary"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
      >
        <div className="mx-auto flex max-w-md items-stretch justify-around px-2">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex min-w-20 flex-col items-center gap-1 px-3 py-2.5 text-[11px] font-medium transition-fluid ${
                  isActive ? 'text-action' : 'text-ink-500'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`flex size-8 items-center justify-center rounded-control transition-fluid ${
                      isActive ? 'bg-action-tint' : ''
                    }`}
                  >
                    <item.icon aria-hidden="true" className="size-[18px]" />
                  </span>
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
