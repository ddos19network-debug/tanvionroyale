'use strict';
/**
 * Sky Rocket presentation + snapshot-reconciliation regression test.
 *
 * Runs in plain Node (no browser, no build) by transpiling the app's own
 * TypeScript on the fly, and asserts the two things that made the scene look
 * broken in production:
 *
 *   1. lib/crash-presentation.ts — a MULTIPLIER_UPDATE promotes a BETTING_OPEN
 *      round to RUNNING (so the flight starts at 1.00×), and every stale /
 *      foreign / regressed / malformed snapshot is rejected, including a delayed
 *      RUNNING frame that must never overwrite a CRASHED round.
 *   2. components/games/crash-rocket.tsx — server-multiplier-driven position
 *      (landmarks stay on the take-off curve and climb monotonically, invalid
 *      multipliers fall back to the pad), the trimmed plane asset at the launch
 *      anchor, and a visible burning plane at the crash impact.
 *
 * Run: node scripts/test-crash-presentation.cjs   (exit 0 = pass)
 * The real-browser sibling is scripts/test-sky-rocket-browser.cjs.
 */
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const web = path.join(__dirname, '..');
const ts = require(path.join(web, 'node_modules/typescript'));

require.extensions['.ts'] = function (mod, filename) {
  const src = fs.readFileSync(filename, 'utf8');
  mod._compile(ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, filename);
};
require.extensions['.tsx'] = function (mod, filename) {
  const src = fs.readFileSync(filename, 'utf8');
  mod._compile(ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020,
      esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: filename,
  }).outputText, filename);
};

const pres = require(path.join(web, 'lib/crash-presentation.ts'));
// ---------------------------------------------------------------------------
// 1. Snapshot reconciliation (the reason the plane never left the pad)
// ---------------------------------------------------------------------------
const base = {
  gameSlug: 'crash', mode: 'FREE_PLAY', enabled: true, realMoneyAvailable: false,
  myBet: null, lastCrash: null,
  sequence: { active: false, mode: 'NEW_SEQUENCE', lastIndex: null, label: null },
  config: { minStake: 1, maxStake: 100, currency: 'FREEPLAY', bettingDurationMs: 5000, nextRoundDelayMs: 1000 },
};
const betting = {
  ...base,
  round: {
    id: 'r1', roundNumber: 7, gameSlug: 'crash', mode: 'FREE_PLAY', status: 'BETTING_OPEN',
    startAt: new Date(1000).toISOString(), startedAt: null, bettingCloseAt: new Date(9000).toISOString(),
    crashAt: null, crashMultiplier: null, serverSeedHash: 'h', clientSeed: 'c', nonce: 1,
    algorithmVersion: 'v1', crashSource: 'PROVABLY_FAIR', sequenceMode: null, sequenceIndex: null,
    bettingOpen: true, serverTime: new Date(2000).toISOString(), currentMultiplier: null,
    revealedSeed: null, crashed: false,
  },
};
const ev = { roundId: 'r1', roundNumber: 7, state: 'RUNNING', serverTime: 3000, startAt: 1000, bettingCloseAt: 2000, multiplier: 1.5 };

const next = pres.applyRunningUpdate(betting, ev);
assert.equal(next.round.status, 'RUNNING');
assert.equal(next.round.bettingOpen, false);
assert.equal(next.round.currentMultiplier, 1.5);
assert.equal(next.round.serverTime, new Date(3000).toISOString());
console.log('PASS: MULTIPLIER_UPDATE promotes a BETTING_OPEN round to RUNNING at 1.50× (root-cause fix)');

assert.equal(pres.applyRunningUpdate(betting, { ...ev, roundId: 'other' }), betting);
assert.equal(pres.applyRunningUpdate(betting, { ...ev, state: 'BETTING_OPEN' }), betting);
assert.equal(pres.applyRunningUpdate(next, { ...ev, serverTime: 2500, multiplier: 1.4 }), next);
assert.equal(pres.applyRunningUpdate(next, { ...ev, multiplier: 0.9 }), next);
assert.equal(pres.applyRunningUpdate(next, { ...ev, serverTime: NaN }), next);
const crashedSnap = {
  ...next,
  round: {
    ...next.round, status: 'CRASHED', serverTime: new Date(4000).toISOString(),
    crashMultiplier: 2.1, currentMultiplier: 2.1, crashed: true, bettingOpen: false,
  },
};
assert.equal(pres.applyRunningUpdate(crashedSnap, ev), crashedSnap);
assert.equal(pres.applyRunningUpdate(null, ev), null);
console.log('PASS: foreign-round / non-running / stale / regressed / malformed / crashed / null inputs all rejected (7 guards)');

