const fs = require('fs');
const files = ['typecheck-out.txt', 'apps/web/web-build-out.txt'];
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const buf = fs.readFileSync(f);
  let t = buf.toString('utf8');
  if (t.includes('\u0000')) t = buf.toString('utf16le');
  const lines = t.split(/\r?\n/);
  const errs = lines.filter((l) => l.includes('error TS') || l.includes('Error:') || l.includes('Failed to compile'));
  const out = f.replace('.txt', '-errs.txt');
  fs.writeFileSync(out, errs.slice(0, 100).join('\n'), 'utf8');
  console.log('WROTE', out, errs.length);
}