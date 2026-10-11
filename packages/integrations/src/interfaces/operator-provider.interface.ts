import type {
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
} from './types';

/**
 * Contract every licensed operator adapter MUST implement.
 *
 * The rest of the application depends ONLY on this interface, so a new
 * provider (provider-a, provider-b, ...) can be added without rewriting the
 * core TanvionRoyale modules.
 *
 * All money is expressed as integer minor units; all odds as decimal strings.
 */
export interface OperatorProviderInterface {
  readonly name: string;

  /** Authenticate against the provider and prepare an API client. */
  authenticate(): Promise<void>;

  getSports(): Promise<ProviderSport[]>;
  getCompetitions(): Promise<ProviderCompetition[]>;
  getEvents(sportExternalId?: string): Promise<ProviderEvent[]>;
  getEvent(eventExternalId: string): Promise<ProviderEvent | null>;
  getMarkets(eventExternalId: string): Promise<ProviderMarket[]>;
  getSelections(marketExternalId: string): Promise<ProviderSelection[]>;
  getOdds(marketExternalId: string): Promise<ProviderOdd[]>;

  /** Submit a bet to the licensed operator. Must be idempotency-safe. */
  placeBet(request: PlaceBetRequest): Promise<PlaceBetResult>;
  getBet(externalBetId: string): Promise<unknown>;

  getBalance(accountRef: string): Promise<ProviderBalance>;
  createDeposit(accountRef: string, amount: number, currency: string): Promise<ProviderTransaction>;
  getTransaction(externalTransactionId: string): Promise<ProviderTransaction>;
  requestWithdrawal(accountRef: string, amount: number, currency: string): Promise<ProviderTransaction>;

  /** Deliver / describe a verified provider webhook for downstream handling. */
  handleWebhook(event: ProviderWebhookEvent): Promise<unknown>;
}