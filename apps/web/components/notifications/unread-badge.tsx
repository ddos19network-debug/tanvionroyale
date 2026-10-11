'use client';

/**
 * Unread notification badge (🔔 N).
 *
 * Realtime strategy: the backend Notification table is the source of truth and
 * FCM handles browser push. For in-app badge updates this component polls
 * /notifications/unread-count on a modest interval and also refreshes:
 *   - immediately on window focus
 *   - immediately when a `tr:notifications-changed` window event is dispatched
 *     (e.g. the notification center marks rows read)
 * This keeps the badge accurate without a full page refresh and without adding
 * a second push channel.
 */

import { useEffect, useRef, useState } from 'react';
import { getUnreadCount } from '@/lib/api/notifications';
import { useAuth } from '@/src/lib/auth';

export const NOTIFICATIONS_CHANGED_EVENT = 'tr:notifications-changed';

export function dispatchNotificationsChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED_EVENT));
}

const POLL_INTERVAL_MS = 30_000;

export function UnreadBadge() {
  const { ready, isAuthenticated } = useAuth();
  const [unread, setUnread] = useState<number | null>(null);
  const fetchingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function refresh() {
      // `ready` gates this on purpose. Until the AuthProvider has validated the
      // stored session, `isAuthenticated` is only the OPTIMISTIC seeded value
      // from localStorage — polling then fired
      // GET /notifications/unread-count with a stale/expired access token and
      // produced a pointless 401 in the console on every public page load
      // (including /signup). Waiting for `ready` means we only call a
      // protected endpoint once we actually KNOW the session is valid.
      if (!ready) return;
      if (!isAuthenticated) {
        setUnread(null);
        return;
      }
      if (fetchingRef.current) return;
      fetchingRef.current = true;
      try {
        const result = await getUnreadCount();
        if (!cancelled) setUnread(result.unread);
      } catch {
        if (!cancelled) setUnread(null);
      } finally {
        fetchingRef.current = false;
      }
    }

    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_INTERVAL_MS);
    const onFocus = () => void refresh();
    const onChange = () => void refresh();
    window.addEventListener('focus', onFocus);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, onChange);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, onChange);
    };
  }, [isAuthenticated, ready]);

  if (!isAuthenticated || unread === null || unread < 1) return null;

  return (
    <span
      aria-label={`${unread} unread notifications`}
      title={`${unread} unread notification${unread === 1 ? '' : 's'}`}
      className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-[10px] font-bold leading-none text-ink-950"
    >
      {unread > 99 ? '99+' : unread}
    </span>
  );
}