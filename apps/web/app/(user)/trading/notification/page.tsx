'use client';

import { useEffect, useState, useCallback } from 'react';
import { TradingShell } from '@/components/trading/trading-shell';
import {
  listMyNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  type NotificationItem,
  type NotificationFilter,
} from '@/lib/api/notifications';
import { dispatchNotificationsChanged } from '@/components/notifications/unread-badge';
import { useAuth } from '@/src/lib/auth';
import Link from 'next/link';

export default function TradingNotificationPage() {
  const { ready, isAuthenticated } = useAuth();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<NotificationFilter>('all');
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    if (!ready || !isAuthenticated) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await listMyNotifications({ filter, limit: 50 });
      setNotifications(res.items);
      setUnreadCount(res.unread);
      setTotalCount(res.total);
    } catch {
      // Offline or network error
    } finally {
      setLoading(false);
    }
  }, [ready, isAuthenticated, filter]);

  useEffect(() => {
    void fetchNotifications();
  }, [fetchNotifications]);

  const handleMarkAsRead = async (id: string) => {
    setActionInProgress(id);
    try {
      await markNotificationRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
      dispatchNotificationsChanged();
    } catch {
      // ignore
    } finally {
      setActionInProgress(null);
    }
  };

  const handleMarkAllAsRead = async () => {
    setActionInProgress('all');
    try {
      await markAllNotificationsRead();
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
      dispatchNotificationsChanged();
    } catch {
      // ignore
    } finally {
      setActionInProgress(null);
    }
  };

  function getNotificationBadge(type: string) {
    if (type.includes('DEPOSIT') || type.includes('WON') || type.includes('APPROVED')) {
      return {
        bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
        icon: (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ),
      };
    }
    if (type.includes('REJECTED') || type.includes('LOST') || type.includes('ALERT')) {
      return {
        bg: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
        icon: (
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        ),
      };
    }
    return {
      bg: 'bg-amber-400/10 text-amber-400 border-amber-400/20',
      icon: (
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
    };
  }

  function formatRelativeTime(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  return (
    <TradingShell>
      <div className="space-y-6 max-w-4xl mx-auto py-2">
        {/* Header with Title and Mark all Read */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-ink-800 pb-5">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-black text-white tracking-tight">
                Notifications
              </h1>
              {unreadCount > 0 && (
                <span className="rounded-full bg-amber-400/15 border border-amber-400/30 px-2.5 py-0.5 text-xs font-bold text-amber-400 font-mono">
                  {unreadCount} Unread
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Real-time trading updates, deposit/withdrawal confirmations, and security alerts.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllAsRead}
                disabled={actionInProgress === 'all'}
                className="rounded-lg border border-ink-700 bg-ink-800/80 px-3 py-1.5 text-xs font-semibold text-slate-300 hover:border-amber-400/40 hover:text-white transition disabled:opacity-50"
              >
                {actionInProgress === 'all' ? 'Marking...' : 'Mark all as read'}
              </button>
            )}
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-1.5">
          {(['all', 'unread', 'read'] as NotificationFilter[]).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setFilter(tab)}
              className={`rounded-full px-3.5 py-1 text-xs font-bold capitalize transition ${
                filter === tab
                  ? 'bg-amber-400/15 text-amber-400 border border-amber-400/40 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-white/5 border border-transparent'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Notifications Container */}
        <div className="rounded-2xl border border-ink-700/80 bg-ink-900/60 overflow-hidden shadow-2xl backdrop-blur">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-amber-400 border-t-transparent" />
              <p className="text-xs font-medium text-slate-400">Loading your notifications...</p>
            </div>
          ) : !isAuthenticated ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-4 space-y-4">
              <div className="h-12 w-12 rounded-full bg-amber-400/10 flex items-center justify-center text-amber-400">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <div>
                <p className="font-bold text-white text-base">Sign In Required</p>
                <p className="text-xs text-slate-400 mt-1 max-w-sm">
                  Please sign in to view your account notifications and transaction updates.
                </p>
              </div>
              <Link
                href="/login"
                className="rounded-full bg-gradient-to-r from-amber-400 to-[#F0B90B] px-5 py-2 text-xs font-bold text-ink-950 hover:brightness-110 shadow-lg shadow-amber-500/20"
              >
                Sign In
              </Link>
            </div>
          ) : notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center px-4 space-y-3">
              <div className="h-12 w-12 rounded-full bg-ink-800 flex items-center justify-center text-slate-500">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
              </div>
              <div>
                <p className="font-bold text-white text-sm">No Notifications Found</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {filter === 'unread'
                    ? "You're all caught up! No unread notifications."
                    : 'Your notifications will appear here once activity occurs.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-ink-800">
              {notifications.map((item) => {
                const badge = getNotificationBadge(item.type);
                return (
                  <div
                    key={item.id}
                    className={`flex items-start gap-3.5 p-4 transition ${
                      item.isRead ? 'bg-transparent hover:bg-white/[0.02]' : 'bg-amber-400/[0.04] hover:bg-amber-400/[0.07]'
                    }`}
                  >
                    <div className={`flex-shrink-0 rounded-xl border p-2.5 ${badge.bg}`}>
                      {badge.icon}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <h3 className={`text-xs sm:text-sm font-bold truncate ${item.isRead ? 'text-slate-200' : 'text-white'}`}>
                            {item.title}
                          </h3>
                          {!item.isRead && (
                            <span className="flex-shrink-0 h-1.5 w-1.5 rounded-full bg-amber-400" />
                          )}
                        </div>
                        <span className="flex-shrink-0 text-[10px] font-mono text-slate-500">
                          {formatRelativeTime(item.createdAt)}
                        </span>
                      </div>

                      <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                        {item.message}
                      </p>

                      {item.actionUrl && (
                        <div className="mt-2.5">
                          <Link
                            href={item.actionUrl}
                            className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-400 hover:text-amber-300"
                          >
                            <span>View Details</span>
                            <span>&rarr;</span>
                          </Link>
                        </div>
                      )}
                    </div>

                    {!item.isRead && (
                      <button
                        type="button"
                        onClick={() => handleMarkAsRead(item.id)}
                        disabled={actionInProgress === item.id}
                        title="Mark as read"
                        className="flex-shrink-0 text-slate-500 hover:text-amber-400 p-1 rounded transition"
                      >
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </TradingShell>
  );
}
