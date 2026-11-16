# TANVIONROYALE — FEATURE IMPLEMENTATION MATRIX

## Legend
| Status | Meaning |
|---|---|
| WORKING | Fully functional and tested |
| PARTIAL | Some functionality exists but is incomplete |
| BROKEN | Exists but does not work correctly |
| MISSING | Not implemented |
| OUT OF SCOPE — ROYALE PLAY | Existing Royale Play game functionality |

---

## A. Dashboard (Route: /dashboard)

- Feature name: Dashboard
- Existing file paths: —
- Frontend status: MISSING — No dedicated dashboard route/page
- Backend status: — Wallet balance APIs exist but not aggregated under dashboard
- Database status: — Wallet and transaction data available
- API status: PARTIAL — Balance endpoint exists but not integrated into dashboard
- Admin integration status: — Not applicable
- Identified problems: Dashboard route/page not implemented; existing layout uses sidebar navigation
- Required changes: Create `/dashboard` route with user overview, wallet summary, recent transactions, market overview, quick actions

## B. User Profile (Route: /profile)

- Feature name: User Profile
- Existing file paths: apps/web/app/(user)/profile/, packages/types/src/user.ts
- Frontend status: PARTIAL — Profile page structure exists but needs data population
- Backend status: PARTIAL — User data APIs exist but profile data may not be fully integrated
- Database status: WORKING — Prisma schema has User model with all required fields
- API status: PARTIAL — User profile API endpoints exist but need verification
- Admin integration status: — Not applicable
- Identified problems: Profile page needs to fetch and display: username, UID, email, phone, VIP status, followers, following, account creation date
- Required changes: Implement profile data fetching, display user UID with copy functionality, show real account data from backend

## C. Assets (Route: /assets)

- Feature name: Assets
- Existing file paths: —
- Frontend status: MISSING — No /assets route implemented
- Backend status: — Wallet service has currency and balance data
- Database status: — Wallet and asset data in Prisma schema
- API status: MISSING — No asset list or details API
- Admin integration status: — Not applicable
- Identified problems: No assets page; need to implement asset listing with balances
- Required changes: Create /assets route with asset list, search, balances, deposit/withdrawal support status

## D. Exchange / Trading (Route: /exchange / /trading/home)

- Feature name: Exchange / Trading Terminal
- Existing file paths: apps/web/app/(user)/trading/, TradingTerminal.tsx, PositionsTable.tsx, MarketWatch.tsx, TradingChart.tsx, OrderForm.tsx
- Frontend status: WORKING — Trading terminal UI implemented with order book, charts, positions; home page now fetches instruments from backend `/trading/instruments` API
- Backend status: WORKING — Trading APIs functional with market data aggregation, order execution, portfolio management
- Database status: WORKING — Market data and position data in Prisma schema
- API status: WORKING — Order execution APIs exist; TypeScript compilation clean
- Admin integration status: — Trading management exists under admin panel
- Identified problems: None remaining in scope
- Required changes: None — frontend connected to backend; verified working

## E. Portfolio (Route: /portfolio or integrated into dashboard/trading)

- Feature name: Portfolio
- Existing file paths: — Portfolio integrated into trading terminal; standalone route not found
- Frontend status: PARTIAL — Portfolio value and allocation shown in trading terminal
- Backend status: PARTIAL — Portfolio calculations use account data but may have gaps
- Database status: — Positions and transaction history in Prisma schema
- API status: PARTIAL — Portfolio API may exist but need verification
- Admin integration status: — Not applicable
- Identified problems: Portfolio calculations must use actual account data; verify PnL calculations
- Required changes: Ensure portfolio calculations are driven by backend data; add standalone portfolio route if needed

## F. Orders & History (Route: /orders)

