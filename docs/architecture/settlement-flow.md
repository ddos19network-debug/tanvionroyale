# Bet Settlement Flow (Phase 7)

> DEVELOPMENT NOTE: settlement results are currently supplied by an ADMIN
> boundary for development/testing. No real operator or money is involved.
> NO REAL MONEY.

## Lifecycle

```
Bet placement (Phase 5)
        ↓  wallet.reserveStake → captureStake (BET_STAKE debit)
Bet: ACCEPTED
        ↓  event finishes (LIVE → FINISHED) or event CANCELLED
Settlement result (per selection: WIN | LOSS | VOID | PUSH)
        ↓  SettlementService.settleBet / settleEvent  (ADMIN-only today)
Determine outcome (deterministic rules)
        ↓  WalletService.settleBetCredit  (BET_PAYOUT | BET_REFUND)
WalletTransaction + LedgerEntry (+ balance update)
        ↓
Bet → SETTLED (result, payout, settledAt) + BetSelection.result
        ↓
AuditLog (BET_WIN / BET_LOSS / BET_VOID, BET_PAYOUT / BET_REFUND, BET_SETTLED)
```

## Settlement rules (SINGLE only)

| Event state            | Provided result | Outcome | Wallet credit              | Amount              |
| ---------------------- | --------------- | ------- | -------------------------- | ------------------- |
| FINISHED               | WIN             | WIN     | `BET_PAYOUT`               | `potentialPayout`   |
| FINISHED               | LOSS            | LOSS    | none                       | 0                   |
| FINISHED               | VOID / PUSH     | VOID    | `BET_REFUND`               | `stake`             |
| CANCELLED              | (any)           | VOID    | `BET_REFUND`               | `stake`             |
| SCHEDULED/LIVE/SUSPENDED | (any)         | —       | rejected `UNSETTLEABLE_EVENT` | —                |

- Payout uses the **snapshot** (`stake`, `potentialPayout`) saved at bet
  placement. Frontend values are never used for money math.
- All amounts are integer minor units; no floating-point arithmetic.

## Wallet boundary

The settlement engine never touches `availableBalance` / `lockedBalance`.
All credits go through `WalletServiceInterface.settleBetCredit(...)` which
creates the `WalletTransaction`, the `LedgerEntry` and updates the wallet
inside the **caller's** Prisma transaction.

## Atomicity

`settleBet` runs in ONE Prisma interactive transaction:

1. `SELECT ... FOR UPDATE` on the Bet row (serializes concurrent settlements)
2. validate status/type/selection/event
3. resolve deterministic outcome
4. wallet credit (payout/refund) — if any
5. bet → `SETTLED` + selection result
6. audit events

Any failure rolls everything back: no SETTLED-without-payout, no
paid-without-SETTLED.

## Idempotency

- A locked bet that is already `SETTLED` short-circuits with
  `alreadySettled: true` — no second payout.
- The wallet credit key `settle:<betId>:<BET_PAYOUT|BET_REFUND>` is unique per
  `(userId, idempotencyKey)` (DB constraint) as a backstop against double-pay.

## Valid status transitions

- `ACCEPTED → SETTLED` ✔ (the only settlement transition)
- `SETTLED → *`, `REJECTED → SETTLED`, `CANCELLED → SETTLED` ✘
  (rejected with `INVALID_BET_STATE`, HTTP 409)

## Audit events

`BET_WIN` | `BET_LOSS` | `BET_VOID` | `BET_PAYOUT` | `BET_REFUND` |
`BET_SETTLED` (and `BET_SETTLEMENT_FAILED`-style failures are logged via the
service logger). No secrets (JWT, passwords, credentials, DATABASE_URL) are
ever written to audit payloads.

## Admin / provider boundary

- `POST /api/v1/admin/betting/bets/:id/settle` and
  `POST /api/v1/admin/betting/events/:id/settle` — JWT + `RolesGuard` +
  `@Roles('ADMIN', 'SUPER_ADMIN')` (matches the rest of the admin panel).
  Normal users can never settle.
- Settlement results come from the request body (per-selection
  WIN/LOSS/VOID/PUSH). A future licensed operator supplies the same shape via
  a verified webhook calling `SettlementService` directly — the bet model,
  wallet, ledger, audit and frontend stay unchanged.
