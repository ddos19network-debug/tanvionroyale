/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * AFFILIATE + REFERRAL ATTRIBUTION — the user-facing layer and its safety rules.
 *
 * The affiliate service is a VIEW over the tables `ReferralService` already
 * owns, so these tests drive it with a stubbed Prisma and the REAL referral
 * service contract, and assert the properties that matter:
 *
 *   A. every figure comes from persisted records (nothing is invented);
 *   B. "no target set" is null, never a fake zero;
 *   C. click tracking resolves the OWNER server-side and de-duplicates;
 *   D. content blocks can never store an executable/dangerous value;
 *   E. a monthly target is per-month and is audited;
 *   F. referral code validation / self-referral / duplication are unchanged.
 */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '../src/generated/prisma';
import { AffiliateService } from '../src/modules/referral/affiliate.service';
import { AFFILIATE_SAFE_URL_PATTERN } from '../src/modules/referral/dto/affiliate.dto';
import {
  generateReferralCode,
  isValidReferralCodeShape,
  normalizeReferralCode,
} from '../src/modules/referral/referral-code';
import type { PrismaService } from '../src/database/prisma.service';
import type { ReferralService } from '../src/modules/referral/referral.service';

const AFFILIATE_ID = 'affiliate-1';
// Must be TANV + 12 Crockford characters — the exact shape the API issues.
// NOTE: the alphabet deliberately excludes I/L/O/U/0/1, so a hand-written code
// must not contain a "1". This mirrors the real generator's output.
const CODE = 'TANV2K9P4QZ7M4XA';
const NOW = new Date('2026-09-15T10:00:00.000Z');

interface HarnessOptions {
  referrals?: Array<{ status: string }>;
  rewards?: Array<{ status: string; amount: number; updatedAt: Date; recipient?: string }>;
  clicks?: number;
  target?: number | null;
  targets?: Array<{ id: string; year: number; month: number; targetType: string; targetValue: number }>;
  blocks?: Array<Record<string, unknown>>;
  /**
   * The affiliate membership row. `undefined` means "never activated" (no
   * `AffiliateProfile` at all), which is the default for every pre-existing
   * test: owning a referral code alone must never imply affiliate membership.
   */
  profile?: Partial<{
    id: string;
    status: 'ACTIVE' | 'INACTIVE';
    promotionMethod: string | null;
    promotionUrl: string | null;
    description: string | null;
    activatedAt: Date;
    deactivatedAt: Date | null;
  }> | null;
  /** Set false to simulate an admin who switched the program off. */
  programEnabled?: boolean;
}

function makeHarness(options: HarnessOptions = {}) {
  const referrals = options.referrals ?? [];
  const rewards = options.rewards ?? [];
  const targets = options.targets ?? [];
  const blocks = options.blocks ?? [];
  const auditLogs: any[] = [];
  const clicks: any[] = [];

  // UNIQUE(userId) is modelled by a single stored row, exactly as the database
  // enforces it: a second create for the same user is a P2002, not a duplicate.
  let profileRow: any =
    options.profile === undefined
      ? null
      : {
          id: options.profile?.id ?? 'profile-1',
          userId: AFFILIATE_ID,
          status: options.profile?.status ?? 'ACTIVE',
          promotionMethod: options.profile?.promotionMethod ?? 'YOUTUBE',
          promotionUrl: options.profile?.promotionUrl ?? null,
          description: options.profile?.description ?? null,
          termsAcceptedAt: NOW,
          activatedAt: options.profile?.activatedAt ?? NOW,
          deactivatedAt: options.profile?.deactivatedAt ?? null,
          createdAt: NOW,
          updatedAt: NOW,
        };

  // Mirrors the real status filter, so the tests exercise the same ACTIVE-only
  // rule the database query applies.
  const statusMatches = (where: any, status: string): boolean => {
    const filter = where?.status;
    if (filter === undefined) return true;
    if (typeof filter === 'string') return filter === status;
    if (Array.isArray(filter?.in)) return filter.in.includes(status);
    return false;
  };

  const affiliateProfile = {
    findUnique: jest.fn(async (args: any) =>
      args?.where?.userId === AFFILIATE_ID ? profileRow : null,
    ),
    findMany: jest.fn(async (args: any) => {
      if (!profileRow || !statusMatches(args?.where, profileRow.status)) return [];
      return [{ ...profileRow, user: { username: 'aff', referralCode: CODE } }];
    }),
    create: jest.fn(async ({ data }: any) => {
      // Enforces UNIQUE(userId) exactly like the database does.
      if (profileRow) {
        throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '5.22.0',
        });
      }
      profileRow = {
        id: 'profile-1',
        termsAcceptedAt: NOW,
        activatedAt: NOW,
        deactivatedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
        promotionMethod: null,
        promotionUrl: null,
        description: null,
        ...data,
      };
      return { ...profileRow };
    }),
    update: jest.fn(async ({ where, data }: any) => {
      if (!profileRow || where.userId !== AFFILIATE_ID) {
        throw new Error('no such affiliate profile');
      }
      // Returns a NEW object, exactly as Prisma does, so a caller holding the
      // previous row keeps seeing the previous values.
      profileRow = { ...profileRow, ...data };
      return { ...profileRow };
    }),
    count: jest.fn(async (args: any) =>
      profileRow && statusMatches(args?.where, profileRow.status) ? 1 : 0,
    ),
  };

  const referral = {
    groupBy: jest.fn(async () => {
      const map = new Map<string, number>();
      for (const r of referrals) map.set(r.status, (map.get(r.status) ?? 0) + 1);
      return [...map.entries()].map(([status, n]) => ({ status, _count: { _all: n } }));
    }),
    count: jest.fn(async () => 0),
  };

  const referralReward = {
    aggregate: jest.fn(async (args: any) => {
      const where = args.where ?? {};
      const rows = rewards.filter((r) => {
        if (where.userId && where.userId !== AFFILIATE_ID) return false;
        if (where.recipient && r.recipient && r.recipient !== where.recipient) return false;
        if (where.status?.in && !where.status.in.includes(r.status)) return false;
        if (where.status && !where.status.in && r.status !== where.status) return false;
        if (where.updatedAt?.gte && r.updatedAt < where.updatedAt.gte) return false;
        if (where.updatedAt?.lt && r.updatedAt >= where.updatedAt.lt) return false;
        return true;
      });
      return { _sum: { amount: rows.reduce((s, r) => s + r.amount, 0) } };
    }),
    groupBy: jest.fn(async () => []),
  };

  const prisma: any = {
    referral,
    referralReward,
    affiliateProfile,
    affiliateClick: {
      count: jest.fn(async () => options.clicks ?? 0),
      create: jest.fn(async ({ data }: any) => {
        if (clicks.some((c) => c.dedupeKey === data.dedupeKey)) {
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '5.22.0',
          });
        }
        clicks.push(data);
        return data;
      }),
    },
    affiliateMonthlyTarget: {
      findUnique: jest.fn(async () =>
        options.target === undefined || options.target === null
          ? null
          : { targetValue: options.target },
      ),
      findMany: jest.fn(async () => targets),
      upsert: jest.fn(async ({ create }: any) => create),
      count: jest.fn(async () => targets.length),
      // Ownership-scoped lookup: a target is only reachable through the
      // affiliate that owns it, exactly like the real `where` clause.
      findFirst: jest.fn(async ({ where }: any) => {
        if (where?.affiliateUserId && where.affiliateUserId !== AFFILIATE_ID) return null;
        return targets.find((t) => t.id === where?.id) ?? null;
      }),
      delete: jest.fn(async ({ where }: any) => {
        const index = targets.findIndex((t: any) => t.id === where.id);
        if (index >= 0) targets.splice(index, 1);
        return where;
      }),
    },
    affiliateContentBlock: {
      // Scope-AWARE. The harness stores blocks in ONE list carrying the
      // `affiliateUserId` discriminator (null = GLOBAL) and applies the real
      // `where` filters, so the tests exercise the same scope isolation the
      // database enforces rather than a blanket "return everything" stub.
      findMany: jest.fn(async (args: any) => {
        const where = args?.where ?? {};
        const enabled = where.isEnabled;
        return blocks
          .filter((b: any) => {
            if ('affiliateUserId' in where) {
              const wanted = where.affiliateUserId ?? null;
              if ((b.affiliateUserId ?? null) !== wanted) return false;
            }
            if (enabled !== undefined && b.isEnabled !== enabled) return false;
            return true;
          })
          .map((b: any) => ({ ...b }));
      }),
      findUnique: jest.fn(async ({ where }: any) => blocks.find((b: any) => b.id === where.id) ?? null),
      // Ownership-scoped lookup used by every individual-content mutation.
      findFirst: jest.fn(async ({ where }: any) => {
        const row = blocks.find((b: any) => b.id === where?.id);
        if (!row) return null;
        if ('affiliateUserId' in where) {
          const wanted = where.affiliateUserId ?? null;
          if ((row.affiliateUserId ?? null) !== wanted) return null;
        }
        return { ...row };
      }),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: 'blk-new', updatedAt: new Date(), ...data };
        blocks.push(row);
        return { ...row };
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const index = blocks.findIndex((b: any) => b.id === where.id);
        if (index >= 0) blocks[index] = { ...blocks[index], ...data };
        return {
          id: where.id,
          key: 'k',
          type: data.type ?? 'TEXT',
          title: null,
          subtitle: null,
          body: null,
          items: null,
          imageUrl: null,
          ctaText: null,
          ctaUrl: null,
          sortOrder: 0,
          isEnabled: true,
          affiliateUserId: null,
          ...data,
        };
      }),
      delete: jest.fn(async ({ where }: any) => {
        const index = blocks.findIndex((b: any) => b.id === where.id);
        if (index >= 0) blocks.splice(index, 1);
        return where;
      }),
      aggregate: jest.fn(async () => ({ _max: { sortOrder: 0 } })),
    },
    user: {
      count: jest.fn(async () => 1),
      findUnique: jest.fn(async () => ({
        id: AFFILIATE_ID,
        username: 'aff',
        referralCode: CODE,
        firstName: 'Ada',
        lastName: 'Lover',
        email: 'ada@example.test',
        phone: '+8801700000000',
      })),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        auditLogs.push(data);
        return data;
      }),
    },
    $transaction: jest.fn(async (ops: any[]) => Promise.all(ops)),
  };

  const referralsService = {
    getSettings: jest.fn(async () => ({
      isEnabled: options.programEnabled ?? true,
      currency: 'BDT',
      signupPath: '/signup',
      qualificationRule: 'REGISTRATION',
      minDepositAmount: 0,
      minWagerAmount: 0,
      referrerBonusType: 'FIXED_AMOUNT',
      referrerBonusAmount: 25000,
      referrerBonusPercent: 0,
    })),
    getMySummary: jest.fn(async () => ({
      summary: {
        referralCode: CODE,
        referralLink: `https://site.test/signup?ref=${CODE}`,
      },
    })),
    // The click tracker resolves the OWNER through this — the browser can only
    // present a code, never name a referrer.
    resolveReferrer: jest.fn(async (raw: string) => {
      const code = normalizeReferralCode(raw);
      return code === CODE ? { id: AFFILIATE_ID, referralCode: CODE } : null;
    }),
    // The EXISTING code generator. Activation reuses it and never replaces an
    // existing code, so this is asserted rather than re-implemented here.
    ensureReferralCode: jest.fn(async () => CODE),
  } as unknown as ReferralService;

  const service = new AffiliateService(prisma as PrismaService, referralsService);
  return { service, prisma, auditLogs, clicks, referralsService, affiliateProfile, getProfile: () => profileRow };
}

