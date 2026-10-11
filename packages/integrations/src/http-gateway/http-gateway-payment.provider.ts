import type {
  DepositProviderInterface,
  DepositProviderResult,
  DepositRequest,
  WithdrawalProviderInterface,
  WithdrawalProviderResult,
  WithdrawalRequest,
} from '../interfaces/payment-provider.interface';
import type { ProviderTransactionStatus } from '../interfaces/types';

/**
 * Real generic HTTP payment-gateway adapter.
 *
 * IMPORTANT — this adapter only runs when a REAL provider is configured:
 *   PAYMENT_PROVIDER=<name>
 *   PAYMENT_PROVIDER_URL=https://gateway.example.com
 *   PAYMENT_PROVIDER_KEY=<merchant/api key>
 *   PAYMENT_PROVIDER_SECRET=<signing secret>
 *
 * It makes real HTTPS calls to the configured gateway and NEVER fabricates a
 * transaction: every response is parsed from the gateway itself. If the
 * gateway is unreachable or returns an error, the deposit/withdrawal fails
 * with a provider-unavailable error — it is never silently marked complete.
 *
 * Expected provider contract (documented, provider-agnostic REST):
 *   POST   {baseUrl}/deposits        -> create deposit
 *   GET    {baseUrl}/deposits/{id}    -> check deposit status
 *   POST   {baseUrl}/withdrawals     -> create payout
 *   GET    {baseUrl}/withdrawals/{id} -> check payout status
 *
 * Request body: { accountRef, amount (minor units), currency, idempotencyKey }
 * Response:     { transactionId, status, message? }
 * where status is one of SUCCESS | PENDING | PROCESSING | FAILED | CANCELLED.
 *
 * Webhook delivery (when the gateway supports it) is validated by the API's
 * webhook endpoint using PAYMENT_WEBHOOK_SECRET.
 */
export interface HttpGatewayConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  apiSecret?: string;
  /** Request timeout in ms. */
  timeoutMs?: number;
}

function providerError(message: string, code = 'PROVIDER_UNAVAILABLE'): never {
  const error = new Error(message);
  (error as { code?: string }).code = code;
  throw error;
}

export class HttpGatewayPaymentProvider implements DepositProviderInterface, WithdrawalProviderInterface {
  readonly name: string;

  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly apiSecret?: string;
  private readonly timeoutMs: number;

  constructor(config: HttpGatewayConfig) {
    if (!config.baseUrl || !config.apiKey) {
      providerError('Gateway provider requires PAYMENT_PROVIDER_URL and PAYMENT_PROVIDER_KEY');
    }
    this.name = config.name;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.timeoutMs = config.timeoutMs ?? 15_000;
  }
private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(this.apiSecret ? { 'X-Provider-Secret': this.apiSecret } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: controller.signal,
      });

      if (!response.ok) {
        let detail = `gateway responded ${response.status}`;
        try {
          const text = await response.text();
          if (text) detail = text.slice(0, 500);
        } catch {
          /* ignore body parse errors */
        }
        providerError(`Payment gateway error on ${path}: ${detail}`, 'PROVIDER_ERROR');
      }

      return (await response.json()) as T;
    } catch (error) {
      if (error instanceof Error && (error as { code?: string }).code) {
        throw error;
      }
      providerError(
        `Payment gateway is temporarily unavailable. Please try again later.`,
        'PROVIDER_UNAVAILABLE',
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /** Maps a gateway status string to the provider domain status. */
  private mapStatus(raw: string): ProviderTransactionStatus {
    switch (String(raw).toUpperCase()) {
      case 'SUCCESS':
      case 'COMPLETED':
      case 'SETTLED':
        return 'SUCCESS';
      case 'FAILED':
      case 'DECLINED':
      case 'ERROR':
        return 'FAILED';
      case 'CANCELLED':
      case 'CANCELED':
      case 'EXPIRED':
        return 'CANCELLED';
      case 'PROCESSING':
        return 'PROCESSING';
      default:
        return 'PENDING';
    }
  }

  async initDeposit(request: DepositRequest): Promise<DepositProviderResult> {
    const raw = await this.request<{
      transactionId?: string;
      status?: string;
      message?: string | null;
    }>('POST', '/deposits', {
      accountRef: request.accountRef,
      amount: request.amount,
      currency: request.currency,
      idempotencyKey: request.idempotencyKey,
    });

    if (!raw.transactionId) {
      providerError('Payment gateway returned no transaction id', 'PROVIDER_ERROR');
    }

    return {
      externalTransactionId: raw.transactionId,
      status: this.mapStatus(raw.status ?? 'PENDING') as DepositProviderResult['status'],
      message: raw.message ?? null,
    };
  }

  async getDepositStatus(externalTransactionId: string): Promise<ProviderTransactionStatus> {
    const raw = await this.request<{ status?: string }>(
      'GET',
      `/deposits/${encodeURIComponent(externalTransactionId)}`,
    );
    return this.mapStatus(raw.status ?? 'PENDING');
  }

  async requestWithdrawal(request: WithdrawalRequest): Promise<WithdrawalProviderResult> {
    const raw = await this.request<{
      transactionId?: string;
      status?: string;
      message?: string | null;
    }>('POST', '/withdrawals', {
      accountRef: request.accountRef,
      amount: request.amount,
      currency: request.currency,
      idempotencyKey: request.idempotencyKey,
    });

    if (!raw.transactionId) {
      providerError('Payment gateway returned no transaction id', 'PROVIDER_ERROR');
    }

    return {
      externalTransactionId: raw.transactionId,
      status: this.mapStatus(raw.status ?? 'PENDING') as WithdrawalProviderResult['status'],
      message: raw.message ?? null,
    };
  }

  async getWithdrawalStatus(externalTransactionId: string): Promise<ProviderTransactionStatus> {
    const raw = await this.request<{ status?: string }>(
      'GET',
      `/withdrawals/${encodeURIComponent(externalTransactionId)}`,
    );
    return this.mapStatus(raw.status ?? 'PENDING');
  }
}