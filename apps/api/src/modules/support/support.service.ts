import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import { NotificationService } from '../notifications/notification.service';
import {
  MAX_ATTACHMENT_DATA_URL_LENGTH,
  MAX_REPORT_DESCRIPTION_LENGTH,
  MAX_SUPPORT_MESSAGE_LENGTH,
  PROBLEM_REPORT_CATEGORIES,
  SUPPORT_TICKET_STATUSES,
} from './dto/support.dto';
/**
 * Support service (REST) — Live Chat AND problem reports.
 *
 * Live Chat: one ACTIVE conversation per user. Messages are persisted in
 * PostgreSQL and both sides are kept in sync through the EXISTING notification
 * system (in-app + optional FCM push). The authenticated identity ALWAYS comes
 * from the JWT via the guards — never from the request body.
 *
 * Problem reports ("Report a Problem", /support/report) reuse the same
 * SupportTicket/SupportMessage tables + lifecycle but are NOT merged into the
 * single chat thread: every report is its own OPEN case with source
 * PROBLEM_REPORT, optional contact details and an optional screenshot.
 *
 * Unread counters are server-derived:
 *   - adminUnreadCount: user messages the admin side has not seen yet.
 *   - userUnreadCount:  admin messages the user has not seen yet.
 */

/** Window of messages returned for the active conversation. */
const CONVERSATION_MESSAGE_WINDOW = 50;

/** Spec screenshot rule: JPG/JPEG/PNG/WebP, max 5MB decoded. GIF was allowed
 *  historically — old rows stay readable but NEW uploads reject it. */
const NEW_IMAGE_DATA_URL_PREFIXES = [
  'data:image/jpeg;base64,',
  'data:image/png;base64,',
  'data:image/webp;base64,',
] as const;

const LEGACY_IMAGE_DATA_URL_PREFIXES = [
  ...NEW_IMAGE_DATA_URL_PREFIXES,
  'data:image/gif;base64,',
] as const;

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/** Minimum length of a problem description (mirrors CreateProblemReportDto —
 *  re-checked in the service so a caller can never bypass the DTO). */
const MIN_REPORT_DESCRIPTION_LENGTH = 10;

const ADMIN_ROLES = ['ADMIN', 'SUPER_ADMIN'] as const;

