import {
  ArrowUp,
  BookOpen,
  FileSearch,
  History,
  MessageSquarePlus,
  PanelRightOpen,
  Sparkles,
} from 'lucide-react';
import { useState } from 'react';

import { Badge } from '../components/ui/badge';
import { Button } from '../components/ui/button';
import { EmptyState } from '../components/ui/empty-state';
import { IconButton } from '../components/ui/icon-button';
import { Sheet } from '../components/ui/sheet';
import { Spinner } from '../components/ui/spinner';
import { Textarea } from '../components/ui/textarea';
import { Tooltip } from '../components/ui/tooltip';

function ConversationRail() {
  return (
    <aside
      aria-label="Conversations"
      className="hidden min-h-[70vh] flex-col rounded-card border border-line bg-surface shadow-xs lg:flex"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="font-display text-display-sm text-ink-900">Conversations</h2>
        <Tooltip label="Conversation history arrives with chat">
          <span>
            <IconButton aria-label="New conversation" size="sm" variant="subtle" disabled>
              <MessageSquarePlus aria-hidden="true" />
            </IconButton>
          </span>
        </Tooltip>
      </div>
      <div className="flex flex-1 flex-col items-center justify-center px-5 py-8 text-center">
        <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-surface-container-low text-ink-400">
          <History aria-hidden="true" className="size-4" />
        </span>
        <p className="text-label-md text-ink-700">No conversations yet</p>
        <p className="mt-1 max-w-44 text-body-sm leading-[1.3rem] text-ink-500">
          Your threads will collect here once chat is connected.
        </p>
      </div>
      <div className="border-t border-line px-4 py-3">
        <p className="text-body-sm text-ink-500">Phase 3 · grounded chat</p>
      </div>
    </aside>
  );
}

export function ChatPage() {
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className="mx-auto w-full max-w-[1500px] px-4 py-4 sm:px-6 lg:px-8 lg:py-6">
      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <ConversationRail />

        <section className="flex min-h-[calc(100vh-10rem)] flex-col overflow-hidden rounded-card border border-line bg-surface shadow-xs">
          <header className="flex items-start justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-6">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-display-md text-ink-900">Ask Verity</h1>
                <Badge variant="info">Phase 1 shell</Badge>
              </div>
              <p className="mt-0.5 text-body-sm text-ink-500">
                Grounded answers from documents and business data.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <IconButton
                aria-label="Open conversation history"
                size="sm"
                variant="secondary"
                className="lg:hidden"
                onClick={() => setHistoryOpen(true)}
              >
                <History aria-hidden="true" />
              </IconButton>
              <Tooltip label="Sources panel">
                <IconButton
                  aria-label="Open sources panel"
                  size="sm"
                  variant="secondary"
                  onClick={() => setSourcesOpen(true)}
                >
                  <PanelRightOpen aria-hidden="true" />
                </IconButton>
              </Tooltip>
            </div>
          </header>

          <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
            <div className="w-full max-w-xl">
              <EmptyState
                icon={<Sparkles aria-hidden="true" />}
                title="Your first answer starts here"
                description="Chat, retrieval, and citations arrive in the next build phases. This shell reserves the workspace so the verified answer flow lands in the right place."
                action={
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <Badge variant="verified">Citation-ready</Badge>
                    <Badge variant="neutral">SQL-inspectable</Badge>
                    <Badge variant="warning">Chat not connected</Badge>
                  </div>
                }
              />

              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                {['What changed in the Q3 revenue plan?', 'Summarise the travel policy'].map(
                  (prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      disabled
                      className="flex items-center gap-2 rounded-nested border border-line bg-surface-container-low px-3.5 py-3 text-left text-body-sm text-ink-500 disabled:cursor-not-allowed disabled:opacity-80"
                    >
                      <FileSearch aria-hidden="true" className="size-4 shrink-0 text-ink-400" />
                      {prompt}
                    </button>
                  ),
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-line bg-surface-container-low/60 px-4 py-3 sm:px-6">
            <div className="relative">
              <label htmlFor="composer" className="sr-only">
                Ask a question
              </label>
              <Textarea
                id="composer"
                disabled
                placeholder="Ask across documents and business data…"
                className="min-h-16 resize-none bg-surface pr-14"
              />
              <Button
                type="button"
                size="sm"
                aria-label="Send question"
                disabled
                className="absolute bottom-2.5 right-2.5 size-8 p-0"
              >
                <ArrowUp aria-hidden="true" className="size-4" />
              </Button>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-body-sm text-ink-500">
              <BookOpen aria-hidden="true" className="size-3.5" />
              Answers will cite their sources. Refusals are explicit, never invented.
            </p>
          </div>
        </section>
      </div>

      <Sheet
        open={sourcesOpen}
        onClose={() => setSourcesOpen(false)}
        title="Sources"
        description="Citations for the active answer will appear here."
        side="right"
      >
        <EmptyState
          icon={<FileSearch aria-hidden="true" />}
          title="No answer selected"
          description="Once chat is connected, this panel shows the documents, snippets, and SQL behind each response."
        />
      </Sheet>

      <Sheet
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="Conversations"
        description="Your recent threads will collect here."
        side="left"
      >
        <div className="flex items-center justify-center py-10 text-center">
          <Spinner label="Loading conversation history" />
        </div>
        <p className="text-center text-body-sm text-ink-500">
          Conversation history lands with chat.
        </p>
      </Sheet>
    </div>
  );
}
