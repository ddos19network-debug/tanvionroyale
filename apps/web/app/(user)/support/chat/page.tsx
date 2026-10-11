'use client';

/**
 * Live Chat (/support/chat) — the real user-facing support conversation.
 *
 * Backed by the REST API (GET/POST /support/chat, POST /support/chat/read)
 * with the standard authenticated fetch client: the JWT is attached and
 * refreshed exactly once on 401 by authFetch — this page NEVER clears the
 * session. Transient failures (502/503/504/network/Render cold start) show a
 * retryable banner; only a definitive 401 shows "Please sign in again".
 *
 * Refresh design: poll every 5s while the tab is visible (the platform's
 * existing REST pattern — no chat WebSocket/SSE exists in this codebase).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  MAX_SUPPORT_MESSAGE_LENGTH,
  getSupportConversation,
  listSupportMessages,
  markSupportRead,
  sendSupportMessage,
  type SupportConversation,
  type SupportMessage,
} from '@/lib/api/support';
import { ApiClientError } from '@/lib/api/client';
import { useAuth } from '@/src/lib/auth';

const POLL_INTERVAL_MS = 5000;
/** Backend returns the newest 50 messages; ≥50 ⇒ older history may exist. */
const CONVERSATION_WINDOW = 50;

type SendState = 'pending' | 'failed';

interface OutgoingMessage {
  clientRef: string;
  body: string;
  status: SendState;
}

