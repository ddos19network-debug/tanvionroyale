# TANVION ROYALE TRADING PLATFORM — COMPLETE SOURCE CODE AUDIT
**Date:** 2026-11-12
**System Scope:** Full-Stack Exness-Level Trading Terminal, Charting Engine, Financial Ledger, Risk Engine & Market Data Gateway

---

## 1. Executive Summary & Stack Verification

The codebase has been thoroughly audited across both `apps/web` (Next.js 14 App Router, React 18, TypeScript, Tailwind CSS) and `apps/api` (NestJS, Prisma ORM, PostgreSQL, Socket.IO). The existing trading architecture is functional and structured around real exchange principles, but contains specific gaps in timeframe aggregation, coordinate-based drawing persistence, multi-category settings, dockable workspace mechanics, and per-instrument contract specifications.

### Existing Tech Stack Verified:
- **Frontend Framework**: Next.js 14.2.14 / React 18.3.1 (`apps/web`)
- **Backend API**: NestJS 10.4.5 (`apps/api`)
- **Persistence**: Prisma 5.21.1 (`database/prisma/schema.prisma`)
- **Real-Time Data**: WebSocket gateways (`trading.gateway.ts`), Binance Public REST/WS API (`binance-live.ts`), Frankfurter ECB Forex Rates, Yahoo Finance
- **State & Storage**: React State, Context, LocalStorage (`tr_chart_settings_v2`, `tr_drawings_v2`, `tr_workspace_v2`)

---

## 2. Comprehensive File-by-File Audit

### A. Frontend Priority Files (`apps/web/components/trading/`)

#### 1. `apps/web/components/trading/trading-terminal.tsx` (94 KB)
- **1. Existing Functionality**:
  - Exness-styled 3-column workspace with top navigation, multi-chart tabs (`BTCUSD`, `XAUUSD`, `EURUSD`), account mode switcher (Standard Real vs Practice Demo).
  - Quick 1-click trading toggle, lot volume step selector, TP/SL toggle with price/pips/money units.
  - Multi-chart grid toggling (1, 2, or 4 independent chart terminals).
  - Left navigation rail with tabs: Instruments list, Economic calendar, Price alerts, Indie Pine Script editor, Chart settings.
  - Bottom dock with Open Positions, Pending Orders, Closed History, and Account Ledger summary.
  - Interactive splitters for Left Sidebar (180px–420px), Bottom Dock (90px–380px), and Right Order Panel (220px–440px).
- **2. Missing Functionality**:
  - Multi-watchlists (Custom, Favorites, Gainers, Losers, Volatile).
  - Audio notification trigger hooks for SL/TP hit, Stop Out, Order Rejection, and Connection Lost.
  - Searchable timezone presentation switcher (UTC, Local, Asia/Dhaka, Europe/London, America/New_York) tied to candle timestamps and economic events.
  - Fullscreen chart toggle shortcut (F11 / button).
- **3. Broken Functionality**:
  - Timeframe changes between non-standard intervals (e.g. 2m, 3m, 45m, 12h) did not aggregate lower-interval candles correctly when provider returned standard intervals.
  - Floating P&L was assuming 1 lot = 1 unit across all asset classes, causing severe margin and P&L distortion for Forex (where 1 lot = 100,000 units) and Gold (where 1 lot = 100 oz).
- **4. Incomplete Event Handlers**:
  - Account switcher dropdown closed abruptly without selecting custom demo balances.
  - Right-click context menu on chart was not wired to terminal quick actions.
- **5. Hardcoded or Simulated Market Data**:
  - Fallback synthetic candle generation was using fixed Gaussian step instead of instrument-specific volatility and time delta.
- **6. Features to Preserve**:
  - Full top navigation bar with brand link, quick search, tabs bar, and responsive splitters.

#### 2. `apps/web/components/trading/chart-terminal.tsx` (60 KB)
- **1. Existing Functionality**:
  - Custom responsive SVG canvas rendering Candlesticks, Line chart, and Bar chart.
  - Live OHLC top banner with dynamic color deltas, 24h high/low, and volume badge.
  - Technical overlays: Moving Average (SMA 7, 25), Exponential Moving Average (EMA 9), Bollinger Bands (20, 2), and Volume histogram.
  - Interactive left drawing toolbar (Cursor, Trendline, Horizontal line, Vertical line, Fibonacci retracement, Rectangle zone, Measure tool, Freehand brush, Text note).
  - Hover crosshair with price and timestamp guides.
  - Zoom controls (+ / - buttons and mouse wheel).
  - Price scale vertical dragging and time scale horizontal stretching.
