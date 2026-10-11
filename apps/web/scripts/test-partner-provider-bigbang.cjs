'use strict';

/**
 * Admin → Partner providers — BigBang (CASINO_AGGREGATOR) source-contract tests.
 *
 * WHY source-contract: the web app has NO component test framework (no jsdom,
 * no React Testing Library — see the header of test-auth-flow.cjs), so these
 * tests assert the contract directly against the REAL page source, exactly
 * like test-admin-modal-flow.cjs.
 *
 * Contract enforced for the BigBang configuration path:
 *   1. the integration selector OFFERS CASINO_AGGREGATOR (labelled
 *      "Casino Aggregator (BigBang)") alongside the pre-existing Sports API
 *      and WinHouse options — nothing was removed;
 *   2. choosing it renders the BigBang branch (Environment sandbox/production,
 *      the verified Base URL, the API key secret field) and NOT the WinHouse
 *      embed fields nor the sports deep-link fields;
 *   3. create/update send providerCode BIGBANG + environment so the backend
 *      validation accepts the row;
 *   4. the API key is a password input, is never prefilled on edit, an EMPTY
 *      input is OMITTED (preserving the stored ciphertext), and only the
 *      explicit "Remove stored value" checkbox sends the clear sentinel;
 *   5. no NEXT_PUBLIC_BIGBANG* credential ever exists in the web source.
 *
 * Run: `node scripts/test-partner-provider-bigbang.cjs` (exit 0 = pass).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const webRoot = path.resolve(__dirname, '..');
const pageSrc = fs.readFileSync(
  path.join(webRoot, 'app/admin/partner-providers/page.tsx'),
  'utf8',
);
const adminApiSrc = fs.readFileSync(path.join(webRoot, 'lib/api/admin.ts'), 'utf8');

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log('  \u2713 ' + name);
  } catch (err) {
    failures += 1;
    console.error('  \u2716 ' + name);
    console.error(
      '    ' + (err && err.message ? err.message.split('\n').join('\n    ') : String(err)),
    );
  }
}

/** Extracts `function <name>(...) {...}` via brace matching. */
function extractFunction(src, name) {
  let start = src.indexOf(`async function ${name}(`);
  if (start < 0) start = src.indexOf(`function ${name}(`);
  assert(start >= 0, `function ${name} not found`);
  const open = src.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error(`function ${name} braces are unbalanced`);
}

const onSaveSrc = extractFunction(pageSrc, 'onSave');

// ---------------------------------------------------------------------------
// 1. The selector offers CASINO_AGGREGATOR — and keeps every pre-existing type
// ---------------------------------------------------------------------------
test('selector offers Casino Aggregator (BigBang)', () => {
  assert(
    pageSrc.includes(
      '<option value="CASINO_AGGREGATOR">Casino Aggregator (BigBang)</option>',
    ),
    'the integration <select> must offer CASINO_AGGREGATOR labelled "Casino Aggregator (BigBang)"',
  );
  assert(
    pageSrc.includes("CASINO_AGGREGATOR: 'Casino Aggregator (BigBang)',"),
    'the INTEGRATION_LABELS map must label CASINO_AGGREGATOR as "Casino Aggregator (BigBang)"',
  );
});

test('selector still offers Sports API and the WinHouse iframe option', () => {
  assert(
    pageSrc.includes(
      '<option value="SPORTS_API">Sports API (server-side, deep links)</option>',
    ),
    'Sports API option removed from the integration <select>',
  );
  assert(
    pageSrc.includes(
      '<option value="SPORTS_IFRAME">Embedded sportsbook (WinHouse iframe)</option>',
    ),
    'WinHouse iframe option removed from the integration <select>',
  );
});

test('web API type still carries every integration type', () => {
  for (const t of [
    "'SPORTS_API'",
    "'SPORTS_IFRAME'",
    "'CASINO_API'",
    "'LIVE_CASINO_API'",
    "'CASINO_AGGREGATOR'",
  ]) {
    assert(adminApiSrc.includes(t), `AdminPartnerIntegrationType lost ${t}`);
  }
});

