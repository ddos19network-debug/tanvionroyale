/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * NotificationService unit tests.
 *
 * Covers the core guarantees of the TANVION ROYALE notification system:
 *   - idempotency (dedupeKey): a retried event NEVER creates a duplicate row
 *   - push failure NEVER throws / never rolls back (notification row persists)
 *   - actionUrl is allowlist-sanitised (no arbitrary external URLs)
 *   - IDOR safety: users can only read/mark their OWN notifications
 *   - multi-device registration + stale-token deactivation
 *   - read-state lifecycle (unread count, mark one, mark all)
 *
 * Pure in-memory fake of the Prisma surface - no database, no network.
 */
import { NotificationService } from '../src/modules/notifications/notification.service';
import { Prisma } from '../src/generated/prisma';
import type { PrismaService } from '../src/database/prisma.service';
import type { FcmPushSender } from '../src/modules/notifications/fcm.sender';

function uniqueError(): Error {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function makeFake() {
  const notifications = new Map<string, any>();
  const devices = new Map<string, any>();
  const deliveries: any[] = [];
  const auditLogs: any[] = [];
  const users = [
    { id: 'user-1', status: 'ACTIVE' },
    { id: 'user-2', status: 'ACTIVE' },
    { id: 'user-3', status: 'SUSPENDED' },
  ];
  let idSeq = 0;
  const uuid = () => 'n-' + ++idSeq;

  const base: any = {
    notification: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id) return notifications.get(where.id) ?? null;
        const k = where.dedupeKey_recipientUserId;
        return (
          [...notifications.values()].find(
            (n) => n.dedupeKey === k.dedupeKey && n.recipientUserId === k.recipientUserId,
          ) ?? null
        );
      }),
      findFirst: jest.fn(async ({ where }: any) =>
        [...notifications.values()].find(
          (n) =>
            (!where?.id || n.id === where.id) &&
            (!where?.recipientUserId || n.recipientUserId === where.recipientUserId),
        ) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        if (
          data.dedupeKey &&
          [...notifications.values()].some(
            (n) => n.dedupeKey === data.dedupeKey && n.recipientUserId === data.recipientUserId,
          )
        ) {
          throw uniqueError();
        }
        const row = {
          id: uuid(),
          recipientUserId: data.recipientUserId,
          audience: data.audience ?? 'USER',
          type: data.type,
          title: data.title,
          message: data.message,
          data: data.data ?? null,
          actionUrl: data.actionUrl ?? null,
          dedupeKey: data.dedupeKey ?? null,
          isRead: false,
          readAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        notifications.set(row.id, row);
        return row;
      }),
      findMany: jest.fn(async ({ where, take }: any) =>
        [...notifications.values()]
          .filter((n) => !where?.recipientUserId || n.recipientUserId === where.recipientUserId)
          .filter((n) => where?.isRead === undefined || n.isRead === where.isRead)
          .filter((n) => !where?.audience || n.audience === where.audience)
          .slice(0, take ?? 100),
      ),
      count: jest.fn(async ({ where }: any) =>
        [...notifications.values()]
          .filter((n) => !where?.recipientUserId || n.recipientUserId === where.recipientUserId)
          .filter((n) => where?.isRead === undefined || n.isRead === where.isRead)
          .filter((n) => !where?.audience || n.audience === where.audience).length,
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const n of notifications.values()) {
          if (where.id && n.id !== where.id) continue;
          if (where.recipientUserId && n.recipientUserId !== where.recipientUserId) continue;
          if (where.isRead === false && n.isRead !== false) continue;
          Object.assign(n, data);
          count += 1;
        }
        return { count };
      }),
    },
    notificationDevice: {
      findUnique: jest.fn(async ({ where }: any) => {
        const k = where.provider_token;
        return (
          [...devices.values()].find(
            (d) => d.provider === k.provider && d.token === k.token,
          ) ?? null
        );
      }),
      findMany: jest.fn(async ({ where, take }: any) =>
        [...devices.values()]
          .filter((d) => !where?.userId || d.userId === where.userId)
          .filter((d) => where?.isActive === undefined || d.isActive === where.isActive)
          .filter((d) => !where?.provider || d.provider === where.provider)
          .slice(0, take ?? 25),
      ),
      create: jest.fn(async ({ data }: any) => {
        if (
          [...devices.values()].some(
            (d) => d.provider === data.provider && d.token === data.token,
          )
        ) {
          throw uniqueError();
        }
        const row = {
          id: uuid(),
          userId: data.userId,
          provider: data.provider ?? 'fcm',
          token: data.token,
          platform: data.platform ?? null,
          browser: data.browser ?? null,
          isActive: data.isActive ?? true,
          lastSeenAt: new Date(),
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        devices.set(row.id, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = devices.get(where.id);
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const d of devices.values()) {
          if (where.userId && d.userId !== where.userId) continue;
          if (where.provider && d.provider !== where.provider) continue;
          if (where.token && d.token !== where.token) continue;
          if (where.isActive === true && d.isActive !== true) continue;
          Object.assign(d, data);
          count += 1;
        }
        return { count };
      }),
    },
    notificationDelivery: {
      createMany: jest.fn(async ({ data }: any) => {
        const rows = (Array.isArray(data) ? data : [data]).map((d: any) => ({
          id: uuid(),
          notificationId: d.notificationId,
          deviceId: d.deviceId,
          status: 'PENDING',
          attempts: 0,
          lastError: null,
          sentAt: null,
        }));
        for (const row of rows) deliveries.push(row);
        return { count: rows.length };
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const d of deliveries) {
          if (where.notificationId && d.notificationId !== where.notificationId) continue;
          if (where.deviceId && d.deviceId !== where.deviceId) continue;
          if (where.status && d.status !== where.status) continue;
          Object.assign(d, data);
          count += 1;
        }
        return { count };
      }),
      count: jest.fn(async ({ where }: any) =>
        deliveries.filter((d) => !where?.status || d.status === where.status).length,
      ),
    },
    user: {
      findMany: jest.fn(async ({ where }: any) => {
        let result = users;
        if (where?.id?.in) result = result.filter((u) => where.id.in.includes(u.id));
        if (where?.status?.notIn) {
          result = result.filter((u) => !where.status.notIn.includes(u.status));
        }
        return result;
      }),
      findUnique: jest.fn(async ({ where }: any) =>
        users.find((u) => u.id === where.id) ?? null,
      ),
    },
    userRole: {
      findMany: jest.fn(async () => [
        { userId: 'admin-1' },
        { userId: 'admin-2' },
      ]),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        auditLogs.push(data);
        return data;
      }),
    },
  };
  return { base, notifications, devices, deliveries, auditLogs, users, uuid };
}

