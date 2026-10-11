/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * MUST-FIX #1 regression tests — the crash REAL_MONEY gate is FAIL-CLOSED.
 *
 * Requirements pinned here:
 *   A. REAL_MONEY stays unavailable when OPERATOR_PROVIDER merely NAMES a
 *      provider but no real adapter is implemented.
 *   B. UnconfiguredOperatorAdapter (and the dev mock) can NEVER satisfy the
 *      real-money capability — by name, by instance or via the factory.
 *   + every pre-existing flag/secret requirement is still enforced.
 */

import { MockOperatorAdapter, UnconfiguredOperatorAdapter } from '@tanvion-royale/integrations';
import {
  configuredBettingProviderName,
  createBettingProvider,
  isImplementedOperatorAdapter,
  isRealMoneyCapableOperator,
  resolveRealMoneyOperatorAdapter,
} from '../src/modules/betting/betting-provider.factory';
import { loadCrashConfig, resolveRealMoney } from '../src/modules/crash/crash.config';

jest.setTimeout(30_000);

const ENV = process.env;

afterEach(() => {
  process.env = ENV;
  jest.restoreAllMocks();
});

/** Production env where EVERYTHING is configured except an implemented adapter. */
function productionRealMoneyEnv(
  overrides: Record<string, string | undefined> = {},
): NodeJS.ProcessEnv {
  return {
    NODE_ENV: 'production',
    CRASH_MODE: 'REAL_MONEY',
    CRASH_REAL_MONEY_ALLOWED: 'true',
    OPERATOR_PROVIDER: 'operator-http',
    PAYMENT_PROVIDER: 'generic-http',
    PAYMENT_PROVIDER_URL: 'https://payments.example.test',
    PAYMENT_PROVIDER_KEY: 'test-payment-key',
    ...overrides,
  } as NodeJS.ProcessEnv;
}

function withEnv(overrides: Record<string, string | undefined>): void {
  process.env = { ...ENV, NODE_ENV: 'production', ...overrides } as NodeJS.ProcessEnv;
}

describe('crash REAL_MONEY gate — a provider NAME is never proof (A)', () => {
  it('A: a named but unimplemented OPERATOR_PROVIDER does NOT enable REAL_MONEY', () => {
    const verdict = resolveRealMoney(productionRealMoneyEnv());
    expect(verdict.available).toBe(false);
    expect(verdict.reason).toMatch(/no real adapter is implemented/i);
  });

  it('A: the crash engine therefore stays in FREE_PLAY with that same env', () => {
    const config = loadCrashConfig(productionRealMoneyEnv());
    expect(config.mode).toBe('FREE_PLAY');
    expect(config.realMoneyAvailable).toBe(false);
    expect(config.realMoneyReason).toMatch(/Falling back to FREE_PLAY/);
    expect(config.realMoneyReason).toMatch(/no real adapter is implemented/i);
  });

  it('A: unset / mock / dev-mock operator names can never enable REAL_MONEY in production', () => {
    for (const name of [undefined, '', 'mock', 'dev-mock', '  MOCK  ']) {
      const verdict = resolveRealMoney(productionRealMoneyEnv({ OPERATOR_PROVIDER: name }));
      expect(verdict.available).toBe(false);
    }
  });

  it('A: real money never activates outside a production runtime', () => {
    const verdict = resolveRealMoney(productionRealMoneyEnv({ NODE_ENV: 'test' }));
    expect(verdict.available).toBe(false);
    expect(verdict.reason).toMatch(/production runtime/i);
  });

  it('preserves the existing requirements (allow flag + CRASH_MODE + payment provider)', () => {
    expect(
      resolveRealMoney(productionRealMoneyEnv({ CRASH_REAL_MONEY_ALLOWED: 'false' })).reason,
    ).toMatch(/CRASH_REAL_MONEY_ALLOWED is not true/);
    expect(
      resolveRealMoney(productionRealMoneyEnv({ CRASH_MODE: 'FREE_PLAY' })).reason,
    ).toMatch(/CRASH_MODE is not REAL_MONEY/);
    expect(
      resolveRealMoney(productionRealMoneyEnv({ CRASH_REAL_MONEY_ALLOWED: undefined })).available,
    ).toBe(false);
  });
});