const staleRunning = {
  ...base,
  round: { ...crashedSnap.round, status: 'RUNNING', crashMultiplier: null, crashed: false, serverTime: new Date(5000).toISOString() },
};
assert.equal(pres.isOlderSnapshot(crashedSnap, staleRunning), true);
console.log('PASS: delayed RUNNING snapshot cannot overwrite a CRASHED round');
// ---------------------------------------------------------------------------
// 2. Server-multiplier-driven flight geometry (rendered markup + landmarks)
// ---------------------------------------------------------------------------
const React = require(path.join(web, 'node_modules/react'));
const RD = require(path.join(web, 'node_modules/react-dom/server'));
const rocket = require(path.join(web, 'components/games/crash-rocket.tsx'));

const bettingHtml = RD.renderToStaticMarkup(React.createElement(rocket.CrashRocketScene, {
  displayMultiplier: 1, crashMultiplier: null, roundId: 'r1', phase: 'BETTING', bettingCloseAtMs: null,
}));
assert.ok(bettingHtml.includes('data-flight-position') && bettingHtml.includes('sky-rocket-reference-jet.png'));
assert.ok(bettingHtml.includes('translate3d(16%, 80%, 0)'));
console.log('PASS: BETTING renders the trimmed plane at the launch anchor (16% / 80%)');

const runningHtml = RD.renderToStaticMarkup(React.createElement(rocket.CrashRocketScene, {
  displayMultiplier: 2, crashMultiplier: null, roundId: 'r1', phase: 'RUNNING', bettingCloseAtMs: null,
}));
const { left: lx, top: ty } = rocket.rocketPosition(2);
assert.ok(runningHtml.includes(`transform:translate3d(${lx}%, ${ty}%, 0)`), 'position layer transform missing');
assert.ok(!runningHtml.includes('transition:'), 'flight position must never be CSS-transitioned');
console.log(`PASS: RUNNING at 2.00× positions the plane at ${lx}% / ${ty}% (server-multiplier-driven)`);

const crashHtml = RD.renderToStaticMarkup(React.createElement(rocket.CrashRocketScene, {
  displayMultiplier: 2.5, crashMultiplier: 2.5, roundId: 'r1', phase: 'CRASHED', bettingCloseAtMs: null,
}));
assert.ok(crashHtml.includes('sky-rocket-reference-jet.png') && crashHtml.includes('sr-jet-burning') && crashHtml.includes('sr-jet-fire'));
console.log('PASS: CRASHED mount keeps the reference jet visible with burning/fire/smoke impact presentation');
let previous = rocket.rocketPosition(1);
for (let i = 1; i <= 1000; i++) {
  const point = rocket.rocketPosition(Math.exp(i / 100));
  assert.ok(point.left >= previous.left && point.top <= previous.top, 'flight must climb monotonically');
  assert.ok(point.left <= 88 && point.top >= 12, 'flight stays within the curve bounds');
  previous = point;
}
console.log('PASS: 1000 exponential multipliers climb monotonically and stay inside the curve bounds');

for (const m of [NaN, Infinity, -1, 0]) assert.deepEqual(rocket.rocketPosition(m), { left: 16, top: 80 });
console.log('PASS: invalid multipliers (NaN / Infinity / 0 / −1) fall back to the launch pad, never NaN transforms');

assert.ok(ty > 80 - ((lx - 16) * 68) / 72 + 5, 'path must visibly bow below the straight diagonal');
assert.ok(!runningHtml.includes('sr-launch '), 'a RUNNING refresh must not replay the take-off smoke');
assert.ok(
  crashHtml.includes('sr-aftermath') && !crashHtml.includes('sr-flash ') && crashHtml.includes('sr-jet-fire'),
  'an already-crashed mount must use frozen aftermath, never replay the transient flash',
);
assert.ok(runningHtml.includes(' Q '), 'the flight trail uses a quadratic curve');
console.log('PASS: the take-off path bows below the straight diagonal, uses a Q curve, and never replays take-off effects on reconnect');

for (const m of [1, 1.2, 3, 10, 100]) {
  console.log('LANDMARK', m, rocket.rocketProgress(m), rocket.rocketPosition(m));
}

console.log('ALL CRASH PRESENTATION TESTS PASSED');