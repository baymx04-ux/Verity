import {
  ArrowUpRight,
  Database,
  FileSearch,
  FileText,
  History,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { SqlPanel } from '../components/sql/SqlPanel';
import { Alert } from '../components/ui/alert';
import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { Dialog } from '../components/ui/dialog';
import { IconButton } from '../components/ui/icon-button';
import { Sheet } from '../components/ui/sheet';
import { Spinner } from '../components/ui/spinner';
import { Tooltip } from '../components/ui/tooltip';
import { useAuth } from '../features/auth/use-auth';
import {
  type ChatMessage,
  type ChatMode,
  type ChatRoute,
  type Citation,
  type Conversation,
  type SqlResultPreview,
  deleteConversation,
  fetchConversations,
  fetchMessages,
  streamChat,
  submitFeedback,
} from '../features/chat/chat-api';
import { Composer } from '../features/chat/composer';
import { ContextDrawer } from '../features/chat/context-drawer';
import { ConversationRail } from '../features/chat/conversation-rail';
import { MessageItem } from '../features/chat/message-item';
import { getDocumentDownloadUrl } from '../features/documents/document-api';

const DEMO_PROMPTS: Array<{ text: string; mode: ChatMode }> = [
  { text: 'Summarise the employee annual leave policy', mode: 'auto' },
  { text: 'What was total revenue by region last quarter?', mode: 'auto' },
  { text: 'Is our return rate within the policy target?', mode: 'auto' },
  { text: 'Which product categories have the highest return rate?', mode: 'auto' },
];

const STREAM_START = 'Starting answer search…';

interface StreamError {
  code: string;
  message: string;
}

function useMediaQuery(query: string): boolean {
  const getMatches = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false;

  const [matches, setMatches] = useState(getMatches);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matches;
}

export function ChatPage() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [inputQuestion, setInputQuestion] = useState('');
  const [mode, setMode] = useState<ChatMode>('auto');

  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingStatus, setStreamingStatus] = useState<string | null>(null);
  const [streamingTokens, setStreamingTokens] = useState('');
  const [streamingCitations, setStreamingCitations] = useState<Citation[]>([]);
  const [streamingSql, setStreamingSql] = useState<SqlResultPreview | null>(null);
  const [streamError, setStreamError] = useState<StreamError | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const streamingTextRef = useRef('');
  const activeConversationRef = useRef<string | null>(activeConversationId);
  activeConversationRef.current = activeConversationId;
  // A conversation created by the active stream already has its user turn in
  // state. Reloading history before the answer lands could replace it.
  const skipHistoryLoadRef = useRef<string | null>(null);

  // Context drawer / sources panel state
  const [sourcesOpen, setSourcesOpen] = useState(() =>
    typeof window === 'undefined' || typeof window.matchMedia !== 'function'
      ? true
      : !window.matchMedia('(max-width: 767px)').matches,
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedCitationIndex, setSelectedCitationIndex] = useState<number | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const isMobile = useMediaQuery('(max-width: 767px)');

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingTokens, scrollToBottom]);

  const loadConversations = useCallback(async () => {
    try {
      const list = await fetchConversations();
      setConversations(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  // Load the rail once. Do not re-select the first thread when the user asks
  // for a new conversation; the old effect made "New conversation" impossible.
  useEffect(() => {
    let mounted = true;
    void loadConversations().then((list) => {
      const first = list[0];
      if (mounted && first) {
        setActiveConversationId(first.id);
      }
    });
    return () => {
      mounted = false;
    };
  }, [loadConversations]);

  // Load messages when the active conversation changes.
  useEffect(() => {
    const conversationId = activeConversationId;
    if (!conversationId) {
      setMessages([]);
      return;
    }

    if (skipHistoryLoadRef.current === conversationId) {
      skipHistoryLoadRef.current = null;
      setLoadingHistory(false);
      return;
    }

    let isMounted = true;
    setLoadingHistory(true);
    fetchMessages(conversationId)
      .then((msgs) => {
        if (isMounted) {
          setMessages(msgs);
          setSelectedMessageId(null);
          setSelectedCitationIndex(null);
        }
      })
      .catch(() => {
        if (isMounted) setMessages([]);
      })
      .finally(() => {
        if (isMounted) setLoadingHistory(false);
      });

    return () => {
      isMounted = false;
    };
  }, [activeConversationId]);

  const handleNewConversation = () => {
    abortControllerRef.current?.abort();
    setActiveConversationId(null);
    setMessages([]);
    setInputQuestion('');
    setStreamingTokens('');
    setStreamingCitations([]);
    setStreamingSql(null);
    setStreamError(null);
    setSelectedCitationIndex(null);
    setSelectedMessageId(null);
    setHistoryOpen(false);
  };

  const handleSelectConversation = (id: string) => {
    if (id !== activeConversationId) {
      abortControllerRef.current?.abort();
    }
    setActiveConversationId(id);
    setSelectedMessageId(null);
    setSelectedCitationIndex(null);
    setHistoryOpen(false);
  };

  const [conversationToDelete, setConversationToDelete] = useState<Conversation | null>(null);
  const [isDeletingConversation, setIsDeletingConversation] = useState(false);

  const handleRequestDeleteConversation = (id: string) => {
    const target = conversations.find((c) => c.id === id);
    setConversationToDelete(
      target ?? {
        id,
        user_id: '',
        title: 'Conversation',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    );
  };

  const handleConfirmDeleteConversation = async () => {
    if (!conversationToDelete) {
      return;
    }
    const id = conversationToDelete.id;
    setIsDeletingConversation(true);
    try {
      await deleteConversation(id);
      const updated = await loadConversations();
      if (activeConversationId === id) {
        const first = updated[0];
        if (first) {
          setActiveConversationId(first.id);
        } else {
          setActiveConversationId(null);
          setMessages([]);
        }
      }
      setConversationToDelete(null);
    } catch {
      // Deleting is best-effort; a stale rail entry is harmless.
    } finally {
      setIsDeletingConversation(false);
    }
  };

  const handleFeedback = async (messageId: string, rating: 1 | -1, comment?: string) => {
    await submitFeedback(messageId, rating, comment);
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId ? { ...msg, feedback: { rating, comment: comment || null } } : msg,
      ),
    );
  };

  const handleOpenDocument = async (documentId: string) => {
    const { url } = await getDocumentDownloadUrl(documentId);
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const appendAssistantMessage = (
    conversationId: string,
    content: string,
    options: {
      id?: string;
      citations?: Citation[];
      route?: string | null;
      traceId?: string | null;
      latencyMs?: number | null;
      metadata?: ChatMessage['metadata'];
      sqlQuery?: string | null;
      sqlResultPreview?: SqlResultPreview | null;
    } = {},
  ) => {
    const assistantMessage: ChatMessage = {
      id: options.id || `asst-${Date.now()}`,
      conversation_id: conversationId,
      role: 'assistant',
      content,
      route: options.route ?? 'documents',
      citations: options.citations ?? [],
      trace_id: options.traceId ?? null,
      latency_ms: options.latencyMs ?? null,
      metadata: options.metadata ?? {},
      ...(options.sqlQuery ? { sql_query: options.sqlQuery } : {}),
      ...(options.sqlResultPreview ? { sql_result_preview: options.sqlResultPreview } : {}),
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, assistantMessage]);
  };

  const runStream = async (options: {
    question?: string;
    regenerate?: boolean;
    conversationId?: string | null;
    route?: ChatRoute;
  }) => {
    if (isStreaming) return;

    const regenerate = options.regenerate === true;
    const question = options.question?.trim();
    const conversationId = options.conversationId ?? activeConversationId;
    const route = options.route ?? mode;
    if (!regenerate && !question) return;

    setStreamError(null);
    setIsStreaming(true);
    setStreamingStatus(regenerate ? 'Regenerating answer…' : STREAM_START);
    setStreamingTokens('');
    setStreamingCitations([]);
    setStreamingSql(null);
    streamingTextRef.current = '';

    const controller = new AbortController();
    abortControllerRef.current = controller;

    let finalText = '';
    let finalCitations: Citation[] = [];
    // The stream callbacks mutate this object after the synchronous setup.
    // Using an object (rather than a local that TypeScript narrows to null)
    // keeps the SQL result visible to the finally block.
    const sqlState: { value: SqlResultPreview | null } = { value: null };
    let detectedRoute: string | null = regenerate ? route : null;
    let streamFailure: StreamError | null = null;
    let targetConversationId = conversationId;

    if (!regenerate && question) {
      const optimisticUserMessage: ChatMessage = {
        id: `temp-${Date.now()}`,
        conversation_id: conversationId || 'temp',
        role: 'user',
        content: question,
        route: null,
        citations: [],
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, optimisticUserMessage]);
    }

    try {
      await streamChat({
        ...(conversationId ? { conversationId } : {}),
        ...(question ? { question } : {}),
        ...(regenerate ? { regenerate: true } : {}),
        route,
        signal: controller.signal,
        handlers: {
          onConversation: (conversationIdFromStream) => {
            targetConversationId = conversationIdFromStream;
            if (!conversationId) {
              setActiveConversationId(conversationIdFromStream);
            }
          },
          onStatus: (stage, message) => {
            setStreamingStatus(message || `Stage: ${stage}`);
          },
          onRoute: (route) => {
            detectedRoute = route;
          },
          onToken: (text) => {
            finalText += text;
            streamingTextRef.current = finalText;
            setStreamingTokens(finalText);
          },
          onSources: (citations) => {
            finalCitations = citations;
            setStreamingCitations(citations);
          },
          onSql: (result) => {
            sqlState.value = result;
            setStreamingSql(result);
          },
          onDone: (data) => {
            if (data.conversation_id) {
              targetConversationId = data.conversation_id;
              if (!conversationId) {
                setActiveConversationId(data.conversation_id);
              }
            }

            const resolvedConversationId =
              data.conversation_id || targetConversationId || conversationId || '';
            const sql = sqlState.value;
            if (finalText.trim()) {
              appendAssistantMessage(resolvedConversationId, finalText, {
                ...(data.message_id ? { id: data.message_id } : {}),
                citations: finalCitations,
                route: detectedRoute ?? data.route ?? route,
                traceId: data.trace_id ?? null,
                latencyMs: data.latency_ms ?? null,
                metadata: {
                  ...(data.answer_status ? { answer_status: data.answer_status } : {}),
                  low_confidence: data.low_confidence ?? false,
                  ...(data.cited_indices ? { cited_indices: data.cited_indices } : {}),
                  ...(data.citation_count !== undefined
                    ? { citation_count: data.citation_count }
                    : {}),
                  ...(data.sql_outcome ? { sql_outcome: data.sql_outcome } : {}),
                  ...(data.router ? { router: data.router } : {}),
                  aborted: false,
                },
                ...(sql?.sql || sql?.query ? { sqlQuery: sql.sql ?? sql.query ?? null } : {}),
                ...(sql ? { sqlResultPreview: sql } : {}),
              });
            }
            void loadConversations();
          },
          onError: (error) => {
            streamFailure = error;
            setStreamError(error);
          },
        },
      });
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') {
        const failure = {
          code: 'network_error',
          message:
            error instanceof Error
              ? error.message
              : 'The answer stream was interrupted. Please try again.',
        };
        streamFailure = failure;
        setStreamError(failure);
      }
    } finally {
      const aborted = controller.signal.aborted;
      const stillInConversation =
        !targetConversationId || activeConversationRef.current === targetConversationId;
      const sql = sqlState.value;

      // Keep a stopped/failed partial answer visible. The gateway persists the
      // same partial text with an `aborted`/`error` status, so a later reload
      // reconciles to one message.
      if (stillInConversation && finalText.trim() && (aborted || streamFailure)) {
        appendAssistantMessage(targetConversationId || conversationId || '', finalText, {
          citations: finalCitations,
          route: detectedRoute,
          metadata: {
            answer_status: aborted ? 'aborted' : 'error',
            aborted,
            low_confidence: false,
            ...(streamFailure ? { error_code: streamFailure.code } : {}),
          },
          ...(sql?.sql || sql?.query ? { sqlQuery: sql.sql ?? sql.query ?? null } : {}),
          ...(sql ? { sqlResultPreview: sql } : {}),
        });
      }

      setIsStreaming(false);
      setStreamingTokens('');
      setStreamingSql(null);
      setStreamingStatus(null);
      streamingTextRef.current = '';
      abortControllerRef.current = null;
    }
  };

  const handleSend = (overrideText?: string, overrideMode?: ChatMode) => {
    const questionToSend = (overrideText || inputQuestion).trim();
    if (!questionToSend || isStreaming) return;

    const route = overrideMode ?? mode;
    if (overrideMode) setMode(overrideMode);
    setInputQuestion('');
    void runStream({ question: questionToSend, route });
  };

  const handleStopStreaming = () => {
    abortControllerRef.current?.abort();
  };

  const handleRegenerate = () => {
    if (isStreaming || !activeConversationId) return;

    const lastIndex = messages.length - 1;
    const last = messages[lastIndex];
    if (last?.role !== 'assistant') return;

    const route: ChatMode =
      last.route === 'sql' ? 'sql' : last.route === 'documents' ? 'documents' : 'auto';
    setMode(route);
    setMessages((prev) => prev.slice(0, -1));
    void runStream({ regenerate: true, conversationId: activeConversationId, route });
  };

  const handleRetry = () => {
    if (!streamError) return;
    setStreamError(null);

    if (activeConversationId) {
      const last = messages[messages.length - 1];
      if (last?.role === 'user') {
        // A failed turn already stored the question; regenerate without adding
        // a duplicate user message.
        void runStream({ regenerate: true, conversationId: activeConversationId, route: mode });
        return;
      }
    }

    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    if (lastUser) {
      void runStream({
        question: lastUser.content,
        conversationId: activeConversationId,
        route: mode,
      });
    }
  };

  // Determine which citations to display in Context Drawer.
  const activeCitations = useMemo(() => {
    if (isStreaming) {
      return streamingCitations;
    }

    if (selectedMessageId) {
      const msg = messages.find((m) => m.id === selectedMessageId);
      if (msg?.citations) return msg.citations;
    }

    const latestAssistant = [...messages]
      .reverse()
      .find((m) => m.role === 'assistant' && m.citations && m.citations.length > 0);
    return latestAssistant?.citations || [];
  }, [isStreaming, streamingCitations, selectedMessageId, messages]);

  const activeConversationTitle = useMemo(() => {
    const active = conversations.find((c) => c.id === activeConversationId);
    return active?.title || 'New session';
  }, [conversations, activeConversationId]);

  const lastAssistantIndex = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]?.role === 'assistant') return index;
    }
    return -1;
  }, [messages]);

  return (
    <div className="mx-auto flex h-[calc(100dvh-8.5rem)] w-full max-w-[1600px] flex-col px-3 py-3 sm:px-4 md:h-[calc(100dvh-4rem)] lg:px-6">
      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Left desktop conversation rail */}
        <div className="hidden h-full lg:block">
          <ConversationRail
            conversations={conversations}
            activeConversationId={activeConversationId}
            onSelectConversation={handleSelectConversation}
            onNewConversation={handleNewConversation}
            onDeleteConversation={handleRequestDeleteConversation}
          />
        </div>

        {/* Center workspace + right evidence drawer */}
        <section className="flex min-h-0 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card">
          <header className="flex items-center justify-between gap-3 border-b border-line bg-surface px-4 py-3 sm:px-5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate font-display text-display-md text-ink-900">Ask Verity</h1>
                <Badge variant="verified" dot>
                  Grounded answers
                </Badge>
              </div>
              <p className="mt-0.5 truncate text-body-sm text-ink-500">{activeConversationTitle}</p>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {activeConversationId ? (
                <Tooltip label="Delete chat">
                  <IconButton
                    aria-label="Delete chat"
                    size="sm"
                    variant="ghost"
                    onClick={() => handleRequestDeleteConversation(activeConversationId)}
                    className="text-ink-400 hover:bg-danger-bg hover:text-danger"
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </IconButton>
                </Tooltip>
              ) : null}

              <IconButton
                aria-label="Open conversation history"
                size="sm"
                variant="secondary"
                className="lg:hidden"
                onClick={() => setHistoryOpen(true)}
              >
                <History aria-hidden="true" />
              </IconButton>

              <Tooltip label={sourcesOpen ? 'Collapse evidence drawer' : 'Expand evidence drawer'}>
                <IconButton
                  aria-label="Toggle evidence drawer"
                  size="sm"
                  variant="secondary"
                  onClick={() => setSourcesOpen(!sourcesOpen)}
                  className="hidden md:inline-flex"
                >
                  {sourcesOpen ? (
                    <PanelRightClose aria-hidden="true" />
                  ) : (
                    <PanelRightOpen aria-hidden="true" />
                  )}
                </IconButton>
              </Tooltip>

              <IconButton
                aria-label="Open source evidence drawer"
                size="sm"
                variant="secondary"
                onClick={() => setSourcesOpen(true)}
                className="md:hidden"
              >
                <FileSearch aria-hidden="true" />
              </IconButton>
            </div>
          </header>

          <div className="flex min-h-0 flex-1">
            {/* Center message feed and composer */}
            <div className="flex min-w-0 flex-1 flex-col bg-canvas/40">
              <div
                className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-6"
                aria-live="polite"
                aria-relevant="additions text"
              >
                {loadingHistory ? (
                  <div className="flex h-64 flex-col items-center justify-center text-center">
                    <Spinner label="Loading conversation history…" />
                    <p className="mt-2 text-body-sm text-ink-500">Retrieving saved messages…</p>
                  </div>
                ) : messages.length === 0 && !isStreaming ? (
                  <div className="mx-auto flex h-full max-w-3xl flex-col justify-center py-6">
                    <div className="text-center">
                      <span className="mx-auto flex size-14 items-center justify-center rounded-[16px] border border-line bg-surface shadow-elevated">
                        <img src="/verity-logo.png" alt="" className="size-9 object-contain" />
                      </span>
                      <h2 className="mt-5 font-display text-display-xl tracking-display text-ink-900">
                        Ask anything about your work
                      </h2>
                      <p className="mx-auto mt-2 max-w-lg text-body-md leading-relaxed text-ink-500">
                        Verity answers from your indexed documents and company data. Every answer
                        keeps its sources, so you can verify the passage or query behind it.
                      </p>
                      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                        <Badge variant="info">Access-filtered sources</Badge>
                        <Badge variant="neutral">Inline citations</Badge>
                        <Badge variant="verified">Read-only data</Badge>
                      </div>
                    </div>

                    <div className="mt-9">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-400">
                        Start with a question
                      </p>
                      <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
                        {DEMO_PROMPTS.map((prompt) => {
                          const isDataPrompt =
                            prompt.text.includes('revenue') || prompt.text.includes('return rate');
                          return (
                            <button
                              key={prompt.text}
                              type="button"
                              onClick={() => handleSend(prompt.text, prompt.mode)}
                              className="group flex items-start gap-3 rounded-card border border-line bg-surface p-3.5 text-left shadow-xs transition-fluid hover:-translate-y-px hover:border-action-border hover:shadow-card"
                            >
                              <span
                                className={`flex size-8 shrink-0 items-center justify-center rounded-[9px] border ${
                                  isDataPrompt
                                    ? 'border-verified-border bg-verified-bg text-verified-text'
                                    : 'border-action-border bg-action-tint text-action'
                                }`}
                              >
                                {isDataPrompt ? (
                                  <Database aria-hidden="true" className="size-4" />
                                ) : (
                                  <FileText aria-hidden="true" className="size-4" />
                                )}
                              </span>
                              <span className="min-w-0 flex-1 text-body-sm leading-relaxed text-ink-700 group-hover:text-ink-900">
                                {prompt.text}
                              </span>
                              <ArrowUpRight
                                aria-hidden="true"
                                className="mt-0.5 size-3.5 shrink-0 text-ink-400 transition-fluid group-hover:text-action"
                              />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {messages.map((message, index) => (
                      <div key={message.id}>
                        <MessageItem
                          message={message}
                          selectedCitationIndex={selectedCitationIndex}
                          onSelectCitation={(citationIndex) => {
                            setSelectedMessageId(message.id);
                            setSelectedCitationIndex(citationIndex);
                            setSourcesOpen(true);
                          }}
                          onFeedback={handleFeedback}
                          userEmail={user?.email}
                          {...(message.role === 'assistant' &&
                          index === lastAssistantIndex &&
                          !isStreaming
                            ? { onRegenerate: handleRegenerate }
                            : {})}
                        />
                      </div>
                    ))}

                    {isStreaming && (
                      <article
                        className="rounded-card border border-action-border bg-surface shadow-elevated"
                        aria-live="polite"
                      >
                        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <img
                              src="/verity-logo.png"
                              alt=""
                              className="size-6 animate-pulse-soft rounded-[7px] border border-line bg-surface object-contain"
                            />
                            <span className="text-label-md font-semibold text-ink-900">Verity</span>
                            <span aria-hidden="true" className="h-3 w-px bg-line-strong" />
                            <span className="inline-flex items-center gap-1.5 rounded-full border border-action-border bg-action-tint px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.04em] text-action">
                              <span
                                aria-hidden="true"
                                className="size-1.5 animate-pulse-soft rounded-full bg-action-accent"
                              />
                              {streamingStatus || 'Generating answer…'}
                            </span>
                          </div>
                        </header>

                        <div className="px-4 py-4 sm:px-5">
                          {streamingSql ? (
                            <SqlPanel
                              result={{
                                sql: streamingSql.sql ?? streamingSql.query ?? '',
                                columns: streamingSql.columns,
                                rows: streamingSql.rows,
                                row_count: streamingSql.row_count,
                                truncated: streamingSql.truncated,
                                execution_ms: streamingSql.execution_ms ?? 0,
                              }}
                            />
                          ) : null}

                          <div className="mt-1">
                            {streamingTokens ? (
                              <div className="whitespace-pre-wrap font-sans text-body-md leading-relaxed text-ink-900">
                                {streamingTokens}
                                <span className="ml-1 inline-block size-2 animate-ping rounded-full bg-action-accent" />
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 py-2 text-body-sm text-ink-500">
                                <Spinner
                                  label={
                                    mode === 'sql'
                                      ? 'Preparing a read-only query…'
                                      : mode === 'auto'
                                        ? 'Checking documents and data…'
                                        : 'Searching documents…'
                                  }
                                />
                                <span>
                                  {streamingStatus ||
                                    (mode === 'sql'
                                      ? 'Working on a safe read-only query…'
                                      : mode === 'auto'
                                        ? 'Reviewing documents and company data…'
                                        : 'Finding relevant passages…')}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </article>
                    )}

                    {streamError && (
                      <Alert variant="danger" title="Answer interrupted">
                        <p>{streamError.message}</p>
                        <div className="mt-2">
                          <Button variant="secondary" size="sm" onClick={handleRetry}>
                            <RotateCcw className="mr-1.5 size-3.5" aria-hidden="true" />
                            Try again
                          </Button>
                        </div>
                      </Alert>
                    )}

                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>

              <Composer
                question={inputQuestion}
                onChange={setInputQuestion}
                onSubmit={() => handleSend()}
                onStop={handleStopStreaming}
                isStreaming={isStreaming}
                disabled={loadingHistory}
                mode={mode}
                onModeChange={setMode}
              />
            </div>

            {/* Right desktop evidence drawer */}
            {sourcesOpen && (
              <div className="hidden h-full w-[360px] shrink-0 md:block">
                <ContextDrawer
                  citations={activeCitations}
                  selectedIndex={selectedCitationIndex}
                  onSelectCitation={(index) => setSelectedCitationIndex(index)}
                  onClose={() => setSourcesOpen(false)}
                  onOpenDocument={handleOpenDocument}
                />
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Mobile drawer for sources */}
      <Sheet
        open={isMobile && sourcesOpen}
        onClose={() => setSourcesOpen(false)}
        title="Source evidence"
        description="Accessible passages for the active or most recent cited answer."
        side="right"
      >
        <div className="h-full">
          <ContextDrawer
            citations={activeCitations}
            selectedIndex={selectedCitationIndex}
            onSelectCitation={(index) => setSelectedCitationIndex(index)}
            onOpenDocument={handleOpenDocument}
            embedded
          />
        </div>
      </Sheet>

      {/* Mobile drawer for conversations */}
      <Sheet
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="Conversations"
        description="Your recent threads."
        side="left"
      >
        <div className="h-full">
          <ConversationRail
            conversations={conversations}
            activeConversationId={activeConversationId}
            onSelectConversation={handleSelectConversation}
            onNewConversation={handleNewConversation}
            onDeleteConversation={handleRequestDeleteConversation}
            onCloseMobile={() => setHistoryOpen(false)}
            embedded
          />
        </div>
      </Sheet>

      <Dialog
        open={Boolean(conversationToDelete)}
        onClose={() => {
          if (!isDeletingConversation) {
            setConversationToDelete(null);
          }
        }}
        title="Delete chat"
        description="This action cannot be undone."
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              disabled={isDeletingConversation}
              onClick={() => setConversationToDelete(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isDeletingConversation}
              onClick={() => void handleConfirmDeleteConversation()}
            >
              {isDeletingConversation ? (
                <span className="flex items-center gap-1.5">
                  <Spinner label="Deleting" />
                  <span>Deleting…</span>
                </span>
              ) : (
                'Delete chat'
              )}
            </Button>
          </div>
        }
      >
        <p className="text-body-sm text-ink-600">
          Are you sure you want to delete{' '}
          <strong className="font-semibold text-ink-900">
            {conversationToDelete?.title || 'this conversation'}
          </strong>
          ? All messages and citations in this chat will be permanently removed.
        </p>
      </Dialog>
    </div>
  );
}
