/**
 * TANVION ROYALE — Free Public Binance Live Market Feed
 * Direct connection to Binance REST endpoints (No API key needed).
 * Real-time 24hr tickers, historical klines (candlesticks), order book depth, and recent trades.
 */

import type { TradingCandle, TradingOrderBook, TradingMarketTrade } from '@/lib/api/trading';

const BINANCE_API_BASE = 'https://api.binance.com/api/v3';

// Map Tanvion Royale symbols to Binance trading pairs
export const SYMBOL_MAP_TO_BINANCE: Record<string, string> = {
  // Majors
  BTC: 'BTCUSDT',
  BTCUSD: 'BTCUSDT',
  BTCUSDT: 'BTCUSDT',
  ETH: 'ETHUSDT',
  ETHUSD: 'ETHUSDT',
  ETHUSDT: 'ETHUSDT',
  BNB: 'BNBUSDT',
  BNBUSD: 'BNBUSDT',
  BNBUSDT: 'BNBUSDT',
  SOL: 'SOLUSDT',
  SOLUSD: 'SOLUSDT',
  SOLUSDT: 'SOLUSDT',
  XRP: 'XRPUSDT',
  XRPUSD: 'XRPUSDT',
  XRPUSDT: 'XRPUSDT',
  DOGE: 'DOGEUSDT',
  DOGEUSD: 'DOGEUSDT',
  DOGEUSDT: 'DOGEUSDT',
  ADA: 'ADAUSDT',
  ADAUSD: 'ADAUSDT',
  ADAUSDT: 'ADAUSDT',
  AVAX: 'AVAXUSDT',
  AVAXUSD: 'AVAXUSDT',
  AVAXUSDT: 'AVAXUSDT',
  LINK: 'LINKUSDT',
  LINKUSD: 'LINKUSDT',
  LINKUSDT: 'LINKUSDT',
  SUI: 'SUIUSDT',
  SUIUSD: 'SUIUSDT',
  SUIUSDT: 'SUIUSDT',
  PEPE: 'PEPEUSDT',
  PEPEUSD: 'PEPEUSDT',
  PEPEUSDT: 'PEPEUSDT',
  NEAR: 'NEARUSDT',
  NEARUSD: 'NEARUSDT',
  NEARUSDT: 'NEARUSDT',
  APT: 'APTUSDT',
  APTUSD: 'APTUSDT',
  APTUSDT: 'APTUSDT',
  // Layer 1 / Layer 2 / DeFi
  DOT: 'DOTUSDT',
  DOTUSD: 'DOTUSDT',
  DOTUSDT: 'DOTUSDT',
  MATIC: 'MATICUSDT',
  MATICUSD: 'MATICUSDT',
  POL: 'POLUSDT',
  POLUSD: 'POLUSDT',
  SHIB: 'SHIBUSDT',
  SHIBUSD: 'SHIBUSDT',
  TRX: 'TRXUSDT',
  TRXUSD: 'TRXUSDT',
  TON: 'TONUSDT',
  TONUSD: 'TONUSDT',
  LTC: 'LTCUSDT',
  LTCUSD: 'LTCUSDT',
  BCH: 'BCHUSDT',
  BCHUSD: 'BCHUSDT',
  UNI: 'UNIUSDT',
  UNIUSD: 'UNIUSDT',
  ATOM: 'ATOMUSDT',
  ATOMUSD: 'ATOMUSD',
  XLM: 'XLMUSDT',
  XLMUSD: 'XLMUSDT',
  ETC: 'ETCUSDT',
  ETCUSD: 'ETCUSDT',
  FIL: 'FILUSDT',
  FILUSD: 'FILUSDT',
  HBAR: 'HBARUSDT',
  HBARUSD: 'HBARUSDT',
  ICP: 'ICPUSDT',
  ICPUSD: 'ICPUSDT',
  INJ: 'INJUSDT',
  INJUSD: 'INJUSDT',
  TIA: 'TIAUSDT',
  TIAUSD: 'TIAUSDT',
  RENDER: 'RENDERUSDT',
  RENDERUSD: 'RENDERUSDT',
  RNDR: 'RENDERUSDT',
  FET: 'FETUSDT',
  FETUSD: 'FETUSDT',
  TAO: 'TAOUSDT',
  TAOUSD: 'TAOUSD',
  SEI: 'SEIUSDT',
  SEIUSD: 'SEIUSDT',
  ARB: 'ARBUSDT',
  ARBUSD: 'ARBUSD',
  OP: 'OPUSDT',
  OPUSD: 'OPUSDT',
  WLD: 'WLDUSDT',
  WLDUSD: 'WLDUSDT',
  AAVE: 'AAVEUSDT',
  AAVEUSD: 'AAVEUSDT',
  MKR: 'MKRUSDT',
  MKRUSD: 'MKRUSDT',
  CRV: 'CRVUSDT',
  CRVUSD: 'CRVUSDT',
  LDO: 'LDOUSDT',
  LDOUSD: 'LDOUSDT',
  PENDLE: 'PENDLEUSDT',
  PENDLEUSD: 'PENDLEUSDT',
  ENA: 'ENAUSDT',
  ENAUSD: 'ENAUSDT',
  ONDO: 'ONDOUSDT',
  ONDOUSD: 'ONDOUSDT',
  FTM: 'FTMUSDT',
  FTMUSD: 'FTMUSD',
  ALGO: 'ALGOUSDT',
  ALGOUSD: 'ALGOUSDT',
  GALA: 'GALAUSDT',
  GALAUSD: 'GALAUSDT',
  SAND: 'SANDUSDT',
  SANDUSD: 'SANDUSDT',
  MANA: 'MANAUSDT',
  MANAUSD: 'MANAUSD',
  AXS: 'AXSUSDT',
  AXSUSD: 'AXSUSD',
  IMX: 'IMXUSDT',
  IMXUSD: 'IMXUSD',
  RUNE: 'RUNEUSDT',
  RUNEUSD: 'RUNEUSD',
  XMR: 'XMRUSDT',
  XMRUSD: 'XMRUSDT',
  FLOKI: 'FLOKIUSDT',
  FLOKIUSD: 'FLOKIUSD',
  BONK: 'BONKUSDT',
  BONKUSD: 'BONKUSDT',
  WIF: 'WIFUSDT',
  WIFUSD: 'WIFUSDT',
  NOT: 'NOTUSDT',
  NOTUSD: 'NOTUSDT',
  STX: 'STXUSDT',
  STXUSD: 'STXUSDT',
  KAS: 'KASUSDT',
  KASUSD: 'KASUSDT',
  NEIRO: 'NEIROUSDT',
  NEIROUSD: 'NEIROUSDT',
  TURBO: 'TURBOUSDT',
  TURBOUSD: 'TURBOUSDT',
  // Commodities mapped to 1:1 backed Binance pairs
  // PAXG = Paxos Gold (1 PAXG = 1 troy ounce of physical London Good Delivery gold)
  XAUUSD: 'PAXGUSDT',
  XAU: 'PAXGUSDT',
  GOLD: 'PAXGUSDT',
  PAXG: 'PAXGUSDT',
  PAXGUSD: 'PAXGUSDT',
  PAXGUSDT: 'PAXGUSDT',
};