- **2. Missing Functionality**:
  - Complete categorized drawing toolbar flyouts:
    - Cursor tools: Cross, Dot, Arrow, Demonstration Pointer, Eraser.
    - Trendline tools: Ray, Extended Line, Info Line, Trend Angle, Parallel Channel.
    - Fibonacci tools: Extension, Fan, Time Zones, Projection.
    - Geometric tools: Circle, Ellipse, Triangle, Polyline.
    - Measurement: Long/Short Position Risk/Reward measurement tool with target & stop boxes.
  - Long-press candle value card configuration menu (Part 5 requirement).
  - Double click to reset scale auto-fit.
  - Separate oscillator sub-panes for RSI (14) and MACD (12, 26, 9).
  - Drawing persistence in market coordinates `(timestamp, price)` rather than pixel offsets.
- **3. Broken Functionality**:
  - When switching timeframe, candle visual width and spacing did not adapt automatically to the visible bar count, causing candle crowding or massive empty gaps.
  - Drawings were tied to viewport `(x, y)` pixels, shifting out of place during zoom or pan.
- **4. Features to Preserve**:
  - Clean SVG rendering engine, crisp high-DPI lines, customizable bull/bear color palette.

#### 3. `apps/web/components/trading/trading-shell.tsx` (25 KB)
- **1. Existing Functionality**:
  - Header with Tanvion Royale branding, route switching (`/trading` vs main `/profile`), deposit modal trigger, wallet balance chip.
- **2. Status**: Working cleanly. Preserve intact.

#### 4. `apps/web/components/trading/instruments-sidebar.tsx` (8.5 KB)
- **1. Existing Functionality**:
  - Filter by category (All, Crypto, Forex, Commodities, Stocks).
  - Search filter input with live highlight.
  - Real-time bid/ask spread display, 24h % change with green/red badges.
- **2. Enhancement Needed**:
  - Add favorite star toggles and custom watchlist tabs.

#### 5. `apps/web/components/trading/buy-sell-panel.tsx` (23 KB)
- **1. Existing Functionality**:
  - Market and Pending order submission forms.
  - Buy/Sell split buttons displaying real-time Ask and Bid prices.
  - Lot size step counter (+0.01, +0.1, +1.0).
  - Take Profit and Stop Loss toggles with Price / Pips / Money inputs.
  - Real-time margin requirement and free margin calculation.
- **2. Broken Functionality**:
  - Calculations lacked instrument-specific contract size (e.g. 100,000 for Forex EURUSD, 100 for XAUUSD Gold).

#### 6. `apps/web/components/trading/order-book.tsx` & `market-trades.tsx`
- **1. Existing Functionality**:
  - L2 Depth ladder with cumulative volume visual bars.
  - Real-time trades list with price, size, and timestamp.
- **2. Status**:
  - Uses `fetchBinanceDepth` and `fetchBinanceTrades` for Crypto pairs. Needs auto-reconnect fallback for Forex/Commodities.

#### 7. `apps/web/components/trading/trading-positions-panel.tsx` (16 KB)
- **1. Existing Functionality**:
  - Open positions table with Symbol, Type (Buy/Sell), Volume (Lots), Open Price, Current Price, SL, TP, Floating P&L, Close button.
  - Pending orders table with Trigger Price and Cancel button.
  - Closed orders history with Realized P&L and Close Timestamp.
- **2. Fix Required**:
  - Standardize P&L formula using contract specifications.

#### 8. `apps/web/lib/api/trading.ts` & `binance-live.ts`
- **1. Existing Functionality**:
  - Full TypeScript interfaces for TradingInstrument, TradingOrder, TradingPosition, TradingCandle, TradingPortfolio.
  - Direct connection to Binance REST public endpoints for 24h tickers, klines, order book depth, and recent trades.
- **2. Missing Functionality**:
  - Candle aggregation utility for non-standard intervals (e.g. converting 1m candles into 2m, 3m, 10m, 20m, 45m).
  - Real-time WebSocket feed subscription for sub-second tick updates.

---

### B. Backend Modules (`apps/api/src/modules/trading/`)

#### 1. `apps/api/src/modules/trading/trading.service.ts` (31 KB)
- **1. Existing Functionality**:
  - Order execution logic, validation against user trading wallet, leverage calculations, margin checks, position closing, stop-out monitoring.