const ticketInclude = {
  user: {
    select: { id: true, username: true, email: true, phone: true },
  },
  assignedAdmin: {
    select: { id: true, username: true },
  },
} satisfies Prisma.SupportTicketInclude;

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // -------------------------------------------------------------------------
  // USER side (identity from the authenticated session)
  // -------------------------------------------------------------------------

  /** The user's ACTIVE Live Chat conversation (created on first use; a new one
   *  starts after the previous one was CLOSED). Scoped to source LIVE_CHAT so
   *  problem-report cases (their OWN tickets) are never reused as the chat. */
  private async getOrCreateTicket(userId: string) {
    const latest = await this.prisma.supportTicket.findFirst({
      where: { userId, source: 'LIVE_CHAT' },
      orderBy: { createdAt: 'desc' },
    });
    if (latest && latest.status !== 'CLOSED') return latest;
    return this.prisma.supportTicket.create({
      data: { userId, source: 'LIVE_CHAT' },
    });
  }

  /** Active conversation + most recent messages (oldest → newest). */
  async getMyConversation(userId: string) {
    const ticket = await this.getOrCreateTicket(userId);
    const messages = await this.prisma.supportMessage.findMany({
      where: { ticketId: ticket.id },
      orderBy: { createdAt: 'desc' },
      take: CONVERSATION_MESSAGE_WINDOW,
    });
    return {
      ticket: this.serializeTicket(ticket),
      messages: messages.reverse().map((m) => this.serializeMessage(m)),
    };
  }

  /** Older history for the active conversation (keyset pagination). */
  async listMyMessages(
    userId: string,
    params: { before?: string; limit?: number },
  ) {
    const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
    let before: Date | undefined;
    if (params.before) {
      before = new Date(params.before);
      if (Number.isNaN(before.getTime())) {
        throw new BadRequestException('Invalid "before" cursor');
      }
    }

    const ticket = await this.getOrCreateTicket(userId);
    const rows = await this.prisma.supportMessage.findMany({
      where: {
        ticketId: ticket.id,
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse();
    return {
      items: page.map((m) => this.serializeMessage(m)),
      hasMore,
    };
  }

  /** Persist a user message; notify the admin side. Idempotent per clientRef. */
  async sendMyMessage(
    userId: string,
    input: { body: string; clientRef?: string },
  ) {
    const body = this.cleanBody(input.body);
    const ticket = await this.getOrCreateTicket(userId);

    if (input.clientRef) {
      const existing = await this.prisma.supportMessage.findUnique({
        where: {
          ticketId_clientRef: { ticketId: ticket.id, clientRef: input.clientRef },
        },
      });
      if (existing) {
        return {
          message: this.serializeMessage(existing),
          created: false,
          ticket: this.serializeTicket(ticket),
        };
      }
    }

    // A new user message re-opens a RESOLVED / WAITING_FOR_USER conversation
    // (the admin side must look at it again). CLOSED threads are never
    // reached here — getOrCreateTicket already started a fresh conversation.
    const nextStatus =
      ticket.status === 'IN_PROGRESS' || ticket.status === 'OPEN'
        ? ticket.status
        : 'OPEN';

    const created = await this.prisma.$transaction(async (tx) => {
      const message = await tx.supportMessage.create({
        data: {
          ticketId: ticket.id,
          authorUserId: userId,
          authorRole: 'USER',
          body,
          clientRef: input.clientRef ?? null,
        },
      });
      await tx.supportTicket.update({
        where: { id: ticket.id },
        data: {
          status: nextStatus,
          lastMessageAt: message.createdAt,
          adminUnreadCount: { increment: 1 },
          userUnreadCount: 0, // the user has seen everything up to their own send
        },
      });
      return message;
    });

    await this.notifyAdminsSafe(created.id, ticket.id, body, userId);

    return {
      message: this.serializeMessage(created),
      created: true,
      ticket: this.serializeTicket({
        ...ticket,
        status: nextStatus,
        adminUnreadCount: ticket.adminUnreadCount + 1,
        userUnreadCount: 0,
      }),
    };
  }

  /** The user opened/caught up on the Live Chat conversation. */
  async markMyRead(userId: string): Promise<{ ok: true }> {
    await this.prisma.supportTicket.updateMany({
      where: { userId, source: 'LIVE_CHAT', status: { not: 'CLOSED' } },
      data: { userUnreadCount: 0 },
    });
    return { ok: true };
  }

// -------------------------------------------------------------------------
  // PROBLEM REPORTS (user side)
  //
  // "Report a Problem" (/support/report) is deliberately NOT Live Chat: every
  // submission creates its OWN case (an OPEN ticket with source
  // PROBLEM_REPORT), so a report is never merged into — or hidden behind — the
  // single per-user chat thread. The ticket lifecycle (OPEN → IN_PROGRESS →
  // WAITING_FOR_USER → RESOLVED → CLOSED) and the admin inbox are reused
  // unchanged, and the identity is still ALWAYS the JWT user: the contact
  // fields are display data for the admin, never an authorisation input.
  // -------------------------------------------------------------------------

  /** New screenshot validation (spec: JPG/JPEG/PNG/WebP, max 5MB decoded).
   *  Rejects GIF on NEW uploads; old GIF rows stay stored/viewable. Both the
   *  decoded byte size AND the data-URL length are capped so a hostile client
   *  cannot bypass the 5MB rule via base64 padding tricks. */
  private isAllowedNewAttachmentDataUrl(value: string): boolean {
    return /^data:image\/(jpeg|jpg|png|webp);base64,/i.test(value);
  }

  private decodedDataUrlBytes(value: string): number {
    const comma = value.indexOf(',');
    const b64 = comma >= 0 ? value.slice(comma + 1) : value;
    const cleaned = b64.replace(/\s/g, '');
    const padding = cleaned.endsWith('==') ? 2 : cleaned.endsWith('=') ? 1 : 0;
    return Math.floor((cleaned.length * 3) / 4) - padding;
  }

  /** Validate an optional screenshot; empty/blank input means "no attachment". */
  private cleanAttachment(raw?: string | null): string | undefined {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) return undefined;
    if (value.length > MAX_ATTACHMENT_DATA_URL_LENGTH) {
      throw new BadRequestException('Screenshot is too large (max 5MB)');
    }
    if (!this.isAllowedNewAttachmentDataUrl(value)) {
      throw new BadRequestException(
        'Only JPG, JPEG, PNG or WebP screenshots are allowed',
      );
    }
    if (this.decodedDataUrlBytes(value) > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException('Screenshot is too large (max 5MB)');
    }
    return value;
  }

  /** Problem description: plain text, trimmed, with clean user-safe errors. */
  private cleanReportCategory(raw: unknown): string {
    const category = typeof raw === 'string' ? raw.trim() : '';
    if (
      !(PROBLEM_REPORT_CATEGORIES as readonly string[]).includes(category)
    ) {
      throw new BadRequestException('Please select a problem category');
    }
    return category;
  }

  /** Problem description: plain text, trimmed, with clean user-safe errors. */
  private cleanReportBody(raw: string): string {
    const body = typeof raw === 'string' ? raw.trim() : '';
    if (body.length < MIN_REPORT_DESCRIPTION_LENGTH) {
      throw new BadRequestException(
        `Please describe the problem in at least ${MIN_REPORT_DESCRIPTION_LENGTH} characters`,
      );
    }
    if (body.length > MAX_REPORT_DESCRIPTION_LENGTH) {
      throw new BadRequestException(
        `Description is too long (max ${MAX_REPORT_DESCRIPTION_LENGTH} characters)`,
      );
    }
    return body;
  }

/**
   * Submit a problem report — ALWAYS creates a NEW ticket (never reuses an
   * existing OPEN conversation). Returns the serialized { ticket, message } so
   * the client can navigate straight to the new case.
   */
  async createProblemReport(
    userId: string,
    input: {
      category: string;
      contactName?: string;
      contactEmail?: string;
      contactPhone?: string;
      body: string;
      attachmentDataUrl?: string;
    },
  ) {
    const category = this.cleanReportCategory(input.category);
    const body = this.cleanReportBody(input.body);
    const attachmentDataUrl = this.cleanAttachment(input.attachmentDataUrl);
    const contactName =
      typeof input.contactName === 'string' ? input.contactName.trim() : '';
    const contactEmail =
      typeof input.contactEmail === 'string' ? input.contactEmail.trim() : '';
    const contactPhone =
      typeof input.contactPhone === 'string' ? input.contactPhone.trim() : '';
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) {
      throw new BadRequestException('Please enter a valid email address');
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.create({
        data: {
          userId, // ALWAYS the authenticated identity — never a client value.
          source: 'PROBLEM_REPORT',
          status: 'OPEN',
          category,
          contactName: contactName || null,
          contactEmail: contactEmail || null,
          contactPhone: contactPhone || null,
        },
      });
      const message = await tx.supportMessage.create({
        data: {
          ticketId: ticket.id,
          authorUserId: userId,
          authorRole: 'USER',
          body,
          attachmentDataUrl: attachmentDataUrl ?? null,
        },
      });
      await tx.supportTicket.update({
        where: { id: ticket.id },
        data: {
          lastMessageAt: message.createdAt,
          adminUnreadCount: { increment: 1 },
          userUnreadCount: 0,
        },
      });
      return { ticket, message };
    });

    await this.notifyAdminsSafe(
      created.message.id,
      created.ticket.id,
      body,
      userId,
      'PROBLEM_REPORT',
      category,
    );

    // User-facing confirmation (existing in-app + FCM notification system):
    // the report submission itself is acknowledged in the notification
    // center, and admin replies arrive through the same channel.
    try {
      await this.notifications.create({
        recipientUserId: userId,
        audience: 'USER',
        type: 'SUPPORT_REPLY',
        title: 'Problem report received',
        message: `Your ${category} report has been received. Our support team will review it and reply here.`,
        data: { ticketId: created.ticket.id, category },
        actionUrl: `/support/reports/${created.ticket.id}`,
        dedupeKey: `problem-report-received:${created.ticket.id}`,
      });
    } catch (error) {
      this.logger.warn(
        `problem-report user notification skipped: ${this.errText(error)}`,
      );
    }

    return {
      ticket: this.serializeTicket({
        ...created.ticket,
        adminUnreadCount: created.ticket.adminUnreadCount + 1,
      }),
      message: this.serializeMessage(created.message),
    };
  }

  /** The user's OWN problem reports, newest first (paginated). */
  async listMyReports(
    userId: string,
    params: { status?: string; page?: number; limit?: number },
  ) {
    const page = Math.max(params.page ?? 0, 0);
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);

    const where: Prisma.SupportTicketWhereInput = {
      userId,
      source: 'PROBLEM_REPORT',
    };
    if (params.status && params.status !== 'ALL') {
      where.status = params.status as Prisma.EnumSupportTicketStatusFilter['equals'];
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.supportTicket.findMany({
        where,
        include: {
          // Preview of the ORIGINAL description (the first message).
          messages: {
            orderBy: { createdAt: 'asc' as const },
            take: 1,
            select: {
              id: true,
              body: true,
              authorRole: true,
              createdAt: true,
              attachmentDataUrl: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: page * limit,
        take: limit,
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return {
      items: rows.map((t) => ({
        ...this.serializeTicket(t),
        firstMessage: t.messages[0] ?? null,
      })),
      total,
      page,
      limit,
    };
  }

  /**
   * One report thread (all messages, oldest → newest).
   *
   * Ownership is enforced in the WHERE clause: another user's ticket id is a
   * NotFound (never a 403 — a 403 would leak that the id exists, the same rule
   * every other user-scoped endpoint in this codebase follows).
   */
  async getMyReport(userId: string, ticketId: string) {
    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, userId },
    });
    if (!ticket) throw new NotFoundException('Report not found');

    const messages = await this.prisma.supportMessage.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'asc' },
    });

    // The user is looking at the thread now → admin feedback has been seen.
    if (ticket.userUnreadCount > 0) {
      await this.prisma.supportTicket.updateMany({
        where: { id: ticketId, userId },
        data: { userUnreadCount: 0 },
      });
    }

    return {
      ticket: this.serializeTicket({ ...ticket, userUnreadCount: 0 }),
      messages: messages.map((m) => this.serializeMessage(m)),
    };
  }

  /** Follow-up message on an existing report thread (same case, new message). */
  async replyToMyReport(
    userId: string,
    ticketId: string,
    input: { body: string; clientRef?: string; attachmentDataUrl?: string },
  ) {
    const body = this.cleanBody(input.body);
    const attachmentDataUrl = this.cleanAttachment(input.attachmentDataUrl);

    const ticket = await this.prisma.supportTicket.findFirst({
      where: { id: ticketId, userId },
    });
    if (!ticket) throw new NotFoundException('Report not found');

    if (input.clientRef) {
      const existing = await this.prisma.supportMessage.findUnique({
        where: {
          ticketId_clientRef: { ticketId, clientRef: input.clientRef },
        },
      });
      if (existing) {
        return {
          message: this.serializeMessage(existing),
          created: false,
          ticket: this.serializeTicket(ticket),
        };
      }
    }

    // Same rule as Live Chat: a new user message puts the case back in the
    // admin's court (RESOLVED / WAITING_FOR_USER / CLOSED re-open as OPEN).
    const nextStatus =
      ticket.status === 'IN_PROGRESS' || ticket.status === 'OPEN'
        ? ticket.status
        : 'OPEN';

    const created = await this.prisma.$transaction(async (tx) => {
      const message = await tx.supportMessage.create({
        data: {
          ticketId,
          authorUserId: userId,
          authorRole: 'USER',
          body,
          clientRef: input.clientRef ?? null,
          attachmentDataUrl: attachmentDataUrl ?? null,
        },
      });
      await tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: nextStatus,
          lastMessageAt: message.createdAt,
          adminUnreadCount: { increment: 1 },
          userUnreadCount: 0, // the user has seen everything up to their own send
        },
      });
      return message;
    });

    await this.notifyAdminsSafe(
      created.id,
      ticketId,
      body,
      userId,
      'PROBLEM_REPORT',
    );

    return {
      message: this.serializeMessage(created),
      created: true,
      ticket: this.serializeTicket({
        ...ticket,
        status: nextStatus,
        adminUnreadCount: ticket.adminUnreadCount + 1,
        userUnreadCount: 0,
      }),
    };
  }

  // -------------------------------------------------------------------------
  // ADMIN side (RBAC enforced by the controller guards)
  // -------------------------------------------------------------------------

  /** Admin inbox: conversations ordered by most recent activity. */
  async adminListTickets(params: {
    status?: string;
    source?: string;
    q?: string;
    page?: number;
    limit?: number;
  }) {
    const page = Math.max(params.page ?? 0, 0);
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);

    const where: Prisma.SupportTicketWhereInput = {};
    if (params.status && params.status !== 'ALL') {
      where.status = params.status as Prisma.EnumSupportTicketStatusFilter['equals'];
    }
    if (params.source && params.source !== 'ALL') {
      where.source = params.source as Prisma.EnumSupportTicketSourceFilter['equals'];
    }
    const q = params.q?.trim();
    if (q) {
      where.user = {
        OR: [
          { username: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.supportTicket.findMany({
        where,
        include: {
          ...ticketInclude,
          messages: {
            orderBy: { createdAt: 'desc' as const },
            take: 1,
            select: { id: true, body: true, authorRole: true, createdAt: true },
          },
        },
        orderBy: { lastMessageAt: 'desc' },
        skip: page * limit,
        take: limit,
      }),
      this.prisma.supportTicket.count({ where }),
    ]);

    return {
      items: rows.map((t) => ({
        ...this.serializeTicket(t),
        user: t.user,
        assignedAdmin: t.assignedAdmin,
        lastMessage: t.messages[0] ?? null,
      })),
      total,
      page,
      limit,
    };
  }

  /** Total unread user messages across open conversations (inbox badge). */
  async adminUnreadCount(): Promise<{ unread: number }> {
    const agg = await this.prisma.supportTicket.aggregate({
      where: { status: { not: 'CLOSED' } },
      _sum: { adminUnreadCount: true },
    });
    return { unread: agg._sum.adminUnreadCount ?? 0 };
  }

  /** Full conversation for the admin panel. Throws when it does not exist. */
  async adminGetTicket(ticketId: string) {
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      include: ticketInclude,
    });
    if (!ticket) throw new NotFoundException('Conversation not found');

    const messages = await this.prisma.supportMessage.findMany({
      where: { ticketId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    return {
      ticket: {
        ...this.serializeTicket(ticket),
        user: ticket.user,
        assignedAdmin: ticket.assignedAdmin,
      },
      messages: messages.reverse().map((m) => this.serializeMessage(m)),
    };
  }

  /** Persist an admin reply; notify the user. Idempotent per clientRef. */
  async adminReply(
    ticketId: string,
    adminUserId: string,
    input: { body: string; clientRef?: string },
  ) {
    const body = this.cleanBody(input.body);
    const ticket = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
    });
    if (!ticket) throw new NotFoundException('Conversation not found');

    if (input.clientRef) {
      const existing = await this.prisma.supportMessage.findUnique({
        where: {
          ticketId_clientRef: { ticketId, clientRef: input.clientRef },
        },
      });
      if (existing) {
        return { message: this.serializeMessage(existing), created: false };
      }
    }

    // Admin replied → the ball is in the user's court. Replying to a CLOSED
    // conversation re-engages it as IN_PROGRESS.
    const nextStatus =
      ticket.status === 'CLOSED' ? 'IN_PROGRESS' : 'WAITING_FOR_USER';

    const created = await this.prisma.$transaction(async (tx) => {
      const message = await tx.supportMessage.create({
        data: {
          ticketId,
          authorUserId: adminUserId,
          authorRole: 'ADMIN',
          body,
          clientRef: input.clientRef ?? null,
        },
      });
      await tx.supportTicket.update({
        where: { id: ticketId },
        data: {
          status: nextStatus,
          lastMessageAt: message.createdAt,
          userUnreadCount: { increment: 1 },
          adminUnreadCount: 0, // the admin has seen everything up to their reply
        },
      });
      return message;
    });

    // Notify the USER that support replied (fail-safe — never rolls back).
    // A problem report nudges the user into ITS OWN thread, not Live Chat.
    const isReport = ticket.source === 'PROBLEM_REPORT';
    try {
      await this.notifications.create({
        recipientUserId: ticket.userId,
        audience: 'USER',
        type: 'SUPPORT_REPLY',
        title: isReport
          ? 'Support replied to your problem report'
          : 'Support replied to you',
        message: isReport
          ? `Support replied to your problem report: ${body.slice(0, 160)}`
          : `Support replied in Live Chat: ${body.slice(0, 160)}`,
        data: { ticketId, messageId: created.id, source: ticket.source },
        actionUrl: isReport ? `/support/reports/${ticketId}` : '/support/chat',
        dedupeKey: `support-reply:${created.id}`,
      });
    } catch (error) {
      this.logger.warn(
        `SUPPORT_REPLY notification skipped: ${this.errText(error)}`,
      );
    }

    return { message: this.serializeMessage(created), created: true };
  }

  /** Move a conversation through its lifecycle. */
  async adminUpdateStatus(ticketId: string, status: string) {
    if (!SUPPORT_TICKET_STATUSES.includes(status as never)) {
      throw new BadRequestException('Invalid status');
    }
    const existing = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Conversation not found');
    const ticket = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { status: status as never },
      include: ticketInclude,
    });

    // A problem report's status IS the user-visible feedback ("your report was
    // resolved"), so the owner is told about it. Live Chat keeps its existing
    // behaviour (status is visible the next time the user opens the chat).
    if (ticket.source === 'PROBLEM_REPORT') {
      await this.notifyUserOfReportStatus(ticket.userId, ticketId, status);
    }

    return { ticket: this.serializeAdminTicket(ticket) };
  }

  /** Tell the report owner that an admin moved their case to `status`.
   *  Fail-safe — a notification failure never rolls back the status change. */
  private async notifyUserOfReportStatus(
    recipientUserId: string,
    ticketId: string,
    status: string,
  ): Promise<void> {
    const label = status.replace(/_/g, ' ').toLowerCase();
    try {
      await this.notifications.create({
        recipientUserId,
        audience: 'USER',
        type: 'SUPPORT_REPLY',
        title: 'Your problem report was updated',
        message: `Support marked your problem report as ${label}.`,
        data: { ticketId, status, source: 'PROBLEM_REPORT' },
        actionUrl: `/support/reports/${ticketId}`,
        dedupeKey: `support-report-status:${ticketId}:${status}`,
      });
    } catch (error) {
      this.logger.warn(
        `SUPPORT_REPORT_STATUS notification skipped: ${this.errText(error)}`,
      );
    }
  }

  /**
   * Assign the conversation to an authorized admin. Omitted adminId → the
   * calling admin; explicit null → unassign. The target is verified to hold
   * an ADMIN/SUPER_ADMIN role in the database (never trusted from the client).
   */
  async adminAssign(
    ticketId: string,
    caller: { id: string },
    adminId?: string | null,
  ) {
    const existing = await this.prisma.supportTicket.findUnique({
      where: { id: ticketId },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Conversation not found');

    let targetId: string | null;
    if (adminId === null || adminId === undefined) {
      // undefined → assign to self; null → unassign.
      targetId = adminId === null ? null : caller.id;
    } else {
      const isAdmin = await this.prisma.userRole.findFirst({
        where: {
          userId: adminId,
          role: { name: { in: [...ADMIN_ROLES] } },
        },
        select: { userId: true },
      });
      if (!isAdmin) {
        throw new BadRequestException('Selected user is not an administrator');
      }
      targetId = adminId;
    }

    const ticket = await this.prisma.supportTicket.update({
      where: { id: ticketId },
      data: { assignedAdminId: targetId },
      include: ticketInclude,
    });
    return { ticket: this.serializeAdminTicket(ticket) };
  }

  /** The admin opened/caught up on the conversation. */
  async adminMarkRead(ticketId: string): Promise<{ ok: true }> {
    await this.prisma.supportTicket.updateMany({
      where: { id: ticketId },
      data: { adminUnreadCount: 0 },
    });
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // helpers
  // -------------------------------------------------------------------------

  /** Reject empty / whitespace-only / overlong bodies with clean messages. */
  private cleanBody(raw: string): string {
    const body = typeof raw === 'string' ? raw.trim() : '';
    if (!body) {
      throw new BadRequestException('Message must not be empty');
    }
    if (body.length > MAX_SUPPORT_MESSAGE_LENGTH) {
      throw new BadRequestException(
        `Message is too long (max ${MAX_SUPPORT_MESSAGE_LENGTH} characters)`,
      );
    }
    return body;
  }

  /** Fan-out to every ADMIN/SUPER_ADMIN — fail-safe, never throws.
   *
   *  `kind` only changes the wording: a problem report must not be announced as
   *  a Live Chat message (the admin still finds both in the same inbox). */
  private async notifyAdminsSafe(
    messageId: string,
    ticketId: string,
    body: string,
    fromUserId: string,
    kind: 'LIVE_CHAT' | 'PROBLEM_REPORT' = 'LIVE_CHAT',
    category?: string,
  ): Promise<void> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: fromUserId },
        select: { username: true },
      });
      const who = user?.username ?? 'a user';
      const isReport = kind === 'PROBLEM_REPORT';
      await this.notifications.notifyAdmins({
        type: 'SUPPORT_MESSAGE',
        title: isReport ? 'New problem report' : 'New Live Chat message',
        message: isReport
          ? `New problem report (${category ?? 'Other'}) from ${who}: ${body.slice(0, 160)}`
          : `New message from ${who} in Live Chat: ${body.slice(0, 160)}`,
        data: { ticketId, messageId, source: kind, category: category ?? null },
        actionUrl: '/admin/support',
        dedupeKey: `support-message:${messageId}`,
      });
    } catch (error) {
      this.logger.warn(
        `SUPPORT_MESSAGE notification skipped: ${this.errText(error)}`,
      );
    }
  }

  private serializeTicket(ticket: {
    id: string;
    status: string;
    adminUnreadCount: number;
    userUnreadCount: number;
    lastMessageAt: Date;
    createdAt: Date;
    source?: string | null;
    category?: string | null;
    contactName?: string | null;
    contactEmail?: string | null;
    contactPhone?: string | null;
  }) {
    return {
      id: ticket.id,
      status: ticket.status,
      adminUnreadCount: ticket.adminUnreadCount,
      userUnreadCount: ticket.userUnreadCount,
      lastMessageAt: ticket.lastMessageAt,
      createdAt: ticket.createdAt,
      // 'LIVE_CHAT' for every row created before problem reports existed, and
      // null contact fields on Live Chat conversations — both are harmless.
      source: ticket.source ?? 'LIVE_CHAT',
      category: ticket.category ?? null,
      contactName: ticket.contactName ?? null,
      contactEmail: ticket.contactEmail ?? null,
      contactPhone: ticket.contactPhone ?? null,
    };
  }

  /** Admin-facing ticket shape (adds assignment info, never user secrets). */
  private serializeAdminTicket(ticket: {
    id: string;
    status: string;
    adminUnreadCount: number;
    userUnreadCount: number;
    lastMessageAt: Date;
    createdAt: Date;
    assignedAdminId: string | null;
    assignedAdmin: { id: string; username: string } | null;
  }) {
    return {
      ...this.serializeTicket(ticket),
      assignedAdminId: ticket.assignedAdminId,
      assignedAdmin: ticket.assignedAdmin,
    };
  }

  private serializeMessage(message: {
    id: string;
    ticketId: string;
    authorUserId: string;
    authorRole: string;
    body: string;
    clientRef: string | null;
    createdAt: Date;
    attachmentDataUrl?: string | null;
  }) {
    return {
      id: message.id,
      ticketId: message.ticketId,
      authorUserId: message.authorUserId,
      authorRole: message.authorRole,
      body: message.body,
      clientRef: message.clientRef,
      createdAt: message.createdAt,
      // Optional screenshot (base64 image data URL) — null on plain chat text.
      attachmentDataUrl: message.attachmentDataUrl ?? null,
    };
  }

  private errText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
