/**
 * Ad-hoc smoke check for the Royale Ace engine (not part of the Jest suite).
 * Run with: pnpm --filter api exec ts-node -r tsconfig-paths/register
 *   src/modules/royale/ace/ace-smoke.ts
 */

import { DEFAULT_ACE_CONFIG, validateAceConfig, isAceConfigValid } from './ace-config';
import { evaluateWays, countScatters, ladderMultiplierBp, type AceGrid, type AceCell } from './ace-math';
import { generateAceRound, verifyAceSpin, HmacRandomStream, aceCommitment } from './ace-fair';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function col(cells: AceCell['symbol'][]): AceCell[] {
  return cells.map((symbol) => ({ symbol, golden: false }));
}

console.log('config validity');
const issues = validateAceConfig(DEFAULT_ACE_CONFIG);
check('default config is valid', issues.length === 0, JSON.stringify(issues));
check('isAceConfigValid agrees', isAceConfigValid(DEFAULT_ACE_CONFIG));

console.log('ways evaluator');
// SPADE on reels 0,1,2 only: reel0 has 1, reel1 has 2, reel2 has 1 => run 3, ways 2.
const grid1: AceGrid = [
  col(['SPADE', 'HEART', 'DIAMOND', 'CLUB']),
  col(['SPADE', 'SPADE', 'K', 'Q']),
  col(['SPADE', 'K', 'Q', 'J']),
  col(['K', 'Q', 'J', 'A']),
  col(['K', 'Q', 'J', 'A']),
];
const wins1 = evaluateWays(grid1, DEFAULT_ACE_CONFIG);
check('only SPADE wins', wins1.length === 1, JSON.stringify(wins1.map((w) => w.symbol)));
check('run length is 3', wins1[0]?.runLength === 3, String(wins1[0]?.runLength));
check('ways = 2', wins1[0]?.ways === 2, String(wins1[0]?.ways));
check('payBp = 724 (2 ways x 362 bp)', wins1[0]?.payBp === 724, String(wins1[0]?.payBp));

console.log('wild substitution');
const grid2: AceGrid = [
  col(['A', 'Q', 'K', 'J']),
  col(['WILD', 'K', 'Q', 'J']),
  col(['A', 'J', 'Q', 'K']),
  col(['CLUB', 'HEART', 'SPADE', 'DIAMOND']),
  col(['SPADE', 'DIAMOND', 'CLUB', 'HEART']),
];
const wins2 = evaluateWays(grid2, DEFAULT_ACE_CONFIG);
check('wild extends A to 3 reels', wins2.some((w) => w.symbol === 'A' && w.runLength === 3));
check('wild does NOT pay as scatter', countScatters(grid2) === 0);

console.log('wild never substitutes for scatter');
// A on reel0, WILD on reel1, then A on reels 2,3,4 with 3 per reel.
// Run = 5 reels, ways = 1*1*3*3*3 = 27, and the WILD is NOT a scatter.
const grid3: AceGrid = [
  col(['SCATTER', 'A', 'K', 'Q']),
  col(['WILD', 'K', 'Q', 'J']),
  col(['A', 'A', 'A', 'J']),
  col(['A', 'A', 'A', 'K']),
  col(['A', 'A', 'A', 'Q']),
];
const wins3 = evaluateWays(grid3, DEFAULT_ACE_CONFIG);
check('A wins all 5 reels', wins3.some((w) => w.symbol === 'A' && w.runLength === 5));
check('ways = 27', wins3[0]?.ways === 27, String(wins3[0]?.ways));
check('scatter count is 1', countScatters(grid3) === 1);

console.log('ladder');
check('base step 1 = x1', ladderMultiplierBp(DEFAULT_ACE_CONFIG.baseLadderBp, 1) === 10_000);
check('base step 4 = x5', ladderMultiplierBp(DEFAULT_ACE_CONFIG.baseLadderBp, 4) === 50_000);
check('base repeats x5 beyond ladder', ladderMultiplierBp(DEFAULT_ACE_CONFIG.baseLadderBp, 9) === 50_000);
check('fs step 1 = x2', ladderMultiplierBp(DEFAULT_ACE_CONFIG.freeSpinLadderBp, 1) === 20_000);
check('fs step 4 = x10', ladderMultiplierBp(DEFAULT_ACE_CONFIG.freeSpinLadderBp, 4) === 100_000);