- **2. Improvements Needed**:
  - Integrate instrument contract specs table to validate tick size, pip size, and contract multipliers.

#### 2. `apps/api/src/modules/trading/market-data.service.ts` & `adapters/`
- **1. Existing Functionality**:
  - Multi-asset data aggregation: Frankfurter ECB adapter for Forex, Yahoo Finance adapter for Stocks.
  - Crypto adapter with Binance caching.
- **2. Status**: Operational with fallback caching.

#### 3. Database Schema (`database/prisma/schema.prisma`)
- **1. Existing Models**:
  - `TradingAccount`: Stores user trading accounts (type: REAL, DEMO, PRO), currency, leverage, balance, equity, usedMargin, freeMargin.
  - `TradingInstrument`: Stores symbol, name, type (CRYPTO, FOREX, COMMODITY, STOCK), basePrice, currentPrice, isEnabled.
  - `TradingOrder`: Stores accountId, instrumentId, side (BUY, SELL), type (MARKET, LIMIT, STOP), volume, price, triggerPrice, stopLoss, takeProfit, status (PENDING, FILLED, CANCELLED, REJECTED).
  - `TradingPosition`: Stores accountId, instrumentId, side, volume, entryPrice, currentPrice, stopLoss, takeProfit, unrealizedPnl, realizedPnl.
  - `TradingTransaction`: Ledger records for order executions, swaps, and commissions.
- **2. Database Integrity**: Schema is comprehensive and fully normalized. No duplicate models needed.

---

## 3. Financial Calculation Audit & Contract Specifications

### Critical Fix: Per-Instrument Contract Specifications
Standard broker contract formulas must be strictly enforced:

| Asset Class | Example Symbol | Contract Size | Tick Size | Pip Size | Floating P&L Formula (BUY) |
|---|---|---|---|---|---|
| **Crypto** | `BTCUSD` | 1 Coin | 0.01 USD | 1.00 USD | `(Current Price - Open Price) * Lots * 1` |
| **Forex** | `EURUSD` | 100,000 Units | 0.00001 | 0.0001 (10 pts) | `(Current Price - Open Price) * Lots * 100,000` |
| **Forex JPY** | `USDJPY` | 100,000 Units | 0.001 | 0.01 (10 pts) | `(Current Price - Open Price) * Lots * 100,000 / Current Price` |
| **Metals** | `XAUUSD` (Gold) | 100 Troy Oz | 0.01 USD | 0.10 USD | `(Current Price - Open Price) * Lots * 100` |
| **Energies** | `USOIL` (Crude) | 1,000 Barrels | 0.01 USD | 0.01 USD | `(Current Price - Open Price) * Lots * 1,000` |

### Required Margin Formula:
$$\text{Margin Required} = \frac{\text{Lots} \times \text{Contract Size} \times \text{Entry Price}}{\text{Leverage}}$$

### Free Margin & Margin Level:
$$\text{Equity} = \text{Balance} + \text{Floating P\&L}$$
$$\text{Free Margin} = \text{Equity} - \text{Used Margin}$$
$$\text{Margin Level \%} = \left( \frac{\text{Equity}}{\text{Used Margin}} \right) \times 100$$
- Margin Call at $100\%$
- Stop Out (Liquidation) at $50\%$

---

## 4. UI Interaction & Performance Audit

1. **Candle Width & Spacing**:
   - Must dynamically calculate `candleWidth = (plotWidth / visibleCandleCount) * candleSpacingRatio`.
   - Prevent arbitrary stretching on timeframe switch.
2. **Coordinate Anchoring for Drawings**:
   - Must convert `(x, y)` pixels to `(timestamp, price)` so drawn lines remain accurate during pan and zoom.
3. **Sound System**:
   - Synthesize sound effects using the Web Audio API (`AudioContext`) to eliminate external audio asset download failures and comply with browser autoplay restrictions.
4. **Dockable Workspace**:
   - Support floating modal and split dock states with persistent dimensions in `localStorage`.

---

## 5. Security Audit
- All order placement requests require server authentication and balance validation.
- Client cannot fabricate execution prices; backend verifies against live rate cache.
- Idempotency keys (`idempotencyKey`) prevent duplicate order execution on double-click.
- Stale data indicators appear automatically if market feed latency exceeds 5 seconds.
