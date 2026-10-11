/**
 * TANVION ROYALE — "Royale Ace" (royale-ace): versioned game configuration.
 *
 * Royale Ace is an ORIGINAL 5-reel x 4-row, 1024-ways cascading card-themed
 * slot. Every gameplay-relevant number lives in ONE typed, versioned config
 * (reel-strip weights, paytable, multiplier ladders, golden-card behaviour,
 * free-spin awards, caps, per-currency bet levels, jurisdiction rules). The
 * config VERSION is stored on every round so any historical spin can be
 * re-derived exactly.
 *
 * Conventions (same posture as royale.config.ts / royale-math.ts):
 *   - Money is integer MINOR UNITS. All multipliers are BASIS POINTS
 *     (10000 bp = 1.00x). Payouts ALWAYS floor: floor(stake * bp / 10000).
 *   - Nothing here is ever trusted from a client request; the service loads
 *     the ACTIVE version from the database (falling back to the built-in
 *     DEFAULT_ACE_CONFIG) and re-validates it.
 *   - ORIGINAL IP: names, symbols, art direction, copy and paytable layout are
 *     TANVION originals. Only generic slot mechanics (ways-to-win, cascades,
 *     multiplier ladders) are reused from the genre.
 */

import { BASIS_POINTS } from '../royale-math';

export const ACE_GAME_SLUG = 'royale-ace';
export const ACE_REELS = 5;
export const ACE_ROWS = 4;

/** The 4 low-paying symbols — original stylized card suits. */
export const ACE_LOW_SYMBOLS = ['SPADE', 'HEART', 'DIAMOND', 'CLUB'] as const;
/** The 4 high-paying symbols — original stylized court cards. */
export const ACE_HIGH_SYMBOLS = ['J', 'Q', 'K', 'A'] as const;

export type AceLowSymbol = (typeof ACE_LOW_SYMBOLS)[number];
export type AceHighSymbol = (typeof ACE_HIGH_SYMBOLS)[number];
export type AcePaySymbol = AceLowSymbol | AceHighSymbol;
export type AceSpecialSymbol = 'WILD' | 'SCATTER';
export type AceBaseSymbol = AcePaySymbol | AceSpecialSymbol;

export const ACE_PAY_SYMBOLS: readonly AcePaySymbol[] = [...ACE_LOW_SYMBOLS, ...ACE_HIGH_SYMBOLS];

/** One weighted entry of a reel strip. `golden` marks the GOLDEN card variant. */
export interface AceStripEntry {
  symbol: AceBaseSymbol;
  weight: number;
  golden: boolean;
}

/** Bet levels for one currency (minor units; no auto-FX ever). */
export interface AceBetLevels {
  minStake: number;
  maxStake: number;
  step: number;
}

export interface AceFreeSpinSettings {
  /**
   * Free spins awarded for landing exactly N scatters; index = scatter count,
   * index 0..2 are unused (a trigger needs 3+). The last entry is reused for
   * every higher count.
   */
  awardByScatterCount: number[];
  /**
   * A retrigger re-uses `awardByScatterCount` (same scatter-count table) so the
   * rules never change between the base game and the feature.
   */
  retriggerUsesAwardTable: boolean;
  /** Hard safety bound on total free spins inside ONE round. */
  maxSpinsPerRound: number;
  /** Free-spin wins are credited together with the base win at round end. */
  creditMode: 'END_OF_ROUND';
}


/**
 * Jurisdiction + currency control (REAL_MONEY only). The admin manages these
 * rules through versioned config edits; the gate FAILS CLOSED on anything it
 * cannot positively allow.
 */
export interface AceJurisdictionRules {
  /** Hard-blocked countries (ISO 3166-1 alpha-2, upper-case). */
  blockedCountries: string[];
  /** Explicit per-country allowed currencies. Countries not listed use `defaultCurrencies`. */
  currencyByCountry: Record<string, string[]>;
  /** Allowed currencies for countries without an explicit rule. */
  defaultCurrencies: string[];
  /**
   * What happens when the player has NO country on file:
   *   BLOCK      — reject REAL_MONEY (the fail-closed default).
   *   USE_DEFAULT — fall back to `defaultCurrencies`.
   */
  unknownCountryPolicy: 'BLOCK' | 'USE_DEFAULT';
  /**
   * Mid-round policy: when a country flips to BLOCKED while a round is stuck
   * ACTIVE, the reconciler still completes it (crediting the computed win)
   * when true, or voids it (refunding the stake) when false.
   */
  finishBlockedCountryRounds: boolean;
}

