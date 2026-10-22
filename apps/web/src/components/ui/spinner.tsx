import { Loader2 } from 'lucide-react';

interface SpinnerProps {
  label?: string;
  className?: string;
}

export function Spinner({ label = 'Loading', className = '' }: SpinnerProps) {
  return (
    <span role="status" className={`inline-flex items-center gap-2 text-ink-500 ${className}`}>
      <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
