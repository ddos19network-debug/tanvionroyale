/**
 * TANVION ROYALE — Royale Ace pure-math, fairness and config tests.
 *
 * These exercise the DETERMINISTIC engine (ace-math), the provably-fair stream
 * and verifier (ace-fair), the versioned config validation (ace-config) and the
 * Monte-Carlo simulator gate (ace-sim). No database, no HTTP — just the game
 * logic that the verifier must be able to re-derive exactly.
 */
import {
  ACE_PAY_SYMBOLS,
  DEFAULT_ACE_CONFIG,
  effectiveMaxWinBp,
  isAceConfigValid,
  isCountryCurrencyAllowed,
  validateAceConfig,
  type AceGameConfig,
} from '../src/modules/royale/ace/ace-config';
import {
  applyCascade,
  countScatters,
  evaluateWays,
  goldenWinningCells,
  ladderMultiplierBp,
  winningCells,
  type AceCell,
  type AceGrid,
} from '../src/modules/royale/ace/ace-math';
import {
  HmacRandomStream,
  aceCommitment,
  generateAceRound,
  verifyAceSpin,
} from '../src/modules/royale/ace/ace-fair';
import { runAceSimGate, simulateAce } from '../src/modules/royale/ace/ace-sim';

const cell = (symbol: AceCell['symbol'], golden = false): AceCell => ({ symbol, golden });

/** Build a grid from per-reel arrays of cells (reel 0 first). */
function grid(columns: AceCell[][]): AceGrid {
  return columns;
}

describe('Royale Ace — default config', () => {
  it('passes full validation', () => {
    const issues = validateAceConfig(DEFAULT_ACE_CONFIG);
    expect(issues).toEqual([]);
    expect(isAceConfigValid(DEFAULT_ACE_CONFIG)).toBe(true);
  });

  it('clamps the win cap so the payout can never overflow a Postgres INTEGER', () => {
    const hugeStake = 1_000_000_00;
    const capped = effectiveMaxWinBp(DEFAULT_ACE_CONFIG, hugeStake);
    // floor(stake * capped / 10000) must stay <= 2_000_000_000.
    expect(Math.floor((hugeStake * capped) / 10_000)).toBeLessThanOrEqual(2_000_000_000);
  });
});

describe('Royale Ace — 1024-ways evaluator', () => {
  const cfg = DEFAULT_ACE_CONFIG;

  it('pays a left-to-right 3-of-a-kind with the correct ways count', () => {
    // SPADE on reels 0,1,2 only; 2 on reel 1 -> ways = 1*2*1 = 2.
    const g = grid([
      [cell('SPADE'), cell('HEART'), cell('CLUB'), cell('DIAMOND')],
      [cell('SPADE'), cell('SPADE'), cell('Q'), cell('K')],
      [cell('SPADE'), cell('J'), cell('A'), cell('WILD')],
      [cell('K'), cell('Q'), cell('J'), cell('A')],
      [cell('A'), cell('K'), cell('Q'), cell('J')],
    ]);
    const wins = evaluateWays(g, cfg);
    const spade = wins.find((w) => w.symbol === 'SPADE');
    expect(spade).toBeDefined();
    expect(spade?.runLength).toBe(3);
    expect(spade?.ways).toBe(2);
    expect(spade?.payBp).toBe(2 * cfg.paytableBp.SPADE[3]);
  });

  it('does NOT pay a symbol that only appears on reel 0 (no 2-of-a-kind)', () => {
    const g = grid([
      [cell('SPADE'), cell('HEART'), cell('CLUB'), cell('DIAMOND')],
      [cell('Q'), cell('K'), cell('J'), cell('A')],
      [cell('K'), cell('Q'), cell('J'), cell('A')],
      [cell('A'), cell('K'), cell('Q'), cell('J')],
      [cell('J'), cell('A'), cell('K'), cell('Q')],
    ]);
    expect(evaluateWays(g, cfg)).toHaveLength(0);
  });

  it('extends a run with WILD and shares the WILD across symbols', () => {
    // reel0 = A, reel1 = WILD, reel2 = A -> A run of 3 via wild.
    const g = grid([
      [cell('A'), cell('Q'), cell('J'), cell('K')],
      [cell('WILD'), cell('K'), cell('Q'), cell('J')],
      [cell('A'), cell('J'), cell('K'), cell('Q')],
      [cell('K'), cell('A'), cell('Q'), cell('J')],
      [cell('Q'), cell('K'), cell('J'), cell('A')],
    ]);
    const wins = evaluateWays(g, cfg);
    const ace = wins.find((w) => w.symbol === 'A');
    expect(ace?.runLength).toBe(3);
    expect(ace?.ways).toBe(1);
  });

  it('never substitutes WILD for SCATTER when counting scatters', () => {
    const g = grid([
      [cell('SCATTER'), cell('WILD'), cell('Q'), cell('J')],
      [cell('WILD'), cell('K'), cell('Q'), cell('J')],
      [cell('A'), cell('J'), cell('K'), cell('Q')],
      [cell('K'), cell('A'), cell('Q'), cell('J')],
      [cell('Q'), cell('K'), cell('J'), cell('A')],
    ]);
    expect(countScatters(g)).toBe(1);
    // WILD + SCATTER on reel 0 does not make a SCATTER "run".
    const wins = evaluateWays(g, cfg);
    expect(wins.every((w) => ACE_PAY_SYMBOLS.includes(w.symbol))).toBe(true);
    expect(winningCells(wins).some((c) => c.reel === 0 && c.row === 0)).toBe(false);
  });
});


