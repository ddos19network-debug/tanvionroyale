import type {
  OperatorProviderInterface,
  PlaceBetRequest,
  PlaceBetResult,
  ProviderBalance,
  ProviderCompetition,
  ProviderEvent,
  ProviderMarket,
  ProviderOdd,
  ProviderSelection,
  ProviderSport,
  ProviderTransaction,
  ProviderWebhookEvent,
} from '../interfaces';
import { OperatorError } from './errors';

/**
 * Placeholder provider returned when NO real betting/operator provider has
 * been configured.
 *
 * PRODUCTION SAFETY: this adapter is wired whenever `OPERATOR_PROVIDER`
 * is unset/`mock` (or names a provider with no adapter implemented yet). It
 * NEVER fabricates sports, odds, balances or bets — every operation fails
 * with a clear, user-safe `PROVIDER_UNAVAILABLE` error so the application
 * shows "configuration required / service unavailable" instead of fake data.
 *
 * The mock operator adapter remains available ONLY outside production (dev/
 * test) where it is used by automated tests and local development.
 */
export class UnconfiguredOperatorAdapter implements OperatorProviderInterface {
  readonly name = 'unconfigured';

  constructor(private readonly detail = 'Betting provider is not configured') {}

  private fail(): never {
    throw new OperatorError('PROVIDER_UNAVAILABLE', this.detail, this.name);
  }

  async authenticate(): Promise<void> {
    this.fail();
  }
  async getSports(): Promise<ProviderSport[]> {
    this.fail();
  }
  async getCompetitions(): Promise<ProviderCompetition[]> {
    this.fail();
  }
  async getEvents(): Promise<ProviderEvent[]> {
    this.fail();
  }
  async getEvent(): Promise<ProviderEvent | null> {
    this.fail();
  }
  async getMarkets(): Promise<ProviderMarket[]> {
    this.fail();
  }
  async getSelections(): Promise<ProviderSelection[]> {
    this.fail();
  }
  async getOdds(): Promise<ProviderOdd[]> {
    this.fail();
  }
  async placeBet(_request: PlaceBetRequest): Promise<PlaceBetResult> {
    this.fail();
  }
  async getBet(): Promise<unknown> {
    this.fail();
  }
  async getBalance(): Promise<ProviderBalance> {
    this.fail();
  }
  async createDeposit(): Promise<ProviderTransaction> {
    this.fail();
  }
  async getTransaction(): Promise<ProviderTransaction> {
    this.fail();
  }
  async requestWithdrawal(): Promise<ProviderTransaction> {
    this.fail();
  }
  async handleWebhook(_event: ProviderWebhookEvent): Promise<unknown> {
    this.fail();
  }
}