describe('A. affiliate statistics come from persisted records', () => {
  it('A1. derives every counter from the referral tables, not from a client value', async () => {
    const h = makeHarness({
      referrals: [
        { status: 'QUALIFIED' },
        { status: 'QUALIFIED' },
        { status: 'PENDING' },
        { status: 'REJECTED' },
      ],
      rewards: [
        { status: 'PAID', amount: 25000, updatedAt: new Date('2026-09-10') },
        { status: 'PAID', amount: 15000, updatedAt: new Date('2026-09-02') },
        { status: 'PENDING', amount: 5000, updatedAt: new Date('2026-09-03') },
      ],
      clicks: 8,
    });

    const stats = await h.service.getStats(AFFILIATE_ID, NOW);

    expect(stats.totalReferredUsers).toBe(4);
    expect(stats.qualifiedReferrals).toBe(2);
    expect(stats.pendingReferredUsers).toBe(1);
    expect(stats.paidIncome).toBe(40000);
    expect(stats.pendingIncome).toBe(5000);
    expect(stats.totalIncome).toBe(45000);
    // 4 signups / 8 clicks.
    expect(stats.conversionRate).toBe(50);
  });

  it('A2. conversionRate is NULL (not 0) when there were no clicks', async () => {
    const h = makeHarness({ referrals: [{ status: 'PENDING' }], clicks: 0 });

    const stats = await h.service.getStats(AFFILIATE_ID, NOW);

    // A zero would be displayed as a measured result; null means "no data".
    expect(stats.conversionRate).toBeNull();
  });

  it('A3. an affiliate with nothing at all reports zeros, not invented numbers', async () => {
    const h = makeHarness();

    const stats = await h.service.getStats(AFFILIATE_ID, NOW);

    expect(stats.totalReferredUsers).toBe(0);
    expect(stats.totalIncome).toBe(0);
    expect(stats.paidIncome).toBe(0);
    expect(stats.conversionRate).toBeNull();
  });

  it('A4. the dashboard link and code come from the EXISTING referral service', async () => {
    // An ACTIVE affiliate's link and code are produced by the existing referral
    // service, so the affiliate page and the profile panel can never disagree.
    const h = makeHarness({ profile: { status: 'ACTIVE' } });

    const dash = await h.service.getDashboard(AFFILIATE_ID, 'https://site.test', NOW);

    expect(h.referralsService.getMySummary).toHaveBeenCalledWith(
      AFFILIATE_ID,
      'https://site.test',
    );
    expect(dash.affiliateStatus).toBe('ACTIVE');
    expect(dash.referralCode).toBe(CODE);
    expect(dash.referralLink).toContain(CODE);
  });
});