// Stock symbols that must NOT be sent to Binance — they cause 400 Bad Request
const STOCK_SYMBOLS = new Set([
  'AAPL', 'TSLA', 'NVDA', 'MSFT', 'AMZN', 'GOOGL', 'GOOG', 'META', 'NFLX',
  'AMD', 'INTC', 'ORCL', 'CRM', 'BABA', 'JNJ', 'JPM', 'BAC', 'GS', 'WMT',
  'DIS', 'V', 'MA', 'PFE', 'KO', 'PEP', 'NKE', 'BA', 'GE', 'XOM',
  'CVX', 'T', 'VZ', 'MCD', 'SBUX', 'PYPL', 'SHOP', 'COIN', 'HOOD',
  'UBER', 'LYFT', 'SNAP', 'TWTR', 'SPOT', 'RBLX', 'GME', 'AMC',
  // Forex pairs and commodities that might leak in
  'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD',
  'EURGBP', 'EURJPY', 'GBPJPY', 'AUDCAD', 'AUDCHF', 'AUDJPY', 'AUDNZD',
  'CADJPY', 'CHFJPY', 'EURCHF', 'EURAUD', 'EURCAD', 'EURNZD',
  'GBPAUD', 'GBPCAD', 'GBPCHF', 'GBPNZD', 'NZDCAD', 'NZDCHF', 'NZDJPY',
  'USDMXN', 'USDZAR', 'USDHKD', 'USDSGD', 'USDSEK', 'USDNOK', 'USDDKK',
  'USDTRY', 'USDPLN', 'USDHUF', 'USDCZK',
  // Commodities / metals (XAUUSD handled via PAXG above)
  'XAGUSD', 'XPTUSD', 'XPDUSD', 'USOIL', 'UKOIL', 'NGAS',
  'COFFEE', 'COCOA', 'WHEAT', 'CORN', 'SUGAR', 'COTTON',
]);

