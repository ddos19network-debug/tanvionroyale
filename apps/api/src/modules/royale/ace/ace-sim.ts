/**
 * TANVION ROYALE — "Royale Ace" (royale-ace) Monte-Carlo simulator + tuning.
 *
 * Two jobs:
 *  1. `simulateAce()` — run a large seeded batch of rounds and report RTP
 *     (total, base game, cascade and free spins), hit frequency, volatility,
 *     max win and free-spin trigger rate, each with a 95% confidence interval.
 *  2. `tuneAceConfig()` — scale the paytable toward a target RTP so a new
 *     config version can be calibrated BEFORE it is ever activated.
 *
 * The simulator uses its own fast CSPRNG (`SeededRandomStream`) rather than the
 * HMAC stream: it must produce the same DISTRIBUTION (and therefore the same
 * statistics) but millions of times faster. It never serves a real spin.
 */

import {
  ACE_PAY_SYMBOLS,
  ACE_REELS,
  ACE_ROWS,
  scalePaytable,
  type AceGameConfig,
  type AcePaySymbol,
  type AceStripEntry,
} from './ace-config';
import { BASIS_POINTS, playSpin, type AceRandomSource } from './ace-math';

// ---------------------------------------------------------------------------
// Fast deterministic PRNG (splitmix64) — simulation only, never for real money
// ---------------------------------------------------------------------------

export class SeededRandomStream implements AceRandomSource {
  private state: bigint;

  constructor(seed: string | bigint) {
    this.state = typeof seed === 'bigint' ? seed : SeededRandomStream.hashSeed(seed);
    if (this.state === 0n) this.state = 0x9e3779b97f4a7c15n;
  }