function newClientRef(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ref-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** True only for temporary failures — never destroys the session. */
function isTransientFailure(err: unknown): boolean {
  if (err instanceof ApiClientError) {
    return err.transient || err.status >= 500;
  }
  // fetch() network failures surface as TypeError — transient by definition.
  return !(err instanceof ApiClientError);
}

function authFailure(err: unknown): boolean {
  return err instanceof ApiClientError && err.status === 401 && !err.transient;
}

const STATUS_LABELS: Record<string, string> = {
  OPEN: 'Open',
  IN_PROGRESS: 'In progress',
  WAITING_FOR_USER: 'Waiting for your reply',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function dayLabel(iso: string): string {
  const today = new Date();
  const date = new Date(iso);
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  if (sameDay) return 'Today';
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export default function SupportChatPage() {
  const { ready, isAuthenticated } = useAuth();

  const [conversation, setConversation] = useState<SupportConversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authFailed, setAuthFailed] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [outgoing, setOutgoing] = useState<OutgoingMessage[]>([]);

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const conversationRef = useRef<SupportConversation | null>(null);
  conversationRef.current = conversation;

  /** Merge a confirmed server message into the list without duplicates. */
  const mergeMessage = useCallback(
    (message: SupportMessage, ticket: SupportConversation['ticket']) => {
      setConversation((prev) => {
        if (!prev) return prev;
        const exists = prev.messages.some((m) => m.id === message.id);
        const messages = exists
          ? prev.messages.map((m) => (m.id === message.id ? message : m))
          : [...prev.messages, message].sort(
              (a, b) =>
                new Date(a.createdAt).getTime() -
                new Date(b.createdAt).getTime(),
            );
        return { ticket, messages };
      });
    },
    [],
  );

  const load = useCallback(async (silent: boolean) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const data = await getSupportConversation();
      setAuthFailed(false);
      if (!silent) setError(null);
      setHasMore(data.messages.length >= CONVERSATION_WINDOW);
      setConversation(data);
    } catch (err) {
      if (authFailure(err)) {
        setAuthFailed(true);
        setError('Please sign in again to continue.');
      } else if (!silent || !conversationRef.current) {
        setError('Live Chat is temporarily unavailable. Please try again.');
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  // Initial load (also recovers the page after a transient first failure).
  useEffect(() => {
    if (ready && isAuthenticated) void load(false);
  }, [ready, isAuthenticated, load]);

  // Poll while the tab is visible — the REST refresh pattern of the platform.
  useEffect(() => {
    if (!isAuthenticated) return;
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void load(true);
    }, POLL_INTERVAL_MS);
    const onVisible = () => {
      if (typeof document !== 'undefined' && !document.hidden) void load(true);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [isAuthenticated, load]);

  // The user is looking at the chat — admin replies are seen immediately.
  const unreadCount = conversation?.ticket.userUnreadCount ?? 0;
  useEffect(() => {
    if (unreadCount === 0) return;
    setConversation((prev) =>
      prev ? { ...prev, ticket: { ...prev.ticket, userUnreadCount: 0 } } : prev,
    );
    void markSupportRead().catch(() => {
      /* best-effort — a later send/poll re-syncs read state server-side */
    });
  }, [unreadCount]);

  // Keep the newest message in view.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [conversation?.messages.length, outgoing.length]);

  async function handleSend() {
    const body = draft.trim();
    if (!body || sending) return;
    const clientRef = newClientRef();
    setOutgoing((prev) => [...prev, { clientRef, body, status: 'pending' }]);
    setDraft('');
    setSending(true);
    setSendError(null);
    try {
      const result = await sendSupportMessage({ body, clientRef });
      setOutgoing((prev) => prev.filter((m) => m.clientRef !== clientRef));
      mergeMessage(result.message, result.ticket);
    } catch (err) {
      setOutgoing((prev) =>
        prev.map((m) =>
          m.clientRef === clientRef ? { ...m, status: 'failed' } : m,
        ),
      );
      setSendError('Message could not be sent. Please try again.');
      if (isTransientFailure(err)) {
        setError('Live Chat is temporarily unavailable. Please try again.');
      }
    } finally {
      setSending(false);
    }
  }

  async function handleRetry(clientRef: string) {
    const message = outgoing.find((m) => m.clientRef === clientRef);
    if (!message || sending) return;
    setOutgoing((prev) =>
      prev.map((m) =>
        m.clientRef === clientRef ? { ...m, status: 'pending' } : m,
      ),
    );
    setSendError(null);
    try {
      // SAME clientRef → the backend is idempotent: retry cannot duplicate.
      const result = await sendSupportMessage({
        body: message.body,
        clientRef,
      });
      setOutgoing((prev) => prev.filter((m) => m.clientRef !== clientRef));
      mergeMessage(result.message, result.ticket);
      setError(null);
    } catch {
      setOutgoing((prev) =>
        prev.map((m) =>
          m.clientRef === clientRef ? { ...m, status: 'failed' } : m,
        ),
      );
      setSendError('Message could not be sent. Please try again.');
    }
  }

  async function handleLoadOlder() {
    const oldest = conversation?.messages[0];
    if (!oldest || !hasMore || loadingOlder) return;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await listSupportMessages({
        before: oldest.createdAt,
        limit: CONVERSATION_WINDOW,
      });
      setHasMore(page.hasMore);
      setConversation((prev) => {
        if (!prev) return prev;
        const known = new Set(prev.messages.map((m) => m.id));
        const fresh = page.items.filter((m) => !known.has(m.id));
        return { ...prev, messages: [...fresh, ...prev.messages] };
      });
    } catch {
      setOlderError('Could not load earlier messages. Please try again.');
    } finally {
      setLoadingOlder(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Render — states per spec: connecting / auth / temporary failure / chat.
  // ---------------------------------------------------------------------------

  if (!ready) {
    return (
      <main className="min-h-screen w-full bg-ink-950 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="mx-auto w-full max-w-3xl">
          <div
            className="rounded-2xl border border-white/10 bg-ink-800 p-6 text-center text-sm text-slate-500"
            role="status"
          >
            Connecting to Live Chat…
          </div>
        </div>
      </main>
    );
  }

  if (!isAuthenticated || authFailed) {
    return (
      <main className="min-h-screen w-full bg-ink-950 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="mx-auto w-full max-w-3xl">
          <div className="rounded-2xl border border-white/10 bg-ink-800 p-6 text-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Support
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-100 sm:text-3xl">
              Live Chat
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              {authFailed
                ? 'Please sign in again to continue.'
                : 'Please sign in to use Live Chat.'}
            </p>
            <Link
              href="/login"
              className="mt-4 inline-block rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-brand-dark"
            >
              Sign in
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const messages = conversation?.messages ?? [];
  const ticket = conversation?.ticket ?? null;

  return (
    <main className="flex min-h-screen w-full flex-col bg-ink-900 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
        <div className="mb-4 rounded-2xl border border-white/10 bg-ink-800 p-4 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Support
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-100 sm:text-3xl">
              Live Chat
            </h1>
            {ticket ? (
              <span className="rounded-full bg-ink-700 px-2.5 py-0.5 text-xs font-semibold text-slate-300">
                {STATUS_LABELS[ticket.status] ?? ticket.status}
              </span>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Talk to the TANVIONROYALE support team — replies appear here and in
            your notifications.
          </p>
        </div>

        {error && !authFailed ? (
          <div
            className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-950/50 p-4 text-sm text-amber-300"
            role="alert"
          >
            <span className="min-w-0 flex-1">{error}</span>
            <button
              type="button"
              onClick={() => void load(false)}
              className="rounded-lg border border-amber-500/40 bg-ink-800 px-3 py-1.5 text-sm font-semibold text-amber-300 transition hover:bg-amber-500/20"
            >
              Retry
            </button>
          </div>
        ) : null}

        <div className="flex-1 overflow-hidden rounded-2xl border border-white/10 bg-ink-800">
          <div className="flex h-[60vh] min-h-[420px] flex-col">
            <div className="flex-1 space-y-1 overflow-y-auto px-4 py-4">
              {loading && messages.length === 0 && outgoing.length === 0 ? (
                <p
                  className="py-8 text-center text-sm text-slate-400"
                  role="status"
                >
                  Connecting to Live Chat…
                </p>
              ) : null}

              {hasMore && messages.length > 0 ? (
                <div className="pb-2 text-center">
                  <button
                    type="button"
                    onClick={() => void handleLoadOlder()}
                    disabled={loadingOlder}
                    className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-white/10 disabled:opacity-60"
                  >
                    {loadingOlder ? 'Loading…' : 'Load earlier messages'}
                  </button>
                  {olderError ? (
                    <p className="mt-1 text-xs text-red-400" role="alert">
                      {olderError}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {messages.map((message, index) => {
                const prev = messages[index - 1];
                const showDay =
                  !prev ||
                  dayLabel(prev.createdAt) !== dayLabel(message.createdAt);
                const mine = message.authorRole === 'USER';
                return (
                  <div key={message.id}>
                    {showDay ? (
                      <p className="my-3 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        {dayLabel(message.createdAt)}
                      </p>
                    ) : null}
                    <div
                      className={`flex py-0.5 ${mine ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm sm:max-w-[75%] ${
                          mine ? 'bg-brand text-white' : 'bg-ink-700 text-slate-100'
                        }`}
                      >
                        {!mine ? (
                          <p className="mb-0.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">
                            Support
                          </p>
                        ) : null}
                        {/* Plain text only — never rendered as HTML. */}
                        <p className="whitespace-pre-wrap break-words">
                          {message.body}
                        </p>
                        <p
                          className={`mt-1 text-right text-[10px] ${
                            mine ? 'text-white/70' : 'text-slate-400'
                          }`}
                        >
                          {formatTime(message.createdAt)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}

              {outgoing.map((out) => (
                <div key={out.clientRef} className="flex justify-end py-0.5">
                  <div className="max-w-[85%] rounded-2xl bg-brand/70 px-3.5 py-2 text-sm text-white sm:max-w-[75%]">
                    <p className="whitespace-pre-wrap break-words">{out.body}</p>
                    <p className="mt-1 flex items-center justify-end gap-2 text-[10px] text-white/85">
                      {out.status === 'pending' ? 'Sending…' : 'Not sent'}
                      {out.status === 'failed' ? (
                        <button
                          type="button"
                          onClick={() => void handleRetry(out.clientRef)}
                          className="rounded bg-white/25 px-1.5 py-0.5 font-semibold text-white transition hover:bg-white/40"
                        >
                          Retry
                        </button>
                      ) : null}
                    </p>
                  </div>
                </div>
              ))}

              {!loading && messages.length === 0 && outgoing.length === 0 ? (
                <div className="py-8 text-center">
                  <p className="text-sm font-semibold text-slate-300">
                    Start the conversation
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Describe your question below — the support team will reply
                    here.
                  </p>
                </div>
              ) : null}
              <div ref={bottomRef} />
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleSend();
              }}
              className="border-t border-white/10 p-3"
            >
              {sendError ? (
                <p className="mb-2 text-xs text-red-400" role="alert">
                  {sendError}
                </p>
              ) : null}
              <div className="flex items-end gap-2">
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  rows={2}
                  maxLength={MAX_SUPPORT_MESSAGE_LENGTH}
                  placeholder="Type your message…"
                  aria-label="Message"
                  className="min-h-0 flex-1 resize-none rounded-xl border border-ink-600 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/20"
                />
                <button
                  type="submit"
                  disabled={sending || draft.trim().length === 0}
                  className="rounded-xl bg-brand px-4 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </main>
  );
}
