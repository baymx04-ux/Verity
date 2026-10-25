import { History, MessageSquare, MessageSquarePlus, Trash2, X } from 'lucide-react';
import { IconButton } from '../../components/ui/icon-button';
import { Tooltip } from '../../components/ui/tooltip';
import type { Conversation } from './chat-api';

interface ConversationRailProps {
  conversations: Conversation[];
  activeConversationId: string | null;
  onSelectConversation: (id: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (id: string) => void;
  onCloseMobile?: () => void;
}

export function ConversationRail({
  conversations,
  activeConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
  onCloseMobile,
}: ConversationRailProps) {
  return (
    <aside
      aria-label="Conversations"
      className="flex h-full flex-col rounded-card border border-line bg-surface shadow-xs"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <History className="size-4 text-ink-500" aria-hidden="true" />
          <h2 className="font-display text-display-sm text-ink-900">Conversations</h2>
        </div>
        <div className="flex items-center gap-1">
          <Tooltip label="New conversation">
            <IconButton
              aria-label="New conversation"
              size="sm"
              variant="subtle"
              onClick={onNewConversation}
            >
              <MessageSquarePlus className="size-4" aria-hidden="true" />
            </IconButton>
          </Tooltip>
          {onCloseMobile && (
            <IconButton
              aria-label="Close conversation menu"
              size="sm"
              variant="subtle"
              className="lg:hidden"
              onClick={onCloseMobile}
            >
              <X className="size-4" aria-hidden="true" />
            </IconButton>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
            <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-surface-container-low text-ink-400">
              <History aria-hidden="true" className="size-4" />
            </span>
            <p className="text-label-md text-ink-700">No conversations yet</p>
            <p className="mt-1 max-w-44 text-body-sm leading-[1.3rem] text-ink-500">
              Ask your first question to start a conversation.
            </p>
          </div>
        ) : (
          conversations.map((conv) => {
            const isActive = activeConversationId === conv.id;
            return (
              <div
                key={conv.id}
                className={`group flex items-center justify-between gap-2 rounded-control px-3 py-2 text-left transition-colors ${
                  isActive
                    ? 'bg-sky-50 text-sky-900 font-medium border border-sky-200/80 shadow-xs'
                    : 'text-ink-700 hover:bg-slate-50 hover:text-ink-900'
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelectConversation(conv.id)}
                  className="flex flex-1 items-center gap-2.5 min-w-0 text-left"
                >
                  <MessageSquare
                    className={`size-3.5 shrink-0 ${
                      isActive ? 'text-sky-600' : 'text-ink-400 group-hover:text-ink-600'
                    }`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body-sm">{conv.title}</p>
                    <p className="text-[10px] text-ink-400">
                      {new Date(conv.updated_at).toLocaleDateString([], {
                        month: 'short',
                        day: 'numeric',
                      })}
                    </p>
                  </div>
                </button>

                <IconButton
                  size="sm"
                  variant="subtle"
                  aria-label="Delete thread"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteConversation(conv.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity size-7 text-ink-400 hover:text-rose-600"
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                </IconButton>
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-line px-4 py-3 text-body-sm text-ink-500 flex items-center justify-between">
        <span className="text-xs">Document chat</span>
        <span className="inline-flex size-2 rounded-full bg-emerald-500" title="Online" />
      </div>
    </aside>
  );
}
