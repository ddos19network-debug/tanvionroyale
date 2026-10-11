// ---------------------------------------------------------------------------
// Paper (virtual) trading domain.
//
// NOT real-money brokerage. The paper account is separate from the Wallet;
// balances and prices are integer minor units (2 dp). Prices are DEMO until a
// real market-data feed is configured and are always labelled as such.
// ---------------------------------------------------------------------------

export type TradingMarketDataSource = 'LIVE' | 'DELAYED' | 'DEMO';
export type TradingOrderSide = 'BUY' | 'SELL';

export interface TradingAccountView {
  id: string;
  currency: string;
  virtualBalance: number;
  startingBalance: number;
  createdAt: string;
}

export interface TradingInstrumentView {
  id: string;
  symbol: string;
  name: string;
  type: 'STOCK' | 'CRYPTO' | 'FOREX' | 'COMMODITY';
  basePrice: number;
  isEnabled: boolean;
  dataSource: TradingMarketDataSource;
  currentPrice: number;
  priceAsOf: string | null;
  priceLabel: string;
}

export interface TradingInstrumentDetailView extends TradingInstrumentView {
  history: { t: string; price: number }[];
}

export interface TradingPositionView {
  id: string;
  instrumentId: string;
  symbol: string;
  name: string;
  side: TradingOrderSide;
  quantity: number;
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  status: 'OPEN' | 'CLOSED';
  realizedPnl: number;
  closedAt: string | null;
  createdAt: string;
}

export interface TradingOrderView {
  id: string;
  instrumentId: string;
  symbol: string;
  name: string;
  side: TradingOrderSide;
  status: 'FILLED' | 'REJECTED' | 'CANCELLED';
  quantity: number;
  priceFilled: number | null;
  notional: number;
  failureReason: string | null;
  createdAt: string;
}

export interface TradingTransactionView {
  id: string;
  type: string;
  amount: number;
  reason: string;
  createdAt: string;
}

export interface TradingPortfolioView {
  account: TradingAccountView;
  marketStatus: { open: boolean; label: string; dataSource: TradingMarketDataSource };
  realizedPnl: number;
  unrealizedPnl: number;
  equity: number;
  positions: TradingPositionView[];
}

export interface TradingOrderResult {
  order: TradingOrderView;
  account: TradingAccountView;
  closedPosition: TradingPositionView | null;
  openedPosition: TradingPositionView | null;
}

export interface TradingLeaderboardEntry {
  username: string;
  equity: number;
  realizedPnl: number;
}