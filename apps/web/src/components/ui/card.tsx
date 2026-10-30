import { type HTMLAttributes } from 'react';

type CardElevation = 'flat' | 'raised' | 'elevated' | 'floating';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevation?: CardElevation;
}

const elevationStyles: Record<CardElevation, string> = {
  flat: 'border border-line bg-canvas-subtle shadow-inset',
  raised: 'border border-line bg-surface shadow-card',
  elevated: 'border border-line bg-surface shadow-elevated',
  floating: 'border border-line bg-surface shadow-floating',
};

export function Card({ elevation = 'raised', className = '', ...props }: CardProps) {
  return <div className={`rounded-card ${elevationStyles[elevation]} ${className}`} {...props} />;
}

export function CardHeader({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`flex flex-col gap-1 border-b border-line px-5 py-4 sm:px-6 ${className}`}
      {...props}
    />
  );
}

export function CardTitle({ className = '', ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={`font-display text-display-sm tracking-display ${className}`} {...props} />;
}

export function CardDescription({
  className = '',
  ...props
}: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={`text-body-sm leading-relaxed text-ink-500 ${className}`} {...props} />;
}

export function CardContent({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`px-5 py-4 sm:px-6 sm:py-5 ${className}`} {...props} />;
}

export function CardFooter({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`flex items-center justify-between gap-3 border-t border-line px-5 py-4 sm:px-6 ${className}`}
      {...props}
    />
  );
}