describe('Royale Ace — golden → wild', () => {
  const cfg = DEFAULT_ACE_CONFIG;

  it('marks a golden winning cell to become WILD on the next cascade', () => {
    const g = grid([
      [cell('SPADE', true), cell('HEART'), cell('CLUB'), cell('DIAMOND')],
      [cell('SPADE'), cell('Q'), cell('K'), cell('J')],
      [cell('SPADE'), cell('J'), cell('A'), cell('WILD')],
      [cell('K'), cell('Q'), cell('J'), cell('A')],
      [cell('A'), cell('K'), cell('Q'), cell('J')],
    ]);
    const wins = evaluateWays(g, cfg);
    const golden = goldenWinningCells(g, wins, cfg);
    expect(golden).toEqual([{ reel: 0, row: 0 }]);
    const winners = winningCells(wins);
    expect(winners).toContainEqual({ reel: 0, row: 0 });
    expect(winners).toContainEqual({ reel: 1, row: 0 });
    expect(winners).toContainEqual({ reel: 2, row: 0 });
  });

  it('returns NO golden cells when goldenToWild is disabled', () => {
    const off: AceGameConfig = { ...cfg, goldenToWild: false };
    const g = grid([
      [cell('SPADE', true), cell('HEART'), cell('CLUB'), cell('DIAMOND')],
      [cell('SPADE'), cell('Q'), cell('K'), cell('J')],
      [cell('SPADE'), cell('J'), cell('A'), cell('WILD')],
      [cell('K'), cell('Q'), cell('J'), cell('A')],
      [cell('A'), cell('K'), cell('Q'), cell('J')],
    ]);
    const wins = evaluateWays(g, off);
    expect(goldenWinningCells(g, wins, off)).toEqual([]);
  });

  it('refills a marked golden position as a WILD after the cascade', () => {
    const g = grid([
      [cell('SPADE', true), cell('HEART'), cell('CLUB'), cell('DIAMOND')],
      [cell('SPADE'), cell('Q'), cell('K'), cell('J')],
      [cell('SPADE'), cell('J'), cell('A'), cell('WILD')],
      [cell('K'), cell('Q'), cell('J'), cell('A')],
      [cell('A'), cell('K'), cell('Q'), cell('J')],
    ]);
    const wins = evaluateWays(g, cfg);
    const removed = winningCells(wins);
    const golden = goldenWinningCells(g, wins, cfg);
    const rng = new HmacRandomStream('a'.repeat(64), 'golden', 1, 'base');
    const next = applyCascade(rng, g, removed, golden, cfg);
    expect(next[0][0]).toEqual({ symbol: 'WILD', golden: false });
    expect(next.every((reel) => reel.length === 4)).toBe(true);
  });
});

