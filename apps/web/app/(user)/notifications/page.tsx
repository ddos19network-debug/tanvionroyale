'use client';

/**
 * User notification center - real pages backed by the backend
 * Notification tables (GET /notifications, POST /notifications/:id/read,
 * POST /notifications/read-all).
 *
 * Clicking a notification marks it read and navigates to the SERVER-SET
 * actionUrl only when that URL is a safe in-app path (mirrored allowlist).
 * Unknown/unsafe actionUrl values fall back to this page.
 */

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationFilter,
  type NotificationItem,
  type NotificationListResult,
} from '@/lib/api/notifications';
import { useAuth } from '@/src/lib/auth';
import { dispatchNotificationsChanged } from '@/components/notifications/unread-badge';

const PAGE_SIZE = 20;

const TYPE_LABELS: Record<string, string> = {
  DEPOSIT_APPROVED: 'Deposit approved',
  DEPOSIT_REJECTED: 'Deposit rejected',
  WITHDRAWAL_APPROVED: 'Withdrawal approved',
  WITHDRAWAL_REJECTED: 'Withdrawal rejected',
  WITHDRAWAL_COMPLETED: 'Withdrawal completed',
  BET_WON: 'Bet won',
  BET_LOST: 'Bet lost',
  NEW_DEPOSIT_REQUEST: 'New deposit request',
  NEW_WITHDRAWAL_REQUEST: 'New withdrawal request',
  NEW_USER_REGISTRATION: 'New user registered',
  SECURITY_ALERT: 'Security alert',
  SYSTEM_ANNOUNCEMENT: 'System announcement',
  PROMOTION: 'New promotion',
  GENERAL: 'Notification',
};

/** Mirrors the backend allowlist - never navigate to arbitrary URLs. */
const SAFE_PATH_PREFIXES = [
  '/wallet',
  '/my-bets',
  '/dashboard',
  '/promotions',
  '/profile',
  '/settings',
  '/support',
  '/admin',
] as const;

function safeActionUrl(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim().slice(0, 200);
  if (!v.startsWith('/') || v.startsWith('//')) return null;
  if (/[\s<>\"]/.test(v)) return null;
  const ok = SAFE_PATH_PREFIXES.some(
    (p) => v === p || v.startsWith(p + '/') || v.startsWith(p + '?'),
  );
  return ok ? v : null;
}

function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? type.replace(/_/g, ' ').toLowerCase();
}

function relativeTime(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.floor(delta / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function NotificationsPage() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();

  const [data, setData] = useState<NotificationListResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [markedIds, setMarkedIds] = useState<Set<string>>(new Set());

  const load = useCallback(
    async (nextFilter: NotificationFilter, nextPage: number) => {
      setLoading(true);
      setError(null);
      try {
        const result = await listMyNotifications({
          limit: PAGE_SIZE,
          page: nextPage,
          filter: nextFilter,
        });
        const existing = nextPage === 0 ? [] : (data?.items ?? []);
        setData({
          items: nextPage === 0 ? result.items : [...existing, ...result.items],
          total: result.total,
          unread: result.unread,
        });
        setHasMore(nextPage === 0 && result.items.length < result.total);
      } catch (err) {
        setError(
          err instanceof Error && err.message
            ? err.message
            : 'Unable to load notifications.',
        );
      } finally {
        setLoading(false);
      }
    },
    [data],
  );

  useEffect(() => {
    void load(filter, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  useEffect(() => {
    if (!isAuthenticated) router.replace('/login');
  }, [isAuthenticated, router]);

  async function openNotification(item: NotificationItem) {
    if (!item.isRead && !markedIds.has(item.id)) {
      const next = new Set(markedIds);
      next.add(item.id);
      setMarkedIds(next);
      try {
        await markNotificationRead(item.id);
        dispatchNotificationsChanged();
      } catch {
        /* read update is best-effort; the row stays unread server-side */
      }
    }
    const target = safeActionUrl(item.actionUrl);
    if (target) router.push(target);
  }

  async function readAll() {
    try {
      const result = await markAllNotificationsRead();
      if (data && result.marked > 0) {
        setData({
          ...data,
          unread: Math.max(0, data.unread - result.marked),
          items: [...data.items].map((item) =>
            item.isRead ? item : { ...item, isRead: true, readAt: new Date().toISOString() },
          ),
        });
      }
      dispatchNotificationsChanged();
    } catch {
      /* best-effort */
    }
  }

  function loadMore() {
    void load(filter, page + 1);
    setPage(page + 1);
  }

  const unread = data?.unread ?? 0;
  const items = data?.items ?? [];

  return (
    <main className="min-h-screen w-full bg-ink-950 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto w-full max-w-4xl">
        <div className="mb-5 rounded-2xl border border-white/10 bg-ink-800 p-4 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Account</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-100 sm:text-3xl">
            Notifications
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {unread > 0 ? `🔔 ${unread} unread` : 'You are all caught up.'}
          </p>
        </div>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {(['all', 'unread', 'read'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => {
                setPage(0);
                setFilter(option);
              }}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                filter === option
                  ? 'bg-brand text-ink-950'
                  : 'bg-ink-800 text-slate-300 hover:bg-white/10'
              }`}
            >
              {option === 'all' ? 'All' : option === 'unread' ? 'Unread' : 'Read'}
            </button>
          ))}
          <button
            type="button"
            onClick={() => void readAll()}
            className="ml-auto rounded-lg border border-ink-600 px-3 py-1.5 text-sm font-medium text-slate-300 transition hover:bg-white/10"
          >
            Mark all read
          </button>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-500/40 bg-red-950/50 p-4 text-sm text-red-300" role="alert">
            {error}
          </div>
        ) : !loading && items.length === 0 ? (
          <div className="rounded-xl border border-white/10 bg-ink-800 p-6 text-center text-sm text-slate-500">
            No notifications here yet. Deposit, withdrawal and bet updates will appear
            automatically as real events happen.
          </div>
        ) : (
          <ul className="divide-y divide-white/10 overflow-hidden rounded-xl border border-white/10 bg-ink-800">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => void openNotification(item)}
                  className="flex w-full items-start gap-3 px-4 py-3.5 text-left transition hover:bg-white/5"
                >
                  <span
                    aria-hidden
                    className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                      item.isRead || markedIds.has(item.id) ? 'bg-transparent' : 'bg-brand'
                    }`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-100">
                      {item.title}
                    </span>
                    <span className="mt-0.5 block text-sm text-slate-300">
                      {item.message}
                    </span>
                    <span className="mt-1 block text-xs text-slate-400">
                      {typeLabel(item.type)} · {relativeTime(item.createdAt)}
                    </span>
                  </span>
                  <span className="shrink-0 text-slate-400" aria-hidden>
                    ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {loading && items.length === 0 ? (
          <p className="mt-4 text-center text-sm text-slate-400" role="status">
            Loading notifications…
          </p>
        ) : null}

        {hasMore ? (
          <button
            type="button"
            onClick={loadMore}
            className="mt-4 w-full rounded-lg border border-ink-600 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/10"
          >
            {loading ? 'Loading…' : 'Load more'}
          </button>
        ) : null}
      </div>
    </main>
  );
}
