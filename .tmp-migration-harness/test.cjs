'use strict';
/**
 * Scratch harness (NOT part of the app, mirrors .tmp-auth-retry/):
 * drives scripts/check-migration-state.cjs against FAKE database catalogs so
 * every CASE (A/B/C/D), the history verdicts, the report, the minimal
 * repair-SQL generation and the refusal logic are verified without touching a
 * real database. Also re-tests the verify-migrations.cjs pending-migration
 * patterns against every wording Prisma can print.
 *
 * Run: node .tmp-migration-harness/test.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert');
const Module = require('node:module');
const crypto = require('node:crypto');

const repoRoot = path.join(__dirname, '..');
const scriptPath = path.join(repoRoot, 'scripts', 'check-migration-state.cjs');
const verifyPath = path.join(repoRoot, 'scripts', 'verify-migrations.cjs');
const migrationSqlPath = path.join(
  repoRoot,
  'database',
  'prisma',
  'migrations',
  '20260914010000_add_support_chat',
  'migration.sql',
);
const fileChecksum = crypto.createHash('sha256').update(fs.readFileSync(migrationSqlPath)).digest('hex');

const MIGRATION = '20260914010000_add_support_chat';

// ---------------------------------------------------------------------------
// fake catalogs
// ---------------------------------------------------------------------------
const TICKET_COLUMNS = [
  ['id', 'text', 'NO', null],
  ['userId', 'text', 'NO', null],
  ['status', 'SupportTicketStatus', 'NO', `'OPEN'::"SupportTicketStatus"`],
  ['assignedAdminId', 'text', 'YES', null],
  ['adminUnreadCount', 'int4', 'NO', '0'],
  ['userUnreadCount', 'int4', 'NO', '0'],
  ['lastMessageAt', 'timestamp', 'NO', 'CURRENT_TIMESTAMP'],
  ['createdAt', 'timestamp', 'NO', 'CURRENT_TIMESTAMP'],
  ['updatedAt', 'timestamp', 'NO', null],
];
const MESSAGE_COLUMNS = [
  ['id', 'text', 'NO', null],
  ['ticketId', 'text', 'NO', null],
  ['authorUserId', 'text', 'NO', null],
  ['authorRole', 'SupportMessageAuthorRole', 'NO', null],
  ['body', 'text', 'NO', null],
  ['clientRef', 'text', 'YES', null],
  ['createdAt', 'timestamp', 'NO', 'CURRENT_TIMESTAMP'],
];

const columnsOf = (table, defs) =>
  defs.map(([column_name, udt_name, is_nullable, column_default]) => ({
    table_name: table,
    column_name,
    udt_name,
    is_nullable,
    column_default,
  }));
const attributesOf = (table, defs) =>
  defs.map(([attname], i) => ({ table_name: table, attnum: i + 1, attname }));
const indexRow = (table_name, index_name, indkey, extra = {}) => ({
  index_name,
  table_name,
  is_unique: false,
  is_primary: false,
  indkey,
  ...extra,
});

const NOTIFICATION_TYPE = [
  'DEPOSIT_APPROVED', 'DEPOSIT_REJECTED', 'WITHDRAWAL_APPROVED', 'WITHDRAWAL_REJECTED',
  'WITHDRAWAL_COMPLETED', 'BET_WON', 'BET_LOST', 'NEW_DEPOSIT_REQUEST',
  'NEW_WITHDRAWAL_REQUEST', 'NEW_USER_REGISTRATION', 'SECURITY_ALERT',
  'SYSTEM_ANNOUNCEMENT', 'PROMOTION', 'GENERAL',
];
const NOTIFICATION_TYPE_WITH_SUPPORT = [...NOTIFICATION_TYPE, 'SUPPORT_MESSAGE', 'SUPPORT_REPLY'];

function enumRows(notificationLabels, withNewTypes = true) {
  const rows = [];
  const push = (typname, labels) =>
    labels.forEach((enumlabel, i) => rows.push({ typname, enumlabel, enumsortorder: i + 1 }));
  if (withNewTypes) {
    push('SupportTicketStatus', ['OPEN', 'IN_PROGRESS', 'WAITING_FOR_USER', 'RESOLVED', 'CLOSED']);
    push('SupportMessageAuthorRole', ['USER', 'ADMIN']);
  }
  push('NotificationType', notificationLabels);
  return rows;
}
const enumTypes = (names) => names.map((typname) => ({ typname }));

/** Catalog where BOTH chat tables fully match migration.sql. */
const FULL_TABLES = {
  tableNames: ['SupportMessage', 'SupportTicket'],
  columns: [...columnsOf('SupportTicket', TICKET_COLUMNS), ...columnsOf('SupportMessage', MESSAGE_COLUMNS)],
  attributes: [
    ...attributesOf('SupportTicket', TICKET_COLUMNS),
    ...attributesOf('SupportMessage', MESSAGE_COLUMNS),
  ],
  indexRows: [
    indexRow('SupportTicket', 'SupportTicket_pkey', '1', { is_primary: true, is_unique: true }),
    indexRow('SupportTicket', 'SupportTicket_userId_updatedAt_idx', '2 9'),
    indexRow('SupportTicket', 'SupportTicket_status_lastMessageAt_idx', '3 7'),
    indexRow('SupportTicket', 'SupportTicket_assignedAdminId_idx', '4'),
    indexRow('SupportMessage', 'SupportMessage_pkey', '1', { is_primary: true, is_unique: true }),
    indexRow('SupportMessage', 'SupportMessage_ticketId_createdAt_idx', '2 7'),
    indexRow('SupportMessage', 'SupportMessage_authorUserId_idx', '3'),
    indexRow('SupportMessage', 'SupportMessage_ticketId_clientRef_key', '2 6', { is_unique: true }),
  ],
  fks: [
    { conname: 'SupportTicket_userId_fkey', table_name: 'SupportTicket', ref_table: 'User', confdeltype: 'c' },
    { conname: 'SupportTicket_assignedAdminId_fkey', table_name: 'SupportTicket', ref_table: 'User', confdeltype: 'n' },
    { conname: 'SupportMessage_ticketId_fkey', table_name: 'SupportMessage', ref_table: 'SupportTicket', confdeltype: 'c' },
    { conname: 'SupportMessage_authorUserId_fkey', table_name: 'SupportMessage', ref_table: 'User', confdeltype: 'r' },
  ],
  rowCounts: { SupportTicket: 0, SupportMessage: 0 },
};

