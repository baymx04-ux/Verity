import { ChevronLeft, ChevronRight } from 'lucide-react';

import { IconButton } from './icon-button';

interface PaginationProps {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  className?: string;
}

export function Pagination({ page, pageCount, onPageChange, className = '' }: PaginationProps) {
  const safePageCount = Math.max(1, pageCount);

  return (
    <nav aria-label="Pagination" className={`flex items-center justify-between gap-3 ${className}`}>
      <p className="text-body-sm text-ink-500">
        Page <span className="tabular text-ink-700">{page}</span> of{' '}
        <span className="tabular text-ink-700">{safePageCount}</span>
      </p>
      <div className="flex items-center gap-1">
        <IconButton
          aria-label="Previous page"
          size="sm"
          variant="secondary"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          <ChevronLeft aria-hidden="true" />
        </IconButton>
        <IconButton
          aria-label="Next page"
          size="sm"
          variant="secondary"
          disabled={page >= safePageCount}
          onClick={() => onPageChange(page + 1)}
        >
          <ChevronRight aria-hidden="true" />
        </IconButton>
      </div>
    </nav>
  );
}