export interface AceGameConfig {
  /** Monotonic config version; stored on every round. */
  version: number;
  /** Human-readable label for admin screens. */
  configName: string;
  /** Target return-to-player in basis points (9600 = 96.00%). */
  targetRtpBp: number;
  /** Volatility label shown to players (a description, not a math input). */
  volatilityLabel: string;
  /**
   * Payout in BASIS POINTS OF STAKE PER WAY for N-of-a-kind starting at reel 0.
   * paytableBp[sym][n] is the pay for n-of-a-kind (n in 3..5).
   */
  paytableBp: Record<AcePaySymbol, number[]>;
  /**
   * Scatter (whole-group) payout in bp of stake, indexed by scatter count
   * (index 0..2 unused; the last entry is reused for higher counts).
   * NOT affected by the cascade multiplier ladder.
   */
  scatterPayBp: number[];
  /**
   * Cascade multiplier ladder in bp, indexed by cascade step (1-based). The
   * last entry repeats for deeper cascades. Free spins use the higher ladder.
   */
  baseLadderBp: number[];
  freeSpinLadderBp: number[];
  /** Five weighted reel strips, reel 0 first. Draw order: top row to bottom. */
  strips: AceStripEntry[][];
  /** When a GOLDEN card is part of a win it becomes a WILD on the next cascade. */
  goldenToWild: boolean;
  freeSpins: AceFreeSpinSettings;
  /** Hard per-round win cap in bp of stake (5000x = 500000 bp). */
  maxWinBp: number;
  /** Per-player per-UTC-day win cap in minor units, per currency (REAL_MONEY). */
  dailyWinCapMinorUnits: Record<string, number>;
  /** REAL_MONEY bet levels per currency. */
  betLevels: Record<string, AceBetLevels>;
  /** FREE_PLAY stake bounds (points). */
  freePlayBetLevels: AceBetLevels;
  jurisdiction: AceJurisdictionRules;
  /** Per-game switch (admin-persisted on the ACTIVE version). */
  enabled: boolean;
  /** Safety bound on cascade steps inside one spin. */
  maxCascadeStepsPerSpin: number;
}

// ---------------------------------------------------------------------------
// Built-in default configuration (version 1)
// ---------------------------------------------------------------------------

/** Only the 8 card symbols can ever be GOLDEN (never WILD / SCATTER). */
export const ACE_GOLDEN_SYMBOLS: readonly AcePaySymbol[] = ACE_PAY_SYMBOLS;

/**
 * Normal (non-golden) symbol weights per reel. Weights are RELATIVE — the
 * evaluator/simulator normalizes each strip to a probability distribution, so
 * admins may edit them freely as long as every strip keeps a positive total.
 *
 * Weights are deliberately TANVION originals chosen for the target RTP and
 * volatility profile (see docs/games/royale-ace.md): low suits are the most
 * frequent, the court cards get progressively rarer, WILD is uncommon and
 * SCATTER is rare (a free-spin trigger rate of roughly 1 in 190 base spins).
 */
export const ACE_DEFAULT_REEL_WEIGHTS: ReadonlyArray<Record<AceBaseSymbol, number>> = [
  { SPADE: 26, HEART: 24, DIAMOND: 22, CLUB: 20, J: 18, Q: 14, K: 10, A: 6, WILD: 6, SCATTER: 3 },
  { SPADE: 25, HEART: 24, DIAMOND: 23, CLUB: 21, J: 18, Q: 14, K: 11, A: 7, WILD: 5, SCATTER: 3 },
  { SPADE: 24, HEART: 23, DIAMOND: 22, CLUB: 21, J: 19, Q: 15, K: 11, A: 8, WILD: 5, SCATTER: 3 },
  { SPADE: 23, HEART: 23, DIAMOND: 22, CLUB: 21, J: 19, Q: 16, K: 12, A: 8, WILD: 5, SCATTER: 3 },
  { SPADE: 22, HEART: 22, DIAMOND: 21, CLUB: 20, J: 20, Q: 16, K: 13, A: 9, WILD: 5, SCATTER: 3 },
];

