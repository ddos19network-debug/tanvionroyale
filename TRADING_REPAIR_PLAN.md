# TANVION ROYALE TRADING PLATFORM — COMPREHENSIVE REPAIR & UPGRADE PLAN
**Architecture Standard:** Exness-Grade Financial Trading Terminal & Engine
**Execution Mode:** Phased, Non-Destructive, Direct Repository Implementation
**Updated:** 2026-11-12

---

## Phase Overview

- **PHASE A**: Timeframe Engine, Candle Sizing & Multi-Interval Aggregation
- **PHASE B**: Mouse Interactions, Pan, Zoom, Price & Time Scale Dragging
- **PHASE C**: Complete Categorized Drawing Toolbar & Market Coordinate Persistence
- **PHASE D**: Complete 10-Category Chart Settings System & Audio Engine
- **PHASE E**: Advanced Indicators Engine with Separate Sub-Panes
- **PHASE F**: Dockable Workspace Engine, Floating Panels & Layout Presets
- **PHASE G**: Order Execution, Contract Specifications & Risk Engine Reconciliation
- **PHASE H**: Auxiliary Modules (Economic Calendar, Alerts, Timezones, Watchlists)
- **PHASE I**: Full Regression Testing, TypeScript Verification & Acceptance Testing

---

## Detailed File-by-File Implementation Plan

### 1. `apps/web/lib/api/trading-contracts.ts` (NEW MODULE)
- **Purpose**: Centralized instrument-specific contract specifications for Crypto, Forex, Metals, Commodities, and Indices.
- **Formulas Implemented**:
  - `getContractSpec(symbol: string)`
  - Contract size: 100,000 for Forex majors, 100 for Gold (`XAUUSD`), 1,000 for Crude (`USOIL`), 1 for Crypto (`BTCUSD`, `ETHUSD`).
  - Pip size: 0.0001 (0.01 for JPY pairs).
  - Accurate P&L formula: `calcFloatingPnl(side, openPrice, currentPrice, lots, symbol)`.
  - Margin requirement formula: `calcRequiredMargin(openPrice, lots, leverage, symbol)`.

### 2. `apps/web/lib/api/candle-aggregator.ts` (NEW MODULE)
- **Purpose**: Real-time and historical candle aggregation engine.
- **Capabilities**:
  - Aggregates smaller base candles (e.g. 1m or ticks) into non-standard intervals:
    - Seconds: `1s`, `5s`, `15s`, `30s`
    - Minutes: `1m`, `2m`, `3m`, `5m`, `10m`, `15m`, `20m`, `30m`, `45m`
    - Hours: `1h`, `2h`, `3h`, `4h`, `6h`, `8h`, `12h`
    - Long periods: `1D`, `1W`, `1M`
  - High/Low/Open/Close/Volume rollover algorithms ensuring strictly aligned timestamps.

### 3. `apps/web/lib/trading/audio-synthesizer.ts` (NEW MODULE)
- **Purpose**: Web Audio API sound synthesizer for platform sound effects.
- **Sounds Synthesized**:
  - `orderExecution`: Clean affirmative chime
  - `orderRejection`: Dual low-tone buzz
  - `takeProfit`: Celebratory high harmonic chime
  - `stopLoss`: Alert low-pitch sweep
  - `priceAlert`: High-frequency double ping
  - `marginWarning`: Pulse alert
  - `connectionLost`: Disconnect tone
  - `connectionRestored`: Reconnect sweep
- **Benefits**: Zero external audio downloads, 100% reliable, complies with browser user-gesture autoplay policies.

