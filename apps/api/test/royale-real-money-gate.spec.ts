/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * TANVION ROYALE — Royale Play REAL_MONEY release-gate tests (Phase 4).
 *
 * The owner's "approvals obtained" statement is treated as INPUT, never proof.
 * The in-repo fail-closed gate is the only thing that can enable real money,
 * and it must stay closed for EVERY environment that lacks a real, IMPLEMENTED
 * licensed-operator adapter + payment provider in a production runtime.
 *
 * These assertions mirror the crash gate tests (crash-real-money-gate.spec.ts):
 * a provider NAME is never proof; UnconfiguredOperatorAdapter and the dev mock
 * can never satisfy the gate; and no fake operator adapter is registered
 * anywhere. REAL_MONEY integration behaviour is tested separately by injecting
 * a config object (royale-plinko / royale-mines specs).
 */

import {
  MockOperatorAdapter,
  UnconfiguredOperatorAdapter,
} from '@tanvion-royale/integrations';
import {
  isImplementedOperatorAdapter,
  isRealMoneyCapableOperator,
  resolveRealMoneyOperatorAdapter,
} from '../src/modules/betting/betting-provider.factory';
import {
  loadRoyaleConfig,
  resolveRoyaleRealMoney,
} from '../src/modules/royale/royale.config';

jest.setTimeout(30_000);

const ENV = process.env;

afterEach(() => {
  process.env = ENV;
  jest.restoreAllMocks();
});

/** Production env where EVERYTHING is set except an implemented operator adapter. */
function productionRealMoneyEnv(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    ROYALE_MODE: 'REAL_MONEY',
    ROYALE_REAL_MONEY_ALLOWED: 'true',
    OPERATOR_PROVIDER: 'operator-http',
    PAYMENT_PROVIDER: 'generic-http',
    PAYMENT_PROVIDER_URL: 'https://payments.example.test',
    PAYMENT_PROVIDER_KEY: 'test-payment-key',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe('Royale REAL_MONEY gate — a provider NAME is never proof (A)', () => {
  it('A: a named but unimplemented OPERATOR_PROVIDER does NOT enable REAL_MONEY', () => {
    const verdict = resolveRoyaleRealMoney(productionRealMoneyEnv());
    expect(verdict.available).toBe(false);
    expect(verdict.reason).toMatch(/no real adapter is implemented/i);
  });

  it('A: both Royale games therefore stay in FREE_PLAY with that same env', () => {
    const config = loadRoyaleConfig(productionRealMoneyEnv());
    expect(config.mode).toBe('FREE_PLAY');
    expect(config.realMoneyAvailable).toBe(false);
    expect(config.realMoneyReason).toMatch(/Falling back to FREE_PLAY/);
    expect(config.realMoneyReason).toMatch(/no real adapter is implemented/i);
  });

  it('A: unset / mock / dev-mock operator names can never enable REAL_MONEY', () => {
    for (const name of [undefined, '', 'mock', 'dev-mock', '  MOCK  ']) {
      const verdict = resolveRoyaleRealMoney(
        productionRealMoneyEnv({ OPERATOR_PROVIDER: name }),
      );
      expect(verdict.available).toBe(false);
    }
  });

  it('A: real money never activates outside a production runtime', () => {
    const verdict = resolveRoyaleRealMoney(productionRealMoneyEnv({ NODE_ENV: 'test' }));
    expect(verdict.available).toBe(false);
    expect(verdict.reason).toMatch(/production runtime/i);
  });

  it('preserves every explicit requirement (allow flag + mode)', () => {
    expect(
      resolveRoyaleRealMoney(productionRealMoneyEnv({ ROYALE_REAL_MONEY_ALLOWED: 'false' }))
        .reason,
    ).toMatch(/ROYALE_REAL_MONEY_ALLOWED is not true/);
    expect(
      resolveRoyaleRealMoney(productionRealMoneyEnv({ ROYALE_MODE: 'FREE_PLAY' })).reason,
    ).toMatch(/ROYALE_MODE is not REAL_MONEY/);
    expect(
      resolveRoyaleRealMoney(
        productionRealMoneyEnv({ ROYALE_REAL_MONEY_ALLOWED: undefined }),
      ).available,
    ).toBe(false);
  });
});

describe('UnconfiguredOperatorAdapter can never satisfy REAL_MONEY (B)', () => {
  it('B: neither the unconfigured adapter nor the dev mock is an implemented adapter', () => {
    expect(isImplementedOperatorAdapter(new UnconfiguredOperatorAdapter())).toBe(false);
    expect(isImplementedOperatorAdapter(new MockOperatorAdapter())).toBe(false);
    expect(new UnconfiguredOperatorAdapter().name).toBe('unconfigured');
  });

  it('B: isRealMoneyCapableOperator is false for every name with no implemented adapter', () => {
    for (const name of ['', 'mock', 'dev-mock', 'operator-http', 'unknown-provider']) {
      expect(
        isRealMoneyCapableOperator({ NODE_ENV: 'production', OPERATOR_PROVIDER: name }),
      ).toBe(false);
    }
  });

  it('B: the capability result is secret-free and states the real reason', () => {
    const capability = resolveRealMoneyOperatorAdapter(productionRealMoneyEnv());
    expect(capability.capable).toBe(false);
    expect(capability.reason).toMatch(/no real adapter is implemented/i);
    expect(capability.reason).not.toMatch(/test-payment-key|generic-http/i);
  });

  it('B: no Royale game registers a fabricated operator adapter', () => {
    const config = loadRoyaleConfig(productionRealMoneyEnv());
    expect(config.realMoneyAvailable).toBe(false);
    expect(config.mode).toBe('FREE_PLAY');
  });
});
describe('Royale config invariants (never trust client / never overpay)', () => {
  it('RTP is clamped to (0, 10000] bp so no table can target >100%', () => {
    expect(loadRoyaleConfig({ ROYALE_RTP_BP: '99999' } as NodeJS.ProcessEnv).rtpBp).toBe(
      10_000,
    );
    expect(loadRoyaleConfig({ ROYALE_RTP_BP: '0' } as NodeJS.ProcessEnv).rtpBp).toBe(9_900);
  });

  it('the multiplier cap is clamped so payout can never overflow Postgres INTEGER', () => {
    const cfg = loadRoyaleConfig({
      ROYALE_MAX_STAKE: '100000000',
      ROYALE_MAX_MULTIPLIER_BP: '1000000000',
    } as NodeJS.ProcessEnv);
    // payout = floor(maxStake * maxMultiplierBp / 10000) must stay <= 2e9.
    const worstPayout = Math.floor((cfg.maxStake * cfg.maxMultiplierBp) / 10_000);
    expect(worstPayout).toBeLessThanOrEqual(2_000_000_000);
  });

  it('Mines grids are always perfect squares >= 9, and mines stay within [1,24]', () => {
    const cfg = loadRoyaleConfig({} as NodeJS.ProcessEnv);
    for (const g of cfg.grids) {
      const root = Math.round(Math.sqrt(g));
      expect(root * root).toBe(g);
      expect(g).toBeGreaterThanOrEqual(9);
    }
    expect(cfg.minMines).toBeGreaterThanOrEqual(1);
    expect(cfg.maxMines).toBeLessThanOrEqual(24);
  });

  it('plinko row bounds always leave at least one paytable bin', () => {
    const cfg = loadRoyaleConfig({} as NodeJS.ProcessEnv);
    expect(cfg.maxRows).toBeGreaterThan(cfg.minRows);
    expect(cfg.minRows).toBeGreaterThanOrEqual(2);
  });
});

