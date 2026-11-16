# TANVIONROYALE — Database Audit
**Audit Date:** 2026-11-14
**Database Engine:** PostgreSQL
**ORM Engine:** Prisma 5.22.0 (`database/prisma/schema.prisma`)

---

## 1. Schema Summary

- **Total Relational Models**: 88
- **Total Migrations**: 43 migrations applied in `database/prisma/migrations/`
- **Core Domains Covered**:
  1. **User Identity & Security**: `User`, `AuthIdentity`, `OtpCode`, `Verification`, `Session`, `Role`, `Permission`, `UserRole`, `RolePermission`, `UserPermission`, `SecurityEvent`.
  2. **Wallet & Ledger**: `Wallet`, `WalletTransaction`, `LedgerEntry`, `PaymentMethod`, `PaymentGatewayConfig`, `ManualDepositRequest`, `WithdrawalRequest`, `PaymentWebhookEvent`.
  3. **Trading & Markets**: `TradingAccount`, `TradingInstrument`, `TradingOrder`, `TradingPosition`, `TradingTransaction`, `TradingWallet`, `TradingLedgerEntry`, `TradingAsset`, `TradingPair`, `MarketPrice`, `MarketCandle`, `TradingOrderExt`, `TradingFillExt`, `TradingFeeExt`, `TradingWatchlistExt`, `ProviderConnection`, `TradingWebhookEvent`, `TradingCompliance`, `TradingReconciliation`, `TradingAuditLog`, `TradingConfiguration`.
  4. **Sportsbook & Betting**: `Sport`, `Competition`, `Event`, `Market`, `Selection`, `Odds`, `Bet`, `BetSelection`, `PartnerProvider`, `ProviderMapping`.
  5. **Casino & In-House Games**: `Game`, `GameAvailability`, `GameSession`, `GameResult`, `CrashRound`, `CrashBet`, `CrashSettlement`, `CrashFreePlayWallet`, `CrashFreePlayTransaction`, `CrashSequenceState`, `RoyaleAceRound`, `RoyaleAceConfigVersion`, `RoyalePlinkoRound`, `RoyaleMinesRound`, `RoyaleSettlement`, `FreePlaySlotRound`, `CasinoCategory`, `CasinoGame`, `CasinoSession`, `CasinoTransaction`, `BigBangTransaction`, `WinHouseSession`, `WinHouseTransaction`.
  6. **Referral & Affiliate**: `Referral`, `ReferralEvent`, `ReferralReward`, `ReferralProgramSettings`, `AffiliateClick`, `AffiliateMonthlyTarget`, `AffiliateContentBlock`, `AffiliateProfile`.
  7. **Support & Notifications**: `Notification`, `NotificationDevice`, `NotificationDelivery`, `SupportTicket`, `SupportMessage`.
  8. **Responsible Gaming & Compliance**: `SelfExclusion`, `PlayLimit`, `JurisdictionRule`, `JurisdictionAuditLog`, `GlobalGameSwitch`.

---

## 2. Integrity & Financial Invariant Audit

### 2.1 Double-Entry Ledger Discipline
- The `Wallet` model stores `balance` and `frozenBalance` in minor currency units (e.g., cents, satoshis).
- Every financial mutation requires an atomic insertion into `WalletTransaction` and `LedgerEntry`.
- Audited models show zero arbitrary balance updates without an accompanying transaction record.

### 2.2 Foreign Key & Unique Constraints
- Indexes exist on high-frequency lookup keys:
  - `User.email` (unique)
  - `User.phone` (unique)
  - `Session.tokenHash` (unique)
  - `Wallet.userId_currency` (unique compound key)
  - `TradingAccount.userId`
  - `Bet.userId`, `Bet.status`
  - `Event.sportId`, `Event.status`, `Event.startTime`

### 2.3 Migration Preservation Rule
- Existing migration files in `database/prisma/migrations/` MUST NEVER be modified or re-generated destructively.
- All future database adjustments must be purely additive SQL migrations.
