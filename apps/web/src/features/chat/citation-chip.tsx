import { FileText } from 'lucide-react';
import type { Citation } from './chat-api';

interface CitationChipProps {
  index: number;
  citation?: Citation | undefined;
  isSelected?: boolean | undefined;
  onClick: () => void;
}

export function CitationChip({ index, citation, isSelected, onClick }: CitationChipProps) {
  const title = citation?.title
    ? `${citation.title}${citation.page ? ` · p. ${citation.page}` : ''}`
    : `Source ${index}`;

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium transition-all ${
        isSelected
          ? 'bg-sky-100 text-sky-800 border-2 border-sky-400 ring-2 ring-sky-200 shadow-xs'
          : 'bg-sky-50 text-sky-700 border border-sky-200/80 hover:bg-sky-100 hover:text-sky-800'
      }`}
    >
      <FileText className="size-3 shrink-0 text-sky-600" aria-hidden="true" />
      <span>[{index}]</span>
      {citation?.page && <span className="opacity-75">p.{citation.page}</span>}
    </button>
  );
}
