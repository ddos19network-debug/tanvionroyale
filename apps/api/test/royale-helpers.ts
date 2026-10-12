/**
 * In-memory Prisma double for Royale Play settlement/concurrency tests.
 *
 * Runs the REAL WalletService, CrashFreePlayWalletService, RoyalePlinkoService
 * and RoyaleMinesService against plain arrays with:
 *   - unique-constraint enforcement (throws Prisma P2002, exactly like PG);
 *   - conditional updateMany (the wallet's exactly-once status guard);
 *   - $transaction(fn) SNAPSHOT/ROLLBACK semantics (a thrown error restores
 *     every table, matching the real database transaction);
 *   - $queryRaw no-ops for SELECT ... FOR UPDATE / advisory locks (single-
 *     process tests rely on the services' conditional guards instead).
 *
 * This is a TEST DOUBLE, not a database: it models only the model APIs these
 * services actually call.
 */
import { randomUUID } from 'node:crypto';
import { Prisma } from '../src/generated/prisma';

type Row = Record<string, any>;

interface TableDef {
  /** Unique constraints as column lists (plus the primary key). */
  uniques: string[][];
  defaults: () => Row;
}

const now = (): Date => new Date();

const DEFS: Record<string, TableDef> = {
  wallet: {
    uniques: [['id'], ['userId', 'currency']],
    defaults: () => ({
      id: randomUUID(),
      // Mirror the Prisma schema @default(0): service-created wallets start
      // empty. Pre-funded TEST wallets are seeded via a direct row push (which
      // bypasses these defaults), so assertions stay in full control.
      availableBalance: 0,
      lockedBalance: 0,
      status: 'ACTIVE',
      createdAt: now(),
      updatedAt: now(),
    }),
  },
  walletTransaction: {
    uniques: [['id'], ['userId', 'idempotencyKey']],
    defaults: () => ({
      id: randomUUID(),
      reference: null,
      failureReason: null,
      createdAt: now(),
      updatedAt: now(),
    }),
  },
  ledgerEntry: {
    uniques: [['id']],
    defaults: () => ({ id: randomUUID(), createdAt: now() }),
  },
  auditLog: { uniques: [['id']], defaults: () => ({ id: randomUUID(), createdAt: now() }) },
  gameAuditLog: {
    uniques: [['id']],
    defaults: () => ({ id: randomUUID(), metadata: null, ip: null, createdAt: now() }),
  },
  crashFreePlayWallet: {
    uniques: [['id'], ['userId']],
    defaults: () => ({
      id: randomUUID(),
      balance: 100_000,
      currency: 'FREEPLAY',
      createdAt: now(),
      updatedAt: now(),
    }),
  },
  crashFreePlayTransaction: {
    uniques: [['id'], ['userId', 'idempotencyKey']],
    defaults: () => ({ id: randomUUID(), referenceId: null, createdAt: now() }),
  },
  royalePlinkoRound: {
    uniques: [['id'], ['userId', 'idempotencyKey']],
    defaults: () => ({
      id: randomUUID(),
      transactionId: null,
      createdAt: now(),
      settledAt: now(),
    }),
  },
  royaleMinesRound: {
    uniques: [['id'], ['userId', 'idempotencyKey']],
    defaults: () => ({
      id: randomUUID(),
      mode: 'FREE_PLAY',
      status: 'ACTIVE',
      revealed: [],
      minesRevealed: [],
      currentMultiplierBp: 10_000,
      payout: null,
      serverSeed: null,
      transactionId: null,
      settledAt: null,
      createdAt: now(),
      updatedAt: now(),
    }),
  },
  royaleSettlement: {
    uniques: [['id'], ['userId', 'idempotencyKey']],
    defaults: () => ({
      id: randomUUID(),
      multiplierBp: null,
      transactionId: null,
      createdAt: now(),
    }),
  },
  // Responsible gambling (Task 2 / audit F3). The Royale REAL_MONEY eligibility
  // gate reads these; the double must model them so exclusion/limit checks run
  // against real rows instead of being skipped.
  selfExclusion: {
    uniques: [['id']],
    defaults: () => ({
      id: randomUUID(),
      startsAt: now(),
      endsAt: null,
      reason: null,
      revokedAt: null,
      createdAt: now(),
    }),
  },
  playLimit: {
    uniques: [['id'], ['userId', 'kind', 'period']],
    defaults: () => ({
      id: randomUUID(),
      pendingAmount: null,
      pendingEffectiveAt: null,
      effectiveFrom: now(),
      createdAt: now(),
      updatedAt: now(),
    }),
  },
  // WalletService.assertCustomerWalletAccount reads accountType to refuse new
  // customer wallets for STAFF accounts — the double must model it.
  user: {
    uniques: [['id']],
    defaults: () => ({ id: randomUUID(), accountType: 'CUSTOMER' }),
  },
  // Royale Ace (royale-ace): one row per settled round, keyed by idempotency so
  // a retried spin is exactly-once.
  royaleAceRound: {
    uniques: [['id'], ['userId', 'idempotencyKey']],
    defaults: () => ({
      id: randomUUID(),
      mode: 'FREE_PLAY',
      status: 'SETTLED',
      payout: null,
      maxMultiplierBp: 10_000,
      capped: false,
      serverSeed: null,
      transactionId: null,
      settledAt: now(),
      createdAt: now(),
    }),
  },
  // Versioned game config (immutable; one ACTIVE at a time).
  royaleAceConfigVersion: {
    uniques: [['id'], ['version']],
    defaults: () => ({
      id: 1,
      status: 'DRAFT',
      name: '',
      validationErrors: null,
      activatedAt: null,
      activatedById: null,
      createdAt: now(),
    }),
  },
  // Stored math provenance for a config version.
  royaleAceSimulationReport: {
    uniques: [['id']],
    defaults: () => ({ id: randomUUID(), passed: false, notes: null, createdAt: now() }),
  },
  // PART A — central jurisdiction & currency control. The eligibility gate
  // reads these; the double must model them so the checks run against real
  // rows instead of being skipped.
  jurisdictionRule: {
    uniques: [['id'], ['countryCode']],
    defaults: () => ({
      id: randomUUID(),
      allowedCurrencies: [],
      licenceRef: null,
      effectiveFrom: now(),
      updatedByAdminId: null,
      createdAt: now(),
      updatedAt: now(),
    }),
  },
  // Append-only: the double only ever `create`s rows here (never update/delete).
  jurisdictionAuditLog: {
    uniques: [['id']],
    defaults: () => ({
      id: randomUUID(),
      oldStatus: null,
      newStatus: null,
      oldCurrencies: [],
      newCurrencies: [],
      oldLicenceRef: null,
      newLicenceRef: null,
      createdAt: now(),
    }),
  },
  // Real-money kill switches (REAL_MONEY_ALL / GAME:<slug>). No row == no kill
  // switch engaged, exactly like the service.
  globalGameSwitch: {
    uniques: [['id'], ['key']],
    defaults: () => ({
      id: randomUUID(),
      enabled: true,
      reason: null,
      updatedByAdminId: null,
      createdAt: now(),
      updatedAt: now(),
    }),
  },
};

