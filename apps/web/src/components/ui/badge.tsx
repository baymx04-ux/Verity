import { type HTMLAttributes } from 'react';

type BadgeVariant =
  'neutral' | 'verified' | 'warning' | 'danger' | 'info' | 'live' | 'analyst' | 'restricted';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  dot?: boolean;
}

const styles: Record<BadgeVariant, string> = {
  neutral: 'border-line bg-inset text-ink-600',
  verified: 'border-verified-border bg-verified-bg text-verified-text',
  warning: 'border-warning-border bg-warning-bg text-warning-text',
  danger: 'border-danger-border bg-danger-bg text-danger-text',
  info: 'border-action-border bg-action-tint text-action',
  live: 'border-verified-border bg-verified-bg text-verified-text',
  analyst: 'border-action-border bg-action-tint text-action',
  restricted: 'border-warning-border bg-warning-bg text-warning-text',
};

const dotStyles: Record<BadgeVariant, string> = {
  neutral: 'bg-ink-400',
  verified: 'bg-verified',
  warning: 'bg-warning',
  danger: 'bg-danger',
  info: 'bg-action-accent',
  live: 'bg-verified',
  analyst: 'bg-action-accent',
  restricted: 'bg-warning',
};

export function Badge({
  variant = 'neutral',
  dot = false,
  className = '',
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase leading-none tracking-[0.04em] ${styles[variant]} ${className}`}
      {...props}
    >
      {dot ? (
        <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${dotStyles[variant]}`} />
      ) : null}
      {children}
    </span>
  );
}