  /** FNV-1a-ish string hash so a human-readable seed gives a stable stream. */
  private static hashSeed(seed: string): bigint {
    let hash = 0xcbf29ce484222325n;
    for (let i = 0; i < seed.length; i += 1) {
      hash ^= BigInt(seed.charCodeAt(i));
      hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    return hash;
  }

  private next64(): bigint {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & 0xffffffffffffffffn;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & 0xffffffffffffffffn;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & 0xffffffffffffffffn;
    return z ^ (z >> 31n);
  }

  /** Uniform in [0, bound) via rejection sampling — no modulo bias. */
  nextIntBelow(bound: number): number {
    if (!Number.isInteger(bound) || bound <= 0) {
      throw new Error(`bound must be a positive integer, got ${String(bound)}`);
    }
    if (bound === 1) return 0;
    const limit = Number(BigInt.asUintN(48, 0xffffffffffffn));
    const zone = Math.floor(limit / bound) * bound; // largest unbiased multiple
    for (;;) {
      const candidate = Number(BigInt.asUintN(48, this.next64() >> 16n));
      if (candidate < zone) return candidate % bound;
    }
  }

  pickFromStrip(strip: readonly AceStripEntry[]): AceStripEntry {
    let total = 0;
    for (const entry of strip) total += entry.weight;
    const u = this.nextIntBelow(total);
    let running = 0;
    for (const entry of strip) {
      running += entry.weight;
      if (u < running) return entry;
    }
    return strip[strip.length - 1];
  }
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

export interface AceSimInterval {
  /** Point estimate. */
  mean: number;
  /** Lower bound of the 95% CI. */
  low: number;
  /** Upper bound of the 95% CI. */
  high: number;
}

/** 95% normal-approximation CI for a sample of per-round values. */
function interval(sum: number, sumSquares: number, n: number): AceSimInterval {
  if (n <= 1) return { mean: sum / Math.max(1, n), low: NaN, high: NaN };
  const mean = sum / n;
  const variance = Math.max(0, (sumSquares - n * mean * mean) / (n - 1));
  const halfWidth = 1.959963984540054 * (Math.sqrt(variance) / Math.sqrt(n));
  return { mean, low: mean - halfWidth, high: mean + halfWidth };
}

/** Everything a math report must publish about a config version. */
export interface AceSimReport {
  spins: number;
  stake: number;
  /** Total RTP as a fraction of stake (0.96 = 96%). */
  rtp: AceSimInterval;
  /** Base-game-only RTP as a fraction of stake (initial drop only). */
  baseRtp: number;
  /** RTP contributed by cascade multipliers on later steps. */
  cascadeRtp: number;
  /** RTP contributed by free spins. */
  freeSpinRtp: number;
  /** Share of rounds with any win. */
  hitFrequency: number;
  /** Ratio of the largest single round win to the stake. */
  maxWin: number;
  /** True when at least one round hit the configured cap. */
  capReached: boolean;
  /** Standard deviation of per-round win / stake (volatility). */
  volatility: number;
  /** Share of base spins that trigger free spins. */
  freeSpinTriggerRate: number;
  /** Share of features that were retriggered. */
  retriggerRate: number;
  /** Average cascade steps per base spin. */
  averageCascadeDepth: number;
  /** Average free spins awarded per triggered feature. */
  averageFreeSpins: number;
  /** Highest ladder multiplier reached, as a multiple (x). */
  maxMultiplierSeen: number;
}

export interface AceSimOptions {
  /** Number of ROUNDS to simulate. */
  spins: number;
  /** Stake in minor units (statistics are scale-invariant). */
  stake: number;
  /** Seed for the deterministic stream. */
  seed: string;
  /** Optional per-round win cap in bp (defaults to the config's cap). */
  maxWinBp?: number;
}

/**
 * Simulate `spins` rounds and produce the full math report.
 *
 * `playSpin` is called per phase with the simulator's own stream, so the
 * distribution — and therefore every statistic — matches the live HMAC
 * implementation exactly.
 */
export function simulateAce(config: AceGameConfig, options: AceSimOptions): AceSimReport {
  const { spins, stake, seed } = options;
  const maxWinBp = options.maxWinBp ?? config.maxWinBp;
  const random = new SeededRandomStream(seed);

  let winSum = 0;
  let winSumSquares = 0;
  let baseWinSum = 0;
  let cascadeExtraSum = 0;
  let freeSpinWinSum = 0;
  let cappedRounds = 0;
  let hitRounds = 0;
  let triggerCount = 0;
  let retriggerCount = 0;
  let featureCount = 0;
  let freeSpinAwardedSum = 0;
  let cascadeDepthSum = 0;
  let maxWin = 0;
  let maxMultiplier = 0;

  for (let i = 0; i < spins; i += 1) {
    const base = playSpin(random, config, config.baseLadderBp);
    const baseDropPayBp = base.steps[0]?.payBp ?? 0;
    let totalPayBp = base.totalPayBp;
    cascadeDepthSum += base.cascadeDepth;

    if (base.scatterCount >= 3) {
      triggerCount += 1;
      featureCount += 1;
      freeSpinAwardedSum += base.freeSpinsAwarded;
      let remaining = base.freeSpinsAwarded;
      let retriggered = false;
      for (let played = 0; remaining > 0 && played < config.freeSpins.maxSpinsPerRound; played += 1) {
        remaining -= 1;
        const spin = playSpin(random, config, config.freeSpinLadderBp);
        freeSpinWinSum += spin.totalPayBp;
        totalPayBp += spin.totalPayBp;
        if (spin.freeSpinsAwarded > 0) {
          if (config.freeSpins.retriggerUsesAwardTable) remaining += spin.freeSpinsAwarded;
          retriggered = true;
        }
      }
      if (retriggered) retriggerCount += 1;
    }

    const capped = totalPayBp > maxWinBp;
    if (capped) {
      cappedRounds += 1;
      // Attribute the clipped overflow to the feature when one ran, so the
      // three RTP buckets still add up to the (capped) total.
      if (base.scatterCount >= 3) freeSpinWinSum -= totalPayBp - maxWinBp;
      totalPayBp = maxWinBp;
    }

    baseWinSum += baseDropPayBp;
    cascadeExtraSum += base.totalPayBp - baseDropPayBp;

    if (totalPayBp > 0) hitRounds += 1;
    if (totalPayBp > maxWin) maxWin = totalPayBp;
    for (const step of base.steps) {
      if (step.multiplierBp > maxMultiplier) maxMultiplier = step.multiplierBp;
    }

    winSum += totalPayBp;
    winSumSquares += totalPayBp * totalPayBp;
  }

  return {
    spins,
    stake,
    // RTP fields are FRACTIONS of stake (0.96 = 96%), like every other ratio
    // in this report, so the paytable is divided out of the sums first.
    rtp: interval(winSum / BASIS_POINTS, winSumSquares / (BASIS_POINTS * BASIS_POINTS), spins),
    baseRtp: baseWinSum / spins / BASIS_POINTS,
    cascadeRtp: cascadeExtraSum / spins / BASIS_POINTS,
    freeSpinRtp: freeSpinWinSum / spins / BASIS_POINTS,
    hitFrequency: hitRounds / spins,
    maxWin: maxWin / BASIS_POINTS,
    capReached: cappedRounds > 0,
    // `winSumSquares` is in bp^2, so it needs BASIS_POINTS^2 to become (x)^2.
    volatility: Math.sqrt(
      Math.max(0, winSumSquares / spins - (winSum / spins) * (winSum / spins)) /
        (BASIS_POINTS * BASIS_POINTS),
    ),
    freeSpinTriggerRate: triggerCount / spins,
    retriggerRate: featureCount > 0 ? retriggerCount / featureCount : 0,
    averageCascadeDepth: cascadeDepthSum / spins,
    averageFreeSpins: featureCount > 0 ? freeSpinAwardedSum / featureCount : 0,
    maxMultiplierSeen: maxMultiplier / BASIS_POINTS,
  };
}

// ---------------------------------------------------------------------------
// Tuning helper — calibrate a paytable toward a target RTP
// ---------------------------------------------------------------------------

export interface AceTuneResult {
  config: AceGameConfig;
  /** Every iteration's measured RTP, in order (fraction of stake). */
  history: number[];
  report: AceSimReport;
  converged: boolean;
}

/**
 * Iteratively scale the paytable until the simulated RTP is within `toleranceBp`
 * of `config.targetRtpBp`. Only the paytable is touched — reel strips, ladders
 * and feature settings stay exactly as the admin set them, so hit frequency,
 * trigger rate and volatility are preserved.
 *
 * Every candidate is derived from the ORIGINAL paytable with a single
 * cumulative factor (never compounded on top of an already-scaled table).
 */
export function tuneAceConfig(
  config: AceGameConfig,
  options: { spins: number; seed: string; maxIterations?: number; toleranceBp?: number },
): AceTuneResult {
  const { spins, seed } = options;
  const maxIterations = options.maxIterations ?? 14;
  const toleranceBp = options.toleranceBp ?? 150; // 1.5% of stake
  const targetBp = config.targetRtpBp;
  const originalPaytable = config.paytableBp;

  let factor = 1;
  const history: number[] = [];
  let current: AceGameConfig = { ...config, paytableBp: scalePaytable(config, factor) };
  let report = simulateAce(current, { spins, seed, stake: 1_000 });

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    history.push(report.rtp.mean);
    const measuredBp = report.rtp.mean * BASIS_POINTS;
    const deltaBp = targetBp - measuredBp;
    if (Math.abs(deltaBp) <= toleranceBp) break;

    // RTP is very nearly linear in the paytable scale, so the next factor is a
    // proportional step, damped to avoid overshoot.
    factor *= 1 + (targetBp / Math.max(1, measuredBp) - 1) * 0.9;
    current = { ...config, paytableBp: scalePaytable({ ...config, paytableBp: originalPaytable }, factor) };
    report = simulateAce(current, { spins, seed, stake: 1_000 });
  }

  return {
    config: current,
    history,
    report,
    converged: Math.abs(targetBp - report.rtp.mean * BASIS_POINTS) <= toleranceBp,
  };
}

// ---------------------------------------------------------------------------
// CI gate — a config version can only be activated when this passes
// ---------------------------------------------------------------------------

export interface AceSimGateOptions {
  /** Allowed absolute RTP deviation from the target, in bp. */
  rtpToleranceBp: number;
  /** Hard ceiling on the observed max win, as a multiple of stake. */
  maxWinCeiling: number;
}

export interface AceSimGateResult {
  passed: boolean;
  reasons: string[];
  report: AceSimReport;
}

/**
 * The activation gate for a config version. Fails when the RTP CI sits outside
 * tolerance of the target OR the max-win cap was exceeded.
 */
export function runAceSimGate(
  config: AceGameConfig,
  simOptions: AceSimOptions,
  gate: AceSimGateOptions,
): AceSimGateResult {
  const report = simulateAce(config, simOptions);
  const reasons: string[] = [];
  const targetFraction = config.targetRtpBp / BASIS_POINTS;
  const toleranceFraction = gate.rtpToleranceBp / BASIS_POINTS;

  if (
    !(report.rtp.low >= targetFraction - toleranceFraction &&
      report.rtp.high <= targetFraction + toleranceFraction)
  ) {
    reasons.push(
      `RTP ${(report.rtp.mean * 100).toFixed(2)}% (95% CI ${(report.rtp.low * 100).toFixed(2)}%–${(report.rtp.high * 100).toFixed(2)}%) is outside target ${(targetFraction * 100).toFixed(2)}% ±${(toleranceFraction * 100).toFixed(2)}%`,
    );
  }
  if (report.maxWin > gate.maxWinCeiling + 1e-9) {
    reasons.push(
      `max win x${report.maxWin.toFixed(1)} exceeds the ceiling of x${gate.maxWinCeiling.toFixed(1)}`,
    );
  }
  if (report.capReached) {
    reasons.push('a simulated round reached the per-round win cap — the cap may be clamping the RTP');
  }
  return { passed: reasons.length === 0, reasons, report };
}

/** Human-readable one-line summary of a report (used in logs and admin UI). */
export function formatAceReport(report: AceSimReport): string {
  const pct = (value: number): string => `${(value * 100).toFixed(2)}%`;
  return [
    `spins=${report.spins.toLocaleString('en-US')}`,
    `rtp=${pct(report.rtp.mean)} [${pct(report.rtp.low)}–${pct(report.rtp.high)}]`,
    `base=${pct(report.baseRtp)}`,
    `cascade=${pct(report.cascadeRtp)}`,
    `freespins=${pct(report.freeSpinRtp)}`,
    `hit=${pct(report.hitFrequency)}`,
    `volatility=${report.volatility.toFixed(2)}`,
    `maxwin=x${report.maxWin.toFixed(1)}`,
    `trigger=${pct(report.freeSpinTriggerRate)} (1 in ${(1 / Math.max(1e-9, report.freeSpinTriggerRate)).toFixed(0)})`,
    `retrigger=${pct(report.retriggerRate)}`,
    `cascades=${report.averageCascadeDepth.toFixed(3)}`,
    `fspins=${report.averageFreeSpins.toFixed(2)}`,
  ].join(' ');
}

/** Exported for tests and for the symbol-probability section of the docs. */
export function aceSymbolProbabilities(config: AceGameConfig): Array<{
  reel: number;
  symbol: string;
  probability: number;
}> {
  const rows: Array<{ reel: number; symbol: string; probability: number }> = [];
  for (let reel = 0; reel < ACE_REELS; reel += 1) {
    const strip = config.strips[reel];
    const total = strip.reduce((sum, entry) => sum + entry.weight, 0);
    for (let row = 0; row < ACE_ROWS; row += 1) {
      for (const entry of strip) {
        rows.push({
          reel,
          symbol: `${entry.symbol}${entry.golden ? ' (golden)' : ''}`,
          probability: entry.weight / total,
        });
      }
    }
  }
  return rows;
}

export { ACE_PAY_SYMBOLS, ACE_REELS, ACE_ROWS, type AcePaySymbol };

