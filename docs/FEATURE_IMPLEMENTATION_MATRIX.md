# TANVIONROYALE — Feature Implementation Matrix
**Audit Date:** 2026-11-14

---

## 1. Feature Classification Matrix

| Feature Domain | Specific Sub-Feature | Classification | Source Code Reference | Notes / Target Upgrades |
|:---|:---|:---|:---|:---|
| **Authentication** | Email & Password Login | FULLY IMPLEMENTED AND VERIFIED | `apps/api/src/modules/auth/`, `test/auth.spec.ts` | Argon2, rate-limited, validated |
| **Authentication** | Phone Number Login | FULLY IMPLEMENTED AND VERIFIED | `apps/api/src/modules/auth/`, `test/phone-auth.spec.ts` | E.164 normalization, OTP support |
| **Authentication** | Google OAuth 2.0 | FULLY IMPLEMENTED AND VERIFIED | `apps/api/src/modules/auth/oauth.service.ts` | Handshake verified, state verification |
| **Authentication** | Session Management & Refresh | FULLY IMPLEMENTED AND VERIFIED | `apps/api/src/modules/auth/session.service.ts` | Rotation hash, token reuse detection |
| **RBAC** | Admin Roles & Permissions | FULLY IMPLEMENTED AND VERIFIED | `apps/api/src/modules/admin/`, `test/admin-rbac.spec.ts` | RolePermission and direct UserPermission |
| **Wallet** | Multi-Asset Ledger Balance | FULLY IMPLEMENTED AND VERIFIED | `apps/api/src/modules/wallet/wallet.service.ts` | Double-entry ledger (`LedgerEntry`) |
| **Wallet** | Manual Deposit Request | FULLY IMPLEMENTED AND VERIFIED | `apps/api/src/modules/wallet/manual-deposit.service.ts` | Admin review, screenshot proof, status lifecycle |
| **Wallet** | Manual Withdrawal Request | FULLY IMPLEMENTED AND VERIFIED | `apps/api/src/modules/wallet/withdrawal.service.ts` | Balance freeze, 2-step admin approval |
| **Wallet** | Payment Gateways (bKash, Nagad, etc.) | IMPLEMENTED BUT NOT VERIFIED | `packages/integrations/src/http-gateway/` | Gateway schema ready; external keys needed in prod |
| **Trading Terminal** | Candlestick Charts (Multi-Timeframe) | FULLY IMPLEMENTED AND VERIFIED | `apps/web/app/(user)/trading/` | 1s to 1M intervals, TradingView-style canvas |
| **Trading Terminal** | Drawing Toolbar & Annotations | FULLY IMPLEMENTED AND VERIFIED | `apps/web/components/trading/` | Persistent market coordinate anchoring |
| **Trading Terminal** | Technical Indicators (RSI, MACD, BB) | FULLY IMPLEMENTED AND VERIFIED | `apps/web/components/trading/` | Overlays and dedicated oscillator sub-panes |
| **Trading Terminal** | Audio Synthesizer (Chimes, Orders) | FULLY IMPLEMENTED AND VERIFIED | `apps/web/lib/trading/audio-synthesizer.ts` | Web Audio API chimes |
| **Trading Engine** | Order Execution (Market, Limit) | FULLY IMPLEMENTED AND VERIFIED | `apps/api/src/modules/trading/trading.service.ts` | Paper/demo execution, atomic balance update |
| **Trading Engine** | Contract Specs & Margin Risk | FULLY IMPLEMENTED AND VERIFIED | `apps/web/lib/api/trading-contracts.ts` | Leverage, required margin, stop out checks |
| **Trading Engine** | Candle Aggregator Boundary Logic | PARTIALLY IMPLEMENTED | `apps/web/lib/api/candle-aggregator.ts` | Fix lowercase '1M' casing and UTC calendar bounds |
| **Sportsbook** | Sports & Competitions Catalog | FULLY IMPLEMENTED AND VERIFIED | `apps/api/src/modules/sports/`, `test/sports.spec.ts` | Fixtures, sports taxonomy, search |
| **Sportsbook** | Betslip (Single & Accumulator) | FULLY IMPLEMENTED AND VERIFIED | `apps/web/components/betting/`, `test/betting-bet.spec.ts` | Real odds calculation, potential return |
| **Sportsbook** | Bet Placement & Settlement | FULLY IMPLEMENTED AND VERIFIED | `apps/api/src/modules/betting/settlement.service.ts` | Atomic ledger debit, win settlement credit |
| **Sportsbook** | WinHouse External Book Embed | FULLY IMPLEMENTED AND VERIFIED | `apps/api/src/modules/winhouse/`, `apps/web/scripts/` | Signed token launch, CSP scoped iframe |
| **Casino / Games** | Royale Ace (In-House Cascading Slot) | FULLY IMPLEMENTED AND VERIFIED | `apps/api/src/modules/royale/ace/` | Math harness, RTP tuning, cluster mechanics |
| **Casino / Games** | Royale Crash (Fly Multiplier) | FULLY IMPLEMENTED AND VERIFIED | `apps/api/src/modules/crash/` | Provably fair HMAC-SHA256 seed sequence |
| **Casino / Games** | Royale Plinko & Mines | FULLY IMPLEMENTED AND VERIFIED | `apps/api/src/modules/royale/` | Full RNG generation and verification |
| **Casino / Games** | BigBang / Partner Aggregator | FULLY IMPLEMENTED AND VERIFIED | `apps/api/src/modules/bigbang/`, `test/bigbang-*.spec.ts`| Signed webhooks, game launch URLs |
| **Affiliate & Referral** | Referral Links & Commission Rules | FULLY IMPLEMENTED AND VERIFIED | `apps/api/src/modules/referral/`, `test/referral.spec.ts` | Click tracking, registration attribution, rewards |
| **Affiliate & Referral** | Affiliate Landing & Dashboard | FULLY IMPLEMENTED AND VERIFIED | `apps/web/app/(user)/affiliate/page.tsx` | Commission summary, monthly targets |
| **Notifications** | In-App Notifications & Unread Badge | FULLY IMPLEMENTED AND VERIFIED | `apps/api/src/modules/notifications/`, `apps/web/` | WebSocket + REST notification center |
| **Customer Support** | Live Support Chat & Tickets | FULLY IMPLEMENTED AND VERIFIED | `apps/api/src/modules/support/`, `apps/web/app/(user)/support/` | Real-time chat threads, admin inbox |
| **Dashboard** | Profile Header with Real UID & Status | PARTIALLY IMPLEMENTED | `apps/web/app/(user)/dashboard/page.tsx` | Basic card needs full VIP, follower & UID copy UI |
| **Dashboard** | Financial Overview (BTC/USD, PnL) | PARTIALLY IMPLEMENTED | `apps/web/app/(user)/dashboard/page.tsx` | Needs compact visual financial card with sparkline |
| **Dashboard** | Compact Action & Summary Cards | PARTIALLY IMPLEMENTED | `apps/web/app/(user)/dashboard/page.tsx` | Needs active bets, open orders, casino stats cards |
| **Dashboard** | Aggregated Overview API | BACKEND ONLY / PARTIALLY IMPLEMENTED | `apps/api/src/modules/users/profile.controller.ts` | Combine into dedicated `GET /dashboard/overview` |
| **Navigation** | Desktop Sidebar Navigation | FULLY IMPLEMENTED AND VERIFIED | `apps/web/components/navigation/user-sidebar.tsx` | 240px clean dark sidebar with icons and studios |
| **Navigation** | Mobile Navigation Drawer (<768px) | PARTIALLY IMPLEMENTED | `apps/web/components/layout/app-header.tsx` | Dropdown needs upgrade to smooth off-canvas drawer |
| **Royale Pay** | Dedicated Payment Product Module | PARTIALLY IMPLEMENTED / PLANNED | `apps/api/src/modules/royale-pay/` | Shared ledger backend with dedicated payment UI |
| **Sub Accounts** | Multi-Account Management | MISSING / PLANNED | `database/prisma/schema.prisma` | SubAccount models and permission checks |
| **Orders Center** | Unified Orders Aggregator | PARTIALLY IMPLEMENTED | `apps/web/app/(user)/` | Separate bet/trade orders exist; unify in read view |
| **Activity Center** | Unified Activity Timeline | PARTIALLY IMPLEMENTED | `apps/web/components/profile/profile-activity.tsx` | Unify login, trade, bet, deposit events |
