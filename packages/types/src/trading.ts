// ---------------------------------------------------------------------------
// Paper (virtual) trading domain.
//
// Realistic multi-asset trading platform (Crypto, Forex, Commodities, Stocks).
// Virtual demo balance with real platform UX (Candlestick charts, Order Book,
// Market Trades, Market/Limit/Stop orders, Positions, P&L calculations).
// ---------------------------------------------------------------------------

export type TradingMarketDataSource = 'LIVE' | 'DELAYED' | 'DEMO';
export type TradingOrderSide = 'BUY' | 'SELL';
export type TradingOrderType = 'MARKET' | 'LIMIT' | 'STOP_LIMIT';

export interface TradingAccountView {
  id: string;
  currency: string;
  virtualBalance: number; // minor units (e.g. cents)
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
  change24h?: number; // basis points, e.g. +345 = +3.45%
  high24h?: number; // minor units
  low24h?: number; // minor units
  volume24h?: number; // units or USD minor
}

export interface TradingCandle {
  time: number; // Unix timestamp in seconds
  open: number; // minor units
  high: number; // minor units
  low: number; // minor units
  close: number; // minor units
  volume: number; // volume units
}

export interface TradingInstrumentDetailView extends TradingInstrumentView {
  history: { t: string; price: number }[];
  candles?: TradingCandle[];
}

export interface OrderBookLevel {
  price: number; // minor units
  size: number;
  total: number;
}

export interface TradingOrderBook {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  spread: number; // minor units
  lastPrice: number; // minor units
}

export interface TradingMarketTrade {
  id: string;
  price: number; // minor units
  size: number;
  side: TradingOrderSide;
  time: string;
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
  unrealizedPnl: number; // minor units
  status: 'OPEN' | 'CLOSED';
  realizedPnl: number;
  closedAt: string | null;
  createdAt: string;
  leverage?: number;
  liquidationPrice?: number;
}

export interface TradingOrderView {
  id: string;
  instrumentId: string;
  symbol: string;
  name: string;
  side: TradingOrderSide;
  type?: TradingOrderType;
  status: 'NEW' | 'SUBMITTING' | 'ACKNOWLEDGED' | 'FILLED' | 'REJECTED' | 'CANCELLED';
  quantity: number;
  priceFilled: number | null;
  limitPrice?: number | null;
  stopPrice?: number | null;
  notional: number;
  failureReason: string | null;
  createdAt: string;
  leverage?: number;
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
  openOrdersCount?: number;
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
  winRate?: number;
  totalTrades?: number;
}
