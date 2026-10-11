/**
 * TANVION ROYALE — Firebase Cloud Messaging service worker.
 *
 * Served from /firebase-messaging-sw.js (a Vercel static asset, HTTPS only).
 * The FCM Web SDK in the app (lib/notifications/fcm-client.ts) registers this
 * worker at this canonical path and binds an FCM registration token to it.
 *
 * Responsibilities:
 *   1. Receive background push payloads when the app is closed / unfocused and
 *      surface them via self.registration.showNotification (best-effort).
 *   2. Forward notification clicks to a SAFE in-app route. The click target is
 *      ALWAYS server-set (the backend writes an allowlisted /path into the push
 *      data payload); arbitrary URLs from untrusted clients are rejected here
 *      as defense in depth.
 *
 * This file is intentionally dependency-free (management of the Firebase SDK
 * inside a classic service worker on non-Firebase hosting is not reliable and
 * is not required: the browser displays the native notification title/body the
 * backend already sends, and fcmOptions.link handles the primary click path).
 *
 * NOTE: user-facing in-app open-state updates come from the backend
 * Notification tables (source of truth) via the badge poller — the worker
 * never fabricates application state.
 */

'use strict';

/* Never let an unexpected payload crash the worker event loop. */
function readPayload(event) {
  try {
    return event.data ? event.data.json() : null;
  } catch (_err) {
    return null;
  }
}

/* Accept only same-site relative in-app paths (server-set values). */
function safeTarget(raw) {
  if (typeof raw !== 'string') return null;
  const v = raw.trim();
  if (!v.startsWith('/') || v.startsWith('//')) return null;
  if (/[\s<>\"]/.test(v)) return null;
  return v;
}

self.addEventListener('push', (event) => {
  const payload = readPayload(event);
  const data = (payload && typeof payload.data === 'object' && payload.data) || {};

  event.waitUntil(
    Promise.resolve().then(() => {
      if (typeof self.registration !== 'object' || !self.registration) return;
      const title = typeof data.title === 'string' && data.title
        ? String(data.title).slice(0, 80)
        : 'TANVION ROYALE';
      const body =
        (typeof data.body === 'string' && data.body
          ? String(data.body)
          : payload && payload.notification && typeof payload.notification.body === 'string'
            ? String(payload.notification.body)
            : '')
          .slice(0, 500);
      const icon = typeof data.icon === 'string' && data.icon.startsWith('/')
        ? data.icon
        : '/logo-mark.svg';
      self.registration.showNotification(title, { body, icon });
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification && typeof event.notification.close === 'function' &&
    event.notification.close();

  let target = '/notifications';
  try {
    const raw =
      event.notification &&
        event.notification.data &&
        event.notification.data.link;
    const safe = safeTarget(raw);
    if (safe) target = safe;
  } catch (_err) {
    /* keep the default target */
  }

  const url = new URL(target, self.location.origin).toString();
  event.waitUntil(
    Promise.resolve().then(() => {
      if (self.clients && typeof self.clients.openWindow === 'function') {
        return self.clients.openWindow(url);
      }
      return undefined;
    }),
  );
});