/** Catalog with only SupportTicket (CASE C partial). */
const TICKET_ONLY = {
  tableNames: ['SupportTicket'],
  columns: columnsOf('SupportTicket', TICKET_COLUMNS),
  attributes: attributesOf('SupportTicket', TICKET_COLUMNS),
  indexRows: [
    indexRow('SupportTicket', 'SupportTicket_pkey', '1', { is_primary: true, is_unique: true }),
    indexRow('SupportTicket', 'SupportTicket_userId_updatedAt_idx', '2 9'),
    indexRow('SupportTicket', 'SupportTicket_status_lastMessageAt_idx', '3 7'),
    indexRow('SupportTicket', 'SupportTicket_assignedAdminId_idx', '4'),
  ],
  fks: [
    { conname: 'SupportTicket_userId_fkey', table_name: 'SupportTicket', ref_table: 'User', confdeltype: 'c' },
    { conname: 'SupportTicket_assignedAdminId_fkey', table_name: 'SupportTicket', ref_table: 'User', confdeltype: 'n' },
  ],
  rowCounts: { SupportTicket: 0 },
};

const EMPTY = {
  tableNames: [],
  columns: [],
  attributes: [],
  indexRows: [],
  fks: [],
  rowCounts: {},
};

/** 18 older applied migrations — ours is NOT among them. */
const HISTORY_WITHOUT_OURS = Array.from({ length: 18 }, (_, i) => ({
  id: `11111111-2222-3333-4444-${String(i).padStart(12, '0')}`,
  checksum: `checksum-${i}`,
  migration_name: `2026010100000${i % 10}_seed_${i}`,
  started_at: new Date(2026, 0, i + 1),
  finished_at: new Date(2026, 0, i + 1),
  rolled_back_at: null,
  applied_steps_count: 1,
}));

const ourRow = (overrides = {}) => ({
  id: 'e0d4c4d2-4a3f-4d7a-9f4c-3f5b9a7c1e21',
  checksum: fileChecksum,
  migration_name: MIGRATION,
  started_at: new Date(2026, 8, 14),
  finished_at: new Date(2026, 8, 14),
  rolled_back_at: null,
  applied_steps_count: 1,
  ...overrides,
});

// ---------------------------------------------------------------------------
// run scripts/check-migration-state.cjs against a fake catalog
// ---------------------------------------------------------------------------
function dispatch(sql, db) {
  const s = sql.replace(/\s+/g, ' ');
  if (s.includes('information_schema.tables')) return db.tableNames.map((table_name) => ({ table_name }));
  if (s.includes('information_schema.columns')) return db.columns;
  if (s.includes('pg_attribute')) return db.attributes;
  if (s.includes('pg_index')) return db.indexRows;
  if (s.includes('con.contype')) return db.fks;
  if (s.includes('pg_enum')) return db.enumRows;
  if (s.includes('typname IN')) return db.enumTypeRows;
  if (s.includes('COUNT(*)::int')) {
    const m = /FROM "([A-Za-z]+)"/.exec(sql);
    return [{ n: (db.rowCounts || {})[m[1]] ?? 0 }];
  }
  if (s.includes('_prisma_migrations')) {
    if (db.migrationsError) throw new Error(db.migrationsError);
    return db.migrations ?? [];
  }
  throw new Error(`harness: unexpected SQL -> ${s}`);
}