// ---------------------------------------------------------------------------
// 2. BigBang form branch renders Environment / Base URL / API key
// ---------------------------------------------------------------------------
test('form has a dedicated aggregator branch', () => {
  assert(
    pageSrc.includes(') : aggregator ? ('),
    'the form modal must branch into the CASINO_AGGREGATOR shape',
  );
  assert(
    pageSrc.includes('const aggregator = isCasinoAggregator(form.integrationType);'),
    'the modal must derive `aggregator` from the selected integration type',
  );
  assert(
    pageSrc.includes('function isCasinoAggregator('),
    'isCasinoAggregator helper missing',
  );
});

test('aggregator branch renders Environment with Sandbox and Production options', () => {
  const start = pageSrc.indexOf(') : aggregator ? (');
  assert(start >= 0, 'aggregator branch not found');
  const end = pageSrc.indexOf(') : (', start);
  assert(end > start, 'aggregator branch terminator not found');
  const branch = pageSrc.slice(start, end);
  assert(branch.includes('<span>Environment</span>'), 'Environment field missing');
  assert(
    branch.includes('<option value="sandbox">Sandbox</option>'),
    'Sandbox option missing in the aggregator branch',
  );
  assert(
    branch.includes('<option value="production">Production</option>'),
    'Production option missing in the aggregator branch',
  );
  assert(branch.includes('<span>Base URL</span>'), 'Base URL field missing');
  // The BigBang branch must NOT show WinHouse-only fields.
  assert(!branch.includes('embedKey'), 'WinHouse embed key leaked into the BigBang branch');
  assert(
    !branch.includes('walletBaseUrl'),
    'WinHouse wallet base URL leaked into the BigBang branch',
  );
  assert(
    !branch.includes('callbackToken'),
    'WinHouse callback token leaked into the BigBang branch',
  );
  // ...nor the sports deep-link template.
  assert(
    !branch.includes('Deep-link template'),
    'sports deep-link template leaked into the BigBang branch',
  );
});

test('base URL default is the verified BigBang API URL', () => {
  assert(
    pageSrc.includes(
      "const BIGBANG_DEFAULT_BASE_URL = 'https://api.bigbangcasino.bet/api/v1';",
    ),
    'BIGBANG_DEFAULT_BASE_URL must be exactly https://api.bigbangcasino.bet/api/v1',
  );
  assert(
    pageSrc.includes('baseUrl: isCasinoAggregator(next) ? BIGBANG_DEFAULT_BASE_URL'),
    'switching the selector to CASINO_AGGREGATOR must prefill the verified base URL',
  );
});

// ---------------------------------------------------------------------------
// 3. Save payloads — providerCode, environment, status, secret handling
// ---------------------------------------------------------------------------
test('create payload sends providerCode BIGBANG, environment and the API key', () => {
  const createStart = onSaveSrc.indexOf('await createPartnerProvider({');
  assert(createStart >= 0, 'createPartnerProvider call missing from onSave');
  const create = onSaveSrc.slice(createStart);
  assert(
    create.includes('providerCode: aggregator ? BIGBANG_PROVIDER_CODE : undefined'),
    'create payload must send providerCode BIGBANG for the aggregator',
  );
  assert(
    create.includes('environment: embedded || aggregator ? form.environment : undefined'),
    'create payload must send the selected environment for the aggregator',
  );
  assert(
    create.includes('apiKey: embedded ? undefined : form.apiKey || undefined'),
    'create payload must submit the typed API key',
  );
  assert(
    create.includes('status: form.status'),
    'create payload must submit ACTIVE/INACTIVE status',
  );
  assert(
    create.includes('embedded || aggregator ? undefined : form.deepLinkTemplate.trim()'),
    'create payload must NOT send a deep-link template for the aggregator',
  );
});