console.log('round statistics (rough, 200k rounds)');
const ITERATIONS = 200_000;
const stake = 1_000;
let triggers = 0;
let retriggers = 0;
let totalSpins = 0;
let cascadeSum = 0;
let totalStaked = 0;
let totalWon = 0;
let maxSeen = 0;
for (let i = 0; i < ITERATIONS; i += 1) {
  const round = generateAceRound(
    DEFAULT_ACE_CONFIG,
    { serverSeed: `srv-${i}`, clientSeed: 'smoke', nonce: i },
    stake,
  );
  totalSpins += 1 + round.freeSpinsPlayed;
  if (round.baseSpin.scatterCount >= 3) triggers += 1;
  if (round.retriggered) retriggers += 1;
  cascadeSum += round.baseSpin.cascadeDepth;
  totalStaked += stake;
  totalWon += Math.floor((stake * round.totalPayBp) / 10_000);
  maxSeen = Math.max(maxSeen, round.totalPayBp);
}
console.log(
  `  trigger rate  : ${((triggers / ITERATIONS) * 100).toFixed(3)}% (1 in ${(ITERATIONS / Math.max(1, triggers)).toFixed(1)})`,
);
console.log(`  retrigger rate: ${((retriggers / ITERATIONS) * 100).toFixed(3)}%`);
console.log(`  spins/round   : ${(totalSpins / ITERATIONS).toFixed(4)}`);
console.log(`  avg cascades  : ${(cascadeSum / ITERATIONS).toFixed(4)}`);
console.log(`  max win seen  : x${(maxSeen / 10_000).toFixed(1)}`);
console.log(`  rough RTP     : ${((totalWon / totalStaked) * 100).toFixed(2)}%`);
check('free spins do trigger', triggers > 0);

console.log('verifier round-trip');
const seeds = { serverSeed: 'a'.repeat(64), clientSeed: 'seed-1', nonce: 1 };
const one = generateAceRound(DEFAULT_ACE_CONFIG, seeds, stake);
const two = generateAceRound(DEFAULT_ACE_CONFIG, seeds, stake);
check('deterministic for same seeds', one.totalPayBp === two.totalPayBp);
const genuine = verifyAceSpin(DEFAULT_ACE_CONFIG, seeds, stake, {
  totalPayBp: one.totalPayBp,
  payoutMinorUnits: Math.floor((stake * one.totalPayBp) / 10_000),
  freeSpinsPlayed: one.freeSpinsPlayed,
});
check('verifier accepts a genuine round', genuine.valid, genuine.reasons.join('; '));
const tampered = verifyAceSpin(DEFAULT_ACE_CONFIG, seeds, stake, {
  totalPayBp: one.totalPayBp + 1,
  payoutMinorUnits: Math.floor((stake * one.totalPayBp) / 10_000),
  freeSpinsPlayed: one.freeSpinsPlayed,
});
check('verifier rejects a tampered totalPayBp', !tampered.valid);
check('commitment is 64 hex chars', /^[0-9a-f]{64}$/.test(aceCommitment(seeds.serverSeed)));

const stream = new HmacRandomStream(seeds.serverSeed, seeds.clientSeed, 1, 'test');
const buckets = new Array<number>(10).fill(0);
for (let i = 0; i < 100_000; i += 1) buckets[stream.nextIntBelow(10)] += 1;
check(
  'rng buckets are uniform',
  Math.min(...buckets) > 9_000 && Math.max(...buckets) < 11_000,
  `${Math.min(...buckets)}..${Math.max(...buckets)}`,
);

console.log('golden -> wild');
let scanned = 0;
let sawWild = false;
while (scanned < 500_000 && !sawWild) {
  const round = generateAceRound(
    DEFAULT_ACE_CONFIG,
    { serverSeed: `golden-${scanned}`, clientSeed: 'smoke', nonce: scanned },
    stake,
  );
  scanned += 1;
  const steps = [...round.baseSpin.steps, ...round.freeSpins.flatMap((s) => s.steps)];
  for (let i = 0; i < steps.length - 1; i += 1) {
    if (steps[i].goldenToWild.length === 0) continue;
    const next = steps[i + 1].grid;
    sawWild = steps[i].goldenToWild.every((ref) => next[ref.reel][ref.row].symbol === 'WILD');
    break;
  }
}
check('a golden winner returns as a WILD in the same cell', sawWild);

console.log(failures === 0 ? '\nALL SMOKE CHECKS PASSED' : `\n${failures} SMOKE CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);