function makeFakeClient(db) {
  return class FakePrismaClient {
    async $queryRawUnsafe(sql) {
      return dispatch(sql, db);
    }
    async $disconnect() {}
  };
}

/** Build a fake production catalog. */
function catalog({
  tables = EMPTY,
  notification = NOTIFICATION_TYPE,
  newEnums = true,
  migrations = HISTORY_WITHOUT_OURS,
  migrationsError = null,
} = {}) {
  return {
    ...EMPTY,
    ...tables,
    enumRows: enumRows(notification, newEnums),
    enumTypeRows: enumTypes(newEnums ? ['SupportTicketStatus', 'SupportMessageAuthorRole'] : []),
    migrations,
    migrationsError,
  };
}

async function runScript(db, args = []) {
  const origLoad = Module._load;
  const origLog = console.log;
  const origErr = console.error;
  const out = [];
  const errs = [];

  Module._load = function (request) {
    if (typeof request === 'string' && request.replace(/\\/g, '/').endsWith('/generated/prisma')) {
      return { PrismaClient: makeFakeClient(db) };
    }
    return origLoad.apply(this, arguments);
  };
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => errs.push(a.join(' '));
  process.env.DATABASE_URL = 'postgresql://harness:harness@ep-fake.neon.tech/neondb';
  delete process.env.DIRECT_URL;
  process.argv = [process.execPath, scriptPath, ...args];
  process.exitCode = 0;

  try {
    delete require.cache[require.resolve(scriptPath)];
    require(scriptPath); // fires main() immediately
    await new Promise((resolve) => setTimeout(resolve, 150));
    return { code: process.exitCode, out: out.join('\n'), err: errs.join('\n') };
  } finally {
    Module._load = origLoad;
    console.log = origLog;
    console.error = origErr;
    delete require.cache[require.resolve(scriptPath)];
    delete process.env.DATABASE_URL;
  }
}

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`PASS  ${name}`);
  } else {
    console.error(`FAIL  ${name}${detail ? ` -> ${detail}` : ''}`);
    failures += 1;
  }
}

// ---------------------------------------------------------------------------
// verify-migrations.cjs must flag every wording Prisma can print
// ---------------------------------------------------------------------------
function testPendingPatterns() {
  const src = fs.readFileSync(verifyPath, 'utf8');
  const block = /const hasPending = ([\s\S]*?);\s*\n/.exec(src);
  if (!block) {
    check('verify-migrations: hasPending block found', false);
    return;
  }
  const literals = [...block[1].matchAll(/(\/[^/\n]+\/[a-z]*)/g)].map((m) => m[1]);
  const pendingSamples = [
    'Following migration have not yet been applied:\n20260914010000_add_support_chat',
    'Following migration has not yet been applied:\n20260914010000_add_support_chat',
    'Following migrations have not yet been applied:\n2026a\n2026b',
    'Following migrations has not yet been applied:\n2026a',
    '1 migration have not yet been applied:',
    '2 migrations have not yet been applied:',
  ];
  for (const sample of pendingSamples) {
    // eslint-disable-next-line no-eval
    const matched = literals.some((literal) => eval(literal).test(sample));
    check(`verify-migrations flags ${JSON.stringify(sample.split('\n')[0])}`, matched);
  }
  const upToDate = 'Database schema is up to date!';
  // eslint-disable-next-line no-eval
  const falsePositive = literals.some((literal) => eval(literal).test(upToDate));
  check('verify-migrations does not flag the up-to-date output', !falsePositive);
}

