/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * USER REFERRAL PROGRAM tests.
 *
 * These cover every money-safety and anti-abuse guarantee the system claims,
 * against a pure in-memory fake of the Prisma surface (no database, no network,
 * no real money) exactly like the other domain suites in this repo.
 *
 * Pinned here: unique/stable codes, registration attribution, invalid codes,
 * self-referral, privacy + IDOR, qualification rules, anti-duplicate payout,
 * the real ledger movement, admin configuration, admin reporting and auditable
 * history.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  ReferralService,
  maskEmail,
  DEFAULT_REFERRAL_SETTINGS,
} from '../src/modules/referral/referral.service';
import {
  generateReferralCode,
  isValidReferralCodeShape,
  normalizeReferralCode,
  referralRewardEventKey,
} from '../src/modules/referral/referral-code';
import { Prisma } from '../src/generated/prisma';
import type { PrismaService } from '../src/database/prisma.service';
import type { WalletService } from '../src/modules/wallet/wallet.service';
import type { NotificationService } from '../src/modules/notifications/notification.service';

function uniqueError(): Error {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

interface SeedOptions {
  enabled?: boolean;
  settings?: Partial<typeof DEFAULT_REFERRAL_SETTINGS>;
  referrerStatus?: string;
  referrerAccountType?: string;
  referredVerified?: boolean;
  referredStatus?: string;
}

/**
 * Applies a Prisma update payload, honouring the atomic number operators
 * (`{ increment }` / `{ decrement }`) the way the real client does.
 */
function applyData(row: any, data: Record<string, any>): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      if (typeof value.increment === 'number') row[key] = (row[key] ?? 0) + value.increment;
      else if (typeof value.decrement === 'number') row[key] = (row[key] ?? 0) - value.decrement;
      else row[key] = value;
    } else {
      row[key] = value;
    }
  }
  row.updatedAt = new Date();
}

/** Prisma-style projection of a fake User row. */
function pickUser(user: any, select?: Record<string, unknown>): any {
  if (!user) return null;
  if (!select) return { ...user };
  const out: any = {};
  for (const key of Object.keys(select)) out[key] = user[key];
  return out;
}

/**
 * In-memory fake of the Prisma surface the referral service uses.
 *
 * It enforces the SAME invariants the real database does, because those
 * invariants are the whole point of the design:
 *   Referral.referredUserId  UNIQUE  -> a user has one referrer, forever
 *   ReferralEvent.eventKey    UNIQUE  -> a signal is counted once
 *   ReferralReward.eventKey  UNIQUE  -> a reward is paid once
 *   WalletTransaction         UNIQUE (userId, idempotencyKey) -> a credit posts once
 */