function makeService(fake: ReturnType<typeof makeFake>, pushImpl?: any) {
  const push = { send: jest.fn(pushImpl ?? (async () => [])) } as unknown as FcmPushSender;
  const service = new NotificationService(
    fake.base as unknown as PrismaService,
    push,
  );
  return { service, push };
}

describe('NotificationService', () => {
  it('create() stores the notification and is IDEMPOTENT per dedupeKey (no duplicate push, no duplicate row)', async () => {
    const fake = makeFake();
    const { service, push } = makeService(fake);
    await service.registerDevice('user-1', { token: 'tok-1', platform: 'web' });

    const first = await service.create({
      recipientUserId: 'user-1',
      type: 'DEPOSIT_APPROVED',
      title: 'Deposit approved',
      message: 'credited',
      actionUrl: '/wallet',
      dedupeKey: 'deposit-approved:req-1',
    });
    const second = await service.create({
      recipientUserId: 'user-1',
      type: 'DEPOSIT_APPROVED',
      title: 'Deposit approved',
      message: 'credited',
      actionUrl: '/wallet',
      dedupeKey: 'deposit-approved:req-1',
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.id).toBe(first.id);
    expect(fake.notifications.size).toBe(1);
    // The duplicate returns EARLY - no second push attempt for the same event.
    expect(push.send).toHaveBeenCalledTimes(1);
  });

  it('createForUsers / createForAllUsers fan out without duplicates and skip suspended users', async () => {
    const fake = makeFake();
    const { service } = makeService(fake);

    const broadcast = await service.createForAllUsers({
      type: 'SYSTEM_ANNOUNCEMENT',
      title: 'Welcome',
      message: 'announcement body',
      dedupeKey: 'broadcast-1',
    });
    expect(broadcast.created).toBe(2); // user-1 + user-2 (SUSPENDED user-3 excluded)
    expect(broadcast.duplicates).toBe(0);

    const repeat = await service.createForUsers(['user-1', 'user-2'], {
      type: 'SYSTEM_ANNOUNCEMENT',
      title: 'Welcome',
      message: 'announcement body',
      dedupeKey: 'broadcast-1',
    });
    expect(repeat.created).toBe(0);
    expect(repeat.duplicates).toBe(2);
    expect(fake.notifications.size).toBe(2);
  });

  it('sanitises actionUrl: in-app allowlist passes, arbitrary/external URLs are dropped', async () => {
    const fake = makeFake();
    const { service } = makeService(fake);

    const ok = await service.create({
      recipientUserId: 'user-1',
      type: 'BET_WON',
      title: 'Bet won',
      message: 'payout',
      actionUrl: '/my-bets',
      dedupeKey: 'a-1',
    });
    const row = fake.notifications.get(ok.id);
    expect(row.actionUrl).toBe('/my-bets');

    for (const bad of ['https://evil.example.com', '//evil.example.com', '/unknown-path/x', 'javascript:alert(1)']) {
      const r = await service.create({
        recipientUserId: 'user-1',
        type: 'BET_LOST',
        title: 'Bet lost',
        message: 'x',
        actionUrl: bad,
        dedupeKey: 'a-' + bad,
      });
      expect(fake.notifications.get(r.id).actionUrl).toBeNull();
    }
  });

  it('a Firebase push failure NEVER rolls back or throws - the notification row persists and deliveries are recorded', async () => {
    const fake = makeFake();
    // FCM completely broken (throws for every target).
    const { service } = makeService(fake, async () => {
      throw new Error('FCM unavailable');
    });
    // Register a device so the push path is actually exercised.
    await service.registerDevice('user-1', { token: 'tok-1', platform: 'web' });

    const created = await service.create({
      recipientUserId: 'user-1',
      type: 'WITHDRAWAL_COMPLETED',
      title: 'Withdrawal completed',
      message: 'done',
      dedupeKey: 'withdrawal-completed:wd-1',
    });

    expect(created.duplicate).toBe(false);
    expect(fake.notifications.size).toBe(1); // row survived the FCM failure
    expect(fake.deliveries.length).toBe(1);
    // Delivery is left PENDING (retryable) or FAILED - never silently SENT,
    // and the FCM error is swallowed so the business operation stays committed.
    expect(['PENDING', 'FAILED']).toContain(fake.deliveries[0].status);
  });

  it('deactivates stale FCM tokens reported by the sender and never sends to them again', async () => {
    const fake = makeFake();
    const { service, push } = makeService(fake, async (req: any) =>
      req.targets.map((t: any) => ({ deviceId: t.deviceId, outcome: 'INVALID_TOKEN' })),
    );
    await service.registerDevice('user-1', { token: 'tok-stale', platform: 'web' });

    await service.create({
      recipientUserId: 'user-1',
      type: 'DEPOSIT_REJECTED',
      title: 'Deposit rejected',
      message: 'x',
      dedupeKey: 'deposit-rejected:d-1',
    });

    const device = [...fake.devices.values()][0];
    expect(device.isActive).toBe(false);
    expect(push.send).toHaveBeenCalledTimes(1);

    // Next notification: the inactive device is not sent to.
    (push.send as jest.Mock).mockClear();
    await service.create({
      recipientUserId: 'user-1',
      type: 'DEPOSIT_REJECTED',
      title: 'Deposit rejected',
      message: 'y',
      dedupeKey: 'deposit-rejected:d-2',
    });
    expect(push.send).not.toHaveBeenCalled(); // no active devices left
  });

  it('supports multiple devices per user (desktop + mobile), one delivery each', async () => {
    const fake = makeFake();
    const { service, push } = makeService(fake);
    await service.registerDevice('user-1', { token: 'tok-desktop', platform: 'web' });
    await service.registerDevice('user-1', { token: 'tok-mobile', platform: 'web' });
    const again = await service.registerDevice('user-1', { token: 'tok-desktop', platform: 'web' });

    await service.create({
      recipientUserId: 'user-1',
      type: 'SYSTEM_ANNOUNCEMENT',
      title: 'hi',
      message: 'hi',
      dedupeKey: 'multi-1',
    });

    expect(again.id).toBeDefined();
    expect(fake.devices.size).toBe(2);
    expect(fake.deliveries.length).toBe(2);
    expect(push.send).toHaveBeenCalledTimes(1);
    expect((push.send as jest.Mock).mock.calls[0][0].targets).toHaveLength(2);
  });

  it('markRead is IDOR-safe: another user cannot mark a foreign notification', async () => {
    const fake = makeFake();
    const { service } = makeService(fake);
    const created = await service.create({
      recipientUserId: 'user-1',
      type: 'BET_WON',
      title: 'Bet won',
      message: 'x',
      dedupeKey: 'idor-1',
    });

    await expect(service.markRead('user-2', created.id)).rejects.toThrow('NOT_FOUND');
    expect(fake.notifications.get(created.id).isRead).toBe(false);

    await service.markRead('user-1', created.id);
    expect(fake.notifications.get(created.id).isRead).toBe(true);
    expect(fake.notifications.get(created.id).readAt).toBeTruthy();
  });

  it('unreadCount / markAllRead / listForUser reflect read state per user', async () => {
    const fake = makeFake();
    const { service } = makeService(fake);
    await service.create({ recipientUserId: 'user-1', type: 'BET_WON', title: 'a', message: 'a', dedupeKey: 'u-1' });
    await service.create({ recipientUserId: 'user-1', type: 'BET_LOST', title: 'b', message: 'b', dedupeKey: 'u-2' });
    await service.create({ recipientUserId: 'user-2', type: 'BET_WON', title: 'c', message: 'c', dedupeKey: 'u-3' });

    expect((await service.unreadCount('user-1')).unread).toBe(2);
    expect((await service.unreadCount('user-2')).unread).toBe(1);

    const list = await service.listForUser('user-1', {});
    expect(list.total).toBe(2);
    expect(list.unread).toBe(2);

    const marked = await service.markAllRead('user-1');
    expect(marked.marked).toBe(2);
    expect((await service.unreadCount('user-1')).unread).toBe(0);
    // user-2 untouched.
    expect((await service.unreadCount('user-2')).unread).toBe(1);

    const unreadOnly = await service.listForUser('user-1', { filter: 'unread' });
    expect(unreadOnly.items).toHaveLength(0);
  });
});