function scalarEqual(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function matchesCondition(row: Row, key: string, cond: unknown): boolean {
  if (cond === undefined) return true;
  if (cond !== null && typeof cond === 'object' && !(cond instanceof Date) && !Array.isArray(cond)) {
    const obj = cond as Record<string, unknown>;
    if ('in' in obj) return (obj.in as unknown[]).some((v) => scalarEqual(row[key], v));
    if ('startsWith' in obj) {
      const value = row[key];
      return typeof value === 'string' && value.startsWith(String(obj.startsWith));
    }
    if ('not' in obj) {
      if (obj.not === null) return row[key] !== null && row[key] !== undefined;
      return !scalarEqual(row[key], obj.not);
    }
    // Compound unique key: { userId, idempotencyKey } style.
    return Object.entries(obj).every(([k, v]) => scalarEqual(row[k], v));
  }
  return scalarEqual(row[key], cond);
}

function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => matchesCondition(row, k, v));
}

function applyOrder(rows: Row[], orderBy: Record<string, 'asc' | 'desc'> | undefined): Row[] {
  if (!orderBy) return rows;
  const [field, dir] = Object.entries(orderBy)[0] ?? [];
  if (!field) return rows;
  return [...rows].sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    const at = av instanceof Date ? av.getTime() : (av as number);
    const bt = bv instanceof Date ? bv.getTime() : (bv as number);
    if (at < bt) return dir === 'desc' ? 1 : -1;
    if (at > bt) return dir === 'desc' ? -1 : 1;
    return 0;
  });
}

