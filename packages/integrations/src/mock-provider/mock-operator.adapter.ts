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
import { OperatorError } from '../core/errors';
import { buildMockCatalog } from './catalog';

/**
 * Modes the mock operator can simulate so the provider boundary can be tested
 * without a real operator:
 *  - success:       normal acceptance.
 *  - rejected:      the operator refuses the bet (BET_REJECTED).
 *  - unavailable:   the operator cannot be reached (PROVIDER_UNAVAILABLE).
 *  - odds_changed:  the operator detects the price moved (ODDS_CHANGED).
 */
export type MockProviderSimulation =
  | { mode: 'success' }
  | { mode: 'rejected' }
  | { mode: 'unavailable' }
  | { mode: 'odds_changed' };

/**
 * In-memory mock operator used for development and testing.
 *
 * It simulates provider behaviour without real-money transactions:
 * sports/events/markets/odds, bet acceptance, balance, transactions and
 * webhooks.
 *
 * WARNING: Mock-only. Never point the mock at real customer funds or a real
 * odds source. Real licensed providers must implement OperatorProviderInterface
 * behind the same abstraction.
 */
export class MockOperatorAdapter implements OperatorProviderInterface {
  readonly name = 'mock';

  private authenticated = false;
  private betCounter = 0;
  private simulation: MockProviderSimulation | null = null;
  private readonly catalog = buildMockCatalog();

  /** Configure the mock to simulate a provider outcome (dev/test only). */
  setSimulation(simulation: MockProviderSimulation | null): void {
    this.simulation = simulation;
  }

  /** Clear any active simulation and return to normal acceptance. */
  clearSimulation(): void {
    this.simulation = null;
  }

  async authenticate(): Promise<void> {
    this.authenticated = true;
  }

  private requireAuth(): void {
    if (!this.authenticated) {
      throw new OperatorError('UNAUTHORIZED', 'Mock operator is not authenticated', this.name);
    }
  }

  async getSports(): Promise<ProviderSport[]> {
    this.requireAuth();
    return this.catalog.sports;
  }

  async getCompetitions(): Promise<ProviderCompetition[]> {
    this.requireAuth();
    return this.catalog.events.map((e) => e.competition);
  }

  async getEvents(): Promise<ProviderEvent[]> {
    this.requireAuth();
    return this.catalog.events;
  }

  async getEvent(eventExternalId: string): Promise<ProviderEvent | null> {
    this.requireAuth();
    return this.catalog.events.find((e) => e.externalId === eventExternalId) ?? null;
  }

  async getMarkets(eventExternalId: string): Promise<ProviderMarket[]> {
    this.requireAuth();
    return this.catalog.odds
      .filter((o) => o.selection.market.event.externalId === eventExternalId)
      .map((o) => o.selection.market);
  }

  async getSelections(marketExternalId: string): Promise<ProviderSelection[]> {
    this.requireAuth();
    return this.catalog.odds
      .filter((o) => o.selection.market.externalId === marketExternalId)
      .map((o) => o.selection);
  }

  async getOdds(marketExternalId: string): Promise<ProviderOdd[]> {
    this.requireAuth();
    return this.catalog.odds.filter((o) => o.selection.market.externalId === marketExternalId);
  }

  async placeBet(request: PlaceBetRequest): Promise<PlaceBetResult> {
    this.requireAuth();

    const simulation = this.simulation;
    if (simulation) {
      switch (simulation.mode) {
        case 'rejected':
          throw new OperatorError('BET_REJECTED', 'Mock operator rejected the bet', this.name);
        case 'unavailable':
          throw new OperatorError('PROVIDER_UNAVAILABLE', 'Mock operator is unreachable', this.name);
        case 'odds_changed':
          throw new OperatorError('ODDS_CHANGED', 'Odds changed on the provider', this.name);
        case 'success':
          break;
      }
    }

    this.betCounter += 1;
    const externalBetId = `MOCK-BET-${this.betCounter}`;
    const stake = request.stake;
    const returnOdds = Math.max(...request.selections.map((s) => Number.parseFloat(s.requestedDecimal)));
    return {
      externalBetId,
      status: 'ACCEPTED',
      acceptedOdds: returnOdds.toFixed(2),
      potentialReturn: Math.round(stake * returnOdds),
      message: 'Accepted (mock)',
      raw: { idempotencyKey: request.idempotencyKey },
    };
  }

  async getBet(externalBetId: string): Promise<unknown> {
    this.requireAuth();
    return { externalBetId, status: 'ACCEPTED', provider: this.name };
  }

  async getBalance(): Promise<ProviderBalance> {
    this.requireAuth();
    return { currency: 'BDT', available: 10000, bonus: 0, pending: 0, withdrawable: 10000 };
  }

  async createDeposit(_accountRef: string, amount: number, currency: string): Promise<ProviderTransaction> {
    this.requireAuth();
    return {
      externalTransactionId: `mock-deposit-${Date.now()}`,
      kind: 'DEPOSIT',
      amount,
      signedAmount: amount,
      currency,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };
  }

  async getTransaction(externalTransactionId: string): Promise<ProviderTransaction> {
    this.requireAuth();
    return {
      externalTransactionId,
      kind: 'DEPOSIT',
      amount: 0,
      signedAmount: 0,
      currency: 'BDT',
      status: 'SUCCESS',
      createdAt: new Date().toISOString(),
    };
  }

  async requestWithdrawal(_accountRef: string, amount: number, currency: string): Promise<ProviderTransaction> {
    this.requireAuth();
    return {
      externalTransactionId: `mock-withdrawal-${Date.now()}`,
      kind: 'WITHDRAWAL',
      amount,
      signedAmount: -amount,
      currency,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
    };
  }

  async handleWebhook(event: ProviderWebhookEvent): Promise<unknown> {
    this.requireAuth();
    return { received: true, eventId: event.eventId, type: event.type };
  }
}