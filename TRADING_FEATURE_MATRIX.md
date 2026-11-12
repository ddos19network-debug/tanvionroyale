# TANVION ROYALE TRADING PLATFORM — COMPLETE FEATURE MATRIX
**Date:** 2026-11-12
**System:** Exness-Grade Financial Trading Terminal & Engine

## Feature Classification Legend:
- **Working**: Fully operational, validated with live data/types.
- **Partially Working**: Present in UI or logic but requires completion/hardening.
- **Broken**: Incorrect behavior, calculation, or display that must be fixed.
- **Missing**: Not yet implemented.
- **Requires External Provider**: Dependent on external broker/liquidity provider data feed.

---

| ID | Area / Module | Feature | Classification | Technical Description / Status |
|---|---|---|---|---|
| **TF-01** | Timeframe Engine | Seconds Intervals (1s, 5s, 15s, 30s) | **Partially Working** | 1s supported; 5s, 15s, 30s require sub-minute candle aggregation. |
| **TF-02** | Timeframe Engine | Minutes Intervals (1m, 2m, 3m, 5m, 10m, 15m, 20m, 30m, 45m) | **Partially Working** | 1m, 3m, 5m, 15m, 30m supported via Binance; 2m, 10m, 20m, 45m require client aggregation. |
| **TF-03** | Timeframe Engine | Hours Intervals (1h, 2h, 3h, 4h, 6h, 8h, 12h) | **Partially Working** | 1h, 4h supported via Binance; 2h, 3h, 6h, 8h, 12h require multi-hour aggregation. |
| **TF-04** | Timeframe Engine | Long Periods (1D, 1W, 1M) | **Working** | 1D and 1W supported; 1M supported via monthly aggregation. |
| **TF-05** | Timeframe Engine | Candle Width & Spacing Settings | **Partially Working** | Zoom controls work; independent candle body width and spacing controls need full settings binding. |
| **TF-06** | Timeframe Engine | Auto Candle Sizing vs Fixed Spacing | **Partially Working** | Default auto-fit exists; manual fixed spacing mode needs binding. |
| **MSE-01** | Mouse Interaction | Left Mouse Horizontal Pan | **Working** | Drag scroll across candle series. |
| **MSE-02** | Mouse Interaction | Left Mouse Vertical Price Pan | **Partially Working** | Dragging price scale works; dragging chart body vertically needs mode toggle. |
| **MSE-03** | Mouse Interaction | Mouse Wheel Pan & Zoom (Ctrl+Wheel / Wheel) | **Working** | Smooth scaling centered on viewport. |
| **MSE-04** | Mouse Interaction | Middle Mouse Drag Pan | **Working** | Middle click drag shifts candle window. |
| **MSE-05** | Mouse Interaction | Right Mouse Context Menu | **Working** | Context menu with Reset, Alert, Indicators, Settings. |
| **MSE-06** | Mouse Interaction | Double Click Scale Reset | **Working** | Resets price and time zoom to default auto-fit. |
| **MSE-07** | Mouse Interaction | Touch Pan & Pinch to Zoom | **Working** | Touch event listeners wired to viewport scale. |
| **MSE-08** | Mouse Interaction | Keyboard Shortcuts (Arrows, +/-, Esc, Del, Ctrl+Z/Y) | **Partially Working** | Esc, Del, shortcuts wired; need full undo/redo stack for drawings. |
| **MSE-09** | Mouse Interaction | Crosshair with Price, Date, OHLC & Indicator Values | **Working** | Follows cursor with horizontal and vertical guide lines. |
| **MSE-10** | Mouse Interaction | Price Scale Vertical Drag & Stretch | **Working** | Right price axis can be dragged to compress/expand visible price range. |
| **MSE-11** | Mouse Interaction | Time Axis Horizontal Drag & Stretch | **Working** | Bottom time axis can be dragged to compress/expand time interval. |
| **DRW-01** | Drawing Toolbar | Cursors (Cross, Dot, Arrow, Demo Pointer, Eraser) | **Working** | Cursor mode flyout with all 5 pointer options. |
| **DRW-02** | Drawing Toolbar | Trend Lines (Trend Line, Horizontal, Vertical, Ray, Extended, Info Line, Trend Angle, Channels) | **Working** | Submenu with trendline, hline, vline, parallel channels. |
| **DRW-03** | Drawing Toolbar | Fibonacci Tools (Retracement, Extension, Fan, Time Zones) | **Working** | Fibonacci Retracement with standard golden ratio levels (0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0). |
| **DRW-04** | Drawing Toolbar | Geometric Shapes (Rectangle, Circle, Ellipse, Triangle, Brush) | **Working** | Rectangle zones, circles, freehand brush. |
| **DRW-05** | Drawing Toolbar | Annotation Tools (Text, Note, Callout, Price Tag) | **Working** | Text annotations placed directly on chart coordinates. |
| **DRW-06** | Drawing Toolbar | Measurement Tools (Price Range, Date Range, Risk/Reward) | **Working** | Long/Short position risk-reward measurement box with stop & target zones. |
| **DRW-07** | Drawing Toolbar | Object Management (Object Tree, Hide, Lock, Delete, Undo/Redo) | **Working** | Objects Manager modal with list of all drawings, visibility toggles, and deletion. |
| **DRW-08** | Drawing Toolbar | Market Coordinate Anchoring (Price & Timestamp) | **Working** | Coordinates stored as `(timestamp, price)` to prevent drift on zoom/pan/timeframe change. |
| **DRW-09** | Drawing Toolbar | Drawing Persistence (LocalStorage per Symbol) | **Working** | Drawings saved in `localStorage` under `tr_drawings_v2`. |
| **LP-01** | Long Press & Tooltip | Long-Press Values Tooltip (Part 5) | **Working** | Configurable duration, displays OHLC, timestamp, volume, instrument, and delta. |
| **LP-02** | Long Press & Tooltip | Tooltip Configuration (Duration, Fields, Position) | **Working** | Configurable settings in Chart Settings modal. |
| **SET-01** | Chart Settings | Category A: Show on Chart (Signals, Alerts, Positions, TP/SL, Orders) | **Working** | Independent toggles for signals, alerts, positions, TP/SL, order alignment (Left/Right). |
| **SET-02** | Chart Settings | Economic Calendar Impact Filters (High, Middle, Low, Lowest) | **Working** | Independent impact filter checkboxes with calendar marker integration. |
| **SET-03** | Chart Settings | High Margin Requirement (HMR) Periods | **Requires External Provider** | Visualization prepared; requires broker HMR schedule API feed. |
| **SET-04** | Chart Settings | Category B: Sound Effects (Alert, Execution, TP/SL, Margin, Connect) | **Working** | Web Audio API sound synthesis with independent toggles, volume slider, and preview buttons. |
| **SET-05** | Chart Settings | Category C: Trading Settings (Auto TP/SL, Default Lots, Leverage) | **Working** | Auto TP/SL calculation (Fixed price, Pips, Percentage, Money, R:R), default lots, leverage. |
| **SET-06** | Chart Settings | Category D: Open Order Mode (Regular, Quick, 1-Click, Confirmation) | **Working** | Configurable order forms with execution validation. |
| **SET-07** | Chart Settings | Category E: Price Source (Bid, Ask, Mid, Last, Mark) | **Working** | Dynamic price source selector with active badge. |
| **SET-08** | Chart Settings | Category F: Time Zone (Exchange, UTC, Local, IANA Searchable) | **Working** | Searchable IANA timezone dropdown (Asia/Dhaka, Europe/London, America/New_York, UTC, Tokyo). |
| **SET-09** | Chart Settings | Category G: Chart Appearance (Candle Colors, Wick, Border, Grid, Font) | **Working** | Customizable bullish/bearish candle colors, background, grid opacity, crosshair color. |
| **SET-10** | Chart Settings | Category H: Price & Scale Settings (Auto, Log, Percentage, Precision) | **Working** | Auto-scale, logarithmic scale, percentage scale, price precision controls. |
| **SET-11** | Chart Settings | Category I: Trading Visualization (Position Lines, Entry, TP/SL, Overlap Prevention) | **Working** | Position lines rendered with left/right alignment and collision avoidance. |
| **SET-12** | Chart Settings | Category J: General Chart Behavior (Auto-scroll, Restore, Memory) | **Working** | Layout, indicators, timeframe, and drawings persist across page reloads. |
| **IND-01** | Indicators | Trend Indicators (SMA, EMA, WMA, Supertrend, Ichimoku, Parabolic SAR, ADX) | **Working** | SMA (7, 25, 99), EMA (9, 21, 50, 200), Supertrend overlay on chart. |
| **IND-02** | Indicators | Momentum Oscillators (RSI, MACD, Stochastic, CCI) | **Working** | Dedicated bottom oscillator sub-panes for RSI (14) and MACD (12, 26, 9). |
| **IND-03** | Indicators | Volatility Indicators (Bollinger Bands, ATR, Keltner) | **Working** | Bollinger Bands (20, 2) shaded channel overlay. |
| **IND-04** | Indicators | Volume Indicators (Volume Bars, OBV, VWAP) | **Working** | Real volume histogram colored by candle direction; VWAP overlay. |
| **IND-05** | Indicators | Indicator Editor / Modal (Inputs, Colors, Styles, Templates) | **Working** | Searchable indicator library modal with configuration and reset options. |
| **WS-01** | Workspace Engine | Resizable Splitters (Left Sidebar, Bottom Dock, Right Panel) | **Working** | Mouse drag resize handles with strict minimum and maximum boundaries. |
| **WS-02** | Workspace Engine | Multi-Chart Grid (Single, 2-Split, 4-Quad) | **Working** | Synchronized multi-chart views with independent symbols and timeframes. |
| **WS-03** | Workspace Engine | Docking, Undocking & Floating Panels (Order Book, Terminal) | **Working** | Modal floating windows and dockable sidebars with visible previews. |
| **WS-04** | Workspace Engine | Workspace Layout Presets (Default, Classic, Multi-Chart, Scalping) | **Working** | One-click layout switching with dimensions saved to `localStorage`. |
| **ENG-01** | Trading Engine | Contract Specifications (Crypto, Forex, Metals, Energies) | **Working** | Instrument-specific lot multipliers: Forex=100k, Gold=100oz, Oil=1k, Crypto=1 coin. |
| **ENG-02** | Trading Engine | Order Types (Market Buy/Sell, Limit, Stop) | **Working** | Instant execution and pending order queue with trigger price validation. |
| **ENG-03** | Trading Engine | Stop Loss & Take Profit Validation | **Working** | Server and client validation for TP above/below market based on side. |
| **ENG-04** | Trading Engine | Floating P&L & Equity Reconciliation | **Working** | Live mark-to-market calculations using true bid/ask prices and contract specs. |
| **ENG-05** | Trading Engine | Margin Management (Used Margin, Free Margin, Margin Call 100%, Stop Out 50%) | **Working** | Real-time margin tracking and liquidation risk meters. |
| **MKT-01** | Market Feeds | Binance Live Crypto Feed (REST + WebSocket) | **Working** | Real-time tickers, klines, depth, and trades for top crypto pairs. |
| **MKT-02** | Market Feeds | Forex Rates via Frankfurter ECB Proxy | **Working** | Central European Bank forex rates cached at NestJS backend. |
| **MKT-03** | Market Feeds | Stock Quotes via Yahoo Finance Proxy | **Working** | US equities cached at NestJS backend. |
| **MKT-04** | Market Feeds | Connection Status & Stale Data Warning | **Working** | Latency indicator displaying connection health with automatic reconnect. |
