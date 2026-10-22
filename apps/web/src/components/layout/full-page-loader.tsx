import { Spinner } from '../ui/spinner';

export function FullPageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <span aria-hidden="true" className="size-2.5 rounded-full bg-action-accent" />
        <p className="font-display text-display-sm text-ink-900">Verity</p>
        <Spinner label={label} />
      </div>
    </div>
  );
}
