# Wallet / Transactions — Phase 6

This document describes the wallet/ledger foundation introduced in Phase 6.
Like Phase 5, it is **development/test infrastructure only**: there is NO
real-money deposit, NO real withdrawal, NO payment gateway (Stripe, PayPal,
crypto, bank, bKash, Nagad, …) and no real betting operator. Only clearly
marked **DEVELOPMENT ONLY / NO REAL MONEY** mock providers exist.

## Money representation

- All amounts are integer **minor units** (e.g. poisha for BDT):
  `10000` = `BDT 100.00`. The type is `MinorUnit` from `@tanvion-royale/types`.
- Floating-point arithmetic for money is forbidden. All math is integer math
  performed **server-side**. The frontend never sends balance, amount limits,
  currency decisions, transaction status or payment results that the backend
  trusts — everything is recomputed and revalidated.

## Flow overview

```
User
 ↓
POST /wallet/deposits | /wallet/withdrawals | POST /bets
 ↓
Wallet (per user + currency, availableBalance / lockedBalance)
 ↓
WalletService (database transaction + row lock + idempotency)
 ↓
WalletTransaction (PENDING → PROCESSING → COMPLETED | FAILED | CANCELLED)
 ↓
LedgerEntry (immutable, append-only, balanceBefore/balanceAfter)
 ↓
DepositProviderInterface / WithdrawalProviderInterface  (DevMock* today)
 ↓
Future licensed payment provider / betting operator (plug-in only)
```

## Domain model (new, additive)

| Model | Purpose |
| --- | --- |
| `Wallet` | One wallet per `(userId, currency)`. `availableBalance`, `lockedBalance` (minor units), `status` (`ACTIVE | FROZEN | CLOSED`). |
| `WalletTransaction` | One financial mutation request: `type` (`DEPOSIT | WITHDRAWAL | BET_STAKE | BET_PAYOUT | BET_REFUND | ADJUSTMENT`), `status`, signed `amount` (credit `> 0`, debit `< 0`), `idempotencyKey`, `reference`. Unique `(userId, idempotencyKey)`. |
| `LedgerEntry` | Immutable, append-only row per balance change: `walletId`, `transactionId`, `direction` (`CREDIT | DEBIT`), `amount`, `availableBefore/After`, `lockedBefore/After`, `reason`. History is never edited or deleted by application code. |

Indexes: `Wallet(userId)`, `WalletTransaction(userId)`, `(walletId)`,
`(status)`, `(createdAt)`, unique `(userId, idempotencyKey)`,
`LedgerEntry(walletId, createdAt)`, `(transactionId)`.

## Ledger rules

1. Every balance mutation creates exactly one `LedgerEntry` inside the same
   database transaction as the balance update.
2. Entries record previous balance, amount, direction, resulting balance
   (available and locked), the owning transaction, the user (via wallet),
   a reason and the timestamp.
3. No code path updates `availableBalance`/`lockedBalance` directly outside

## Transaction states

```
PENDING ──> PROCESSING ──> COMPLETED
   │              └────────> FAILED
   └───────────────────────> CANCELLED   (withdrawal only, before processing)
COMPLETED ──> REVERSED                  (modelled; used by future settlement)
```

- Only backend/provider confirmation can move a deposit to `COMPLETED`.
  The frontend has no endpoint to confirm or complete a transaction.
- Withdrawals reserve funds first: `available -= amount`, `locked += amount`.
  - `COMPLETED`: `locked -= amount` (funds leave the wallet).
  - `FAILED`/`CANCELLED`: `locked -= amount`, `available += amount` (release).
- `availableBalance` can never go below zero (checked under a row lock:
  `SELECT ... FOR UPDATE` inside a Prisma interactive transaction).

## Idempotency

Every financial mutation (deposit, withdrawal, wallet adjustment, bet stake)
requires a client-generated `idempotencyKey`. The
`@@unique([userId, idempotencyKey])` constraint on `WalletTransaction` makes
duplicate submission impossible:

- Same user + key → the existing transaction is returned (`duplicate: true`),
  never re-charged or re-credited.
- Concurrent duplicates → one insert wins (`P2002`), the loser reads and
  returns the winner's row.
- Bet stakes reuse the bet's `idempotencyKey`, so a bet and its stake share
  one idempotency identity.

