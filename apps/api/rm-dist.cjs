const fs = require('fs');
const path = require('path');

/**
 * Robustly remove the API build output directory so that `nest build`
 * starts from a clean slate. Starting fresh avoids the Windows EPERM
 * unlink race that occurs when Nest tries to replace the stale Prisma
 * query-engine native binary in `dist/generated/prisma/` during an
 * incremental rebuild.
 *
 * Uses a recursive depth-first delete. If a file cannot be removed because
 * it is genuinely locked by another process, the script still removes
 * everything else and exits successfully so the build can proceed.
 */
const distDir = path.resolve(__dirname, 'dist');

function removeDir(dir) {
  let delayed = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const sub = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        removeDir(sub);
      } else {
        try {
          fs.unlinkSync(sub);
        } catch (err) {
          delayed.push(sub);
        }
      }
    }
    try {
      fs.rmdirSync(dir);
    } catch (err) {
      // Directory not empty (some files could not be removed) — acceptable.
    }
  } catch (err) {
    // Directory does not exist — nothing to do.
  }
  if (delayed.length) {
    console.warn(
      '[rm-dist] Could not remove %d file(s) (may be in use): %s',
      delayed.length,
      delayed.slice(0, 5).map(p => path.relative(distDir, p)).join(', ')
    );
  }
}

removeDir(distDir);
console.log('[rm-dist] cleaned', distDir);
