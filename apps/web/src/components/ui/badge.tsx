import { type HTMLAttributes } from 'react';

type BadgeVariant =
  'neutral' | 'verified' | 'warning' | 'danger' | 'info' | 'live' | 'analyst' | 'restricted';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

const styles: Record<BadgeVariant, string> = {
  neutral: 'border border-line bg-inset text-ink-700',
  verified: 'border border-verified-border bg-verified-bg text-verified-text',
  warning: 'border border-warning-border bg-warning-bg text-warning-text',
  danger: 'border border-danger-border bg-danger-bg text-danger-text',
  info: 'border border-action-soft bg-action-tint text-action',
  live: 'border border-emerald-200/60 bg-emerald-50 text-emerald-700 font-medium',
  analyst: 'border border-sky-200/60 bg-sky-50 text-sky-700 font-medium',
  restricted: 'border border-rose-200/60 bg-rose-50 text-rose-700 font-medium',
};

export function Badge({ variant = 'neutral', className = '', ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-label-sm uppercase ${styles[variant]} ${className}`}
      {...props}
    />
  );
}
