/**
 * Frontend Support / Live Chat API — user + admin endpoints.
 *
 * Backend (NestJS, REST):
 *   USER  → GET    /support/chat
 *           GET    /support/chat/messages?before&limit
 *           POST   /support/chat/messages        { body, clientRef? }
 *           POST   /support/chat/read
 *   USER  → POST   /support/reports               { category, contactName?,
 *                                                   contactEmail?, contactPhone?,
 *                                                   body, attachmentDataUrl? }
 *           GET    /support/reports?status&page&limit
 *           GET    /support/reports/:id
 *           POST   /support/reports/:id/messages { body, clientRef?,
 *                                                  attachmentDataUrl? }
 *   ADMIN → GET    /admin/support/tickets?status&source&q&page&limit
 *           GET    /admin/support/unread-count
 *           GET    /admin/support/tickets/:id
 *           POST   /admin/support/tickets/:id/read
 *           POST   /admin/support/tickets/:id/reply   { body, clientRef? }
 *           PATCH  /admin/support/tickets/:id/status  { status }
 *           POST   /admin/support/tickets/:id/assign  { adminId? }
 *
 * The backend derives the identity from the JWT (never from the body) and
 * enforces ownership (users) / RBAC (admins) itself.
 */

import { authFetch } from './client';

export type SupportTicketStatus =
  | 'OPEN'
  | 'IN_PROGRESS'
  | 'WAITING_FOR_USER'
  | 'RESOLVED'
  | 'CLOSED';

export type SupportMessageAuthorRole = 'USER' | 'ADMIN';

/** Where a support case came from. Live Chat is the single per-user chat;
 *  PROBLEM_REPORT is a one-off reported problem (its own case). */
export type SupportTicketSource = 'LIVE_CHAT' | 'PROBLEM_REPORT';

export const SUPPORT_TICKET_SOURCES: readonly SupportTicketSource[] = [
  'LIVE_CHAT',
  'PROBLEM_REPORT',
];

export const SUPPORT_TICKET_STATUSES: readonly SupportTicketStatus[] = [
  'OPEN',
  'IN_PROGRESS',
  'WAITING_FOR_USER',
  'RESOLVED',
  'CLOSED',
];

/** Hard limit mirrored from the backend — the client never sends more. */
export const MAX_SUPPORT_MESSAGE_LENGTH = 2000;

/** Problem description limit (mirrors MAX_REPORT_DESCRIPTION_LENGTH). */
export const MAX_REPORT_DESCRIPTION_LENGTH = 4000;

/** Problem categories selectable on "Report a Problem" (mirrors the backend). */
export const PROBLEM_REPORT_CATEGORIES = [
  'Login / Account',
  'Deposit',
  'Withdrawal',
  'Payment',
  'Game',
  'Sports',
  'Betting',
  'Live Chat',
  'Technical Issue',
  'Other',
] as const;

export type ProblemReportCategory =
  (typeof PROBLEM_REPORT_CATEGORIES)[number];

/** Screenshot rule: JPG/JPEG/PNG/WebP, max 5MB decoded (the server also caps
 *  the data-URL length at 7.2M chars — the client never sends more). */
export const MAX_REPORT_SCREENSHOT_BYTES = 5 * 1024 * 1024;

/** MIME types the screenshot picker accepts (spec list — GIF excluded). */
export const REPORT_SCREENSHOT_ACCEPT =
  'image/jpeg,image/png,image/webp';

export interface SupportMessage {
  id: string;
  ticketId: string;
  authorUserId: string;
  authorRole: SupportMessageAuthorRole;
  body: string;
  clientRef: string | null;
  createdAt: string;
  /** Optional screenshot (base64 image data URL) — null on plain text. */
  attachmentDataUrl: string | null;
}

