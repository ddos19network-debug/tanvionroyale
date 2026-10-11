/**
 * TANVION ROYALE — Royale Play (Plinko + Mines) server configuration.
 *
 * The games NEVER trust client input for any of these values. Real-money mode
 * is FAIL-CLOSED with the same posture as the crash engine (crash.config.ts):
 *
 *   1. ROYALE_MODE=REAL_MONEY explicitly set by the operator, AND
 *   2. ROYALE_REAL_MONEY_ALLOWED=true explicit acknowledgement, AND
 *   3. a production runtime (NODE_ENV=production), AND
 *   4. an actually IMPLEMENTED licensed-operator adapter
 *      (resolveRealMoneyOperatorAdapter — a provider NAME is never proof;
 *      UnconfiguredOperatorAdapter and the dev mock can never satisfy this), AND
 *   5. a real payment provider configured for BOTH deposits and withdrawals.
 *
 * Until EVERY condition holds, the games serve FREE_PLAY points only
 * (CrashFreePlayWallet, currency FREEPLAY) — clearly separated from the real
 * Wallet. Enabling real money additionally requires verified licensing,
 * KYC/AML, responsible-gambling controls and independent RNG certification
 * (see docs/games/plinko-mines.md — an approval statement alone is NOT proof;
 * the in-repo gate is what is enforced here).
 *
 * Money is integer MINOR UNITS. Multipliers are integer BASIS POINTS
 * (10000 bp = 1.00x); payouts always floor: floor(stake * bp / 10000).
 */

import { readNodeEnv } from '@tanvion-royale/config';
import {
  createDepositProvider,
  createWithdrawalProvider,
} from '../wallet/payment-provider.factory';
import { resolveRealMoneyOperatorAdapter } from '../betting/betting-provider.factory';

export type RoyaleMode = 'FREE_PLAY' | 'REAL_MONEY';

export type PlinkoRisk = 'LOW' | 'MEDIUM' | 'HIGH';

export const PLINKO_RISKS: readonly PlinkoRisk[] = ['LOW', 'MEDIUM', 'HIGH'];

/** Postgres INTEGER ceiling guard: never allow a payout above this. */
export const MAX_PAYOUT_MINOR_UNITS = 2_000_000_000;

export interface RoyaleConfig {
  enabled: boolean;
  mode: RoyaleMode;
  currency: string;
  minStake: number;
  maxStake: number;
  /** Target return-to-player in basis points (9900 = 99.00%). Clamped to (0,10000]. */
  rtpBp: number;
  /** Hard payout multiplier cap in bp; also clamped so payout fits Postgres INTEGER. */
  maxMultiplierBp: number;
  minRows: number;
  maxRows: number;
  /** Allowed Mines grid sizes (perfect squares, e.g. 16,25,36). */
  grids: number[];
  minMines: number;
  maxMines: number;
  algorithmVersion: string;
  realMoneyAvailable: boolean;
  realMoneyReason: string;
  /** Minimum age for REAL_MONEY play. NEVER below 18, even if env asks for less. */
  minAge: number;
}

function parseIntEnv(key: string, fallback: number, env: NodeJS.ProcessEnv): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function parseListEnv(key: string, fallback: number[], env: NodeJS.ProcessEnv): number[] {
  const raw = env[key];
  if (!raw?.trim()) return fallback;
  const values = raw
    .split(',')
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  return values.length > 0 ? [...new Set(values)].sort((a, b) => a - b) : fallback;
}

