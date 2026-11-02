/**
 * Seeds (or resets) ONE local FREE-PLAY test user — no real funds, ever.
 *
 * The account is a plain CUSTOMER with status ACTIVE and an 18+ date of birth.
 * Its bankroll is a CrashFreePlayWallet row (currency FREEPLAY, points only):
 * the SAME free-play points ledger the Royale games and crash already share.
 * No real Wallet row is created or touched — free-play points are not money.
 *
 * Idempotent: re-running resets the free-play balance back to the configured
 * start and leaves every other table untouched. Refuses to run in production.
 *
 * Usage (from apps/api): npx ts-node ../../database/scripts/seed-freeplay-user.ts
 * Or:                    pnpm freeplay-seed
 *
 * Default credentials (LOCAL DEV ONLY — never use anywhere real):
 *   email:    freeplay@test.local
 *   username: freeplaytester
 *   password: FreePlay123!
 */
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { PrismaClient } from '../../apps/api/src/generated/prisma/index.js';

/**
 * argon2 is an apps/api dependency (pnpm isolates it under apps/api's
 * node_modules). Resolve it exactly the way apps/api itself does so the hash
 * this script writes verifies against the auth service's argon2.verify.
 *
 * Works under ts-node's CommonJS output (__dirname defined) AND under Node
 * ≥22.18 native type-stripping ESM (no __dirname — fall back to cwd, which is
 * apps/api when run via `pnpm freeplay-seed`).
 */
const requireBase =
  typeof __dirname !== 'undefined' ? path.join(__dirname, '..', '..', 'apps', 'api') : process.cwd();
const requireFromApi = createRequire(path.join(requireBase, 'package.json'));
const argon2 = requireFromApi('argon2') as {
  hash(password: string, options: { type: number }): Promise<string>;
  argon2id: number;
};

const FREEPLAY_EMAIL = 'freeplay@test.local';
const FREEPLAY_USERNAME = 'freeplaytester';
const FREEPLAY_PASSWORD = 'FreePlay123!';
/** Starting bankroll in FREE-PLAY points (never money). */
const FREEPLAY_START_POINTS = 100_000;

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed a test user against production.');
  process.exit(1);
}

const prisma = new PrismaClient();

export async function seedFreePlayTestUser(client: PrismaClient): Promise<string> {
  const passwordHash = await argon2.hash(FREEPLAY_PASSWORD, { type: argon2.argon2id });

  // Adult by a wide margin; FREE_PLAY never checks KYC, but keep the row honest.
  const dateOfBirth = new Date('2000-01-01T00:00:00.000Z');

  const user = await client.user.upsert({
    where: { email: FREEPLAY_EMAIL },
    update: {
      status: 'ACTIVE',
      emailVerified: true,
      emailVerifiedAt: new Date(),
      dateOfBirth,
      // Never downgrade a password the developer may have changed locally.
    },
    create: {
      email: FREEPLAY_EMAIL,
      username: FREEPLAY_USERNAME,
      passwordHash,
      passwordSetAt: new Date(),
      firstName: 'Free',
      lastName: 'Play',
      dateOfBirth,
      country: 'BD',
      timezone: 'UTC',
      status: 'ACTIVE',
      accountType: 'CUSTOMER',
      emailVerified: true,
      emailVerifiedAt: new Date(),
    },
  });

  // Attach the USER role when the RBAC seed has already run (best-effort).
  const userRole = await client.role.findUnique({ where: { name: 'USER' } });
  if (userRole) {
    await client.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: userRole.id } },
      update: {},
      create: { userId: user.id, roleId: userRole.id },
    });
  }

  // FREE-PLAY points wallet (separate table from the real Wallet — by design).
  const existing = await client.crashFreePlayWallet.findUnique({ where: { userId: user.id } });
  let walletId: string;
  if (existing) {
    const delta = FREEPLAY_START_POINTS - existing.balance;
    if (delta !== 0) {
      await client.$transaction([
        client.crashFreePlayWallet.update({
          where: { userId: user.id },
          data: { balance: FREEPLAY_START_POINTS },
        }),
        client.crashFreePlayTransaction.create({
          data: {
            walletId: existing.id,
            userId: user.id,
            type: 'ADJUSTMENT',
            amount: delta,
            balanceBefore: existing.balance,
            balanceAfter: FREEPLAY_START_POINTS,
            referenceType: 'SYSTEM',
            referenceId: null,
            idempotencyKey: `seed:freeplay-reset:${user.id}:${Date.now()}`,
          },
        }),
      ]);
    }
    walletId = existing.id;
  } else {
    const created = await client.crashFreePlayWallet.create({
      data: {
        userId: user.id,
        balance: FREEPLAY_START_POINTS,
        currency: 'FREEPLAY',
      },
    });
    walletId = created.id;
    // Mirror the service's signup credit so the append-only ledger is complete.
    await client.crashFreePlayTransaction.create({
      data: {
        walletId,
        userId: user.id,
        type: 'SIGNUP_CREDIT',
        amount: FREEPLAY_START_POINTS,
        balanceBefore: 0,
        balanceAfter: FREEPLAY_START_POINTS,
        referenceType: 'SYSTEM',
        referenceId: null,
        idempotencyKey: `signup:${user.id}`,
      },
    });
  }

  return user.id;
}

async function main(): Promise<void> {
  const userId = await seedFreePlayTestUser(prisma);
  console.log('FREE-PLAY test user ready (no real funds):');
  console.log(`  user id:  ${userId}`);
  console.log(`  email:    ${FREEPLAY_EMAIL}`);
  console.log(`  username: ${FREEPLAY_USERNAME}`);
  console.log(`  password: ${FREEPLAY_PASSWORD}`);
  console.log(`  balance:  ${FREEPLAY_START_POINTS} FREEPLAY points`);
}

main()
  .catch((error) => {
    console.error('Free-play seed failed:', error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());