/**
 * TANVION ROYALE — Binance WebSocket Ticker Client
 * Real-time price feed using Binance public WebSocket streams (no API key needed).
 *
 * Streams used:
 *   wss://stream.binance.com/ws/<symbol>@ticker   — 24hr rolling ticker
 *   wss://stream.binance.com/ws/<symbol>@kline_<interval> — real-time candle
 *
 * Auto-reconnects with exponential backoff (max 30s) when connection drops.
 * Handles React StrictMode / Fast Refresh unmount safely without console warnings.
 */

import type { TradingCandle } from '@/lib/api/trading';

// Use standard port 443 (supported by Binance, never blocked by firewalls)
const BINANCE_WS_BASE = 'wss://stream.binance.com/ws';

export type WsConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error' | 'unsupported';

export interface BinanceTickerUpdate {
  price: number;   // last price
  bid: number;     // best bid
  ask: number;     // best ask
  high: number;    // 24h high
  low: number;     // 24h low
  volume: number;  // 24h base volume
  change: number;  // price change %
}

/**
 * Safely closes a WebSocket without triggering browser console warnings
 * if the socket is still in CONNECTING state during Fast Refresh or unmount.
 */
function safeCloseWs(ws: WebSocket | null) {
  if (!ws) return;
  // Detach handlers first to prevent stray callbacks
  ws.onmessage = null;
  ws.onerror = null;
  ws.onclose = null;

  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.close(1000, 'Normal Closure');
    } catch {}
  } else if (ws.readyState === WebSocket.CONNECTING) {
    // If still in handshake, defer close until opened to prevent "WebSocket is closed before connection established"
    ws.onopen = () => {
      try {
        ws.close(1000, 'Normal Closure');
      } catch {}
    };
  }
}

/**
 * Subscribe to real-time 24hr ticker updates for a Binance symbol.
 *
 * @param binanceSymbol - e.g. 'btcusdt' (lowercase)
 * @param onTick - called on every price update
 * @param onStatus - called on connection state changes
 * @returns cleanup function (call to close the WebSocket)
 */
export function subscribeBinanceTicker(
  binanceSymbol: string,
  onTick: (update: BinanceTickerUpdate) => void,
  onStatus?: (status: WsConnectionStatus) => void,
): () => void {
  if (typeof WebSocket === 'undefined') {
    onStatus?.('unsupported');
    return () => {};
  }

  const sym = binanceSymbol.toLowerCase();
  let ws: WebSocket | null = null;
  let closed = false;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = 1000;
  let retryCount = 0;
  const MAX_RETRIES = 5;

  function connect() {
    if (closed) return;
    onStatus?.('connecting');

    try {
      ws = new WebSocket(`${BINANCE_WS_BASE}/${sym}@ticker`);
    } catch {
      onStatus?.('error');
      return;
    }

    ws.onopen = () => {
      if (closed) {
        safeCloseWs(ws);
        return;
      }
      backoffMs = 1000; // reset on success
      retryCount = 0;
      onStatus?.('connected');
    };

    ws.onmessage = (e: MessageEvent) => {
      if (closed) return;
      try {
        const d = JSON.parse(e.data as string);
        onTick({
          price: parseFloat(d.c) || 0,   // last price
          bid: parseFloat(d.b) || 0,     // best bid
          ask: parseFloat(d.a) || 0,     // best ask
          high: parseFloat(d.h) || 0,    // 24h high
          low: parseFloat(d.l) || 0,     // 24h low
          volume: parseFloat(d.v) || 0,  // base asset volume
          change: parseFloat(d.P) || 0,  // price change %
        });
      } catch {
        // malformed message — ignore
      }
    };

    ws.onerror = () => {
      if (!closed) {
        onStatus?.('error');
      }
    };

    ws.onclose = () => {
      if (!closed) {
        onStatus?.('disconnected');
        retryCount++;
        if (retryCount <= MAX_RETRIES) {
          reconnectTimeout = setTimeout(() => {
            backoffMs = Math.min(backoffMs * 2, 20_000);
            connect();
          }, backoffMs);
        }
      }
    };
  }

  connect();

  return () => {
    closed = true;
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    safeCloseWs(ws);
    ws = null;
  };
}

/**
 * Subscribe to real-time candlestick (kline) updates for a Binance symbol.
 *
 * @param binanceSymbol - e.g. 'btcusdt' (lowercase)
 * @param interval - Binance interval string (e.g. '1m', '5m', '1h')
 * @param onCandle - called with the latest (possibly in-progress) candle
 * @param onStatus - called on connection state changes
 * @returns cleanup function
 */
export function subscribeBinanceKline(
  binanceSymbol: string,
  interval: string,
  onCandle: (candle: TradingCandle, isFinal: boolean) => void,
  onStatus?: (status: WsConnectionStatus) => void,
): () => void {
  if (typeof WebSocket === 'undefined') {
    onStatus?.('unsupported');
    return () => {};
  }

  const sym = binanceSymbol.toLowerCase();
  let ws: WebSocket | null = null;
  let closed = false;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = 1000;
  let retryCount = 0;
  const MAX_RETRIES = 5;

  function connect() {
    if (closed) return;
    onStatus?.('connecting');

    try {
      ws = new WebSocket(`${BINANCE_WS_BASE}/${sym}@kline_${interval}`);
    } catch {
      onStatus?.('error');
      return;
    }

    ws.onopen = () => {
      if (closed) {
        safeCloseWs(ws);
        return;
      }
      backoffMs = 1000;
      retryCount = 0;
      onStatus?.('connected');
    };

    ws.onmessage = (e: MessageEvent) => {
      if (closed) return;
      try {
        const msg = JSON.parse(e.data as string);
        const k = msg.k;
        if (!k) return;
        const candle: TradingCandle = {
          time: Math.floor(k.t / 1000),
          open: parseFloat(k.o) || 0,
          high: parseFloat(k.h) || 0,
          low: parseFloat(k.l) || 0,
          close: parseFloat(k.c) || 0,
          volume: parseFloat(k.v) || 0,
        };
        onCandle(candle, Boolean(k.x)); // k.x = true means candle is closed/final
      } catch {
        // ignore parse errors
      }
    };

    ws.onerror = () => {
      if (!closed) {
        onStatus?.('error');
      }
    };

    ws.onclose = () => {
      if (!closed) {
        onStatus?.('disconnected');
        retryCount++;
        if (retryCount <= MAX_RETRIES) {
          reconnectTimeout = setTimeout(() => {
            backoffMs = Math.min(backoffMs * 2, 20_000);
            connect();
          }, backoffMs);
        }
      }
    };
  }

  connect();

  return () => {
    closed = true;
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    safeCloseWs(ws);
    ws = null;
  };
}

/**
 * Combined ticker + kline subscription for the chart.
 * Returns a single cleanup function.
 */
export function subscribeChartData(
  binanceSymbol: string,
  interval: string,
  onTickerUpdate: (update: BinanceTickerUpdate) => void,
  onKlineUpdate: (candle: TradingCandle, isFinal: boolean) => void,
  onStatus?: (status: WsConnectionStatus) => void,
): () => void {
  const cleanupTicker = subscribeBinanceTicker(binanceSymbol, onTickerUpdate, onStatus);
  const cleanupKline = subscribeBinanceKline(binanceSymbol, interval, onKlineUpdate);
  return () => {
    cleanupTicker();
    cleanupKline();
  };
}
