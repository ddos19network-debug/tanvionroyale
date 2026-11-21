/**
 * Frontend P2P Crypto Marketplace & Royale Pay API client.
 * Connects to the NestJS P2PController at `/p2p/*`.
 */
import { apiFetch, authFetch } from './client';
import type {
  P2POffersView,
  P2POfferView,
  P2POrderView,
  P2PQuoteView,
  P2POrderSummaryView,
  RoyalePayBalanceView,
  P2PSymbol,
  P2PFiat,
  P2POrderSide,
  P2PPaymentMethodCode,
  P2POrderStatus,
} from '@tanvion-royale/types';

export interface ListP2POffersParams {
  symbol?: P2PSymbol;
  fiat?: P2PFiat;
  side?: P2POrderSide;
  paymentMethod?: P2PPaymentMethodCode;
  minAmount?: number;
  maxAmount?: number;
  sortBy?: 'price' | 'available' | 'relevance';
  page?: number;
  limit?: number;
}

export interface P2PQuoteParams {
  symbol: P2PSymbol;
  fiat: P2PFiat;
  side: P2POrderSide;
  fiatAmount: number;
}

export interface CreateP2POrderInput {
  symbol: P2PSymbol;
  fiat: P2PFiat;
  side: P2POrderSide;
  fiatAmount: number;
  cryptoAmount: number;
  pricePerFiatUnit: number;
  offerId: string;
  paymentMethod: P2PPaymentMethodCode;
  idempotencyKey: string;
}

export interface SubmitP2PPaymentInput {
  method: P2PPaymentMethodCode;
  reference?: string;
  proofUrl?: string;
}

export interface ListP2POrdersParams {
  status?: P2POrderStatus;
  page?: number;
  limit?: number;
}

/**
 * List active P2P marketplace offers (public endpoint).
 */
export async function listP2POffers(params?: ListP2POffersParams): Promise<P2POffersView> {
  const query = new URLSearchParams();
  if (params?.symbol) query.set('symbol', params.symbol);
  if (params?.fiat) query.set('fiat', params.fiat);
  if (params?.side) query.set('side', params.side);
  if (params?.paymentMethod) query.set('paymentMethod', params.paymentMethod);
  if (params?.minAmount !== undefined) query.set('minAmount', String(params.minAmount));
  if (params?.maxAmount !== undefined) query.set('maxAmount', String(params.maxAmount));
  if (params?.sortBy) query.set('sortBy', params.sortBy);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));

  const qs = query.toString();
  return apiFetch<P2POffersView>(`/p2p/offers${qs ? `?${qs}` : ''}`);
}

/**
 * Estimate crypto quantity for a fiat amount before creating an order (auth required).
 */
export async function getP2PQuote(params: P2PQuoteParams): Promise<P2PQuoteView> {
  const query = new URLSearchParams();
  query.set('symbol', params.symbol);
  query.set('fiat', params.fiat);
  query.set('side', params.side);
  query.set('fiatAmount', String(params.fiatAmount));

  return authFetch<P2PQuoteView>(`/p2p/quote?${query.toString()}`);
}

/**
 * Create a P2P order (reserves funds, auth required).
 */
export async function createP2POrder(input: CreateP2POrderInput): Promise<P2POrderView> {
  return authFetch<P2POrderView>('/p2p/orders', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Get P2P order details with payment and dispute status (auth required).
 */
export async function getP2POrder(id: string): Promise<P2POrderSummaryView> {
  return authFetch<P2POrderSummaryView>(`/p2p/orders/${encodeURIComponent(id)}`);
}

/**
 * Submit payment evidence for a P2P order (auth required).
 */
export async function submitP2PPayment(
  orderId: string,
  input: SubmitP2PPaymentInput,
): Promise<P2POrderSummaryView> {
  return authFetch<P2POrderSummaryView>(`/p2p/orders/${encodeURIComponent(orderId)}/payment`, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/**
 * Cancel a P2P order and release reserved funds (auth required).
 */
export async function cancelP2POrder(
  orderId: string,
  reason?: string,
): Promise<P2POrderView> {
  return authFetch<P2POrderView>(`/p2p/orders/${encodeURIComponent(orderId)}/cancel`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

/**
 * List the current user's P2P orders (auth required).
 */
export async function listMyP2POrders(
  params?: ListP2POrdersParams,
): Promise<{ items: P2POrderView[]; total: number; page: number; limit: number }> {
  const query = new URLSearchParams();
  if (params?.status) query.set('status', params.status);
  if (params?.page) query.set('page', String(params.page));
  if (params?.limit) query.set('limit', String(params.limit));

  const qs = query.toString();
  return authFetch<{ items: P2POrderView[]; total: number; page: number; limit: number }>(
    `/p2p/orders${qs ? `?${qs}` : ''}`,
  );
}

/**
 * Get Royale Pay (internal wallet) balance for P2P transactions.
 */
export async function getRoyalePayBalance(): Promise<RoyalePayBalanceView> {
  return authFetch<RoyalePayBalanceView>('/p2p/royale-pay/balance');
}
