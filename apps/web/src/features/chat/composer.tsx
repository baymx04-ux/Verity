import { ArrowUp, BookOpen, Layers, Square } from 'lucide-react';
import { type KeyboardEvent, useRef } from 'react';

import { Button } from '../../components/ui/button';
import { Textarea } from '../../components/ui/textarea';

interface ComposerProps {
  question: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  isStreaming: boolean;
  disabled?: boolean;
}

export function Composer({
  question,
  onChange,
  onSubmit,
  onStop,
  isStreaming,
  disabled,
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
    <div className="border-t border-line bg-surface/90 backdrop-blur p-4 sm:p-5">
      <div className="relative rounded-xl border border-slate-200 bg-white shadow-xs focus-within:border-sky-500 focus-within:ring-2 focus-within:ring-sky-100 transition-all">
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
          placeholder="Ask any question across documents or data warehouses…"
          className="min-h-16 w-full resize-none border-0 bg-transparent px-4 py-3 text-body-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
        />

        <div className="flex items-center justify-between px-3 py-2 border-t border-slate-100 bg-slate-50/60 rounded-b-xl">
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-600 shadow-xs">
              <Layers className="size-3 text-sky-600" aria-hidden="true" />
              Auto (Smart Route)
            </span>
            <span className="hidden items-center gap-1 text-[11px] text-slate-400 sm:inline-flex">
              <BookOpen className="size-3" aria-hidden="true" />
              RAG Citations Active
            </span>
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
                <span>Submit Query</span>
                <ArrowUp className="size-3.5" aria-hidden="true" />
              </Button>
            )}
          </div>
        </div>
      </div>

      <p className="mt-2 text-center text-xs text-ink-400">
        Press <kbd className="font-mono text-[11px] bg-slate-100 px-1 py-0.5 rounded border border-slate-200">Enter</kbd> to submit, <kbd className="font-mono text-[11px] bg-slate-100 px-1 py-0.5 rounded border border-slate-200">Shift + Enter</kbd> for newline. Answers cite verified excerpts.
      </p>
    </div>
  );
}
