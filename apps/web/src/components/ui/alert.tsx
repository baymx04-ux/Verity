import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { type HTMLAttributes, type ReactNode } from 'react';

type AlertVariant = 'info' | 'success' | 'warning' | 'danger';

interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  variant?: AlertVariant;
  title?: string;
  children?: ReactNode;
}

const styles: Record<AlertVariant, { container: string; icon: ReactNode }> = {
  info: {
    container: 'border-action-soft bg-action-tint text-action',
    icon: <Info aria-hidden="true" className="size-4" />,
  },
  success: {
    container: 'border-verified-border bg-verified-bg text-verified-text',
    icon: <CheckCircle2 aria-hidden="true" className="size-4" />,
  },
  warning: {
    container: 'border-warning-border bg-warning-bg text-warning-text',
    icon: <AlertTriangle aria-hidden="true" className="size-4" />,
  },
  danger: {
    container: 'border-danger-border bg-danger-bg text-danger-text',
    icon: <XCircle aria-hidden="true" className="size-4" />,
  },
};

export function Alert({ variant = 'info', title, children, className = '', ...props }: AlertProps) {
  const style = styles[variant];

  return (
    <div
      role={variant === 'danger' ? 'alert' : 'status'}
      className={`flex gap-3 rounded-nested border p-4 ${style.container} ${className}`}
      {...props}
    >
      <span className="mt-0.5 shrink-0">{style.icon}</span>
      <div className="min-w-0 space-y-1">
        {title ? <p className="text-label-md font-semibold">{title}</p> : null}
        {children ? (
          <div className="text-body-sm leading-[1.35rem] opacity-90">{children}</div>
        ) : null}
      </div>
    </div>
  );
}