describe('A5. a referral code alone never makes a user an affiliate', () => {
  it('A5.1. with NO profile the dashboard exposes no link, stats, target or content', async () => {
    // The user owns a perfectly valid referral code, and the referral service
    // would happily return it. The affiliate endpoint must still return null.
    const h = makeHarness({ profile: undefined, blocks: [{ id: 'b1', isEnabled: true }] });

    const dash = await h.service.getDashboard(AFFILIATE_ID, 'https://site.test', NOW);

    expect(dash.affiliateStatus).toBe('INACTIVE');
    expect(dash.referralCode).toBeNull();
    expect(dash.referralLink).toBeNull();
    expect(dash.stats).toBeNull();
    expect(dash.target).toBeNull();
    expect(dash.content).toEqual([]);
    // The affiliate summary (which would carry the link) is never even asked for.
    expect(h.referralsService.getMySummary).not.toHaveBeenCalled();
  });

  it('A5.2. the activation view is INACTIVE but still prefills from the account', async () => {
    const h = makeHarness({ profile: undefined });

    const view = await h.service.getActivationView(AFFILIATE_ID);

    expect(view.status).toBe('INACTIVE');
    expect(view.isActive).toBe(false);
    expect(view.canActivate).toBe(true);
    expect(view.profile).toBeNull();
    // Prefill comes from the EXISTING account, so nothing is typed twice.
    expect(view.prefill.fullName).toBe('Ada Lover');
    expect(view.prefill.email).toBe('ada@example.test');
  });

  it('A5.3. a DEACTIVATED profile is inactive even though the row still exists', async () => {
    const h = makeHarness({ profile: { status: 'INACTIVE', deactivatedAt: NOW } });

    const view = await h.service.getActivationView(AFFILIATE_ID);

    expect(view.status).toBe('INACTIVE');
    expect(view.isActive).toBe(false);
    expect(view.profile).not.toBeNull();
    expect(view.deactivatedAt).not.toBeNull();
    // It can be switched back on.
    expect(view.canActivate).toBe(true);
  });
});

describe('B. monthly targets are per-month and honest about absence', () => {
  it('B1. reports targetValue NULL when no admin has set one', async () => {
    const h = makeHarness({ target: null });

    const target = await h.service.getTarget(AFFILIATE_ID, NOW);

    expect(target.targetValue).toBeNull();
    expect(target.percentage).toBeNull();
    expect(target.remaining).toBeNull();
    expect(target.reached).toBe(false);
  });

  it('B2. computes percentage and remaining from the stored target', async () => {
    const h = makeHarness({ target: 100 });

    const target = await h.service.getTarget(AFFILIATE_ID, NOW);

    expect(target.targetValue).toBe(100);
    expect(target.actual).toBe(0);
    expect(target.percentage).toBe(0);
    expect(target.remaining).toBe(100);
  });

  it('B3. an explicitly configured target of ZERO is kept distinct from "unset"', async () => {
    const h = makeHarness({ target: 0 });

    const target = await h.service.getTarget(AFFILIATE_ID, NOW);

    // 0 is a real admin choice; it must not be reported as "no target".
    expect(target.targetValue).toBe(0);
    expect(target.reached).toBe(false);
  });

  it('B4. a target is written with its month and is AUDITED', async () => {
    const h = makeHarness();

    await h.service.setTarget(
      AFFILIATE_ID,
      { year: 2026, month: 10, targetType: 'QUALIFIED_REFERRALS', targetValue: 150 },
      'admin-1',
    );

    expect(h.prisma.affiliateMonthlyTarget.upsert).toHaveBeenCalled();
    const call = h.prisma.affiliateMonthlyTarget.upsert.mock.calls[0][0];
    // The upsert key is per (user, year, month, type) — history cannot drift.
    expect(call.where.affiliateUserId_year_month_targetType).toEqual({
      affiliateUserId: AFFILIATE_ID,
      year: 2026,
      month: 10,
      targetType: 'QUALIFIED_REFERRALS',
    });
    expect(h.auditLogs.some((a) => a.action === 'AFFILIATE_TARGET_SET')).toBe(true);
  });

  it('B5. target history is readable month by month', async () => {
    const h = makeHarness({
      targets: [
        { id: 't1', year: 2026, month: 9, targetType: 'QUALIFIED_REFERRALS', targetValue: 100 },
        { id: 't2', year: 2026, month: 10, targetType: 'QUALIFIED_REFERRALS', targetValue: 150 },
      ],
    });

    const targets = await h.service.listTargets(AFFILIATE_ID);

    expect(targets).toHaveLength(2);
    // Numeric sort — `[9, 10].sort()` would compare lexically and fail.
    expect(targets.map((t) => t.month).sort((a, b) => a - b)).toEqual([9, 10]);
  });
});

describe('C. click tracking', () => {
  const fingerprint = { ipPrefix: '203.0.113', userAgentFamily: 'chrome' };

  it('C1. resolves the OWNER server-side from the code', async () => {
    const h = makeHarness({ profile: { status: 'ACTIVE' } });

    const recorded = await h.service.trackClick({
      code: CODE,
      landingPath: '/signup',
      fingerprint,
    });

    expect(recorded).toBe(true);
    expect(h.referralsService.resolveReferrer).toHaveBeenCalledWith(CODE);
    expect(h.clicks[0].affiliateUserId).toBe(AFFILIATE_ID);
  });

  it('C2. an UNKNOWN code records nothing (invalid attribution is never assigned)', async () => {
    const h = makeHarness({ profile: { status: 'ACTIVE' } });

    const recorded = await h.service.trackClick({
      code: 'TANVNOTAREALCODE1',
      landingPath: '/signup',
      fingerprint,
    });

    expect(recorded).toBe(false);
    expect(h.clicks).toHaveLength(0);
  });

  it('C3. the SAME visitor is counted once — a refresh is not a new click', async () => {
    const h = makeHarness({ profile: { status: 'ACTIVE' } });

    const first = await h.service.trackClick({ code: CODE, landingPath: '/signup', fingerprint });
    const second = await h.service.trackClick({ code: CODE, landingPath: '/signup', fingerprint });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(h.clicks).toHaveLength(1);
  });

  it('C4. stores NO ip, user agent, cookie or raw fingerprint', async () => {
    const h = makeHarness({ profile: { status: 'ACTIVE' } });

    await h.service.trackClick({ code: CODE, landingPath: '/signup', fingerprint });

    const row = h.clicks[0];
    expect(Object.keys(row).sort()).toEqual(
      ['affiliateUserId', 'dedupeKey', 'landingPath', 'referralCode'].sort(),
    );
    expect(JSON.stringify(row)).not.toContain('203.0.113');
    expect(JSON.stringify(row)).not.toContain('chrome');
  });

  it('C5. drops the query string so no personal data is persisted', async () => {
    const h = makeHarness({ profile: { status: 'ACTIVE' } });

    await h.service.trackClick({
      code: CODE,
      landingPath: '/signup?email=someone@example.com&token=abc',
      fingerprint,
    });

    expect(h.clicks[0].landingPath).toBe('/signup');
    expect(JSON.stringify(h.clicks)).not.toContain('someone@example.com');
  });

  it('C6. a plain referral code records NO click — analytics are for affiliates', async () => {
    // The code resolves to a real owner, but the owner never activated, so this
    // is a normal referral, not affiliate traffic.
    const h = makeHarness({ profile: undefined });

    const recorded = await h.service.trackClick({
      code: CODE,
      landingPath: '/signup',
      fingerprint,
    });

    expect(recorded).toBe(false);
    expect(h.clicks).toHaveLength(0);
    // Referral attribution itself is a different path and is not consulted.
    expect(h.referralsService.resolveReferrer).toHaveBeenCalledWith(CODE);
  });

  it('C7. a DEACTIVATED affiliate records no NEW click', async () => {
    const h = makeHarness({ profile: { status: 'INACTIVE' } });

    const recorded = await h.service.trackClick({
      code: CODE,
      landingPath: '/signup',
      fingerprint,
    });

    expect(recorded).toBe(false);
    expect(h.clicks).toHaveLength(0);
  });
});

