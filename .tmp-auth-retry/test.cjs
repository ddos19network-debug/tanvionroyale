'use strict';
// Runtime verification for the OAuth exchange retry wrapper in
// apps/web/lib/api/auth.ts — runs the REAL transpiled auth.js + client.js
// with a mocked global fetch. Not part of the repo; temp scratch test.
const assert = require('node:assert');

// Record setTimeout delays without actually waiting (fast + exact assertions).
const recordedDelays = [];
const realSetTimeout = global.setTimeout;
global.setTimeout = (fn, ms, ...rest) => {
  if (typeof ms === 'number') recordedDelays.push(ms);
  return realSetTimeout(fn, 1, ...rest);
};

// Mock fetch backed by a per-scenario response queue.
let queue = [];
const fetchCalls = [];
global.fetch = async (url, init) => {
  fetchCalls.push({ url, init });
  const next = queue.shift();
  if (!next) throw new Error('mock fetch queue empty');
  return next();
};

const { ApiClientError } = require('./client.js');
const { exchangeOAuthCode } = require('./auth.js');

const json = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
const okSession = {
  success: true,
  data: { accessToken: 'at', accessTokenExpiresIn: 900, refreshToken: 'rt', user: { id: 'u1' } },
};
const netErr = () => {
  throw new TypeError('fetch failed');
};

async function run(name, responses, expectDelays, check) {
  queue = responses;
  fetchCalls.length = 0;
  recordedDelays.length = 0;
  let result;
  let error;
  try {
    result = await exchangeOAuthCode('one-time-code');
  } catch (e) {
    error = e;
  }
  try {
    assert.deepStrictEqual(recordedDelays, expectDelays, `${name}: delays`);
    assert.strictEqual(fetchCalls.length, expectDelays.length + 1, `${name}: call count`);
    assert.strictEqual(fetchCalls[0].init.method, 'POST', `${name}: method`);
    assert.strictEqual(
      fetchCalls[0].init.body,
      JSON.stringify({ code: 'one-time-code' }),
      `${name}: body`,
    );
    assert.strictEqual(fetchCalls[0].init.headers['Content-Type'], 'application/json');
    assert.strictEqual(fetchCalls[0].init.cache, 'no-store');
    assert.ok(fetchCalls[0].url.endsWith('/auth/oauth/exchange'), `${name}: path`);
    if (check) check(result, error);
    console.log(`PASS ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

(async () => {
  await run(
    'A: 502 -> 503 -> 200 succeeds after 2 retries',
    [() => json(502, { message: 'Bad gateway' }), () => json(503, {}), () => json(200, okSession)],
    [1500, 3000],
    (result, error) => {
      assert.ok(result && !error, 'expected eventual success');
      assert.strictEqual(result.accessToken, 'at');
    },
  );

  await run(
    'B: 502 x3 exhausts retries and rethrows ApiClientError(502)',
    [() => json(502, {}), () => json(502, {}), () => json(502, {})],
    [1500, 3000],
    (result, error) => {
      assert.ok(!result && error instanceof ApiClientError, 'expected ApiClientError');
      assert.strictEqual(error.status, 502);
    },
  );

  await run(
    'C: 400 invalid code is NOT retried',
    [() => json(400, { message: 'invalid or expired code' })],
    [],
    (result, error) => {
      assert.ok(!result && error instanceof ApiClientError && error.status === 400);
    },
  );

  await run(
    'D: 401 is NOT retried',
    [() => json(401, { message: 'unauthorized' })],
    [],
    (result, error) => {
      assert.ok(!result && error instanceof ApiClientError && error.status === 401);
    },
  );

  await run(
    'E: 500 (real server error, not gateway) is NOT retried',
    [() => json(500, { message: 'boom' })],
    [],
    (result, error) => {
      assert.ok(!result && error instanceof ApiClientError && error.status === 500);
    },
  );

  await run(
    'F: network error -> 502 -> 200 succeeds',
    [netErr, () => json(502, {}), () => json(200, okSession)],
    [1500, 3000],
    (result) => assert.ok(result && result.accessToken === 'at'),
  );

  await run(
    'G: network error x3 rethrows the raw network error',
    [netErr, netErr, netErr],
    [1500, 3000],
    (result, error) => assert.ok(!result && error instanceof TypeError, 'expected TypeError'),
  );

  await run(
    'H: network error then 400 surfaces 400 after exactly 1 retry',
    [netErr, () => json(400, { message: 'invalid or expired code' })],
    [1500],
    (result, error) => {
      assert.ok(!result && error instanceof ApiClientError && error.status === 400);
    },
  );

  console.log(process.exitCode ? 'SOME SCENARIOS FAILED' : 'ALL SCENARIOS PASSED');
})();
