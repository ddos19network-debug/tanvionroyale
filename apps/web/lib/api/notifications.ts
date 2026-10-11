/**
 * Frontend notification API — user + admin endpoints.
 *
 * Backend (NestJS):
 *   USER  → /notifications, /notifications/unread-count,
 *           /notifications/:id/read, /notifications/read-all,
 *           /notifications/devices (+ deactivate)
 *   ADMIN → /admin/notifications, /admin/notifications/stats,
 *           /admin/notifications/send   (ADMIN/SUPER_ADMIN only, RBAC)
 *
 * The notification row shape below mirrors the Prisma Notification model
 * (id, type, title, message, data, isRead, readAt, createdAt…). `data` is a
 * server-set JSON payload (amounts, references) — never secrets, never HTML.
 */

import { authFetch } from './client';

export type NotificationAudience = 'USER' | 'ADMIN';

export type NotificationType =
  | 'DEPOSIT_APPROVED'
  | 'DEPOSIT_REJECTED'
  | 'WITHDRAWAL_APPROVED'
  | 'WITHDRAWAL_REJECTED'
  | 'WITHDRAWAL_COMPLETED'
  | 'BET_WON'
  | 'BET_LOST'
  | 'NEW_DEPOSIT_REQUEST'
  | 'NEW_WITHDRAWAL_REQUEST'
  | 'NEW_USER_REGISTRATION'
  | 'SECURITY_ALERT'
  | 'SYSTEM_ANNOUNCEMENT'
  | 'PROMOTION'
  | 'GENERAL';

export interface NotificationItem {
  id: string;
  recipientUserId: string;
  audience: NotificationAudience;
  type: NotificationType;
  title: string;
  message: string;
  data: Record<string, unknown> | null;
  actionUrl: string | null;
  dedupeKey: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationListResult {
  items: NotificationItem[];
  total: number;
  unread: number;
}

export type NotificationFilter = 'all' | 'read' | 'unread';

export interface NotificationListParams {
  limit?: number;
  page?: number;
  filter?: NotificationFilter;
}

/* ------------------------------------------------------------------------- */
/* User endpoints (own notifications only — IDOR-safe on the backend)        */
/* ------------------------------------------------------------------------- */

export async function listMyNotifications(
  params: NotificationListParams = {},
): Promise<NotificationListResult> {
  const qs = new URLSearchParams();
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.page) qs.set('page', String(params.page));
  if (params.filter && params.filter !== 'all') qs.set('filter', params.filter);
  const q = qs.toString();
  return authFetch<NotificationListResult>(`/notifications${q ? `?${q}` : ''}`);
}

export async function getUnreadCount(): Promise<{ unread: number }> {
  return authFetch<{ unread: number }>('/notifications/unread-count');
}

export async function markNotificationRead(id: string): Promise<{ ok: boolean }> {
  return authFetch<{ ok: boolean }>(`/notifications/${encodeURIComponent(id)}/read`, {
    method: 'POST',
  });
}

export async function markAllNotificationsRead(): Promise<{ marked: number }> {
  return authFetch<{ marked: number }>('/notifications/read-all', {
    method: 'POST',
  });
}

export interface DeviceRegistrationResult {
  id: string;
  isActive: boolean;
}

/** Register this browser's FCM push token. The token is a public registration
 *  identifier — never a secret. Backend enforces the authenticated user. */
export async function registerNotificationDevice(input: {
  token: string;
  platform?: string;
  browser?: string;
}): Promise<DeviceRegistrationResult> {
  return authFetch<DeviceRegistrationResult>('/notifications/devices', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Deactivate the current browser's FCM token (logout / permission revoked). */
export async function deactivateNotificationDevice(token: string): Promise<{ ok: boolean }> {
  return authFetch<{ ok: boolean }>('/notifications/devices/deactivate', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

/* ------------------------------------------------------------------------- */
/* Admin endpoints (RBAC: ADMIN/SUPER_ADMIN only — enforced server-side)      */
/* ------------------------------------------------------------------------- */

export type AdminSendMode = 'all' | 'selected' | 'single';

export interface AdminSendNotificationInput {
  mode: AdminSendMode;
  userIds?: string[];
  userId?: string;
  type: 'SYSTEM_ANNOUNCEMENT' | 'PROMOTION' | 'SECURITY_ALERT' | 'GENERAL';
  title: string;
  message: string;
  actionUrl?: string;
}

export interface AdminSendNotificationResult {
  created: number;
  duplicates: number;
}

export async function listAdminNotifications(
  params: NotificationListParams = {},
): Promise<NotificationListResult> {
  const qs = new URLSearchParams();
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.page) qs.set('page', String(params.page));
  if (params.filter && params.filter !== 'all') qs.set('filter', params.filter);
  const q = qs.toString();
  return authFetch<NotificationListResult>(`/admin/notifications${q ? `?${q}` : ''}`);
}

export interface AdminNotificationsStats {
  total: number;
  unread: number;
  activeDevices: number;
  failedDeliveries: number;
}

export async function getAdminNotificationsStats(): Promise<AdminNotificationsStats> {
  return authFetch<AdminNotificationsStats>('/admin/notifications/stats');
}

export async function sendAdminNotification(
  input: AdminSendNotificationInput,
): Promise<AdminSendNotificationResult> {
  return authFetch<AdminSendNotificationResult>('/admin/notifications/send', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}