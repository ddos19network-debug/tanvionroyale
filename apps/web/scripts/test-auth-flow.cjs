'use strict';

/**
 * Frontend auth-flow unit tests (no extra dependencies — runs on plain Node).
 *
 * These tests exercise the REAL production modules (no copies, no fakes):
 *   - lib/auth/oauth-callback.ts  — one-time-code single-flight + completion tracking
 *   - lib/api/client.ts          — single-flight refresh rotation, transient vs
 *                                   definitive auth verdicts, session preservation
 *   - lib/api/auth.ts            — transient retry for the one-time OAuth exchange
 *   - lib/auth/session.ts        — save/get/clear token + user persistence
 *
 * Why plain Node: the web app has no JS test framework, and this harness
 * loads the actual TypeScript modules with the @/ alias resolved at runtime.
 * fetch / localStorage / sessionStorage are stubbed at the boundary so no
 * network or browser is required, exactly like a unit test would.
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const Module = require('module');

const webRoot = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// TS + @/ loader (transpile each required .ts through the installed compiler)
// ---------------------------------------------------------------------------
const ts = require(require.resolve('typescript', { paths: [path.join(webRoot, 'node_modules')] }));

require.extensions['.ts'] = function (mod, filename) {
  const source = fs.readFileSync(filename, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: filename,
  });
  mod._compile(outputText, filename);
};

const originalResolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith('@/')) {
    // '@/*' -> './*' relative to the web app root.
    request = path.join(webRoot, request.slice(2));
  }
  return originalResolveFilename.call(this, request, parent, isMain, options);
};

// ---------------------------------------------------------------------------
// Browser-boundary stubs
// ---------------------------------------------------------------------------
function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => void map.clear(),
    _map: map,
  };
}

global.localStorage = createMemoryStorage();
global.sessionStorage = createMemoryStorage();
// window stays undefined — session.ts gates its event dispatch behind
// `typeof window === 'undefined'`, so the store still works headlessly.

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const FAKE_USER = {
  id: 'u1',
  email: 'g@example.com',
  username: 'gamer',
  firstName: null,
  lastName: null,
  phone: null,
  country: null,
  timezone: 'UTC',
  status: 'ACTIVE',
  emailVerified: true,
  phoneVerified: false,
  kycStatus: 'NOT_STARTED',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const TOKEN_PAIR = {
  accessToken: 'new-access',
  refreshToken: 'new-refresh',
  accessTokenExpiresIn: 900,
  user: FAKE_USER,
};

let failures = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log('  \u2714 ' + name);
  } catch (err) {
    failures += 1;
    console.error('  \u2716 ' + name);
    console.error(
      '    ' +
        (err && err.stack
          ? err.stack.split('\n').slice(0, 4).join('\n    ')
          : String(err)),
    );
  }
}

async function main() {
  const oauthCallback = require('../lib/auth/oauth-callback.ts');
  const client = require('../lib/api/client.ts');
  const session = require('../lib/auth/session.ts');
await test('OAuth: same code exchange is single-flight (concurrent duplicates share one POST)', async () => {
    let exchangeCalls = 0;
    global.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/auth/oauth/exchange')) {
        exchangeCalls += 1;
        await new Promise((r) => setTimeout(r, 25));
        return jsonResponse({ success: true, data: TOKEN_PAIR });
      }
      throw new Error('unexpected fetch ' + url);
    };

    const [first, second] = await Promise.all([
      oauthCallback.getOrStartExchange('CODE-SINGLE-FLIGHT'),
      oauthCallback.getOrStartExchange('CODE-SINGLE-FLIGHT'),
    ]);
    assert.strictEqual(exchangeCalls, 1, 'the one-time code must be posted exactly once');
    assert.strictEqual(first.accessToken, TOKEN_PAIR.accessToken);
    assert.strictEqual(second.accessToken, TOKEN_PAIR.accessToken);
  });

  await test('OAuth: StrictMode/remount (effect twice) does not start a second exchange', async () => {
    let exchangeCalls = 0;
    global.fetch = async () => {
      exchangeCalls += 1;
      await new Promise((r) => setTimeout(r, 15));
      return jsonResponse({ success: true, data: TOKEN_PAIR });
    };

    const [p1, p2] = await Promise.all([
      oauthCallback.getOrStartExchange('CODE-REMOUNT'),
      oauthCallback.getOrStartExchange('CODE-REMOUNT'),
    ]);
    await Promise.all([p1, p2]);
    assert.strictEqual(exchangeCalls, 1);
  });

  await test('OAuth: completed-code tracking prevents re-POST after success/refresh', async () => {
    oauthCallback.markExchangeCompleted('CODE-ALREADY-USED');
    assert.strictEqual(oauthCallback.hasExchangeCompleted('CODE-ALREADY-USED'), true);
    assert.strictEqual(oauthCallback.hasExchangeCompleted('CODE-OTHER'), false);

    let exchangeCalls = 0;
    global.fetch = async () => {
      exchangeCalls += 1;
      return jsonResponse({ success: true, data: TOKEN_PAIR });
    };
    const res = await oauthCallback.getOrStartExchange('CODE-SUCCESS');
    oauthCallback.markExchangeCompleted('CODE-SUCCESS');
    assert.strictEqual(oauthCallback.hasExchangeCompleted('CODE-SUCCESS'), true);
    assert.strictEqual(res.refreshToken, TOKEN_PAIR.refreshToken);
    assert.strictEqual(exchangeCalls, 1);
  });

  await test('OAuth: a real 400 rejection is NOT retried (no double submit of the code)', async () => {
    let exchangeCalls = 0;
    global.fetch = async () => {
      exchangeCalls += 1;
      return jsonResponse({ success: false, message: 'Invalid or expired code' }, 400);
    };

    await assert.rejects(
      () => oauthCallback.getOrStartExchange('CODE-EXPIRED'),
      (err) => err.name === 'ApiClientError' && err.status === 400,
    );
    assert.strictEqual(exchangeCalls, 1, 'invalid code must not be retried');
  });

  await test('Session: transient 502s are retried safely and succeed (cold start)', async () => {
    session.saveSession({ accessToken: 'old-access', refreshToken: 'old-refresh', user: FAKE_USER });

    let calls = 0;
    global.fetch = async () => {
      calls += 1;
      if (calls < 3) return jsonResponse({ success: false, message: 'Bad gateway' }, 502);
      return jsonResponse({ success: true, data: TOKEN_PAIR });
    };
    const authApi = require('../lib/api/auth.ts');
    const res = await authApi.exchangeOAuthCode('CODE-COLD-START');
    assert.strictEqual(res.accessToken, 'new-access');
    assert(calls >= 2, 'expected at least one transient retry');
  });
await test('Session: concurrent refreshes produce ONE request and persist the NEW token', async () => {
    session.saveSession({ accessToken: 'old-access', refreshToken: 'rotate-me', user: FAKE_USER });

    let refreshCalls = 0;
    global.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        await new Promise((r) => setTimeout(r, 20));
        return jsonResponse({ success: true, data: TOKEN_PAIR });
      }
      return jsonResponse({ success: false, message: 'expired' }, 401);
    };

    const [ok1, ok2] = await Promise.all([
      client.refreshAuthSession(),
      client.refreshAuthSession(),
    ]);
    assert.strictEqual(refreshCalls, 1, 'only one refresh must run');
    assert.strictEqual(ok1, true);
    assert.strictEqual(ok2, true);

    const stored = session.getSession();
    assert.strictEqual(stored.refreshToken, 'new-refresh', 'new refresh token must be persisted');
    assert.strictEqual(stored.accessToken, 'new-access');
  });

  await test('Session: transient refresh failure PRESERVES the session', async () => {
    session.saveSession({ accessToken: 'old-access', refreshToken: 'rotate-me', user: FAKE_USER });
    global.fetch = async () => {
      throw new TypeError('fetch failed (network)');
    };

    const ok = await client.refreshAuthSession();
    assert.strictEqual(ok, false);
    assert(session.getSession() !== null, 'session must survive a transient failure');
  });

  await test('Session: definitive 401 on refresh clears the session (logs out correctly)', async () => {
    session.saveSession({ accessToken: 'old-access', refreshToken: 'doomed', user: FAKE_USER });
    let refreshCalls = 0;
    global.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return jsonResponse({ success: false, message: 'invalid refresh token' }, 401);
      }
      throw new Error('unexpected ' + url);
    };

    const ok = await client.refreshAuthSession();
    assert.strictEqual(ok, false);
    assert.strictEqual(session.getSession(), null, 'definitive 401 must clear the session');
    assert.strictEqual(refreshCalls, 1);
  });

  await test('Regression: a refresh response WITHOUT user keeps the cached user (no reload logout)', async () => {
    session.saveSession({ accessToken: 'a1', refreshToken: 'r1', user: FAKE_USER });

    global.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/auth/refresh')) {
        // The historical root cause: the backend refresh response omitted
        // `user`, saveSession wrote JSON.stringify(undefined) ("undefined")
        // into the user key, and the NEXT reload parsed garbage and bounced
        // the user to /login.
        return jsonResponse({
          success: true,
          data: { accessToken: 'a2', accessTokenExpiresIn: 900, refreshToken: 'r2' },
        });
      }
      throw new Error('unexpected ' + url);
    };

    const ok = await client.refreshAuthSession();
    assert.strictEqual(ok, true);
    const stored = session.getSession();
    assert.strictEqual(stored.refreshToken, 'r2', 'rotated refresh token must be persisted');
    assert.strictEqual(
      stored.user.id,
      FAKE_USER.id,
      'a userless refresh response must never destroy the cached user',
    );
    assert.notStrictEqual(global.localStorage.getItem('ng.user'), 'undefined');
  });

  await test('Session: corrupted user cache self-heals — tokens kept, session restored via refresh', async () => {
    session.saveSession({ accessToken: 'a1', refreshToken: 'r1', user: FAKE_USER });
    // Simulate the legacy corruption (literal "undefined" string).
    global.localStorage.setItem('ng.user', 'undefined');
    assert.strictEqual(session.getSession(), null, 'corrupt user cache must not parse');
    assert.strictEqual(
      global.localStorage.getItem('ng.refresh'),
      'r1',
      'self-heal must keep the authoritative tokens',
    );

    global.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/auth/refresh')) {
        return jsonResponse({
          success: true,
          data: { ...TOKEN_PAIR, refreshToken: 'r-restored' },
        });
      }
      throw new Error('unexpected ' + url);
    };

    const ok = await client.refreshAuthSession();
    assert.strictEqual(ok, true, 'a valid refresh token must rebuild the session');
    const restored = session.getSession();
    assert.strictEqual(restored.user.id, FAKE_USER.id, 'session restored with its user');
    assert.strictEqual(restored.refreshToken, 'r-restored');
  });

  await test('Session: 401 while ANOTHER tab rotated (stored token changed) does NOT clear the session', async () => {
    session.saveSession({ accessToken: 'old-access', refreshToken: 'stale-token', user: FAKE_USER });

    global.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/auth/refresh')) {
        // The sibling tab won the rotation race and saved the fresh pair
        // before this tab's request came back with a 401 for the stale token.
        session.saveSession({
          accessToken: 'fresh-access',
          refreshToken: 'fresh-refresh',
          user: FAKE_USER,
        });
        return jsonResponse({ success: false, message: 'Invalid refresh token' }, 401);
      }
      throw new Error('unexpected ' + url);
    };

    const ok = await client.refreshAuthSession();
    assert.strictEqual(ok, false);
    const stored = session.getSession();
    assert(stored, 'a stale-token 401 must never log the browser out');
    assert.strictEqual(stored.refreshToken, 'fresh-refresh');
    assert.strictEqual(stored.accessToken, 'fresh-access');
  });

  await test('Session: authFetch retries the original request once after a refresh', async () => {
    session.saveSession({ accessToken: 'old-access', refreshToken: 'rotate-me', user: FAKE_USER });

    let refreshCalls = 0;
    let meCalls = 0;
    global.fetch = async (input) => {
      const url = typeof input === 'string' ? input : input.url;
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return jsonResponse({ success: true, data: TOKEN_PAIR });
      }
      if (url.endsWith('/auth/me') && meCalls === 0) {
        meCalls += 1;
        return jsonResponse({ success: false, message: 'expired access token' }, 401);
      }
      if (url.endsWith('/auth/me')) {
        meCalls += 1;
        return jsonResponse({ success: true, data: FAKE_USER });
      }
      throw new Error('unexpected ' + url);
    };

    const me = await client.authFetch('/auth/me');
    assert.strictEqual(me.username, FAKE_USER.username);
    assert.strictEqual(refreshCalls, 1);
    assert.strictEqual(meCalls, 2, 'original request retried once after refresh');
  });
await test('Errors: only 401/403 are definitive auth verdicts', async () => {
    const make = (status) => new client.ApiClientError('m', status);
    assert.strictEqual(client.isDefinitiveAuthError(make(401)), true);
    assert.strictEqual(client.isDefinitiveAuthError(make(403)), true);
    assert.strictEqual(client.isDefinitiveAuthError(make(500)), false);
    assert.strictEqual(client.isDefinitiveAuthError(make(502)), false);
    assert.strictEqual(client.isDefinitiveAuthError(make(503)), false);
    assert.strictEqual(client.isDefinitiveAuthError(make(504)), false);
    assert.strictEqual(client.isDefinitiveAuthError(new Error('network')), false);
  });

  await test('Session store: save/get/update/clear round-trips token pair + user', async () => {
    session.saveSession({ accessToken: 'a1', refreshToken: 'r1', user: FAKE_USER });
    let stored = session.getSession();
    assert.strictEqual(stored.accessToken, 'a1');
    assert.strictEqual(stored.refreshToken, 'r1');
    assert.strictEqual(stored.user.id, FAKE_USER.id);

    const updated = session.updateStoredUser({ ...FAKE_USER, phoneVerified: true });
    assert.strictEqual(updated.user.phoneVerified, true);
    stored = session.getSession();
    assert.strictEqual(stored.user.phoneVerified, true);

    session.clearSession('logout');
    assert.strictEqual(session.getSession(), null);
  });

  // ---------------------------------------------------------------------------
  // Unified customer login — loginWithIdentifier (email OR phone, one field)
  // ---------------------------------------------------------------------------
  await test('Login: loginWithIdentifier POSTs {identifier,password} to /auth/login', async () => {
    const authApi = require('../lib/api/auth.ts');
    let captured = null;
    global.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      assert(url.endsWith('/auth/login'), 'must hit the unified endpoint, got ' + url);
      captured = JSON.parse(init.body);
      return jsonResponse({ success: true, data: TOKEN_PAIR });
    };

    const res = await authApi.loginWithIdentifier(' owner@gmail.com ', 'Str0ngPass1!');
    assert.deepStrictEqual(captured, {
      identifier: ' owner@gmail.com ',
      password: 'Str0ngPass1!',
    });
    assert.strictEqual(res.accessToken, TOKEN_PAIR.accessToken);
    assert.strictEqual(res.refreshToken, TOKEN_PAIR.refreshToken);
  });

  await test('Login: the SAME function handles a phone identifier (no second flow)', async () => {
    const authApi = require('../lib/api/auth.ts');
    let captured = null;
    global.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input.url;
      assert(url.endsWith('/auth/login'), 'phone login must use the unified endpoint');
      captured = JSON.parse(init.body);
      return jsonResponse({ success: true, data: TOKEN_PAIR });
    };

    const res = await authApi.loginWithIdentifier('+447911123456', 'Str0ngPass1!');
    assert.strictEqual(captured.identifier, '+447911123456');
    assert.strictEqual(res.accessToken, TOKEN_PAIR.accessToken);
  });

  await test('Login: a 401 rejection propagates as ApiClientError (no false success)', async () => {
    const authApi = require('../lib/api/auth.ts');
    global.fetch = async () =>
      jsonResponse({ success: false, message: 'Invalid credentials' }, 401);
    await assert.rejects(
      () => authApi.loginWithIdentifier('someone@example.com', 'WrongPass1!'),
      (err) => err.name === 'ApiClientError' && err.status === 401,
    );
  });

  await test('Login page: single "Email or Phone Number" field calls loginWithIdentifier', () => {
    const src = fs.readFileSync(
      path.join(webRoot, 'app/(auth)/login/page.tsx'),
      'utf8',
    );
    assert(src.includes('loginWithIdentifier('), 'login page must use the unified function');
    assert(src.includes('Email or Phone Number'), 'label must offer both identifier kinds');
    assert(src.includes('placeholder="Email or phone number"'), 'placeholder must match Part 21');
    assert(!src.includes('loginWithPhone'), 'the old phone-only call must be gone');
    assert(!src.includes('/auth/phone/login'), 'the login page must not hit the phone endpoint');
    // Visual/behaviour contract preserved (Part 21).
    assert(src.includes('Continue with Google'), 'Google login must be preserved');
    assert(src.includes('Continue with Facebook'), 'Facebook login must be preserved');
    assert(src.includes('Forgot password?'), 'Forgot password must be preserved');
    assert(src.includes('Create account'), 'Create account must be preserved');
    assert(src.includes('sanitizeNextPath'), 'next-path behaviour must be preserved');
    assert(src.includes("'/verification'"), 'verification routing must be preserved');
  });

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  if (failures > 0) {
    console.error(`\n${failures} frontend auth-flow test(s) FAILED.`);
    process.exit(1);
  }
  console.log('\nAll frontend auth-flow tests passed.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});