const fs = require('fs');
const t = fs.readFileSync('build-out.txt', 'utf8');
const lines = t.split(/\r?\n/);
const errs = [];
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('error TS')) {
    const clean = lines[i].replace(/^.*?node\.exe : /, '').trim();
    errs.push(clean);
  }
}
fs.writeFileSync('build-errors.txt', errs.join('\n'), 'utf8');
console.log('WROTE ' + errs.length + ' errors');