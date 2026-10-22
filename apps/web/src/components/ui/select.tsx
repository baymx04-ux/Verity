import { ChevronDown } from 'lucide-react';
import { type SelectHTMLAttributes, forwardRef } from 'react';

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className = '', children, ...props }, ref) => (
    <span className={`relative inline-flex w-full ${className}`}>
      <select
        ref={ref}
        className="h-10 w-full appearance-none rounded-control border border-line bg-surface pl-3 pr-9 text-body-md text-ink-900 shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-accent/30 disabled:cursor-not-allowed disabled:opacity-50"
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-500"
      />
    </span>
  ),
);

Select.displayName = 'Select';