describe('Royale Ace — cascade multiplier ladder', () => {
  it('walks the base ladder and repeats the last value', () => {
    const ladder = DEFAULT_ACE_CONFIG.baseLadderBp; // x1,x2,x3,x5
    expect(ladderMultiplierBp(ladder, 1)).toBe(10_000);
    expect(ladderMultiplierBp(ladder, 2)).toBe(20_000);
    expect(ladderMultiplierBp(ladder, 4)).toBe(50_000);
    expect(ladderMultiplierBp(ladder, 9)).toBe(50_000); // repeats
  });

  it('uses the doubled ladder inside free spins', () => {
    const ladder = DEFAULT_ACE_CONFIG.freeSpinLadderBp; // x2,x4,x6,x10
    expect(ladderMultiplierBp(ladder, 1)).toBe(20_000);
    expect(ladderMultiplierBp(ladder, 4)).toBe(100_000);
  });

  it('caps the payout at maxWinBp and never exceeds it', () => {
    const seeds = { serverSeed: 'c'.repeat(64), clientSeed: 'cap', nonce: 7 };
    const round = generateAceRound(DEFAULT_ACE_CONFIG, seeds, 1_000);
    expect(round.totalPayBp).toBeLessThanOrEqual(DEFAULT_ACE_CONFIG.maxWinBp);
  });
});

describe('Royale Ace — scatter and free spins', () => {
  it('awards 8 spins for 3 scatters and +2 per extra via the config table', () => {
    const award = DEFAULT_ACE_CONFIG.freeSpins.awardByScatterCount;
    expect(award[3]).toBe(8);
    expect(award[4]).toBe(10);
    expect(award[5]).toBe(12);
  });

  it('produces deterministic free-spin counts for the same seeds', () => {
    const seeds = { serverSeed: 'd'.repeat(64), clientSeed: 'fs', nonce: 3 };
    const a = generateAceRound(DEFAULT_ACE_CONFIG, seeds, 1_000);
    const b = generateAceRound(DEFAULT_ACE_CONFIG, seeds, 1_000);
    expect(a.freeSpinsPlayed).toBe(b.freeSpinsPlayed);
    expect(a.totalPayBp).toBe(b.totalPayBp);
  });
});

