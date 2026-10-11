'use client';

/**
 * Admin — Notifications center.
 *
 * Real endpoints (ADMIN/SUPER_ADMIN only; RBAC enforced server-side):
 *   GET  /admin/notifications
 *   GET  /admin/notifications/stats
 *   POST /admin/notifications/send   → all | selected | single
 *
 * Recipients are chosen from the existing admin user directory
 * (GET /admin/users). The backend is the final authority: normal users can
 * never call these routes (403), and unsanitised content is rejected there.
 */

import { useCallback, useEffect, useState } from 'react';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { Button } from '@tanvion-royale/ui';
import {
  listAdminUsers,
  type AdminUserListItem,
} from '@/lib/api/admin';
import {
  getAdminNotificationsStats,
  listAdminNotifications,
  sendAdminNotification,
  type AdminNotificationsStats,
  type AdminSendMode,
  type NotificationItem,
} from '@/lib/api/notifications';
import {
  AdminPageHeader,
  AdminStatCard,
  formatDateTime,
} from '@/components/admin/ui';
import { useToast } from '@/components/admin/toast';
import { useAdminPermission } from '@/components/admin/admin-guard';

const SEND_TYPES = [
  { value: 'SYSTEM_ANNOUNCEMENT', label: 'System Announcement' },
  { value: 'PROMOTION', label: 'New Promotion' },
  { value: 'SECURITY_ALERT', label: 'Security Alert' },
  { value: 'GENERAL', label: 'General Notification' },
] as const;

