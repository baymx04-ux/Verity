import {
  Check,
  Clock,
  Copy,
  FileSearch,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  User,
} from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { IconButton } from '../../components/ui/icon-button';
import { Textarea } from '../../components/ui/textarea';
import type { ChatMessage, Citation } from './chat-api';
import { CitationChip } from './citation-chip';

interface MessageItemProps {
  message: ChatMessage;
  selectedCitationIndex: number | null;
  onSelectCitation: (index: number) => void;
  onFeedback: (messageId: string, rating: 1 | -1, comment?: string) => Promise<void>;
  userEmail?: string | undefined;
  onRegenerate?: (() => void) | undefined;
}

export function MessageItem({
  message,
  selectedCitationIndex,
  onSelectCitation,
  onFeedback,
  userEmail,
  onRegenerate,
}: MessageItemProps) {
  const [copied, setCopied] = useState(false);
  const [commentDialogOpen, setCommentDialogOpen] = useState(false);
  const [feedbackRating, setFeedbackRating] = useState<1 | -1 | null>(
    (message.feedback?.rating as 1 | -1) ?? null,
  );
  const [feedbackComment, setFeedbackComment] = useState(message.feedback?.comment ?? '');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  const handleVote = async (rating: 1 | -1) => {
    setFeedbackRating(rating);
    try {
      await onFeedback(message.id, rating, feedbackComment || undefined);
    } catch {
      // ignore
    }
  };

  const handleSaveComment = async () => {
    if (!feedbackRating) return;
    setIsSubmittingFeedback(true);
    try {
      await onFeedback(message.id, feedbackRating, feedbackComment);
      setCommentDialogOpen(false);
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  const renderContent = (content: string, citations: Citation[]) => {
    // Regex splits text into plain parts and [1], [2], etc.
    const parts = content.split(/(\[\d{1,3}\])/g);

    return (
      <div className="prose prose-slate max-w-none text-body-md text-slate-800 leading-relaxed">
        {parts.map((part, index) => {
          const match = part.match(/^\[(\d{1,3})\]$/);
          const rawDigit = match?.[1];
          if (rawDigit) {
            const citeIndex = parseInt(rawDigit, 10);
            const citation = citations[citeIndex - 1];
            return (
              <span key={index} className="inline-block mx-0.5 align-baseline">
                <CitationChip
                  index={citeIndex}
                  citation={citation}
                  isSelected={selectedCitationIndex === citeIndex - 1}
                  onClick={() => onSelectCitation(citeIndex - 1)}
                />
              </span>
            );
          }

          return (
            <ReactMarkdown
              key={index}
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => <span className="inline">{children}</span>,
              }}
            >
              {part}
            </ReactMarkdown>
          );
        })}
      </div>
    );
  };

  if (message.role === 'user') {
    return (
      <article className="rounded-lg border border-slate-200/80 bg-white p-4 shadow-xs transition-colors hover:border-slate-300 sm:p-5">
        <header className="flex items-center justify-between pb-3 border-b border-slate-100 text-xs text-ink-500">
          <div className="flex items-center gap-2">
            <span className="flex size-6 items-center justify-center rounded-full bg-slate-100 text-slate-700">
              <User className="size-3.5" aria-hidden="true" />
            </span>
            <span className="font-medium text-slate-700">{userEmail || 'You'}</span>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="neutral">Question</Badge>
            <time className="text-[11px] text-ink-400">
              {new Date(message.created_at).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              })}
            </time>
          </div>
        </header>

        <div className="mt-3">
          <h3 className="font-display text-display-sm text-slate-900 font-semibold leading-snug">
            {message.content}
          </h3>
        </div>
      </article>
    );
  }

  const metadata = message.metadata ?? {};
  const isRefusal =
    metadata.answer_status === 'refused' ||
    message.content.includes("I don't have enough information");
  const isAborted = metadata.answer_status === 'aborted' || metadata.aborted === true;
  const isError = metadata.answer_status === 'error';

  const answerLabel = isAborted
    ? 'Stopped'
    : isError
      ? 'Generation failed'
      : isRefusal
        ? 'Insufficient evidence'
        : 'Grounded answer';

  return (
    <article className="rounded-lg border border-slate-200/80 bg-white p-4 shadow-xs sm:p-5">
      <header className="flex items-center justify-between pb-3 border-b border-slate-100 text-xs text-ink-500">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-sky-50 text-sky-600">
            <Sparkles className="size-3.5" aria-hidden="true" />
          </span>
          <span className="font-semibold text-slate-800">Verity</span>
          <span className="text-slate-300">•</span>
          <span
            className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 font-mono text-[11px] font-medium ${
              isAborted || isError
                ? 'border-amber-200/60 bg-amber-50 text-amber-700'
                : 'border-emerald-200/60 bg-emerald-50 text-emerald-700'
            }`}
          >
            <ShieldCheck className="size-3" aria-hidden="true" />
            {answerLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {message.route && (
            <Badge variant={message.route === 'documents' ? 'info' : 'live'}>
              {message.route === 'documents' ? 'Documents' : message.route}
            </Badge>
          )}
          {message.latency_ms && (
            <span className="hidden items-center gap-1 text-[11px] font-mono text-ink-400 sm:inline-flex">
              <Clock className="size-3" aria-hidden="true" />
              {message.latency_ms}ms
            </span>
          )}
        </div>
      </header>

      <div className="mt-3">
        {isRefusal ? (
          <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3.5 text-body-md text-amber-900 flex items-start gap-2.5">
            <FileSearch className="size-5 shrink-0 text-amber-600 mt-0.5" aria-hidden="true" />
            <div>
              <p className="font-medium text-amber-900">Insufficient document evidence</p>
              <p className="mt-0.5 text-body-sm text-amber-800 leading-relaxed">
                {message.content}
              </p>
            </div>
          </div>
        ) : (
          renderContent(message.content, message.citations || [])
        )}
        {isAborted && (
          <p className="mt-2 text-[11px] text-amber-700">
            Generation was stopped. The partial answer above was saved.
          </p>
        )}
        {isError && (
          <p className="mt-2 text-[11px] text-amber-700">
            Generation failed before the answer completed.
          </p>
        )}
      </div>

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100 text-xs text-ink-500">
        <div className="flex items-center gap-1.5">
          <IconButton
            size="sm"
            variant="subtle"
            aria-label="Helpful answer"
            onClick={() => handleVote(1)}
            className={feedbackRating === 1 ? 'text-emerald-700 bg-emerald-50' : ''}
          >
            <ThumbsUp className="size-3.5" aria-hidden="true" />
          </IconButton>
          <IconButton
            size="sm"
            variant="subtle"
            aria-label="Unhelpful answer"
            onClick={() => handleVote(-1)}
            className={feedbackRating === -1 ? 'text-rose-700 bg-rose-50' : ''}
          >
            <ThumbsDown className="size-3.5" aria-hidden="true" />
          </IconButton>
          {feedbackRating !== null && (
            <button
              type="button"
              onClick={() => setCommentDialogOpen(true)}
              className="text-[11px] text-ink-500 hover:text-ink-700 underline underline-offset-2 ml-1"
            >
              {feedbackComment ? 'Edit comment' : 'Add comment'}
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {message.trace_id && (
            <span className="hidden text-[10px] font-mono text-ink-400 lg:inline">
              Trace: {message.trace_id.slice(0, 8)}…
            </span>
          )}
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-ink-500 hover:bg-slate-100 hover:text-ink-700"
            >
              <RotateCcw className="size-3" aria-hidden="true" />
              <span>Regenerate</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-ink-500 hover:bg-slate-100 hover:text-ink-700"
          >
            {copied ? (
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
        </div>
      </footer>

      <Dialog
        open={commentDialogOpen}
        onClose={() => setCommentDialogOpen(false)}
        title="Leave Answer Feedback"
        description="Your feedback is stored with this answer for later review."
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-label-md">
            <span>Rating:</span>
            <Badge variant={feedbackRating === 1 ? 'verified' : 'danger'}>
              {feedbackRating === 1 ? 'Helpful' : 'Unhelpful'}
            </Badge>
          </div>
          <div>
            <label htmlFor="feedback-comment" className="block text-label-md text-ink-700 mb-1">
              Comment (optional)
            </label>
            <Textarea
              id="feedback-comment"
              value={feedbackComment}
              onChange={(e) => setFeedbackComment(e.target.value)}
              placeholder="What could be improved or verified more accurately?"
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" size="sm" onClick={() => setCommentDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveComment}
              disabled={isSubmittingFeedback}
            >
              Save Feedback
            </Button>
          </div>
        </div>
      </Dialog>
    </article>
  );
}
