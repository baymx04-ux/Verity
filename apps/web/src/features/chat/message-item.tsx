import {
  Check,
  Clock,
  Copy,
  FileSearch,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  User,
} from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { SqlPanel, type SqlResult } from '../../components/sql/SqlPanel';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Dialog } from '../../components/ui/dialog';
import { IconButton } from '../../components/ui/icon-button';
import { Textarea } from '../../components/ui/textarea';
import type { ChatMessage, Citation, SqlResultPreview } from './chat-api';

const CITATION_HREF_PATTERN = /^#citation-(\d{1,3})$/;

function formatLatency(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

/**
 * Turn inline citation markers such as `[1]` into Markdown links so the
 * whole answer can be parsed as a single document. Splitting the text before
 * parsing broke block structure (lists, headings, paragraphs) and pushed the
 * citation chips onto their own lines.
 */
function linkCitationMarkers(content: string): string {
  return content
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
    .map((segment, index) =>
      index % 2 === 1
        ? segment
        : segment.replace(
            /\[(\d{1,3})\]/g,
            (_match, digit: string) => `[${digit}](#citation-${digit})`,
          ),
    )
    .join('');
}

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
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackNotice, setFeedbackNotice] = useState<string | null>(null);

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
    const previousRating = feedbackRating;
    setFeedbackRating(rating);
    setIsSubmittingFeedback(true);
    setFeedbackError(null);
    setFeedbackNotice(null);
    try {
      await onFeedback(message.id, rating, feedbackComment || undefined);
      setFeedbackNotice('Feedback saved');
    } catch (error) {
      setFeedbackRating(previousRating);
      setFeedbackError(
        error instanceof Error && error.message
          ? error.message
          : 'Feedback could not be saved. Check your connection and try again.',
      );
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  const handleSaveComment = async () => {
    if (!feedbackRating) return;
    setIsSubmittingFeedback(true);
    setFeedbackError(null);
    setFeedbackNotice(null);
    try {
      await onFeedback(message.id, feedbackRating, feedbackComment);
      setFeedbackNotice('Comment saved');
      setCommentDialogOpen(false);
    } catch (error) {
      setFeedbackError(
        error instanceof Error && error.message
          ? error.message
          : 'Your comment could not be saved. Please try again.',
      );
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  const renderCitationChip = (citeIndex: number) => {
    const citation: Citation | undefined = message.citations?.[citeIndex - 1];
    const title = citation?.title
      ? `${citation.title}${citation.page ? ` · p. ${citation.page}` : ''}`
      : `Source ${citeIndex}`;
    const isSelected = selectedCitationIndex === citeIndex - 1;

    return (
      <button
        type="button"
        title={title}
        aria-pressed={isSelected}
        onClick={() => onSelectCitation(citeIndex - 1)}
        className={`mx-0.5 inline-flex items-center rounded-[5px] border px-1.5 py-0.5 align-middle font-mono text-[10px] font-medium leading-none transition-fluid ${
          isSelected
            ? 'border-action bg-action text-white shadow-xs'
            : 'border-action-border bg-action-tint text-action hover:bg-action-border/60'
        }`}
      >
        [{citeIndex}]
      </button>
    );
  };

  const markdownComponents: Components = {
    a: ({ href, children }) => {
      const citationMatch = href?.match(CITATION_HREF_PATTERN);
      if (citationMatch?.[1]) {
        return renderCitationChip(parseInt(citationMatch[1], 10));
      }
      return (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-action underline underline-offset-2"
        >
          {children}
        </a>
      );
    },
    p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
    ul: ({ children }) => (
      <ul className="my-2 list-disc space-y-1 pl-5 marker:text-ink-400">{children}</ul>
    ),
    ol: ({ children }) => (
      <ol className="my-2 list-decimal space-y-1 pl-5 marker:text-ink-400">{children}</ol>
    ),
    li: ({ children }) => <li className="pl-0.5">{children}</li>,
    h1: ({ children }) => (
      <h1 className="mb-2 mt-4 text-display-sm font-semibold text-ink-900 first:mt-0">
        {children}
      </h1>
    ),
    h2: ({ children }) => (
      <h2 className="mb-2 mt-4 text-display-sm font-semibold text-ink-900 first:mt-0">
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3 className="mb-1.5 mt-3 text-label-md font-semibold text-ink-900 first:mt-0">
        {children}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="mb-1 mt-3 font-semibold text-ink-900 first:mt-0">{children}</h4>
    ),
    strong: ({ children }) => <strong className="font-semibold text-ink-900">{children}</strong>,
    code: ({ children }) => (
      <code className="rounded-[4px] border border-line bg-canvas-subtle px-1 py-0.5 font-mono text-[0.8125rem] text-ink-900">
        {children}
      </code>
    ),
    pre: ({ children }) => (
      <pre className="my-3 overflow-x-auto rounded-nested border border-line bg-ink-900 p-3.5 font-mono text-[0.8125rem] leading-relaxed text-white shadow-inset [&_code]:border-0 [&_code]:bg-transparent [&_code]:p-0 [&_code]:text-white">
        {children}
      </pre>
    ),
    blockquote: ({ children }) => (
      <blockquote className="my-3 border-l-2 border-line-strong pl-3 text-ink-500">
        {children}
      </blockquote>
    ),
    hr: () => <hr className="my-4 border-line" />,
    table: ({ children }) => (
      <div className="my-3 overflow-x-auto">
        <table className="w-full border-collapse text-body-sm">{children}</table>
      </div>
    ),
    th: ({ children }) => (
      <th className="border border-line bg-surface-container-low px-2 py-1 text-left font-semibold text-ink-900">
        {children}
      </th>
    ),
    td: ({ children }) => <td className="border border-line px-2 py-1 align-top">{children}</td>,
  };

  const renderContent = (content: string) => (
    <div className="text-body-md leading-relaxed text-ink-900">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {linkCitationMarkers(content)}
      </ReactMarkdown>
    </div>
  );

  if (message.role === 'user') {
    return (
      <article className="rounded-card border border-line bg-surface shadow-card transition-fluid">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink-900 text-white">
              <User className="size-3" aria-hidden="true" />
            </span>
            <span className="truncate text-label-md font-semibold text-ink-900">
              {userEmail || 'You'}
            </span>
          </div>
          <time className="shrink-0 font-mono text-[10px] text-ink-400">
            {new Date(message.created_at).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </time>
        </header>

        <div className="px-4 py-3.5">
          <p className="whitespace-pre-wrap text-body-md leading-relaxed text-ink-800">
            {message.content}
          </p>
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
  const isClarification = metadata.answer_status === 'clarification';
  const isOutOfScope = metadata.answer_status === 'out_of_scope';
  const sqlResult = toSqlResult(message.sql_query, message.sql_result_preview);

  const answerLabel = isAborted
    ? 'Stopped'
    : isError
      ? 'Generation failed'
      : isClarification
        ? 'Clarification needed'
        : isOutOfScope
          ? 'Out of scope'
          : isRefusal
            ? 'Insufficient evidence'
            : message.route === 'sql'
              ? 'Data answer'
              : message.route === 'hybrid'
                ? 'Combined answer'
                : 'Grounded answer';
  const routeLabel =
    message.route === 'documents'
      ? 'Documents'
      : message.route === 'sql'
        ? 'Data'
        : message.route === 'hybrid'
          ? 'Docs + data'
          : message.route === 'out_of_scope'
            ? 'Out of scope'
            : message.route;

  return (
    <article className="rounded-card border border-line bg-surface shadow-card transition-fluid">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <img
            src="/verity-logo.png"
            alt=""
            className="size-6 rounded-[7px] border border-line bg-surface object-contain shadow-xs"
          />
          <span className="text-label-md font-semibold text-ink-900">Verity</span>
          <span aria-hidden="true" className="h-3 w-px bg-line-strong" />
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] ${
              isAborted || isError
                ? 'border-danger-border bg-danger-bg text-danger-text'
                : 'border-verified-border bg-verified-bg text-verified-text'
            }`}
          >
            <span
              aria-hidden="true"
              className={`size-1.5 rounded-full ${isAborted || isError ? 'bg-danger' : 'bg-verified'}`}
            />
            {answerLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {message.route && (
            <Badge
              variant={
                message.route === 'documents'
                  ? 'info'
                  : message.route === 'sql'
                    ? 'live'
                    : message.route === 'hybrid'
                      ? 'analyst'
                      : 'neutral'
              }
            >
              {routeLabel}
            </Badge>
          )}
          {message.latency_ms ? (
            <span className="hidden items-center gap-1 font-mono text-[10px] text-ink-400 sm:inline-flex">
              <Clock className="size-3" aria-hidden="true" />
              {formatLatency(message.latency_ms)}
            </span>
          ) : null}
        </div>
      </header>

      <div className="px-4 py-4 sm:px-5">
        {isRefusal ? (
          <div className="flex items-start gap-3 rounded-nested border border-warning-border bg-warning-bg/60 p-3.5 text-body-sm text-warning-text">
            <FileSearch className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
            <div>
              <p className="font-semibold text-warning">Insufficient document evidence</p>
              <p className="mt-1 leading-relaxed text-warning-text/90">{message.content}</p>
            </div>
          </div>
        ) : (
          renderContent(message.content)
        )}
        {isAborted && (
          <p className="mt-2 text-[11px] text-warning-text">
            Generation was stopped. The partial answer above was saved.
          </p>
        )}
        {isError && (
          <p className="mt-2 text-[11px] text-warning-text">
            Generation failed before the answer completed.
          </p>
        )}
        {isClarification && (
          <p className="mt-2 text-[11px] text-action">
            Tell Verity which metric, date range, or segment you mean and ask again.
          </p>
        )}
        {sqlResult ? <SqlPanel result={sqlResult} /> : null}
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-line px-4 py-2.5 text-[10px] text-ink-400">
        <div className="flex items-center gap-1.5">
          <IconButton
            size="sm"
            variant="subtle"
            aria-label="Helpful answer"
            aria-pressed={feedbackRating === 1}
            disabled={isSubmittingFeedback}
            onClick={() => handleVote(1)}
            className={feedbackRating === 1 ? 'bg-verified-bg text-verified-text' : ''}
          >
            <ThumbsUp className="size-3.5" aria-hidden="true" />
          </IconButton>
          <IconButton
            size="sm"
            variant="subtle"
            aria-label="Unhelpful answer"
            aria-pressed={feedbackRating === -1}
            disabled={isSubmittingFeedback}
            onClick={() => handleVote(-1)}
            className={feedbackRating === -1 ? 'bg-danger-bg text-danger-text' : ''}
          >
            <ThumbsDown className="size-3.5" aria-hidden="true" />
          </IconButton>
          {feedbackRating !== null && (
            <button
              type="button"
              onClick={() => {
                setFeedbackError(null);
                setCommentDialogOpen(true);
              }}
              className="text-[10px] text-ink-500 hover:text-ink-900 underline underline-offset-2 ml-1"
            >
              {feedbackComment ? 'Edit comment' : 'Add comment'}
            </button>
          )}
          {feedbackError ? (
            <span role="alert" className="ml-1 max-w-[22rem] text-[10px] text-danger-text">
              {feedbackError}
            </span>
          ) : feedbackNotice ? (
            <span role="status" className="ml-1 text-[10px] text-verified-text">
              {feedbackNotice}
            </span>
          ) : null}
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
              className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[10px] text-ink-500 transition-fluid hover:bg-inset hover:text-ink-900"
            >
              <RotateCcw className="size-3" aria-hidden="true" />
              <span>Regenerate</span>
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-[6px] px-2 py-1 text-[10px] text-ink-500 transition-fluid hover:bg-inset hover:text-ink-900"
          >
            {copied ? (
              <>
                <Check className="size-3 text-verified" aria-hidden="true" />
                <span className="text-verified-text">Copied</span>
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
          {feedbackError ? (
            <p
              role="alert"
              className="rounded-[8px] border border-danger-border bg-danger-bg px-3 py-2 text-body-sm text-danger-text"
            >
              {feedbackError}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCommentDialogOpen(false)}
              disabled={isSubmittingFeedback}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveComment}
              disabled={isSubmittingFeedback}
            >
              {isSubmittingFeedback ? 'Saving…' : 'Save feedback'}
            </Button>
          </div>
        </div>
      </Dialog>
    </article>
  );
}

function toSqlResult(
  query: string | null | undefined,
  preview: SqlResultPreview | null | undefined,
): SqlResult | null {
  if (!preview || !Array.isArray(preview.columns) || !Array.isArray(preview.rows)) {
    return null;
  }
  const sql = query || preview.sql || preview.query;
  if (!sql) return null;
  return {
    sql,
    columns: preview.columns,
    rows: preview.rows,
    row_count: preview.row_count ?? preview.rows.length,
    truncated: preview.truncated === true,
    execution_ms: preview.execution_ms ?? 0,
  };
}
