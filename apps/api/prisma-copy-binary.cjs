/**
 * Sync the native Prisma query engine into `apps/api/prisma-engine/` — the
 * stable location the API loads it from (see `pinPrismaQueryEngine()` in
 * src/main.ts, which sets PRISMA_QUERY_ENGINE_LIBRARY).
 *
 * Why this indirection exists (Windows):
 *   - `nest build` / `nest start --watch` wipe `dist/` up front
 *     (`deleteOutDir`), so an engine inside `dist/` gets
 *     `EPERM: operation not permitted, unlink '...\dist\...\query_engine-windows.dll.node'`
 *     whenever the API is running (Windows locks loaded DLLs).
 *   - `prisma generate` unconditionally rewrites its own output directory
 *     (`src/generated/prisma/`) via tmp-file + rename, so loading the engine
 *     from there breaks client regeneration while the API is running.
 *
 * `apps/api/prisma-engine/` is outside both directories and is written ONLY
 * when the engine bytes actually change (sha256-compared), so a running API
 * never has the file it loaded rewritten under it.
 *
 * Also removes `*.tmp<pid>` engine leftovers that `prisma generate` leaves
 * behind when it was interrupted (e.g. by a locked engine) mid-copy.
 *
 * Exits non-zero only when the engine must be replaced but the target is
 * locked by a running API — stop the API and re-run prisma:generate.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, 'src', 'generated', 'prisma');
const engineDir = path.resolve(__dirname, 'prisma-engine');

const isEngineFile = (name) => name.includes('query_engine') && name.endsWith('.node');
const sha256 = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// ---------------------------------------------------------------------------
// 1. Clean temp leftovers in the generate output directory.
// ---------------------------------------------------------------------------
if (fs.existsSync(srcDir)) {
  for (const name of fs.readdirSync(srcDir)) {
    if (name.includes('query_engine') && /\.tmp\d+$/.test(name)) {
      try {
        fs.unlinkSync(path.join(srcDir, name));
        console.log(`[prisma-copy-binary] removed stale temp file src/generated/prisma/${name}`);
      } catch (err) {
        console.warn(
          `[prisma-copy-binary] could not remove stale temp file ${name} (${err.code || err.message})`
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 2. Verify `prisma generate` produced the engine next to the client.
// ---------------------------------------------------------------------------
const engines = fs.existsSync(srcDir)
  ? fs.readdirSync(srcDir).filter(isEngineFile)
  : [];

if (engines.length === 0) {
  console.error(`[prisma-copy-binary] No Prisma query engine found in ${srcDir}`);
  console.error(
    '[prisma-copy-binary] `prisma generate` did not complete — run `pnpm --filter @tanvion-royale/api prisma:generate`.'
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 3. Hash-sync engine(s) into the stable prisma-engine/ directory.
// ---------------------------------------------------------------------------
fs.mkdirSync(engineDir, { recursive: true });

for (const name of engines) {
  const source = path.join(srcDir, name);
  const target = path.join(engineDir, name);

  const sourceHash = sha256(source);
  if (fs.existsSync(target) && sha256(target) === sourceHash) {
    console.log(`[prisma-copy-binary] engine up to date: ${target}`);
    continue;
  }

  try {
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
    fs.copyFileSync(source, target);
    console.log(`[prisma-copy-binary] synced engine -> ${target}`);
  } catch (err) {
    console.error(`[prisma-copy-binary] could not update ${target} (${err.code || err.message}).`);
    console.error(
      '[prisma-copy-binary] A running API process is using the current engine (Windows locks loaded DLLs).'
    );
    console.error(
      '[prisma-copy-binary] Stop the API, then re-run `pnpm --filter @tanvion-royale/api prisma:generate`.'
    );
    process.exit(1);
  }
}

console.log(`[prisma-copy-binary] Prisma query engine pinned at ${engineDir}`);
