/**
 * REFERRAL PROGRAM frontend tests.
 *
 * Static + pure checks on the REAL production code path (no mocks of our own
 * modules): the API client, the money formatter, the register page's `?ref=`
 * capture, the profile panel and the admin page.
 *
 * What is pinned:
 *   - the referral link is built from the CONFIGURED base URL, never a
 *     hard-coded production domain;
 *   - the register page really reads `?ref=` and forwards it to the API;
 *   - the profile and admin pages are actually wired into the app router;
 *   - the user UI exposes no amount/qualification control: a user can never
 *     choose a reward, a referrer or a qualification status;
 *   - minor units are formatted correctly and never re-parsed from a string.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const web = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(web, rel), 'utf8');

let passed = 0;
const failures = [];
async function test(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log('  OK  ' + name);
  } catch (error) {
    failures.push({ name, error });
    console.log('  FAIL ' + name);
  }
}

const REFERRAL_API = read('lib/api/referral.ts');
const REGISTER_PAGE = read('app/(auth)/register/page.tsx');
// The signup FORM now lives in /signup; /register is a thin re-export of that
// same page so both URLs share one form and one attribution path. Audits that
// inspect the form's behaviour must read SIGNUP_PAGE; audits that care about
// the /register URL keep reading REGISTER_PAGE.
const SIGNUP_PAGE = read('app/(auth)/signup/page.tsx');
const PROFILE_PAGE = read('app/(user)/profile/page.tsx');
const REFERRAL_PANEL = read('components/profile/profile-referral.tsx');
const ADMIN_PAGE = read('app/admin/referral/page.tsx');
const ADMIN_SHELL = read('components/admin/admin-shell.tsx');

// ---------------------------------------------------------------------------
// Behavioural harness.
//
// The static assertions above prove the SHAPE of the client. The tests below
// exercise the REAL `lib/api/client.ts` + `lib/api/referral.ts` modules through
// the same TypeScript + `@/` loader used by test-studio-selection.cjs, stubbing
// ONLY the two real boundaries: `global.fetch` (network) and `localStorage`
// (the session store). Nothing in `apps/web` is modified or mocked away.
// ---------------------------------------------------------------------------
const Module = require('module');
const ts = require(require.resolve('typescript', { paths: [path.join(web, 'node_modules')] }));

require.extensions['.ts'] = function (mod, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.Node10,
    },
    fileName: filename,
  });
  mod._compile(outputText, filename);
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) request = path.join(web, request.slice(2));
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => void map.clear(),
  };
}
global.localStorage = createMemoryStorage();
// `withCrossTabRefreshLock` reads `navigator.locks`; keep it absent so the
// single-process path is used deterministically.
try {
  Object.defineProperty(global, 'navigator', { value: {}, configurable: true, writable: true });
} catch {
  /* an existing navigator without `locks` behaves identically */
}
process.env.NEXT_PUBLIC_API_URL = 'https://tanvionroyale.onrender.com';

const client = require(path.join(web, 'lib/api/client.ts'));
const referral = require(path.join(web, 'lib/api/referral.ts'));
const { ApiClientError, authFetch, apiFetch, refreshAuthSession } = client;

const ACCESS_KEY = 'ng.access';
const REFRESH_KEY = 'ng.refresh';
const USER_KEY = 'ng.user';