test('update payload replaces the key only when typed or explicitly cleared', () => {
  const updateStart = onSaveSrc.indexOf('await updatePartnerProvider(');
  assert(updateStart >= 0, 'updatePartnerProvider call missing from onSave');
  const update = onSaveSrc.slice(updateStart, onSaveSrc.indexOf('} else {'));
  assert(
    update.includes("apiKey: form.clearApiKey ? '' : form.apiKey || undefined"),
    'update payload must OMIT an empty API key (preserving the stored ciphertext) and ' +
      'send the clear sentinel only via the explicit remove checkbox',
  );
  assert(
    update.includes('providerCode: aggregator ? BIGBANG_PROVIDER_CODE : undefined'),
    'update payload must keep providerCode BIGBANG for the aggregator',
  );
  assert(
    update.includes('apiSecret: aggregator'),
    'the aggregator has ONE credential — apiSecret must never be sent for it',
  );
});

test('validation requires the base URL, and a key for an ACTIVE row', () => {
  assert(
    onSaveSrc.includes('} else if (aggregator) {'),
    'onSave must branch into aggregator validation',
  );
  assert(
    onSaveSrc.includes('form.baseUrl.trim() !== BIGBANG_DEFAULT_BASE_URL'),
    'onSave must reject a base URL other than the verified BigBang API',
  );
  assert(
    onSaveSrc.includes("'API key is required for an active BigBang provider.'"),
    'onSave must require an API key when the row is ACTIVE without a stored key',
  );
  assert(
    onSaveSrc.includes('!(editTarget && editTarget.apiKeySet)'),
    'an edit with an ALREADY STORED key must not demand a re-typed key',
  );
});

// ---------------------------------------------------------------------------
// 4. Secret never reaches the browser
// ---------------------------------------------------------------------------
test('API key input is a password field with keep/remove semantics', () => {
  const secretStart = pageSrc.indexOf('function SecretField(');
  assert(secretStart >= 0, 'SecretField component missing');
  const secret = pageSrc.slice(secretStart);
  assert(secret.includes('type="password"'), 'SecretField must render a password input');
  assert(
    secret.includes('Leave blank to keep the stored value'),
    'SecretField must explain that blank keeps the stored secret',
  );
  assert(
    pageSrc.includes('keepHint={Boolean(editTarget && editTarget.apiKeySet)}'),
    'the API key field must be masked as stored/unstored — never prefilled',
  );
});

test('openEdit never prefills the API key from the server', () => {
  const openEditSrc = extractFunction(pageSrc, 'openEdit');
  assert(
    openEditSrc.includes("apiKey: '',"),
    'openEdit must reset apiKey to an empty string (the server never returns it)',
  );
  assert(
    openEditSrc.includes('clearApiKey: false'),
    'openEdit must reset the clear-checkbox state',
  );
});

test('no NEXT_PUBLIC BigBang credential exists anywhere in the web source', () => {
  // Assembled at runtime so this very script never contains the literal.
  const forbidden = ['NEXT_PUBLIC', 'BIGBANG'].join('_');
  const self = __filename;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx|js|jsx|cjs|mjs|json)$/.test(entry.name) || entry.name.startsWith('.env')) {
        if (full === self) continue;
        const content = fs.readFileSync(full, 'utf8');
        assert(
          !content.includes(forbidden),
          `frontend credential env var ${forbidden} found in ${full}`,
        );
      }
    }
  };
  walk(webRoot);
});

// ---------------------------------------------------------------------------
// 5. Existing integrations untouched
// ---------------------------------------------------------------------------
test('WinHouse shape and sports sync guards remain intact', () => {
  assert(pageSrc.includes('function isEmbeddedBook('), 'isEmbeddedBook helper removed');
  assert(pageSrc.includes('label="Wallet API key"'), 'WinHouse wallet key field removed');
  assert(pageSrc.includes('label="Callback token"'), 'WinHouse callback token field removed');
  assert(
    pageSrc.includes(
      '!isEmbeddedBook(p.integrationType) &&\n            !isCasinoAggregator(p.integrationType) &&\n            canSync',
    ),
    'the sports Sync button must stay hidden for BOTH WinHouse and BigBang rows',
  );
  assert(
    pageSrc.includes('Catalog sync: Admin \u2192 Casino'),
    'BigBang rows must point at the existing casino catalog sync instead of sports sync',
  );
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
if (failures > 0) {
  console.error(`\n${failures} partner-provider BigBang test(s) FAILED.`);
  process.exit(1);
}
console.log('\nAll partner-provider BigBang tests passed.');

