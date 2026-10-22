import { X } from 'lucide-react';
import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

import { IconButton } from './icon-button';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  side?: 'left' | 'right';
  children?: ReactNode;
  footer?: ReactNode;
}

export function Sheet({
  open,
  onClose,
  title,
  description,
  side = 'right',
  children,
  footer,
}: SheetProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-ink-900/35 backdrop-blur-[4px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="sheet-title"
        aria-describedby={description ? 'sheet-description' : undefined}
        className={`absolute inset-y-0 flex w-full max-w-md flex-col border-line bg-surface shadow-dropdown ${
          side === 'right' ? 'right-0 border-l' : 'left-0 border-r'
        }`}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div>
            <h2 id="sheet-title" className="font-display text-display-sm text-ink-900">
              {title}
            </h2>
            {description ? (
              <p id="sheet-description" className="mt-1 text-body-sm text-ink-500">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton aria-label="Close panel" size="sm" onClick={onClose}>
            <X aria-hidden="true" />
          </IconButton>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
