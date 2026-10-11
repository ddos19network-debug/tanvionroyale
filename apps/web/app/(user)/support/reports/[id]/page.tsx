'use client';

/**
 * One problem report (/support/reports/:id) — the report's own thread.
 *
 * GET /support/reports/:id returns the case with all messages (oldest →
 * newest), so the admin's reply and the case status ("solved" feedback) are
 * visible here. The layout mirrors the Live Chat message rendering
 * (app/(user)/support/chat/page.tsx): day separators, user bubbles on the
 * right, support bubbles on the left, plain text only.
 *
 * The server scopes the lookup to the JWT user, so opening someone else's
 * report id returns 404 — this page then shows "Report not found".
 *
 * Refresh: poll every 10s while the tab is visible (the platform's REST
 * pattern; there is no chat WebSocket/SSE in this codebase).
 */

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import {
  MAX_REPORT_SCREENSHOT_BYTES,
  MAX_SUPPORT_MESSAGE_LENGTH,
  REPORT_SCREENSHOT_ACCEPT,
  getMyReport,
  replyMyReport,
  type SupportMessage,
  type SupportReportThread,
} from '@/lib/api/support';
import { ApiClientError } from '@/lib/api/client';
import { useAuth } from '@/src/lib/auth';
import {
  ReportStatusChip,
  dayLabel,
  formatMessageTime,
  formatReportDate,
} from '@/components/support/support-report-ui';

const POLL_INTERVAL_MS = 10_000;

