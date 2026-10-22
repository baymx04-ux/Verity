import { type InputHTMLAttributes, forwardRef } from 'react';

export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={`size-[18px] cursor-pointer rounded-[4px] border border-line-strong bg-surface accent-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-accent/30 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    />
  ),
);

Checkbox.displayName = 'Checkbox';

export const Radio = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => (
    <input
      ref={ref}
      type="radio"
      className={`size-[18px] cursor-pointer border border-line-strong bg-surface accent-action focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-accent/30 disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    />
  ),
);

Radio.displayName = 'Radio';