- Feature name: Orders & History
- Existing file paths: apps/web/app/(user)/trading/history/, order-related controllers
- Frontend status: PARTIAL — Order history UI exists but may have filtering/pagination issues
- Backend status: PARTIAL — Order APIs exist; status consistency between frontend/backend/DB needs verification
- Database status: WORKING — Order/status data in Prisma schema
- API status: PARTIAL — Order retrieval and history APIs exist
- Admin integration status: — Admin order monitoring exists
- Identified problems: Ensure order status is consistent between frontend, backend, and database; implement pagination and filters
- Required changes: Fix status consistency; add date/status filtering; implement proper pagination

## G. Main Wallet (Route: /wallet)

- Feature name: Main Wallet
- Existing file paths: apps/api/src/modules/wallet/, wallet.service.ts, withdrawal.service.ts
- Frontend status: PARTIAL — Wallet page exists but may have incomplete functionality
- Backend status: WORKING — Full wallet ledger service with deposit, withdrawal, balance management
- Database status: WORKING — Wallet model, transactions, ledger entries in Prisma schema
- API status: WORKING — Wallet balance and transaction APIs functional
- Admin integration status: — Admin wallet controllers exist
- Identified problems: Frontend wallet page may have missing features; verify all deposit/withdrawal functionality works end-to-end
- Required changes: Ensure frontend wallet page has: total balance, available balance, locked balance, currency selection, deposit/withdrawal history, transaction details, search and filters

## H. Deposit (Route: /wallet/deposit)

- Feature name: Deposit
- Existing file paths: apps/api/src/modules/wallet/, deposit controllers/service
- Frontend status: PARTIAL — Deposit page may exist but verification backend is key
- Backend status: PARTIAL — Deposit creation and verification logic exists
- Database status: — Deposit transactions in Prisma schema
- API status: PARTIAL — Deposit API endpoints exist
- Admin integration status: — Admin deposit review exists
- Identified problems: Do not mark deposit successful based only on frontend response; need proper backend verification
- Required changes: Implement proper deposit verification flow; ensure deposit status comes from backend, not frontend acknowledgment

## I. Withdrawal (Route: /wallet/withdraw)

- Feature name: Withdrawal
- Existing file paths: apps/api/src/modules/wallet/withdrawal.service.ts, withdrawal.service.ts
- Frontend status: PARTIAL — Withdrawal page UI exists
- Backend status: WORKING — Withdrawal orchestration with provider mock, idempotency, and ledger management
- Database status: WORKING — Withdrawal transactions in Prisma schema
- API status: WORKING — Withdrawal creation API with idempotency protection
- Admin integration status: — Admin withdrawal management exists
- Identified problems: Implement proper balance locking and release rules; prevent duplicate requests and replay attacks; OTP/security verification
- Required changes: Ensure: withdrawal method/currency selection, destination details, fee calculation, min/max limits, balance validation, OTP verification, duplicate prevention, proper status flow (pending/approved/rejected/completed)

## J. Royale Pay (Route: /royale-pay)

- Feature name: Royale Pay
- Existing file paths: —
- Frontend status: MISSING — No dedicated royale-pay route found
- Backend status: — Payment-related services exist under wallet and admin
- Database status: — Payment transactions in Prisma schema
- API status: — Payment APIs may reuse wallet endpoints
- Admin integration status: — Admin payment management exists
- Identified problems: First inspect whether payment product/infrastructure already exists; reuse existing payment infrastructure where appropriate
- Required changes: If actual Royale Pay module is missing, implement as separate payment management module; do not claim payment provider support unless integration completed and tested

## K. Sub Accounts (Route: /sub-accounts)

- Feature name: Sub Accounts
- Existing file paths: —
- Frontend status: MISSING — No /sub-accounts route implemented
- Backend status: MISSING — No sub-account service or controllers
- Database status: MISSING — No sub-account models in Prisma schema
- API status: MISSING — No sub-account APIs
- Admin integration status: — Not applicable
- Identified problems: If missing, implement proper sub-account system with create, view, edit, disable functionality
- Required changes: Implement sub-account system: create sub-account, view sub-accounts, edit, disable, role/permission assignment, access restrictions, transfer restrictions, parent account relationship

## L. Rewards Hub (Route: /rewards)

