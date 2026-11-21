# TANVIONROYALE — FEATURE IMPLEMENTATION MATRIX
**Phase:** Phase 3: Core Application Development  
**Date:** November 2026  
**Status Legend:**
- `COMPLETE AND VERIFIED`: Feature is implemented, backend-connected, typesafe, and verified.
- `IMPLEMENTED BUT NOT FULLY VERIFIED`: Feature implemented; pending external integration or live credentials.
- `BLOCKED BY EXTERNAL DEPENDENCY`: Feature depends on third-party API keys or external live gateways.
- `OUT OF SCOPE — ROYALE PLAY`: Excluded from modification to protect Free Play game integrity.

---

## 1. Feature Implementation Matrix

| Module / Feature | Route / Endpoint | Frontend Component | Backend Service / Controller | Status | Notes |
|---|---|---|---|---|---|
| **Dashboard — Account Overview** | `/dashboard` | `apps/web/app/(user)/dashboard/page.tsx` | `DashboardController.getOverview` | **COMPLETE AND VERIFIED** | UID, username, avatar, account status, VIP status from authenticated JWT session. |
| **Dashboard — Wallet Summary** | `/dashboard` | `apps/web/app/(user)/dashboard/page.tsx` | `ProfileActivityService.getDashboardOverview` | **COMPLETE AND VERIFIED** | Available, locked, total balance, today's P&L, balance visibility toggle. |
| **Dashboard — Trading Summary** | `/dashboard` | `apps/web/app/(user)/dashboard/page.tsx` | `ProfileActivityService.getDashboardOverview` | **COMPLETE AND VERIFIED** | Virtual balance, active positions, open orders, total orders, unrealized P&L. |
| **Dashboard — Referral Summary** | `/dashboard` | `apps/web/app/(user)/dashboard/page.tsx` | `ProfileActivityService.getDashboardOverview` | **COMPLETE AND VERIFIED** | Referral code, 1-click copy, total referred count, earnings in minor units. |
| **Dashboard — Recent Activity** | `/dashboard` | `apps/web/app/(user)/dashboard/page.tsx` | `ProfileActivityService.listActivity` | **COMPLETE AND VERIFIED** | Chronological feed of deposits, withdrawals, bets, and profile events with relative timestamps. |
| **Dashboard — Quick Actions** | `/dashboard` | `apps/web/app/(user)/dashboard/page.tsx` | N/A (Client Navigation) | **COMPLETE AND VERIFIED** | Direct responsive links to Deposit, Withdraw, Trading, Wallet, and Games. |
| **User Profile — Profile Information** | `/profile` | `apps/web/app/(user)/profile/page.tsx` | `UsersController.getProfile`, `UsersController.updateProfile` | **COMPLETE AND VERIFIED** | Username, email, phone, country, registration date, UID. |
| **User Profile — Account Security** | `/settings` | `apps/web/app/(user)/settings/page.tsx` | `UsersController.changePassword` | **COMPLETE AND VERIFIED** | Password change, active sessions, OTP validation. |
| **User Profile — KYC / Verification** | `/verification` | `apps/web/app/(user)/verification/page.tsx` | `VerificationController` | **COMPLETE AND VERIFIED** | Document upload, verification status tracking (Pending, Verified, Rejected). |
| **Assets — Catalog & Holdings** | `/assets` | `apps/web/app/(user)/assets/page.tsx` | `listTradingPositions`, `listTradingInstruments` | **COMPLETE AND VERIFIED** | Multi-asset search, category tabs (Crypto, Stocks, Forex, Commodities), available/locked amounts. |
| **Assets — Position Valuation** | `/assets` | `apps/web/app/(user)/assets/page.tsx` | `TradingService` | **COMPLETE AND VERIFIED** | Mark-to-market valuations, unrealized P&L calculation, status badges. |
| **Main Wallet — Multi-Currency Overview** | `/wallet` | `apps/web/app/(user)/wallet/page.tsx` | `WalletController.getBalance` | **COMPLETE AND VERIFIED** | BDT, USD, EUR balances, available vs locked breakdowns, currency selector. |
| **Main Wallet — Transactions** | `/wallet/transactions` | `apps/web/app/(user)/wallet/transactions/page.tsx` | `WalletController.listTransactions` | **COMPLETE AND VERIFIED** | Status filter (Pending, Completed, Failed), currency filter, search, pagination. |
| **Deposit — Payment Methods** | `/wallet/deposit` | `apps/web/app/(user)/wallet/deposit/page.tsx` | `WalletController.getDepositMethods` | **COMPLETE AND VERIFIED** | bKash, Nagad, Rocket, Bank Transfer, Card payment instructions and limits. |
| **Deposit — Manual Submission** | `/wallet/deposit` | `apps/web/app/(user)/wallet/deposit/page.tsx` | `WalletController.submitManualDeposit` | **COMPLETE AND VERIFIED** | Amount validation, reference ID capture, payment screenshot proof, idempotency protection. |
| **Withdrawal — Submission** | `/wallet/withdraw` | `apps/web/app/(user)/wallet/withdraw/page.tsx` | `WalletController.submitManualWithdrawal` | **COMPLETE AND VERIFIED** | Available balance validation, destination validation, server-side fund reservation. |
| **Withdrawal — History & Tracking** | `/wallet/withdraw` | `apps/web/app/(user)/wallet/withdraw/page.tsx` | `WalletController.listMyManualWithdrawals` | **COMPLETE AND VERIFIED** | Real-time status badges (Pending, Completed, Rejected), rejection reason display. |
| **Trading Terminal — Candle Aggregator** | `/trading` | `apps/web/components/trading/chart-terminal.tsx` | `apps/web/lib/api/candle-aggregator.ts` | **COMPLETE AND VERIFIED** | 1s, 1m, 3m, 5m, 15m, 1h, 1D aggregation, OHLC integrity, zero distortion. |
| **Trading Terminal — Exness Controls** | `/trading` | `apps/web/components/trading/trading-terminal.tsx` | `BinanceWebSocket`, `LiveMarketQuotes` | **COMPLETE AND VERIFIED** | Categorized drawing tools, multi-chart tabs, split buy/sell panels, sentiment bar. |
| **Admin — Dashboard & Financial Overview** | `/admin` | `apps/web/app/admin/page.tsx` | `AdminWalletController` | **COMPLETE AND VERIFIED** | Financial metrics, system health, pending actions summary. |
| **Admin — Manual Deposit Review** | `/admin/wallets` | `apps/web/app/admin/wallets/page.tsx` | `AdminManualDepositsController` | **COMPLETE AND VERIFIED** | Review proof, verify reference, approve with atomic ledger credit or reject with reason. |
| **Admin — Manual Withdrawal Review** | `/admin/wallets` | `apps/web/app/admin/wallets/page.tsx` | `AdminManualWithdrawalsController` | **COMPLETE AND VERIFIED** | Verify KYC, review destination details, approve payout or reject and release reserved funds. |
| **Admin — Payment Gateways & Methods** | `/admin/payment-methods` | `apps/web/app/admin/payment-methods/page.tsx` | `AdminPaymentMethodsController` | **COMPLETE AND VERIFIED** | Enable/disable deposit and withdrawal methods, set min/max transaction limits. |
| **Admin — RBAC Enforcement** | All `/admin/*` | N/A (Guards) | `JwtAuthGuard`, `RolesGuard('ADMIN')` | **COMPLETE AND VERIFIED** | Verified backend role-based access control protecting all administrative endpoints. |
| **Royale Play Games** | `/games/play/*` | Excluded | Excluded | **OUT OF SCOPE — ROYALE PLAY** | Preserved Free Play game integrity (Royale Ace, Atlantis, Fly, Pharaoh, Plinko, Mines). |
