#!/usr/bin/env node
/**
 * Offline harness for scripts/diagnose-referral-migration.cjs.
 *
 * Emulates the PRODUCTION state that the 2026-09-26 P3009 incident left behind:
 * the migration is recorded as FAILED and NONE of the objects it creates exist
 * (the UTF-8 BOM made PostgreSQL reject the batched script before statement 0).
 *
 * There is no Postgres and no Docker on this machine, so the generated Prisma
 * client is replaced in require.cache by a stub that answers catalog queries and
 * THROWS the exact Prisma error PostgreSQL would raise for a missing relation or
 * column. That is the whole point: a diagnostic tool that dies on the very state
 * it exists to diagnose is useless.
 *
 * Usage: node apps/api/test/fixtures/referral-diagnostic-harness.cjs [--scenario=x] [--json]
 * Scenarios: nothing (the real incident) | partial | applied | rolledback |
 *            drift (no row, objects exist) | incomplete (objects ok, backfill not)
 * Exit 0 = the script produced a full verdict; 1 = it aborted with an ERROR.
 *
 * The harness also prints every SQL the diagnostic executes to stderr prefixed
 * with "[sql] " so the spec can assert the tool is SELECT-only, and uses a
 * connection URL with a distinctive password so the spec can assert the URL is
 * never echoed.
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

// This file lives in apps/api/test/fixtures/, so the repo root is found by
// walking up to the directory that owns the migration history.
const root = (() => {
  let dir = __dirname;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'database', 'prisma', 'migrations'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('could not locate repo root from ' + __dirname);
})();
const clientEntry = require.resolve(path.join(root, 'apps', 'api', 'src', 'generated', 'prisma'));

// Which production state to emulate. The incident state is `nothing`; the rest
// guard the other verdict branches against regression.
const scenarioArg = process.argv.find((a) => a.startsWith('--scenario='));
const SCENARIO = scenarioArg ? scenarioArg.split('=')[1] : 'nothing';
const SCENARIOS = ['nothing', 'applied', 'partial', 'rolledback', 'drift', 'incomplete'];
if (!SCENARIOS.includes(SCENARIO)) {
  console.error(`unknown scenario "${SCENARIO}" (use one of: ${SCENARIOS.join(', ')})`);
  process.exit(2);
}

// The file on disk is BOM-free; production recorded a checksum of the BOM'd
// revision, which is exactly how you can tell the file changed after the attempt.
const currentSha = crypto
  .createHash('sha256')
  .update(fs.readFileSync(path.join(root, 'database', 'prisma', 'migrations', '20260926000000_add_user_referral_program', 'migration.sql')))
  .digest('hex');

const FAILED_ROW = {
  migration_name: '20260926000000_add_user_referral_program',
  started_at: new Date('2026-09-26T10:27:02.154039Z'),
  finished_at: null,
  rolled_back_at: null,
  applied_steps_count: 0,
  logs: 'Error: syntax error at or near "\uFEFF--"\nDETAIL: The token was not valid for this state.',
  checksum: 'f'.repeat(64),
};

const HISTORY = [
  { migration_name: '20260830000000_add_sports_games', started_at: new Date('2026-08-30T00:00:00Z'), finished_at: new Date('2026-08-30T00:00:10Z'), rolled_back_at: null, applied_steps_count: 1 },
  { migration_name: '20260925000002_add_bigbang_game_provider_sandbox_columns', started_at: new Date('2026-09-25T00:00:00Z'), finished_at: new Date('2026-09-25T00:00:10Z'), rolled_back_at: null, applied_steps_count: 1 },
  FAILED_ROW,
];

// ---------------------------------------------------------------------------
// Catalogue fixtures per scenario
// ---------------------------------------------------------------------------
const ALL_ENUMS = [
  ['ReferralStatus', ['PENDING', 'QUALIFIED', 'REJECTED', 'CANCELLED']],
  ['ReferralRewardRecipient', ['REFERRER', 'REFERRED']],
  ['ReferralBonusType', ['FIXED_AMOUNT', 'PERCENTAGE']],
  ['ReferralQualificationRule', ['REGISTRATION', 'VERIFIED_ACCOUNT', 'MIN_DEPOSIT', 'MIN_WAGER', 'DEPOSIT_AND_WAGER']],
  ['ReferralRewardStatus', ['PENDING', 'QUALIFIED', 'PAID', 'REJECTED', 'CANCELLED']],
];
const ADDED_VALUES = [
  ['WalletTransactionType', 'REFERRAL_BONUS'],
  ['NotificationType', 'REFERRAL_JOINED'],
  ['NotificationType', 'REFERRAL_QUALIFIED'],
  ['NotificationType', 'REFERRAL_BONUS_CREDITED'],
];
const ALL_INDEXES = [
  'User_referralCode_key', 'Referral_referredUserId_key', 'Referral_referrerUserId_createdAt_idx',
  'Referral_status_createdAt_idx', 'Referral_referralCode_idx', 'ReferralEvent_eventKey_key',
  'ReferralEvent_referralId_kind_idx', 'ReferralReward_eventKey_key',
  'ReferralReward_userId_status_createdAt_idx', 'ReferralReward_referralId_idx',
  'ReferralProgramSettings_isEnabled_idx',
];
const ALL_FKS = [
  'Referral_referrerUserId_fkey', 'Referral_referredUserId_fkey', 'ReferralEvent_referralId_fkey',
  'ReferralReward_referralId_fkey', 'ReferralReward_userId_fkey',
];
const ALL_TABLES = ['Referral', 'ReferralEvent', 'ReferralReward', 'ReferralProgramSettings'];

// Columns per table, extracted from migration.sql at harness start so the
// fixture cannot drift away from the real file.
const EXPECTED_COLUMNS = (() => {
  const sql = fs.readFileSync(
    path.join(root, 'database', 'prisma', 'migrations', '20260926000000_add_user_referral_program', 'migration.sql'),
    'utf8',
  );
  const out = {};
  for (const m of sql.matchAll(/CREATE TABLE "(\w+)" \(([\s\S]*?)\);/g)) {
    out[m[1]] = m[2]
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^"/.test(l) && !/^CONSTRAINT/.test(l))
      .map((l) => /^"([^"]+)"/.exec(l)[1]);
  }
  return out;
})();

// Enum labels that ALREADY EXIST in production before this migration. The
// diagnostic must never count these as "referral objects present" — the old
// bug that would have misclassified the real incident as FAILED_PARTIAL.
const PREEXISTING_ENUM_ROWS = [
  { typname: 'WalletTransactionType', enumlabel: 'DEPOSIT' },
  { typname: 'WalletTransactionType', enumlabel: 'WITHDRAWAL' },
  { typname: 'NotificationType', enumlabel: 'NEW_MESSAGE' },
];

function tableRows(names) {
  return names.map((table_name) => ({ table_name }));
}
function columnRows(names) {
  return names.flatMap((t) => (EXPECTED_COLUMNS[t] ?? []).map((column_name) => ({ table_name: t, column_name })));
}
// Primary-key constraint names for the tables the migration creates.
function pkRows(tableNames) {
  return tableNames.map((t) => ({ conname: `${t}_pkey` }));
}

function fixtures() {
  if (SCENARIO === 'nothing') {
    // The real incident: failed before statement 0, so NOTHING of ours exists.
    // Pre-existing enums ARE returned, exactly like the production catalog.
    return {
      tables: [],
      columns: [],
      pks: [],
      enumRows: PREEXISTING_ENUM_ROWS,
      indexes: [],
      fks: [],
      hasColumn: false,
      settingsTable: false,
      settings: [],
      users: null,
    };
  }
  if (SCENARIO === 'partial') {
    // The dangerous case. The report MUST say SOME, never ALL.
    const present = ALL_TABLES.slice(0, 2);
    return {
      tables: tableRows(present),
      columns: columnRows(present),
      pks: pkRows(present),
      enumRows: [
        ...PREEXISTING_ENUM_ROWS,
        ...ALL_ENUMS[0][1].map((enumlabel) => ({ typname: ALL_ENUMS[0][0], enumlabel })),
      ],
      indexes: [{ indexname: 'Referral_referralCode_idx' }],
      fks: [{ conname: 'Referral_referrerUserId_fkey' }],
      hasColumn: true,
      settingsTable: false,
      settings: [],
      users: { total: 412, with_code: 12, without_code: 400 },
    };
  }
  if (SCENARIO === 'drift') {
    // CASE D: every object exists but _prisma_migrations has NO row for it.
    return {
      tables: tableRows(ALL_TABLES),
      columns: columnRows(ALL_TABLES),
      pks: pkRows(ALL_TABLES),
      enumRows: [
        ...PREEXISTING_ENUM_ROWS,
        ...[...ALL_ENUMS, ...ADDED_VALUES.map(([t, v]) => [t, [v]])].flatMap(([typname, vals]) =>
          vals.map((enumlabel) => ({ typname, enumlabel })),
        ),
      ],
      indexes: ALL_INDEXES.map((indexname) => ({ indexname })),
      fks: ALL_FKS.map((conname) => ({ conname })),
      hasColumn: true,
      settingsTable: true,
      settings: [{ id: 1, isEnabled: false }],
      users: { total: 412, with_code: 412, without_code: 0 },
    };
  }
  if (SCENARIO === 'incomplete') {
    // CASE C negation: every DDL object exists, but the backfill never finished.
    // `--applied` here would seal an incomplete backfill forever -> fail closed.
    return {
      tables: tableRows(ALL_TABLES),
      columns: columnRows(ALL_TABLES),
      pks: pkRows(ALL_TABLES),
      enumRows: [
        ...PREEXISTING_ENUM_ROWS,
        ...[...ALL_ENUMS, ...ADDED_VALUES.map(([t, v]) => [t, [v]])].flatMap(([typname, vals]) =>
          vals.map((enumlabel) => ({ typname, enumlabel })),
        ),
      ],
      indexes: ALL_INDEXES.map((indexname) => ({ indexname })),
      fks: ALL_FKS.map((conname) => ({ conname })),
      hasColumn: true,
      settingsTable: true,
      settings: [{ id: 1, isEnabled: false }],
      users: { total: 412, with_code: 400, without_code: 12 },
    };
  }
  if (SCENARIO === 'rolledback') {
    // The case-A recovery state: operator already ran `resolve --rolled-back`,
    // which does NOT touch any object — nothing was ever created, so none exist.
    return {
      tables: [],
      columns: [],
      pks: [],
      enumRows: PREEXISTING_ENUM_ROWS,
      indexes: [],
      fks: [],
      hasColumn: false,
      settingsTable: false,
      settings: [],
      users: null,
    };
  }
  // `applied` = FAILED row, but every object and the data are fully in place.
  return {
    tables: tableRows(ALL_TABLES),
    columns: columnRows(ALL_TABLES),
    pks: pkRows(ALL_TABLES),
    enumRows: [
      ...PREEXISTING_ENUM_ROWS,
      ...[...ALL_ENUMS, ...ADDED_VALUES.map(([t, v]) => [t, [v]])].flatMap(([typname, vals]) =>
        vals.map((enumlabel) => ({ typname, enumlabel })),
      ),
    ],
    indexes: ALL_INDEXES.map((indexname) => ({ indexname })),
    fks: ALL_FKS.map((conname) => ({ conname })),
    hasColumn: true,
    settingsTable: true,
    settings: [{ id: 1, isEnabled: false }],
    users: { total: 412, with_code: 412, without_code: 0 },
  };
}

const fx = fixtures();

/** Prisma's error shape for a missing table/column. */
function prismaError(code, message) {
  const e = new Error(message);
  e.code = code;
  e.clientVersion = '5.22.0';
  return e;
}

