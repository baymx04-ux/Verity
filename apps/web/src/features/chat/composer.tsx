import { ArrowUp, Database, FileText, Sparkles, Square } from 'lucide-react';
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
    <div className="border-t border-line bg-surface/90 p-4 backdrop-blur sm:p-5">
      <div className="relative rounded-xl border border-slate-200 bg-white shadow-xs transition-all focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-100">
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
          placeholder={
            mode === 'sql'
              ? 'Ask a data question, e.g. “Revenue by region last quarter”…'
              : mode === 'auto'
                ? 'Ask anything about your documents or company data…'
                : 'Ask a question about your documents…'
          }
          className="min-h-16 w-full resize-none border-0 bg-transparent px-4 py-3 text-body-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
        />

        <div className="flex items-center justify-between gap-2 rounded-b-xl border-t border-slate-100 bg-slate-50/60 px-3 py-2">
          <div
            className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-xs"
            role="group"
            aria-label="Answer mode"
          >
            <button
              type="button"
              aria-pressed={mode === 'auto'}
              onClick={() => onModeChange('auto')}
              disabled={isStreaming}
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                mode === 'auto'
                  ? 'bg-violet-50 text-violet-800'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
              }`}
            >
              <Sparkles className="size-3" aria-hidden="true" />
              Auto
            </button>
            <button
              type="button"
              aria-pressed={mode === 'documents'}
              onClick={() => onModeChange('documents')}
              disabled={isStreaming}
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                mode === 'documents'
                  ? 'bg-sky-50 text-sky-800'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
              }`}
            >
              <FileText className="size-3" aria-hidden="true" />
              Documents
            </button>
            <button
              type="button"
              aria-pressed={mode === 'sql'}
              onClick={() => onModeChange('sql')}
              disabled={isStreaming}
              className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                mode === 'sql'
                  ? 'bg-emerald-50 text-emerald-800'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
              }`}
            >
              <Database className="size-3" aria-hidden="true" />
              Data
            </button>
          </div>

          <div className="flex items-center gap-2">
            {isStreaming ? (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={onStop}
                className="h-8 gap-1.5 px-3 text-xs"
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
                className="h-8 gap-1.5 px-3 text-xs"
              >
                <span>Ask</span>
                <ArrowUp className="size-3.5" aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <p className="mt-2 text-center text-xs text-ink-400">
        Press{' '}
        <kbd className="rounded border border-slate-200 bg-slate-100 px-1 py-0.5 font-mono text-[11px]">
          Enter
        </kbd>{' '}
        to send,{' '}
        <kbd className="rounded border border-slate-200 bg-slate-100 px-1 py-0.5 font-mono text-[11px]">
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
  );
}
