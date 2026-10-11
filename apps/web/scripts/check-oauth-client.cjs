'use strict';
/**
 * Runtime regression tests for the frontend API client.
 *
 * Runs the REAL TypeScript sources (lib/api/client.ts + lib/api/auth.ts),
 * transpiled in-memory with the TypeScript compiler API, against a stubbed
 * global fetch. Nothing is re-implemented or mocked away — the exact modules
 * the browser runs are exercised, pinning the production URL contract:
 *
 *   getApiBaseUrl()   === NEXT_PUBLIC_API_URL (verbatim, trailing slashes trimmed)
 *   exchangeOAuthCode -> POST ${base}/auth/oauth/exchange (exactly once,
 *                        never retried after a real API rejection)
 *
 * Usage: pnpm --filter @tanvion-royale/web test
 */
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const PROD_API_URL = 'https://tanvionroyale.onrender.com/api/v1';
const EXCHANGE_PATH = '/auth/oauth/exchange';

const srcDir = path.join(__dirname, '..', 'lib', 'api');
const compilerOptions = {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2019,
  esModuleInterop: true,
};

function loadModule(fileName, resolve) {
  const source = fs.readFileSync(path.join(srcDir, fileName), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions }).outputText;
  const module = { exports: {} };
  const fn = new Function('module', 'exports', 'require', js);
  fn(module, module.exports, resolve);
  return module.exports;
}

const sessionStub = {
  clearSession() {},
  getAccessToken() {
    return null;
  },
  saveSession() {},
};

const client = loadModule('client.ts', (id) => {
  if (id === '@/lib/auth/session') return sessionStub;
  throw new Error(`client.ts unexpectedly requires "${id}"`);
});
const auth = loadModule('auth.ts', (id) => {
  if (id === './client') return client;
  throw new Error(`auth.ts unexpectedly requires "${id}"`);
});

const originalFetch = global.fetch;
const originalApiUrl = process.env.NEXT_PUBLIC_API_URL;
const originalNodeEnv = process.env.NODE_ENV;

function withEnv(apiUrl, nodeEnv) {
  if (apiUrl === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = apiUrl;
  process.env.NODE_ENV = nodeEnv;
}

async function main() {
  // --- 1. Production API URL construction ----------------------------------
  withEnv(PROD_API_URL, 'production');
  assert.strictEqual(client.getApiBaseUrl(), PROD_API_URL, 'production base URL');

  withEnv(`${PROD_API_URL}/`, 'production');
  assert.strictEqual(client.getApiBaseUrl(), PROD_API_URL, 'trailing slash is trimmed');

  // --- 2. NEVER a silent localhost fallback in production ------------------
  withEnv(undefined, 'production');
  assert.throws(
    () => client.getApiBaseUrl(),
    /NEXT_PUBLIC_API_URL/,
    'production requires NEXT_PUBLIC_API_URL',
  );

  // --- 3. Development keeps the documented localhost fallback --------------
  withEnv(undefined, 'development');
  assert.strictEqual(client.getApiBaseUrl(), 'http://localhost:3000/api/v1', 'dev fallback');

  // --- 4. exchangeOAuthCode posts EXACTLY ONCE to the exact production URL -
  withEnv(PROD_API_URL, 'production');
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        data: {
          accessToken: 'at',
          accessTokenExpiresIn: 900,
          refreshToken: 'rt',
          user: { id: 'u1' },
        },
      }),
    };
  };
  const code = 'c'.repeat(32);
  const session = await auth.exchangeOAuthCode(code);
  assert.strictEqual(calls.length, 1, 'exactly one network call');
  assert.strictEqual(calls[0].url, `${PROD_API_URL}${EXCHANGE_PATH}`, 'exact exchange URL');
  assert.strictEqual(calls[0].url.split('/api/v1/').length - 1, 1, 'no double /api/v1');
  assert.strictEqual(calls[0].url.includes('localhost'), false, 'never localhost in production');
  assert.strictEqual(calls[0].init.method, 'POST');
  assert.strictEqual(calls[0].init.headers['Content-Type'], 'application/json');
  assert.strictEqual(calls[0].init.body, JSON.stringify({ code }));
  assert.strictEqual(session.accessToken, 'at', 'envelope unwrapped to the session');

  // --- 5. A rejected (400) code is NOT retried (protects one-time use) ----
  calls.length = 0;
  global.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return {
      ok: false,
      status: 400,
      json: async () => ({ message: 'Invalid or expired authorization code' }),
    };
  };
  await assert.rejects(
    () => auth.exchangeOAuthCode('b'.repeat(32)),
    (err) => err instanceof client.ApiClientError && err.status === 400,
    '400 surfaces as ApiClientError',
  );
  assert.strictEqual(calls.length, 1, 'no retry after a real API rejection');

  console.log('PASS production API URL contract (exact base URL, no localhost, no double /api/v1)');
  console.log('PASS exchange posts exactly once to the exact production exchange URL');
  console.log('PASS one-time code is NOT retried after a real API rejection');
  console.log('ALL FRONTEND API CLIENT CHECKS PASSED');
}

main()
  .catch((err) => {
    console.error('FAIL', err && err.message ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => {
    global.fetch = originalFetch;
    withEnv(originalApiUrl, originalNodeEnv ?? 'test');
  });