/** GOLDEN card weights per reel (a small fraction of each card's weight). */
export const ACE_DEFAULT_GOLDEN_WEIGHTS: ReadonlyArray<Record<AcePaySymbol, number>> = [
  { SPADE: 3, HEART: 2, DIAMOND: 2, CLUB: 2, J: 2, Q: 1, K: 1, A: 1 },
  { SPADE: 3, HEART: 2, DIAMOND: 2, CLUB: 2, J: 2, Q: 1, K: 1, A: 1 },
  { SPADE: 3, HEART: 2, DIAMOND: 2, CLUB: 2, J: 2, Q: 2, K: 1, A: 1 },
  { SPADE: 2, HEART: 2, DIAMOND: 2, CLUB: 2, J: 2, Q: 2, K: 1, A: 1 },
  { SPADE: 2, HEART: 2, DIAMOND: 2, CLUB: 2, J: 2, Q: 2, K: 1, A: 1 },
];

/**
 * Expand the compact weight tables into explicit weighted reel strips.
 * Draw order inside one strip is irrelevant (it is a weighted distribution),
 * but the order is kept stable so two equal configs serialize identically.
 */
export function buildDefaultStrip(reelIndex: number): AceStripEntry[] {
  if (reelIndex < 0 || reelIndex >= ACE_REELS) {
    throw new Error(`reelIndex must be in [0, ${ACE_REELS})`);
  }
  const normal = ACE_DEFAULT_REEL_WEIGHTS[reelIndex];
  const golden = ACE_DEFAULT_GOLDEN_WEIGHTS[reelIndex];
  const entries: AceStripEntry[] = [];
  for (const symbol of ACE_GOLDEN_SYMBOLS) {
    entries.push({ symbol, weight: normal[symbol], golden: false });
    entries.push({ symbol, weight: golden[symbol], golden: true });
  }
  entries.push({ symbol: 'WILD', weight: normal.WILD, golden: false });
  entries.push({ symbol: 'SCATTER', weight: normal.SCATTER, golden: false });
  return entries;
}

/**
 * Default paytable: bp of stake PER WAY for a 3/4-of-a-kind run starting on
 * reel 0. The row length is `ACE_REELS + 1` (6) so a future 6th reel can be
 * added without a breaking config change; only indices 3 and 4 pay today, and
 * the final slot must stay 0.
 *
 * CALIBRATED by `tuneAceConfig` (4,000,000 seeded rounds) to 96.18% RTP
 * [95.89%–96.46%], i.e. inside the 96% ±1.5% tolerance. See
 * docs/games/royale-ace.md for the full math profile.
 */
export const ACE_DEFAULT_PAYTABLE_BP: Record<AcePaySymbol, number[]> = {
  SPADE: [0, 0, 0, 362, 1_208, 0],
  HEART: [0, 0, 0, 362, 1_208, 0],
  DIAMOND: [0, 0, 0, 435, 1_449, 0],
  CLUB: [0, 0, 0, 507, 1_690, 0],
  J: [0, 0, 0, 724, 2_414, 0],
  Q: [0, 0, 0, 905, 3_018, 0],
  K: [0, 0, 0, 1_086, 3_622, 0],
  A: [0, 0, 0, 1_811, 7_243, 0],
};

/**
 * Whole-group scatter pay in bp of stake, indexed by scatter COUNT. Index
 * 0..2 are 0 (a pay needs 3 scatters); the LAST entry is reused for any higher
 * count. Never multiplied by the cascade ladder.
 */
export const ACE_DEFAULT_SCATTER_PAY_BP: number[] = [0, 0, 0, 200, 1_000, 5_000, 20_000];

/** Base-game cascade ladder (bp), 1-based by cascade step; last entry repeats. */
export const ACE_DEFAULT_BASE_LADDER_BP: number[] = [10_000, 20_000, 30_000, 50_000];

