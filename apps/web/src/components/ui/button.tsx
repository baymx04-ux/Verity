import { type ButtonHTMLAttributes, forwardRef } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'subtle' | 'destructive';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-action text-white shadow-primary hover:-translate-y-px hover:bg-action-hover hover:shadow-primary-hover active:translate-y-px active:shadow-primary-pressed focus-visible:ring-2 focus-visible:ring-action-accent/40',
  secondary:
    'border border-line-strong bg-surface text-ink-800 shadow-xs hover:-translate-y-px hover:border-outline-variant hover:bg-surface-hover hover:shadow-card active:translate-y-px active:shadow-xs focus-visible:ring-2 focus-visible:ring-action-accent/30',
  subtle:
    'border border-line bg-surface-container-low text-ink-700 hover:bg-surface-container-high hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-action-accent/30',
  ghost:
    'text-ink-600 hover:bg-inset hover:text-ink-900 focus-visible:ring-2 focus-visible:ring-action-accent/30',
  destructive:
    'bg-danger text-white shadow-xs hover:-translate-y-px hover:brightness-95 active:translate-y-px focus-visible:ring-2 focus-visible:ring-danger/30',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-2.5 text-label-sm',
  md: 'h-10 gap-2 px-3.5 text-label-md',
  lg: 'h-11 gap-2 px-5 text-label-md',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', ...props }, ref) => (
    <button
      ref={ref}
      className={`inline-flex select-none items-center justify-center rounded-control font-medium transition-fluid disabled:pointer-events-none disabled:opacity-50 ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    />
  ),
);

Button.displayName = 'Button';
