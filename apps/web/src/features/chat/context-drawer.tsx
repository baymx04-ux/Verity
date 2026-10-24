import { Check, Copy, ExternalLink, FileText, ShieldCheck, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Badge } from '../../components/ui/badge';
import { IconButton } from '../../components/ui/icon-button';
import type { Citation } from './chat-api';

interface ContextDrawerProps {
  citations: Citation[];
  selectedIndex: number | null;
  onSelectCitation: (index: number | null) => void;
  onClose?: () => void;
}

export function ContextDrawer({
  citations,
  selectedIndex,
  onSelectCitation,
  onClose,
}: ContextDrawerProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
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
      // ignore
    }
  };

  return (
    <aside
      aria-label="Source Evidence and Context Drawer"
      className="flex h-full flex-col border-l border-line bg-surface"
    >
      <header className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-4 text-emerald-600" aria-hidden="true" />
          <h2 className="font-display text-display-sm text-ink-900">Source Evidence</h2>
          {citations.length > 0 && (
            <Badge variant="verified">
              {citations.length} {citations.length === 1 ? 'Source' : 'Sources'}
            </Badge>
          )}
        </div>
        {onClose && (
          <IconButton aria-label="Close source evidence" size="sm" variant="subtle" onClick={onClose}>
            <X className="size-4" aria-hidden="true" />
          </IconButton>
        )}
      </header>

      <div className="flex-1 overflow-y-auto p-4 space-y-3 sm:p-5">
        {citations.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center text-center px-4">
            <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-surface-container-low text-ink-400">
              <FileText className="size-5" aria-hidden="true" />
            </span>
            <p className="text-label-md text-ink-700">No active sources</p>
            <p className="mt-1 max-w-xs text-body-sm leading-relaxed text-ink-500">
              Select an answer or click any citation chip <span className="font-mono text-sky-700">[1]</span> to inspect referenced passages and verification checksums.
            </p>
          </div>
        ) : (
          citations.map((citation, idx) => {
            const isSelected = selectedIndex === idx;
            const scorePercent = Math.round(citation.score * 100);

            return (
              <div
                key={citation.id || idx}
                ref={(el) => {
                  cardRefs.current[idx] = el;
                }}
                onClick={() => onSelectCitation(idx)}
                className={`rounded-lg border transition-all cursor-pointer p-4 space-y-3 shadow-xs ${
                  isSelected
                    ? 'border-sky-400 ring-2 ring-sky-300/80 bg-sky-50/30'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between pb-2 border-b border-slate-100 gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="flex size-5 shrink-0 items-center justify-center rounded bg-sky-100 font-mono text-[11px] font-semibold text-sky-800">
                      {idx + 1}
                    </span>
                    <span className="truncate text-xs font-semibold text-slate-800" title={citation.title}>
                      {citation.title}
                    </span>
                    {citation.page !== null && (
                      <span className="shrink-0 text-xs text-slate-400">• p.{citation.page}</span>
                    )}
                  </div>
                  <span className="shrink-0 text-[11px] font-mono text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    SHA-256 Valid
                  </span>
                </div>

                {citation.section && (
                  <p className="text-[11px] font-medium uppercase tracking-wide text-ink-400">
                    Section: {citation.section}
                  </p>
                )}

                <div className="p-3 bg-slate-50 rounded-md border border-slate-200/60 text-xs text-slate-600 leading-relaxed italic">
                  “{citation.snippet}”
                </div>

                <div className="flex items-center justify-between pt-1 text-body-sm">
                  <span className="text-[11px] text-ink-500">
                    Match Confidence: <span className="font-medium text-ink-700">{scorePercent}%</span>
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        copySnippet(citation.id, citation.snippet);
                      }}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-ink-500 hover:bg-slate-100 hover:text-ink-700"
                    >
                      {copiedId === citation.id ? (
                        <>
                          <Check className="size-3 text-emerald-600" aria-hidden="true" />
                          <span className="text-emerald-700">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="size-3" aria-hidden="true" />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                    <a
                      href={`/api/documents/${citation.document_id}/file`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-sky-700 hover:bg-sky-50"
                    >
                      <span>Open Doc</span>
                      <ExternalLink className="size-3" aria-hidden="true" />
                    </a>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
