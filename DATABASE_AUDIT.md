# TANVIONROYALE — DATABASE AUDIT
**Phase:** Phase 3: Core Application Development  
**Date:** November 2026  
**Canonical Schema Path:** `D:\tanvionroyale\database\prisma\schema.prisma`  

---

## 1. Database Architecture & Engine
- **RDBMS:** PostgreSQL 15+
- **ORM:** Prisma ORM 5.x with generated client in `apps/api/src/generated/prisma`
- **Total Relational Models:** 84 models
- **Migration Strategy:** Forward-only Prisma Migrate with SQL migrations in `database/prisma/migrations/`

---

## 2. Core Domain Data Models

### User, Identity & Authentication
- `User`: Primary account record (`id`, `uid`, `username`, `email`, `phone`, `status`, `kycStatus`, `vipLevel`, `vipTitle`, `referralCode`).
- `AuthIdentity`: Multi-provider authentication identities (Local password hash, Google OAuth, Telegram, SMS OTP).
- `Session`: Active JWT session revocation and tracking.
- `Role`, `Permission`, `UserRole`, `RolePermission`: Complete granular RBAC model supporting `ADMIN`, `OPERATOR`, `COMPLIANCE`, `SUPPORT`, `USER`.

### Financial Ledger & Main Wallet
- `Wallet`: Multi-currency account balance table (`userId`, `currency` [BDT, USD, EUR], `availableBalance`, `lockedBalance`).
- `WalletTransaction`: Financial transaction ledger (`amount`, `currency`, `type` [DEPOSIT, WITHDRAWAL, BET_STAKE, BET_PAYOUT, ADJUSTMENT], `status`, `reference`, `idempotencyKey`).
- `LedgerEntry`: Double-entry bookkeeping ledger ensuring total credit = total debit balance invariant.
- `ManualDepositRequest`: User proof submission (`referenceId`, `proofDataUrl`, `amount`, `currency`, `methodCode`, `status`, `reviewedBy`, `reviewedAt`).
- `WithdrawalRequest`: Payout reservation model (`amount`, `currency`, `methodCode`, `accountNumber`, `accountName`, `bankName`, `status` [PENDING, COMPLETED, REJECTED]).
- `PaymentMethod` & `PaymentGatewayConfig`: Configurable payment gateways and payment methods with dynamic min/max deposit/withdrawal limits.

### Trading & Exchange
- `TradingAccount`: Institutional trading account profile with virtual balance and currency settings.
- `TradingInstrument`: Tradable instruments catalog (`symbol`, `name`, `type` [CRYPTO, STOCK, FOREX, COMMODITY], `currentPrice`, `isEnabled`, `pipSize`, `contractSize`).
- `TradingOrder`: Order lifecycle records (`side` [BUY, SELL], `type` [MARKET, LIMIT, STOP], `quantity`, `priceFilled`, `status` [PENDING, FILLED, CANCELLED]).
- `TradingPosition`: Open margin positions (`side`, `quantity`, `avgEntryPrice`, `liquidationPrice`, `unrealizedPnl`).
- `TradingTransaction`: Cash flows and realized profits from closed margin trades.

### Gaming & Free Play Isolation
- `CrashFreePlayWallet` & `FreePlaySlotRound`: Strictly isolated virtual Free Play points architecture without real currency debit.
- `Bet` & `BetSelection`: Sportsbook betting slips and odds records.
- `AuditLog`: System-wide audit trail recording administrative actions, approvals, and balance modifications.

---

## 3. Financial Integrity & Invariants
1. **No Frontend Direct Edits:** Frontend code never updates database balances directly.
2. **Atomic Transactions:** All wallet deductions and additions execute within PostgreSQL serializable transactions (`prisma.$transaction`).
3. **Idempotency Protection:** Unique constraints on `idempotencyKey` prevent duplicate deposit or withdrawal submissions.
4. **Fund Reservation on Withdrawal:** When a withdrawal request is submitted, funds are immediately moved from `availableBalance` to `lockedBalance`. If rejected by an admin, funds are returned to `availableBalance`; if approved, funds are debited from `lockedBalance`.
