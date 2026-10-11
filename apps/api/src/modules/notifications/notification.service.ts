import { Injectable, Logger, Optional } from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import { BLOCKED_ACCOUNT_STATUSES } from '../../common/utils/account-status';
import { FcmPushSender } from './fcm.sender';

/**
 * Canonical notification service - ONLY writer of Notification tables.
 * Source of truth = Postgres. FCM = push delivery provider only.
 * Push failure NEVER throws, NEVER rolls back business operations.
 * Automatic notifications are idempotent via dedupeKey.
 */

export type NotificationAudience = 'USER' | 'ADMIN';

export interface CreateNotificationInput {
  recipientUserId: string;
  audience?: NotificationAudience;
  type: string;
  title: string;
  message: string;
  data?: Record<string, unknown>;
  actionUrl?: string | null;
  dedupeKey?: string | null;
}

const SAFE_PREFIXES = [
  '/wallet', '/my-bets', '/dashboard', '/promotions',
  '/profile', '/settings', '/support', '/admin', '/',
];

function sanitiseActionUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const v = raw.trim().slice(0, 200);
  if (!v.startsWith('/') || v.startsWith('//')) return null;
  if (/[\s<>"]/.test(v)) return null;
  const ok = SAFE_PREFIXES.some((p) =>
    p === '/' ? v === '/' : v === p || v.startsWith(p + '/') || v.startsWith(p + '?'),
  );
  return ok ? v : null;
}

function asJson(input: Record<string, unknown> | undefined): Prisma.InputJsonValue | undefined {
  if (!input) return undefined;
  try {
    return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
  } catch {
    return undefined;
  }
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly push: FcmPushSender,
  ) {}

  async registerDevice(
    userId: string,
    input: { token: string; platform?: string; browser?: string },
  ): Promise<{ id: string; isActive: boolean }> {
    const token = input.token.trim();
    const existing = await this.prisma.notificationDevice.findUnique({
      where: { provider_token: { provider: 'fcm', token } },
    });
    if (existing) {
      const row = await this.prisma.notificationDevice.update({
        where: { id: existing.id },
        data: {
          userId, isActive: true, lastSeenAt: new Date(),
          platform: input.platform?.slice(0, 16) ?? existing.platform,
          browser: input.browser?.slice(0, 64) ?? existing.browser,
        },
      });
      return { id: row.id, isActive: row.isActive };
    }
    const row = await this.prisma.notificationDevice.create({
      data: {
        userId, provider: 'fcm', token, isActive: true,
        platform: input.platform?.slice(0, 16),
        browser: input.browser?.slice(0, 64),
      },
    });
    return { id: row.id, isActive: row.isActive };
  }

  async deactivateDevice(userId: string, token: string): Promise<void> {
    await this.prisma.notificationDevice.updateMany({
      where: { userId, provider: 'fcm', token: token.trim() },
      data: { isActive: false },
    });
  }

  async create(input: CreateNotificationInput): Promise<{ id: string; duplicate: boolean }> {
    const actionUrl = sanitiseActionUrl(input.actionUrl ?? null);
    if (input.dedupeKey) {
      const existing = await this.prisma.notification.findUnique({
        where: {
          dedupeKey_recipientUserId: {
            dedupeKey: input.dedupeKey,
            recipientUserId: input.recipientUserId,
          },
        },
        select: { id: true },
      });
      if (existing) return { id: existing.id, duplicate: true };
    }
    let row: { id: string };
    try {
      row = await this.prisma.notification.create({
        data: {
          recipientUserId: input.recipientUserId,
          audience: (input.audience ?? 'USER') as never,
          type: input.type as never,
          title: input.title.slice(0, 120),
          message: input.message.slice(0, 2000),
          data: asJson(input.data),
          actionUrl,
          dedupeKey: input.dedupeKey ?? null,
        },
        select: { id: true },
      });
    } catch (error) {
      if (input.dedupeKey && this.isUniqueViolation(error)) {
        const winner = await this.prisma.notification.findUnique({
          where: {
            dedupeKey_recipientUserId: {
              dedupeKey: input.dedupeKey,
              recipientUserId: input.recipientUserId,
            },
          },
          select: { id: true },
        });
        if (winner) return { id: winner.id, duplicate: true };
      }
      throw error;
    }
    await this.sendPush(row.id).catch(() => undefined);
    return { id: row.id, duplicate: false };
  }

  async createForUser(
    userId: string,
    input: Omit<CreateNotificationInput, 'recipientUserId'>,
  ): Promise<{ id: string; duplicate: boolean }> {
    return this.create({ ...input, recipientUserId: userId });
  }

  async createForUsers(
    userIds: string[],
    input: Omit<CreateNotificationInput, 'recipientUserId'>,
  ): Promise<{ created: number; duplicates: number }> {
    let created = 0;
    let duplicates = 0;
    const unique = [...new Set(userIds)].slice(0, 500);
    for (const userId of unique) {
      try {
        const r = await this.create({ ...input, recipientUserId: userId });
        if (r.duplicate) duplicates += 1;
        else created += 1;
      } catch (error) {
        this.logger.warn('createForUsers skipped user: ' + this.errText(error));
      }
    }
    return { created, duplicates };
  }

  async createForAllUsers(
    input: Omit<CreateNotificationInput, 'recipientUserId'>,
  ): Promise<{ created: number; duplicates: number }> {
    const users = await this.prisma.user.findMany({
      // Broadcasts never reach blocked accounts (SUSPENDED/BANNED/LOCKED/CLOSED)
      // and never reach staff accounts — they are not part of the customer
      // audience (customer-facing population, Master Fix requirement 1).
      where: {
        status: { notIn: [...BLOCKED_ACCOUNT_STATUSES] },
        accountType: 'CUSTOMER',
      },
      select: { id: true },
      take: 10000,
    });
    return this.createForUsers(users.map((u) => u.id), input);
  }

  async sendPush(notificationId: string): Promise<void> {
    try {
      const n = await this.prisma.notification.findUnique({
        where: { id: notificationId },
      });
      if (!n) return;
      const devices = await this.prisma.notificationDevice.findMany({
        where: { userId: n.recipientUserId, provider: 'fcm', isActive: true },
        select: { id: true, token: true },
        take: 25,
      });
      if (devices.length === 0) return;
      await this.prisma.notificationDelivery.createMany({
        data: devices.map((d) => ({ notificationId: n.id, deviceId: d.id })),
        skipDuplicates: true,
      });
      const results = await this.push.send({
        targets: devices.map((d) => ({ deviceId: d.id, token: d.token })),
        title: n.title,
        body: n.message,
        data: { notificationId: n.id, type: String(n.type) },
        actionUrl: n.actionUrl,
      });
      for (const r of results) {
        try {
          if (r.outcome === 'SENT') {
            await this.prisma.notificationDelivery.updateMany({
              where: { notificationId: n.id, deviceId: r.deviceId },
              data: { status: 'SENT', attempts: { increment: 1 }, sentAt: new Date(), lastError: null },
            });
          } else if (r.outcome === 'INVALID_TOKEN') {
            await this.prisma.notificationDelivery.updateMany({
              where: { notificationId: n.id, deviceId: r.deviceId },
              data: { status: 'INVALID_TOKEN', attempts: { increment: 1 }, lastError: 'stale token' },
            });
            await this.prisma.notificationDevice.update({
              where: { id: r.deviceId },
              data: { isActive: false },
            });
          } else if (r.outcome === 'SKIPPED') {
            await this.prisma.notificationDelivery.updateMany({
              where: { notificationId: n.id, deviceId: r.deviceId },
              data: { status: 'SKIPPED', attempts: { increment: 1 } },
            });
          } else {
            await this.prisma.notificationDelivery.updateMany({
              where: { notificationId: n.id, deviceId: r.deviceId },
              data: { status: 'FAILED', attempts: { increment: 1 }, lastError: (r.error ?? 'failed').slice(0, 300) },
            });
          }
        } catch (inner) {
          this.logger.warn('delivery row update failed: ' + this.errText(inner));
        }
      }
    } catch (error) {
      this.logger.warn('sendPush failed (notification kept): ' + this.errText(error));
    }
  }

  async listForUser(
    userId: string,
    query: { limit?: number; page?: number; filter?: 'all' | 'read' | 'unread' },
    audience?: NotificationAudience,
  ): Promise<{ items: unknown[]; total: number; unread: number }> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 100);
    const page = Math.max(query.page ?? 0, 0);
    const where: Record<string, unknown> = { recipientUserId: userId };
    if (audience) where.audience = audience;
    if (query.filter === 'read') where.isRead = true;
    if (query.filter === 'unread') where.isRead = false;
    const [items, total, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where: where as never,
        orderBy: { createdAt: 'desc' },
        skip: page * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where: where as never }),
      this.prisma.notification.count({
        where: { recipientUserId: userId, ...(audience ? { audience } : {}), isRead: false } as never,
      }),
    ]);
    return { items, total, unread };
  }

  async adminSend(
    adminId: string,
    dto: { mode: 'all' | 'selected' | 'single'; userIds?: string[]; userId?: string; type: string; title: string; message: string; actionUrl?: string },
  ): Promise<{ created: number; duplicates: number }> {
    const title = String(dto.title ?? '').trim().slice(0, 120);
    const message = String(dto.message ?? '').trim().slice(0, 2000);
    if (!title || !message) throw new Error('Title and message are required');
    const actionUrl = sanitiseActionUrl(dto.actionUrl ?? null);
    const base = { type: dto.type, title, message, actionUrl, audience: 'USER' as NotificationAudience };
    if (dto.mode === 'all') {
      const r = await this.createForAllUsers({ ...base, data: { sentBy: adminId } });
      await this.auditAdminSend(adminId, dto, r.created);
      return r;
    }
    if (dto.mode === 'single') {
      if (!dto.userId) throw new Error('userId is required for single send');
      // Customer audience only: a staff id can never be a target (the user
      // selector on the frontend only offers customers, and the server
      // re-checks here so the API cannot be aimed at staff directly).
      const exists = await this.prisma.user.findUnique({
        where: { id: dto.userId },
        select: { id: true, accountType: true },
      });
      if (!exists || exists.accountType !== 'CUSTOMER') {
        throw new Error('Target user not found');
      }
      const r = await this.create({ ...base, recipientUserId: dto.userId, data: { sentBy: adminId } });
      await this.auditAdminSend(adminId, dto, r.duplicate ? 0 : 1);
      return { created: r.duplicate ? 0 : 1, duplicates: r.duplicate ? 1 : 0 };
    }
    const ids = [...new Set(dto.userIds ?? [])].slice(0, 500);
    if (ids.length === 0) throw new Error('userIds is required for selected send');
    // Staff ids supplied directly to the API are silently dropped here —
    // the same way unknown ids already are.
    const found = await this.prisma.user.findMany({
      where: { id: { in: ids }, accountType: 'CUSTOMER' },
      select: { id: true },
    });
    const valid = new Set(found.map((u) => u.id));
    const r = await this.createForUsers(ids.filter((id) => valid.has(id)), { ...base, data: { sentBy: adminId } });
    await this.auditAdminSend(adminId, dto, r.created);
    return r;
  }

  private async auditAdminSend(adminId: string, dto: unknown, created: number): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: adminId, actorType: 'ADMIN', action: 'ADMIN_NOTIFICATION_SENT',
          entityType: 'Notification', entityId: 'manual',
          newValue: { ...(dto as Record<string, unknown>), created },
        },
      });
    } catch (error) {
      this.logger.warn('admin send audit failed: ' + this.errText(error));
    }
  }

  async unreadCount(userId: string): Promise<{ unread: number }> {
    const unread = await this.prisma.notification.count({
      where: { recipientUserId: userId, isRead: false } as never,
    });
    return { unread };
  }

  async markRead(userId: string, id: string): Promise<void> {
    const updated = await this.prisma.notification.updateMany({
      where: { id, recipientUserId: userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    if (updated.count !== 1) {
      const exists = await this.prisma.notification.findFirst({
        where: { id, recipientUserId: userId },
        select: { id: true },
      });
      if (!exists) throw new Error('NOT_FOUND');
    }
  }

  async markAllRead(userId: string): Promise<{ marked: number }> {
    const r = await this.prisma.notification.updateMany({
      where: { recipientUserId: userId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { marked: r.count };
  }

  async adminStats(): Promise<Record<string, number>> {
    const [total, unread, devices, deliveriesFailed] = await Promise.all([
      this.prisma.notification.count(),
      this.prisma.notification.count({ where: { isRead: false } as never }),
      this.prisma.notificationDevice.count({ where: { isActive: true } }),
      this.prisma.notificationDelivery.count({ where: { status: 'FAILED' } }),
    ]);
    return { total, unread, activeDevices: devices, failedDeliveries: deliveriesFailed };
  }

  async notifyAdmins(
    input: Omit<CreateNotificationInput, 'recipientUserId' | 'audience'>,
  ): Promise<void> {
    try {
      const admins = await this.prisma.userRole.findMany({
        where: { role: { name: { in: ['ADMIN', 'SUPER_ADMIN'] } } },
        select: { userId: true },
        take: 200,
      });
      const ids = [...new Set(admins.map((a) => a.userId))];
      for (const id of ids) {
        try {
          await this.create({ ...input, recipientUserId: id, audience: 'ADMIN' });
        } catch (error) {
          this.logger.warn('admin notify skipped: ' + this.errText(error));
        }
      }
    } catch (error) {
      this.logger.warn('notifyAdmins failed: ' + this.errText(error));
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === 'object' && error !== null &&
      'code' in error && (error as { code?: unknown }).code === 'P2002'
    );
  }

  private errText(error: unknown): string {
    if (error instanceof Error) return error.message.slice(0, 200);
    return String(error ?? 'unknown').slice(0, 200);
  }
  // --------------------------------------------------------------------------
  // AUTOMATIC BUSINESS-EVENT NOTIFICATIONS (post-commit only, idempotent).
  // Every helper below is best-effort and NEVER throws: a notification
  // failure must never roll back the deposit/withdrawal/settlement that
  // already committed. Automatic events use dedupeKey so double-clicks,
  // retries, webhooks replays and restarts never duplicate the notice.
  // --------------------------------------------------------------------------

  private fmtAmount(amount: number, currency: string): string {
    const n = Number(amount ?? 0);
    const label = String(currency ?? '').toUpperCase();
    return (Number.isFinite(n) ? n.toLocaleString('en-US') : String(amount)) + (label ? ' ' + label : '');
  }

  async notifyDepositApproved(input: { userId: string; amount: number; currency: string; requestId: string }): Promise<void> {
    try {
      await this.create({
        recipientUserId: input.userId,
        audience: 'USER',
        type: 'DEPOSIT_APPROVED',
        title: 'Deposit approved',
        message: `Your deposit of ${this.fmtAmount(input.amount, input.currency)} was approved and credited to your wallet.`,
        data: { requestId: input.requestId, amount: input.amount, currency: input.currency },
        actionUrl: '/wallet',
        dedupeKey: `deposit-approved:${input.requestId}`,
      });
    } catch (error) { this.logger.warn('notifyDepositApproved skipped: ' + this.errText(error)); }
  }

  async notifyDepositRejected(input: { userId: string; amount: number; currency: string; requestId: string; reason?: string | null }): Promise<void> {
    try {
      await this.create({
        recipientUserId: input.userId,
        audience: 'USER',
        type: 'DEPOSIT_REJECTED',
        title: 'Deposit rejected',
        message: `Your deposit of ${this.fmtAmount(input.amount, input.currency)} was rejected.` + (input.reason ? ` Reason: ${String(input.reason).slice(0, 300)} ` : ''),
        data: { requestId: input.requestId, reason: input.reason ?? null },
        actionUrl: '/wallet',
        dedupeKey: `deposit-rejected:${input.requestId}`,
      });
    } catch (error) { this.logger.warn('notifyDepositRejected skipped: ' + this.errText(error)); }
  }

  async notifyWithdrawalApproved(input: { userId: string; amount: number; currency: string; requestId: string }): Promise<void> {
    try {
      await this.create({
        recipientUserId: input.userId,
        audience: 'USER',
        type: 'WITHDRAWAL_APPROVED',
        title: 'Withdrawal approved',
        message: `Your withdrawal of ${this.fmtAmount(input.amount, input.currency)} was approved and is being processed.`,
        data: { requestId: input.requestId, amount: input.amount, currency: input.currency },
        actionUrl: '/wallet/withdraw',
        dedupeKey: `withdrawal-approved:${input.requestId}`,
      });
    } catch (error) { this.logger.warn('notifyWithdrawalApproved skipped: ' + this.errText(error)); }
  }

  async notifyWithdrawalRejected(input: { userId: string; amount: number; currency: string; requestId: string; reason?: string | null }): Promise<void> {
    try {
      await this.create({
        recipientUserId: input.userId,
        audience: 'USER',
        type: 'WITHDRAWAL_REJECTED',
        title: 'Withdrawal rejected',
        message: `Your withdrawal of ${this.fmtAmount(input.amount, input.currency)} was rejected and the reserved funds were released.` + (input.reason ? ` Reason: ${String(input.reason).slice(0, 300)}` : ''),
        data: { requestId: input.requestId, reason: input.reason ?? null },
        actionUrl: '/wallet',
        dedupeKey: `withdrawal-rejected:${input.requestId}`,
      });
    } catch (error) { this.logger.warn('notifyWithdrawalRejected skipped: ' + this.errText(error)); }
  }

  async notifyWithdrawalCompleted(input: { userId: string; amount: number; currency: string; requestId: string }): Promise<void> {
    try {
      await this.create({
        recipientUserId: input.userId,
        audience: 'USER',
        type: 'WITHDRAWAL_COMPLETED',
        title: 'Withdrawal completed',
        message: `Your withdrawal of ${this.fmtAmount(input.amount, input.currency)} is complete.`,
        data: { requestId: input.requestId, amount: input.amount, currency: input.currency },
        actionUrl: '/wallet/withdraw',
        dedupeKey: `withdrawal-completed:${input.requestId}`,
      });
    } catch (error) { this.logger.warn('notifyWithdrawalCompleted skipped: ' + this.errText(error)); }
  }

  async notifyBetSettled(input: { userId: string; betId: string; won: boolean; payout: number; currency: string }): Promise<void> {
    try {
      await this.create({
        recipientUserId: input.userId,
        audience: 'USER',
        type: input.won ? 'BET_WON' : 'BET_LOST',
        title: input.won ? 'Bet won' : 'Bet lost',
        message: input.won
          ? `Your bet won. Payout ${this.fmtAmount(input.payout, input.currency)} was credited to your wallet.`
          : `Your bet was settled as a loss. Better luck next time.`,
        data: { betId: input.betId, payout: input.payout, currency: input.currency },
        actionUrl: '/my-bets',
        dedupeKey: `bet-settlement:${input.betId}`,
      });
    } catch (error) { this.logger.warn('notifyBetSettled skipped: ' + this.errText(error)); }
  }

  async notifyNewDepositRequest(input: { amount: number; currency: string; requestId: string; username: string }): Promise<void> {
    await this.notifyAdmins({
      type: 'NEW_DEPOSIT_REQUEST',
      title: 'New deposit request',
      message: `New deposit request: ${this.fmtAmount(input.amount, input.currency)} (ref ${String(input.requestId).slice(0, 12)}).`,
      data: { requestId: input.requestId, amount: input.amount, currency: input.currency, userId: input.username },
      actionUrl: '/admin/manual-deposits',
      dedupeKey: `new-deposit-request:${input.requestId}`,
    });
  }

  async notifyNewWithdrawalRequest(input: { amount: number; currency: string; requestId: string; username: string }): Promise<void> {
    await this.notifyAdmins({
      type: 'NEW_WITHDRAWAL_REQUEST',
      title: 'New withdrawal request',
      message: `New withdrawal request: ${this.fmtAmount(input.amount, input.currency)} (ref ${String(input.requestId).slice(0, 12)}).`,
      data: { requestId: input.requestId, amount: input.amount, currency: input.currency, userId: input.username },
      actionUrl: '/admin/manual-withdrawals',
      dedupeKey: `new-withdrawal-request:${input.requestId}`,
    });
  }

  async notifySecurityAlert(input: { title: string; message: string; data?: Record<string, unknown>; dedupeKey?: string }): Promise<void> {
    await this.notifyAdmins({
      type: 'SECURITY_ALERT',
      title: input.title.slice(0, 120),
      message: input.message.slice(0, 2000),
      data: input.data,
      actionUrl: '/admin/audit-logs',
      dedupeKey: input.dedupeKey,
    });
  }

  async notifyNewUserRegistration(input: { userId: string; username: string }): Promise<void> {
    await this.notifyAdmins({
      type: 'NEW_USER_REGISTRATION',
      title: 'New user registered',
      message: `New user registered: ${String(input.username).slice(0, 80)}`,
      data: { userId: input.userId, username: input.username },
      actionUrl: '/admin/users',
      dedupeKey: `new-user-registration:${input.userId}`,
    });
  }
}
