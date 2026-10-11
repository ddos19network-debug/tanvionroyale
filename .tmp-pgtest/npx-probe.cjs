// Confirms whether `execFileSync('npx', ...)` (as used by
// scripts/verify-migrations.cjs) works on this platform at all. This is a
// pre-existing Windows limitation: npx is a .cmd shim, so execFileSync without
// shell:true throws ENOENT. On Render (Linux) npx is a real executable and the
// script works. Nothing here is modified by the migration fix.
const { execFileSync } = require('node:child_process');
try {
  const out = execFileSync('npx', ['prisma', '--version'], { encoding: 'utf8' });
  console.log('NPX_EXECFILE_OK');
  console.log(out.split('\n').slice(0, 2).join(' | '));
} catch (e) {
  console.log('NPX_EXECFILE_FAILED code=' + e.code + ' msg=' + e.message);
}
