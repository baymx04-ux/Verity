import {
  FileSearch,
  History,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Badge } from '../components/ui/badge';
import { EmptyState } from '../components/ui/empty-state';
import { IconButton } from '../components/ui/icon-button';
import { Sheet } from '../components/ui/sheet';
import { Spinner } from '../components/ui/spinner';
import { Tooltip } from '../components/ui/tooltip';
import { useAuth } from '../features/auth/use-auth';
import {
  type ChatMessage,
  type Citation,
  type Conversation,
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

const DEMO_PROMPTS = [
  'Summarise the employee annual leave policy',
  'What are the return rules for damaged goods?',
  'What are the fulfillment SLAs for standard shipping?',
  'What remote work equipment expenses can be reimbursed?',
];

export function ChatPage() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [inputQuestion, setInputQuestion] = useState('');

  // Streaming state
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingStatus, setStreamingStatus] = useState<string | null>(null);
  const [streamingTokens, setStreamingTokens] = useState('');
  const [streamingCitations, setStreamingCitations] = useState<Citation[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Context drawer / sources panel state
  const [sourcesOpen, setSourcesOpen] = useState(true);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedCitationIndex, setSelectedCitationIndex] = useState<number | null>(null);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingTokens]);

  // Load conversations
  const loadConversations = useCallback(async () => {
    try {
      const list = await fetchConversations();
      setConversations(list);
      return list;
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    void loadConversations().then((list) => {
      const first = list[0];
      if (first && !activeConversationId) {
        setActiveConversationId(first.id);
      }
    });
  }, [loadConversations, activeConversationId]);

  // Load messages when active conversation changes
  useEffect(() => {
    if (!activeConversationId) {
      setMessages([]);
      return;
    }

    let isMounted = true;
    setLoadingHistory(true);
    fetchMessages(activeConversationId)
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

  // Handle new conversation
  const handleNewConversation = async () => {
    if (isStreaming) {
      abortControllerRef.current?.abort();
    }
    setActiveConversationId(null);
    setMessages([]);
    setInputQuestion('');
    setStreamingTokens('');
    setSelectedCitationIndex(null);
    setSelectedMessageId(null);
    setHistoryOpen(false);
  };

  // Handle delete conversation
  const handleDeleteConversation = async (id: string) => {
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
    } catch {
      // ignore
    }
  };

  // Handle feedback
  const handleFeedback = async (messageId: string, rating: 1 | -1, comment?: string) => {
    await submitFeedback(messageId, rating, comment);
    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === messageId
          ? { ...msg, feedback: { rating, comment: comment || null } }
          : msg,
      ),
    );
  };

  // Send question and stream answer
  const handleSend = async (overrideText?: string) => {
    const questionToSend = (overrideText || inputQuestion).trim();
    if (!questionToSend || isStreaming) return;

    setInputQuestion('');
    setIsStreaming(true);
    setStreamingTokens('');
    setStreamingCitations([]);
    setStreamingStatus('Starting answer search…');

    const controller = new AbortController();
    abortControllerRef.current = controller;

    // Optimistically add user question
    const optimisticUserMessage: ChatMessage = {
      id: `temp-${Date.now()}`,
      conversation_id: activeConversationId || 'temp',
      role: 'user',
      content: questionToSend,
      route: 'documents',
      citations: [],
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUserMessage]);

    let finalAnswerText = '';
    let finalCitations: Citation[] = [];
    let detectedRoute: string | null = 'documents';
    let targetConvId = activeConversationId;

    try {
      await streamChat({
        conversationId: activeConversationId || undefined,
        question: questionToSend,
        signal: controller.signal,
        handlers: {
          onStatus: (stage, message) => {
            setStreamingStatus(message || `Stage: ${stage}`);
          },
          onRoute: (route) => {
            detectedRoute = route;
          },
          onToken: (text) => {
            finalAnswerText += text;
            setStreamingTokens((prev) => prev + text);
          },
          onSources: (citations) => {
            finalCitations = citations;
            setStreamingCitations(citations);
          },
          onDone: (data) => {
            if (data.conversation_id && !activeConversationId) {
              targetConvId = data.conversation_id;
              setActiveConversationId(data.conversation_id);
            }
            const assistantMsg: ChatMessage = {
              id: data.message_id || `asst-${Date.now()}`,
              conversation_id: data.conversation_id || targetConvId || '',
              role: 'assistant',
              content: finalAnswerText,
              route: detectedRoute,
              citations: finalCitations,
              trace_id: data.trace_id,
              latency_ms: data.latency_ms,
              created_at: new Date().toISOString(),
            };
            setMessages((prev) => [...prev, assistantMsg]);
            void loadConversations();
          },
          onError: (err) => {
            setStreamingStatus(`Error: ${err.message}`);
          },
        },
      });
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setStreamingStatus('Answer generation was interrupted.');
      }
    } finally {
      setIsStreaming(false);
      setStreamingTokens('');
      setStreamingStatus(null);
      abortControllerRef.current = null;
    }
  };

  const handleStopStreaming = () => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
    setStreamingStatus(null);
  };

  // Determine which citations to display in Context Drawer
  const activeCitations = useMemo(() => {
    if (isStreaming) {
      return streamingCitations;
    }

    if (selectedMessageId) {
      const msg = messages.find((m) => m.id === selectedMessageId);
      if (msg?.citations) return msg.citations;
    }

    // Default to the citations of the latest assistant message
    const latestAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    return latestAssistant?.citations || [];
  }, [isStreaming, streamingCitations, selectedMessageId, messages]);

  const activeConversationTitle = useMemo(() => {
    const active = conversations.find((c) => c.id === activeConversationId);
    return active?.title || 'New Session';
  }, [conversations, activeConversationId]);

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 py-3 sm:px-6 lg:px-8 lg:py-5">
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* Left Desktop Conversation Rail */}
        <div className="hidden lg:block lg:min-h-[calc(100vh-8.5rem)]">
          <ConversationRail
            conversations={conversations}
            activeConversationId={activeConversationId}
            onSelectConversation={(id) => {
              setActiveConversationId(id);
              setSelectedMessageId(null);
              setSelectedCitationIndex(null);
            }}
            onNewConversation={handleNewConversation}
            onDeleteConversation={handleDeleteConversation}
          />
        </div>

        {/* Center Main Analytics Workspace + Right Context Drawer */}
        <section className="flex min-h-[calc(100vh-8.5rem)] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-xs">
          {/* Top Breadcrumb & Status Bar */}
          <header className="flex items-center justify-between border-b border-line px-4 py-3 sm:px-6 bg-surface">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-display-md text-ink-900 truncate">
                  Ask Verity
                </h1>
                <Badge variant="verified">Production Replica (Live)</Badge>
                <Badge variant="info">Phase 3 · Grounded RAG</Badge>
              </div>
              <p className="mt-0.5 truncate text-body-sm text-ink-500">
                {activeConversationTitle} · Cited evidence from company documents
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
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

          {/* Split Workspace Layout */}
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Center Message Feed & Composer */}
            <div className="flex flex-1 flex-col min-w-0 bg-[#FAF8FF]">
              {/* Message Feed */}
              <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
                {loadingHistory ? (
                  <div className="flex h-64 flex-col items-center justify-center text-center">
                    <Spinner label="Loading conversation history…" />
                    <p className="mt-2 text-body-sm text-ink-500">Retrieving attested messages…</p>
                  </div>
                ) : messages.length === 0 && !isStreaming ? (
                  <div className="mx-auto max-w-xl py-8 sm:py-12">
                    <EmptyState
                      icon={<Sparkles aria-hidden="true" />}
                      title="Your first answer starts here"
                      description="Ask any question across internal documents. Answers stream with line-item citations and verification checksums."
                      action={
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          <Badge variant="verified">Grounded Answers</Badge>
                          <Badge variant="analyst">Zero Hallucination Gate</Badge>
                          <Badge variant="neutral">SHA-256 Attestation</Badge>
                        </div>
                      }
                    />

                    <div className="mt-6 space-y-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                        Suggested Inquiries from Demo Dataset
                      </p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {DEMO_PROMPTS.map((prompt) => (
                          <button
                            key={prompt}
                            type="button"
                            onClick={() => handleSend(prompt)}
                            className="flex items-start gap-2.5 rounded-lg border border-slate-200/90 bg-white p-3 text-left text-body-sm text-slate-700 shadow-xs hover:border-sky-300 hover:bg-sky-50/40 hover:text-sky-900 transition-colors"
                          >
                            <FileSearch
                              aria-hidden="true"
                              className="size-4 shrink-0 text-sky-600 mt-0.5"
                            />
                            <span className="line-clamp-2">{prompt}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <>
                    {messages.map((message) => (
                      <div
                        key={message.id}
                        onClick={() => setSelectedMessageId(message.id)}
                      >
                        <MessageItem
                          message={message}
                          selectedCitationIndex={selectedCitationIndex}
                          onSelectCitation={(index) => {
                            setSelectedMessageId(message.id);
                            setSelectedCitationIndex(index);
                            setSourcesOpen(true);
                          }}
                          onFeedback={handleFeedback}
                          userEmail={user?.email}
                        />
                      </div>
                    ))}

                    {/* Active streaming card */}
                    {isStreaming && (
                      <article className="rounded-lg border border-sky-300 bg-white p-4 shadow-xs sm:p-5">
                        <header className="flex items-center justify-between pb-3 border-b border-slate-100 text-xs text-ink-500">
                          <div className="flex items-center gap-2">
                            <span className="flex size-6 items-center justify-center rounded-full bg-sky-100 text-sky-700 animate-pulse">
                              <Sparkles className="size-3.5" aria-hidden="true" />
                            </span>
                            <span className="font-semibold text-slate-800">Verity Engine</span>
                            <span className="text-slate-300">•</span>
                            <span className="text-[11px] font-medium text-sky-700 bg-sky-50 px-2 py-0.5 rounded border border-sky-200">
                              {streamingStatus || 'Streaming answer…'}
                            </span>
                          </div>
                          <Badge variant="live">Generating…</Badge>
                        </header>

                        <div className="mt-3">
                          {streamingTokens ? (
                            <div className="text-body-md text-slate-800 leading-relaxed font-sans whitespace-pre-wrap">
                              {streamingTokens}
                              <span className="inline-block size-2 bg-sky-600 rounded-full animate-ping ml-1" />
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 py-3 text-body-sm text-ink-500">
                              <Spinner size="sm" label="Searching documents…" />
                              <span>{streamingStatus || 'Searching accessible documents…'}</span>
                            </div>
                          )}
                        </div>
                      </article>
                    )}

                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>

              {/* Docked Query Submission Bar */}
              <Composer
                question={inputQuestion}
                onChange={setInputQuestion}
                onSubmit={() => handleSend()}
                onStop={handleStopStreaming}
                isStreaming={isStreaming}
                disabled={loadingHistory}
              />
            </div>

            {/* Right Desktop Source Evidence & Context Drawer (380px) */}
            {sourcesOpen && (
              <div className="hidden md:block w-[380px] shrink-0 h-full">
                <ContextDrawer
                  citations={activeCitations}
                  selectedIndex={selectedCitationIndex}
                  onSelectCitation={(index) => setSelectedCitationIndex(index)}
                  onClose={() => setSourcesOpen(false)}
                />
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Mobile Drawer for Sources */}
      <Sheet
        open={sourcesOpen && window.innerWidth < 768}
        onClose={() => setSourcesOpen(false)}
        title="Source Evidence"
        description="Verified document passages and checksums for the active answer."
        side="right"
      >
        <div className="h-full">
          <ContextDrawer
            citations={activeCitations}
            selectedIndex={selectedCitationIndex}
            onSelectCitation={(index) => setSelectedCitationIndex(index)}
          />
        </div>
      </Sheet>

      {/* Mobile Drawer for Conversations */}
      <Sheet
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="Conversations"
        description="Your recent verified threads."
        side="left"
      >
        <div className="h-full">
          <ConversationRail
            conversations={conversations}
            activeConversationId={activeConversationId}
            onSelectConversation={(id) => {
              setActiveConversationId(id);
              setHistoryOpen(false);
            }}
            onNewConversation={() => {
              handleNewConversation();
              setHistoryOpen(false);
            }}
            onDeleteConversation={handleDeleteConversation}
            onCloseMobile={() => setHistoryOpen(false)}
          />
        </div>
      </Sheet>
    </div>
  );
}
