import { type ButtonHTMLAttributes, type ReactNode, useEffect, useRef, useState } from 'react';

export interface DropdownTriggerProps {
  onClick: () => void;
  'aria-expanded': boolean;
  'aria-haspopup': 'menu';
}

interface DropdownMenuProps {
  label: string;
  trigger: (props: DropdownTriggerProps) => ReactNode;
  children: ReactNode;
  align?: 'start' | 'end';
  className?: string;
}

export function DropdownMenu({
  label,
  trigger,
  children,
  align = 'end',
  className = '',
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className={`relative inline-flex ${className}`}>
      {trigger({
        onClick: () => setOpen((value) => !value),
        'aria-expanded': open,
        'aria-haspopup': 'menu',
      })}
      {open ? (
        <div
          role="menu"
          aria-label={label}
          onClick={() => setOpen(false)}
          className={`absolute top-[calc(100%+0.5rem)] z-40 min-w-56 rounded-nested border border-line-strong bg-surface p-1.5 shadow-dropdown ${
            align === 'end' ? 'right-0' : 'left-0'
          }`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

interface DropdownMenuItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  destructive?: boolean;
}

export function DropdownMenuItem({
  destructive = false,
  className = '',
  ...props
}: DropdownMenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`flex w-full items-center gap-2.5 rounded-control px-3 py-2 text-left text-body-md transition-colors hover:bg-inset focus-visible:bg-inset focus-visible:outline-none ${
        destructive ? 'text-danger-text' : 'text-ink-700'
      } ${className}`}
      {...props}
    />
  );
}

export function DropdownMenuSeparator() {
  return <div role="separator" className="my-1.5 h-px bg-line" />;
}
