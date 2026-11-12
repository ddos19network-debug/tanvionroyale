# TANVION ROYALE TRADING PLATFORM — COMPREHENSIVE TEST PLAN
**Purpose:** Verify functional parity, visual precision, financial correctness, and error-free execution across all platform modules.
**Standard:** Exness-Grade Financial Trading Terminal Acceptance Criteria

---

## 1. Timeframe Engine & Candle Aggregation Tests
- [ ] **TEST-TF-01**: Switch from 1m to 3m on `BTCUSD`. Confirm historical candles reload with 3-minute bars.
- [ ] **TEST-TF-02**: Switch to 15m. Confirm candles aggregate volume and high/low ranges properly.
- [ ] **TEST-TF-03**: Switch to non-standard intervals (2m, 10m, 45m, 2h). Confirm client aggregator rolls up candles without gaps.
- [ ] **TEST-TF-04**: Switch to seconds interval (1s, 5s, 15s). Confirm real-time updates and sub-minute timestamp accuracy.
- [ ] **TEST-TF-05**: Confirm candle body width and spacing remain visually balanced upon timeframe changes (no accidental squishing).

---

## 2. Mouse & Touch Interaction Tests
- [ ] **TEST-MSE-01**: Left mouse drag inside chart area -> candles pan smoothly horizontally.
- [ ] **TEST-MSE-02**: Mouse wheel -> zoom in and zoom out centered on cursor position.
- [ ] **TEST-MSE-03**: Drag right vertical price axis up and down -> price range expands and contracts smoothly.
- [ ] **TEST-MSE-04**: Drag bottom horizontal time axis left and right -> time interval expands and contracts.
- [ ] **TEST-MSE-05**: Double click anywhere on chart -> scales immediately reset to auto-fit.
- [ ] **TEST-MSE-06**: Right click anywhere on chart -> contextual menu appears with quick actions (Reset, Alert, Indicators, Settings).
- [ ] **TEST-MSE-07**: Long press on a candle (with setting enabled) -> complete OHLCV values card appears.
- [ ] **TEST-MSE-08**: Touch pan and pinch-to-zoom on touchscreens -> responsive canvas transformation without page scroll.

---

## 3. Drawing Toolbar & Coordinate Persistence Tests
- [ ] **TEST-DRW-01**: Select Trendline tool -> click point A and drag to point B -> line is drawn.
- [ ] **TEST-DRW-02**: Select Fibonacci Retracement -> drag from swing low to swing high -> all 7 golden ratio levels render accurately.
- [ ] **TEST-DRW-03**: Select Long/Short Position tool -> place on chart -> risk/reward target and stop zones render.
- [ ] **TEST-DRW-04**: Pan and zoom chart -> all drawn objects remain strictly anchored to their market `(timestamp, price)` levels.
- [ ] **TEST-DRW-05**: Switch timeframe -> drawn objects maintain their correct price levels.
- [ ] **TEST-DRW-06**: Open Objects Manager -> list displays all drawings with hide/show, lock, and delete controls.
- [ ] **TEST-DRW-07**: Reload browser -> drawings persist from `localStorage` (`tr_drawings_v2`).

---

## 4. Comprehensive Settings System Tests (10 Categories)
- [ ] **TEST-SET-01**: Category A (Show on Chart) -> toggle Signals, Price Alerts, Positions, TP/SL, and Alignment (Left/Right) -> chart updates immediately.
- [ ] **TEST-SET-02**: Economic Calendar impact filters (High, Middle, Low) -> verify markers filter accordingly.
- [ ] **TEST-SET-03**: Category B (Sound Effects) -> toggle sound effects ON/OFF, adjust volume, test preview chime.
- [ ] **TEST-SET-04**: Category C (Trading Settings) -> configure Auto TP/SL (Pips, Risk/Reward, Money) -> order form defaults update.
- [ ] **TEST-SET-05**: Category D (Open Order Mode) -> switch between Regular, Quick, and 1-Click modes -> form layout adapts.
- [ ] **TEST-SET-06**: Category E (Price Source) -> switch between Bid, Ask, Mid, and Last -> active price badge updates.
- [ ] **TEST-SET-07**: Category F (Timezone) -> search and select `Asia/Dhaka` or `Europe/London` -> all time labels convert properly.
- [ ] **TEST-SET-08**: Category G (Appearance) -> change bullish/bearish candle colors -> chart renders with new colors immediately.
- [ ] **TEST-SET-09**: Category H (Price & Scale) -> toggle Logarithmic scale and Auto-scale -> chart y-axis transforms accordingly.
- [ ] **TEST-SET-10**: Reload browser -> all 10 categories of settings persist from `localStorage` (`tr_chart_settings_v2`).

---

## 5. Indicator System Tests
- [ ] **TEST-IND-01**: Enable SMA (7, 25) and EMA (9) -> overlay curves render accurately on price series.
- [ ] **TEST-IND-02**: Enable Bollinger Bands (20, 2) -> shaded volatility channel renders on chart.
- [ ] **TEST-IND-03**: Enable RSI (14) -> dedicated bottom oscillator pane renders with 70/30 overbought/oversold levels.
- [ ] **TEST-IND-04**: Enable MACD (12, 26, 9) -> dedicated bottom pane renders MACD line, signal line, and histogram.
- [ ] **TEST-IND-05**: Enable Supertrend -> trend direction overlay line renders with green/red buy/sell signal markers.

---

## 6. Workspace Docking & Resizing Tests
- [ ] **TEST-WS-01**: Drag left splitter -> left instruments sidebar resizes smoothly (180px–420px).
- [ ] **TEST-WS-02**: Drag bottom splitter -> bottom positions dock resizes smoothly (90px–380px).
- [ ] **TEST-WS-03**: Drag right splitter -> order panel resizes smoothly (220px–440px).
- [ ] **TEST-WS-04**: Select Multi-Chart (1, 2, or 4 charts) -> independent chart instances render simultaneously.
- [ ] **TEST-WS-05**: Switch layout presets (Default, Classic, Multi-Chart, Scalping) -> layout adapts cleanly.

---

## 7. Order Execution & Financial Accounting Tests
- [ ] **TEST-ORD-01**: Submit Market Buy order -> order executes instantly, audio chime plays, position appears in Open table.
- [ ] **TEST-ORD-02**: Submit Pending Limit order -> order appears in Pending table with trigger price.
- [ ] **TEST-ORD-03**: Verify Forex P&L calculation -> 1.00 Lot of `EURUSD` gives $10.00 per pip move (`Lots * 100,000 * delta`).
- [ ] **TEST-ORD-04**: Verify Gold P&L calculation -> 1.00 Lot of `XAUUSD` gives $100.00 per $1.00 move (`Lots * 100 * delta`).
- [ ] **TEST-ORD-05**: Verify Crypto P&L calculation -> 1.00 Lot of `BTCUSD` gives $1.00 per $1.00 move (`Lots * 1 * delta`).
- [ ] **TEST-ORD-06**: Close position -> position moves to Closed tab, realized P&L is credited to balance, audio plays.
- [ ] **TEST-ORD-07**: Insufficient margin check -> orders with required margin exceeding free margin are rejected with error toast.

---

## 8. TypeScript Compilation & Quality Standards
- [ ] **TEST-TS-01**: Web app compilation: `pnpm --filter @tanvion-royale/web exec tsc --noEmit` -> 0 errors.
- [ ] **TEST-TS-02**: Backend API compilation: `pnpm --filter @tanvion-royale/api exec tsc --noEmit` -> 0 errors.
