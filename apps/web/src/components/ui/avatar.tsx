interface AvatarProps {
  name?: string | null;
  email?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

function initials(name: string | null | undefined): string {
  const source = name?.trim() || '';
  if (!source) {
    return '';
  }

  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

const sizes = {
  sm: 'size-7 text-[10px]',
  md: 'size-9 text-xs',
  lg: 'size-12 text-sm',
} as const;

export function Avatar({ name, email, size = 'md', className = '' }: AvatarProps) {
  const label = name?.trim() || email?.split('@')[0] || 'User';
  const value = initials(name) || label.charAt(0).toUpperCase();

  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full border border-line bg-action-soft font-semibold uppercase tracking-[0.02em] text-action ${sizes[size]} ${className}`}
    >
      {value}
    </span>
  );
}