/** The single real-money verdict for both Royale games (fail-closed). */
export function resolveRoyaleRealMoney(
  env: NodeJS.ProcessEnv = process.env,
): { available: boolean; reason: string } {
  const modeWanted = (env.ROYALE_MODE ?? 'FREE_PLAY').trim().toUpperCase();
  if (modeWanted !== 'REAL_MONEY') {
    return { available: false, reason: 'ROYALE_MODE is not REAL_MONEY' };
  }
  const explicit = env.ROYALE_REAL_MONEY_ALLOWED?.trim().toLowerCase();
  if (explicit !== 'true') {
    return { available: false, reason: 'ROYALE_REAL_MONEY_ALLOWED is not true' };
  }
  if (readNodeEnv(env) !== 'production') {
    return {
      available: false,
      reason: 'REAL_MONEY requires a production runtime (NODE_ENV=production)',
    };
  }
  // OPERATOR ADAPTER CAPABILITY (fail-closed): a provider NAME is not proof.
  const operator = resolveRealMoneyOperatorAdapter(env);
  if (!operator.capable) {
    return { available: false, reason: operator.reason };
  }
  const paymentOk =
    createDepositProvider().name !== 'unconfigured' &&
    createWithdrawalProvider().name !== 'unconfigured';
  if (!paymentOk) {
    return { available: false, reason: 'No real payment provider is configured' };
  }
  return {
    available: true,
    reason: `Licensed operator "${operator.provider}" is implemented and configured`,
  };
}

export function loadRoyaleConfig(env: NodeJS.ProcessEnv = process.env): RoyaleConfig {
  const realMoney = resolveRoyaleRealMoney(env);
  const wantedMode = (env.ROYALE_MODE ?? 'FREE_PLAY').trim().toUpperCase();
  const mode: RoyaleMode =
    wantedMode === 'REAL_MONEY' && realMoney.available ? 'REAL_MONEY' : 'FREE_PLAY';

  let realMoneyReason = realMoney.reason;
  if (mode === 'REAL_MONEY') {
    realMoneyReason = `REAL_MONEY enabled via ${realMoney.reason}`;
  } else if (wantedMode === 'REAL_MONEY') {
    realMoneyReason = `Falling back to FREE_PLAY — ${realMoney.reason}`;
  } else {
    realMoneyReason =
      'FREE_PLAY mode — free-play points only, clearly separated from the real Wallet.';
  }

  const minStake = parseIntEnv('ROYALE_MIN_STAKE', 100, env);
  const maxStake = Math.max(minStake, parseIntEnv('ROYALE_MAX_STAKE', 100_000, env));

  // RTP: clamped to (0, 10000] bp — a table can never target >100% RTP.
  const rtpBp = Math.min(10_000, Math.max(1, parseIntEnv('ROYALE_RTP_BP', 9_900, env)));

  // Multiplier cap, additionally clamped so stake*multiplier can never overflow
  // the Postgres INTEGER payout column (payout = floor(stake * bp / 10000)).
  const requestedCap = Math.max(
    10_000,
    parseIntEnv('ROYALE_MAX_MULTIPLIER_BP', 1_000_000, env),
  );
  const overflowCap = Math.floor((MAX_PAYOUT_MINOR_UNITS * 10_000) / maxStake);
  const maxMultiplierBp = Math.max(10_000, Math.min(requestedCap, overflowCap));

  const grids = parseListEnv('ROYALE_MINES_GRIDS', [16, 25, 36], env).filter((g) => {
    const root = Math.round(Math.sqrt(g));
    return root * root === g && g >= 9;
  });

  return {
    enabled: env.ROYALE_GAME_ENABLED !== 'false',
    mode,
    currency: (env.ROYALE_CURRENCY ?? env.BETTING_CURRENCY ?? 'BDT').toUpperCase(),
    minStake,
    maxStake,
    rtpBp,
    maxMultiplierBp,
    minRows: Math.max(2, parseIntEnv('ROYALE_PLINKO_MIN_ROWS', 8, env)),
    maxRows: Math.max(4, parseIntEnv('ROYALE_PLINKO_MAX_ROWS', 16, env)),
    grids: grids.length > 0 ? grids : [16, 25, 36],
    minMines: 1,
    maxMines: Math.min(24, parseIntEnv('ROYALE_MINES_MAX_MINES', 10, env)),
    algorithmVersion: env.ROYALE_ALGORITHM_VERSION ?? 'v1',
    realMoneyAvailable: realMoney.available,
    realMoneyReason,
    // Minimum age for REAL_MONEY play (audit F4). Configurable but NEVER below
    // 18: a request for 0 / negative / sub-adult values falls back to 18 (and a
    // non-numeric value never lowers it either — parseIntEnv falls back to 18).
    minAge: Math.max(18, parseIntEnv('ROYALE_MIN_AGE', 18, env)),
  };
}
