import { type ButtonHTMLAttributes, forwardRef } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'subtle' | 'destructive';
type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-action text-white shadow-xs hover:bg-action-hover focus-visible:ring-2 focus-visible:ring-action-accent/40',
  secondary:
    'border border-line-strong bg-surface text-ink-900 hover:bg-inset focus-visible:ring-2 focus-visible:ring-action-accent/30',
  subtle:
    'border border-line bg-surface-container-low text-ink-700 hover:bg-surface-container focus-visible:ring-2 focus-visible:ring-action-accent/30',
  ghost: 'text-ink-700 hover:bg-inset focus-visible:ring-2 focus-visible:ring-action-accent/30',
  destructive:
    'bg-danger text-white hover:brightness-95 focus-visible:ring-2 focus-visible:ring-danger/30',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-label-sm',
  md: 'h-10 px-3.5 text-label-md',
  lg: 'h-11 px-5 text-label-md',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className = '', ...props }, ref) => (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center gap-2 rounded-control font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    />
  ),
);

Button.displayName = 'Button';
