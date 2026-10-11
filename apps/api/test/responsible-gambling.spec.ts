/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * TANVION ROYALE — ResponsibleGamblingService tests (Task 2 / audit F3).
 *
 * Covers the change rules that matter for player protection:
 *   * lowering a limit is IMMEDIATE, raising it is delayed by the cooling-off;
 *   * self-excluding is IMMEDIATE, ending an exclusion is delayed;
 *   * a PERMANENT exclusion can NEVER be ended by the player;
 *   * period LOSS limits are enforced from the wallet ledger sums.
 *
 * Runs the REAL service against the in-memory Prisma double.
 */

import { HttpException } from '@nestjs/common';
import { ResponsibleGamblingService } from '../src/modules/responsible-gambling/responsible-gambling.service';
import { createInMemoryDb, type InMemoryDb } from './royale-helpers';

jest.setTimeout(30_000);

const UID = 'u-rg';
const HOUR = 3_600_000;

// Pin the cooling-off delay so assertions are deterministic regardless of env.
const PREV_COOLING = process.env.ROYALE_RG_COOLING_OFF_HOURS;
beforeAll(() => {
  process.env.ROYALE_RG_COOLING_OFF_HOURS = '24';
});
afterAll(() => {
  if (PREV_COOLING === undefined) delete process.env.ROYALE_RG_COOLING_OFF_HOURS;
  else process.env.ROYALE_RG_COOLING_OFF_HOURS = PREV_COOLING;
});

function makeRg(db: InMemoryDb): ResponsibleGamblingService {
  return new ResponsibleGamblingService(db as any);
}

function rgCode(err: unknown): { code?: string; status?: number } {
  if (!(err instanceof HttpException)) return {};
  const body = err.getResponse() as any;
  return { code: body?.code, status: err.getStatus() };
}

async function expectRejection(p: Promise<unknown>, code: string, status = 403): Promise<void> {
  try {
    await p;
    throw new Error(`expected rejection with ${code}`);
  } catch (err) {
    expect(rgCode(err)).toMatchObject({ code, status });
  }
}

const stakeInput = (amount: number) => ({
  kind: 'STAKE_PER_BET' as const,
  period: 'DAILY' as const,
  amount,
  currency: 'BDT',
});


describe('ResponsibleGambling — limits cool-off rules', () => {
  it('lowering a limit takes effect IMMEDIATELY', async () => {
    const db = createInMemoryDb();
    const rg = makeRg(db);
    const now = new Date();

    await rg.setLimit(UID, stakeInput(1_000), { now });
    const lowered = await rg.setLimit(UID, stakeInput(500), { now });
    expect(lowered.amount).toBe(500);
    expect(lowered.pendingAmount).toBeNull();

    await expectRejection(rg.assertCanStake(UID, 600, 'BDT', now), 'ROYALE_LIMIT_EXCEEDED');
    await expect(rg.assertCanStake(UID, 500, 'BDT', now)).resolves.toBeUndefined();
  });

  it('raising a limit only takes effect after the cooling-off delay', async () => {
    const db = createInMemoryDb();
    const rg = makeRg(db);
    const now = new Date();

    await rg.setLimit(UID, stakeInput(1_000), { now });
    const raised = await rg.setLimit(UID, stakeInput(5_000), { now });

    expect(raised.amount).toBe(1_000);
    expect(raised.pendingAmount).toBe(5_000);
    expect(raised.pendingEffectiveAt!.getTime()).toBe(now.getTime() + rg.coolingOffMs);

    await expectRejection(rg.assertCanStake(UID, 2_000, 'BDT', now), 'ROYALE_LIMIT_EXCEEDED');
    const later = new Date(now.getTime() + rg.coolingOffMs + 1_000);
    await expect(rg.assertCanStake(UID, 2_000, 'BDT', later)).resolves.toBeUndefined();
  });

  it('enforces a period LOSS limit from the wallet ledger sums', async () => {
    const db = createInMemoryDb();
    const rg = makeRg(db);
    const now = new Date();

    db.rows('walletTransaction').push({
      id: 'tx-1',
      userId: UID,
      type: 'BET_STAKE',
      status: 'COMPLETED',
      amount: -6_000,
      currency: 'BDT',
      idempotencyKey: 'k1',
      createdAt: new Date(now.getTime() - 1_000),
      updatedAt: new Date(now.getTime() - 1_000),
    });
    await rg.setLimit(
      UID,
      { kind: 'LOSS', period: 'DAILY', amount: 5_000, currency: 'BDT' },
      { now },
    );

    await expectRejection(rg.assertCanStake(UID, 100, 'BDT', now), 'ROYALE_LIMIT_EXCEEDED');
  });
});

describe('ResponsibleGambling — self-exclusion', () => {
  it('self-excluding is IMMEDIATE; ending it honours the cooling-off delay', async () => {
    const db = createInMemoryDb();
    const rg = makeRg(db);
    const now = new Date();

    const created = await rg.selfExclude(UID, { type: 'COOLING_OFF', durationHours: 48 }, { now });
    expect(await rg.isExcluded(UID, now)).not.toBeNull();
    await expectRejection(rg.assertCanStake(UID, 100, 'BDT', now), 'ROYALE_SELF_EXCLUDED');

    const ended = await rg.endExclusion(UID, created.id, { now });
    expect(ended.revokedAt!.getTime()).toBe(now.getTime() + rg.coolingOffMs);
    expect(await rg.isExcluded(UID, now)).not.toBeNull();

    const later = new Date(now.getTime() + rg.coolingOffMs + 1_000);
    expect(await rg.isExcluded(UID, later)).toBeNull();
    await expect(rg.assertCanStake(UID, 100, 'BDT', later)).resolves.toBeUndefined();
  });

  it('a PERMANENT exclusion can NEVER be ended by the player', async () => {
    const db = createInMemoryDb();
    const rg = makeRg(db);
    const now = new Date();

    const created = await rg.selfExclude(UID, { type: 'PERMANENT' }, { now });
    expect(created.endsAt).toBeNull();
    await expectRejection(rg.endExclusion(UID, created.id, { now }), 'ROYALE_EXCLUSION_PERMANENT');
    expect(await rg.isExcluded(UID, now)).not.toBeNull();
  });

  it('an admin override CAN lift even a permanent exclusion immediately', async () => {
    const db = createInMemoryDb();
    const rg = makeRg(db);
    const now = new Date();

    const created = await rg.selfExclude(UID, { type: 'PERMANENT' }, { now });
    await rg.adminRevokeExclusion(UID, created.id, { actorType: 'ADMIN', now });
    expect(await rg.isExcluded(UID, now)).toBeNull();
  });
});

describe('ResponsibleGambling — a clean account passes', () => {
  it('no exclusion and no limits -> assertCanStake resolves', async () => {
    const db = createInMemoryDb();
    const rg = makeRg(db);
    await expect(rg.assertCanStake(UID, 50_000, 'BDT')).resolves.toBeUndefined();
    expect(await rg.isExcluded(UID)).toBeNull();
  });
});
