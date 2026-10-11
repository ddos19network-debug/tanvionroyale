'use strict';

/**
 * Global form-control readability tests (master prompt Parts 15–31, 41–42
 * J–S, acceptance items 27–28).
 *
 * The reported bug: an input whose typed text is nearly invisible because the
 * field background and the typed text were both light. Root cause (verified
 * against the real stylesheets): Tailwind's preflight sets `color: inherit` on
 * form controls while the browser keeps its white default field background,
 * and the app foreground is near-white (hsl(180 20% 96%)) — so ANY control
 * without an explicit text color rendered near-white-on-white.
 *
 * These tests therefore check three things, all against real artifacts:
 *   1. the shared fix in app/globals.css (element-level safe defaults applied
 *      through @layer base with :where() so intentional per-control utilities
 *      keep winning),
 *   2. the ACTUAL WCAG contrast ratios, computed from the real colour tokens
 *      declared in tailwind.config.ts — typed text vs field, placeholder vs
 *      typed text, disabled and readonly states,
 *   3. a whole-repository scan of every <input>/<textarea>/<select> proving no
 *      control re-introduces the defect (light field + light/inherited text,
 *      invisible placeholder, transparent typed text).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const webRoot = path.resolve(__dirname, '..');

function read(rel) {
  const file = path.join(webRoot, ...rel.split('/'));
  assert(fs.existsSync(file), `missing source file ${rel}`);
  return fs.readFileSync(file, 'utf8');
}

const globalsCss = read('app/globals.css');
const tailwindConfig = read('tailwind.config.ts');

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log('  \u2713 ' + name);
  } catch (err) {
    failures += 1;
    console.error('  \u2716 ' + name);
    console.error('    ' + (err && err.message ? err.message.split('\n').join('\n    ') : String(err)));
  }
}

// ---------------------------------------------------------------------------
// Colour tokens + WCAG relative luminance / contrast helpers
// ---------------------------------------------------------------------------
function token(name) {
  // Reads the `800: '#0f2632',` entry out of the custom palette in
  // tailwind.config.ts (line scan — no regex escaping involved).
  for (const line of tailwindConfig.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(name + ':')) {
      const m = trimmed.match(/#[0-9a-fA-F]{6}/);
      if (m) return m[0];
    }
  }
  return null;
}

const INK = {};
for (const step of [950, 900, 800, 700, 600]) {
  INK[step] = token(String(step));
}

// Tailwind's own palette values, pinned here so this test can never drift
// silently from the classes the fix uses (slate.*).
const SLATE = {
  100: '#f1f5f9',
  200: '#e2e8f0',
  300: '#cbd5e1',
  400: '#94a3b8',
  500: '#64748b',
  600: '#475569',
};

function luminance(hex) {
  const clean = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------
// 1. The shared fix exists in the global stylesheet
// ---------------------------------------------------------------------------
test('globals.css defines the base form-field defaults inside @layer base', () => {
  const base = globalsCss.slice(globalsCss.indexOf('@layer base {'));
  assert(base.length > 0, 'no @layer base block in globals.css');
  assert(
    /input:where\([^)]*\)[\s\S]{0,200}?background-color:\s*theme\('colors\.ink\.800'\)/.test(base),
    'form controls do not get a safe default field background',
  );
  assert(
    /color:\s*theme\('colors\.slate\.100'\)/.test(base),
    'form controls do not get a safe default typed-text colour',
  );
});

test('globals.css styles textarea and select too — not just input', () => {
  const base = globalsCss.slice(globalsCss.indexOf('@layer base {'));
  assert(/textarea,\s*\n\s*select\s*\{/.test(base), 'textarea/select are not covered by the default');
  assert(/select option\s*\{/.test(base), 'native <option> rows are not given contrast colours');
});

test('globals.css placeholder is readable but distinct from typed text (Part 17)', () => {
  const base = globalsCss.slice(globalsCss.indexOf('@layer base {'));
  assert(
    /::placeholder[\s\S]{0,200}?color:\s*theme\('colors\.slate\.500'\)/.test(base),
    'placeholder colour is not set to a medium gray',
  );
  assert(/opacity:\s*1/.test(base), 'placeholder opacity is not reset (Firefox dims it by default)');
});

test('globals.css keeps disabled / readonly readable but distinguishable (Part 19)', () => {
  const base = globalsCss.slice(globalsCss.indexOf('@layer base {'));
  assert(/input:disabled[\s\S]{0,200}?color:\s*theme\('colors\.slate\.400'\)/.test(base), 'disabled text colour missing');
  assert(
    /input\[readonly\][\s\S]{0,200}?color:\s*theme\('colors\.slate\.300'\)/.test(base),
    'readonly text colour missing',
  );
});

test('globals.css neutralises Chrome autofill painting (Part 20)', () => {
  const base = globalsCss.slice(globalsCss.indexOf('@layer base {'));
  assert(/-webkit-autofill/.test(base), 'no -webkit-autofill rule');
  assert(/-webkit-text-fill-color/.test(base), 'autofill text fill is not forced');
  assert(/box-shadow:\s*0 0 0 1000px/.test(base), 'autofill background is not overpainted');
});

test('globals.css still provides a visible focus state (Part 18)', () => {
  assert(
    /input:focus-visible,[\s\S]{0,200}?outline:\s*2px solid/.test(globalsCss),
    'inputs lost their visible keyboard focus outline',
  );
});

test('globals.css is actually loaded by the app', () => {
  const candidates = ['app/layout.tsx', 'app/(user)/layout.tsx', 'app/(auth)/layout.tsx'];
  const importers = candidates.filter((rel) => {
    const file = path.join(webRoot, ...rel.split('/'));
    return fs.existsSync(file) && fs.readFileSync(file, 'utf8').includes('globals.css');
  });
  assert(importers.length > 0, 'no root layout imports globals.css — the fix would never reach the browser');
});

// ---------------------------------------------------------------------------
// 2. Real WCAG contrast, computed from the real design tokens
// ---------------------------------------------------------------------------
const FIELD_BG = INK[800];
const TYPED = SLATE[100];
const PLACEHOLDER = SLATE[500];
const DISABLED = SLATE[400];
const READONLY = SLATE[300];

test('design tokens resolve (fix is wired to the real palette)', () => {
  assert(FIELD_BG, 'tailwind.config.ts has no ink.800');
  assert(/^#[0-9a-f]{6}$/i.test(FIELD_BG), 'ink.800 is not a 6-digit hex');
});

test('typed text is high contrast against the field background (Part 16)', () => {
  const ratio = contrast(TYPED, FIELD_BG);
  assert(ratio >= 7, `typed text contrast is only ${ratio.toFixed(2)}:1 (need >= 7:1, WCAG AAA)`);
});

test('placeholder is readable but clearly NOT the same as typed text (Part 17)', () => {
  const ratio = contrast(PLACEHOLDER, FIELD_BG);
  assert(ratio >= 3, `placeholder contrast is only ${ratio.toFixed(2)}:1 (need >= 3:1)`);
  assert(
    ratio < contrast(TYPED, FIELD_BG) * 0.6,
    'placeholder is too close to typed text — users cannot tell them apart',
  );
});

test('disabled text stays readable (Part 19)', () => {
  const ratio = contrast(DISABLED, FIELD_BG);
  assert(ratio >= 4.5, `disabled text contrast is only ${ratio.toFixed(2)}:1 (need >= 4.5:1)`);
});

test('readonly text stays readable and differs from the disabled state (Part 19)', () => {
  const ratio = contrast(READONLY, FIELD_BG);
  assert(ratio >= 4.5, `readonly text contrast is only ${ratio.toFixed(2)}:1 (need >= 4.5:1)`);
  assert(READONLY !== DISABLED, 'readonly and disabled states are visually identical');
});

test('the fix never produces white-on-white (the reported defect)', () => {
  for (const [label, fg, bg] of [
    ['typed', TYPED, FIELD_BG],
    ['placeholder', PLACEHOLDER, FIELD_BG],
    ['disabled', DISABLED, FIELD_BG],
  ]) {
    assert(contrast(fg, bg) > 1.5, `${label} text is effectively invisible on the field background`);
  }
  assert(
    contrast('#ffffff', '#ffffff') === 1,
    'contrast helper sanity check failed (identical colours must be 1:1)',
  );
});

// ---------------------------------------------------------------------------
// 3. Whole-repository scan: no control may reintroduce the defect
// ---------------------------------------------------------------------------
const SCAN_ROOTS = ['app', 'components', path.join('..', '..', 'packages', 'ui', 'src')];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(entry.name)) out.push(full);
  }
  return out;
}

const scannedFiles = SCAN_ROOTS.reduce((acc, rel) => walk(path.join(webRoot, rel), acc), []);

/** Every <input .../> | <textarea ...> | <select ...> JSX tag in the repo. */
function formControls() {
  const found = [];
  const openTag = /<(input|textarea|select)\b/g;
  for (const file of scannedFiles) {
    const text = fs.readFileSync(file, 'utf8');
    let m;
    while ((m = openTag.exec(text)) !== null) {
      const end = findTagEnd(text, m.index + m[0].length);
      if (end < 0) continue;
      found.push({
        file: path.relative(webRoot, file).replace(/\\/g, '/'),
        tag: m[1],
        // Collapse whitespace so multi-line tags are still matchable.
        markup: text.slice(m.index, end).replace(/\s+/g, ' '),
      });
      openTag.lastIndex = end;
    }
  }
  return found;
}