describe('Royale Ace — provably-fair determinism and verifier', () => {
  it('generates an identical round for identical seeds (determinism)', () => {
    const seeds = { serverSeed: 'e'.repeat(64), clientSeed: 'player-1', nonce: 42 };
    const a = generateAceRound(DEFAULT_ACE_CONFIG, seeds, 2_000);
    const b = generateAceRound(DEFAULT_ACE_CONFIG, seeds, 2_000);
    expect(a.totalPayBp).toBe(b.totalPayBp);
    expect(a.maxMultiplierBp).toBe(b.maxMultiplierBp);
    expect(a.baseSpin.cascadeDepth).toBe(b.baseSpin.cascadeDepth);
    expect(a.freeSpinsPlayed).toBe(b.freeSpinsPlayed);
    expect(JSON.stringify(a.baseSpin.steps)).toBe(JSON.stringify(b.baseSpin.steps));
  });

  it('changes the outcome when the client seed changes', () => {
    const base = { serverSeed: 'f'.repeat(64), clientSeed: 'player-1', nonce: 1 };
    const alt = { serverSeed: 'f'.repeat(64), clientSeed: 'player-2', nonce: 1 };
    const a = generateAceRound(DEFAULT_ACE_CONFIG, base, 1_000);
    const b = generateAceRound(DEFAULT_ACE_CONFIG, alt, 1_000);
    // Extremely unlikely to be identical across a different seed.
    expect(JSON.stringify(a.baseSpin.steps)).not.toBe(JSON.stringify(b.baseSpin.steps));
  });

  it('accepts a genuine round and rejects a tampered one (verifier round-trip)', () => {
    const seeds = { serverSeed: '9'.repeat(64), clientSeed: 'verify', nonce: 5 };
    const round = generateAceRound(DEFAULT_ACE_CONFIG, seeds, 1_000);
    const maxWinBp = effectiveMaxWinBp(DEFAULT_ACE_CONFIG, 1_000);
    const payout = Math.floor((1_000 * round.totalPayBp) / 10_000);

    const good = verifyAceSpin(DEFAULT_ACE_CONFIG, seeds, 1_000, {
      totalPayBp: round.totalPayBp,
      payoutMinorUnits: payout,
      freeSpinsPlayed: round.freeSpinsPlayed,
    });
    expect(good.valid).toBe(true);
    expect(good.totalPayBp).toBe(round.totalPayBp);
    expect(good.payoutMinorUnits).toBe(payout);
    // payout respects the cap.
    expect(payout).toBeLessThanOrEqual(Math.floor((1_000 * maxWinBp) / 10_000));

    const tampered = verifyAceSpin(DEFAULT_ACE_CONFIG, seeds, 1_000, {
      totalPayBp: round.totalPayBp + 12_345,
      payoutMinorUnits: payout,
      freeSpinsPlayed: round.freeSpinsPlayed,
    });
    expect(tampered.valid).toBe(false);
    expect(tampered.reasons.length).toBeGreaterThan(0);
  });

  it('commits to the server seed with SHA-256 (64 hex chars)', () => {
    expect(aceCommitment('a'.repeat(64))).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('Royale Ace — jurisdiction / currency gate', () => {
  const cfg = DEFAULT_ACE_CONFIG; // currencyByCountry: BD -> [BDT]; unknownPolicy: BLOCK

  it('allows a configured country+currency and blocks a disallowed currency', () => {
    expect(isCountryCurrencyAllowed(cfg, 'BD', 'BDT')).toBe(true);
    expect(isCountryCurrencyAllowed(cfg, 'BD', 'USD')).toBe(false);
  });

  it('fails CLOSED for an unknown country under the BLOCK policy', () => {
    expect(isCountryCurrencyAllowed(cfg, 'ZZ', 'BDT')).toBe(false);
    expect(isCountryCurrencyAllowed(cfg, null, 'BDT')).toBe(false);
  });
});

describe('Royale Ace — RTP simulation gate', () => {
  it('reports RTP near the target for the default config', () => {
    const report = simulateAce(DEFAULT_ACE_CONFIG, { spins: 200_000, stake: 1_000, seed: 'rtp-test' });
    expect(report.spins).toBe(200_000);
    expect(report.rtp.mean).toBeGreaterThan(0.85);
    expect(report.rtp.mean).toBeLessThan(1.05);
    expect(report.maxWin).toBeLessThanOrEqual(DEFAULT_ACE_CONFIG.maxWinBp / 10_000 + 1);
  });

  it('fails the gate for an absurdly generous paytable (RTP far above target)', () => {
    const greedy: AceGameConfig = JSON.parse(JSON.stringify(DEFAULT_ACE_CONFIG));
    for (const sym of Object.keys(greedy.paytableBp)) {
      greedy.paytableBp[sym as keyof typeof greedy.paytableBp] = greedy.paytableBp[
        sym as keyof typeof greedy.paytableBp
      ].map((v) => v * 40);
    }
    const result = runAceSimGate(
      greedy,
      { spins: 50_000, stake: 1_000, seed: 'gate-fail' },
      { rtpToleranceBp: 150, maxWinCeiling: DEFAULT_ACE_CONFIG.maxWinBp / 10_000 },
    );
    expect(result.passed).toBe(false);
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});

