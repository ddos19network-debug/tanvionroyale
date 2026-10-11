/**
 * `pnpm --filter api exec ts-node -r tsconfig-paths/register \
 *   src/modules/royale/ace/ace-smoke.ts` — a QUICK engine sanity check.
 *
 * This is a convenience script only; the authoritative assertions live in the
 * Jest suite (test/royale-ace-math.spec.ts, test/royale-ace-service.spec.ts).
 * It has NO top-level side effects so it stays lint- and type-clean: the checks
 * run only when the file is executed directly (require.main === module).
 */
import {
  DEFAULT_ACE_CONFIG,
  isAceConfigValid,
  isCountryCurrencyAllowed,
} from './ace-config';
import { evaluateWays, ladderMultiplierBp, type AceCell, type AceGrid } from './ace-math';
import { aceCommitment, generateAceRound, verifyAceSpin } from './ace-fair';

function col(cells: AceCell['symbol'][]): AceCell[] {
  return cells.map((symbol) => ({ symbol, golden: false }));
}

export function runAceSmoke(): boolean {
  let failures = 0;
  const check = (name: string, ok: boolean): void => {
    if (!ok) {
      failures += 1;
      process.stdout.write(`FAIL ${name}\n`);
    }
  };

  check('default config is valid', isAceConfigValid(DEFAULT_ACE_CONFIG));

  // SPADE on reels 0,1,2 with 2 on reel 1 -> run 3, ways 2, pay 2*50 = 100 bp.
  const grid: AceGrid = [
    col(['SPADE', 'HEART', 'DIAMOND', 'CLUB']),
    col(['SPADE', 'SPADE', 'K', 'Q']),
    col(['SPADE', 'K', 'Q', 'J']),
    col(['K', 'Q', 'J', 'A']),
    col(['K', 'Q', 'J', 'A']),
  ];
  const wins = evaluateWays(grid, DEFAULT_ACE_CONFIG);
  check('ways = 2', wins[0]?.ways === 2);
  check('payBp = 100', wins[0]?.payBp === 100);

  check('base ladder x1->x5', ladderMultiplierBp(DEFAULT_ACE_CONFIG.baseLadderBp, 4) === 50_000);
  check('fs ladder doubles', ladderMultiplierBp(DEFAULT_ACE_CONFIG.freeSpinLadderBp, 1) === 20_000);

  const seeds = { serverSeed: 'a'.repeat(64), clientSeed: 'seed-1', nonce: 1 };
  const round = generateAceRound(DEFAULT_ACE_CONFIG, seeds, 1_000);
  const again = generateAceRound(DEFAULT_ACE_CONFIG, seeds, 1_000);
  check('deterministic for same seeds', round.totalPayBp === again.totalPayBp);

  const payout = Math.floor((1_000 * round.totalPayBp) / 10_000);
  const proof = verifyAceSpin(DEFAULT_ACE_CONFIG, seeds, 1_000, {
    totalPayBp: round.totalPayBp,
    payoutMinorUnits: payout,
    freeSpinsPlayed: round.freeSpinsPlayed,
  });
  check('verifier accepts a genuine round', proof.valid);

  check('commitment is 64 hex', /^[0-9a-f]{64}$/.test(aceCommitment(seeds.serverSeed)));
  check('BD+BDT allowed', isCountryCurrencyAllowed(DEFAULT_ACE_CONFIG, 'BD', 'BDT'));
  check('BD+USD blocked', !isCountryCurrencyAllowed(DEFAULT_ACE_CONFIG, 'BD', 'USD'));

  process.stdout.write(failures === 0 ? 'ace-smoke: OK\n' : `ace-smoke: ${failures} FAILED\n`);
  return failures === 0;
}

if (require.main === module) {
  process.exit(runAceSmoke() ? 0 : 1);
}


// Legacy smoke helpers below are retained only as a reference scratch pad and
// are intentionally not executed (the live checks run inside runAceSmoke).
/* eslint-disable @typescript-eslint/no-unused-vars */
let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    void 0;
  } else {
    failures += 1;
    console.log(`  FAIL ${name}${detail ? ` â€” ${detail}` : ''}`);
  }
}

// (removed legacy smoke body)