/**
 * Returns the index just past the end of a JSX tag opened at `from`.
 * A naive "stop at the next >" search is wrong because arrow functions
 * (`onChange={(e) => ...}`) and comparisons contain `>`. Brace depth is
 * tracked so any `>` inside `{ ... }` is ignored.
 */
function findTagEnd(text, from) {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      if (ch === '/' && text[i + 1] === '>') return i + 2;
      if (ch === '>') return i + 1;
    }
  }
  return -1;
}

const controls = formControls();

const LIGHT_FIELD_BG =
  /(?:^|["'\s])bg-(?:white(?:\/\d+)?|slate-(?:50|100|200)|gray-(?:50|100|200)|zinc-(?:50|100|200)|neutral-(?:50|100|200)|stone-(?:50|100|200))(?:["'\s]|$)/;
const LIGHT_TEXT = /(?:^|["'\s])text-(?:white|slate-(?:50|100|200)|gray-(?:50|100|200))(?:["'\s]|$)/;
const INVISIBLE_TEXT = /text-transparent|placeholder:text-transparent|opacity-0(?:\s|"|$)/;

test(`scan sanity: found a meaningful number of form controls (${controls.length})`, () => {
  assert(controls.length >= 50, `only ${controls.length} controls scanned — the glob is probably wrong`);
  assert(
    scannedFiles.length >= 40,
    `only ${scannedFiles.length} .tsx files scanned — the glob is probably wrong`,
  );
});

test('no form control paints light text on a light field (the reported defect)', () => {
  const offenders = controls
    .filter((c) => LIGHT_FIELD_BG.test(c.markup) && LIGHT_TEXT.test(c.markup))
    .map((c) => `${c.file}: ${c.markup.slice(0, 160)}`);
  assert(offenders.length === 0, `light-on-light form controls:\n${offenders.join('\n')}`);
});

test('no control opts into a light field background without its own dark text colour', () => {
  // After the global default (dark field + slate-100 text) a control that sets
  // its OWN light background MUST also set a dark text colour, otherwise the
  // default would suddenly paint light text on that light background.
  const offenders = controls
    .filter((c) => LIGHT_FIELD_BG.test(c.markup) && !/(?:^|["'\s])text-(?:ink|slate-(?:700|800|900)|gray-(?:700|800|900)|black)/.test(c.markup))
    .map((c) => `${c.file}: ${c.markup.slice(0, 160)}`);
  assert(offenders.length === 0, `light field without dark text:\n${offenders.join('\n')}`);
});

test('no form control renders transparent or fully transparent text (Part 16)', () => {
  const offenders = controls
    .filter((c) => INVISIBLE_TEXT.test(c.markup))
    .map((c) => `${c.file}: ${c.markup.slice(0, 160)}`);
  assert(offenders.length === 0, `invisible-text controls:\n${offenders.join('\n')}`);
});

test('no control forces an unreadable placeholder colour (Part 17)', () => {
  // The trailing boundary matters: `placeholder:text-slate-500` must NOT be
  // mistaken for the too-faint `placeholder:text-slate-50`.
  const FAINT_PLACEHOLDER =
    /placeholder:text-(?:white|(?:slate|gray|zinc|neutral|stone)-(?:50|100|200))(?=["'\s]|$)/;
  const offenders = controls
    .filter((c) => FAINT_PLACEHOLDER.test(c.markup))
    .map((c) => `${c.file}: ${c.markup.slice(0, 160)}`);
  assert(offenders.length === 0, `unreadable placeholders:\n${offenders.join('\n')}`);
});

// ---------------------------------------------------------------------------
// 4. Audit coverage: the scan really covers every audited surface (Parts 30/31)
// ---------------------------------------------------------------------------
test('every audited surface is covered by the scan (customer + admin)', () => {
  const expected = [
    'app/(auth)/login/page.tsx',
    // The signup FORM lives in /signup; /register is a thin re-export of that
    // same page, so the audit targets the file that actually holds the inputs.
    'app/(auth)/signup/page.tsx',
    'app/(user)/profile/page.tsx',
    'app/(user)/settings/page.tsx',
    'app/(user)/verification/page.tsx',
    'app/(user)/wallet/deposit/page.tsx',
    'app/(user)/wallet/withdraw/page.tsx',
    'app/(user)/support/report/page.tsx',
    'app/(user)/support/chat/page.tsx',
    'app/admin/login/page.tsx',
    'app/admin/users/page.tsx',
    'app/admin/admins/page.tsx',
    'app/admin/payment-methods/page.tsx',
    'app/admin/payment-gateways/page.tsx',
    'app/admin/manual-deposits/page.tsx',
    'app/admin/manual-withdrawals/page.tsx',
    'app/admin/support/page.tsx',
    'app/admin/wallets/page.tsx',
  ];
  const missing = expected.filter((rel) => !scannedFiles.some((f) => f.endsWith(path.join(...rel.split('/')))));
  assert(missing.length === 0, `audited screens missing from the scan:\n${missing.join('\n')}`);
});

test('every audited surface actually rendered at least one form control', () => {
  const withoutControls = [
    'app/(auth)/login/page.tsx',
    'app/(auth)/signup/page.tsx',
    'app/(user)/profile/page.tsx',
    'app/(user)/wallet/deposit/page.tsx',
    'app/(user)/wallet/withdraw/page.tsx',
    'app/admin/login/page.tsx',
    'app/admin/payment-methods/page.tsx',
  ].filter((rel) => !controls.some((c) => c.file === rel));
  assert(
    withoutControls.length === 0,
    `form controls were not detected on:\n${withoutControls.join('\n')}`,
  );
});

// ---------------------------------------------------------------------------
// 5. The exact defect from the screenshot (username input, Profile page)
// ---------------------------------------------------------------------------
test('reported case: the profile username input can no longer be invisible', () => {
  const username = controls.find(
    (c) => c.file === 'app/(user)/profile/page.tsx' && c.markup.includes('maxLength={32}'),
  );
  assert(username, 'the profile username input was not found (did the page change?)');
  assert(
    !LIGHT_FIELD_BG.test(username.markup),
    'the profile username input paints a light field background again',
  );
  assert(
    !LIGHT_TEXT.test(username.markup) || /text-(?:ink|slate-(?:700|800|900)|black)/.test(username.markup),
    'the profile username input pairs a light/white text colour with a light field',
  );
  // Its typed text comes from the shared default, which is high contrast.
  assert(
    /input:where\([^)]*\)[\s\S]{0,200}?color:\s*theme\('colors\.slate\.100'\)/.test(globalsCss),
    'the shared default no longer supplies a readable typed-text colour',
  );
});

test('mobile: the shell cannot push an input off-screen (Part 29)', () => {
  assert(/min-width:\s*320px/.test(globalsCss), 'no 320px minimum width guard');
  assert(/overflow-x:\s*hidden/.test(globalsCss), 'horizontal overflow is not contained');
  const layout = read('app/layout.tsx');
  assert(/width:\s*'device-width'/.test(layout), 'viewport is not device-width (mobile layout breaks)');
  assert(layout.includes('./globals.css'), 'root layout no longer imports globals.css');
});

test('modal bodies scroll, so a focused field can never be trapped off-screen (Part 29)', () => {
  const modal = read('components/admin/modal.tsx');
  assert(/overflow-y-auto/.test(modal), 'modals do not scroll vertically');
  assert(/max-h-\[85vh\]/.test(modal), 'modals have no viewport-relative height cap');
  assert(/role="dialog"/.test(modal) && /aria-modal="true"/.test(modal), 'modal semantics missing');
});

console.log(
  failures === 0
    ? `\ninput-readability: all tests passed (${controls.length} form controls across ${scannedFiles.length} files)`
    : `\ninput-readability: ${failures} test(s) FAILED`,
);
process.exitCode = failures === 0 ? 0 : 1;
