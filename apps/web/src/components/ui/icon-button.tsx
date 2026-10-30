import { type ButtonHTMLAttributes, forwardRef } from 'react';

type IconButtonVariant = 'ghost' | 'secondary' | 'subtle';
type IconButtonSize = 'sm' | 'md';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  'aria-label': string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
}

const variantStyles: Record<IconButtonVariant, string> = {
  ghost: 'text-ink-500 hover:bg-inset hover:text-ink-900',
  secondary:
    'border border-line bg-surface text-ink-600 shadow-xs hover:border-line-strong hover:bg-surface-hover hover:text-ink-900',
  subtle: 'bg-surface-container-low text-ink-600 hover:bg-surface-container-high hover:text-ink-900',
};

const sizeStyles: Record<IconButtonSize, string> = {
  sm: 'size-8 [&_svg]:size-4',
  md: 'size-10 [&_svg]:size-5',
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ variant = 'ghost', size = 'md', className = '', type = 'button', ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={`inline-flex shrink-0 items-center justify-center rounded-control transition-fluid disabled:cursor-not-allowed disabled:opacity-50 ${variantStyles[variant]} ${sizeStyles[size]} ${className}`}
      {...props}
    />
  ),
);

IconButton.displayName = 'IconButton';
