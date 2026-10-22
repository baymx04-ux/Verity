import type { ReactNode } from 'react';

interface TooltipProps {
  label: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
}

export function Tooltip({ label, children, side = 'top' }: TooltipProps) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span
        role="tooltip"
        className={`pointer-events-none absolute left-1/2 z-30 w-max max-w-56 -translate-x-1/2 rounded-control border border-line-strong bg-surface px-2.5 py-1.5 text-body-sm text-ink-700 opacity-0 shadow-dropdown transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 ${
          side === 'top' ? 'bottom-[calc(100%+0.4rem)]' : 'top-[calc(100%+0.4rem)]'
        }`}
      >
        {label}
      </span>
    </span>
  );
}
