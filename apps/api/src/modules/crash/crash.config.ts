/**
 * Server-side game configuration for the Sky Rocket crash engine.
 *
 * The game NEVER trusts client input for any of these values. Real-money mode
 * is impossible to switch on with a frontend flag: it becomes active only when
 * ALL of the following are present:
 *   1. CRASH_MODE=REAL_MONEY explicitly set by the operator, AND
 *   2. an actually IMPLEMENTED licensed-operator adapter exists — see
 *      resolveRealMoneyOperatorAdapter/isRealMoneyCapableOperator in
 *      betting-provider.factory (naming OPERATOR_PROVIDER is NOT proof of an
 *      adapter; UnconfiguredOperatorAdapter and the dev mock can never satisfy
 *      this), AND
 *   3. a real payment provider is configured (createDepositProvider /
 *      createWithdrawalProvider are NOT the UnconfiguredPaymentProvider), AND
 *   4. CRASH_REAL_MONEY_ALLOWED=true explicitly acknowledges betting.
 *
 * Otherwise the engine serves FREE_PLAY only (free-play points can never be
 * confused with money — they live in CrashFreePlayWallet, not the Wallet).
 */

import { readNodeEnv } from '@tanvion-royale/config';
import {
  createDepositProvider,
  createWithdrawalProvider,
} from '../wallet/payment-provider.factory';
import { resolveRealMoneyOperatorAdapter } from '../betting/betting-provider.factory';

export type CrashMode = 'FREE_PLAY' | 'REAL_MONEY';

export interface CrashConfig {
  gameSlug: 'sky-rocket';
  enabled: boolean;
  mode: CrashMode;
  currency: string; // ISO 4217 for REAL_MONEY
  minStake: number; // minor units / free-play points
  maxStake: number; // minor units / free-play points
  initialFreePlayPoints: number;
  bettingDurationMs: number;
  nextRoundDelayMs: number;
  maxMultiplier: number;
  algorithmVersion: string;
  /** Advisory-lock id used for single-leader round scheduling across instances. */
  advisoryLockId: number;
  realMoneyAvailable: boolean;
  realMoneyReason: string;
}

function parseIntEnv(key: string, fallback: number, env: NodeJS.ProcessEnv = process.env): number {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function resolveRealMoney(
  env: NodeJS.ProcessEnv = process.env,
): { available: boolean; reason: string } {
  const modeWanted = (env.CRASH_MODE ?? 'FREE_PLAY').trim().toUpperCase();
  if (modeWanted !== 'REAL_MONEY') {
    return { available: false, reason: 'CRASH_MODE is not REAL_MONEY' };
  }
  const explicit = env.CRASH_REAL_MONEY_ALLOWED?.trim().toLowerCase();
  if (explicit !== 'true') {
    return { available: false, reason: 'CRASH_REAL_MONEY_ALLOWED is not true' };
  }
  // OPERATOR ADAPTER CAPABILITY (fail-closed): a provider NAME is not proof.
  // REAL_MONEY requires an actually IMPLEMENTED real adapter — the
  // UnconfiguredOperatorAdapter and the dev mock can never satisfy this.
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

export function loadCrashConfig(env: NodeJS.ProcessEnv = process.env): CrashConfig {
  const realMoney = resolveRealMoney(env);
  const wantedMode = (env.CRASH_MODE ?? 'FREE_PLAY').trim().toUpperCase();
  const isProduction = readNodeEnv(env) === 'production';
  const mode: CrashMode =
    wantedMode === 'REAL_MONEY' && realMoney.available ? 'REAL_MONEY' : 'FREE_PLAY';

  // Log-output ready reason for the effective mode.
  let realMoneyReason = realMoney.reason;
  if (mode === 'REAL_MONEY') {
    realMoneyReason = `REAL_MONEY enabled via ${realMoney.reason}`;
  } else if (wantedMode === 'REAL_MONEY') {
    realMoneyReason = `Falling back to FREE_PLAY — ${realMoney.reason}`;
  } else {
    realMoneyReason =
      'FREE_PLAY mode — free-play points only, clearly separated from the real Wallet.';
  }

  return {
    gameSlug: 'sky-rocket',
    enabled: env.CRASH_GAME_ENABLED === 'false' ? false : true,
    mode,
    currency: env.CRASH_CURRENCY ?? env.BETTING_CURRENCY ?? 'BDT',
    minStake: parseIntEnv('CRASH_MIN_STAKE', 5),
    maxStake: parseIntEnv('CRASH_MAX_STAKE', 100_000),
    initialFreePlayPoints: parseIntEnv('FREEPLAY_INITIAL_POINTS', 100_000),
    bettingDurationMs: parseIntEnv('CRASH_BETTING_DURATION_MS', 6_000),
    nextRoundDelayMs: parseIntEnv('CRASH_NEXT_ROUND_DELAY_MS', 4_000),
    maxMultiplier: parseIntEnv('CRASH_MAX_MULTIPLIER', 10_000),
    algorithmVersion: env.CRASH_ALGORITHM_VERSION ?? 'v1',
    advisoryLockId: parseIntEnv('CRASH_ADVISORY_LOCK_ID', 4_266_326_262_019),
    realMoneyAvailable: realMoney.available,
    realMoneyReason: isProduction ? realMoneyReason : realMoneyReason,
  };
}