class FakePrismaClient {
  constructor() {
    this.executed = [];
  }

  async $queryRawUnsafe(sql) {
    const s = sql.replace(/\s+/g, ' ').trim();
    this.executed.push(s);
    // Logged so the spec can prove the diagnostic is SELECT-only.
    console.error(`[sql] ${s}`);

    if (s.includes('FROM "_prisma_migrations"') && s.includes('WHERE migration_name =')) {
      if (SCENARIO === 'drift') return []; // no history row, but objects exist
      return SCENARIO === 'rolledback'
        ? [{ ...FAILED_ROW, rolled_back_at: new Date('2026-09-26T11:00:00Z') }]
        : [FAILED_ROW];
    }
    if (s.includes('FROM "_prisma_migrations"')) {
      if (SCENARIO === 'drift') return HISTORY.filter((h) => h.migration_name !== FAILED_ROW.migration_name);
      if (SCENARIO === 'rolledback') {
        return HISTORY.map((h) =>
          h.migration_name === FAILED_ROW.migration_name ? { ...h, rolled_back_at: new Date('2026-09-26T11:00:00Z') } : h,
        );
      }
      return HISTORY;
    }
    if (s.includes('information_schema.tables')) return fx.tables;
    if (s.includes('pg_enum')) return fx.enumRows;
    if (s.includes('FROM pg_indexes')) return fx.indexes;
    // PK probe: `contype = 'p'`; FK probe: `contype = 'f'`.
    if (s.includes('FROM pg_constraint') && s.includes("contype = 'p'")) return fx.pks;
    if (s.includes('FROM pg_constraint')) return fx.fks;
    if (s.includes('information_schema.columns') && s.includes("'referralCode'")) {
      // The dedicated User.referralCode existence probe (SELECT 1 ...).
      return fx.hasColumn ? [{ '1': 1 }] : [];
    }
    if (s.includes('information_schema.columns')) {
      // The per-table column inventory for the four referral tables.
      return fx.columns;
    }

    // PostgreSQL 42703: the column this migration adds does not exist.
    if (s.includes('FROM "User"') && s.includes('referralCode')) {
      if (!fx.hasColumn) throw prismaError('P2021', 'column "User"."referralCode" does not exist');
      return s.includes('GROUP BY') ? [] : [fx.users];
    }
    // PostgreSQL 42P01: the tables this migration creates do not exist.
    if (s.includes('"ReferralProgramSettings"')) {
      if (!fx.settingsTable) throw prismaError('P2021', 'relation "public"."ReferralProgramSettings" does not exist');
      return fx.settings;
    }
    throw new Error('UNSTUBBED QUERY: ' + s.slice(0, 200));
  }

  async $disconnect() {}
}

require.cache[clientEntry] = {
  id: clientEntry,
  filename: clientEntry,
  loaded: true,
  exports: { PrismaClient: FakePrismaClient },
};

// Distinctive credentials: the spec asserts this exact string NEVER appears in
// stdout/stderr, proving the tool prints the host only.
process.env.DATABASE_URL =
  'postgresql://refdiag:Zx9-NEVER-PRINT-THIS-PASSWORD@ep-super-cake-b3sxq4rp-pooler.c-4.ap-southeast-1.aws.neon.tech/neondb';

// Strip harness-only flags so the script under test sees its own CLI contract.
process.argv = process.argv.filter((a) => !a.startsWith('--scenario='));

console.error(`[harness] emulating scenario "${SCENARIO}"\n`);
require(path.join(root, 'scripts', 'diagnose-referral-migration.cjs'));
