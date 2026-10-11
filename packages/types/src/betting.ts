// ---------------------------------------------------------------------------
// Betting domain (Phase 5)
//
// Money amounts (`stake`, `potentialPayout`) are integer MINOR UNITS (e.g.
// poisha for BDT). Odds are decimal STRINGS (e.g. "1.85") to avoid any
// floating-point drift. These are the API-safe, frontend-facing shapes —
// internal provider identifiers and secrets are never exposed here.
// ---------------------------------------------------------------------------

export type EventStatus = 'SCHEDULED' | 'LIVE' | 'SUSPENDED' | 'FINISHED' | 'CANCELLED';
export type MarketStatus = 'OPEN' | 'SUSPENDED' | 'CLOSED';
export type SelectionStatus = 'ACTIVE' | 'INACTIVE';
export type BetType = 'SINGLE' | 'MULTIPLE';
export type BetStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED' | 'CANCELLED' | 'SETTLED' | 'VOID';
/** How a selection (and a SINGLE bet) settled. */
export type SelectionResult = 'WIN' | 'LOSS' | 'VOID' | 'PUSH';

/**
 * Authoritative server-side routing mode for an event.
 * NATIVE events use the TanvionRoyale local betting engine; PARTNER events are
 * handled by an external licensed gambling partner (deep-linked server-side).
 */
export type BettingMode = 'NATIVE' | 'PARTNER';

/** Public competition/league/tournament (e.g. IPL, Premier League). */
export interface PublicCompetition {
  id: string;
  sportId: string;
  name: string;
  slug: string;
  country: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  sortOrder: number;
}

/** Public partner provider summary — name only, never secrets or URLs. */
export interface PublicPartnerProvider {
  id: string;
  name: string;
  available: boolean;
}

/** Public event — never exposes provider identifiers/secrets. */
export interface PublicEvent {
  id: string;
  gameId: string;
  name: string;
  startTime: string;
  status: EventStatus;
  createdAt: string;
  /** Competition/league/tournament this event belongs to (e.g. IPL). */
  competition: PublicCompetition | null;
  /**
   * Sport summary (derived from the event's competition). Present whenever the
   * event is attached to a competition — this is the hub-level navigation info
   * the sports pages use to group/filter events by sport.
   */
  sport: { id: string; name: string; slug: string } | null;
  /** Team names (denormalized from the provider feed for display). */
  homeName: string | null;
  awayName: string | null;
  /** Provider-supplied live flag (authoritative from the backend/provider). */
  live: boolean;
  /** Authoritative routing: NATIVE (TanvionRoyale bet slip) or PARTNER (redirect). */
  bettingMode: BettingMode;
  /** Present only when bettingMode = PARTNER and the partner is active. */
  partner: PublicPartnerProvider | null;
}

/** Public market within an event. */
export interface PublicMarket {
  id: string;
  eventId: string;
  name: string;
  status: MarketStatus;
}

/** Public selection with its current odds. */
export interface PublicSelection {
  id: string;
  marketId: string;
  name: string;
  status: SelectionStatus;
  /** Current odds price (decimal string) and version, when the selection is active. */
  odds: {
    price: string;
    oddsVersion: number;
    updatedAt: string;
  } | null;
}

/** Event detail with its markets and (nested) selections + odds. */
export interface PublicEventDetail extends PublicEvent {
  markets: Array<PublicMarket & { selections: PublicSelection[] }>;
}

/** One selection's odds snapshot frozen into a placed bet. */
export interface BetSelectionView {
  id: string;
  selectionId: string;
  eventName: string;
  marketName: string;
  selectionName: string;
  priceAtPlacement: string;
  oddsVersion: number;
  /** Settlement outcome for this snapshot (null until settled). */
  result: SelectionResult | null;
  settledAt: string | null;
}

/** A bet as returned to its owner. */
export interface BetView {
  id: string;
  userId: string;
  type: BetType;
  status: BetStatus;
  stake: number; // minor units
  potentialPayout: number; // minor units
  currency: string; // ISO 4217
  providerReference: string | null;
  createdAt: string;
  updatedAt: string;
  selections: BetSelectionView[];
  /** Settlement outcome once SETTLED; null until then. */
  result: SelectionResult | null;
  settledAt: string | null;
  /** Payout/refund credited (minor units); null until settled. */
  payout: number | null;
}

/** Result of POST /bets. `duplicate` is true when the idempotency key was reused. */
export interface PlaceBetResponse {
  bet: BetView;
  duplicate: boolean;
}

/** Result of settling a bet (SINGLE only in this phase). */
export interface SettleBetResponse {
  betId: string;
  status: 'SETTLED';
  result: Exclude<SelectionResult, 'PUSH'>; // WIN | LOSS | VOID
  payout: number; // minor units actually credited (0 for LOSS)
  alreadySettled: boolean;
}

/** Filter options for GET /bets. */
export type BetStatusFilter = 'ALL' | BetStatus;

/** Structured betting error codes surfaced to clients. */
export type BettingErrorCode =
  | 'INVALID_STAKE'
  | 'EVENT_UNAVAILABLE'
  | 'MARKET_SUSPENDED'
  | 'SELECTION_UNAVAILABLE'
  | 'ODDS_CHANGED'
  | 'GAMBLING_DISABLED'
  | 'PROVIDER_UNAVAILABLE'
  | 'BET_REJECTED'
  | 'INSUFFICIENT_BALANCE'
  | 'DUPLICATE_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR'
  | 'UNSETTLEABLE_EVENT'
  | 'INVALID_BET_STATE';