/** Free-spin cascade ladder (bp) — exactly double the base ladder by design. */
export const ACE_DEFAULT_FREE_SPIN_LADDER_BP: number[] = [20_000, 40_000, 60_000, 100_000];

/**
 * The shipped default configuration (config version 1).
 *
 * The live ACTIVE configuration always comes from the database
 * (`RoyaleAceConfigVersion`); this constant is (a) the seed for the first
 * version, (b) the fallback when no version has been activated yet, and
 * (c) the baseline used by the simulator / tuning helper.
 */
export const DEFAULT_ACE_CONFIG: AceGameConfig = {
  version: 1,
  configName: 'Royale Ace — launch table v1',
  targetRtpBp: 9_600,
  volatilityLabel: 'HIGH',
  paytableBp: ACE_DEFAULT_PAYTABLE_BP,
  scatterPayBp: ACE_DEFAULT_SCATTER_PAY_BP,
  baseLadderBp: ACE_DEFAULT_BASE_LADDER_BP,
  freeSpinLadderBp: ACE_DEFAULT_FREE_SPIN_LADDER_BP,
  strips: [0, 1, 2, 3, 4].map((reel) => buildDefaultStrip(reel)),
  goldenToWild: true,
  freeSpins: {
    // 3 scatters -> 8 spins, then +2 per extra scatter (4 -> 10, 5 -> 12, ...).
    awardByScatterCount: [0, 0, 0, 8, 10, 12, 14, 16],
    retriggerUsesAwardTable: true,
    maxSpinsPerRound: 250,
    creditMode: 'END_OF_ROUND',
  },
  maxWinBp: 5_000 * BASIS_POINTS,
  dailyWinCapMinorUnits: {
    BDT: 500_000_00,
    USD: 5_000_00,
  },
  betLevels: {
    // BDT: 10 BDT .. 10 000 BDT, step 10 BDT (minor units = poisha).
    BDT: { minStake: 1_000, maxStake: 1_000_000, step: 1_000 },
    // USD: $1 .. $1 000, step $1 (minor units = cents).
    USD: { minStake: 100, maxStake: 100_000, step: 100 },
  },
  freePlayBetLevels: { minStake: 1_000, maxStake: 50_000_00, step: 1_000 },
  jurisdiction: {
    blockedCountries: [],
    currencyByCountry: { BD: ['BDT'] },
    defaultCurrencies: [],
    unknownCountryPolicy: 'BLOCK',
    finishBlockedCountryRounds: true,
  },
  enabled: true,
  maxCascadeStepsPerSpin: 60,
};

// ---------------------------------------------------------------------------
// Validation — every config version MUST pass this before it can be activated
// ---------------------------------------------------------------------------

