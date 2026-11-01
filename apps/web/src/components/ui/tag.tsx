import { type HTMLAttributes } from 'react';

type TagVariant = 'neutral' | 'verified' | 'warning' | 'danger' | 'info' | 'analyst' | 'restricted';

interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: TagVariant;
}

const styles: Record<TagVariant, string> = {
  neutral: 'border border-line bg-inset text-ink-600',
  verified: 'border border-verified-border bg-verified-bg text-verified-text',
  warning: 'border border-warning-border bg-warning-bg text-warning-text',
  danger: 'border border-danger-border bg-danger-bg text-danger-text',
  info: 'border border-action-border bg-action-tint text-action',
  analyst: 'border border-action-border bg-action-tint text-action',
  restricted: 'border border-warning-border bg-warning-bg text-warning-text',
};

export function Tag({
  variant = 'neutral',
  className = '',
  children,
  ...props
}: TagProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[6px] border px-2 py-0.5 text-body-sm font-medium text-ink-900 leading-none ${styles[variant]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}