function pick(row: Row, select: Record<string, unknown> | undefined): Row {
  if (!select) return { ...row };
  const out: Row = {};
  for (const [k, v] of Object.entries(select)) if (v) out[k] = row[k];
  return out;
}

function p2002(): never {
  throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

export class InMemoryDb {
  private readonly stores: Record<string, Row[]> = {};

  constructor() {
    for (const name of Object.keys(DEFS)) this.stores[name] = [];
  }

  /** Direct row access for assertions. */
  rows(name: string): Row[] {
    return this.stores[name];
  }

  private delegate(name: string) {
    const def = DEFS[name];
    if (!def) throw new Error(`InMemoryDb: unknown model ${name}`);
    const table = (): Row[] => this.stores[name];
    const assertUniques = (candidate: Row): void => {
      for (const cols of def.uniques) {
        const clash = table().find((row) => cols.every((c) => scalarEqual(row[c], candidate[c])));
        if (clash) p2002();
      }
    };
    return {
      findUnique: async (args: { where: Record<string, unknown> }) =>
        table().find((row) => matches(row, args.where)) ?? null,
      findUniqueOrThrow: async (args: { where: Record<string, unknown> }) => {
        const row = table().find((r) => matches(r, args.where));
        if (!row) throw new Error(`InMemoryDb: ${name} row not found`);
        return row;
      },
      findFirst: async (args: {
        where?: Record<string, unknown>;
        orderBy?: Record<string, 'asc' | 'desc'>;
      }) => (applyOrder(table().filter((r) => matches(r, args.where)), args.orderBy)[0] ?? null),
      findMany: async (args: {
        where?: Record<string, unknown>;
        orderBy?: Record<string, 'asc' | 'desc'>;
        take?: number;
        select?: Record<string, unknown>;
      }) => {
        let rows = applyOrder(table().filter((r) => matches(r, args.where)), args.orderBy);
        if (args.take !== undefined) rows = rows.slice(0, args.take);
        return rows.map((r) => pick(r, args.select));
      },
      count: async (args: { where?: Record<string, unknown> } = {}) =>
        table().filter((r) => matches(r, args.where)).length,
      create: async (args: { data: Record<string, unknown> }): Promise<Row> => {
        const row: Row = { ...def.defaults(), ...structuredClone(args.data) };
        assertUniques(row);
        table().push(row);
        return { ...row };
      },
      update: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const rowsArr = table();
        const idx = rowsArr.findIndex((r) => matches(r, args.where));
        if (idx === -1) throw new Error(`InMemoryDb: ${name}.update target not found`);
        const candidate: Row = { ...rowsArr[idx], ...structuredClone(args.data) };
        for (const cols of def.uniques) {
          const clash = rowsArr.find(
            (r, i) => i !== idx && cols.every((c) => scalarEqual(r[c], candidate[c])),
          );
          if (clash) p2002();
        }
        Object.assign(rowsArr[idx], structuredClone(args.data));
        return { ...rowsArr[idx] };
      },
      upsert: async (args: {
        where: Record<string, unknown>;
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const rowsArr = table();
        const idx = rowsArr.findIndex((r) => matches(r, args.where));
        if (idx !== -1) {
          const candidate: Row = { ...rowsArr[idx], ...structuredClone(args.update) };
          for (const cols of def.uniques) {
            const clash = rowsArr.find(
              (r, i) => i !== idx && cols.every((c) => scalarEqual(r[c], candidate[c])),
            );
            if (clash) p2002();
          }
          Object.assign(rowsArr[idx], structuredClone(args.update));
          return { ...rowsArr[idx] };
        }
        const row: Row = { ...def.defaults(), ...structuredClone(args.create) };
        assertUniques(row);
        table().push(row);
        return { ...row };
      },
      updateMany: async (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const rowsArr = table();
        let count = 0;
        for (let i = 0; i < rowsArr.length; i += 1) {
          if (matches(rowsArr[i], args.where)) {
            Object.assign(rowsArr[i], structuredClone(args.data));
            count += 1;
          }
        }
        return { count };
      },
      delete: async (args: { where: Record<string, unknown> }) => {
        const rowsArr = table();
        const idx = rowsArr.findIndex((r) => matches(r, args.where));
        if (idx === -1) throw new Error(`InMemoryDb: ${name}.delete target not found`);
        const [removed] = rowsArr.splice(idx, 1);
        return { ...removed };
      },
    };
  }

  /**
   * Snapshot/ROLLBACK transaction: every table is deep-cloned, the callback
   * runs against a PROXY VIEW of this instance (so `db.royaleMinesRound` etc.
   * resolve to model delegates exactly like the root client), and on ANY throw
   * every table is restored — matching a real DB transaction. A committed
   * transaction simply keeps its writes.
   */
  async $transaction<T>(fn: (db: unknown) => Promise<T>): Promise<T> {
    const snapshot: Record<string, Row[]> = {};
    for (const name of Object.keys(this.stores)) snapshot[name] = structuredClone(this.stores[name]);
    try {
      return await fn(new Proxy(this, PROXY_HANDLER));
    } catch (error) {
      for (const name of Object.keys(this.stores)) this.stores[name] = snapshot[name];
      throw error;
    }
  }

  /**
   * No-op raw SQL. Single-process tests rely on the services' conditional
   * (status-guarded) updates + unique constraints for exactly-once, not on real
   * row locks — but SELECT ... FOR UPDATE must report a locked row exists.
   */
  async $queryRaw(_query?: unknown, ..._values: unknown[]): Promise<unknown> {
    return [{ id: 'locked' }];
  }

  async $executeRaw(_query?: unknown, ..._values: unknown[]): Promise<number> {
    return 1;
  }
}

const PROXY_HANDLER: ProxyHandler<InMemoryDb> = {
  get(target, prop, receiver) {
    if (typeof prop === 'string' && prop in DEFS) {
      // Expose model delegates (wallet, royaleMinesRound, ...) lazily.
      return (target as unknown as { delegate(n: string): unknown }).delegate(prop);
    }
    return Reflect.get(target, prop, receiver);
  },
};

/**
 * Factory: returns an InMemoryDb wrapped in a Proxy so `db.royaleMinesRound`
 * and friends resolve to model delegates, while methods (`$transaction`,
 * `$queryRaw`, `rows`) still work. Cast to the services' expected Prisma types
 * at the call site — this is a test double, not a real database.
 *
 * BASELINE FIXTURE: the fresh double ships with ONE jurisdiction rule —
 * `BD` ALLOWED for `BDT`/`USD` — so REAL_MONEY settlement tests exercise money
 * behaviour instead of tripping the (otherwise default-BLOCKED) jurisdiction
 * gate. Jurisdiction tests that need the default posture simply delete this
 * row (`db.rows('jurisdictionRule').length = 0`) or override `countryCode`.
 * It is a FIXTURE, never a bypass: no other country is allowed, and every
 * other gate (switches, KYC, age, RG, account status) still runs.
 */
export function createInMemoryDb(): InMemoryDb {
  const db = new InMemoryDb();
  db.rows('jurisdictionRule').push({
    id: randomUUID(),
    countryCode: 'BD',
    status: 'ALLOWED',
    allowedCurrencies: ['BDT', 'USD'],
    licenceRef: 'TEST-FIXTURE',
    reason: 'Baseline fixture: BD allowed for BDT/USD',
    effectiveFrom: new Date(Date.now() - 86_400_000),
    updatedByAdminId: 'fixture',
    createdAt: now(),
    updatedAt: now(),
  });
  return new Proxy(db, PROXY_HANDLER);
}

/**
 * Seed a customer user row so WalletService.assertCustomerWalletAccount passes
 * (it reads user.accountType before creating a wallet). STAFF rows can be
 * seeded here too to prove the guard refuses new staff wallets.
 *
 * The seeded user is FULLY REAL_MONEY-eligible by default (ACTIVE status,
 * VERIFIED KYC, an adult date of birth, `country: 'BD'` matching the baseline
 * jurisdiction fixture, no exclusion, no limits) so existing settlement/ledger
 * tests keep exercising money behaviour. Tests that target a specific
 * eligibility rejection pass `overrides` to make the user ineligible.
 */
export function seedUser(
  db: InMemoryDb,
  id: string,
  accountType: 'CUSTOMER' | 'STAFF' = 'CUSTOMER',
  overrides: Record<string, unknown> = {},
): void {
  db.rows('user').push({
    id,
    accountType,
    status: 'ACTIVE',
    kycStatus: 'VERIFIED',
    dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
    // KYC country (server-stored) — the jurisdiction gate cross-checks it
    // against the trusted edge geo header.
    country: 'BD',
    ...overrides,
  });
}