function setSession(access, refresh) {
  global.localStorage.setItem(ACCESS_KEY, access);
  global.localStorage.setItem(REFRESH_KEY, refresh);
  global.localStorage.setItem(
    USER_KEY,
    JSON.stringify({ id: 'user-1', username: 'admin', role: 'SUPER_ADMIN' }),
  );
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

let requests = [];
/** Installs a fetch stub and records every request the client makes. */
function installFetch(handler) {
  requests = [];
  global.fetch = async (url, init) => {
    const record = {
      url: String(url),
      method: (init && init.method) || 'GET',
      headers: (init && init.headers) || {},
      body: init && init.body,
    };
    requests.push(record);
    return handler(record);
  };
}

const SESSION_RESPONSE = {
  accessToken: 'access-2',
  accessTokenExpiresIn: 900,
  refreshToken: 'refresh-2',
  user: { id: 'user-1', username: 'admin', role: 'SUPER_ADMIN' },
};

(async () => {
  console.log('Referral program - frontend wiring');

  await test('the referral link comes from the SERVER, never built in the browser', () => {
    // The link is assembled server-side from the configured site URL and the
    // admin-configured signup path; the client only renders what it was given.
    assert.ok(
      /getMyReferral/.test(REFERRAL_API),
      'the client must read the referral link from the API',
    );
    assert.ok(
      /summary\.referralLink/.test(REFERRAL_PANEL),
      'the panel must render the server-built link',
    );
    assert.ok(
      !/referralLink\s*[:=]\s*`/.test(REFERRAL_PANEL) &&
        !/buildReferralLink|signupPath/.test(REFERRAL_PANEL),
      'the browser must never construct the referral link itself',
    );
    // The frontend must not bake the production domain into a referral link.
    assert.ok(
      !/tanvionroyale\.vercel\.app/.test(REFERRAL_PANEL),
      'the profile panel must not hard-code the production domain',
    );
    assert.ok(
      !/tanvionroyale\.vercel\.app/.test(REGISTER_PAGE),
      'the register page must not hard-code the production domain',
    );
    assert.ok(
      !/tanvionroyale\.vercel\.app/.test(SIGNUP_PAGE),
      'the signup page must not hard-code the production domain',
    );
  });

  await test('the signup page reads ?ref= and forwards it to the API', () => {
    assert.ok(/useSearchParams/.test(SIGNUP_PAGE), 'the signup page must read the query');
    assert.ok(
      /searchParams\.get\(['"]ref['"]\)/.test(SIGNUP_PAGE),
      'the signup page must read the ref parameter',
    );
    assert.ok(
      /referralCode/.test(SIGNUP_PAGE) && /\bref:\s*referralCode/.test(SIGNUP_PAGE),
      'the referral code must be sent with the signup request',
    );
    // The user must be told a referral is being applied (either a positive or a
    // "that code is not valid" notice) so the attribution is never silent.
    assert.ok(
      /Referral applied/.test(SIGNUP_PAGE) ||
        /That referral code is not valid/.test(SIGNUP_PAGE),
      'the user must be told a referral is being applied',
    );
  });

  await test('the historical /register URL still serves the SAME signup form', () => {
    assert.ok(
      /from '\.\.\/signup\/page'/.test(REGISTER_PAGE),
      '/register must re-export the /signup page so a link already shared keeps working',
    );
  });

  await test('the API client only calls caller-scoped and admin routes', () => {
    const urls = [...REFERRAL_API.matchAll(/`(\/[^`]*)`/g)].map((m) => m[1]);
    assert.ok(urls.length > 0, 'the client must call the referral API');
    for (const url of urls) {
      assert.ok(
        url.startsWith('/me/referral') || url.startsWith('/admin/referral'),
        'a referral client URL must be caller-scoped or admin-only, got: ' + url,
      );
    }
    // No route may take another user's id from the browser.
    assert.ok(
      !/\/user\/\$\{|\$\{.*userId.*\}\/referral/.test(REFERRAL_API),
      'the client must never build a route from a user id',
    );
  });

  await test('every referral request is AUTHENTICATED (the session-expired regression)', () => {
    // REGRESSION GUARD. Every /me/referral and /admin/referral route is behind
    // the backend's global JwtAuthGuard. Calling them through the anonymous
    // `apiFetch` sends no Authorization header, the API answers 401
    // "Missing access token", and the client reports that as "Your session has
    // expired. Please sign in again." — which is exactly the bug that made
    // /admin/referral look logged out to a signed-in SUPER_ADMIN.
    assert.ok(
      /import\s*\{\s*authFetch\s*\}\s*from\s*'\.\/client'/.test(REFERRAL_API),
      'the referral client must import authFetch',
    );
    const anonymousCalls = REFERRAL_API.match(/\bapiFetch[\s(<]/g) || [];
    assert.strictEqual(
      anonymousCalls.length,
      0,
      'the referral client must never use the anonymous apiFetch — a valid ' +
        'session would be reported as expired. Found: ' +
        anonymousCalls.length,
    );
    // Every referral URL must be issued through authFetch.
    const fetchCalls = [...REFERRAL_API.matchAll(/(\w+Fetch)[<(]/g)].map((m) => m[1]);
    assert.ok(fetchCalls.length > 0, 'the client must issue requests');
    for (const helper of fetchCalls) {
      assert.strictEqual(
        helper,
        'authFetch',
        'only authFetch may issue a referral request, found: ' + helper,
      );
    }
  });

  await test('the admin referral page surfaces the real API error, not a fixed one', () => {
    // The page must render whatever describeApiError() produced for the actual
    // failure, so a 403/404/5xx is never relabelled as an expired session.
    assert.ok(
      /describeApiError/.test(ADMIN_PAGE),
      'the admin page must describe the real API error',
    );
    // It must never invent its own "session expired" copy.
    assert.ok(
      !/session has expired/i.test(ADMIN_PAGE),
      'the admin page must not hard-code a session-expired message',
    );
  });

  await test('minor units are formatted correctly and never re-parsed', () => {
    const body = REFERRAL_API;
    assert.ok(/export function formatMinor/.test(body), 'formatMinor must be exported');
    // toMinor lives in the ADMIN page (input parsing) and must convert once.
    assert.ok(
      /const toMinor = \(major: string\)/.test(ADMIN_PAGE) && /Math\.round\(n \* 100\)/.test(ADMIN_PAGE),
      'the admin form must convert major units to minor units once',
    );
    assert.ok(
      /toMajor = \(minor: number\) => \(minor \/ 100\)\.toFixed\(2\)/.test(ADMIN_PAGE),
      'the admin form must render minor units as major units',
    );
  });

  await test('the profile referral panel is wired into the profile page', () => {
    assert.ok(/ReferralPanel/.test(PROFILE_PAGE), 'the profile page must render the panel');
    assert.ok(
      /key: 'referral'/.test(PROFILE_PAGE),
      'the profile page must expose a Referral tab',
    );
    assert.ok(
      /tab === 'referral' \? <ReferralPanel \/>/.test(PROFILE_PAGE),
      'the Referral tab must render the panel',
    );
  });

  await test('the referral panel shows the code, the link and copy buttons', () => {
    assert.ok(/data-testid="referral-code"/.test(REFERRAL_PANEL), 'the code must be shown');
    assert.ok(/data-testid="referral-link"/.test(REFERRAL_PANEL), 'the link must be shown');
    assert.ok(/Copy Code/.test(REFERRAL_PANEL), 'a Copy Code button is required');
    assert.ok(/Copy Referral Link/.test(REFERRAL_PANEL), 'a Copy Referral Link button is required');
  });

  await test('the user UI never lets a user choose an amount or a qualification', () => {
    for (const [name, src] of [
      ['profile panel', REFERRAL_PANEL],
      ['signup page', SIGNUP_PAGE],
    ]) {
      assert.ok(
        !/input[^>]*type="number"[^>]*amount/i.test(src),
        name + ' must not accept a user-supplied amount',
      );
      // A read (`settings.qualificationRule === '...'`) is fine; an ASSIGNMENT
      // to a rule is not.
      assert.ok(
        !/qualificationRule\s*=(?!=)/.test(src) &&
          !/qualificationRule\s*:/.test(src) &&
          !/setRule|setQualification/.test(src),
        name + ' must not let a user set a qualification rule',
      );
    }
    // The panel only READS the values the server returned.
    assert.ok(
      /settings\.qualificationRule/.test(REFERRAL_PANEL),
      'the panel must show the server-configured rule',
    );
  });

  await test('the admin referral page is wired into the admin navigation', () => {
    assert.ok(
      /href: '\/admin\/referral'/.test(ADMIN_SHELL),
      'the admin shell must link to /admin/referral',
    );
    assert.ok(/Referral settings/.test(ADMIN_PAGE), 'the admin page must render the settings');
    assert.ok(/Referral rewards/.test(ADMIN_PAGE), 'the admin page must render the reward ledger');
    assert.ok(/Search referrers/.test(ADMIN_PAGE), 'the admin page must allow searching');
    assert.ok(/Top referrers/.test(ADMIN_PAGE), 'the admin page must show top referrers');
  });

  await test('a manual adjustment REQUIRES a reason (auditable, never silent)', () => {
    assert.ok(
      /minLength=\{5\}/.test(ADMIN_PAGE),
      'the adjustment reason must require at least 5 characters',
    );
    assert.ok(
      /Reason \(required, permanently audited\)/.test(ADMIN_PAGE),
      'the admin UI must state that the reason is audited',
    );
  });

  // -------------------------------------------------------------------------
  // Behavioural regression tests (real modules, stubbed network only)
  // -------------------------------------------------------------------------

  await test('a valid access token authenticates the request and never refreshes', async () => {
    setSession('access-1', 'refresh-1');
    installFetch(() => jsonResponse(200, { success: true, data: { settings: { enabled: true } } }));

    const result = await referral.getReferralSettings();

    assert.deepStrictEqual(result, { settings: { enabled: true } });
    assert.strictEqual(requests.length, 1, 'a valid token must not trigger a refresh');
    assert.strictEqual(
      requests[0].headers.Authorization,
      'Bearer access-1',
      'the bearer access token must be attached',
    );
    assert.ok(
      !requests[0].url.includes('/auth/refresh'),
      'no refresh may be attempted for a valid session',
    );
  });

  await test('EVERY protected referral endpoint sends the Authorization header', async () => {
    setSession('access-1', 'refresh-1');
    const calls = [
      ['GET', () => referral.getMyReferral()],
      ['GET', () => referral.getMyReferredUsers()],
      ['GET', () => referral.getMyReferralRewards()],
      ['POST', () => referral.syncMyReferral()],
      ['GET', () => referral.getReferralSettings()],
      ['PATCH', () => referral.updateReferralSettings({ enabled: true })],
      ['GET', () => referral.getReferralStats()],
      ['GET', () => referral.getTopReferrers()],
      ['GET', () => referral.searchReferrers('abc')],
      ['GET', () => referral.searchReferralRewards({ status: 'PENDING' })],
      ['POST', () => referral.adjustReferralReward('reward-1', 100, 'audit reason')],
    ];

    for (const [method, run] of calls) {
      requests = [];
      installFetch(() => jsonResponse(200, { success: true, data: {} }));
      await run();
      assert.strictEqual(requests.length, 1, method + ' must issue exactly one request');
      assert.strictEqual(
        requests[0].headers.Authorization,
        'Bearer access-1',
        method + ' ' + requests[0].url + ' must carry the bearer token',
      );
    }
  });

  await test('an expired access token refreshes the session and retries ONCE', async () => {
    setSession('access-expired', 'refresh-1');
    installFetch((req) => {
      if (req.url.includes('/auth/refresh')) {
        return jsonResponse(200, { success: true, data: SESSION_RESPONSE });
      }
      // The first authenticated attempt is rejected; the retry succeeds.
      if (req.headers.Authorization === 'Bearer access-expired') {
        return jsonResponse(401, { success: false, message: 'Missing access token' });
      }
      return jsonResponse(200, { success: true, data: { enabled: true } });
    });

    const result = await referral.getReferralSettings();

    assert.deepStrictEqual(result, { enabled: true }, 'the retried request must return its data');

    const refreshes = requests.filter((r) => r.url.includes('/auth/refresh'));
    assert.strictEqual(refreshes.length, 1, 'exactly one refresh must be attempted');
    assert.strictEqual(
      global.localStorage.getItem(ACCESS_KEY),
      'access-2',
      'the NEW access token must be saved',
    );
    assert.strictEqual(
      global.localStorage.getItem(REFRESH_KEY),
      'refresh-2',
      'the ROTATED refresh token must be saved',
    );
    assert.ok(
      requests.some((r) => r.headers.Authorization === 'Bearer access-2'),
      'the original request must be retried with the new token',
    );
  });

  await test('there is NO infinite retry loop', async () => {
    setSession('access-1', 'refresh-1');
    installFetch((req) => {
      if (req.url.includes('/auth/refresh')) {
        return jsonResponse(200, { success: true, data: SESSION_RESPONSE });
      }
      // Every authenticated attempt keeps failing.
      return jsonResponse(401, { success: false, message: 'Missing access token' });
    });

    await assert.rejects(
      () => referral.getReferralStats(),
      (error) => error instanceof ApiClientError && error.status === 401,
      'the failure must surface as a 401',
    );

    const refreshes = requests.filter((r) => r.url.includes('/auth/refresh'));
    assert.strictEqual(refreshes.length, 1, 'refresh must be attempted exactly once');
    assert.strictEqual(
      requests.length,
      3,
      'expected: original request + refresh + one retry (got ' +
        requests.map((r) => r.url).join(' -> ') +
        ')',
    );
  });

  await test('an invalid refresh token produces normal session expiration', async () => {
    setSession('access-1', 'refresh-stale');
    installFetch((req) =>
      req.url.includes('/auth/refresh')
        ? jsonResponse(401, { success: false, message: 'Refresh token is invalid' })
        : jsonResponse(401, { success: false, message: 'Missing access token' }),
    );

    await assert.rejects(
      () => referral.getReferralStats(),
      (error) => error instanceof ApiClientError && error.status === 401,
    );

    assert.strictEqual(
      global.localStorage.getItem(ACCESS_KEY),
      null,
      'a definitive refresh failure must clear the session',
    );
    assert.strictEqual(global.localStorage.getItem(REFRESH_KEY), null);
  });

  await test('apiFetch stays anonymous — only authFetch authenticates', async () => {
    setSession('access-1', 'refresh-1');
    installFetch(() => jsonResponse(200, { success: true, data: {} }));

    await apiFetch('/casino/catalog/providers?product=casino');

    assert.strictEqual(
      requests[0].headers.Authorization,
      undefined,
      'the public client must not attach credentials',
    );
  });

  await test('formatMinor renders BDT, USD and EUR with exactly ONE symbol', () => {
    const { formatMinor } = referral;

    assert.strictEqual(formatMinor(0, 'BDT'), '৳0.00');
    assert.strictEqual(formatMinor(25000, 'BDT'), '৳250.00');
    assert.strictEqual(formatMinor(0, 'USD'), '$0.00');
    assert.strictEqual(formatMinor(25000, 'USD'), '$250.00');
    assert.strictEqual(formatMinor(0, 'EUR'), '€0.00');
    assert.strictEqual(formatMinor(25000, 'EUR'), '€250.00');

    // The default currency is BDT.
    assert.strictEqual(formatMinor(25000), '৳250.00');
    // A negative amount keeps exactly one symbol in front.
    assert.strictEqual(formatMinor(-25000, 'USD'), '-$250.00');

    // NO duplicated currency symbols, for any supported currency.
    for (const code of ['BDT', 'USD', 'EUR']) {
      for (const amount of [0, 1, 99, 100, 25000, 123456789, -25000]) {
        const out = formatMinor(amount, code);
        assert.ok(
          !out.includes('৳$') && !out.includes('$৳'),
          'BDT+USD symbols must never be combined, got: ' + out,
        );
        for (const symbol of ['৳', '$', '€']) {
          const occurrences = out.split(symbol).length - 1;
          assert.ok(
            occurrences <= 1,
            'more than one ' + symbol + ' in ' + out + ' (currency ' + code + ')',
          );
        }
      }
    }

    // The database stays in minor units: 25000 minor -> 250.00 major.
    assert.ok(formatMinor(25000, 'BDT').endsWith('250.00'));
  });

  await test('an unknown currency falls back to ONE symbol, never two', () => {
    assert.strictEqual(referral.formatMinor(25000, 'GBP'), '৳250.00');
    assert.strictEqual(referral.formatMinor(25000, ''), '৳250.00');
    assert.ok(!referral.formatMinor(25000, 'GBP').includes('৳$'));
  });

  console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
  if (failures.length > 0) {
    for (const f of failures) {
      console.log('\n--- ' + f.name + '\n' + (f.error && f.error.message));
    }
    process.exit(1);
  }
  console.log('All referral frontend tests passed.');
})();
