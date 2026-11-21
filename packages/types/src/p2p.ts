// ---------------------------------------------------------------------------
// P2P Crypto Marketplace + Royale Pay (Buy Crypto)
// Money amounts are integer MINOR UNITS. Crypto amounts use the asset's
// decimal scale (default 8) and are stored as integer base units.
// ---------------------------------------------------------------------------

import type { MinorUnit } from './money';

export type P2PVerificationStatus = 'UNVERIFIED' | 'VERIFIED' | 'SUSPENDED';
export type P2POrderSide = 'BUY' | 'SELL';
export type P2POrderStatus =
  | 'CREATED'
  | 'PAYMENT_PENDING'
  | 'PAYMENT_SUBMITTED'
  | 'PAYMENT_VERIFICATION_PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'DISPUTED'
  | 'REFUNDED'
  | 'FAILED';
export type P2PPaymentStatus =
  | 'PENDING'
  | 'SUBMITTED'
  | 'VERIFIED'
  | 'REJECTED'
  | 'FAILED'
  | 'REFUNDED';
export type P2PDisputeStatus = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'CLOSED';
export type P2PDisputeResolution = 'BUYER_WINS' | 'SELLER_WINS' | 'SPLIT';

export const P2P_SUPPORTED_SYMBOLS = ['USDT', 'BTC', 'ETH', 'BNB'] as const;
export type P2PSymbol = (typeof P2P_SUPPORTED_SYMBOLS)[number];

export const P2P_SUPPORTED_FIAT = ['BDT', 'USD', 'EUR'] as const;
export type P2PFiat = (typeof P2P_SUPPORTED_FIAT)[number];

export const P2P_PAYMENT_METHODS = [
  'bkash',
  'nagad',
  'rocket',
  'upay',
  'bank',
  'royale-pay',
] as const;
export type P2PPaymentMethodCode = (typeof P2P_PAYMENT_METHODS)[number];
/** Whether a payment method is activatable for real-money P2P settlement.
 *  Only methods whose provider integration, credentials, authorization and
 *  verification are configured may be activated. Royale Pay (internal wallet)
 *  is the only method activatable without an external provider.
 */
export type P2PMethodActivation = 'ACTIVE' | 'CONFIGURED' | 'PENDING_APPROVAL';

export interface P2PPaymentMethodView {
  code: P2PPaymentMethodCode;
  label: string;
  /** Human-friendly display name (e.g. "bKash", "Royale Pay Balance"). */
  name: string;
  activation: P2PMethodActivation;
  /** Why the method is not active (only when activation !== 'ACTIVE'). */
  note?: string;
  minAmount?: MinorUnit;   // fiat minor units
  maxAmount?: MinorUnit;   // fiat minor units
}

/** A verified merchant in the P2P marketplace. */
export interface P2PMerchantProfileView {
  id: string;
  userId: string;
  displayName: string;
  verificationStatus: P2PVerificationStatus;
  totalOrders: number;
  completedOrders: number;
  cancelledOrders: number;
  completionRate: number; // 0-100
  positiveFeedback: number; // 0-100
  avgCompletionMin: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
/** A live merchant offer to buy/sell crypto against fiat. */
export interface P2POfferView {
  id: string;
  merchantId: string;
  merchant: P2PMerchantProfileView;
  symbol: P2PSymbol;
  fiat: P2PFiat;
  side: P2POrderSide;
  /** Fiat minor units per 1 crypto base unit. */
  pricePerFiatUnit: MinorUnit;
  cryptoScale: number;
  /** Crypto base units available. */
  availableCrypto: number;
  /** Fiat minor units. */
  minOrderFiat: MinorUnit;
  maxOrderFiat: MinorUnit;
  paymentMethods: P2PPaymentMethodCode[];
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A P2P order through its full lifecycle. */
export interface P2POrderView {
  id: string;
  orderReference: string;
  buyerId: string;
  sellerId: string;
  offerId: string;
  symbol: P2PSymbol;
  fiat: P2PFiat;
  side: P2POrderSide;
  /** Locked at creation. Fiat minor units per 1 crypto base unit. */
  pricePerFiatUnit: MinorUnit;
  cryptoAmount: number;
  fiatAmount: MinorUnit;
  feeAmount: MinorUnit;
  status: P2POrderStatus;
  paymentMethod: P2PPaymentMethodCode | null;
  paymentReference: string | null;
  paymentProofUrl: string | null;
  expiresAt: string;
  paidAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  createdAt: string;
  updatedAt: string;
}
/** Payment evidence / record for a P2P order. */
export interface P2PPaymentView {
  id: string;
  orderId: string;
  payerId: string;
  payeeId: string;
  method: P2PPaymentMethodCode;
  amount: MinorUnit;
  currency: string;
  reference: string | null;
  proofUrl: string | null;
  status: P2PPaymentStatus;
  verifiedBy: string | null;
  verifiedAt: string | null;
  verificationNote: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Dispute raised on a P2P order. */
export interface P2PDisputeView {
  id: string;
  orderId: string;
  openedBy: string;
  reason: string;
  status: P2PDisputeStatus;
  resolution: P2PDisputeResolution | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Filters for listing marketplace offers. */
export interface P2PFilterInput {
  symbol?: P2PSymbol;
  fiat?: P2PFiat;
  side?: P2POrderSide;
  paymentMethod?: P2PPaymentMethodCode;
  minAmount?: MinorUnit;   // fiat minor units
  maxAmount?: MinorUnit;   // fiat minor units
  sortBy?: 'price' | 'available' | 'relevance';
  page?: number;
  limit?: number;
}

export interface P2POffersView {
  items: P2POfferView[];
  total: number;
  page: number;
  limit: number;
}

/** Estimate returned before an order is created (no money moves). */
export interface P2PQuoteView {
  symbol: P2PSymbol;
  fiat: P2PFiat;
  side: P2POrderSide;
  fiatAmount: MinorUnit;      // fiat minor units
  cryptoAmount: number;       // crypto base units
  pricePerFiatUnit: MinorUnit;
  feeAmount: MinorUnit;       // fiat minor units
  totalFiat: MinorUnit;       // fiatAmount + fee (what buyer pays)
  dataSource: 'LIVE' | 'DEMO';
  asOf: string;
}

/** Public order summary safe to show to both parties. */
export interface P2POrderSummaryView {
  order: P2POrderView;
  payment: P2PPaymentView | null;
  dispute: P2PDisputeView | null;
}

/** Royale Pay balance view (reuses the existing wallet ledger). */
export interface RoyalePayBalanceView {
  availableBalance: MinorUnit; // BDT minor units
  lockedBalance: MinorUnit;
  currency: 'BDT';
  mode: 'DEMO' | 'LIVE';
}