function newClientRef(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `report-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function dedupeMessages(messages: SupportMessage[]): SupportMessage[] {
  const seen = new Set<string>();
  return messages.filter((m) => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });
}

export default function ReportThreadPage() {
  const router = useRouter();
  const { ready, isAuthenticated } = useAuth();
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === 'string' ? params.id : '';

  const [thread, setThread] = useState<SupportReportThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  /** Reused across retries so a retry can never duplicate a message. */
  const [pendingRef, setPendingRef] = useState<string | null>(null);

  const [replyAttachment, setReplyAttachment] = useState('');
  const [replyAttachmentName, setReplyAttachmentName] = useState('');

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(
    async (silent: boolean) => {
      if (!id) return;
      if (!silent) {
        setLoading(true);
        setLoadError(null);
      }
      try {
        const data = await getMyReport(id);
        setThread(data);
        setNotFound(false);
        setLoadError(null);
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 404) {
          setThread(null);
          setNotFound(true);
          return;
        }
        if (err instanceof ApiClientError && err.status === 401) {
          router.replace('/login');
          return;
        }
        if (!silent) {
          setLoadError('This report is temporarily unavailable. Please try again.');
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [id, router],
  );

  useEffect(() => {
    if (!ready) return;
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    void load(false);
  }, [ready, isAuthenticated, load, router]);

  // Poll while visible so replies + status changes appear without a manual reload.
  useEffect(() => {
    if (!isAuthenticated || !id) return;
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
  }, [isAuthenticated, id, load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [thread?.messages.length]);

  async function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];

    setReplyAttachment('');
    setReplyAttachmentName('');

    if (!file) return;

    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)
    ) {
      setSendError('Please select a JPG, JPEG, PNG or WebP screenshot.');
      event.target.value = '';
      return;
    }

    // Same client-side rule as the report form (spec: 5MB).
    if (file.size > MAX_REPORT_SCREENSHOT_BYTES) {
      setSendError('Screenshot is too large. Please use an image under 5MB.');
      event.target.value = '';
      return;
    }

    try {
      const reader = new FileReader();

      reader.onload = () => {
        const result = reader.result;
        if (typeof result !== 'string') {
          setSendError('Unable to read the screenshot.');
          return;
        }
        setReplyAttachment(result);
        setReplyAttachmentName(file.name);
        setSendError(null);
      };

      reader.onerror = () => setSendError('Unable to read the screenshot.');

      reader.readAsDataURL(file);
    } catch {
      setSendError('Unable to process the screenshot.');
    }
  }

  async function handleSend() {
    const body = draft.trim();
    if (!id || !body || sending) return;

    // ONE clientRef per attempt — retrying the same draft is idempotent
    // server-side (a lost response can never create a duplicate message).
    const clientRef = pendingRef ?? newClientRef();
    setPendingRef(clientRef);
    setSending(true);
    setSendError(null);
    try {
      const result = await replyMyReport(id, {
        body,
        clientRef,
        attachmentDataUrl: replyAttachment || undefined,
      });
      setThread((prev) =>
        prev
          ? {
              ticket: result.ticket,
              messages: dedupeMessages([...prev.messages, result.message]),
            }
          : prev,
      );
      setDraft('');
      setReplyAttachment('');
      setReplyAttachmentName('');
      setPendingRef(null);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) {
        setNotFound(true);
        return;
      }
      setSendError('Your message could not be sent. Please try again.');
    } finally {
      setSending(false);
    }
  }

  if (!ready || (loading && !thread && !notFound)) {
    return (
      <main className="min-h-screen w-full bg-ink-950 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="mx-auto w-full max-w-3xl">
          <div
            className="rounded-2xl border border-white/10 bg-ink-800 p-6 text-center text-sm text-slate-500"
            role="status"
          >
            Loading your report…
          </div>
        </div>
      </main>
    );
  }

  if (notFound || !thread) {
    return (
      <main className="min-h-screen w-full bg-ink-950 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="mx-auto w-full max-w-3xl">
          <div className="rounded-2xl border border-white/10 bg-ink-800 p-6 text-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Support
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-100">
              Report not found
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              This report does not exist or does not belong to your account.
            </p>
            <Link
              href="/support/reports"
              className="mt-4 inline-block rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-ink-950 transition hover:bg-brand-dark"
            >
              My problem reports
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const messages = thread.messages;
  const ticket = thread.ticket;

  return (
    <main className="flex min-h-screen w-full flex-col bg-ink-900 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col">
        <div className="mb-4 rounded-2xl border border-white/10 bg-ink-800 p-4 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Support
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-slate-100 sm:text-3xl">
              Problem report
            </h1>
            <ReportStatusChip status={ticket.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Opened {formatReportDate(ticket.createdAt)} · report{' '}
            <span className="font-mono">{ticket.id.slice(0, 8)}</span>
            {ticket.category ? ` · ${ticket.category}` : ''}
            {ticket.contactEmail ? ` · ${ticket.contactEmail}` : ''}
            {ticket.contactPhone ? ` · ${ticket.contactPhone}` : ''}
          </p>
          {ticket.category ? (
            <p className="mt-2">
              <span className="inline-block rounded-full border border-teal-500/30 bg-teal-500/15 px-2.5 py-0.5 text-xs font-semibold text-teal-300">
                {ticket.category}
              </span>
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/support/reports"
              className="rounded-xl border border-ink-600 px-3.5 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/10"
            >
              My problem reports
            </Link>
            <Link
              href="/support/report"
              className="rounded-xl border border-ink-600 px-3.5 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/10"
            >
              Report another problem
            </Link>
          </div>
        </div>

        {loadError ? (
          <div
            className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-950/50 p-4 text-sm text-amber-300"
            role="alert"
          >
            <span className="min-w-0 flex-1">{loadError}</span>
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
              {messages.map((message, index) => {
                const prev = messages[index - 1];
                const showDay =
                  !prev || dayLabel(prev.createdAt) !== dayLabel(message.createdAt);
                const mine = message.authorRole === 'USER';
                return (
                  <div key={message.id}>
                    {showDay ? (
                      <p className="my-3 text-center text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                        {dayLabel(message.createdAt)}
                      </p>
                    ) : null}
                    <div className={`flex py-0.5 ${mine ? 'justify-end' : 'justify-start'}`}>
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
                        <p className="whitespace-pre-wrap break-words">{message.body}</p>
                        {message.attachmentDataUrl ? (
                          <a
                            href={message.attachmentDataUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open the screenshot full size"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={message.attachmentDataUrl}
                              alt="Problem screenshot"
                              className="mt-2 max-h-64 rounded-md border border-white/20"
                            />
                          </a>
                        ) : null}
                        <p
                          className={`mt-1 text-right text-[10px] ${
                            mine ? 'text-white/70' : 'text-slate-400'
                          }`}
                        >
                          {formatMessageTime(message.createdAt)}
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
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
              {replyAttachment ? (
                <div className="mb-2 flex items-center gap-2 text-xs text-slate-400">
                  <span className="min-w-0 flex-1 truncate">
                    Attached: {replyAttachmentName || 'screenshot'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setReplyAttachment('');
                      setReplyAttachmentName('');
                    }}
                    className="rounded-lg border border-ink-600 px-2 py-1 font-semibold text-slate-300 transition hover:bg-white/10"
                  >
                    Remove
                  </button>
                </div>
              ) : null}
              <div className="flex items-end gap-2">
                <label
                  htmlFor="report-reply-screenshot"
                  className="cursor-pointer rounded-xl border border-ink-600 px-3 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-white/10"
                  title="Attach a screenshot (optional)"
                >
                  Attach
                </label>
                <input
                  id="report-reply-screenshot"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void handleAttachmentChange(e)}
                />
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
                  placeholder="Write a follow-up message…"
                  aria-label="Follow-up message"
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
