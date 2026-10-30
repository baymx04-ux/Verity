import type { ReactNode } from 'react';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-nested border border-dashed border-line-strong bg-canvas-subtle/70 px-6 py-10 text-center ${className}`}
    >
      {icon ? (
        <span className="mb-4 flex size-12 items-center justify-center rounded-[14px] border border-line bg-surface text-action shadow-card [&_svg]:size-5">
          {icon}
        </span>
      ) : null}
      <p className="font-display text-display-sm text-ink-900">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-sm text-body-sm leading-relaxed text-ink-500">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
