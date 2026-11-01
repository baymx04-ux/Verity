import { type HTMLAttributes } from 'react';

type StatusVariant = 'online' | 'offline' | 'degraded' | 'syncing';

interface StatusTextProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: StatusVariant;
  label: string;
}

const statusStyles: Record<StatusVariant, string> = {
  online: 'bg-verified',
  offline: 'bg-danger',
  degraded: 'bg-warning',
  syncing: 'bg-action-accent',
};

export function StatusText({
  variant = 'online',
  label,
  className = '',
  ...props
}: StatusTextProps) {
  // Hide when everything is normal - only show actionable states
  if (variant === 'online') {
    return null;
  }

  return (
    <span
      className={`flex items-center gap-1 text-[10px] font-medium text-ink-600 ${className}`}
      {...props}
    >
      <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${statusStyles[variant]}`} />
      {label}
    </span>
  );
}
