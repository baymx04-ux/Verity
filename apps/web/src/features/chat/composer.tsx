import { ArrowUp, Database, FileText, Route, Square } from 'lucide-react';
import { type KeyboardEvent, useRef } from 'react';

import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';
import type { ChatMode } from './chat-api';

interface ComposerProps {
  question: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  isStreaming: boolean;
  disabled?: boolean;
  mode: ChatMode;
  onModeChange: (mode: ChatMode) => void;
}

const MODES: Array<{ value: ChatMode; label: string; icon: typeof Route }> = [
  { value: 'auto', label: 'Auto', icon: Route },
  { value: 'documents', label: 'Documents', icon: FileText },
  { value: 'sql', label: 'Data', icon: Database },
];

export function Composer({
  question,
  onChange,
  onSubmit,
  onStop,
  isStreaming,
  disabled,
  mode,
  onModeChange,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isStreaming && question.trim()) {
        onSubmit();
      }
    }
  };

  return (
    <div className="border-t border-line bg-surface/85 p-3 backdrop-blur-sm sm:p-4">
      <div className="mx-auto max-w-4xl">
        <div className="rounded-2xl border border-line bg-surface shadow-elevated transition-fluid focus-within:border-action-accent focus-within:ring-2 focus-within:ring-action-accent/15">
          <label htmlFor="composer-input" className="sr-only">
            Ask a question
          </label>
          <Textarea
            id="composer-input"
            ref={textareaRef}
            value={question}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            aria-busy={isStreaming}
            placeholder={
              mode === 'sql'
                ? 'Ask a data question, e.g. “Revenue by region last quarter”…'
                : mode === 'auto'
                  ? 'Ask anything about your documents or company data…'
                  : 'Ask a question about your documents…'
            }
            className="min-h-[60px] w-full resize-none border-0 bg-transparent px-4 py-3.5 text-body-md text-ink-900 shadow-none placeholder:text-ink-400 hover:border-0 focus-visible:border-0 focus-visible:ring-0"
          />

          <div className="flex items-center justify-between gap-2 rounded-b-2xl border-t border-line bg-canvas-subtle/60 px-2.5 py-2">
            <div
              className="inline-flex rounded-control border border-line bg-surface p-0.5 shadow-xs"
              role="group"
              aria-label="Answer mode"
            >
              {MODES.map((option) => {
                const Icon = option.icon;
                const active = mode === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onModeChange(option.value)}
                    disabled={isStreaming}
                    className={`inline-flex items-center gap-1.5 rounded-[6px] px-2.5 py-1.5 text-[11px] font-medium transition-fluid disabled:cursor-not-allowed disabled:opacity-60 ${
                      active
                        ? 'bg-action-tint text-action'
                        : 'text-ink-500 hover:bg-inset hover:text-ink-900'
                    }`}
                  >
                    <Icon className="size-3.5" aria-hidden="true" />
                    {option.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-2">
              {isStreaming ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={onStop}
                  className="h-9 gap-1.5 px-3"
                >
                  <Square className="size-3 fill-current" aria-hidden="true" />
                  Stop
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={onSubmit}
                  disabled={disabled || !question.trim()}
                  className="h-9 gap-1.5 rounded-full px-3.5"
                >
                  <span>Ask</span>
                  <ArrowUp className="size-3.5" aria-hidden="true" />
                </Button>
              )}
            </div>
          </div>
        </div>

        <p className="mt-2 text-center text-[11px] leading-relaxed text-ink-400">
          Press{' '}
          <kbd className="rounded border border-line bg-surface px-1 py-0.5 font-mono text-[10px] text-ink-500">
            Enter
          </kbd>{' '}
          to send,{' '}
          <kbd className="rounded border border-line bg-surface px-1 py-0.5 font-mono text-[10px] text-ink-500">
            Shift + Enter
          </kbd>{' '}
          for a new line.{' '}
          {mode === 'sql'
            ? 'Data answers show the read-only SQL and result table.'
            : mode === 'auto'
              ? 'Auto picks documents, data, or both depending on the question.'
              : 'Citations map to the retrieved document passages.'}
        </p>
      </div>
    </div>
  );
}
