// Schema-vs-migrations drift audit (read-only, non-destructive).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const schemaPath = path.join(root, 'database', 'prisma', 'schema.prisma');
const migRoot = path.join(root, 'database', 'prisma', 'migrations');

const schema = fs.readFileSync(schemaPath, 'utf8');

// ---- Parse schema.prisma: models + enums + fields ----
const models = {}; // modelName -> { fields: Map<fieldName, {type, isList, isOptional, default, isId, isUnique}> , columns: Set }
const enums = {}; // enumName -> Set(values)

const lines = schema.split(/\r?\n/);
let ctx = null; // { kind: 'model'|'enum', name }
for (const raw of lines) {
  const line = raw.trim();
  if (line.startsWith('model ')) {
    const name = line.split(/\s+/)[1];
    models[name] = { fields: new Map(), columns: new Set() };
    ctx = { kind: 'model', name };
    continue;
  }
  if (line.startsWith('enum ')) {
    const name = line.split(/\s+/)[1];
    enums[name] = new Set();
    ctx = { kind: 'enum', name };
    continue;
  }
  if (line === '}') { ctx = null; continue; }
  if (!ctx) continue;
  if (line.startsWith('//') || line.startsWith('@@')) continue;
  if (ctx.kind === 'enum') {
    if (/^[A-Z_][A-Z0-9_]*$/.test(line)) enums[ctx.name].add(line);
    continue;
  }
  // model field line: name type modifiers
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s+([A-Za-z_][A-Za-z0-9_]*(\[\])?)(.*)$/);
  if (m) {
    const [, fName, fType] = m;
    const rest = m[4] || '';
    const isOptional = /\?$/.test(fType) || rest.includes('@relation');
    models[ctx.name].fields.set(fName, {
      type: fType.replace('?', ''),
      isList: fType.endsWith('[]'),
      isOptional: /\?/.test(fType),
      rest,
      isId: rest.includes('@id'),
    });
    if (!fType.endsWith('[]')) {
      models[ctx.name].columns.add(fName); // prisma maps field name 1:1 unless @map
    }
  }
}

// ---- Parse migrations: CREATE TABLE / ALTER TABLE ADD COLUMN / CREATE TYPE ----
const dbTables = {}; // table -> Set(columns)
const dbEnums = {}; // enum -> Set(values)
const dbEnumsFrom = {}; // enum -> migration that created it

function norm(type) {
  // prisma type -> SQL type (best effort)
  const map = {
    String: 'TEXT', Int: 'INTEGER', Boolean: 'BOOLEAN', DateTime: 'TIMESTAMP(3)', Float: 'DOUBLE PRECISION', Json: 'JSONB', Decimal: 'DECIMAL', BigInt: 'BIGINT', Bytes: 'BYTEA',
  };
  return map[type] || type;
}

const migFiles = fs.readdirSync(migRoot).filter((d) => fs.existsSync(path.join(migRoot, d, 'migration.sql')));
for (const dir of migFiles) {
  const sql = fs.readFileSync(path.join(migRoot, dir, 'migration.sql'), 'utf8');
  // CREATE TABLE "X" ( ... ); (also matches guarded blocks with indented closers)
  for (const m of sql.matchAll(/CREATE TABLE "([A-Za-z_]+)" \(([\s\S]*?)\n\s*\);/g)) {
    const table = m[1];
    const body = m[2];
    dbTables[table] = dbTables[table] || new Set();
    for (const line of body.split('\n')) {
      const cm = line.trim().match(/^"([A-Za-z_]+)"/);
      if (cm) dbTables[table].add(cm[1]);
    }
  }
  for (const m of sql.matchAll(/ALTER TABLE "([A-Za-z_]+)"\s+([\s\S]*?);/g)) {
    const table = m[1];
    const body = m[2];
    dbTables[table] = dbTables[table] || new Set();
    for (const cm of body.matchAll(/ADD COLUMN\s+(IF NOT EXISTS\s+)?"([A-Za-z_]+)"/g)) {
      dbTables[table].add(cm[2]);
    }
  }
  for (const m of sql.matchAll(/CREATE TYPE "([A-Za-z_]+)" AS ENUM \(([^)]*)\)/g)) {
    dbEnums[m[1]] = new Set([...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]));
    dbEnumsFrom[m[1]] = dir;
  }
  for (const m of sql.matchAll(/ALTER TYPE "([A-Za-z_]+)" ADD VALUE (?:IF NOT EXISTS )?'([^']+)'/g)) {
    dbEnums[m[1]] = dbEnums[m[1]] || new Set();
    dbEnums[m[1]].add(m[2]);
  }
}

// ---- Compare ----
console.log('=== DRIFT: models missing from migrations (tables that do not exist if DB built from migrations) ===');
for (const model of Object.keys(models)) {
  if (!dbTables[model]) {
    console.log(`  MISSING TABLE: ${model} (${models[model].columns.size} columns)`);
  }
}

console.log('');
console.log('=== DRIFT: enums missing from migrations ===');
for (const e of Object.keys(enums)) {
  if (!dbEnums[e]) {
    console.log(`  MISSING ENUM: ${e} values=[${[...enums[e]].join(', ')}]`);
  }
}

console.log('');
console.log('=== DRIFT: enum values missing from migrations (value in schema, not in migration) ===');
for (const e of Object.keys(enums)) {
  if (dbEnums[e]) {
    const missing = [...enums[e]].filter((v) => !dbEnums[e].has(v));
    if (missing.length) console.log(`  ENUM ${e}: missing values [${missing.join(', ')}]`);
  }
}

console.log('');
console.log('=== DRIFT: columns missing from migrations (field in schema, no column in migration DDL) ===');
for (const [model, def] of Object.entries(models)) {
  if (!dbTables[model]) continue;
  const missing = [];
  for (const f of def.fields.keys()) {
    const field = def.fields.get(f);
    if (field.isList) continue; // relation list, not a column
    // Skip Prisma relation fields: type matches another model (e.g. User.tradingAccount)
    if (models[field.type]) continue;
    if (field.rest.includes('@relation')) continue;
    if (field.rest.includes('@map')) continue; // custom mapping
    if (!dbTables[model].has(f)) missing.push(f);
  }
  if (missing.length) console.log(`  ${model}: missing columns [${missing.join(', ')}]`);
}

console.log('');
console.log('=== Migrations that would need to run: render.yaml runs prisma:migrate:deploy:strict ===');
console.log('(prisma migrate deploy -> scripts/verify-migrations.cjs) before every API build.');
console.log('Tables created by migrations:', Object.keys(dbTables).length, '| Models in schema:', Object.keys(models).length);
