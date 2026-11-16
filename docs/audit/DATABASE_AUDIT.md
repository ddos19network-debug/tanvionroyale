# TANVIONROYALE — DATABASE AUDIT

## 1. PRISMA SCHEMA OVERVIEW

- Schema path: `database/prisma/schema.prisma` (3,857 lines)
- Prisma client output: `apps/api/src/generated/prisma`
- Database: PostgreSQL (Neon host)
- Migration directory: `database/prisma/migrations/`

## 2. MONEY HANDLING CONVENTION

- All monetary amounts stored as integer minor units (cents)
- Odds stored as decimal strings to avoid precision drift
- Schema comment: "amounts use integer minor units (e.g. cents)"

## 3. CORE MODELS ANALYSIS

### 3.1 User Model
- Fields: id, email, emailVerified, passwordHash, username, firstName, lastName, phone, country, timezone, status, kycStatus, createdAt, updatedAt
- Status enum: PENDING, ACTIVE, SUSPENDED, BANNED, LOCKED, CLOSED
- KycStatus enum: NOT_STARTED, PENDING, VERIFIED, REJECTED, EXPIRED, MANUAL_REVIEW
- Relationships: Referral (self-referential), wallets, referralRewards (as referrer), referralRewards (as referred)

### 3.2 Wallet Model
- Fields: id, userId, currency, availableBalance, lockedBalance, status, createdAt, updatedAt
- Currencies: BDT, USD, EUR
- Ledger integration: One-to-many with WalletTransaction and LedgerEntry

### 3.3 WalletTransaction Model
- Fields: id, walletId, userId, type, status, amount, currency, reference, failureReason, idempotencyKey, createdAt, updatedAt
- TransactionStatusName: PENDING, PROCESSING, COMPLETED, CANCELLED, REVERSED
- Types: DEPOSIT, WITHDRAWAL, TRADE, REFERRAL, BONUS, FEE, ADJUSTMENT, REVERSE

### 3.4 LedgerEntry Model
- Fields: id, walletId, transactionId, direction (CREDIT/DEBIT), amount, availableBefore, availableAfter, lockedBefore, lockedAfter, reason, createdAt
- Tracks before/after states for audit trail. Direction (CREDIT/DEBIT) ensures double-entry bookkeeping.

## 4. MIGRATION HISTORY

- Total migrations: 30+ migration files in `database/prisma/migrations/`
- Naming convention: `YYYYMMDDHHMMSS_descriptive_name`
- Key migration phases:

| Phase | Migration Count | Focus Areas |
|-------|----------------|-------------|
| Phase 1-10 | ~10 migrations | Foundation: user, wallet, basic tables |
| Phase 11-15 | ~15 migrations | Referral, admin, payment modes, withdrawals |
| Phase 16 | ~5 migrations | Verification, banned users, support, notifications |
| Phase 17-20 | ~5 migrations | Casino, sports, crash, winhouse, jurisdiction |
| Phase 21-26 | ~6 migrations | Freeplay, responsible gambling, bigbang, royale |
| Phase 27+ | ~4 migrations | Recent additions |

### 4.1 Migration Concerns

1. **Duplicate/migration collision risk:** Multiple `.tmp-*` directories suggest prior repair attempts
2. **Migration order:** Must verify ascending order compatibility
3. **Data preservation:** Additive migrations only — no destructive changes allowed
4. **Prisma client regeneration:** After any schema change, client must be regenerated

## 5. INDEXES AND CONSTRAINTS

### 5.1 Unique Constraints
- User: email (unique), username (unique)
- Wallet: userId + currency composite unique
- WalletTransaction: userId + idempotencyKey unique
- Referral: referrerId + referredId composite

### 5.2 Indexes
- User: email, username, status, createdAt
- Wallet: userId, currency
- WalletTransaction: walletId, userId, status, createdAt
- Referral: referrerId, referredId, status

### 5.3 Foreign Keys
- Wallet.userId → User.id (one-to-one)
- WalletTransaction.walletId → Wallet.id
- WalletTransaction.userId → User.id
- Referral.referrerId → User.id
- Referral.referredId → User.id
- LedgerEntry.walletId → Wallet.id
- LedgerEntry.transactionId → WalletTransaction.id

## 6. FINANCIAL INTEGRITY CHECKS

### 6.1 Ledger Consistency
- Every wallet balance change MUST have corresponding ledger entry
- `availableBalance + lockedBalance` should equal historical sum of ledger mutations
- Idempotency key prevents duplicate transactions (userId + idempotencyKey unique)

### 6.2 Withdrawal Ledger Flow
1. **Reserve:** `availableBalance -= amount`, `lockedBalance += amount`, create PENDING transaction + ledger entry
2. **Provider call:** Delegate to payment provider (dev mock in dev mode)
3. **SUCCESS:** `lockedBalance -= amount`, create COMPLETED transaction + ledger entry (funds leave)
4. **FAILED:** `lockedBalance -= amount`, `availableBalance += amount`, create REVERSED transaction + ledger entry (release)
5. **PENDING/PROCESSING:** Keep funds reserved; await webhook confirmation

### 6.3 Deposit Ledger Flow
1. **Initiate:** Create PENDING deposit transaction
2. **Provider:** External payment provider processes
3. **Webhook:** Provider calls back with status
4. **COMPLETED:** `availableBalance += amount`, COMPLETED transaction + ledger entry
5. **FAILED:** Transaction stays PENDING/CANCELLED; funds not released until verified

## 7. SECURITY-RELATED MODELS

### 7.1 API Key Management
- Provider model has `apiKeyEnc` and `apiSecretEnc` (AES-256-GCM encrypted)
- `authMode` field (api-key | basic | none)
- `environment` field (sandbox/live gate)

### 7.2 Session / Login Tracking
- Models exist for session management and login history
- User status tracking (SUSPENDED/BANNED blocks sign-in)

### 7.3 OTP and Verification
- KycStatus enum for verification state tracking
- emailVerified and phoneVerified boolean fields on User

## 8. OUTSTANDING DATABASE CONCERNS

| Concern | Severity | Recommendation |
|---------|----------|----------------|
| Migration `.tmp-*` directories | MEDIUM | Review prior audit attempts; ensure no partial migrations applied |
| Multiple provider mapping models (legacy vs new) | LOW | Document distinction; ensure new integration type is used consistently |
| Candle/timeframe data model precision | MEDIUM | Verify decimal precision for financial calculations |

## 9. ADDITIONAL FILES

- `database/audit-db.cjs` / `audit-db.txt` — Prior database audit scripts
- `database/seed-local-admin-backup.ts` — Admin seed backup
- `database/seed-210-460.txt` — Large seed data (210-460 records)
- `database/scripts/promote-admin.ts` — Admin promotion utility
- `prisma-status-v*.txt` — Migration status tracking files (v2 through v7)