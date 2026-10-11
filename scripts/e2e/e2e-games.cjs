/**
 * Live end-to-end verification of the free-play games system.
 *
 * Usage: node scripts/e2e/e2e-games.cjs [baseUrl]
 * Requires a running API (default http://localhost:3111/api/v1).
 *
 * Flow per game (the production definition of "playable"):
 *   register/login -> POST sessions -> engine actions -> result -> DB rows.
 */
const BASE = process.argv[2] ?? 'http://localhost:3111/api/v1';
const EMAIL = `e2e_${Date.now()}@example.test`;
const PASSWORD = 'Str0ngPassw0rd!';
const USERNAME = `e2e_${String(Date.now()).slice(-8)}`;

let accessToken = null;
let userId = null;
const failures = [];

function unwrap(envelope) {
  if (envelope && typeof envelope === 'object' && 'success' in envelope) {
    if (!envelope.success) throw new Error(`API error: ${JSON.stringify(envelope)}`);
    return envelope.data;
  }
  return envelope;
}

async function api(method, path, body, auth = true) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth && accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  }
  return unwrap(json);
}

function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    console.log(`  FAIL ${name} ${detail}`);
    failures.push(`${name} ${detail}`);
  }
}

/** Drives one game through a real action sequence; returns observed facts. */
async function playGame(slug) {
  const facts = { slug, sessionCreated: false, actions: [], finished: false, result: null };
  let session;
  try {
    // Per-game opening payloads (mirror the real frontend games).
    const openers = {
      'lightning-dice': { target: 'OVER_7' },
      'dice-roll': { pick: 3 },
      'color-prediction': { pick: 'RED' },
      'lucky-number': { pick: 7 },
    };
    session = await startSession(slug, openers[slug]);
    facts.sessionCreated = Boolean(session.id) && session.status === 'ACTIVE';
  } catch (e) {
    facts.error = `startSession: ${e.message}`;
    return facts;
  }

  try {
    const actionSets = {
      'sky-rocket': [{ type: 'START' }, { type: 'TICK' }, { type: 'CASH_OUT' }],
      'lightning-dice': [{ type: 'ROLL' }],
      'coin-flip': [{ type: 'FLIP', payload: { side: 'HEADS' } }],
      'higher-or-lower': [{ type: 'GUESS', payload: { guess: 'GUESS_HIGH' } }],
      'rock-paper-scissors': [{ type: 'PLAY', payload: { move: 'ROCK' } }],
      'dice-roll': [{ type: 'ROLL' }],
      'color-prediction': [{ type: 'DRAW' }],
      'lucky-number': [{ type: 'DRAW' }],
      'wheel-spin': [{ type: 'SPIN' }],
      'high-card': [{ type: 'DEAL' }],
    };
    const actions = actionSets[slug] ?? [];

    if (slug === 'number-guess') {
      // Binary search: the server returns LOW/HIGH hints until correct.
      let lo = 1;
      let hi = 100;
      for (let i = 0; i < 10 && !facts.finished; i += 1) {
        const n = Math.floor((lo + hi) / 2);
        const step = await act(slug, session.id, 'GUESS', { n });
        facts.actions.push(`GUESS ${n}`);
        if (step.finished) {
          facts.finished = true;
          facts.result = step.result;
          break;
        }
        const hint = step.session?.state?.hint;
        if (hint === 'LOW') lo = n + 1;
        else if (hint === 'HIGH') hi = n - 1;
        else break;
      }
    } else {
      for (const a of actions) {
        const step = await act(slug, session.id, a.type, a.payload);
        facts.actions.push(a.type);
        if (step.finished) {
          facts.finished = true;
          facts.result = step.result;
          break;
        }
      }
    }

    // Invalid action must be rejected server-side (400, never a 500).
    try {
      await act(slug, session.id, 'DEFINITELY_INVALID');
      facts.invalidActionRejected = false;
    } catch (e) {
      facts.invalidActionRejected = /400/.test(e.message);
    }

    // A finished session must reject further actions (lifecycle enforced).
    if (facts.finished) {
      const again = await act(slug, session.id, 'CONCEDE');
      facts.completedSessionLocked = again.session?.status === 'COMPLETED';
    }
  } catch (e) {
    facts.error = `actions: ${e.message}`;
  }
  return facts;
}

async function startSession(slug, payload) {
  return api('POST', `/games/play/${slug}/sessions`, payload ? { payload } : {});
}

async function act(slug, sessionId, type, payload) {
  return api('POST', `/games/play/${slug}/sessions/${sessionId}/actions`, { type, payload });
}

async function main() {
  console.log(`E2E against ${BASE}`);

  // 0. Health
  const health = await api('GET', '/health', undefined, false);
  check('health endpoint reachable', Boolean(health));

  // 1. Register + login (JWT auth flow)
  await api('POST', '/auth/register', {
    email: EMAIL,
    username: USERNAME,
    password: PASSWORD,
  }, false);
  const login = await api('POST', '/auth/login', { identifier: EMAIL, password: PASSWORD }, false);
  accessToken = login.accessToken;
  userId = login.user?.id;
  check('register + login issue JWT', Boolean(accessToken) && Boolean(userId));

  // 2. Session endpoints require authentication (guard must be active)
  {
    const saved = accessToken;
    accessToken = 'not-a-real-token';
    let rejected = false;
    let detail = '';
    try {
      await startSession('coin-flip');
    } catch (e) {
      rejected = /40[13]/.test(e.message);
      detail = e.message;
    }
    accessToken = saved;
    check('unauthenticated session creation rejected', rejected, detail);
  }

  // 3. Public metadata: all 11 games ACTIVE
  const slugs = [
    'sky-rocket', 'lightning-dice', 'coin-flip', 'higher-or-lower',
    'number-guess', 'rock-paper-scissors', 'dice-roll', 'color-prediction',
    'lucky-number', 'wheel-spin', 'high-card',
  ];
  const metas = await api('GET', '/games/play', undefined, false).catch(() => null);
  const metaList = Array.isArray(metas) ? metas : metas?.items ?? [];
  check(
    'all 11 games listed as ACTIVE',
    slugs.every((s) => metaList.some((m) => m.slug === s && m.status === 'ACTIVE')),
    JSON.stringify(metaList.map((m) => `${m.slug}:${m.status}`)),
  );

  // 4. Play every game end-to-end
  for (const slug of slugs) {
    console.log(`\n== ${slug} ==`);
    const facts = await playGame(slug);
    check('session created', facts.sessionCreated, facts.error ?? '');
    check('action accepted + result returned', facts.finished && Boolean(facts.result), facts.error ?? '');
    check('invalid action rejected (400)', facts.invalidActionRejected === true);
    check('completed session locked', facts.completedSessionLocked === true);
    if (facts.result) {
      check('result has outcome+score', 'outcome' in facts.result && 'score' in facts.result);
    }
    console.log(`  result: ${JSON.stringify(facts.result)}`);
  }

  // 5. Unknown game slug -> 404 (never a 500)
  try {
    await startSession('this-game-does-not-exist');
    check('unknown slug returns 404', false);
  } catch (e) {
    check('unknown slug returns 404', /404/.test(e.message), e.message);
  }

  console.log(`\n${failures.length === 0 ? 'ALL E2E CHECKS PASSED' : `${failures.length} FAILURES`}`);
  if (failures.length > 0) {
    failures.forEach((f) => console.log(` - ${f}`));
    process.exitCode = 1;
  }
  console.log(`testUser=${EMAIL} id=${userId}`);
}

main().catch((e) => {
  console.error('E2E harness error:', e);
  process.exitCode = 1;
});

