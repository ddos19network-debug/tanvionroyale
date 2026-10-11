/**
 * Schema <-> migrations drift guard (regression test).
 *
 * Root cause of the production 500 on GET /admin/payment-methods: the schema
 * declared models/enums that NO migration ever created, so a database built
 * from the migration history was missing them and every query on them failed
 * with Prisma P2021/P2022 -> HTTP 500.
 *
 * This test parses database/prisma/schema.prisma and every migration.sql and
 * FAILS whenever a model/enum/enum-value exists in the schema but has no DDL
 * in the migration history — so the drift can never silently return.
 *
 * Pure static analysis: no database, no network, no secrets.
 */
import * as fs from 'fs';
import * as path from 'path';

interface SchemaField {
  type: string;
  isList: boolean;
  rest: string;
}

function parseSchema(): {
  models: Map<string, Map<string, SchemaField>>;
  enums: Map<string, Set<string>>;
} {
  const schemaPath = path.join(__dirname, '..', '..', '..', 'database', 'prisma', 'schema.prisma');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  const models = new Map<string, Map<string, SchemaField>>();
  const enums = new Map<string, Set<string>>();

  let ctx: { kind: 'model' | 'enum'; name: string } | null = null;
  for (const raw of schema.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith('model ')) {
      const name = line.split(/\s+/)[1];
      models.set(name, new Map());
      ctx = { kind: 'model', name };
      continue;
    }
    if (line.startsWith('enum ')) {
      const name = line.split(/\s+/)[1];
      enums.set(name, new Set());
      ctx = { kind: 'enum', name };
      continue;
    }
    if (line === '}') {
      ctx = null;
      continue;
    }
    if (!ctx || line.startsWith('//') || line.startsWith('@@')) continue;
    if (ctx.kind === 'enum') {
      if (/^[A-Z_][A-Z0-9_]*$/.test(line)) enums.get(ctx.name)?.add(line);
      continue;
    }
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*(\[\])?)(.*)$/);
    if (m) {
      const [, fName, fType, , restRaw] = m;
      const rest = restRaw ?? '';
      (models.get(ctx.name) as Map<string, SchemaField>).set(fName, {
        type: fType.replace('?', ''),
        isList: fType.endsWith('[]'),
        rest,
      });
    }
  }
  return { models, enums };
}

function parseMigrations(): {
  tables: Map<string, Set<string>>;
  enums: Map<string, Set<string>>;
} {
  const migrationsRoot = path.join(__dirname, '..', '..', '..', 'database', 'prisma', 'migrations');
  const tables = new Map<string, Set<string>>();
  const enums = new Map<string, Set<string>>();

  for (const dir of fs.readdirSync(migrationsRoot)) {
    const sqlPath = path.join(migrationsRoot, dir, 'migration.sql');
    if (!fs.existsSync(sqlPath)) continue;
    const sql = fs.readFileSync(sqlPath, 'utf8');

    for (const m of sql.matchAll(/CREATE TABLE "([A-Za-z_]+)" \(([\s\S]*?)\n\s*\);/g)) {
      const set = tables.get(m[1]) ?? new Set<string>();
      tables.set(m[1], set);
      for (const line of m[2].split('\n')) {
        const cm = line.trim().match(/^"([A-Za-z_]+)"/);
        if (cm) set.add(cm[1]);
      }
    }
    for (const m of sql.matchAll(/ALTER TABLE "([A-Za-z_]+)"\s+([\s\S]*?);/g)) {
      const set = tables.get(m[1]) ?? new Set<string>();
      tables.set(m[1], set);
      for (const cm of m[2].matchAll(/ADD COLUMN\s+(IF NOT EXISTS\s+)?"([A-Za-z_]+)"/g)) {
        set.add(cm[2]);
      }
    }
    for (const m of sql.matchAll(/CREATE TYPE "([A-Za-z_]+)" AS ENUM \(([^)]*)\)/g)) {
      const set = enums.get(m[1]) ?? new Set<string>();
      enums.set(m[1], set);
      for (const v of m[2].matchAll(/'([^']+)'/g)) set.add(v[1]);
    }
    for (const m of sql.matchAll(/ALTER TYPE "([A-Za-z_]+)" ADD VALUE (?:IF NOT EXISTS )?'([^']+)'/g)) {
      const set = enums.get(m[1]) ?? new Set<string>();
      enums.set(m[1], set);
      set.add(m[2]);
    }
  }
  return { tables, enums };
}

