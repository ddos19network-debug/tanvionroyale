/**
 * Frontend PAPER-TRADING API (virtual money only — never the real Wallet).
 * All calls go through the TANVIONROYALE backend via the shared client.
 */
import { authFetch } from './client';
import type {
  TradingAccountView,
  TradingInstrumentView,
  TradingInstrumentDetailView,
  TradingOrderView,
  TradingPositionView,
  TradingPortfolioView,
  TradingOrderResult,
  TradingTransactionView,
  TradingLeaderboardEntry,
  TradingOrderSide,
} from '@tanvion-royale/types';

export type {
  TradingAccountView,
  TradingInstrumentView,
  TradingInstrumentDetailView,
  TradingOrderView,
  TradingPositionView,
  TradingPortfolioView,
  TradingOrderResult,
  TradingTransactionView,
  TradingLeaderboardEntry,
  TradingOrderSide,
};

export async function getTradingAccount(): Promise<TradingAccountView> {
  return authFetch<TradingAccountView>('/trading/account');
}

export async function getTradingPortfolio(): Promise<TradingPortfolioView> {
  return authFetch<TradingPortfolioView>('/trading/account/portfolio');
}

export async function listTradingInstruments(): Promise<TradingInstrumentView[]> {
  return authFetch<TradingInstrumentView[]>('/trading/instruments');
}

export async function getTradingInstrument(id: string): Promise<TradingInstrumentDetailView> {
  return authFetch<TradingInstrumentDetailView>(
    `/trading/instruments/${encodeURIComponent(id)}`,
  );
}

export async function placeTradingOrder(
  instrumentId: string,
  side: TradingOrderSide,
  quantity: number,
): Promise<TradingOrderResult> {
  return authFetch<TradingOrderResult>('/trading/orders', {
    method: 'POST',
    body: JSON.stringify({ instrumentId, side, quantity }),
  });
}

export async function listTradingOrders(limit = 50): Promise<TradingOrderView[]> {
  return authFetch<TradingOrderView[]>(`/trading/orders?limit=${limit}`);
}

export async function listTradingPositions(): Promise<TradingPositionView[]> {
  return authFetch<TradingPositionView[]>('/trading/positions');
}

export async function closeTradingPosition(positionId: string): Promise<TradingOrderResult> {
  return authFetch<TradingOrderResult>(`/trading/positions/${encodeURIComponent(positionId)}/close`, {
    method: 'POST',
  });
}

export async function listTradingHistory(limit = 50): Promise<TradingTransactionView[]> {
  return authFetch<TradingTransactionView[]>(`/trading/history?limit=${limit}`);
}

export async function getTradingLeaderboard(limit = 10): Promise<TradingLeaderboardEntry[]> {
  return authFetch<TradingLeaderboardEntry[]>(`/trading/leaderboard?limit=${limit}`);
}

/** Format integer minor units as a currency string (2 dp). */
export function formatMinor(amount: number, currency = 'USD'): string {
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const body = (abs / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${sign}${currency === 'USD' ? '$' : `${currency} `}${body}`;
}