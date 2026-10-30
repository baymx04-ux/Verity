import { History, MessageSquare, Plus, Search, Trash2, X } from 'lucide-react';
import { useState } from 'react';

import { IconButton } from '../../components/ui/icon-button';
import { Input } from '../../components/ui/input';
import type { Conversation } from './chat-api';

interface ConversationRailProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onCloseMobile?: () => void;
  embedded?: boolean;
}

export function ConversationRail({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onCloseMobile,
  embedded = false,
}: ConversationRailProps) {
  const [filter, setFilter] = useState('');
  const query = filter.trim().toLowerCase();
  const visible = query
    ? conversations.filter((conversation) => conversation.title.toLowerCase().includes(query))
    : conversations;

  return (
    <aside
      aria-label="Conversations"
      className={
        embedded
          ? 'flex h-full flex-col overflow-hidden'
          : 'flex h-full flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card'
      }
    >
      {embedded ? null : (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3.5">
          <div className="flex items-center gap-2">
            <History className="size-4 text-ink-400" aria-hidden="true" />
            <h2 className="font-display text-display-sm text-ink-900">Conversations</h2>
          </div>
          {onCloseMobile ? (
            <IconButton
              aria-label="Close conversation menu"
              size="sm"
              variant="ghost"
              className="lg:hidden"
              onClick={onCloseMobile}
            >
              <X className="size-4" aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
      )}

      <div className="space-y-2.5 p-3">
        <button
          type="button"
          onClick={onNewConversation}
          className="flex w-full items-center justify-center gap-2 rounded-control border border-action-border bg-action-tint px-3 py-2.5 text-label-md font-semibold text-action shadow-xs transition-fluid hover:-translate-y-px hover:bg-action-border/60 hover:shadow-card active:translate-y-px"
        >
          <Plus className="size-4" aria-hidden="true" />
          New conversation
        </button>

        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-400"
          />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter conversations"
            aria-label="Filter conversations"
            className="h-9 pl-8 text-body-sm shadow-inset"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        <p className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-400">
          {query ? 'Matches' : 'Recent'}
        </p>

        {visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
            <span className="mb-3 flex size-10 items-center justify-center rounded-[12px] border border-line bg-canvas-subtle text-ink-400">
              <History aria-hidden="true" className="size-4" />
            </span>
            <p className="text-label-md text-ink-700">
              {query ? 'No matching conversations' : 'No conversations yet'}
            </p>
            <p className="mt-1 max-w-44 text-body-sm leading-relaxed text-ink-500">
              {query
                ? 'Try a different word from the conversation title.'
                : 'Ask your first question to start a conversation.'}
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {visible.map((conv) => {
              const isActive = activeConversationId === conv.id;
              return (
                <div
                  key={conv.id}
                  className={`group flex items-center justify-between gap-1 rounded-control border px-2 py-1.5 transition-fluid ${
                    isActive
                      ? 'border-action-border bg-action-tint/70'
                      : 'border-transparent hover:bg-canvas-subtle'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onSelectConversation(conv.id)}
                    className="flex min-w-0 flex-1 items-start gap-2.5 rounded-[6px] px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-action-accent/30"
                  >
                    <MessageSquare
                      className={`mt-0.5 size-3.5 shrink-0 ${
                        isActive ? 'text-action' : 'text-ink-400 group-hover:text-ink-600'
                      }`}
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p
                        className={`truncate text-body-sm ${
                          isActive ? 'font-semibold text-action' : 'text-ink-700'
                        }`}
                      >
                        {conv.title}
                      </p>
                      <p className="mt-0.5 text-[10px] text-ink-400">
                        {new Date(conv.updated_at).toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                    </div>
                  </button>

                  <IconButton
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete ${conv.title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteConversation(conv.id);
                    }}
                    className="size-7 text-ink-400 opacity-0 transition-opacity hover:bg-danger-bg hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </IconButton>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