export interface SupportTicket {
  id: string;
  status: SupportTicketStatus;
  adminUnreadCount: number;
  userUnreadCount: number;
  lastMessageAt: string;
  createdAt: string;
  source: SupportTicketSource;
  /** Problem category selected on "Report a Problem" (null on Live Chat). */
  category: string | null;
  /** Contact details captured by the /support/report form (null on Live Chat). */
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

export interface SupportConversation {
  ticket: SupportTicket;
  messages: SupportMessage[];
}

export interface SupportMessagesPage {
  items: SupportMessage[];
  hasMore: boolean;
}

export interface SendMessageResult {
  message: SupportMessage;
  created: boolean;
  ticket: SupportTicket;
}

/* ------------------------------------------------------------------------- */
/* User endpoints (server scopes everything to the authenticated user)       */
/* ------------------------------------------------------------------------- */

export async function getSupportConversation(): Promise<SupportConversation> {
  return authFetch<SupportConversation>('/support/chat');
}

export async function listSupportMessages(params: {
  before?: string;
  limit?: number;
} = {}): Promise<SupportMessagesPage> {
  const qs = new URLSearchParams();
  if (params.before) qs.set('before', params.before);
  if (params.limit) qs.set('limit', String(params.limit));
  const q = qs.toString();
  return authFetch<SupportMessagesPage>(
    `/support/chat/messages${q ? `?${q}` : ''}`,
  );
}

export async function sendSupportMessage(input: {
  body: string;
  clientRef?: string;
}): Promise<SendMessageResult> {
  return authFetch<SendMessageResult>('/support/chat/messages', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function markSupportRead(): Promise<{ ok: boolean }> {
  return authFetch<{ ok: boolean }>('/support/chat/read', { method: 'POST' });
}

/* ------------------------------------------------------------------------- */
/* Problem Reports (a reported problem is its OWN case — never Live Chat)    */
/* ------------------------------------------------------------------------- */

export interface SubmitProblemReportInput {
  /** Problem category (one of PROBLEM_REPORT_CATEGORIES). */
  category: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  /** Problem description (plain text; 10–4000 characters). */
  body: string;
  /** Optional screenshot as an image data URL (see MAX_REPORT_SCREENSHOT_BYTES). */
  attachmentDataUrl?: string;
}

export interface SubmitProblemReportResult {
  ticket: SupportTicket;
  message: SupportMessage;
}

/** First message preview shown in the reports list. */
export interface SupportReportSummaryMessage {
  id: string;
  body: string;
  authorRole: SupportMessageAuthorRole;
  createdAt: string;
  attachmentDataUrl: string | null;
}

export interface SupportReportListItem extends SupportTicket {
  firstMessage: SupportReportSummaryMessage | null;
}

export interface SupportReportListResult {
  items: SupportReportListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface SupportReportThread {
  ticket: SupportTicket;
  messages: SupportMessage[];
}

export interface ReportReplyResult {
  message: SupportMessage;
  created: boolean;
  ticket: SupportTicket;
}

export type SupportReportStatusFilter = SupportTicketStatus | 'ALL';

/** Submit "Report a Problem" — the server ALWAYS opens a NEW case for it. */
export async function submitProblemReport(
  input: SubmitProblemReportInput,
): Promise<SubmitProblemReportResult> {
  return authFetch<SubmitProblemReportResult>('/support/reports', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function listMyReports(
  params: { status?: SupportReportStatusFilter; page?: number; limit?: number } = {},
): Promise<SupportReportListResult> {
  const qs = new URLSearchParams();
  if (params.status && params.status !== 'ALL') qs.set('status', params.status);
  if (params.page) qs.set('page', String(params.page));
  if (params.limit) qs.set('limit', String(params.limit));
  const q = qs.toString();
  return authFetch<SupportReportListResult>(
    `/support/reports${q ? `?${q}` : ''}`,
  );
}

export async function getMyReport(id: string): Promise<SupportReportThread> {
  return authFetch<SupportReportThread>(
    `/support/reports/${encodeURIComponent(id)}`,
  );
}

export async function replyMyReport(
  id: string,
  input: { body: string; clientRef?: string; attachmentDataUrl?: string },
): Promise<ReportReplyResult> {
  return authFetch<ReportReplyResult>(
    `/support/reports/${encodeURIComponent(id)}/messages`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

/* ------------------------------------------------------------------------- */
/* Admin endpoints (RBAC: ADMIN/SUPER_ADMIN only — enforced server-side)     */
/* ------------------------------------------------------------------------- */

export interface SupportUserSummary {
  id: string;
  username: string;
  email: string | null;
  phone: string | null;
}

export interface SupportAdminSummary {
  id: string;
  username: string;
}

export interface SupportTicketListItem extends SupportTicket {
  user: SupportUserSummary;
  assignedAdmin: SupportAdminSummary | null;
  lastMessage: {
    id: string;
    body: string;
    authorRole: SupportMessageAuthorRole;
    createdAt: string;
  } | null;
}

export interface AdminTicketListResult {
  items: SupportTicketListItem[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminTicketDetail {
  ticket: SupportTicketListItem;
  messages: SupportMessage[];
}

export interface AdminReplyResult {
  message: SupportMessage;
  created: boolean;
}

export type AdminTicketStatusFilter = SupportTicketStatus | 'ALL';
export type AdminTicketSourceFilter = SupportTicketSource | 'ALL';

export async function listAdminSupportTickets(params: {
  status?: AdminTicketStatusFilter;
  source?: AdminTicketSourceFilter;
  q?: string;
  page?: number;
  limit?: number;
} = {}): Promise<AdminTicketListResult> {
  const qs = new URLSearchParams();
  if (params.status && params.status !== 'ALL') qs.set('status', params.status);
  if (params.source && params.source !== 'ALL') qs.set('source', params.source);
  if (params.q) qs.set('q', params.q);
  if (params.page) qs.set('page', String(params.page));
  if (params.limit) qs.set('limit', String(params.limit));
  const query = qs.toString();
  return authFetch<AdminTicketListResult>(
    `/admin/support/tickets${query ? `?${query}` : ''}`,
  );
}

export async function getAdminSupportUnreadCount(): Promise<{ unread: number }> {
  return authFetch<{ unread: number }>('/admin/support/unread-count');
}

export async function getAdminSupportTicket(id: string): Promise<AdminTicketDetail> {
  return authFetch<AdminTicketDetail>(
    `/admin/support/tickets/${encodeURIComponent(id)}`,
  );
}

export async function markAdminSupportTicketRead(
  id: string,
): Promise<{ ok: boolean }> {
  return authFetch<{ ok: boolean }>(
    `/admin/support/tickets/${encodeURIComponent(id)}/read`,
    { method: 'POST' },
  );
}

export async function replyAdminSupportTicket(
  id: string,
  input: { body: string; clientRef?: string },
): Promise<AdminReplyResult> {
  return authFetch<AdminReplyResult>(
    `/admin/support/tickets/${encodeURIComponent(id)}/reply`,
    { method: 'POST', body: JSON.stringify(input) },
  );
}

export async function updateAdminSupportTicketStatus(
  id: string,
  status: SupportTicketStatus,
): Promise<{ ticket: SupportTicketAdminFields }> {
  return authFetch<{ ticket: SupportTicketAdminFields }>(
    `/admin/support/tickets/${encodeURIComponent(id)}/status`,
    { method: 'PATCH', body: JSON.stringify({ status }) },
  );
}

export async function assignAdminSupportTicket(
  id: string,
  adminId?: string | null,
): Promise<{ ticket: SupportTicketAdminFields }> {
  return authFetch<{ ticket: SupportTicketAdminFields }>(
    `/admin/support/tickets/${encodeURIComponent(id)}/assign`,
    {
      method: 'POST',
      body: JSON.stringify(adminId === undefined ? {} : { adminId }),
    },
  );
}

/** Admin mutation responses include the assignment state. */
export type SupportTicketAdminFields = SupportTicket & {
  assignedAdminId: string | null;
  assignedAdmin: SupportAdminSummary | null;
};

