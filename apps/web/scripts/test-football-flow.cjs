'use strict';

/**
 * Native Football board — provider-independent UI contract tests.
 *
 * Runs in plain Node (no browser, no build) against the REAL page sources:
 *   1. /football route renders the FootballBoard (real backend data only).
 *   2. FootballBoard reads fixtures/competitions/markets from the existing
 *      backend client (listEvents sport=football, getSportCompetitions,
 *      getEvent) — no fabricated data path exists.
 *   3. Selection add/remove goes through the EXISTING BetSlip context
 *      (addSelection/removeSelection/clearSlip) — no second slip engine.
 *   4. Stake entry + potential return reuse lib/betting (minor units).
 *   5. Real-money submission stays disabled: no placeBet() call exists in the
 *      Football board, and BET_SLIP_ENABLED remains false while
 *      IMPLEMENTED_REAL_OPERATOR_ADAPTERS is empty.
 *
 * Run: node scripts/test-football-flow.cjs (exit 0 = pass).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const webRoot = path.resolve(__dirname, '..');

function read(rel) {
  return fs.readFileSync(path.join(webRoot, rel), 'utf8');
}

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log('  ok ' + name);
  } catch (err) {
    failures += 1;
    console.error('  FAIL ' + name);
    console.error('    ' + (err && err.message ? err.message.split('\n').join('\n    ') : String(err)));
  }
}

const pageSrc = read('app/(user)/football/page.tsx');
const boardSrc = read('components/football/football-board.tsx');
const cardSrc = read('components/football/fixture-card.tsx');
const marketsSrc = read('components/football/fixture-markets.tsx');
const myBetsSrc = read('app/(user)/my-bets/page.tsx');
const featuresSrc = read('config/features.ts');
const factorySrc = read('../../apps/api/src/modules/betting/betting-provider.factory.ts');

test('the /football route renders the native Football board', () => {
  assert.ok(pageSrc.includes('<FootballBoard />'), '/football must render FootballBoard');
  assert.ok(pageSrc.includes("from '@/components/football/football-board'"), 'must import the real board');
});

test('the board reads fixtures from the existing backend (never fabricated)', () => {
  assert.ok(boardSrc.includes("listEvents('ALL', 'football')"), 'fixtures must come from listEvents sport=football');
  assert.ok(boardSrc.includes('getSportCompetitions('), 'competitions must come from the backend client');
  assert.ok(boardSrc.includes('getEvent('), 'markets must come from GET /events/:id');
  assert.ok(
    !/mock|catalog\.ts|sample-odds|demo-odds|hard-?coded-odds/i.test(boardSrc),
    'no fabricated data path',
  );
});

test('live and pre-match sections carry explicit live status', () => {
  assert.ok(boardSrc.includes("'LIVE'"), 'LIVE filter must exist');
  assert.ok(boardSrc.includes('UPCOMING'), 'pre-match filter must exist');
  assert.ok(cardSrc.includes('LIVE'), 'fixture cards must show explicit LIVE status');
});

test('selection add/remove reuses the existing BetSlip context', () => {
  assert.ok(boardSrc.includes('useBetSlip()'), 'board must use the shared slip context');
  assert.ok(boardSrc.includes('slip.addSelection('), 'staging must call addSelection');
  assert.ok(boardSrc.includes('slip.removeSelection()'), 'removal must call removeSelection');
  assert.ok(boardSrc.includes('slip.clearSlip'), 'clear must call clearSlip');
  assert.ok(marketsSrc.includes('onToggleSelection'), 'market buttons must toggle through the board');
});

test('stake entry, odds display and potential return reuse lib/betting', () => {
  assert.ok(boardSrc.includes('calculatePotentialReturn('), 'potential return must reuse lib/betting');
  assert.ok(boardSrc.includes('majorToMinor(') && boardSrc.includes('minorToMajor('), 'stake must convert major/minor');
  assert.ok(boardSrc.includes('formatMoney('), 'money must format in minor units');
});

test('odds-change confirmation pauses before any submission', () => {
  assert.ok(boardSrc.includes('odds_changed'), 'ODDS_CHANGED status must be handled');
  assert.ok(boardSrc.includes('updatePrice('), 'changed odds must update the staged price');
  assert.ok(boardSrc.includes('Confirm odds'), 'explicit confirmation control must exist');
});

test('real-money submission stays disabled (no placeBet in the board)', () => {
  assert.ok(!boardSrc.includes('placeBet('), 'the Football board must never submit a bet');
  assert.ok(boardSrc.includes('never places a bet'), 'the paused-wagering notice must be present');
  assert.ok(featuresSrc.includes('export const BET_SLIP_ENABLED = false'), 'BET_SLIP_ENABLED must stay false');
  assert.ok(
    factorySrc.includes('new Map<') && !/\.set\(/.test(factorySrc),
    'IMPLEMENTED_REAL_OPERATOR_ADAPTERS must stay empty (no .set registration)',
  );
});

test('suspended markets, login, balance, loading, empty and error states exist', () => {
  assert.ok(marketsSrc.includes('suspended'), 'suspended market states required');
  assert.ok(cardSrc.includes('Suspended'), 'suspended fixture states required');
  assert.ok(boardSrc.includes('/login'), 'login state required');
  assert.ok(boardSrc.includes('Wallet balance'), 'wallet balance state required');
  assert.ok(boardSrc.includes('Skeleton'), 'loading state required');
  assert.ok(boardSrc.includes('right now.'), 'empty state required');
  assert.ok(boardSrc.includes('Retry'), 'error retry required');
});

test('bet history covers pending, accepted, rejected, settled and void', () => {
  for (const s of ['PENDING', 'ACCEPTED', 'REJECTED', 'SETTLED', 'VOID']) {
    assert.ok(myBetsSrc.includes(`'${s}'`), `my-bets must include the ${s} filter`);
  }
});

if (failures > 0) {
  console.error(`\n${failures} football test(s) FAILED.`);
  process.exit(1);
}
console.log('\nAll football tests passed.');
