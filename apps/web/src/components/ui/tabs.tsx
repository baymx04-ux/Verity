import { type KeyboardEvent, type ReactNode, useId, useState } from 'react';

export interface TabItem {
  id: string;
  label: string;
  content: ReactNode;
}

interface TabsProps {
  items: TabItem[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  className?: string;
}

export function Tabs({ items, value, defaultValue, onValueChange, className = '' }: TabsProps) {
  const id = useId();
  const [internalValue, setInternalValue] = useState(defaultValue ?? items[0]?.id ?? '');
  const activeValue = value ?? internalValue;

  function select(next: string) {
    if (value === undefined) {
      setInternalValue(next);
    }
    onValueChange?.(next);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (
      event.key !== 'ArrowRight' &&
      event.key !== 'ArrowLeft' &&
      event.key !== 'Home' &&
      event.key !== 'End'
    ) {
      return;
    }

    event.preventDefault();
    const lastIndex = items.length - 1;
    let nextIndex = index;

    if (event.key === 'ArrowRight') {
      nextIndex = index === lastIndex ? 0 : index + 1;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = index === 0 ? lastIndex : index - 1;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else {
      nextIndex = lastIndex;
    }

    const next = items[nextIndex];
    if (!next) {
      return;
    }

    select(next.id);
    document.getElementById(`${id}-tab-${next.id}`)?.focus();
  }

  const active = items.find((item) => item.id === activeValue) ?? items[0];

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label="Tabs"
        className="inline-flex flex-wrap gap-1 rounded-control border border-line bg-inset p-1"
      >
        {items.map((item, index) => {
          const selected = item.id === active?.id;
          return (
            <button
              key={item.id}
              id={`${id}-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${id}-panel-${item.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => select(item.id)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              className={`rounded-[6px] px-3 py-1.5 text-label-md transition-colors ${
                selected ? 'bg-surface text-ink-900 shadow-xs' : 'text-ink-500 hover:text-ink-700'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </div>
      {active ? (
        <div
          id={`${id}-panel-${active.id}`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${active.id}`}
          className="mt-4"
        >
          {active.content}
        </div>
      ) : null}
    </div>
  );
}
