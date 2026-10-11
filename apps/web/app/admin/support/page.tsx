'use client';

/**
 * Admin â€” Support inbox (the admin side of Live Chat).
 *
 * Real endpoints (ADMIN/SUPER_ADMIN only; RBAC enforced server-side):
 *   GET   /admin/support/tickets?status&q&page&limit
 *   GET   /admin/support/unread-count
 *   GET   /admin/support/tickets/:id
 *   POST  /admin/support/tickets/:id/read
 *   POST  /admin/support/tickets/:id/reply        { body, clientRef? }
 *   PATCH /admin/support/tickets/:id/status       { status }
 *   POST  /admin/support/tickets/:id/assign       { adminId? }
 *
 * Replies are attributed to the authenticated admin and notify the user
 * through the existing notification system (in-app + optional FCM push).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { Button } from '@tanvion-royale/ui';
import {
  SUPPORT_TICKET_STATUSES,
  assignAdminSupportTicket,
  getAdminSupportTicket,
  getAdminSupportUnreadCount,
  listAdminSupportTickets,
  markAdminSupportTicketRead,
  replyAdminSupportTicket,
  updateAdminSupportTicketStatus,
  type AdminTicketDetail,
  type AdminTicketSourceFilter,
  type AdminTicketStatusFilter,
  type SupportMessage,
  type SupportTicketListItem,
} from '@/lib/api/support';
import { AdminPageHeader, formatDateTime } from '@/components/admin/ui';
import { useToast } from '@/components/admin/toast';
import { useAdminPermission } from '@/components/admin/admin-guard';

const LIST_PAGE_SIZE = 20;
const LIST_POLL_MS = 10_000;
const TICKET_POLL_MS = 5000;

const STATUS_OPTIONS: Array<{ value: AdminTicketStatusFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'OPEN', label: 'Open' },
  { value: 'IN_PROGRESS', label: 'In progress' },
  { value: 'WAITING_FOR_USER', label: 'Waiting for user' },
  { value: 'RESOLVED', label: 'Resolved' },
  { value: 'CLOSED', label: 'Closed' },
];

const SOURCE_OPTIONS: Array<{ value: AdminTicketSourceFilter; label: string }> = [
  { value: 'ALL', label: 'All sources' },
  { value: 'LIVE_CHAT', label: 'Live Chat' },
  { value: 'PROBLEM_REPORT', label: 'Problem Report' },
];

function sourceLabel(source?: string | null): string {
  return source === 'PROBLEM_REPORT' ? 'Problem Report' : 'Live Chat';
}

const STATUS_CHIP: Record<string, string> = {
  OPEN: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  IN_PROGRESS: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  WAITING_FOR_USER: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
  RESOLVED: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  CLOSED: 'bg-ink-700 text-slate-400 border-ink-600',
};

function relativeTime(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.floor(delta / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return formatDateTime(iso);
}

function newClientRef(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `admin-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function AdminSupportPage() {
  const { toast } = useToast();
  const canReply = useAdminPermission(ADMIN_PERMISSIONS.SUPPORT_REPLY);
  const canUpdate = useAdminPermission(ADMIN_PERMISSIONS.SUPPORT_UPDATE);
  const canAssign = useAdminPermission(ADMIN_PERMISSIONS.SUPPORT_ASSIGN);

  const [tickets, setTickets] = useState<SupportTicketListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);

  const [statusFilter, setStatusFilter] = useState<AdminTicketStatusFilter>('ALL');
  const [sourceFilter, setSourceFilter] = useState<AdminTicketSourceFilter>('ALL');
  const [search, setSearch] = useState('');
  const searchRef = useRef('');
  searchRef.current = search;

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminTicketDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [busy, setBusy] = useState(false);

  const detailIdRef = useRef<string | null>(null);
  detailIdRef.current = detail?.ticket.id ?? null;

  const loadTickets = useCallback(
    async (nextPage: number, append: boolean) => {
      setLoading(true);
      setListError(null);
      try {
        const result = await listAdminSupportTickets({
          status: statusFilter,
          source: sourceFilter,
          q: searchRef.current.trim() || undefined,
          page: nextPage,
          limit: LIST_PAGE_SIZE,
        });
        setTickets((prev) =>
          append ? mergeTickets(prev, result.items) : result.items,
        );
        setTotal(result.total);
        setPage(nextPage);
      } catch {
        setListError(
          'Support inbox is temporarily unavailable. Please try again.',
        );
      } finally {
        setLoading(false);
      }
    },
    [statusFilter, sourceFilter],
  );

  const loadUnread = useCallback(async () => {
    try {
      const { unread: value } = await getAdminSupportUnreadCount();
      setUnread(value);
    } catch {
      /* badge is best-effort */
    }
  }, []);

  const openTicket = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    setDetailError(null);
    setReply('');
    try {
      const data = await getAdminSupportTicket(id);
      setDetail(data);
      // The admin has now read the conversation.
      void markAdminSupportTicketRead(id).catch(() => undefined);
      setTickets((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, adminUnreadCount: 0 } : t,
        ),
      );
      void loadUnread();
    } catch {
      setDetail(null);
      setDetailError('Could not load this conversation. Please try again.');
    } finally {
      setDetailLoading(false);
    }
  }, [loadUnread]);

  function mergeTickets(
    prev: SupportTicketListItem[],
    items: SupportTicketListItem[],
  ): SupportTicketListItem[] {
    const byId = new Map(prev.map((t) => [t.id, t]));
    for (const item of items) byId.set(item.id, item);
    return [...byId.values()].sort(
      (a, b) =>
        new Date(b.lastMessageAt).getTime() -
        new Date(a.lastMessageAt).getTime(),
    );
  }

  function dedupeMessages(messages: SupportMessage[]): SupportMessage[] {
    const seen = new Set<string>();
    return messages.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }

  async function handleSendReply() {
    const id = detail?.ticket.id;
    const body = reply.trim();
    if (!id || !body || sending) return;
    const clientRef = newClientRef();
    setSending(true);
    try {
      const result = await replyAdminSupportTicket(id, { body, clientRef });
      setReply('');
      setDetail((prev) =>
        prev && prev.ticket.id === id
          ? {
              ticket: {
                ...prev.ticket,
                status:
                  prev.ticket.status === 'CLOSED'
                    ? prev.ticket.status
                    : 'WAITING_FOR_USER',
              },
              messages: dedupeMessages([...prev.messages, result.message]),
            }
          : prev,
      );
      void loadTickets(page, true);
      toast('Reply sent to the user.', 'success');
    } catch {
      toast('Reply could not be sent. Please try again.', 'error');
    } finally {
      setSending(false);
    }
  }

  async function handleChangeStatus(
    id: string,
    status: (typeof SUPPORT_TICKET_STATUSES)[number],
  ) {
    // Double-submit guard (Part 35).
    if (busy) return;
    setBusy(true);
    try {
      await updateAdminSupportTicketStatus(id, status);
      setDetail((prev) =>
        prev && prev.ticket.id === id
          ? { ...prev, ticket: { ...prev.ticket, status } }
          : prev,
      );
      setTickets((prev) =>
        prev.map((t) => (t.id === id ? { ...t, status } : t)),
      );
      toast(
        `Conversation marked ${status.replace(/_/g, ' ').toLowerCase()}.`,
        'success',
      );
    } catch {
      toast('Status could not be updated. Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function handleAssign(id: string, adminId: string | null | undefined) {
    // Double-submit guard (Part 35).
    if (busy) return;
    setBusy(true);
    try {
      const { ticket } = await assignAdminSupportTicket(id, adminId);
      setDetail((prev) =>
        prev && prev.ticket.id === id
          ? { ...prev, ticket: { ...prev.ticket, ...ticket } }
          : prev,
      );
      setTickets((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...ticket } : t)),
      );
      toast(
        ticket.assignedAdminId === undefined
          ? 'Conversation unassigned.'
          : 'Conversation assigned.',
        'success',
      );
    } catch {
      toast('Assignment could not be updated. Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  }

  // Initial + filter-triggered loads (loadTickets changes with statusFilter).
  useEffect(() => {
    void loadTickets(0, false);
  }, [loadTickets]);

  // Debounced search â†’ reload page 0.
  useEffect(() => {
    const timer = setTimeout(() => void loadTickets(0, false), 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Poll the inbox while visible.
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return;
      void loadTickets(page, true);
      void loadUnread();
    }, LIST_POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, loadTickets, loadUnread]);

  // Poll the open conversation while visible.
  useEffect(() => {
    if (!selectedId) return;
    const timer = setInterval(async () => {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const data = await getAdminSupportTicket(selectedId);
        setDetail(data);
        if (data.ticket.adminUnreadCount > 0) {
          void markAdminSupportTicketRead(selectedId).catch(() => undefined);
          setTickets((prev) =>
            prev.map((t) =>
              t.id === selectedId ? { ...t, adminUnreadCount: 0 } : t,
            ),
          );
          void loadUnread();
        }
      } catch {
        /* transient â€” the next tick retries */
      }
    }, TICKET_POLL_MS);
    return () => clearInterval(timer);
  }, [selectedId, loadUnread]);

  const hasMoreList = tickets.length < total;

  return (
    <>
      <AdminPageHeader
        title="Support"
        description="Live Chat conversations and problem reports from users. Replies are delivered in the user's chat/report thread and to their notification center."
        crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Support' }]}
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {STATUS_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              setStatusFilter(option.value);
              void loadTickets(0, false);
            }}
            className={`rounded-md px-3 py-1.5 text-sm transition ${
              statusFilter === option.value
                ? 'bg-teal-500/15 text-teal-300'
                : 'text-slate-400 hover:bg-ink-700 hover:text-slate-100'
            }`}
          >
            {option.label}
          </button>
        ))}
        <label className="ml-2 flex items-center gap-2 text-xs text-slate-400">
          <span className="font-semibold uppercase tracking-wide text-slate-500">
            Source
          </span>
          <select
            value={sourceFilter}
            onChange={(e) => {
              setSourceFilter(e.target.value as AdminTicketSourceFilter);
              void loadTickets(0, false);
            }}
            aria-label="Filter by source"
            className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-sm text-slate-100 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
          >
            {SOURCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <span className="ml-auto text-xs text-slate-500">
          {unread > 0 ? `${unread} unread message${unread === 1 ? '' : 's'}` : 'Inbox up to date'}
        </span>
      </div>

      <div className="mt-3 grid gap-4 lg:grid-cols-[minmax(280px,380px)_1fr]">
        {/* ------------------------------- inbox ------------------------------- */}
        <section aria-label="Conversations" className="min-w-0">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by username or emailâ€¦"
            aria-label="Search conversations"
            className="mb-2 w-full rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
          />

          {listError ? (
            <p
              className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300"
              role="alert"
            >
              {listError}
            </p>
          ) : null}

          {loading && tickets.length === 0 ? (
            <p className="px-1 py-6 text-sm text-slate-500">Loading conversationsâ€¦</p>
          ) : null}

          {!loading && tickets.length === 0 && !listError ? (
            <p className="rounded-lg border border-ink-600 bg-ink-900 p-4 text-sm text-slate-400">
              No conversations yet. User Live Chat messages will appear here.
            </p>
          ) : null}

          <ul className="divide-y divide-ink-700 overflow-hidden rounded-xl border border-ink-600 bg-ink-900">
            {tickets.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => void openTicket(t.id)}
                  aria-current={selectedId === t.id ? 'true' : undefined}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left transition ${
                    selectedId === t.id
                      ? 'bg-teal-500/10'
                      : 'hover:bg-ink-700/60'
                  }`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-slate-100">
                        {t.user.username}
                      </span>
                      <span
                        className={`rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
                          t.source === 'PROBLEM_REPORT'
                            ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                            : 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                        }`}
                        title={sourceLabel(t.source)}
                      >
                        {sourceLabel(t.source)}
                      </span>
                      {t.adminUnreadCount > 0 ? (
                        <span className="rounded-full bg-teal-500/20 px-1.5 py-0.5 text-[10px] font-bold text-teal-300">
                          {t.adminUnreadCount} new
                        </span>
                      ) : null}
                      {t.category ? (
                        <span
                          className="max-w-[120px] truncate rounded-full border border-teal-500/30 bg-teal-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-teal-300"
                          title={`Category: ${t.category}`}
                        >
                          {t.category}
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-400">
                      {t.lastMessage
                        ? `${t.lastMessage.authorRole === 'USER' ? '' : 'Support: '}${t.lastMessage.body}`
                        : 'No messages yet'}
                    </span>
                    <span className="mt-1 block text-[11px] text-slate-500">
                      {relativeTime(t.lastMessageAt)} Â·{' '}
                      {t.status.replace(/_/g, ' ').toLowerCase()}
                      {t.category ? ` Â· ${t.category}` : ''}
                      {t.assignedAdmin ? ` Â· ${t.assignedAdmin.username}` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>

          {hasMoreList ? (
            <Button
              variant="outline"
              size="sm"
              className="mt-3 w-full"
              disabled={loading}
              onClick={() => void loadTickets(page + 1, true)}
            >
              {loading ? 'Loadingâ€¦' : 'Load more conversations'}
            </Button>
          ) : null}
        </section>

        {/* --------------------------- conversation --------------------------- */}
        <section aria-label="Conversation" className="min-w-0">
          {detailLoading && !detail ? (
            <p className="rounded-lg border border-ink-600 bg-ink-900 p-4 text-sm text-slate-500">
              Loading conversationâ€¦
            </p>
          ) : detailError && !detail ? (
            <p
              className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300"
              role="alert"
            >
              {detailError}
            </p>
          ) : !detail ? (
            <p className="rounded-lg border border-ink-600 bg-ink-900 p-4 text-sm text-slate-400">
              Select a conversation to read and reply.
            </p>
          ) : (
            <div className="flex flex-col rounded-xl border border-ink-600 bg-ink-900">
              {/* conversation header */}
              <div className="flex flex-wrap items-start gap-3 border-b border-ink-700 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-white">
                    {detail.ticket.user.username}
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
                        detail.ticket.source === 'PROBLEM_REPORT'
                          ? 'border-amber-500/40 bg-amber-500/15 text-amber-300'
                          : 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                      }`}
                    >
                      {sourceLabel(detail.ticket.source)}
                    </span>
                    {detail.ticket.category ? (
                      <span className="inline-block rounded-full border border-teal-500/30 bg-teal-500/15 px-2 py-0.5 text-[10px] font-semibold text-teal-300">
                        {detail.ticket.category}
                      </span>
                    ) : null}
                  </p>
                  <p className="truncate font-mono text-[11px] text-slate-500">
                    User ID: {detail.ticket.user.id}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {detail.ticket.user.email ?? 'no email'} Â·{' '}
                    {detail.ticket.user.phone ?? 'no phone'}
                  </p>
                  {detail.ticket.source === 'PROBLEM_REPORT' &&
                  (detail.ticket.contactName ||
                    detail.ticket.contactEmail ||
                    detail.ticket.contactPhone) ? (
                    <p className="mt-1 text-xs text-slate-400">
                      Reported as{' '}
                      {[
                        detail.ticket.contactName,
                        detail.ticket.contactEmail,
                        detail.ticket.contactPhone,
                      ]
                        .filter(Boolean)
                        .join(' Â· ')}
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    Opened {formatDateTime(detail.ticket.createdAt)} Â· Category:{' '}
                    {detail.ticket.category ?? 'â€”'} Â·{' '}
                    {detail.ticket.assignedAdmin
                      ? `Assigned to ${detail.ticket.assignedAdmin.username}`
                      : 'Unassigned'}
                  </p>
                </div>
                <label className="flex flex-col gap-1 text-xs">
                  <span className="font-semibold uppercase tracking-wide text-slate-500">
                    Status
                  </span>
                  <select
                    value={detail.ticket.status}
                    disabled={busy || !canUpdate}
                    onChange={(e) =>
                      void handleChangeStatus(
                        detail.ticket.id,
                        e.target.value as (typeof SUPPORT_TICKET_STATUSES)[number],
                      )
                    }
                    className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1.5 text-sm text-slate-100 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
                  >
                    {SUPPORT_TICKET_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s.replace(/_/g, ' ')}
                      </option>
                    ))}
                  </select>
                </label>
                 {canAssign ? (
                <div className="flex flex-col gap-1 pt-5">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void handleAssign(detail.ticket.id, undefined)}
                  >
                    Assign to me
                  </Button>
                  {detail.ticket.assignedAdmin ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => void handleAssign(detail.ticket.id, null)}
                    >
                      Unassign
                    </Button>
                  ) : null}
                </div>
                 ) : null}
              </div>

              {/* status chip */}
              <div className="px-4 pt-3">
                <span
                  className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                    STATUS_CHIP[detail.ticket.status] ??
                    'border-ink-600 bg-ink-700 text-slate-400'
                  }`}
                >
                  {detail.ticket.status.replace(/_/g, ' ')}
                </span>
              </div>

              {/* messages */}
              <div className="max-h-[55vh] min-h-[240px] space-y-1 overflow-y-auto px-4 py-3">
                {detail.messages.map((m, index) => {
                  const prev = detail.messages[index - 1];
                  const showDay =
                    !prev ||
                    formatDateTime(prev.createdAt) !==
                      formatDateTime(m.createdAt);
                  const mine = m.authorRole === 'ADMIN';
                  return (
                    <div key={m.id}>
                      {showDay ? (
                        <p className="my-2 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                          {formatDateTime(m.createdAt)}
                        </p>
                      ) : null}
                      <div
                        className={`flex py-0.5 ${mine ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-2xl px-3 py-1.5 text-sm sm:max-w-[75%] ${
                            mine
                              ? 'bg-teal-600/80 text-white'
                              : 'bg-ink-700 text-slate-100'
                          }`}
                        >
                          <p className="mb-0.5 text-[10px] font-bold uppercase tracking-wide opacity-70">
                            {mine ? 'You (support)' : detail.ticket.user.username}
                          </p>
                          {/* Plain text only â€” never rendered as HTML. */}
                          <p className="whitespace-pre-wrap break-words">
                            {m.body}
                          </p>
                          {m.attachmentDataUrl ? (
                            <a
                              href={m.attachmentDataUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Open the screenshot full size"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={m.attachmentDataUrl}
                                alt="Problem screenshot"
                                className="mt-2 max-h-64 rounded-md border border-white/10"
                              />
                            </a>
                          ) : null}
                          <p className="mt-0.5 text-right text-[10px] opacity-60">
                            {formatDateTime(m.createdAt)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {detail.messages.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-500">
                    No messages in this conversation yet.
                  </p>
                ) : null}
              </div>

              {/* reply composer */}
               {canReply ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleSendReply();
                }}
                className="border-t border-ink-700 p-3"
              >
                <div className="flex items-end gap-2">
                  <textarea
                    value={reply}
                    onChange={(e) => setReply(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void handleSendReply();
                      }
                    }}
                    rows={2}
                    maxLength={2000}
                    placeholder="Reply to the userâ€¦"
                    aria-label="Reply"
                    className="min-h-0 flex-1 resize-none rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    disabled={sending || reply.trim().length === 0}
                  >
                    {sending ? 'Sendingâ€¦' : 'Send reply'}
                  </Button>
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  The user is notified instantly (notification center + push).
                </p>
              </form>
               ) : null}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
