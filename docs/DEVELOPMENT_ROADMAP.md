# TANVIONROYALE — Development Roadmap & Action Plan
**Target:** Upgrade to enterprise-grade, fully responsive platform.

---

## Roadmap Phases

### Phase A: Full Codebase & Architecture Audit ✅
- Complete deep inspection of monorepo packages, models, controllers, and components.
- Publish `PROJECT_AUDIT.md`, `FEATURE_IMPLEMENTATION_MATRIX.md`, `ARCHITECTURE_OVERVIEW.md`, `DATABASE_AUDIT.md`, `API_INVENTORY.md`, `SECURITY_AUDIT.md`, `DEVELOPMENT_ROADMAP.md`, `IMPLEMENTATION_PROGRESS.md`.

### Phase B: TypeScript & Build Stabilization
- Fix candle aggregator casing (`'1M'` vs `'1m'`) and UTC month boundary calculations.
- Verify 0 TypeScript errors across `@tanvion-royale/web`, `@tanvion-royale/api`, and packages.
- Ensure all test suites pass.

### Phase C: Dashboard Upgrade & Mobile Drawer Navigation
- **Dashboard Upgrade**:
  - Profile header with real username, avatar, UID, Copy UID button, VIP level, following/followers, and verification status.
  - Compact Financial Overview: Estimated Total Value, BTC & USD equivalent, Balance visibility toggle, Today's PnL, PnL %, 24h portfolio sparkline, Available vs Frozen balance.
  - Quick action buttons (Deposit, Withdraw, Cash In where supported).
  - Compact summary cards: Total Assets, Open Orders, Active Trading Positions, Active Bets, Casino Activity, Recent Transactions, Rewards, Referral Performance.
  - Build `GET /api/v1/dashboard/overview` API.
- **Mobile Responsive Navigation**:
  - Implement smooth off-canvas mobile drawer (< 768px) with backdrop overlay.
  - Connect hamburger button to toggle drawer.
  - Auto-close drawer on navigation item click, Escape key, or backdrop tap.
  - Ensure Trade remains in the bottom navigation.
  - Zero horizontal overflow.

### Phase D: Assets, Portfolio & Orders Aggregation
- Unified Asset Overview (Spot, Funding, Trading, Demo assets, Portfolio allocation).
- Unified Orders Center (read-only aggregation of Trading Orders, Betting slips, Casino rounds).

### Phase E: Final Verification, Testing & Polish
- Run full test suites (frontend and backend).
- Ensure builds succeed and responsiveness matches reference images.
