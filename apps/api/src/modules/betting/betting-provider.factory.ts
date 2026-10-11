import { ServiceUnavailableException } from '@nestjs/common';
import { readNodeEnv } from '@tanvion-royale/config';
import {
  OperatorProviderInterface,
  MockOperatorAdapter,
  UnconfiguredOperatorAdapter,
} from '@tanvion-royale/integrations';

/**
 * Betting/operator provider factory.
 *
 * - Production: a real adapter is returned ONLY when OPERATOR_PROVIDER
 *   names an adapter that is actually implemented here. Unset/`mock`/
 *   unknown names fail safely with the UnconfiguredOperatorAdapter — bets
 *   are NEVER placed with fake money or fake odds; the betting surface
 *   reports "provider not configured" instead.
 * - Development/test: the clearly-labelled MockOperatorAdapter remains
 *   available for automated tests and local development only.
 *
 * CAPABILITY (fail-closed): a provider NAME is never proof that a real adapter
 * exists. The single source of truth is IMPLEMENTED_REAL_OPERATOR_ADAPTERS
 * below plus the instance check in `isImplementedOperatorAdapter`. Consumers
 * that may move real money (the crash engine's REAL_MONEY gate) must ask for
 * the capability (`resolveRealMoneyOperatorAdapter` /
 * `isRealMoneyCapableOperator`) instead of trusting OPERATOR_PROVIDER.
 */

/** Instantiates ONE real, actually-implemented operator adapter. */
type OperatorAdapterFactory = () => OperatorProviderInterface;

/**
 * Registry of REAL, actually-implemented operator adapters.
 *
 * A name present in this map is the ONLY proof that a real adapter exists: the
 * factory must construct an adapter that really implements the licensed
 * operator protocol (authenticate/getEvents/placeBet…), reviewed and tested.
 * While no such adapter is implemented this map stays EMPTY and every
 * configured name fails safe — real money can never be enabled by an env var
 * alone. A future adapter (e.g. `operator-http`) plugs in exactly here, behind
 * the same OperatorProviderInterface.
 */
const IMPLEMENTED_REAL_OPERATOR_ADAPTERS: ReadonlyMap<string, OperatorAdapterFactory> = new Map<
  string,
  OperatorAdapterFactory
>();

/** Normalized OPERATOR_PROVIDER value ("" when unset). */
function operatorProviderName(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPERATOR_PROVIDER?.trim().toLowerCase() ?? '';
}

/** Development-only provider names — never real money, ever. */
function isMockProviderName(name: string): boolean {
  return name === 'mock' || name === 'dev-mock';
}

/**
 * Fails closed: an adapter counts as "implemented" only when it is neither the
 * UnconfiguredOperatorAdapter nor the MockOperatorAdapter (checked by instance
 * AND by name, so a mislabelled adapter can never slip through).
 */
export function isImplementedOperatorAdapter(adapter: unknown): boolean {
  if (!adapter || typeof adapter !== 'object') return false;
  if (adapter instanceof UnconfiguredOperatorAdapter) return false;
  if (adapter instanceof MockOperatorAdapter) return false;
  const name = (adapter as { name?: unknown }).name;
  if (typeof name !== 'string') return false;
  const normalized = name.trim().toLowerCase();
  return normalized !== '' && normalized !== 'unconfigured' && !isMockProviderName(normalized);
}

export interface RealMoneyOperatorCapability {
  /** true ONLY when an implemented, supported real adapter is selected. */
  capable: boolean;
  /** Configured provider name (normalized) or null when unset/mock. */
  provider: string | null;
  /** Safe, secret-free reason suitable for logs/status output. */
  reason: string;
}

/**
 * Resolves whether a REAL, actually-implemented licensed-operator adapter is
 * active. Fail-closed by construction:
 *   1. the runtime must be production (real money is never enabled elsewhere),
 *   2. OPERATOR_PROVIDER must name a provider,
 *   3. that name must be listed in IMPLEMENTED_REAL_OPERATOR_ADAPTERS (a real
 *      implemented adapter — a name alone is NOT proof),
 *   4. the factory must actually produce an implemented adapter.
 * Mock / unconfigured adapters can never satisfy any step.
 */
export function resolveRealMoneyOperatorAdapter(
  env: NodeJS.ProcessEnv = process.env,
): RealMoneyOperatorCapability {
  const provider = operatorProviderName(env);
  if (readNodeEnv(env) !== 'production') {
    return {
      capable: false,
      provider: provider || null,
      reason: 'REAL_MONEY requires a production runtime (NODE_ENV=production)',
    };
  }
  if (!provider) {
    return {
      capable: false,
      provider: null,
      reason:
        'No licensed-operator adapter is configured (UnconfiguredOperatorAdapter fail-safe active)',
    };
  }
  if (isMockProviderName(provider)) {
    return {
      capable: false,
      provider,
      reason: `Betting provider "${provider}" is a development mock — never real money`,
    };
  }
  const factory = IMPLEMENTED_REAL_OPERATOR_ADAPTERS.get(provider);
  if (!factory) {
    return {
      capable: false,
      provider,
      reason: `Betting provider "${provider}" is named but no real adapter is implemented yet`,
    };
  }
  let adapter: OperatorProviderInterface | null = null;
  try {
    adapter = factory();
  } catch {
    adapter = null;
  }
  if (!isImplementedOperatorAdapter(adapter)) {
    return {
      capable: false,
      provider,
      reason: `Betting provider "${provider}" did not produce an implemented adapter`,
    };
  }
  return {
    capable: true,
    provider,
    reason: `Implemented licensed-operator adapter "${provider}" is active`,
  };
}

/** Convenience boolean for fail-closed gates (never trust a name alone). */
export function isRealMoneyCapableOperator(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveRealMoneyOperatorAdapter(env).capable;
}

export function createBettingProvider(): OperatorProviderInterface {
  const provider = operatorProviderName();
  if (!provider || isMockProviderName(provider)) {
    if (process.env.NODE_ENV === 'production') {
      return new UnconfiguredOperatorAdapter('Betting provider is not configured. Contact support to enable betting.');
    }
    // Development / test only — clearly labelled mock, never real funds.
    return new MockOperatorAdapter();
  }
  const factory = IMPLEMENTED_REAL_OPERATOR_ADAPTERS.get(provider);
  if (factory) {
    const adapter = factory();
    // Fail closed if the registered factory does not return a real adapter.
    if (isImplementedOperatorAdapter(adapter)) return adapter;
  }
  // A name is configured but no adapter is implemented: fail safe instead of
  // silently inventing provider behaviour.
  return new UnconfiguredOperatorAdapter(
    `Betting provider "${provider}" is configured but no adapter is implemented yet.`,
  );
}

/**
 * Names a real (non-mock) provider — used for health/status reporting.
 *
 * NOTE: this is a NAME, not proof that an implemented adapter exists. Real-money
 * decisions must use `resolveRealMoneyOperatorAdapter`/`isRealMoneyCapableOperator`.
 */
export function configuredBettingProviderName(): string | null {
  if (process.env.NODE_ENV === 'production') {
    const provider = operatorProviderName();
    return provider && !isMockProviderName(provider) ? provider : null;
  }
  return null;
}

/** Throws a safe config-required error when betting is unconfigured in production. */
export function assertBettingConfigured(): void {
  if (process.env.NODE_ENV === 'production') {
    const provider = operatorProviderName();
    if (!provider || isMockProviderName(provider)) {
      throw new ServiceUnavailableException('Betting provider is not configured. Contact support to enable betting.');
    }
  }
}