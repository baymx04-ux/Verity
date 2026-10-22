import { LogOut, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '../../features/auth/use-auth';
import { Avatar } from '../ui/avatar';
import { Badge } from '../ui/badge';
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from '../ui/dropdown-menu';

function displayName(firstName?: string | null, lastName?: string | null, email?: string): string {
  const full = [firstName, lastName].filter(Boolean).join(' ').trim();
  if (full) {
    return full;
  }
  return email?.split('@')[0] ?? 'User';
}

export function UserMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) {
    return null;
  }

  const name = displayName(user.firstName, user.lastName, user.email);

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <DropdownMenu
      label="Account menu"
      trigger={(props) => (
        <button
          type="button"
          {...props}
          className="flex items-center gap-2.5 rounded-control border border-transparent py-1 pl-1 pr-2 text-left transition-colors hover:border-line hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-accent/30"
        >
          <Avatar name={name} email={user.email} size="md" />
          <span className="hidden min-w-0 leading-tight lg:block">
            <span className="block max-w-36 truncate text-label-md text-ink-900">{name}</span>
            <span className="block max-w-36 truncate text-body-sm text-ink-500">{user.email}</span>
          </span>
        </button>
      )}
    >
      <div className="px-3 py-2">
        <p className="truncate text-label-md text-ink-900">{name}</p>
        <p className="truncate text-body-sm text-ink-500">{user.email}</p>
        <div className="mt-2">
          <Badge variant="neutral">{user.role}</Badge>
        </div>
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem disabled>
        <UserRound aria-hidden="true" className="size-4" />
        Profile settings
        <span className="ml-auto text-body-sm text-ink-400">Later</span>
      </DropdownMenuItem>
      <DropdownMenuItem destructive onClick={() => void handleLogout()}>
        <LogOut aria-hidden="true" className="size-4" />
        Sign out
      </DropdownMenuItem>
    </DropdownMenu>
  );
}