export function getBinanceSymbol(symbol: string): string | null {
  if (!symbol) return null;
  const clean = symbol.toUpperCase().replace('/', '').trim();
  // Explicit map takes priority
  if (SYMBOL_MAP_TO_BINANCE[clean]) return SYMBOL_MAP_TO_BINANCE[clean];
  // Block stock / forex / commodity symbols — they cause Binance 400
  if (STOCK_SYMBOLS.has(clean)) return null;
  if (clean.endsWith('USDT') || clean.endsWith('BUSD')) return clean;
  if (clean.endsWith('USD')) return `${clean.slice(0, -3)}USDT`;
  // Only fall through for short alpha-numeric codes NOT in the block list
  if (/^[A-Z0-9]{2,10}$/.test(clean)) return `${clean}USDT`;
  return null;
}

export interface BinanceTicker24h {
  symbol: string;
  lastPrice: number;
  bidPrice: number;
  askPrice: number;
  priceChange: number;
  priceChangePercent: number;
  highPrice: number;
  lowPrice: number;
  volume: number;
  quoteVolume: number;
  openTime: number;
  closeTime: number;
}

/**
 * Fetch 24hr ticker from Binance
 */
export async function fetchBinanceTicker(symbol: string): Promise<BinanceTicker24h | null> {
  const bSymbol = getBinanceSymbol(symbol);
  if (!bSymbol) return null;

  try {
    const res = await fetch(`${BINANCE_API_BASE}/ticker/24hr?symbol=${bSymbol}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      symbol: data.symbol,
      lastPrice: parseFloat(data.lastPrice) || 0,
      bidPrice: parseFloat(data.bidPrice) || parseFloat(data.lastPrice) || 0,
      askPrice: parseFloat(data.askPrice) || parseFloat(data.lastPrice) || 0,
      priceChange: parseFloat(data.priceChange) || 0,
      priceChangePercent: parseFloat(data.priceChangePercent) || 0,
      highPrice: parseFloat(data.highPrice) || 0,
      lowPrice: parseFloat(data.lowPrice) || 0,
      volume: parseFloat(data.volume) || 0,
      quoteVolume: parseFloat(data.quoteVolume) || 0,
      openTime: data.openTime,
      closeTime: data.closeTime,
    };
  } catch {
    return null;
  }
}

/**
 * Supported timeframe mapping from Exness/TradingView style to Binance intervals.
 * Binance supports: 1s, 1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M
 * Sub-minute timeframes (5s, 15s, 30s) and non-standard intervals (2m, 10m, 20m, 45m, 3h, 1W)
 * are fetched from the nearest smaller Binance interval and aggregated client-side.
 */
export function mapTimeframeToBinance(tf: string): string {
  switch (tf.toLowerCase()) {
    case '1s':
      return '1s'; // Binance supports 1s (may require futures account for some pairs, falls back to 1m)
    case '5s':
    case '15s':
    case '30s':
      return '1m'; // Aggregate from 1m candles client-side
    case '1m':
      return '1m';
    case '2m':
      return '1m'; // Aggregate 2×1m
    case '3m':
      return '3m';
    case '5m':
      return '5m';
    case '10m':
      return '5m'; // Aggregate 2×5m
    case '15m':
      return '15m';
    case '20m':
      return '5m'; // Aggregate 4×5m
    case '30m':
      return '30m';
    case '45m':
      return '15m'; // Aggregate 3×15m
    case '1h':
      return '1h';
    case '2h':
      return '2h';
    case '3h':
      return '1h'; // Aggregate 3×1h
    case '4h':
      return '4h';
    case '6h':
      return '6h';
    case '8h':
      return '8h';
    case '12h':
      return '12h';
    case '1d':
    case '1day':
      return '1d';
    case '1w':
    case '1week':
      return '1w';
    case '1m_month':
    case '1mo':
      return '1M';
    default:
      return '1m';
  }
}

/**
 * Fetch real historical candlesticks from Binance
 * @param symbol - instrument symbol (e.g. 'BTCUSD', 'ETHUSDT')
 * @param timeframe - chart timeframe (e.g. '1m', '5m', '1h', '1d')
 * @param limit - number of candles to fetch (max 1000)
 * @param endTimeMs - optional end time in milliseconds (for historical pagination)
 */
export async function fetchBinanceKlines(
  symbol: string,
  timeframe = '1m',
  limit = 100,
  endTimeMs?: number,
): Promise<TradingCandle[] | null> {
  const bSymbol = getBinanceSymbol(symbol);
  if (!bSymbol) return null;

  const interval = mapTimeframeToBinance(timeframe);

  try {
    let url = `${BINANCE_API_BASE}/klines?symbol=${bSymbol}&interval=${interval}&limit=${limit}`;
    if (endTimeMs && endTimeMs > 0) {
      url += `&endTime=${endTimeMs}`;
    }
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const rawList: any[][] = await res.json();

    return rawList.map((row) => ({
      time: Math.floor(row[0] / 1000), // convert ms to seconds timestamp
      open: parseFloat(row[1]) || 0,
      high: parseFloat(row[2]) || 0,
      low: parseFloat(row[3]) || 0,
      close: parseFloat(row[4]) || 0,
      volume: parseFloat(row[5]) || 0,
    }));
  } catch {
    return null;
  }
}

/**
 * Fetch real Order Book depth from Binance
 */
export async function fetchBinanceDepth(
  symbol: string,
  limit = 20,
): Promise<TradingOrderBook | null> {
  const bSymbol = getBinanceSymbol(symbol);
  if (!bSymbol) return null;

  try {
    const res = await fetch(`${BINANCE_API_BASE}/depth?symbol=${bSymbol}&limit=${limit}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();

    let bidTotal = 0;
    const bids = (data.bids || []).map((row: [string, string]) => {
      const price = Math.round(parseFloat(row[0]) * 100);
      const size = parseFloat(row[1]);
      bidTotal += size;
      return { price, size: +size.toFixed(4), total: +bidTotal.toFixed(4) };
    });

    let askTotal = 0;
    const asks = (data.asks || []).map((row: [string, string]) => {
      const price = Math.round(parseFloat(row[0]) * 100);
      const size = parseFloat(row[1]);
      askTotal += size;
      return { price, size: +size.toFixed(4), total: +askTotal.toFixed(4) };
    });

    return {
      symbol,
      bids,
      asks,
      spread: asks[0] && bids[0] ? asks[0].price - bids[0].price : 10,
      lastPrice: bids[0] ? bids[0].price : 0,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch real recent trades from Binance
 */
export async function fetchBinanceTrades(
  symbol: string,
  limit = 25,
): Promise<TradingMarketTrade[] | null> {
  const bSymbol = getBinanceSymbol(symbol);
  if (!bSymbol) return null;

  try {
    const res = await fetch(`${BINANCE_API_BASE}/trades?symbol=${bSymbol}&limit=${limit}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const data = await res.json();

    return (data || []).map((t: any) => ({
      id: String(t.id),
      price: Math.round(parseFloat(t.price) * 100),
      size: +parseFloat(t.qty).toFixed(4),
      side: t.isBuyerMaker ? 'SELL' : 'BUY',
      time: new Date(t.time).toISOString(),
    }));
  } catch {
    return null;
  }
}
