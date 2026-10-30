import { type TextareaHTMLAttributes, forwardRef } from 'react';

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className = '', ...props }, ref) => (
  <textarea
    ref={ref}
    className={`min-h-24 w-full resize-y rounded-control border border-line bg-surface px-3 py-2.5 text-body-md text-ink-900 shadow-inset placeholder:text-ink-400 transition-fluid hover:border-line-strong focus-visible:border-action-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-accent/20 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
    {...props}
  />
));

Textarea.displayName = 'Textarea';
