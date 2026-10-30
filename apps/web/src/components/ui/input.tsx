import { type InputHTMLAttributes, forwardRef } from 'react';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => (
    <input
      ref={ref}
      className={`h-10 w-full rounded-control border border-line bg-surface px-3 text-body-md text-ink-900 shadow-inset placeholder:text-ink-400 transition-fluid hover:border-line-strong focus-visible:border-action-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-accent/20 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    />
  ),
);

Input.displayName = 'Input';