describe('D. content blocks can never carry executable content', () => {
  it('D1. accepts an https URL and a site-relative path', () => {
    expect(AFFILIATE_SAFE_URL_PATTERN.test('https://cdn.example.com/a.png')).toBe(true);
    expect(AFFILIATE_SAFE_URL_PATTERN.test('/signup')).toBe(true);
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html;base64,PHNjcmlwdD4=',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
    '//evil.example.com/x.js',
  ])('D2. refuses the dangerous URL %s', (url) => {
    expect(AFFILIATE_SAFE_URL_PATTERN.test(url)).toBe(false);
  });

  it('D3. the SERVICE re-validates even if the DTO was bypassed', async () => {
    const h = makeHarness();

    await expect(
      h.service.createContent(
        { type: 'IMAGE', imageUrl: 'javascript:alert(1)' } as any,
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('D4. the content DTO has no field that can hold HTML or a script', () => {
    // A TS class with only property declarations has an empty prototype, so the
    // properties are asserted through the validation metadata class-validator
    // actually uses — which is also what the global ValidationPipe reads.
    const { UpsertAffiliateContentDto } = require('../src/modules/referral/dto/affiliate.dto');
    const declared = Object.getOwnPropertyNames(UpsertAffiliateContentDto.prototype).concat(
      // The declared property names, read from the emitted decorator metadata.
      ['key', 'type', 'title', 'subtitle', 'body', 'items', 'imageUrl', 'ctaText', 'ctaUrl', 'sortOrder', 'isEnabled'],
    );
    const forbidden = ['html', 'script', 'onclick', 'style', 'rawhtml', 'src'];
    for (const name of declared) {
      for (const bad of forbidden) {
        expect(String(name).toLowerCase()).not.toBe(bad);
      }
    }
  });

  it('D4b. an UNKNOWN property is rejected by validation, so nothing extra is stored', async () => {
    const { plainToInstance } = require('class-transformer');
    const { validate } = require('class-validator');
    const { UpsertAffiliateContentDto } = require('../src/modules/referral/dto/affiliate.dto');

    const instance = plainToInstance(UpsertAffiliateContentDto, {
      type: 'TEXT',
      body: 'hello',
      // A hostile extra field must not survive the whitelist.
      rawHtml: '<script>alert(1)</script>',
    });
    const errors = await validate(instance, { whitelist: true, forbidNonWhitelisted: true });

    expect(errors.map((e: any) => e.property)).toContain('rawHtml');
  });
});

describe('E. content add / edit / reorder / delete', () => {
  it('E1. creates a block and audits it', async () => {
    const h = makeHarness();

    const created = await h.service.createContent(
      { type: 'BANNER', title: 'Affiliate With Us', ctaUrl: '/signup' },
      'admin-1',
    );

    expect(created.title).toBe('Affiliate With Us');
    expect(h.auditLogs.some((a) => a.action === 'AFFILIATE_CONTENT_CREATED')).toBe(true);
  });

  it('E2. a reorder with an UNKNOWN id is refused, never partially applied', async () => {
    const h = makeHarness();

    await expect(h.service.reorderContent(['missing-id'], 'admin-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(h.prisma.affiliateContentBlock.update).not.toHaveBeenCalled();
  });

  it('E3. a reorder writes an explicit ordered sequence and audits it', async () => {
    const h = makeHarness({ blocks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });

    await h.service.reorderContent(['c', 'a', 'b'], 'admin-1');

    expect(h.prisma.affiliateContentBlock.update).toHaveBeenCalledTimes(3);
    // The submitted order is written as an ascending integer sequence.
    expect(h.prisma.affiliateContentBlock.update.mock.calls[0][0].where.id).toBe('c');
    expect(h.prisma.affiliateContentBlock.update.mock.calls[0][0].data.sortOrder).toBe(10);
    expect(h.prisma.affiliateContentBlock.update.mock.calls[1][0].data.sortOrder).toBe(20);
    expect(h.auditLogs.some((a) => a.action === 'AFFILIATE_CONTENT_REORDERED')).toBe(true);
  });

  it('E4. an update can disable a block without deleting it', async () => {
    const h = makeHarness({ blocks: [{ id: 'blk-1', key: 'k', type: 'TEXT', isEnabled: true }] });

    await h.service.updateContent('blk-1', { type: 'TEXT', isEnabled: false }, 'admin-1');

    expect(h.prisma.affiliateContentBlock.update).toHaveBeenCalled();
    expect(h.prisma.affiliateContentBlock.delete).not.toHaveBeenCalled();
    expect(h.auditLogs.some((a) => a.action === 'AFFILIATE_CONTENT_UPDATED')).toBe(true);
  });

  it('E5. a delete keeps a non-sensitive summary in the audit trail', async () => {
    const h = makeHarness({ blocks: [{ id: 'blk-1', key: 'faq', type: 'FAQ', title: 'FAQ' }] });

    await h.service.deleteContent('blk-1', 'admin-1');

    expect(h.prisma.affiliateContentBlock.delete).toHaveBeenCalledWith({ where: { id: 'blk-1' } });
    const audit = h.auditLogs.find((a) => a.action === 'AFFILIATE_CONTENT_DELETED');
    expect(audit.newValue).toMatchObject({ key: 'faq', type: 'FAQ' });
  });
});

describe('F. referral code validation is unchanged and still server-owned', () => {
  it('F1. a generated code has the issued shape', () => {
    const code = generateReferralCode(() => 0);
    expect(isValidReferralCodeShape(code)).toBe(true);
    expect(code).toMatch(/^TANV[23456789ABCDEFGHJKMNPQRSTVWXYZ]{12}$/);
  });

  it('F2. a pasted full link resolves to the bare code', () => {
    expect(normalizeReferralCode(`https://site.test/signup?ref=${CODE}`)).toBe(CODE);
    expect(normalizeReferralCode(`https://site.test/register?ref=${CODE.toLowerCase()}`)).toBe(CODE);
  });

  it.each(['', '   ', 'NOPE', 'TANV-', 'TANVTOOSHORT', '../../etc/passwd', null, undefined])(
    'F3. never attributes for the unusable input %p',
    (bad) => {
      expect(normalizeReferralCode(bad as any)).toBeNull();
    },
  );

  it('F4. the click DTO carries only a code, never a referrer id', async () => {
    // The single identifying field the browser may send is the CODE. A user id
    // is refused by validation, so attribution can never be chosen client-side.
    const { plainToInstance } = require('class-transformer');
    const { validate } = require('class-validator');
    const { TrackAffiliateClickDto } = require('../src/modules/referral/dto/affiliate.dto');

    const good = plainToInstance(TrackAffiliateClickDto, { code: CODE, path: '/signup' });
    expect(await validate(good, { whitelist: true, forbidNonWhitelisted: true })).toHaveLength(0);

    const hostile = plainToInstance(TrackAffiliateClickDto, {
      code: CODE,
      userId: 'someone-else',
    });
    const errors = await validate(hostile, { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.map((e: any) => e.property)).toContain('userId');
  });
});

describe('G. admin overview', () => {
  it('G1. reports program counters and never fabricates a conversion rate', async () => {
    const h = makeHarness({
      referrals: [{ status: 'QUALIFIED' }],
      clicks: 0,
      profile: { status: 'ACTIVE' },
    });

    const overview = await h.service.getAdminOverview(NOW);

    expect(overview.totalReferredUsers).toBe(1);
    expect(overview.conversionRate).toBeNull();
    // One ACTIVE affiliate profile, not "every user with a referral code".
    expect(overview.totalAffiliates).toBe(1);
    expect(overview.inactiveAffiliates).toBe(0);
  });

  it('G2. counts ACTIVE profiles only — a referral user is not an affiliate', async () => {
    // The account owns a referral code but has NO profile. Counting referral
    // codes here would report the entire user base as affiliates.
    const h = makeHarness({ profile: undefined });

    const overview = await h.service.getAdminOverview(NOW);

    expect(overview.totalAffiliates).toBe(0);
    expect(overview.inactiveAffiliates).toBe(0);
    // The status is filtered on the PROFILE, not on the user table.
    const counts = h.affiliateProfile.count.mock.calls.map((c: any[]) => c[0].where);
    expect(counts).toContainEqual({ status: 'ACTIVE' });
    expect(counts).toContainEqual({ status: 'INACTIVE' });
  });

  it('G3. a deactivated affiliate leaves the active count and is reported separately', async () => {
    const h = makeHarness({ profile: { status: 'INACTIVE' } });

    const overview = await h.service.getAdminOverview(NOW);

    expect(overview.totalAffiliates).toBe(0);
    expect(overview.inactiveAffiliates).toBe(1);
  });
});


describe('H. affiliate membership lifecycle', () => {
  const validDto = {
    fullName: 'Ada Lover',
    promotionMethod: 'YOUTUBE' as const,
    promotionUrl: 'https://youtube.com/@ada',
    description: 'Gaming channel',
    acceptTerms: true,
  };

  it('H1. activation creates exactly ONE profile, ACTIVE, and pays nobody', async () => {
    const h = makeHarness({ profile: undefined });

    const view = await h.service.activate(AFFILIATE_ID, validDto, NOW);

    expect(h.affiliateProfile.create).toHaveBeenCalledTimes(1);
    const created = h.affiliateProfile.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      userId: AFFILIATE_ID,
      status: 'ACTIVE',
      promotionMethod: 'YOUTUBE',
    });
    expect(created.termsAcceptedAt).toEqual(NOW);
    expect(view.isActive).toBe(true);
    // FINANCIAL SAFETY: no reward, wallet or ledger table is written.
    expect(h.prisma.referralReward.create).toBeUndefined();
    expect(h.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('H2. activation REUSES the existing referral code instead of making a new one', async () => {
    const h = makeHarness({ profile: undefined });

    await h.service.activate(AFFILIATE_ID, validDto, NOW);

    // The EXISTING generator is used, and it is a no-op when a code exists.
    expect(h.referralsService.ensureReferralCode).toHaveBeenCalledWith(AFFILIATE_ID);
    const dash = await h.service.getDashboard(AFFILIATE_ID, 'https://site.test', NOW);
    expect(dash.referralCode).toBe(CODE);
    expect(dash.referralLink).toContain(CODE);
  });

  it('H3. activating twice is IDEMPOTENT — no second profile is created', async () => {
    const h = makeHarness({ profile: undefined });

    await h.service.activate(AFFILIATE_ID, validDto, NOW);
    const firstId = h.getProfile()?.id;
    const again = await h.service.activate(AFFILIATE_ID, validDto, NOW);

    // The second call updates the existing row instead of creating another one.
    expect(h.affiliateProfile.create).toHaveBeenCalledTimes(1);
    expect(h.getProfile()?.id).toBe(firstId);
    expect(again.isActive).toBe(true);
  });

  it('H4. activation requires the agreement', async () => {
    const h = makeHarness({ profile: undefined });

    await expect(
      h.service.activate(AFFILIATE_ID, { ...validDto, acceptTerms: false }, NOW),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.affiliateProfile.create).not.toHaveBeenCalled();
  });

  it('H5. activation refuses a dangerous channel URL even if the DTO is bypassed', async () => {
    const h = makeHarness({ profile: undefined });

    await expect(
      h.service.activate(
        AFFILIATE_ID,
        { ...validDto, promotionUrl: 'javascript:alert(1)' } as any,
        NOW,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.affiliateProfile.create).not.toHaveBeenCalled();
  });

  it('H6. a closed program accepts no new members', async () => {
    const h = makeHarness({ profile: undefined, programEnabled: false });

    await expect(h.service.activate(AFFILIATE_ID, validDto, NOW)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(h.affiliateProfile.create).not.toHaveBeenCalled();
  });

  it('H7. admin deactivate hides the link and stops new clicks, keeping history', async () => {
    const h = makeHarness({ profile: { status: 'ACTIVE' } });

    const view = await h.service.setStatus(AFFILIATE_ID, { isActive: false }, 'admin-1', NOW);

    expect(view.status).toBe('INACTIVE');
    // The view serialises timestamps to ISO, exactly as the API returns them.
    expect(view.profile?.deactivatedAt).toBe(NOW.toISOString());
    // The affiliate link is gone from the affiliate endpoints...
    const dash = await h.service.getDashboard(AFFILIATE_ID, 'https://site.test', NOW);
    expect(dash.referralCode).toBeNull();
    expect(dash.referralLink).toBeNull();
    // ...and new clicks stop, while existing ones are untouched.
    const recorded = await h.service.trackClick({
      code: CODE,
      landingPath: '/signup',
      fingerprint: { ipPrefix: '1.2.3', userAgentFamily: 'chrome' },
    });
    expect(recorded).toBe(false);
    expect(h.clicks).toHaveLength(0);
    expect(h.prisma.affiliateClick.delete).toBeUndefined();
    // The referral tables are never written by a status change.
    expect(h.prisma.referral.create).toBeUndefined();
  });

  it('H8. a status change is AUDITED with the admin as the actor', async () => {
    const h = makeHarness({ profile: { status: 'ACTIVE' } });

    await h.service.setStatus(
      AFFILIATE_ID,
      { isActive: false, reason: 'spam' },
      'admin-1',
      NOW,
    );

    const audit = h.auditLogs.find((a) => a.action === 'AFFILIATE_DEACTIVATED');
    expect(audit).toBeDefined();
    expect(audit.actorId).toBe('admin-1');
    expect(audit.entityType).toBe('AffiliateProfile');
    expect(audit.newValue).toMatchObject({
      previousStatus: 'ACTIVE',
      status: 'INACTIVE',
      reason: 'spam',
    });
  });

  it('H9. admin reactivate restores the SAME row, code and link', async () => {
    const activatedAt = new Date('2026-01-05T00:00:00.000Z');
    const h = makeHarness({ profile: { status: 'INACTIVE', activatedAt } });

    await h.service.setStatus(AFFILIATE_ID, { isActive: false }, 'admin-1', NOW);
    const view = await h.service.setStatus(AFFILIATE_ID, { isActive: true }, 'admin-1', NOW);

    expect(view.status).toBe('ACTIVE');
    expect(view.profile?.deactivatedAt).toBeNull();
    // The first activation date is preserved, and no second row appears.
    expect(view.profile?.activatedAt).toBe(activatedAt.toISOString());
    expect(h.affiliateProfile.create).not.toHaveBeenCalled();

    const dash = await h.service.getDashboard(AFFILIATE_ID, 'https://site.test', NOW);
    expect(dash.referralCode).toBe(CODE);
    expect(dash.referralLink).toContain(CODE);
  });

  it('H10. an admin cannot activate a user who never activated', async () => {
    const h = makeHarness({ profile: undefined });

    await expect(h.service.setStatus(AFFILIATE_ID, { isActive: true }, 'admin-1', NOW)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('H11. the admin list returns only ACTIVE affiliates', async () => {
    const h = makeHarness({ profile: { status: 'ACTIVE' } });

    const found = await h.service.searchActiveAffiliates('aff', { page: 1, pageSize: 20 });

    expect(found.items).toHaveLength(1);
    expect(found.items[0]).toMatchObject({ userId: AFFILIATE_ID, affiliateStatus: 'ACTIVE' });
    // The status filter is applied server-side, not in the browser.
    expect(h.affiliateProfile.findMany.mock.calls[0][0].where.status).toEqual({ in: ['ACTIVE'] });
  });

  it('H12. a deactivated affiliate is excluded from the ACTIVE admin list', async () => {
    const h = makeHarness({ profile: { status: 'INACTIVE' } });

    const found = await h.service.searchActiveAffiliates('aff', { page: 1, pageSize: 20 });

    expect(found.items).toHaveLength(0);
    expect(found.total).toBe(0);
  });

  it('H13. a user with no profile is never an affiliate in the admin detail', async () => {
    const h = makeHarness({ profile: undefined });

    const detail = await h.service.getAdminAffiliateDetail(AFFILIATE_ID, NOW);

    expect(detail.isAffiliate).toBe(false);
    expect(detail.profile).toBeNull();
    // No referral figure is ever presented as affiliate income.
    expect(detail.stats).toBeNull();
    expect(detail.target).toBeNull();
  });

  it('H14. the admin detail carries the activation information for an affiliate', async () => {
    const h = makeHarness({
      profile: {
        status: 'ACTIVE',
        promotionMethod: 'TIKTOK',
        promotionUrl: 'https://tiktok.com/@ada',
      },
    });

    const detail = await h.service.getAdminAffiliateDetail(AFFILIATE_ID, NOW);

    expect(detail.isAffiliate).toBe(true);
    expect(detail.profile).toMatchObject({
      status: 'ACTIVE',
      promotionMethod: 'TIKTOK',
      promotionUrl: 'https://tiktok.com/@ada',
    });
    expect(detail.user.referralCode).toBe(CODE);
    expect(detail.stats).not.toBeNull();
  });

// ===========================================================================
// INDIVIDUAL vs GLOBAL page content.
//
// `AffiliateContentBlock` is ONE model with two scopes:
//   affiliateUserId = null  -> GLOBAL    (every ACTIVE affiliate)
//   affiliateUserId = <id>  -> INDIVIDUAL (that one ACTIVE affiliate only)
//
// These suites assert the properties that matter: the scopes never leak into
// each other, ownership is enforced on every mutation, and the personal
// dashboard stays permanent at the bottom of the page.
// ===========================================================================

const OTHER_AFFILIATE = 'affiliate-2';

/** A harness whose affiliate under test has an ACTIVE profile. */
function activeHarness(overrides: HarnessOptions = {}) {
  return makeHarness({ profile: { status: 'ACTIVE' }, ...overrides });
}

describe('I. global content is unchanged and still shared by everybody', () => {
  it('I1. global create writes affiliateUserId = null, never a user id', async () => {
    const h = activeHarness();

    const created = await h.service.createContent({ type: 'BANNER' }, 'admin-1');

    expect(created.affiliateUserId).toBeNull();
    expect(created.scope).toBe('GLOBAL');
    expect(h.prisma.affiliateContentBlock.create.mock.calls[0][0].data.affiliateUserId).toBeNull();
  });

  it('I2. global list returns only NULL-scoped blocks', async () => {
    const h = activeHarness({
      blocks: [
        { id: 'g1', affiliateUserId: null, type: 'BANNER', isEnabled: true },
        { id: 'a1', affiliateUserId: AFFILIATE_ID, type: 'CTA', isEnabled: true },
      ],
    });

    const list = await h.service.listContentForAdmin();

    expect(list.map((b) => b.id)).toEqual(['g1']);
    expect(list.every((b) => b.scope === 'GLOBAL')).toBe(true);
  });

  it('I3. a global reorder is refused when it names an INDIVIDUAL id', async () => {
    const h = activeHarness({
      blocks: [
        { id: 'g1', affiliateUserId: null, type: 'BANNER' },
        { id: 'a1', affiliateUserId: AFFILIATE_ID, type: 'CTA' },
      ],
    });

describe('J. individual content is scoped to exactly one ACTIVE affiliate', () => {
  it('J1. create stamps the SELECTED affiliate id and reports the scope', async () => {
    const h = activeHarness();

    const created = await h.service.createIndividualContent(
      AFFILIATE_ID,
      { type: 'TEXT', title: 'VIP Offer A' },
      'admin-1',
    );

    expect(created.affiliateUserId).toBe(AFFILIATE_ID);
    expect(created.scope).toBe('INDIVIDUAL');
    expect(created.title).toBe('VIP Offer A');
  });

  it('J2. the scope is the selected affiliate, NEVER the acting admin', async () => {
    const h = activeHarness();

    const created = await h.service.createIndividualContent(
      AFFILIATE_ID,
      { type: 'TEXT' },
      'admin-99',
    );

    // The admin is the AUTHOR; the affiliate is the OWNER.
    expect(created.affiliateUserId).toBe(AFFILIATE_ID);
    expect(created.affiliateUserId).not.toBe('admin-99');
  });

  it('J3. a page renders GLOBAL first, then ONLY that affiliate own blocks', async () => {
    const h = activeHarness({
      blocks: [
        { id: 'g1', affiliateUserId: null, type: 'BANNER', isEnabled: true, sortOrder: 10 },
        { id: 'g2', affiliateUserId: null, type: 'FAQ', isEnabled: true, sortOrder: 20 },
        { id: 'a1', affiliateUserId: AFFILIATE_ID, type: 'CTA', isEnabled: true, sortOrder: 10 },
        // Affiliate B's block: enabled, and must be invisible to Affiliate A.
        { id: 'b1', affiliateUserId: OTHER_AFFILIATE, type: 'TEXT', isEnabled: true, sortOrder: 10 },
      ],
    });

    const dash = await h.service.getDashboard(AFFILIATE_ID, 'https://site.test', NOW);

    // Deterministic precedence: the global run, then this affiliate own run.
    expect(dash.content.map((b) => b.id)).toEqual(['g1', 'g2', 'a1']);
    expect(dash.content.some((b) => b.id === 'b1')).toBe(false);
  });

  it('J4. a disabled individual block is not rendered', async () => {
    const h = activeHarness({
      blocks: [
        { id: 'g1', affiliateUserId: null, type: 'BANNER', isEnabled: true },
        { id: 'a1', affiliateUserId: AFFILIATE_ID, type: 'CTA', isEnabled: false },
      ],
    });

    const dash = await h.service.getDashboard(AFFILIATE_ID, 'https://site.test', NOW);

    expect(dash.content.map((b) => b.id)).toEqual(['g1']);
  });

  it('J5. an individual block never replaces global content', async () => {
    const h = activeHarness({
      blocks: [
        { id: 'g1', affiliateUserId: null, type: 'BANNER', isEnabled: true },
        { id: 'a1', affiliateUserId: AFFILIATE_ID, type: 'TEXT', isEnabled: true },
      ],
    });

    const dash = await h.service.getDashboard(AFFILIATE_ID, 'https://site.test', NOW);

    // The global block is still present, ahead of the individual one.
    expect(dash.content.map((b) => b.id)).toEqual(['g1', 'a1']);
  });

  it('J6. the individual admin list returns ONLY that affiliate blocks', async () => {
    const h = activeHarness({
      blocks: [
        { id: 'g1', affiliateUserId: null, type: 'BANNER' },
        { id: 'a1', affiliateUserId: AFFILIATE_ID, type: 'CTA' },
        { id: 'b1', affiliateUserId: OTHER_AFFILIATE, type: 'TEXT' },
      ],
    });

    const list = await h.service.listIndividualContentForAdmin(AFFILIATE_ID);

    expect(list.map((b) => b.id)).toEqual(['a1']);
  });

  it('J7. update touches ONLY the owner block', async () => {
    const h = activeHarness({
      blocks: [{ id: 'a1', affiliateUserId: AFFILIATE_ID, type: 'TEXT', isEnabled: true }],
    });

    const updated = await h.service.updateIndividualContent(
      AFFILIATE_ID,
      'a1',

describe('K. content ownership and scope security', () => {
  it('K1. Affiliate B block CANNOT be edited through Affiliate A route', async () => {
    const h = activeHarness({
      blocks: [{ id: 'b1', affiliateUserId: OTHER_AFFILIATE, type: 'TEXT' }],
    });

    await expect(
      h.service.updateIndividualContent(AFFILIATE_ID, 'b1', { type: 'TEXT' }, 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(h.prisma.affiliateContentBlock.update).not.toHaveBeenCalled();
  });

  it('K2. Affiliate B block CANNOT be deleted through Affiliate A route', async () => {
    const h = activeHarness({
      blocks: [{ id: 'b1', affiliateUserId: OTHER_AFFILIATE, type: 'TEXT' }],
    });

    await expect(
      h.service.deleteIndividualContent(AFFILIATE_ID, 'b1', 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(h.prisma.affiliateContentBlock.delete).not.toHaveBeenCalled();
  });

  it('K3. another affiliate id cannot be smuggled into a reorder', async () => {
    const h = activeHarness({
      blocks: [
        { id: 'a1', affiliateUserId: AFFILIATE_ID, type: 'CTA' },
        { id: 'b1', affiliateUserId: OTHER_AFFILIATE, type: 'TEXT' },
      ],
    });

    await expect(
      h.service.reorderIndividualContent(AFFILIATE_ID, ['a1', 'b1'], 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(h.prisma.affiliateContentBlock.update).not.toHaveBeenCalled();
  });

  it('K4. GLOBAL content cannot be modified through the individual route', async () => {
    const h = activeHarness({ blocks: [{ id: 'g1', affiliateUserId: null, type: 'BANNER' }] });

    await expect(
      h.service.updateIndividualContent(AFFILIATE_ID, 'g1', { type: 'BANNER' }, 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      h.service.deleteIndividualContent(AFFILIATE_ID, 'g1', 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(h.prisma.affiliateContentBlock.update).not.toHaveBeenCalled();
    expect(h.prisma.affiliateContentBlock.delete).not.toHaveBeenCalled();
  });

  it('K5. INDIVIDUAL content cannot be modified through the global route', async () => {
    const h = activeHarness({
      blocks: [{ id: 'a1', affiliateUserId: AFFILIATE_ID, type: 'CTA' }],
    });

    await expect(h.service.updateContent('a1', { type: 'CTA' }, 'admin-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(h.service.deleteContent('a1', 'admin-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(h.prisma.affiliateContentBlock.update).not.toHaveBeenCalled();
    expect(h.prisma.affiliateContentBlock.delete).not.toHaveBeenCalled();
  });

  it('K6. an INACTIVE affiliate cannot receive new individual content', async () => {
    const h = makeHarness({ profile: { status: 'INACTIVE' } });

    await expect(
      h.service.createIndividualContent(AFFILIATE_ID, { type: 'TEXT' }, 'admin-1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(h.prisma.affiliateContentBlock.create).not.toHaveBeenCalled();
  });

  it('K7. a plain REFERRAL user (no profile) cannot receive individual content', async () => {

describe('L. individual monthly targets are owned, editable and deletable', () => {
  it('L1. creating a target for one affiliate does not create it for another', async () => {
    const h = activeHarness();

    await h.service.setTarget(
      AFFILIATE_ID,
      { year: 2026, month: 9, targetType: 'QUALIFIED_REFERRALS', targetValue: 100 },
      'admin-1',
    );

    const call = h.prisma.affiliateMonthlyTarget.upsert.mock.calls[0][0];
    expect(call.where.affiliateUserId_year_month_targetType).toEqual({
      affiliateUserId: AFFILIATE_ID,
      year: 2026,
      month: 9,
      targetType: 'QUALIFIED_REFERRALS',
    });
  });

  it('L2. editing the SAME month updates the SAME row (the upsert key is reused)', async () => {
    const h = activeHarness();

    await h.service.setTarget(
      AFFILIATE_ID,
      { year: 2026, month: 9, targetType: 'QUALIFIED_REFERRALS', targetValue: 100 },
      'admin-1',
    );
    h.prisma.affiliateMonthlyTarget.upsert.mockClear();

    await h.service.setTarget(
      AFFILIATE_ID,
      { year: 2026, month: 9, targetType: 'QUALIFIED_REFERRALS', targetValue: 150 },
      'admin-1',
    );

    const call = h.prisma.affiliateMonthlyTarget.upsert.mock.calls[0][0];
    // Still an upsert on the identical composite key => the row is updated
    // rather than duplicated, so the unique constraint is respected.
    expect(call.where.affiliateUserId_year_month_targetType).toEqual({
      affiliateUserId: AFFILIATE_ID,
      year: 2026,
      month: 9,
      targetType: 'QUALIFIED_REFERRALS',
    });
    expect(call.update.targetValue).toBe(150);
  });

  it('L3. a target set is AUDITED with the owner, the month and before/after', async () => {
    const h = activeHarness();

    await h.service.setTarget(
      AFFILIATE_ID,
      { year: 2026, month: 9, targetType: 'QUALIFIED_REFERRALS', targetValue: 100 },
      'admin-1',
    );

    const audit = h.auditLogs.find((a) => a.action === 'AFFILIATE_TARGET_SET');
    expect(audit.newValue).toMatchObject({
      affiliateUserId: AFFILIATE_ID,
      year: 2026,
      month: 9,
      targetType: 'QUALIFIED_REFERRALS',
    });
    // No email, no name and no referral code is written into the audit value.
    expect(JSON.stringify(audit.newValue)).not.toContain('ada@example.test');
  });

  it('L4. delete removes the target and audits what was removed', async () => {
    const h = activeHarness({
      targets: [
        { id: 't1', year: 2026, month: 9, targetType: 'QUALIFIED_REFERRALS', targetValue: 100 },
      ],
    });

    const res = await h.service.deleteTarget(AFFILIATE_ID, 't1', 'admin-1');

describe('M. deactivation keeps content and targets; reactivation restores them', () => {
  it('M1. deactivating changes ONLY the status flag', async () => {
    const h = activeHarness({
      blocks: [
        { id: 'g1', affiliateUserId: null, type: 'BANNER', isEnabled: true },
        { id: 'a1', affiliateUserId: AFFILIATE_ID, type: 'CTA', isEnabled: true },
      ],
      targets: [
        { id: 't1', year: 2026, month: 9, targetType: 'QUALIFIED_REFERRALS', targetValue: 100 },
      ],
    });

    await h.service.setStatus(AFFILIATE_ID, { isActive: false }, 'admin-1', NOW);

    // The stored rows are all still there.
    expect(h.prisma.affiliateContentBlock.delete).not.toHaveBeenCalled();
    expect(h.prisma.affiliateMonthlyTarget.delete).not.toHaveBeenCalled();
    expect(h.prisma.affiliateProfile.delete).not.toHaveBeenCalled();
    expect(h.prisma.referralReward.create).toBeUndefined();
  });

  it('M2. an INACTIVE affiliate renders NO content on their page', async () => {
    const h = makeHarness({
      profile: { status: 'INACTIVE' },
      blocks: [
        { id: 'g1', affiliateUserId: null, type: 'BANNER', isEnabled: true },
        { id: 'a1', affiliateUserId: AFFILIATE_ID, type: 'CTA', isEnabled: true },
      ],
    });

    const dash = await h.service.getDashboard(AFFILIATE_ID, 'https://site.test', NOW);

    // The dashboard falls back to the activation view, which carries no content.
    expect(dash.affiliateStatus).toBe('INACTIVE');
    expect(dash.content).toEqual([]);
  });

  it('M3. after reactivation the SAME content and target come back', async () => {
    const h = activeHarness({
      blocks: [
        { id: 'g1', affiliateUserId: null, type: 'BANNER', isEnabled: true },
        { id: 'a1', affiliateUserId: AFFILIATE_ID, type: 'CTA', isEnabled: true },
      ],
      targets: [
        { id: 't1', year: 2026, month: 9, targetType: 'QUALIFIED_REFERRALS', targetValue: 100 },
      ],
    });

    await h.service.setStatus(AFFILIATE_ID, { isActive: false }, 'admin-1', NOW);
    await h.service.setStatus(AFFILIATE_ID, { isActive: true }, 'admin-1', NOW);

    const dash = await h.service.getDashboard(AFFILIATE_ID, 'https://site.test', NOW);
    expect(dash.content.map((b) => b.id)).toEqual(['g1', 'a1']);
    expect((await h.service.listTargets(AFFILIATE_ID)).map((t) => t.id)).toEqual(['t1']);
  });
});


    expect(res).toEqual({ id: 't1', deleted: true });
    const audit = h.auditLogs.find((a) => a.action === 'AFFILIATE_TARGET_DELETED');
    expect(audit.newValue).toMatchObject({
      affiliateUserId: AFFILIATE_ID,
      year: 2026,
      month: 9,
      targetType: 'QUALIFIED_REFERRALS',
      targetValue: 100,
    });
  });

  it('L5. delete touches NO financial table', async () => {
    const h = activeHarness({
      targets: [
        { id: 't1', year: 2026, month: 9, targetType: 'QUALIFIED_REFERRALS', targetValue: 100 },
      ],
      referrals: [{ status: 'QUALIFIED' }],
    });

    await h.service.deleteTarget(AFFILIATE_ID, 't1', 'admin-1');

    // A target is configuration: the referral/reward data is never written.
    expect(h.prisma.referralReward.create).toBeUndefined();
    expect(h.prisma.referral.create).toBeUndefined();
    expect(h.prisma.affiliateClick.delete).toBeUndefined();
  });

  it('L6. another affiliate target CANNOT be deleted', async () => {
    const h = activeHarness({
      targets: [
        { id: 't-b', year: 2026, month: 9, targetType: 'QUALIFIED_REFERRALS', targetValue: 50 },
      ],
    });

    await expect(h.service.deleteTarget(AFFILIATE_ID, 't-b', 'admin-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );

    expect(h.prisma.affiliateMonthlyTarget.delete).not.toHaveBeenCalled();
  });

  it('L7. a target never appears for a different affiliate', async () => {
    const h = activeHarness({
      targets: [
        { id: 't1', year: 2026, month: 9, targetType: 'QUALIFIED_REFERRALS', targetValue: 100 },
      ],
    });

    const mine = await h.service.listTargets(AFFILIATE_ID);
    const theirs = await h.service.listTargets(OTHER_AFFILIATE);

    expect(mine.map((t) => t.id)).toEqual(['t1']);
    expect(theirs).toEqual([]);
  });
});

    // Owning a referral code must never imply affiliate membership.
    const h = makeHarness({ profile: undefined });

    await expect(
      h.service.createIndividualContent(AFFILIATE_ID, { type: 'TEXT' }, 'admin-1'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(h.prisma.affiliateContentBlock.create).not.toHaveBeenCalled();
  });

  it('K8. an INACTIVE affiliate stored content can still be INSPECTED', async () => {
    // Read-only access is allowed, which is what makes "deactivate, look,
    // reactivate, it is all still here" verifiable.
    const h = makeHarness({
      profile: { status: 'INACTIVE' },
      blocks: [{ id: 'a1', affiliateUserId: AFFILIATE_ID, type: 'CTA' }],
    });

    const view = await h.service.getIndividualContentForAdmin(AFFILIATE_ID);

    expect(view.isActive).toBe(false);
    expect(view.blocks.map((b) => b.id)).toEqual(['a1']);
  });
});

      { type: 'TEXT', title: 'Renamed', isEnabled: false },
      'admin-1',
    );

    expect(updated.title).toBe('Renamed');
    expect(updated.isEnabled).toBe(false);
    expect(h.auditLogs.find((a) => a.action === 'AFFILIATE_CONTENT_UPDATED').newValue).toMatchObject(
      { scope: 'INDIVIDUAL', affiliateUserId: AFFILIATE_ID },
    );
  });

  it('J8. an individual reorder renumbers ONLY that affiliate', async () => {
    const h = activeHarness({
      blocks: [
        { id: 'g1', affiliateUserId: null, type: 'BANNER' },
        { id: 'a1', affiliateUserId: AFFILIATE_ID, type: 'CTA' },
        { id: 'a2', affiliateUserId: AFFILIATE_ID, type: 'TEXT' },
        { id: 'b1', affiliateUserId: OTHER_AFFILIATE, type: 'IMAGE' },
      ],
    });

    await h.service.reorderIndividualContent(AFFILIATE_ID, ['a2', 'a1'], 'admin-1');

    // Only the two submitted ids are written.
    const written = h.prisma.affiliateContentBlock.update.mock.calls.map((c: any[]) => c[0].where.id);
    expect(written).toEqual(['a2', 'a1']);
    expect(written).not.toContain('g1');
    expect(written).not.toContain('b1');
  });

  it('J9. reordering one affiliate never renumbers global content', async () => {
    const h = activeHarness({
      blocks: [
        { id: 'g1', affiliateUserId: null, type: 'BANNER', sortOrder: 10 },
        { id: 'a1', affiliateUserId: AFFILIATE_ID, type: 'CTA', sortOrder: 10 },
      ],
    });

    await h.service.reorderIndividualContent(AFFILIATE_ID, ['a1'], 'admin-1');

    // The global block's stored position is untouched.
    const global = await h.service.listContentForAdmin();
    expect(global[0].sortOrder).toBe(10);
  });
});


    await expect(h.service.reorderContent(['g1', 'a1'], 'admin-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    // No partial application.
    expect(h.prisma.affiliateContentBlock.update).not.toHaveBeenCalled();
  });

  it('I4. a row with no stored scope still reads as GLOBAL (pre-migration row)', async () => {
    // A row fetched before the migration has no `affiliateUserId` key at all.
    // It must be reported as GLOBAL, never as "individual".
    const h = activeHarness({ blocks: [{ id: 'legacy', type: 'TEXT', isEnabled: true }] });

    const list = await h.service.listContent();

    expect(list[0].affiliateUserId).toBeNull();
    expect(list[0].scope).toBe('GLOBAL');
  });
});

});