describe('database schema <-> migrations parity (500-root-cause guard)', () => {
  const { models, enums } = parseSchema();
  const { tables, enums: dbEnums } = parseMigrations();

  it('every schema model has a CREATE TABLE in the migration history', () => {
    const missing = [...models.keys()].filter((m) => !tables.has(m));
    expect(missing).toEqual([]);
  });

  it('every schema enum has a CREATE TYPE in the migration history', () => {
    const missing = [...enums.keys()].filter((e) => !dbEnums.has(e));
    expect(missing).toEqual([]);
  });

  it('every schema enum value exists in the migration history', () => {
    const missing: string[] = [];
    for (const [name, values] of enums) {
      const migrated = dbEnums.get(name) ?? new Set<string>();
      for (const value of values) {
        if (!migrated.has(value)) missing.push(`${name}.${value}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every schema scalar column has DDL in the migration history', () => {
    const missing: string[] = [];
    for (const [model, fields] of models) {
      const columns = tables.get(model);
      if (!columns) continue; // covered by the first test
      for (const [field, def] of fields) {
        if (def.isList) continue; // relation list, not a column
        if (def.rest.includes('@relation')) continue;
        if (def.rest.includes('@map')) continue;
        if (models.has(def.type)) continue; // relation field, not a scalar column
        if (!columns.has(field)) missing.push(`${model}.${field}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('payment + trading domain objects are all covered by migrations', () => {
    for (const table of [
      'PaymentMethod',
      'ManualDepositRequest',
      'TradingAccount',
      'TradingInstrument',
      'TradingOrder',
      'TradingPosition',
      'TradingTransaction',
    ]) {
      expect(tables.has(table)).toBe(true);
    }
    for (const e of [
      'PaymentMethodType',
      'PaymentMethodStatus',
      'ManualDepositStatus',
      'TradingInstrumentType',
      'TradingDataSource',
      'TradingOrderSide',
      'TradingOrderStatus',
      'TradingPositionStatus',
      'TradingTransactionType',
    ]) {
      expect(dbEnums.has(e)).toBe(true);
    }
  });

  it('every auth-critical scalar column has migration DDL (incl. previousRefreshTokenHash)', () => {
    // Explicit list for the auth surface that production depends on for
    // login / refresh rotation / OAuth exchange. previousRefreshTokenHash is
    // the column whose PENDING migration caused the 2026-09-13 production
    // 500s on /auth/refresh and /auth/oauth/exchange (P2022 -> HTTP 500).
    const columnsByTable: Record<string, string[]> = {
      Session: [
        'id',
        'userId',
        'tokenHash',
        'refreshTokenHash',
        'previousRefreshTokenHash',
        'ip',
        'userAgent',
        'expiresAt',
        'revokedAt',
        'kind',
        'createdAt',
      ],
      OtpCode: [
        'id',
        'identifier',
        'purpose',
        'codeHash',
        'attempts',
        'expiresAt',
        'consumedAt',
        'lastSentAt',
        'metadata',
      ],
      AuthIdentity: ['id', 'provider', 'providerAccountId', 'userId', 'createdAt', 'updatedAt'],
      AuthToken: ['id', 'userId', 'type', 'tokenHash', 'expiresAt', 'usedAt', 'createdAt'],
      Verification: [
        'id',
        'userId',
        'type',
        'status',
        'verifiedAt',
        'providerRef',
        'metadata',
        'createdAt',
        'updatedAt',
      ],
    };

    const missing: string[] = [];
    for (const [table, cols] of Object.entries(columnsByTable)) {
      const migrated = tables.get(table) ?? new Set<string>();
      for (const col of cols) {
        if (!migrated.has(col)) missing.push(`${table}.${col}`);
      }
    }
    expect(missing).toEqual([]);
  });
});