function makeHarness(seed: SeedOptions = {}) {
  const users = new Map<string, any>();
  const referrals = new Map<string, any>();
  const rewards = new Map<string, any>();
  const events = new Map<string, any>();
  const auditLogs: any[] = [];
  const walletTx = new Map<string, any>();
  const runningBalances = new Map<string, number>();
  const runningBalance = (userId: string): number => runningBalances.get(userId) ?? 0;
  const walletCalls: any[] = [];
  const notifications: any[] = [];

  let settings: any = { ...DEFAULT_REFERRAL_SETTINGS, ...(seed.settings ?? {}) };
  if (seed.enabled !== undefined) settings.isEnabled = seed.enabled;
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}-${++seq}`;

  const addUser = (id: string, overrides: Record<string, unknown> = {}): any => {
    const user = {
      id,
      username: `user-${id}`,
      email: `${id}@example.com`,
      accountType: 'CUSTOMER',
      status: 'ACTIVE',
      emailVerified: false,
      phoneVerified: false,
      referralCode: null,
      ...overrides,
    };
    users.set(id, user);
    return user;
  };

  addUser('referrer', {
    username: 'tanveer123',
    referralCode: 'TANVK2P4QZ7M3X8D',
    status: seed.referrerStatus ?? 'ACTIVE',
    accountType: seed.referrerAccountType ?? 'CUSTOMER',
  });
  addUser('referred', {
    username: 'player786',
    email: 'player786@example.com',
    emailVerified: seed.referredVerified ?? false,
    status: seed.referredStatus ?? 'ACTIVE',
  });
  addUser('other', { username: 'stranger999' });

  const wallet: any = {
    creditReferralBonus: jest.fn(
      async (
        _db: unknown,
        userId: string,
        amount: number,
        currency: string,
        key: string,
        reason: string,
      ) => {
        const mapKey = `${userId}::${key}`;
        const existing = walletTx.get(mapKey);
        if (existing) {
          walletCalls.push({ userId, amount, key, duplicate: true });
          return {
            walletId: existing.walletId,
            transactionId: existing.id,
            availableBalance: existing.balanceAfter,
            duplicate: true,
          };
        }
        const id = nextId('wtx');
        const balanceAfter = runningBalance(userId) + amount;
        runningBalances.set(userId, balanceAfter);
        walletTx.set(mapKey, { id, userId, amount, currency, key, reason, balanceAfter });
        walletCalls.push({ userId, amount, key, reason, duplicate: false });
        return {
          walletId: `wallet-${userId}`,
          transactionId: id,
          availableBalance: balanceAfter,
          duplicate: false,
        };
      },
    ),
    adjustBalanceInTx: jest.fn(
      async (
        _db: unknown,
        userId: string,
        amount: number,
        _currency: string,
        key: string,
        reason: string,
      ) => {
        const mapKey = `${userId}::${key}`;
        const existing = walletTx.get(mapKey);
        if (existing) {
          return {
            transactionId: existing.id,
            availableBalance: existing.balanceAfter,
            duplicate: true,
          };
        }
        const id = nextId('wtx');
        const balanceAfter = runningBalance(userId) + amount;
        runningBalances.set(userId, balanceAfter);
        walletTx.set(mapKey, { id, userId, amount, key, reason, balanceAfter });
        walletCalls.push({ userId, amount, key, reason, duplicate: false, adjust: true });
        return { transactionId: id, availableBalance: balanceAfter, duplicate: false };
      },
    ),
  };

  const prisma: any = {
    user: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id) return users.get(where.id) ?? null;
        if (where.referralCode) {
          return (
            [...users.values()].find((u) => u.referralCode === where.referralCode) ?? null
          );
        }
        return null;
      }),
      findMany: jest.fn(async ({ where }: any) => {
        let rows = [...users.values()];
        if (where?.id?.in) rows = rows.filter((u) => where.id.in.includes(u.id));
        if (where?.OR) {
          const eq = (v: any): string => String(v?.equals ?? '');
          rows = rows.filter((u) =>
            where.OR.some((clause: any) => {
              if (clause.id) return eq(clause.id).toLowerCase() === u.id.toLowerCase();
              if (clause.username) return u.username.includes(eq(clause.username));
              if (clause.referralCode) return u.referralCode === eq(clause.referralCode);
              return false;
            }),
          );
        }
        return rows;
      }),
      // The GUARDED write: a code is only ever set while it is still NULL, so
      // two concurrent callers can never overwrite each other.
      updateMany: jest.fn(async ({ where, data }: any) => {
        const user = users.get(where.id);
        if (!user) return { count: 0 };
        if (where.referralCode === null && user.referralCode !== null) return { count: 0 };
        Object.assign(user, data);
        return { count: 1 };
      }),
    },
    referral: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id) return referrals.get(where.id) ?? null;
        if (where.referredUserId) {
          return (
            [...referrals.values()].find((r) => r.referredUserId === where.referredUserId) ??
            null
          );
        }
        return null;
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        const rows = [...referrals.values()].filter(
          (r) =>
            (!where?.referredUserId || r.referredUserId === where.referredUserId) &&
            (!where?.status || r.status === where.status),
        );
        return rows[0] ?? null;
      }),
      findMany: jest.fn(async ({ where, select }: any) => {
        let rows = [...referrals.values()];
        if (where?.referrerUserId) rows = rows.filter((r) => r.referrerUserId === where.referrerUserId);
        if (where?.referredUserId) rows = rows.filter((r) => r.referredUserId === where.referredUserId);
        if (where?.status) rows = rows.filter((r) => r.status === where.status);
        if (where?.skip !== undefined) rows = rows.slice(where.skip, where.skip + (where.take ?? 50));
        // Hydrate the relations the service selects, exactly like Prisma does.
        return rows.map((r) => {
          const out: any = { ...r };
          if (select?.referred) out.referred = pickUser(users.get(r.referredUserId), select.referred.select);
          if (select?.referrer) out.referrer = pickUser(users.get(r.referrerUserId), select.referrer.select);
          if (select?.rewards) {
            out.rewards = [...rewards.values()].filter(
              (x) =>
                x.referralId === r.id &&
                (!select.rewards.where?.recipient || x.recipient === select.rewards.where.recipient) &&
                (!select.rewards.where?.status || x.status === select.rewards.where.status),
            );
          }
          return out;
        });
      }),
      count: jest.fn(async () => referrals.size),
      groupBy: jest.fn(async ({ by, where }: any) => {
        const rows = [...referrals.values()].filter((r) => {
          if (where?.status) return r.status === where.status;
          if (where?.referrerUserId) {
            return where.referrerUserId.in
              ? where.referrerUserId.in.includes(r.referrerUserId)
              : r.referrerUserId === where.referrerUserId;
          }
          return true;
        });
        if (by[0] === 'status') {
          const map = new Map<string, number>();
          rows.forEach((r) => map.set(r.status, (map.get(r.status) ?? 0) + 1));
          return [...map.entries()].map(([status, n]) => ({ status, _count: { _all: n } }));
        }
        const map = new Map<string, number>();
        rows.forEach((r) => map.set(r.referrerUserId, (map.get(r.referrerUserId) ?? 0) + 1));
        return [...map.entries()].map(([referrerUserId, n]) => ({
          referrerUserId,
          _count: { _all: n },
        }));
      }),
      create: jest.fn(async ({ data }: any) => {
        if ([...referrals.values()].some((r) => r.referredUserId === data.referredUserId)) {
          throw uniqueError();
        }
        const row = {
          id: nextId('ref'),
          status: 'PENDING',
          statusReason: null,
          qualifiedAt: null,
          qualifiedDepositAmount: 0,
          qualifiedWagerAmount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        referrals.set(row.id, row);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const row = referrals.get(where.id);
        if (!row) return { count: 0 };
        if (where.status && row.status !== where.status) return { count: 0 };
        Object.assign(row, data, { updatedAt: new Date() });
        return { count: 1 };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = referrals.get(where.id);
        applyData(row, data);
        return row;
      }),
    },
    referralEvent: {
      create: jest.fn(async ({ data }: any) => {
        if ([...events.values()].some((e) => e.eventKey === data.eventKey)) throw uniqueError();
        const row = { id: nextId('evt'), ...data };
        events.set(row.eventKey, row);
        return row;
      }),
      groupBy: jest.fn(async ({ where }: any) => {
        const rows = [...events.values()].filter((e) => e.referralId === where.referralId);
        const map = new Map<string, number>();
        rows.forEach((e) => map.set(e.kind, (map.get(e.kind) ?? 0) + e.amount));
        return [...map.entries()].map(([kind, amount]) => ({ kind, _sum: { amount } }));
      }),
    },
    referralReward: {
      create: jest.fn(async ({ data }: any) => {
        if ([...rewards.values()].some((r) => r.eventKey === data.eventKey)) throw uniqueError();
        const row = {
          id: nextId('rw'),
          amount: 0,
          status: 'PENDING',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        rewards.set(row.id, row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) => rewards.get(where.id) ?? null),
      findMany: jest.fn(async ({ where, select }: any) => {
        let rows = [...rewards.values()];
        if (where?.userId) rows = rows.filter((r) => r.userId === where.userId);
        if (where?.referralId) rows = rows.filter((r) => r.referralId === where.referralId);
        if (where?.recipient) rows = rows.filter((r) => r.recipient === where.recipient);
        if (where?.status?.in) rows = rows.filter((r) => where.status.in.includes(r.status));
        else if (where?.status) rows = rows.filter((r) => r.status === where.status);
        return rows.map((r) => {
          const out: any = { ...r };
          if (select?.referral) {
            const parent = referrals.get(r.referralId);
            out.referral = parent
              ? {
                  referralCode: parent.referralCode,
                  referrer: pickUser(users.get(parent.referrerUserId), select.referral.select?.referrer?.select),
                  referred: pickUser(users.get(parent.referredUserId), select.referral.select?.referred?.select),
                }
              : null;
          }
          return out;
        });
      }),
      count: jest.fn(async () => rewards.size),
      update: jest.fn(async ({ where, data }: any) => {
        const row = rewards.get(where.id);
        applyData(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const row of rewards.values()) {
          if (where.referralId && row.referralId !== where.referralId) continue;
          if (where.userId && row.userId !== where.userId) continue;
          if (where.status && !where.status.in.includes(row.status)) continue;
          Object.assign(row, data, { updatedAt: new Date() });
          count += 1;
        }
        return { count };
      }),
      aggregate: jest.fn(async ({ where }: any) => {
        const rows = [...rewards.values()].filter(
          (r) =>
            (!where?.userId || r.userId === where.userId) &&
            (!where?.status || r.status === where.status),
        );
        return { _sum: { amount: rows.reduce((s, r) => s + r.amount, 0) } };
      }),
      groupBy: jest.fn(async ({ by, where, _sum }: any) => {
        let rows = [...rewards.values()];
        if (where?.userId) {
          rows = rows.filter((r) =>
            where.userId.in ? where.userId.in.includes(r.userId) : r.userId === where.userId,
          );
        }
        if (where?.recipient) rows = rows.filter((r) => r.recipient === where.recipient);
        if (where?.status) rows = rows.filter((r) => r.status === where.status);
        if (_sum) {
          const key = by[0] as string;
          const map = new Map<string, number>();
          rows.forEach((r) => map.set(r[key], (map.get(r[key]) ?? 0) + r.amount));
          return [...map.entries()].map(([k, amount]) => ({ [key]: k, _sum: { amount } }));
        }
        const map = new Map<string, number>();
        rows.forEach((r) => map.set(r.userId, (map.get(r.userId) ?? 0) + 1));
        return [...map.entries()].map(([userId, n]) => ({ userId, _count: { _all: n } }));
      }),
    },
    referralProgramSettings: {
      findUnique: jest.fn(async () => ({ ...settings })),
      upsert: jest.fn(async ({ update }: any) => {
        settings = { ...settings, ...update };
        return { ...settings };
      }),
    },
    auditLog: { create: jest.fn(async ({ data }: any) => void auditLogs.push(data)) },
    // ONE transaction: the status flip, the reward rows and the wallet credits
    // all commit together. The fake really ROLLS BACK on error, so a test can
    // assert that a failed payout leaves no partial state behind.
    $transaction: jest.fn(async (fn: any) => {
      const snapshot = {
        referrals: new Map([...referrals].map(([k, v]) => [k, { ...v }])),
        rewards: new Map([...rewards].map(([k, v]) => [k, { ...v }])),
        events: new Map([...events].map(([k, v]) => [k, { ...v }])),
        walletTx: new Map([...walletTx]),
        runningBalances: new Map([...runningBalances]),
      };
      try {
        return await fn(prisma);
      } catch (error) {
        referrals.clear();
        for (const [k, v] of snapshot.referrals) referrals.set(k, v);
        rewards.clear();
        for (const [k, v] of snapshot.rewards) rewards.set(k, v);
        events.clear();
        for (const [k, v] of snapshot.events) events.set(k, v);
        walletTx.clear();
        for (const [k, v] of snapshot.walletTx) walletTx.set(k, v);
        runningBalances.clear();
        for (const [k, v] of snapshot.runningBalances) runningBalances.set(k, v);
        throw error;
      }
    }),
  };

  const notificationService: any = {
    create: jest.fn(async (input: any) => {
      notifications.push(input);
      return { id: nextId('ntf'), duplicate: false };
    }),
  };

  const service = new ReferralService(
    prisma as unknown as PrismaService,
    wallet as unknown as WalletService,
    notificationService as unknown as NotificationService,
  );

  return {
    service,
    prisma,
    wallet,
    users,
    referrals,
    rewards,
    events,
    auditLogs,
    walletCalls,
    notifications,
    setSettings: (patch: Record<string, unknown>) => {
      settings = { ...settings, ...patch };
    },
  };
}

const CODE = 'TANVK2P4QZ7M3X8D';
const SITE = 'https://tanvionroyale.vercel.app';

// ---------------------------------------------------------------------------
// 1-3. Referral codes
// ---------------------------------------------------------------------------

describe('referral codes', () => {
  it('1. a user receives a unique, correctly shaped referral code', async () => {
    const h = makeHarness({ enabled: true });
    const code = await h.service.ensureReferralCode('referred');

    expect(isValidReferralCodeShape(code)).toBe(true);
    expect(code.startsWith('TANV')).toBe(true);
    expect(code.length).toBe(16);
    expect(h.users.get('referred')?.referralCode).toBe(code);
  });

  it('2. generated codes are unique across many draws (no duplicates)', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 5000; i += 1) codes.add(generateReferralCode());
    expect(codes.size).toBe(5000);
  });

  it('2b. the migration backfill uses the SAME alphabet as the service', () => {
    // Regression guard for the P3009 incident. The first version of migration
    // 20260926000000 backfilled `TANV` + 12 HEX characters, but the service
    // alphabet deliberately excludes `0` and `1`. Measured against the old SQL,
    // ~80% of backfilled codes failed isValidReferralCodeShape, so those users
    // could not share a working link at all. The migration must draw from the
    // exact alphabet the runtime validates against.
    const sql = fs.readFileSync(
      path.join(
        __dirname,
        '..',
        '..',
        '..',
        'database',
        'prisma',
        'migrations',
        '20260926000000_add_user_referral_program',
        'migration.sql',
      ),
      'utf8',
    );

    // The backfill must reference the same literal alphabet the service uses.
    const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
    expect(sql).toContain(`'${ALPHABET}'`);

    // And it must NOT reintroduce the hex-only generator that caused this.
    expect(sql).not.toMatch(/SUBSTRING\s*\(\s*MD5\(/i);

    // Every character the backfill can emit must pass the runtime validator.
    const codes = new Set<string>();
    for (let i = 0; i < 20000; i += 1) {
      let suffix = '';
      for (let p = 0; p < 12; p += 1) {
        // Mirror the SQL: byte % 30 indexes the 30-symbol alphabet.
        suffix += ALPHABET[Math.floor(Math.random() * 256) % ALPHABET.length];
      }
      codes.add(`TANV${suffix}`);
    }
    for (const code of codes) {
      expect(isValidReferralCodeShape(code)).toBe(true);
    }
  });

  it('3. an existing code is NEVER regenerated (stable, never rotates)', async () => {
    const h = makeHarness({ enabled: true });
    const first = await h.service.ensureReferralCode('referrer');
    const second = await h.service.ensureReferralCode('referrer');
    expect(second).toBe(first);
    expect(first).toBe(CODE);
  });

  it('accepts a lowercase / padded / pasted-link code, rejects junk', () => {
    expect(normalizeReferralCode(`  ${CODE.toLowerCase()}  `)).toBe(CODE);
    expect(normalizeReferralCode(`https://site.test/register?ref=${CODE}`)).toBe(CODE);
    expect(normalizeReferralCode('nonsense')).toBeNull();
    expect(normalizeReferralCode('')).toBeNull();
    expect(normalizeReferralCode(null)).toBeNull();
  });

  it('the referral link uses the CONFIGURED site URL, never a hard-coded host', async () => {
    const h = makeHarness({ enabled: true });
    const { summary } = await h.service.getMySummary('referrer', 'https://staging.test/');
    // The link is built from the configured origin and the configured signup
    // path. `/signup` is the canonical path; `/register` serves the SAME page,
    // so links already shared in that form still reach signup.
    expect(summary.referralLink).toBe(`https://staging.test/signup?ref=${CODE}`);
    expect(summary.referralLink).not.toContain('vercel.app');
  });

  it('the default signup path is a real signup route, never a dead end', () => {
    // Guards the regression that made referral links "not reach signup": the
    // generated path must be one the web app actually serves.
    expect(DEFAULT_REFERRAL_SETTINGS.signupPath).toBe('/signup');
  });
});

