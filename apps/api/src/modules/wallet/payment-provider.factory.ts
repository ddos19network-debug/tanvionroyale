import {
  DepositProviderInterface,
  DevMockDepositProvider,
  DevMockWithdrawalProvider,
  HttpGatewayPaymentProvider,
  UnconfiguredPaymentProvider,
  WithdrawalProviderInterface,
} from '@tanvion-royale/integrations';

/**
 * Payment provider factory.
 *
 * - Production: deposits/withdrawals fail safely whenever no real provider is
 *   configured (PAYMENT_PROVIDER unset/mock or unknown). No fake money
 *   is ever created; the wallet reports "provider not configured" instead.
 * - Development/test: the clearly-labelled DevMock providers remain available
 *   for automated tests and local development only.
 *
 * Real provider selection (`PAYMENT_PROVIDER`, `PAYMENT_PROVIDER_URL`,
 * `PAYMENT_PROVIDER_KEY`, `PAYMENT_PROVIDER_SECRET`):
 *   PAYMENT_PROVIDER names the adapter to use. "generic-http" (alias
 *   "gateway"/"rest") activates the real HTTP gateway adapter ONLY when
 *   PAYMENT_PROVIDER_URL and PAYMENT_PROVIDER_KEY are present. Any other name
 *   without an implemented adapter fails safely (never faked).
 */
function resolvePaymentProviderName(): string {
  const provider = process.env.PAYMENT_PROVIDER?.trim().toLowerCase() ?? '';
  if (process.env.NODE_ENV === 'production' && (!provider || provider === 'mock' || provider === 'dev-mock')) {
    return '';
  }
  return provider;
}

function gatewayConfigured(name: string): boolean {
  const providerUrl = process.env.PAYMENT_PROVIDER_URL?.trim() ?? '';
  const providerKey = process.env.PAYMENT_PROVIDER_KEY?.trim() ?? '';
  return Boolean(providerUrl && providerKey);
}

function resolveGatewayProvider(name: string): DepositProviderInterface & WithdrawalProviderInterface {
  if (gatewayConfigured(name)) {
    return new HttpGatewayPaymentProvider({
      name,
      baseUrl: process.env.PAYMENT_PROVIDER_URL as string,
      apiKey: process.env.PAYMENT_PROVIDER_KEY as string,
      apiSecret: process.env.PAYMENT_PROVIDER_SECRET?.trim() || undefined,
    });
  }
  // A provider is named but its real endpoint/key are missing: never fake it.
  return new UnconfiguredPaymentProvider(
    `Payment provider "${name}" is configured but PAYMENT_PROVIDER_URL/PAYMENT_PROVIDER_KEY are missing.`,
  );
}

export function createDepositProvider(): DepositProviderInterface {
  const provider = resolvePaymentProviderName();
  if (provider) {
    // Real adapter path: generic-http REST gateway (bKash/Nagad/Rocket/Bank/
    // Card through a license counterparty). Future adapters plug in here
    // behind the same DepositProviderInterface.
    if (provider === 'generic-http' || provider === 'gateway' || provider === 'rest') {
      return resolveGatewayProvider(provider);
    }
    return new UnconfiguredPaymentProvider(`Payment provider "${provider}" is configured but no adapter is implemented yet.`);
  }
  if (process.env.NODE_ENV === 'production') {
    return new UnconfiguredPaymentProvider('Payment provider is not configured. Contact support to enable deposits and withdrawals.');
  }
  return new DevMockDepositProvider();
}

export function createWithdrawalProvider(): WithdrawalProviderInterface {
  const provider = resolvePaymentProviderName();
  if (provider) {
    if (provider === 'generic-http' || provider === 'gateway' || provider === 'rest') {
      return resolveGatewayProvider(provider);
    }
    return new UnconfiguredPaymentProvider(`Payment provider "${provider}" is configured but no adapter is implemented yet.`);
  }
  if (process.env.NODE_ENV === 'production') {
    return new UnconfiguredPaymentProvider('Payment provider is not configured. Contact support to enable deposits and withdrawals.');
  }
  return new DevMockWithdrawalProvider();
}
