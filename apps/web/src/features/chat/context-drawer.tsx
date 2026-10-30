import { Check, Copy, ExternalLink, FileText, Quote, ShieldCheck, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '../../components/ui/badge';
import { IconButton } from '../../components/ui/icon-button';
import type { Citation } from './chat-api';

interface ContextDrawerProps {
  citations: Citation[];
  selectedIndex: number | null;
  onSelectCitation: (index: number | null) => void;
  onClose?: () => void;
  onOpenDocument?: ((documentId: string) => Promise<void>) | undefined;
  embedded?: boolean;
}

export function ContextDrawer({
  citations,
  selectedIndex,
  onSelectCitation,
  onClose,
  onOpenDocument,
  embedded = false,
}: ContextDrawerProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [openingDocumentId, setOpeningDocumentId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (selectedIndex !== null && cardRefs.current[selectedIndex]) {
      cardRefs.current[selectedIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [selectedIndex]);

  const copySnippet = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      // Clipboard access is best-effort.
    }
  };

  const openDocument = async (documentId: string) => {
    if (!onOpenDocument) return;
    setOpeningDocumentId(documentId);
    setOpenError(null);
    try {
      await onOpenDocument(documentId);
    } catch {
      setOpenError('The signed document link could not be created. Please try again.');
    } finally {
      setOpeningDocumentId(null);
    }
  };

  return (
    <aside
      aria-label="Source evidence and context drawer"
      className={`flex h-full flex-col bg-surface ${embedded ? '' : 'border-l border-line'}`}
    >
      {embedded ? null : (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <ShieldCheck className="size-4 shrink-0 text-verified" aria-hidden="true" />
            <h2 className="truncate font-display text-display-sm text-ink-900">Source evidence</h2>
            {citations.length > 0 ? (
              <Badge variant="verified">
                {citations.length} {citations.length === 1 ? 'source' : 'sources'}
              </Badge>
            ) : null}
          </div>
          {onClose ? (
            <IconButton
              aria-label="Close source evidence"
              size="sm"
              variant="ghost"
              onClick={onClose}
            >
              <X className="size-4" aria-hidden="true" />
            </IconButton>
          ) : null}
        </header>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto p-3.5 sm:p-4">
        {citations.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center px-5 text-center">
            <span className="mb-3 flex size-11 items-center justify-center rounded-[13px] border border-line bg-canvas-subtle text-ink-400">
              <FileText className="size-5" aria-hidden="true" />
            </span>
            <p className="text-label-md text-ink-700">No sources to show</p>
            <p className="mt-1 max-w-xs text-body-sm leading-relaxed text-ink-500">
              Ask a question, then select a citation chip like{' '}
              <span className="rounded border border-action-border bg-action-tint px-1 py-0.5 font-mono text-[10px] text-action">
                [1]
              </span>{' '}
              to inspect the exact passage and match score.
            </p>
          </div>
        ) : (
          <>
            {openError ? (
              <p
                role="alert"
                className="rounded-control border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-text"
              >
                {openError}
              </p>
            ) : null}

            {citations.map((citation, idx) => {
              const isSelected = selectedIndex === idx;
              const scorePercent = Math.round(citation.score * 100);

              return (
                <div
                  key={citation.id || idx}
                  ref={(el) => {
                    cardRefs.current[idx] = el;
                  }}
                  onClick={() => onSelectCitation(idx)}
                  className={`cursor-pointer rounded-card border p-3.5 transition-fluid ${
                    isSelected
                      ? 'border-action-border bg-action-tint/40 shadow-elevated ring-2 ring-action-accent/15'
                      : 'border-line bg-surface shadow-card hover:-translate-y-px hover:border-line-strong hover:shadow-elevated'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2">
                      <span className="flex size-6 shrink-0 items-center justify-center rounded-[7px] border border-action-border bg-action-tint font-mono text-[11px] font-semibold text-action">
                        {idx + 1}
                      </span>
                      <div className="min-w-0">
                        <p
                          className="truncate text-label-md font-semibold text-ink-900"
                          title={citation.title}
                        >
                          {citation.title}
                        </p>
                        <p className="mt-0.5 text-[11px] text-ink-500">
                          {citation.page !== null ? `p.${citation.page}` : 'Document source'}
                          {citation.section ? ` · ${citation.section}` : ''}
                        </p>
                      </div>
                    </div>
                    <Badge variant="verified" className="shrink-0">
                      {scorePercent}% match
                    </Badge>
                  </div>

                  <div className="mt-3 rounded-nested border border-line bg-canvas-subtle/80 p-3">
                    <Quote aria-hidden="true" className="mb-1 size-3.5 text-ink-400" />
                    <p className="text-[12.5px] italic leading-relaxed text-ink-700">
                      “{citation.snippet}”
                    </p>
                  </div>

                  <div className="mt-3 flex items-center justify-end gap-1 border-t border-line/70 pt-2.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void copySnippet(citation.id, citation.snippet);
                      }}
                      className="inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] text-ink-500 transition-fluid hover:bg-inset hover:text-ink-900"
                    >
                      {copiedId === citation.id ? (
                        <>
                          <Check className="size-3 text-verified" aria-hidden="true" />
                          <span className="text-verified-text">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="size-3" aria-hidden="true" />
                          <span>Copy passage</span>
                        </>
                      )}
                    </button>
                    {onOpenDocument ? (
                      <button
                        type="button"
                        disabled={openingDocumentId === citation.document_id}
                        onClick={(e) => {
                          e.stopPropagation();
                          void openDocument(citation.document_id);
                        }}
                        className="inline-flex items-center gap-1 rounded-[6px] px-2 py-1 text-[11px] font-medium text-action transition-fluid hover:bg-action-tint disabled:cursor-wait disabled:opacity-60"
                      >
                        <span>
                          {openingDocumentId === citation.document_id
                            ? 'Opening…'
                            : 'Open document'}
                        </span>
                        <ExternalLink className="size-3" aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </aside>
  );
}