export default function AdminNotificationsPage() {
  const { toast } = useToast();
  const canSend = useAdminPermission(ADMIN_PERMISSIONS.NOTIFICATIONS_SEND);

  const [stats, setStats] = useState<AdminNotificationsStats | null>(null);
  const [history, setHistory] = useState<NotificationItem[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const [mode, setMode] = useState<AdminSendMode>('all');
  const [type, setType] = useState('SYSTEM_ANNOUNCEMENT');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [singleUserId, setSingleUserId] = useState('');

  const [users, setUsers] = useState<AdminUserListItem[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [sending, setSending] = useState(false);

  const loadAll = useCallback(async () => {
    setHistoryError(null);
    try {
      const [stat, feed] = await Promise.all([
        getAdminNotificationsStats(),
        listAdminNotifications({ limit: 50 }),
      ]);
      setStats(stat);
      setHistory(feed.items);
    } catch (err) {
      setHistoryError(err instanceof Error && err.message ? err.message : 'Failed to load notifications.');
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
    if (mode !== 'all') {
      void listAdminUsers({ page: 0, limit: 200 })
        .then((page) => {
          setUsers(page.items);
          setUsersLoaded(true);
        })
        .catch(() => setUsersLoaded(true));
    }
  }, [mode, loadAll]);

  const filteredUsers = users.filter(
    (u) =>
      !userSearch ||
      u.username.toLowerCase().includes(userSearch.toLowerCase()) ||
      u.email.toLowerCase().includes(userSearch.toLowerCase()),
  );

  function toggleUser(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  }

  async function send() {
    // Double-submit guard (Part 35).
    if (sending) return;
    if (!title.trim() || !message.trim()) {
      toast('Title and message are required.');
      return;
    }
    if (mode === 'selected' && selectedIds.size === 0) {
      toast('Select at least one recipient.');
      return;
    }
    if (mode === 'single' && !singleUserId) {
      toast('Choose a recipient user.');
      return;
    }

    setSending(true);
    try {
      const result = await sendAdminNotification({
        mode,
        type: type as 'SYSTEM_ANNOUNCEMENT' | 'PROMOTION' | 'SECURITY_ALERT' | 'GENERAL',
        title: title.trim(),
        message: message.trim(),
        ...(mode === 'selected' ? { userIds: [...selectedIds] } : {}),
        ...(mode === 'single' ? { userId: singleUserId } : {}),
      });
      // Category B (standalone form): clear sensitive form state → refresh
      // the recent list → THEN show the result. Values are only cleared on
      // SUCCESS — a failure preserves everything the admin typed.
      setTitle('');
      setMessage('');
      setSelectedIds(new Set());
      setSingleUserId('');
      await loadAll();
      toast(
        result.created > 0
          ? `Notification sent to ${result.created} recipient${result.created === 1 ? '' : 's'}.`
          : 'Notification already delivered (no duplicates).',
      );
    } catch (err) {
      toast(err instanceof Error && err.message ? err.message : 'Failed to send notification.');
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <AdminPageHeader
        title="Notifications"
        description="Send manual notifications (All users, Selected users, or one user) and review delivered notices + delivery stats."
        crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Notifications' }]}
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AdminStatCard label="Total notifications" value={String(stats?.total ?? 0)} />
        <AdminStatCard label="Unread" value={String(stats?.unread ?? 0)} tone={stats && stats.unread > 0 ? 'warn' : 'good'} />
        <AdminStatCard label="Registered devices" value={String(stats?.activeDevices ?? 0)} />
        <AdminStatCard label="Failed push deliveries" value={String(stats?.failedDeliveries ?? 0)} tone={stats && stats.failedDeliveries > 0 ? 'bad' : 'default'} />
      </div>

      {canSend ? (
      <section className="rounded-xl border border-ink-600 bg-ink-900 p-5">
        <h2 className="text-base font-semibold text-white">Create Notification</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          Recipients receive an in-app notification (source of truth) and an FCM browser push when their device is registered.
        </p>

        <div className="mt-4 grid gap-4">
          <fieldset>
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">Recipient</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {([
                ['all', 'All Users'],
                ['selected', 'Selected Users'],
                ['single', 'Individual User'],
              ] as const).map(([value, label]) => (
                <label key={value} className="flex cursor-pointer items-center gap-2 text-sm text-slate-200">
                  <input
                    type="radio"
                    name="recipient-mode"
                    value={value}
                    checked={mode === value}
                    onChange={() => setMode(value)}
                    className="h-4 w-4 accent-teal-500"
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>

          {mode === 'selected' || mode === 'single' ? (
            <div className="rounded-lg border border-ink-600 bg-ink-800 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                {mode === 'selected' ? 'Select users (up to 200 loaded)' : 'Choose one user'}
              </p>
              <label className="mt-2 flex items-center gap-2 text-sm">
                <span className="text-xs text-slate-400">Search</span>
                <input
                  type="search"
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="username or email…"
                  className="rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
                />
              </label>
              <div className="mt-2 max-h-52 overflow-y-auto">
                {usersLoaded ? (
                  filteredUsers.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-slate-500">No users match.</p>
                  ) : (
                    filteredUsers.map((u) => {
                      const checked = mode === 'selected' ? selectedIds.has(u.id) : singleUserId === u.id;
                      return (
                        <label
                          key={u.id}
                          className="flex cursor-pointer items-start gap-2 px-3 py-1.5 text-sm text-slate-200 hover:bg-ink-700"
                        >
                          <input
                            type={mode === 'selected' ? 'checkbox' : 'radio'}
                            name="single-user"
                            checked={checked}
                            onChange={() => {
                              if (mode === 'selected') toggleUser(u.id);
                              else setSingleUserId(u.id);
                            }}
                            className="h-4 w-4 accent-teal-500"
                          />
                          <span className="min-w-0 flex-1 truncate">
                            {u.username}
                            <span className="block max-w-full truncate text-xs text-slate-500">
                              {u.email}
                            </span>
                          </span>
                        </label>
                      );
                    })
                  )
                ) : (
                  <p className="px-3 py-2 text-xs text-slate-500">Loading users…</p>
                )}
              </div>
            </div>
) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Notification Type</span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
              >
                {SEND_TYPES.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={120}
                placeholder="e.g. Happy-hour sports promotion"
                className="rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1.5 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Message</span>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Write the notification message…"
              className="rounded-md border border-ink-600 bg-ink-800 px-3 py-2 text-sm text-slate-100 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-500/30"
            />
          </label>

          <div>
            <Button disabled={sending} onClick={() => void send()}>
              {sending ? 'Sending…' : 'Send Notification'}
            </Button>
          </div>
        </div>
      </section>
      ) : (
        <section className="rounded-xl border border-ink-600 bg-ink-900 p-5">
          <h2 className="text-base font-semibold text-white">Create Notification</h2>
          <p className="mt-1 text-sm text-amber-300">Read-only: notifications.send is required to create or send notifications.</p>
        </section>
      )}

      <section className="mt-6">
        <h2 className="mb-2 text-base font-semibold text-white">Recent notifications</h2>
        {loadingHistory ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : historyError ? (
          <p className="rounded-lg border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300" role="alert">
            {historyError}
          </p>
        ) : history && history.length > 0 ? (
          <ul className="divide-y divide-ink-700 overflow-hidden rounded-xl border border-ink-600 bg-ink-900">
            {history.map((n) => (
              <li key={n.id} className="flex items-start gap-3 px-4 py-3">
                <span
                  className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${n.isRead ? 'bg-ink-600' : 'bg-teal-400'}`}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-100">{n.title}</span>
                  <span className="block text-sm text-slate-300">{n.message}</span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {n.audience} · {n.type} · {formatDateTime(n.createdAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-ink-600 bg-ink-900 p-4 text-sm text-slate-400">
            No notifications sent yet.
          </p>
        )}
      </section>
    </>
  );
}