// ---------------------------------------------------------------------------
// scenarios
// ---------------------------------------------------------------------------
async function main() {
  const caseA = await runScript(catalog({ newEnums: false }), ['--json']);
  check(
    'CASE A: unapplied -> A_UNAPPLIED (exit 2)',
    caseA.code === 2 && caseA.out.includes('"code": "A_UNAPPLIED"'),
    `code=${caseA.code}`,
  );
  const caseAReport = await runScript(catalog({ newEnums: false }));
  check(
    'CASE A report: both tables ABSENT + no history row',
    /SupportTicket\s+ABSENT/.test(caseAReport.out) &&
      /SupportMessage\s+ABSENT/.test(caseAReport.out) &&
      /row for migration\s+NONE/.test(caseAReport.out),
  );
  check(
    'CASE A: --print-repair-sql refuses (must use migrate deploy)',
    (await runScript(catalog({ newEnums: false }), ['--print-repair-sql'])).err.includes('not applicable for A_UNAPPLIED'),
  );
  check(
    'CASE A: --repair refuses to touch _prisma_migrations',
    (await runScript(catalog({ newEnums: false }), ['--repair'])).err.includes('REFUSING to touch _prisma_migrations'),
  );

  const caseB = await runScript(
    catalog({ tables: FULL_TABLES, notification: NOTIFICATION_TYPE_WITH_SUPPORT }),
    ['--json'],
  );
  check(
    'CASE B: schema present, history missing -> B_HISTORY_MISSING_SCHEMA_MATCHES (exit 2)',
    caseB.code === 2 && caseB.out.includes('B_HISTORY_MISSING_SCHEMA_MATCHES'),
    `code=${caseB.code}`,
  );
  check('CASE B: schemaComplete true', caseB.out.includes('"schemaComplete": true'));

  const partial = await runScript(
    catalog({ tables: TICKET_ONLY, notification: NOTIFICATION_TYPE_WITH_SUPPORT }),
    ['--print-repair-sql'],
  );
  const partialSql = partial.out.split('-- Support Chat migration repair')[1] ?? '';
  check(
    'CASE C: only SupportTicket -> C_PARTIAL',
    partial.out.includes('C_PARTIAL') && partial.code === 2,
    `code=${partial.code}`,
  );
  check(
    'CASE C repair SQL: creates ONLY SupportMessage (+ its indexes/FKs)',
    partialSql.includes('CREATE TABLE "SupportMessage"') &&
      partialSql.includes('SupportMessage_ticketId_clientRef_key') &&
      !partialSql.includes('CREATE TABLE "SupportTicket"') &&
      !partialSql.includes('ALTER TYPE'),
    partialSql.slice(0, 400),
  );
  console.log('--- CASE C generated repair SQL (actual) ---');
  console.log(partialSql.trim());
  console.log('--- end CASE C SQL ---');

  const enumsOnly = await runScript(
    catalog({ tables: EMPTY, notification: NOTIFICATION_TYPE_WITH_SUPPORT }),
    ['--print-repair-sql'],
  );
  const enumsOnlySql = enumsOnly.out.split('-- Support Chat migration repair')[1] ?? '';
  check(
    'CASE D: enums present, no tables -> D_ENUMS_ONLY',
    enumsOnly.out.includes('D_ENUMS_ONLY'),
    `code=${enumsOnly.code}`,
  );
  check(
    'CASE D repair SQL: tables added, enum values NOT added twice',
    enumsOnlySql.includes('CREATE TABLE "SupportTicket"') &&
      enumsOnlySql.includes('CREATE TABLE "SupportMessage"') &&
      !enumsOnlySql.includes('ALTER TYPE') &&
      !enumsOnlySql.includes('CREATE TYPE'),
    enumsOnlySql.slice(0, 300),
  );

  const inSync = await runScript(catalog({ tables: FULL_TABLES, notification: NOTIFICATION_TYPE_WITH_SUPPORT, migrations: [...HISTORY_WITHOUT_OURS, ourRow()] }));
  check(
    'IN SYNC: history row + matching schema/checksum -> exit 0',
    inSync.code === 0 && inSync.out.includes('IN_SYNC'),
    `code=${inSync.code}`,
  );

  const checksumDrift = await runScript(
    catalog({
      tables: FULL_TABLES,
      notification: NOTIFICATION_TYPE_WITH_SUPPORT,
      migrations: [...HISTORY_WITHOUT_OURS, ourRow({ checksum: 'deadbeef' })],
    }),
  );
  check('HISTORY_CHECKSUM_MISMATCH detected', checksumDrift.out.includes('HISTORY_CHECKSUM_MISMATCH'));
  check('HISTORY_CHECKSUM_MISMATCH reports checksum NO', /checksum matches file\s+NO/.test(checksumDrift.out));

  const failed = await runScript(
    catalog({
      tables: EMPTY,
      newEnums: false,
      migrations: [...HISTORY_WITHOUT_OURS, ourRow({ finished_at: null, applied_steps_count: 0 })],
    }),
  );
  check('HISTORY_FAILED detected (P3009 territory)', failed.out.includes('HISTORY_FAILED'));

  const inconsistent = await runScript(
    catalog({ tables: EMPTY, migrations: [...HISTORY_WITHOUT_OURS, ourRow()] }),
  );
  check(
    'HISTORY_APPLIED_SCHEMA_INCONSISTENT detected',
    inconsistent.out.includes('HISTORY_APPLIED_SCHEMA_INCONSISTENT'),
  );

  testPendingPatterns();

  console.log('');
  console.log(failures === 0 ? 'ALL SCENARIOS PASSED' : `${failures} SCENARIO(S) FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main();