describe('UnconfiguredOperatorAdapter can never satisfy REAL_MONEY (B)', () => {
  it('B: neither the unconfigured adapter nor the dev mock is an implemented adapter', () => {
    expect(isImplementedOperatorAdapter(new UnconfiguredOperatorAdapter())).toBe(false);
    expect(isImplementedOperatorAdapter(new MockOperatorAdapter())).toBe(false);
    expect(isImplementedOperatorAdapter(undefined)).toBe(false);
    expect(isImplementedOperatorAdapter({})).toBe(false);
    expect(isImplementedOperatorAdapter({ name: 'unconfigured' })).toBe(false);
    expect(isImplementedOperatorAdapter({ name: 'mock' })).toBe(false);
    expect(new UnconfiguredOperatorAdapter().name).toBe('unconfigured');
  });

  it('B: isRealMoneyCapableOperator is false for every name with no implemented adapter', () => {
    for (const name of [
      'operator-http',
      'generic-http',
      'licensed-operator',
      'bkash',
      'mock',
      'dev-mock',
      '',
    ]) {
      expect(isRealMoneyCapableOperator(productionRealMoneyEnv({ OPERATOR_PROVIDER: name }))).toBe(
        false,
      );
    }
  });

  it('B: the capability result is secret-free and states the real reason', () => {
    const capability = resolveRealMoneyOperatorAdapter(productionRealMoneyEnv());
    expect(capability.capable).toBe(false);
    expect(capability.provider).toBe('operator-http');
    expect(capability.reason).toMatch(/no real adapter is implemented/i);
    expect(JSON.stringify(capability)).not.toContain('test-payment-key');
    expect(JSON.stringify(capability)).not.toMatch(/https?:/);
  });

  it('B: a capability is only ever reported for an implemented, supported adapter', () => {
    // The registry of implemented real adapters is empty today, so NO name can
    // produce a capable verdict — including a randomly "real sounding" one.
    for (const name of ['live-operator', 'tanvion-partner-v2', 'x'.repeat(40)]) {
      const capability = resolveRealMoneyOperatorAdapter(
        productionRealMoneyEnv({ OPERATOR_PROVIDER: name }),
      );
      expect(capability.capable).toBe(false);
      expect(capability.reason).toMatch(/no real adapter is implemented/i);
    }
  });
});

describe('betting provider factory still fails safe (A/B)', () => {
  it('A: a named-but-unimplemented provider yields the fail-safe adapter, never a fake one', () => {
    withEnv({ OPERATOR_PROVIDER: 'operator-http' });
    const provider = createBettingProvider();
    expect(provider).toBeInstanceOf(UnconfiguredOperatorAdapter);
    expect(provider.name).toBe('unconfigured');
  });

  it('A: an unset provider in production yields the fail-safe adapter', () => {
    withEnv({ OPERATOR_PROVIDER: '' });
    expect(createBettingProvider()).toBeInstanceOf(UnconfiguredOperatorAdapter);
    expect(configuredBettingProviderName()).toBeNull();
  });

  it('B: development/test keeps the clearly-labelled mock adapter (never real money)', () => {
    withEnv({ NODE_ENV: 'test', OPERATOR_PROVIDER: '' });
    const provider = createBettingProvider();
    expect(provider).toBeInstanceOf(MockOperatorAdapter);
    expect(
      isRealMoneyCapableOperator({ NODE_ENV: 'test', OPERATOR_PROVIDER: 'mock' } as NodeJS.ProcessEnv),
    ).toBe(false);
  });
});
