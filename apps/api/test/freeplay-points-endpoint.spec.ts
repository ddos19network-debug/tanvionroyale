/**
 * Free-play points balance endpoint.
 *
 * GET /games/crash/free-play/points is the ONLY way the frontend may read
 * free-play points. These tests run the REAL CrashFreePlayWalletService (not a
 * mock) against the shared in-memory Prisma double, so they prove the endpoint
 * actually returns the ledger value rather than a fabricated one.
 *
 * The safety property under test is the separation between demo points and
 * real money: points live in `CrashFreePlayWallet` (currency FREEPLAY), never
 * in the real `Wallet`, and the response must always be flagged FREE_PLAY so a
 * client cannot render it as a cash balance.
 */
import { CrashController } from '../src/modules/crash/crash.controller';
import { CrashFreePlayWalletService } from '../src/modules/crash/crash-freeplay-wallet.service';
import { CrashService } from '../src/modules/crash/crash.service';
import { CRASH_FREE_PLAY_CURRENCY } from '../src/modules/crash/crash.types';
import { createInMemoryDb, seedUser, type InMemoryDb } from './royale-helpers';

const USER_ID = 'user-freeplay-points';

interface Harness {
  controller: CrashController;
  db: InMemoryDb;
}

function buildHarness(seed: { points?: number } = {}): Harness {
  const db = createInMemoryDb();

  // Account must exist for the free-play ledger to attach to.
  seedUser(db, USER_ID);

  if (typeof seed.points === 'number') {
    db.rows('crashFreePlayWallet').push({
      id: 'fpw-1',
      userId: USER_ID,
      balance: seed.points,
      currency: CRASH_FREE_PLAY_CURRENCY,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  const freePlayWallet = new CrashFreePlayWalletService(
    db as unknown as ConstructorParameters<typeof CrashFreePlayWalletService>[0],
  );

  const controller = new CrashController(
    {} as unknown as CrashService,
    freePlayWallet,
  );

  return { controller, db };
}

describe('GET /games/crash/free-play/points', () => {
  it('returns the ledger balance for the signed-in user', async () => {
    const { controller } = buildHarness({ points: 12_345 });

    const view = await controller.getFreePlayPoints({ id: USER_ID } as never);

    expect(view.points).toBe(12_345);
  });

  it('reports free-play points in their own FREEPLAY currency, never a money code', async () => {
    const { controller } = buildHarness({ points: 500 });

    const view = await controller.getFreePlayPoints({ id: USER_ID } as never);

    // A money code (BDT/USD/EUR) here would read as real funds.
    expect(view.currency).toBe('FREEPLAY');
    expect(view.currency).not.toBe('BDT');
    expect(view.currency).not.toBe('USD');
    expect(view.currency).not.toBe('EUR');
  });

  it('is explicitly flagged FREE_PLAY so a client cannot render it as a cash balance', async () => {
    const { controller } = buildHarness({ points: 1 });

    const view = await controller.getFreePlayPoints({ id: USER_ID } as never);

    expect(view.mode).toBe('FREE_PLAY');
  });

  it('creates the wallet on first read instead of reporting a misleading zero', async () => {
    // No seeded wallet row: the endpoint must provision one (with the
    // configured starting points) rather than answer 0.
    const { controller, db } = buildHarness();

    const view = await controller.getFreePlayPoints({ id: USER_ID } as never);

    expect(view.points).toBeGreaterThan(0);
    expect(db.rows('crashFreePlayWallet')).toHaveLength(1);
  });

  it('is idempotent — a repeated read creates no second wallet and no duplicate credit', async () => {
    const { controller, db } = buildHarness();

    const first = await controller.getFreePlayPoints({ id: USER_ID } as never);
    const second = await controller.getFreePlayPoints({ id: USER_ID } as never);

    expect(second.points).toBe(first.points);
    expect(db.rows('crashFreePlayWallet')).toHaveLength(1);

    // The append-only ledger holds exactly the one signup credit.
    const credits = db
      .rows('crashFreePlayTransaction')
      .filter((t: any) => t.idempotencyKey === `signup:${USER_ID}`);
    expect(credits).toHaveLength(1);
  });

  it('does not create or touch any real wallet row', async () => {
    const { controller, db } = buildHarness({ points: 99 });

    await controller.getFreePlayPoints({ id: USER_ID } as never);

    // Free-play points and real money are separate ledgers: reading points
    // must never provision a real Wallet.
    expect(db.rows('wallet')).toHaveLength(0);
  });

  it('reflects a debit performed through the points ledger', async () => {
    const db = createInMemoryDb();
    seedUser(db, USER_ID);

    const freePlayWallet = new CrashFreePlayWalletService(
      db as unknown as ConstructorParameters<typeof CrashFreePlayWalletService>[0],
    );

    await freePlayWallet.getOrCreateWallet(USER_ID);
    const before = await freePlayWallet.getBalance(USER_ID);

    await freePlayWallet.debit(USER_ID, 1_500, 'stake:1', {
      type: 'ROYALE_ACE',
      id: 'round-1',
    });

    const controller = new CrashController(
      {} as unknown as CrashService,
      freePlayWallet,
    );

    const view = await controller.getFreePlayPoints({ id: USER_ID } as never);

    expect(view.points).toBe(before - 1_500);
  });

  it('never returns a negative balance after an overdraw attempt', async () => {
    const db = createInMemoryDb();
    seedUser(db, USER_ID);

    const freePlayWallet = new CrashFreePlayWalletService(
      db as unknown as ConstructorParameters<typeof CrashFreePlayWalletService>[0],
    );

    await freePlayWallet.getOrCreateWallet(USER_ID);
    const before = await freePlayWallet.getBalance(USER_ID);

    // Try to stake more than the ledger holds.
    await expect(
      freePlayWallet.debit(USER_ID, before + 1, 'stake:overdraw', {
        type: 'ROYALE_ACE',
        id: 'round-x',
      }),
    ).rejects.toBeDefined();

    const controller = new CrashController(
      {} as unknown as CrashService,
      freePlayWallet,
    );

    const view = await controller.getFreePlayPoints({ id: USER_ID } as never);

    expect(view.points).toBe(before);
    expect(view.points).toBeGreaterThanOrEqual(0);
  });

  it('replays a duplicate stake idempotently (no double debit)', async () => {
    const db = createInMemoryDb();
    seedUser(db, USER_ID);

    const freePlayWallet = new CrashFreePlayWalletService(
      db as unknown as ConstructorParameters<typeof CrashFreePlayWalletService>[0],
    );

    await freePlayWallet.getOrCreateWallet(USER_ID);
    const before = await freePlayWallet.getBalance(USER_ID);

    await freePlayWallet.debit(USER_ID, 700, 'stake:dup', {
      type: 'ROYALE_ACE',
      id: 'round-dup',
    });
    // Same idempotency key retried (network retry / double submit).
    await freePlayWallet.debit(USER_ID, 700, 'stake:dup', {
      type: 'ROYALE_ACE',
      id: 'round-dup',
    });

    const controller = new CrashController(
      {} as unknown as CrashService,
      freePlayWallet,
    );

    const view = await controller.getFreePlayPoints({ id: USER_ID } as never);

    expect(view.points).toBe(before - 700);
  });
});