// ---------------------------------------------------------------------------
// 4-6. Registration attribution
// ---------------------------------------------------------------------------

describe('registration attribution', () => {
  const payout = {
    qualificationRule: 'REGISTRATION' as const,
    referrerBonusType: 'FIXED_AMOUNT' as const,
    referrerBonusAmount: 25000,
    referredBonusType: 'FIXED_AMOUNT' as const,
    referredBonusAmount: 10000,
  };

  it('4. a valid code creates the immutable referral relationship', async () => {
    const h = makeHarness({ enabled: true, settings: payout });
    const result = await h.service.attributeRegistration('referred', CODE);

    expect(result).toEqual({
      referralId: expect.any(String),
      referrerUserId: 'referrer',
      referralCode: CODE,
    });
    const row = [...h.referrals.values()][0];
    expect(row.referrerUserId).toBe('referrer');
    expect(row.referredUserId).toBe('referred');
    expect(row.referralCode).toBe(CODE);
    expect(row.createdAt).toBeInstanceOf(Date);
    // The registration signal is recorded exactly once.
    expect([...h.events.values()].filter((e) => e.kind === 'REGISTRATION')).toHaveLength(1);
  });

  it('5. an invalid referral code is rejected safely (registration still succeeds)', async () => {
    const h = makeHarness({ enabled: true, settings: payout });
    for (const bad of ['', '   ', 'NOPE', null, undefined, 'TANV-']) {
      const result = await h.service.attributeRegistration('referred', bad as any);
      expect(result).toBeNull();
    }
    expect(h.referrals.size).toBe(0);
    expect(h.wallet.creditReferralBonus).not.toHaveBeenCalled();
  });

  it('5b. a disabled program attributes nobody and pays nobody', async () => {
    const h = makeHarness({ enabled: false, settings: payout });
    expect(await h.service.attributeRegistration('referred', CODE)).toBeNull();
    expect(h.referrals.size).toBe(0);
  });

  it('5c. a banned / suspended / closed or staff referrer is refused', async () => {
    for (const opts of [
      { referrerStatus: 'BANNED' },
      { referrerStatus: 'SUSPENDED' },
      { referrerStatus: 'CLOSED' },
      { referrerAccountType: 'STAFF' },
    ]) {
      const h = makeHarness({ enabled: true, settings: payout, ...opts });
      expect(await h.service.attributeRegistration('referred', CODE)).toBeNull();
      expect(h.referrals.size).toBe(0);
    }
  });

  it('6. SELF-REFERRAL is rejected (user A can never refer user A)', async () => {
    const h = makeHarness({ enabled: true, settings: payout });
    // "referrer" submits its OWN code while registering as "referrer".
    expect(await h.service.attributeRegistration('referrer', CODE)).toBeNull();
    expect(h.referrals.size).toBe(0);
    expect(h.wallet.creditReferralBonus).not.toHaveBeenCalled();
  });

  it('6b. the relationship is immutable: a second attribution is ignored', async () => {
    const h = makeHarness({ enabled: true, settings: payout });
    const first = await h.service.attributeRegistration('referred', CODE);
    h.users.get('other')!.referralCode = 'TANVOTHERCODE123';
    const second = await h.service.attributeRegistration('referred', 'TANVOTHERCODE123');

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    // Exactly one row, still pointing at the FIRST referrer.
    expect(h.referrals.size).toBe(1);
    expect([...h.referrals.values()][0].referrerUserId).toBe('referrer');
  });

  it('6c. a failure inside attribution never propagates to the caller', async () => {
    const h = makeHarness({ enabled: true, settings: payout });
    h.prisma.referral.create = jest.fn(async () => {
      throw new Error('database exploded');
    });
    await expect(h.service.attributeRegistration('referred', CODE)).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 7-8. Privacy + IDOR
// ---------------------------------------------------------------------------

describe('privacy and IDOR', () => {
  it('7. a referrer sees ONLY the users they referred', async () => {
    const h = makeHarness({ enabled: true, settings: { qualificationRule: 'REGISTRATION' } });
    await h.service.attributeRegistration('referred', CODE);

    const mine = await h.service.getMyReferredUsers('referrer');
    expect(mine.items).toHaveLength(1);
    expect(mine.items[0].username).toBe('player786');

    // A different user sees nothing of that referral.
    const theirs = await h.service.getMyReferredUsers('other');
    expect(theirs.items).toHaveLength(0);
  });

  it('7b. only a safe display identifier is exposed (masked email, no secrets)', async () => {
    const h = makeHarness({ enabled: true, settings: { qualificationRule: 'REGISTRATION' } });
    await h.service.attributeRegistration('referred', CODE);
    const mine = await h.service.getMyReferredUsers('referrer');
    const item = mine.items[0] as any;

    expect(item.maskedEmail).toBe('p*******6@example.com');
    // Nothing sensitive may appear on the object at all.
    for (const forbidden of ['email', 'phone', 'passwordHash', 'referrerUserId', 'ip']) {
      expect(item).not.toHaveProperty(forbidden);
    }
    expect(JSON.stringify(item)).not.toContain('example.com".*@');
    expect(JSON.stringify(item)).toContain('p*******6@example.com');
  });

  it('7c. maskEmail never reveals a short local part', () => {
    expect(maskEmail('player786@example.com')).toBe('p*******6@example.com');
    expect(maskEmail('ab@example.com')).toBe('**@example.com');
    expect(maskEmail('a@example.com')).toBe('*@example.com');
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail('not-an-email')).toBeNull();
  });

  it('8. reward history is scoped to the caller (never another user)', async () => {
    const h = makeHarness({
      enabled: true,
      settings: {
        qualificationRule: 'REGISTRATION',
        referrerBonusAmount: 25000,
        referredBonusAmount: 10000,
      },
    });
    await h.service.attributeRegistration('referred', CODE);

    const forReferrer = await h.service.getMyRewards('referrer');
    expect(forReferrer.items).toHaveLength(1);
    expect(forReferrer.items[0].recipient).toBe('REFERRER');
    // The counterparty label is the referred user's public username.
    expect(forReferrer.items[0].username).toBe('player786');

    const forReferred = await h.service.getMyRewards('referred');
    expect(forReferred.items).toHaveLength(1);
    expect(forReferred.items[0].recipient).toBe('REFERRED');
    // ...and from the other side it is the referrer's public username.
    expect(forReferred.items[0].username).toBe('tanveer123');

    const forStranger = await h.service.getMyRewards('other');
    expect(forStranger.items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 9-11. Qualification rules
// ---------------------------------------------------------------------------

describe('qualification', () => {
  it('9. REGISTRATION qualifies immediately and pays both configured rewards', async () => {
    const h = makeHarness({
      enabled: true,
      settings: {
        qualificationRule: 'REGISTRATION',
        referrerBonusAmount: 25000,
        referredBonusAmount: 10000,
      },
    });
    await h.service.attributeRegistration('referred', CODE);

    const referral = [...h.referrals.values()][0];
    expect(referral.status).toBe('QUALIFIED');
    expect(h.walletCalls).toHaveLength(2);

    const paid = [...h.rewards.values()];
    expect(paid).toHaveLength(2);
    expect(paid.every((r) => r.status === 'PAID')).toBe(true);
    // 250.00 BDT to the referrer, 100.00 BDT to the new user (minor units).
    expect(paid.find((r) => r.recipient === 'REFERRER')?.amount).toBe(25000);
    expect(paid.find((r) => r.recipient === 'REFERRED')?.amount).toBe(10000);
  });

  it('10. MIN_DEPOSIT does NOT qualify below the threshold, DOES at/above it', async () => {
    const h = makeHarness({
      enabled: true,
      settings: {
        qualificationRule: 'MIN_DEPOSIT',
        minDepositAmount: 50000,
        referrerBonusAmount: 25000,
      },
    });
    await h.service.attributeRegistration('referred', CODE);
    expect([...h.referrals.values()][0].status).toBe('PENDING');

    // 300.00 BDT — still short.
    await h.service.recordQualifyingEvent('referred', 'DEPOSIT', 'wtx-1', 30000);
    expect([...h.referrals.values()][0].status).toBe('PENDING');
    expect(h.walletCalls).toHaveLength(0);

    // +250.00 BDT crosses 500.00 BDT.
    const out = await h.service.recordQualifyingEvent('referred', 'DEPOSIT', 'wtx-2', 25000);
    expect(out.recorded).toBe(true);
    expect(out.outcome).toBe('QUALIFIED');
    expect([...h.referrals.values()][0].status).toBe('QUALIFIED');
    expect(h.walletCalls[0].amount).toBe(25000);
  });

  it('11. MIN_WAGER counts settled wagers, not deposits', async () => {
    const h = makeHarness({
      enabled: true,
      settings: {
        qualificationRule: 'MIN_WAGER',
        minWagerAmount: 100000,
        referrerBonusAmount: 25000,
      },
    });
    await h.service.attributeRegistration('referred', CODE);

    // Deposits must NOT satisfy a wager rule.
    await h.service.recordQualifyingEvent('referred', 'DEPOSIT', 'wtx-d', 500000);
    expect([...h.referrals.values()][0].status).toBe('PENDING');

    await h.service.recordQualifyingEvent('referred', 'WAGER', 'bet-1', 60000);
    expect([...h.referrals.values()][0].status).toBe('PENDING');

    await h.service.recordQualifyingEvent('referred', 'WAGER', 'bet-2', 40000);
    expect([...h.referrals.values()][0].status).toBe('QUALIFIED');
  });

  it('11b. DEPOSIT_AND_WAGER requires BOTH legs', async () => {
    const h = makeHarness({
      enabled: true,
      settings: {
        qualificationRule: 'DEPOSIT_AND_WAGER',
        minDepositAmount: 50000,
        minWagerAmount: 100000,
        referrerBonusAmount: 25000,
      },
    });
    await h.service.attributeRegistration('referred', CODE);
    await h.service.recordQualifyingEvent('referred', 'DEPOSIT', 'd1', 100000);
    expect([...h.referrals.values()][0].status).toBe('PENDING');
    await h.service.recordQualifyingEvent('referred', 'WAGER', 'w1', 100000);
    expect([...h.referrals.values()][0].status).toBe('QUALIFIED');
  });

  it('11c. VERIFIED_ACCOUNT requires an actually verified account', async () => {
    const h = makeHarness({
      enabled: true,
      settings: { qualificationRule: 'VERIFIED_ACCOUNT', referrerBonusAmount: 25000 },
    });
    await h.service.attributeRegistration('referred', CODE);
    expect([...h.referrals.values()][0].status).toBe('PENDING');
    // The verification flags are the AUTHORITATIVE columns, not a request.
    h.users.get('referred')!.emailVerified = true;
    expect(await h.service.evaluate([...h.referrals.keys()][0])).toBe('QUALIFIED');
  });

  it('11d. a disabled program never qualifies, whatever the evidence', async () => {
    const h = makeHarness({
      enabled: true,
      settings: { qualificationRule: 'MIN_DEPOSIT', minDepositAmount: 1 },
    });
    await h.service.attributeRegistration('referred', CODE);
    await h.service.recordQualifyingEvent('referred', 'DEPOSIT', 'd', 100000);
    h.setSettings({ isEnabled: false });
    expect(await h.service.evaluate([...h.referrals.keys()][0])).toBe('PROGRAM_DISABLED');
  });
});

// ---------------------------------------------------------------------------
// 12-15. Anti-duplicate bonus, ledger integration, transactional safety
// ---------------------------------------------------------------------------

describe('anti-duplicate payout and wallet/ledger integration', () => {
  const base = {
    qualificationRule: 'MIN_DEPOSIT' as const,
    minDepositAmount: 50000,
    referrerBonusAmount: 25000,
    referredBonusAmount: 10000,
  };

  it('12. a repeated qualification NEVER pays twice', async () => {
    const h = makeHarness({ enabled: true, settings: base });
    await h.service.attributeRegistration('referred', CODE);
    await h.service.recordQualifyingEvent('referred', 'DEPOSIT', 'wtx-1', 60000);
    expect(h.walletCalls).toHaveLength(2);

    // Re-running the evaluator repeatedly must be a no-op.
    const id = [...h.referrals.keys()][0];
    await h.service.evaluate(id);
    await h.service.evaluate(id);
    await h.service.qualify(id);

    expect(h.walletCalls).toHaveLength(2);
    expect(h.rewards.size).toBe(2);
  });

  it('13. a REPLAYED webhook / duplicate event does not pay twice', async () => {
    const h = makeHarness({ enabled: true, settings: base });
    await h.service.attributeRegistration('referred', CODE);

    const first = await h.service.recordQualifyingEvent('referred', 'DEPOSIT', 'wtx-same', 60000);
    expect(first.recorded).toBe(true);
    expect(first.outcome).toBe('QUALIFIED');
    const paidAfterFirst = h.walletCalls.length;

    // The identical event is replayed (e.g. a provider retries its webhook).
    for (let i = 0; i < 5; i += 1) {
      const replay = await h.service.recordQualifyingEvent('referred', 'DEPOSIT', 'wtx-same', 60000);
      expect(replay.recorded).toBe(false);
    }

    expect(h.walletCalls).toHaveLength(paidAfterFirst);
    // The deposit was counted ONCE, so the total is 60000 and not 360000.
    const depositEvents = [...h.events.values()].filter((e) => e.kind === 'DEPOSIT');
    expect(depositEvents).toHaveLength(1);
  });

  it('14. the reward is a REAL ledger movement, not a balance edit', async () => {
    const h = makeHarness({ enabled: true, settings: base });
    await h.service.attributeRegistration('referred', CODE);
    await h.service.recordQualifyingEvent('referred', 'DEPOSIT', 'wtx-1', 60000);

    // The wallet service is the ONLY thing that moves money.
    expect(h.wallet.creditReferralBonus).toHaveBeenCalledTimes(2);
    for (const call of h.walletCalls) {
      expect(call.userId).toBeTruthy();
      expect(call.amount).toBeGreaterThan(0);
      // The wallet idempotency key is derived from the business event, never
      // from a client value.
      expect(call.key).toMatch(/^referral_reward:ref-\d+:(REFERRER|REFERRED)$/);
    }
    // The service never touches prisma.wallet directly.
    expect((h.prisma as any).wallet).toBeUndefined();
  });

  it('14b. each reward records the wallet transaction and the before/after balance', async () => {
    const h = makeHarness({ enabled: true, settings: base });
    await h.service.attributeRegistration('referred', CODE);
    await h.service.recordQualifyingEvent('referred', 'DEPOSIT', 'wtx-1', 60000);

    for (const reward of h.rewards.values()) {
      expect(reward.status).toBe('PAID');
      expect(reward.walletTransactionId).toMatch(/^wtx-\d+$/);
      expect(reward.afterBalance).toBe(reward.beforeBalance + reward.amount);
      // The settings snapshot explains WHY this amount.
      expect(reward.basis).toMatchObject({ qualificationRule: 'MIN_DEPOSIT' });
    }
  });

  it('15. the payout is transactional - a wallet failure rolls the WHOLE thing back', async () => {
    const h = makeHarness({ enabled: true, settings: base });
    await h.service.attributeRegistration('referred', CODE);
    // The deposit counts, but the payout leg fails.
    h.wallet.creditReferralBonus.mockRejectedValueOnce(new Error('wallet down'));
    await expect(
      h.service.recordQualifyingEvent('referred', 'DEPOSIT', 'wtx-1', 60000),
    ).rejects.toThrow('wallet down');

    // Nothing half-committed: no reward row, no money, and crucially the
    // referral is still PENDING so it can still be retried.
    expect(h.rewards.size).toBe(0);
    expect([...h.referrals.values()][0].status).toBe('PENDING');

    // The retry succeeds and pays EXACTLY ONCE (the deposit event is not
    // re-counted, because its eventKey is already recorded).
    const out = await h.service.evaluate([...h.referrals.keys()][0]);
    expect(out).toBe('QUALIFIED');
    expect([...h.referrals.values()][0].status).toBe('QUALIFIED');
    expect(h.rewards.size).toBe(2);
    expect(h.walletCalls).toHaveLength(2);
  });

  it('15b. a PERCENTAGE reward is computed server-side and capped (no money printer)', async () => {
    const h = makeHarness({
      enabled: true,
      settings: {
        qualificationRule: 'MIN_DEPOSIT',
        minDepositAmount: 1,
        referrerBonusType: 'PERCENTAGE',
        referrerBonusPercent: 5,
        // A huge deposit must still be capped.
        maxRewardPerReferral: 10000,
        referredBonusAmount: 0,
      },
    });
    await h.service.attributeRegistration('referred', CODE);
    // 10,000,000 minor units deposited => 5% would be 500,000, but the cap is 10,000.
    await h.service.recordQualifyingEvent('referred', 'DEPOSIT', 'wtx-big', 10_000_000);

    const reward = [...h.rewards.values()].find((r) => r.recipient === 'REFERRER');
    expect(reward?.amount).toBe(10000);
    expect(reward?.basis).toMatchObject({ type: 'PERCENTAGE', percent: 5, cappedByRule: true });
  });

  it('15c. a lifetime per-user cap stops further rewards (no unbounded minting)', async () => {
    const h = makeHarness({
      enabled: true,
      settings: {
        qualificationRule: 'MIN_DEPOSIT',
        minDepositAmount: 1,
        referrerBonusAmount: 25000,
        referredBonusAmount: 0,
        maxTotalRewardPerUser: 25000,
      },
    });
    await h.service.attributeRegistration('referred', CODE);
    await h.service.recordQualifyingEvent('referred', 'DEPOSIT', 'd1', 60000);
    expect([...h.rewards.values()][0].amount).toBe(25000);

    // A SECOND referred user cannot push the referrer past the lifetime cap.
    h.users.set('other2', {
      id: 'other2',
      username: 'second',
      email: 'second@example.com',
      accountType: 'CUSTOMER',
      status: 'ACTIVE',
      emailVerified: false,
      phoneVerified: false,
      referralCode: null,
    });
    await h.service.attributeRegistration('other2', CODE);
    await h.service.recordQualifyingEvent('other2', 'DEPOSIT', 'd2', 60000);

    const referrerRewards = [...h.rewards.values()].filter((r) => r.recipient === 'REFERRER');
    expect(referrerRewards).toHaveLength(1);
    const total = referrerRewards.reduce((s, r) => s + r.amount, 0);
    expect(total).toBeLessThanOrEqual(25000);
  });
});

// ---------------------------------------------------------------------------
// 16-22. Admin configuration, reporting and auditable history
// ---------------------------------------------------------------------------

describe('admin configuration and reporting', () => {
  it('16. an admin can enable and disable the referral program', async () => {
    const h = makeHarness({ enabled: false });
    expect((await h.service.getSettings()).isEnabled).toBe(false);

    const on = await h.service.updateSettings({ isEnabled: true }, 'admin-1');
    expect(on.isEnabled).toBe(true);
    expect(on.updatedBy).toBe('admin-1');

    const off = await h.service.updateSettings({ isEnabled: false }, 'admin-1');
    expect(off.isEnabled).toBe(false);
    // Every settings change is audited.
    expect(h.auditLogs.some((a) => a.action === 'REFERRAL_SETTINGS_UPDATED')).toBe(true);
  });

  it('17. an admin can change the referrer bonus (nothing is hard-coded)', async () => {
    const h = makeHarness({
      enabled: true,
      settings: { qualificationRule: 'REGISTRATION', referrerBonusAmount: 100, referredBonusAmount: 0 },
    });
    await h.service.updateSettings({ referrerBonusAmount: 25000 }, 'admin-1');
    await h.service.attributeRegistration('referred', CODE);
    expect([...h.rewards.values()][0].amount).toBe(25000);
  });

  it('18. an admin can change the referred-user bonus', async () => {
    const h = makeHarness({
      enabled: true,
      settings: { qualificationRule: 'REGISTRATION', referrerBonusAmount: 0, referredBonusAmount: 1 },
    });
    await h.service.updateSettings({ referredBonusAmount: 10000 }, 'admin-1');
    await h.service.attributeRegistration('referred', CODE);
    expect([...h.rewards.values()][0].amount).toBe(10000);
  });

  it('19. an admin can change the qualification rule', async () => {
    const h = makeHarness({ enabled: true, settings: { referrerBonusAmount: 25000 } });
    // Registration-only would qualify immediately.
    await h.service.updateSettings(
      { qualificationRule: 'MIN_WAGER', minWagerAmount: 100000 },
      'admin-1',
    );
    await h.service.attributeRegistration('referred', CODE);
    expect([...h.referrals.values()][0].status).toBe('PENDING');

    await h.service.recordQualifyingEvent('referred', 'WAGER', 'bet-1', 100000);
    expect([...h.referrals.values()][0].status).toBe('QUALIFIED');
  });

  it('20. admin statistics report the real counters', async () => {
    const h = makeHarness({
      enabled: true,
      settings: {
        qualificationRule: 'REGISTRATION',
        referrerBonusAmount: 25000,
        referredBonusAmount: 10000,
      },
    });
    await h.service.attributeRegistration('referred', CODE);

    const stats = await h.service.getAdminStats();
    expect(stats.programEnabled).toBe(true);
    expect(stats.totalReferrers).toBe(1);
    expect(stats.totalReferredUsers).toBe(1);
    expect(stats.qualifiedReferrals).toBe(1);
    expect(stats.pendingReferrals).toBe(0);
    expect(stats.totalRewards).toBe(2);
    expect(stats.paidRewardAmount).toBe(35000);
  });

  it('21. an admin can search referrers by username, user id or referral code', async () => {
    const h = makeHarness({ enabled: true, settings: { qualificationRule: 'REGISTRATION' } });
    await h.service.attributeRegistration('referred', CODE);

    const byCode = await h.service.searchReferrers(CODE);
    expect(byCode.items).toHaveLength(1);
    expect(byCode.items[0]).toMatchObject({ username: 'tanveer123', referredCount: 1 });

    const byUsername = await h.service.searchReferrers('tanveer');
    expect(byUsername.items).toHaveLength(1);

    const byId = await h.service.searchReferrers('referrer');
    expect(byId.items).toHaveLength(1);

    // Only safe public fields are ever returned.
    expect(byCode.items[0]).not.toHaveProperty('email');
    expect(byCode.items[0]).not.toHaveProperty('passwordHash');
  });

  it('22. reward history stays auditable - it is never deleted', async () => {
    const h = makeHarness({
      enabled: true,
      settings: {
        qualificationRule: 'REGISTRATION',
        referrerBonusAmount: 25000,
        referredBonusAmount: 0,
      },
    });
    await h.service.attributeRegistration('referred', CODE);
    const reward = [...h.rewards.values()][0];
    expect(reward.status).toBe('PAID');

    // An audited manual adjustment changes the amount but NEVER removes the row.
    const adjusted = await h.service.adjustReward(
      reward.id,
      5000,
      'Goodwill correction (ticket #4821)',
      'admin-1',
    );
    expect(adjusted.afterBalance).toBe(adjusted.beforeBalance + 5000);
    expect(h.rewards.size).toBe(1);
    expect(h.rewards.get(reward.id)).toMatchObject({
      amount: 30000,
      adjustmentReason: 'Goodwill correction (ticket #4821)',
      adjustedByUserId: 'admin-1',
    });
    // The adjustment is permanently audited with before/after balances.
    const audit = h.auditLogs.find((a) => a.action === 'REFERRAL_REWARD_ADJUSTED');
    expect(audit.newValue).toMatchObject({
      delta: 5000,
      beforeBalance: 25000,
      afterBalance: 30000,
    });
  });

  it('22b. an admin adjustment REQUIRES a reason and a non-zero amount', async () => {
    const h = makeHarness({
      enabled: true,
      settings: { qualificationRule: 'REGISTRATION', referrerBonusAmount: 25000, referredBonusAmount: 0 },
    });
    await h.service.attributeRegistration('referred', CODE);
    const reward = [...h.rewards.values()][0];

    await expect(h.service.adjustReward(reward.id, 0, 'no-op', 'admin-1')).rejects.toThrow();
    await expect(h.service.adjustReward(reward.id, 100, '  ', 'admin-1')).rejects.toThrow();
  });

  it('22c. rejecting a referral cancels its rewards but keeps the history', async () => {
    const h = makeHarness({
      enabled: true,
      settings: { qualificationRule: 'MIN_DEPOSIT', minDepositAmount: 50000, referrerBonusAmount: 25000 },
    });
    await h.service.attributeRegistration('referred', CODE);
    const referralId = [...h.referrals.keys()][0];

    await h.service.setReferralStatus(referralId, 'REJECTED', 'Confirmed self-referral ring', 'admin-1');
    expect([...h.referrals.values()][0].status).toBe('REJECTED');
    // Still queryable, never deleted.
    const rewards = await h.service.searchRewards({ search: CODE });
    expect(Array.isArray(rewards.items)).toBe(true);
  });

  it('the top-referrer list reports qualified counts and earnings', async () => {
    const h = makeHarness({
      enabled: true,
      settings: {
        qualificationRule: 'REGISTRATION',
        referrerBonusAmount: 25000,
        referredBonusAmount: 0,
      },
    });
    await h.service.attributeRegistration('referred', CODE);
    const top = await h.service.getTopReferrers(5);
    expect(top[0]).toMatchObject({ username: 'tanveer123', referredCount: 1, qualifiedCount: 1, earnedTotal: 25000 });
  });
});