export interface AceConfigIssue {
  path: string;
  message: string;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

const CURRENCY_RE = /^[A-Z]{3}$/;
const COUNTRY_RE = /^[A-Z]{2}$/;

function checkBetLevels(
  at: string,
  levels: AceBetLevels | undefined,
  issues: AceConfigIssue[],
): void {
  if (!levels || typeof levels !== 'object') {
    issues.push({ path: at, message: 'must be an object { minStake, maxStake, step }' });
    return;
  }
  for (const key of ['minStake', 'maxStake', 'step'] as const) {
    if (!isPositiveInt(levels[key])) {
      issues.push({ path: `${at}.${key}`, message: 'must be a positive integer' });
    }
  }
  if (isPositiveInt(levels.minStake) && isPositiveInt(levels.maxStake) && levels.minStake > levels.maxStake) {
    issues.push({ path: at, message: 'minStake must not exceed maxStake' });
  }
  if (
    isPositiveInt(levels.minStake) &&
    isPositiveInt(levels.step) &&
    levels.minStake % levels.step !== 0
  ) {
    issues.push({ path: at, message: 'minStake must be an exact multiple of step' });
  }
}


/**
 * Structural + numeric validation of a config. Returns EVERY problem found so
 * the admin UI can show a complete list (fail-closed: a non-empty result means
 * the version can never be activated).
 */
export function validateAceConfig(config: AceGameConfig): AceConfigIssue[] {
  const issues: AceConfigIssue[] = [];
  const fail = (path: string, message: string): void => {
    issues.push({ path, message });
  };

  if (!isPositiveInt(config.version)) fail('version', 'must be a positive integer');
  if (typeof config.configName !== 'string' || config.configName.trim().length === 0) {
    fail('configName', 'must not be empty');
  }
  if (!isPositiveInt(config.targetRtpBp) || config.targetRtpBp > BASIS_POINTS) {
    fail('targetRtpBp', `must be an integer in (0, ${BASIS_POINTS}]`);
  }
  if (!isPositiveInt(config.maxWinBp)) fail('maxWinBp', 'must be a positive integer in basis points');
  if (!isPositiveInt(config.maxCascadeStepsPerSpin)) {
    fail('maxCascadeStepsPerSpin', 'must be a positive integer');
  }
  if (typeof config.volatilityLabel !== 'string' || config.volatilityLabel.trim() === '') {
    fail('volatilityLabel', 'must be a non-empty string');
  }
  if (typeof config.goldenToWild !== 'boolean') fail('goldenToWild', 'must be a boolean');
  if (typeof config.enabled !== 'boolean') fail('enabled', 'must be a boolean');

  // ---- paytable -----------------------------------------------------------
  for (const symbol of ACE_PAY_SYMBOLS) {
    const row = config.paytableBp?.[symbol];
    if (!Array.isArray(row) || row.length !== ACE_REELS + 1) {
      fail(`paytableBp.${symbol}`, `must be an array of ${ACE_REELS + 1} integers`);
      continue;
    }
    for (let n = 0; n <= ACE_REELS; n += 1) {
      if (!isNonNegativeInt(row[n])) {
        fail(`paytableBp.${symbol}[${n}]`, 'must be a non-negative integer');
      } else if (n < 3) {
        if (row[n] !== 0) {
          fail(`paytableBp.${symbol}[${n}]`, 'must be 0 — a win needs at least 3 reels');
        }
      } else if (n === ACE_REELS) {
        if (row[n] !== 0) {
          fail(`paytableBp.${symbol}[${n}]`, 'must be 0 — reserved for a future reel');
        }
      }
    }
    // Payable run lengths are those the admin chose to enable; a disabled run
    // length (0 bp) simply never pays. Any enabled run must be non-zero and
    // must not pay less than a shorter enabled run.
    let previousPaying = 0;
    for (let n = 3; n <= ACE_REELS - 1; n += 1) {
      if (row[n] === 0) continue;
      if (row[n] < previousPaying) {
        fail(`paytableBp.${symbol}[${n}]`, 'must not pay less than a shorter enabled run');
      }
      previousPaying = row[n];
    }
    if (previousPaying === 0) {
      fail(`paytableBp.${symbol}`, 'at least one run length between 3 and 4 must pay');
    }
  }

  // ---- scatter pay --------------------------------------------------------
  const scatterPay = config.scatterPayBp;
  if (!Array.isArray(scatterPay) || scatterPay.length < 4) {
    fail('scatterPayBp', 'must be an array of at least 4 integers (index = scatter count)');
  } else {
    for (let i = 0; i < scatterPay.length; i += 1) {
      if (!isNonNegativeInt(scatterPay[i])) {
        fail(`scatterPayBp[${i}]`, 'must be a non-negative integer');
      }
    }
    for (let i = 3; i < scatterPay.length; i += 1) {
      if (scatterPay[i] < scatterPay[i - 1]) {
        fail(`scatterPayBp[${i}]`, 'must not decrease as the scatter count grows');
      }
    }
  }

  // ---- ladders ------------------------------------------------------------
  for (const [name, ladder] of [
    ['baseLadderBp', config.baseLadderBp],
    ['freeSpinLadderBp', config.freeSpinLadderBp],
  ] as const) {
    if (!Array.isArray(ladder) || ladder.length === 0) {
      fail(name, 'must be a non-empty array of basis-point multipliers');
      continue;
    }
    for (let i = 0; i < ladder.length; i += 1) {
      if (!isPositiveInt(ladder[i])) fail(`${name}[${i}]`, 'must be a positive integer in bp');
    }
    for (let i = 1; i < ladder.length; i += 1) {
      if (isPositiveInt(ladder[i]) && isPositiveInt(ladder[i - 1]) && ladder[i] < ladder[i - 1]) {
        fail(`${name}[${i}]`, 'must not decrease as cascades deepen');
      }
    }
  }


  // ---- strips -------------------------------------------------------------
  if (!Array.isArray(config.strips) || config.strips.length !== ACE_REELS) {
    fail('strips', `must be an array of exactly ${ACE_REELS} reel strips`);
  } else {
    config.strips.forEach((strip, reel) => {
      if (!Array.isArray(strip) || strip.length === 0) {
        fail(`strips[${reel}]`, 'must be a non-empty array of weighted entries');
        return;
      }
      let total = 0;
      for (const [index, entry] of strip.entries()) {
        const at = `strips[${reel}][${index}]`;
        if (!entry || typeof entry !== 'object') {
          fail(at, 'must be an object { symbol, weight, golden }');
          continue;
        }
        const known =
          (ACE_PAY_SYMBOLS as readonly string[]).includes(entry.symbol) ||
          entry.symbol === 'WILD' ||
          entry.symbol === 'SCATTER';
        if (!known) fail(`${at}.symbol`, `unknown symbol "${String(entry.symbol)}"`);
        if (!isPositiveInt(entry.weight)) fail(`${at}.weight`, 'must be a positive integer');
        else total += entry.weight;
        if (typeof entry.golden !== 'boolean') {
          fail(`${at}.golden`, 'must be a boolean');
        } else if (entry.golden && (entry.symbol === 'WILD' || entry.symbol === 'SCATTER')) {
          fail(`${at}.golden`, 'WILD and SCATTER can never be golden');
        }
      }
      if (total <= 0) fail(`strips[${reel}]`, 'total weight must be positive');
    });
  }

  // ---- free spins ---------------------------------------------------------
  const fs = config.freeSpins;
  if (!fs || typeof fs !== 'object') {
    fail('freeSpins', 'must be an object');
  } else {
    const awards = fs.awardByScatterCount;
    if (!Array.isArray(awards) || awards.length < 4) {
      fail('freeSpins.awardByScatterCount', 'must be an array of at least 4 integers');
    } else {
      awards.forEach((award, count) => {
        if (!isNonNegativeInt(award)) {
          fail(`freeSpins.awardByScatterCount[${count}]`, 'must be a non-negative integer');
        }
      });
      if (isNonNegativeInt(awards[3]) && awards[3] <= 0) {
        fail('freeSpins.awardByScatterCount[3]', '3 scatters must award at least 1 free spin');
      }
      for (let count = 4; count < awards.length; count += 1) {
        if (
          isNonNegativeInt(awards[count]) &&
          isNonNegativeInt(awards[count - 1]) &&
          awards[count] < awards[count - 1]
        ) {
          fail(`freeSpins.awardByScatterCount[${count}]`, 'must not decrease as scatters increase');
        }
      }
    }
    if (typeof fs.retriggerUsesAwardTable !== 'boolean') {
      fail('freeSpins.retriggerUsesAwardTable', 'must be a boolean');
    }
    if (!isPositiveInt(fs.maxSpinsPerRound) || fs.maxSpinsPerRound > 10_000) {
      fail('freeSpins.maxSpinsPerRound', 'must be an integer in (0, 10000]');
    }
    if (fs.creditMode !== 'END_OF_ROUND') fail('freeSpins.creditMode', "must be 'END_OF_ROUND'");
  }


  // ---- money --------------------------------------------------------------
  const currencies = new Set<string>();
  for (const [currency, levels] of Object.entries(config.betLevels ?? {})) {
    if (!CURRENCY_RE.test(currency)) {
      fail(`betLevels.${currency}`, 'currency must be a 3-letter ISO code');
      continue;
    }
    currencies.add(currency);
    checkBetLevels(`betLevels.${currency}`, levels, issues);
  }
  if (currencies.size === 0) fail('betLevels', 'at least one currency must be configured');
  checkBetLevels('freePlayBetLevels', config.freePlayBetLevels, issues);

  for (const [currency, cap] of Object.entries(config.dailyWinCapMinorUnits ?? {})) {
    if (!CURRENCY_RE.test(currency)) {
      fail(`dailyWinCapMinorUnits.${currency}`, 'invalid currency code');
    }
    if (!isPositiveInt(cap)) fail(`dailyWinCapMinorUnits.${currency}`, 'must be a positive integer');
  }

  // ---- jurisdiction -------------------------------------------------------
  const jur = config.jurisdiction;
  if (!jur || typeof jur !== 'object') {
    fail('jurisdiction', 'must be an object');
  } else {
    const seenCountries = new Set<string>();
    const checkCountry = (code: string, at: string): void => {
      const normalized = String(code).trim().toUpperCase();
      if (!COUNTRY_RE.test(normalized)) {
        fail(at, `invalid ISO country code "${code}"`);
      } else if (seenCountries.has(normalized)) {
        fail(at, `country ${normalized} is listed more than once`);
      } else {
        seenCountries.add(normalized);
      }
    };
    const checkCurrency = (currency: string, at: string): void => {
      const normalized = String(currency).trim().toUpperCase();
      if (!CURRENCY_RE.test(normalized)) {
        fail(at, `invalid currency "${currency}"`);
      } else if (!currencies.has(normalized)) {
        fail(at, `currency ${normalized} has no bet levels configured`);
      }
    };

    if (!Array.isArray(jur.blockedCountries)) {
      fail('jurisdiction.blockedCountries', 'must be an array');
    } else {
      jur.blockedCountries.forEach((code, i) => checkCountry(code, `jurisdiction.blockedCountries[${i}]`));
    }

    if (jur.currencyByCountry === null || typeof jur.currencyByCountry !== 'object') {
      fail('jurisdiction.currencyByCountry', 'must be an object');
    } else {
      for (const [country, list] of Object.entries(jur.currencyByCountry)) {
        checkCountry(country, `jurisdiction.currencyByCountry.${country}`);
        if (!Array.isArray(list) || list.length === 0) {
          fail(`jurisdiction.currencyByCountry.${country}`, 'must be a non-empty array of currencies');
          continue;
        }
        list.forEach((currency, i) =>
          checkCurrency(currency, `jurisdiction.currencyByCountry.${country}[${i}]`),
        );
      }
    }

    if (!Array.isArray(jur.defaultCurrencies)) {
      fail('jurisdiction.defaultCurrencies', 'must be an array');
    } else {
      jur.defaultCurrencies.forEach((currency, i) =>
        checkCurrency(currency, `jurisdiction.defaultCurrencies[${i}]`),
      );
      if (jur.unknownCountryPolicy === 'USE_DEFAULT' && jur.defaultCurrencies.length === 0) {
        fail(
          'jurisdiction.defaultCurrencies',
          'unknownCountryPolicy USE_DEFAULT requires at least one default currency',
        );
      }
    }
    if (jur.unknownCountryPolicy !== 'BLOCK' && jur.unknownCountryPolicy !== 'USE_DEFAULT') {
      fail('jurisdiction.unknownCountryPolicy', "must be 'BLOCK' or 'USE_DEFAULT'");
    }
    if (typeof jur.finishBlockedCountryRounds !== 'boolean') {
      fail('jurisdiction.finishBlockedCountryRounds', 'must be a boolean');
    }
  }

  return issues;
}

/** True when the config has no validation issue. */
export function isAceConfigValid(config: AceGameConfig): boolean {
  return validateAceConfig(config).length === 0;
}

/**
 * Deep-clone a config and re-validate it. Used when the admin service persists
 * a new version: nothing is written unless the clone is fully valid.
 */
export function cloneAceConfig(config: AceGameConfig): AceGameConfig {
  const copy: AceGameConfig = JSON.parse(JSON.stringify(config)) as AceGameConfig;
  const issues = validateAceConfig(copy);
  if (issues.length > 0) {
    throw new Error(
      `invalid Royale Ace config: ${issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`,
    );
  }
  return copy;
}


/** Bet levels for a currency, or null when that currency is not configured. */
export function betLevelsFor(config: AceGameConfig, currency: string): AceBetLevels | null {
  const levels = config.betLevels[currency.toUpperCase()];
  if (!levels) return null;
  return { minStake: levels.minStake, maxStake: levels.maxStake, step: levels.step };
}

/** True when the currency is even offered by this game. */
export function isAceCurrencyConfigured(config: AceGameConfig, currency: string): boolean {
  return betLevelsFor(config, currency) !== null;
}

/**
 * Currencies a player's country may bet in (REAL_MONEY). Returns the list of
 * allowed currencies, or `null` when the country is blocked or unknown under
 * the fail-closed policy.
 */
export function allowedCurrenciesForCountry(
  config: AceGameConfig,
  country: string | null | undefined,
): string[] | null {
  const jur = config.jurisdiction;
  const code = country?.trim().toUpperCase();
  if (!code) {
    return jur.unknownCountryPolicy === 'USE_DEFAULT'
      ? jur.defaultCurrencies.map((c) => c.toUpperCase())
      : null;
  }
  if (jur.blockedCountries.map((c) => c.toUpperCase()).includes(code)) return null;
  const explicit = jur.currencyByCountry[code];
  if (explicit && explicit.length > 0) return explicit.map((c) => c.toUpperCase());
  return jur.unknownCountryPolicy === 'USE_DEFAULT'
    ? jur.defaultCurrencies.map((c) => c.toUpperCase())
    : null;
}

/** True when REAL_MONEY play is allowed for this country + currency pair. */
export function isCountryCurrencyAllowed(
  config: AceGameConfig,
  country: string | null | undefined,
  currency: string,
): boolean {
  const allowed = allowedCurrenciesForCountry(config, country);
  return allowed !== null && allowed.includes(currency.toUpperCase());
}

/**
 * Effective per-round win cap in bp: the configured cap, additionally clamped
 * so `floor(stake * cap / 10000)` can never exceed the Postgres INTEGER payout
 * ceiling (2_000_000_000).
 */
export function effectiveMaxWinBp(config: AceGameConfig, stake: number): number {
  const overflowCapBp = Math.floor((2_000_000_000 * BASIS_POINTS) / Math.max(1, stake));
  return Math.min(config.maxWinBp, overflowCapBp);
}

/** Allowed stake values for a currency (used by the client's stake selector). */
export function allowedStakesFor(config: AceGameConfig, currency: string): number[] {
  const levels = betLevelsFor(config, currency);
  if (!levels) return [];
  const stakes: number[] = [];
  for (let stake = levels.minStake; stake <= levels.maxStake; stake += levels.step) {
    stakes.push(stake);
  }
  return stakes;
}

/** Stake validation for REAL_MONEY (integer, within the currency's levels). */
export function validateAceStake(config: AceGameConfig, currency: string, stake: number): number {
  const levels = betLevelsFor(config, currency);
  if (!levels) throw new Error(`Currency ${currency} is not configured for Royale Ace`);
  if (!Number.isInteger(stake) || stake < levels.minStake || stake > levels.maxStake) {
    throw new Error(
      `Stake must be an integer between ${levels.minStake} and ${levels.maxStake} (minor units)`,
    );
  }
  if (stake % levels.step !== 0) {
    throw new Error(`Stake must be a multiple of ${levels.step} (minor units)`);
  }
  return stake;
}



/**
 * Scale every paytable entry by `factor` (used by the tuning helper to move the
 * achieved RTP toward the target). Returns a NEW paytable; entries always stay
 * positive integers, never decrease along a run, and the reserved index always
 * stays 0 so the result still passes `validateAceConfig`.
 */
export function scalePaytable(
  config: AceGameConfig,
  factor: number,
): Record<AcePaySymbol, number[]> {
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new Error('paytable scale factor must be a positive number');
  }
  const scaled: Record<AcePaySymbol, number[]> = {} as Record<AcePaySymbol, number[]>;
  for (const symbol of ACE_PAY_SYMBOLS) {
    const row = config.paytableBp[symbol];
    const next = row.map((value, index) => {
      // Index 0/1 never pay and index ACE_REELS is reserved for a future reel.
      if (index < 2 || index >= ACE_REELS || value <= 0) return 0;
      return Math.max(1, Math.round(value * factor));
    });
    // Keep the table monotonic in run length after scaling.
    for (let n = 3; n < ACE_REELS; n += 1) {
      if (next[n] < next[n - 1]) next[n] = next[n - 1];
    }
    scaled[symbol] = next;
  }
  return scaled;
}