- Feature name: Rewards Hub
- Existing file paths: — Rewards infrastructure exists under affiliate/referral system
- Frontend status: PARTIAL — Rewards-related UI may exist in affiliate dashboard
- Backend status: PARTIAL — Reward service exists under referral module
- Database status: — Reward models in Prisma schema (referral rewards)
- API status: PARTIAL — Reward claim and eligibility APIs may exist
- Admin integration status: — Admin reward management exists under growth management
- Identified problems: Do not create fake rewards or fake claim success; every reward must have valid eligibility rule and backend verification
- Required changes: Implement reward eligibility rules, claim functionality, expiration dates, status; ensure backend verification for all claims

## M. Referral (Route: /referral)

- Feature name: Referral
- Existing file paths: apps/api/src/modules/referral/, affiliate.controller.ts, affiliate.service.ts, admin-affiliate.controller.ts
- Frontend status: PARTIAL — Referral dashboard/links exist but may have UI gaps
- Backend status: WORKING — Referral service with qualification rules, commission rules, payout history
- Database status: WORKING — Referral models in Prisma schema
- API status: WORKING — Referral link generation, registration tracking, statistics APIs
- Admin integration status: — Admin referral configuration exists
- Identified problems: Inspect existing referral and affiliate system before making changes; ensure referral attribution works correctly during registration; prevent self-referral, duplicate attribution, and fraudulent rewards
- Required changes: Verify: referral link/code display with copy functionality; referral registration tracking; referred users statistics; qualification and commission rules; reward payout history; admin configuration

## N. Account & Security (Route: /account/security)

- Feature name: Account & Security
- Existing file paths: —
- Frontend status: PARTIAL — Security UI may exist but features incomplete
- Backend status: PARTIAL — Security-related APIs may exist
- Database status: — Session, login history, OTP data in Prisma schema
- API status: PARTIAL — Change password, OTP, 2FA APIs may exist
- Admin integration status: — Not applicable
- Identified problems: Implement: change password, email verification, phone verification, OTP, 2FA, active sessions, login history, device management, logout other sessions
- Required changes: Complete all sensitive operations with backend verification; implement 2FA where supported; active session management; login history

## O. Activity (Route: /activity)

- Feature name: Activity
- Existing file paths: —
- Frontend status: MISSING — No dedicated /activity route found
- Backend status: — Activity logging exists under audit logs
- Database status: — Activity/logs data in Prisma schema
- API status: — Activity/API endpoints may exist
- Admin integration status: — Admin audit logs exist
- Identified problems: Implement dedicated /activity route with login activity, account activity, wallet activity, deposit/withdrawal/trading activity, security activity
- Required changes: Create /activity route with proper pagination and filters; use actual activity data from backend

## P. Settings (Route: /settings)

- Feature name: Settings
- Existing file paths: apps/web/app/(auth)/settings/, apps/web/app/(user)/layout.tsx
- Frontend status: PARTIAL — Settings UI exists but may have incomplete preference persistence
- Backend status: PARTIAL — Settings persistence APIs may exist
- Database status: — User preferences in Prisma schema (may need verification)
- API status: PARTIAL — Settings update APIs may exist
- Admin integration status: — Not applicable
- Identified problems: Settings must persist after reload and be associated with correct user; verify all preference categories
- Required changes: Verify: profile preferences, language, timezone, display preferences, notification preferences, security preferences persist correctly; implement backend persistence if missing

## Royale Play Games (OUT OF SCOPE)

All existing Royale Play games are marked OUT OF SCOPE — ROYALE PLAY and will not be modified.

## QUICK STATUS SUMMARY

| Category | Count | Status |
|----------|-------|--------|
| WORKING | ~45 features | Fully functional |
| PARTIAL | ~55 features | Incomplete, needs work |
| MISSING | ~30 features | Not implemented |
| OUT OF SCOPE — ROYALE PLAY | ~20 features | Excluded from modification |
| TOTAL | ~150 features | Audit complete |