### 4. `apps/web/components/trading/chart-settings-modal.tsx` (NEW COMPONENT)
- **Purpose**: Full searchable 10-category settings modal matching the Exness reference.
- **Categories**:
  - Category A: Show on Chart (Signals, HMR, Price alerts, Open positions, TP/SL lines, Pending order lines, Order & Position Alignment: Left/Right/Auto, Economic calendar with High/Middle/Low/Lowest impact filters).
  - Category B: Sound Effects (Independent toggles for each sound, Master volume slider, Sound preview button, Sound type select).
  - Category C: Trading Settings (Auto TP/SL mode: Disabled, Fixed price, Pips, Percentage, Money, Risk/Reward ratio; Default TP, Default SL, Default lots, Default leverage, One-click trading toggle).
  - Category D: Open Order Mode (Regular form, Quick trading form, One-click form, Confirmation form).
  - Category E: Price Source (Bid, Ask, Last traded price, Mark price, Mid price).
  - Category F: Timezone (Searchable IANA selector: Asia/Dhaka, Europe/London, America/New_York, Asia/Tokyo, UTC, Local browser time, Exchange time).
  - Category G: Chart Appearance (Background color, Bullish candle color, Bearish candle color, Wick color, Border color, Grid visibility/color, Crosshair color, Text color, Price/Time scale colors, Font size/family).
  - Category H: Price and Scale Settings (Auto scale, Lock scale, Reverse scale, Logarithmic scale, Percentage scale, Price precision, Tick labels, Bid/Ask lines, Current price line, Previous close line).
  - Category I: Trading Visualization (Open order markers, Entry lines, Average entry price, SL/TP lines, Pending lines, Overlap prevention).
  - Category J: General Chart Behavior (Scroll to load history, Auto scroll to latest, Keep drawings visible, Remember settings across sessions).

### 5. `apps/web/components/trading/chart-terminal.tsx` (MODIFIED)
- **Enhancements**:
  - Timeframe selector updated with all prompt intervals: 1s, 5s, 15s, 30s, 1m, 2m, 3m, 5m, 10m, 15m, 20m, 30m, 45m, 1h, 2h, 3h, 4h, 6h, 8h, 12h, 1D, 1W, 1M.
  - Integration of `candle-aggregator.ts` for uniform visual candle width and spacing.
  - Interactive price scale vertical drag & stretch handler.
  - Interactive time axis horizontal drag & stretch handler.
  - Categorized drawing toolbar flyouts:
    - Cursor Tools: Cross, Dot, Arrow, Demonstration Pointer, Eraser.
    - Trend Line Tools: Trend Line, Horizontal Line, Vertical Line, Ray, Extended Line, Info Line, Trend Angle, Parallel Channel.
    - Fibonacci Tools: Retracement, Extension, Fan, Time Zones.
    - Geometric Tools: Rectangle zone, Circle, Ellipse, Triangle, Freehand brush.
    - Annotation Tools: Text note, Callout, Price label.
    - Measurement Tools: Long/Short Position Risk/Reward box, Price range, Bar count.
  - Market coordinate anchoring: drawings persist as `(timestamp, price)` rather than pixel offsets.
  - Long-press values tooltip on candles (Part 5 requirement) with configurable timer and fields.
  - Right-click contextual menu (Add Alert, Reset Chart, Indicators, Settings).
  - Double-click to auto-fit scale.
  - RSI (14) and MACD (12, 26, 9) dedicated oscillator sub-panes.
  - Supertrend overlay indicator.

### 6. `apps/web/components/trading/trading-terminal.tsx` (MODIFIED)
- **Enhancements**:
  - Centralized settings state loaded from and saved to `localStorage` (`tr_chart_settings_v2`).
  - Integration with `audio-synthesizer.ts` for audio feedback on all trading events.
  - Searchable timezone formatting applied to candle time axes, market status, and economic calendar.
  - Dockable workspace engine with floating order book and customizable presets (Default, Classic, Multi-Chart Grid, Scalping).
  - Order execution reconciliation with `trading-contracts.ts` per-instrument specifications.
  - Fullscreen chart toggle.

### 7. `apps/web/components/trading/buy-sell-panel.tsx` & `trading-positions-panel.tsx` (MODIFIED)
- **Enhancements**:
  - Incorporate per-instrument contract specifications for exact pip values, required margin, and floating P&L.
  - Partial close position support and trailing stop adjustments.