## Security boundaries

- All wallet endpoints require JWT (global `JwtAuthGuard`); `userId` always
  comes from the token (`@CurrentUser`), never from the body.
- Ownership: a user can only read/act on their own wallet and transactions;
  cross-user access returns `404`/`403`.
- Amount/currency/limits are validated server-side (`wallet.config.ts`):
  min/max deposit and withdrawal, supported currencies (BDT/USD/EUR),
  wallet `ACTIVE` status check, insufficient-funds protection.
- Throttling: wallet mutation routes carry stricter per-route limits.
- Audit events (existing `AuditLog` system): `WALLET_CREATED`,
  `DEPOSIT_CREATED`, `DEPOSIT_COMPLETED`, `DEPOSIT_FAILED`,
  `WITHDRAWAL_CREATED`, `WITHDRAWAL_COMPLETED`, `WITHDRAWAL_FAILED`,
  `WITHDRAWAL_CANCELLED`, `WALLET_ADJUSTMENT`. No passwords, JWTs, payment
  credentials or secrets are ever logged. No card/CVV/bank data is stored
  anywhere.

   `WalletService.applyMutation` — arbitrary balance editing is impossible.
4. Ledger rows are never updated or deleted.

## Provider abstraction

`packages/integrations` defines (next to `OperatorProviderInterface`):

````ts
interface DepositProviderInterface {
  initDeposit(req: DepositRequest): Promise<DepositProviderResult>;
  getDepositStatus(externalTransactionId: string): Promise<ProviderTransactionStatus>;
}
interface WithdrawalProviderInterface {
  requestWithdrawal(req: WithdrawalRequest): Promise<WithdrawalProviderResult>;
  getWithdrawalStatus(externalTransactionId: string): Promise<ProviderTransactionStatus>;
}
````

`DevMockDepositProvider` / `DevMockWithdrawalProvider` implement them for
development only � they complete (or fail, via `simulateFailure`) instantly
with no network and no money. A future licensed payment partner plugs in by
implementing the same interfaces; frontend, betting domain, auth, database
schema, transaction history and ledger remain unchanged.

## Mock provider limitations

- `DevMock*` providers are synchronous and always succeed unless
  `simulateFailure` is set (used by tests and the `WALLET_MOCK_FAILURE`
  env flag).
- They clearly advertise `DEVELOPMENT ONLY / NO REAL MONEY` and the UI
  displays a "Development / Mock Payment" notice � the product must never
  imply real money is supported yet.

## Betting integration

`WalletServiceInterface` (the Phase 5 boundary) is **extended, not replaced**:

````ts
getAvailableBalance(userId): Promise<MinorUnit>;
reserveStake(userId, amount, currency, idempotencyKey): Promise<StakeReservation>;
captureStake(userId, idempotencyKey): Promise<void>;
releaseStake(userId, idempotencyKey): Promise<void>;
````

Placement flow: validate ? `reserveStake` (locks funds; on
`INSUFFICIENT_FUNDS` the bet is rejected) ? provider submission ? bet row
created ? `captureStake` (locked funds become a completed `BET_STAKE`
transaction). Provider rejection or any failure after reservation calls
`releaseStake`, so **no money can be lost**. Settlement can later post
`BET_PAYOUT` / `BET_REFUND` transactions without redesigning the wallet.

The dev-only `DevMockWalletService` is kept for Phase 5 compatibility; the
betting module now wires the real ledger-backed `WalletService` behind the
same token.

## Admin capability (minimal)

`POST /admin/wallets/:userId/adjustments` (RBAC `ADMIN`): signed adjustment
with a mandatory reason, idempotency key, ledger entry, wallet-status check
and `WALLET_ADJUSTMENT` audit event. No arbitrary balance editing exists.

## Future real-money integration boundary

To integrate a licensed payment provider later, one must only:

1. Implement `DepositProviderInterface` / `WithdrawalProviderInterface`.
2. Register the adapter in `WalletModule` behind the existing DI tokens.
3. Add provider webhook verification + confirmation handling (the
   transaction state machine already supports async `PENDING ? COMPLETED`).

No rewrite of the frontend wallet, betting domain, authentication, database
architecture, transaction history or ledger is required.
