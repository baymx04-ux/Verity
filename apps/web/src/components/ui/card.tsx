import { type HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevation?: 'flat' | 'raised';
}

export function Card({ elevation = 'raised', className = '', ...props }: CardProps) {
  const styles =
    elevation === 'raised'
      ? 'border border-line bg-surface shadow-xs'
      : 'border border-line bg-surface-container-low';

  return <div className={`rounded-card ${styles} ${className}`} {...props} />;
}

export function CardHeader({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`flex flex-col gap-1 border-b border-line px-6 py-4 ${className}`} {...props} />
  );
}

export function CardTitle({ className = '', ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={`font-display text-display-sm tracking-display ${className}`} {...props} />;
}

export function CardDescription({
  className = '',
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={`text-body-sm text-ink-500 ${className}`} {...props} />;
}

export function CardContent({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`px-6 py-5 ${className}`} {...props} />;
}

export function CardFooter({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`flex items-center justify-between gap-3 border-t border-line px-6 py-4 ${className}`}
      {...props}
    />
  );
}
