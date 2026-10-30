import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

export interface AccordionItem {
  id: string;
  title: string;
  content: ReactNode;
}

interface AccordionProps {
  items: AccordionItem[];
  className?: string;
}

export function Accordion({ items, className = '' }: AccordionProps) {
  return (
    <div
      className={`divide-y divide-line rounded-nested border border-line bg-surface ${className}`}
    >
      {items.map((item) => (
        <details key={item.id} className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 text-label-md text-ink-700 transition-colors hover:bg-canvas-subtle [&::-webkit-details-marker]:hidden">
            {item.title}
            <ChevronDown
              aria-hidden="true"
              className="size-4 shrink-0 text-ink-500 transition-transform group-open:rotate-180"
            />
          </summary>
          <div className="px-4 pb-4 text-body-md text-ink-700">{item.content}</div>
        </details>
      ))}
    </div>
  );
}
