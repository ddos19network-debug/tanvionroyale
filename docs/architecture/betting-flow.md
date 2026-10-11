# Betting / Wagering — Phase 5

This document describes the betting domain introduced in Phase 5. It is
**development/test infrastructure only**. `MockProvider` never represents a
licensed operator, never touches real funds, and there is no real-money
deposit/withdrawal or payment gateway in this phase.

## Domain model

```
User
  └── Bet
        ├── BetSelection (normalized link = immutable odds snapshot)
        │       ├── Event.name
        │       ├── Market.name
        │       ├── Selection.name
        │       └── priceAtPlacement + oddsVersion
        └── stake / potentialPayout / currency / providerReference
```

Provider-facing transfer objects still live in `packages/integrations`
(`OperatorProviderInterface`). TANVIONROYALE writes its own domain tables
(Event / Market / Selection / Odds / Bet / BetSelection) as the source of truth.

## Money & odds representation (documented format)

- **Money** is integer **minor units** (e.g. poisha for BDT). Never floats.
  - `MIN_STAKE = 100` → `1.00 BDT`
  - `MAX_STAKE = 100000` → `1000.00 BDT`
  - Configurable via `BETTING_MIN_STAKE` / `BETTING_MAX_STAKE` (see
    `apps/api/src/modules/betting/betting.config.ts`).
- **Odds** are **decimal strings**, up to 2 decimal places:
  `price := /^\d+(\.\d{1,2})?$/` (e.g. `"1.85"`, `"2"`, `"3.4"`).
- **Potential payout** is computed with integer arithmetic:
  `potentialReturn(minor) = floor(stake * numerator / denominator)`.
  Example: `stake=1000` at `"1.85"` → `floor(1000 * 185 / 100) = 1850`.
  All calculations live in `apps/api/src/modules/betting/odds.util.ts` and are
  unit-tested.

## Event / Market / Selection statuses

- Event: `SCHEDULED | LIVE | SUSPENDED | FINISHED | CANCELLED`
  - Displayed publicly when the owning game is gambling-available and the event
    is `SCHEDULED | LIVE | SUSPENDED`.
  - Bettable only when `SCHEDULED | LIVE`.
- Market: `OPEN | SUSPENDED | CLOSED` (bettable only when `OPEN`).
- Selection: `ACTIVE | INACTIVE`.

## Bet lifecycle

```
PENDING
  ├── ACCEPTED ──> SETTLED
  ├── REJECTED
  └── CANCELLED
```

Placement either fails (no bet row) or creates a bet in `ACCEPTED` (Phase 5 has
no settlement engine, so `PENDING`/`SETTLED`/`CANCELLED`/`VOID` are modelled
but not yet transitioned by code). No arbitrary status changes are allowed —
transitions are driven by explicit flows only.

## Idempotency

`POST /bets` is deduplicated by `(userId, idempotencyKey)` (unique DB index).
- The same key + user re-uses the existing bet and returns
  `{ bet, duplicate: true }`.
- A concurrent duplicate submit raising `P2002` is resolved to the existing row.
- The key is forwarded to the provider so the operator is also idempotency-safe.

## Betting availability (server-side gate)

A bet is accepted only when **all** of these hold (computed in
`BettingService.placeBet`; never trusted from the frontend):

```
Sport ACTIVE
AND Game ACTIVE
AND GameAvailability.gamblingEnabled = true
AND ProviderMapping ACTIVE
AND Event available (SCHEDULED | LIVE)
AND Market OPEN
AND Selection ACTIVE (with current odds)
AND stake within [MIN, MAX]
AND user ACTIVE
AND wallet balance >= stake
```

If any condition fails the bet is rejected with a structured error code.

## Error codes

`INVALID_STAKE`, `EVENT_UNAVAILABLE`, `MARKET_SUSPENDED`,
`SELECTION_UNAVAILABLE`, `ODDS_CHANGED`, `GAMBLING_DISABLED`,
`PROVIDER_UNAVAILABLE`, `BET_REJECTED`, `INSUFFICIENT_BALANCE`,
`DUPLICATE_REQUEST`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`,
`VALIDATION_ERROR`. The global `AllExceptionsFilter` preserves the existing
`statusCode`/`message` shape and adds `code`.

## Odds snapshot

When a bet is accepted, each selection's reviewed price and version are frozen
into `BetSelection.priceAtPlacement` / `oddsVersion`. Later odds movement never
changes an existing bet — settlement always uses the snapshot.

## Wallet boundary

The wallet ledger, deposits and withdrawals ARE implemented (Phase 6+).
`BettingService` depends on a `WalletServiceInterface`; the module binds the
ledger-backed `WalletService` (WalletModule) behind the same token, so stakes
are reserved/captured/released and payouts credited through the real ledger.
A clearly-marked `DevMockWalletService` (100.00 BDT mock balance) remains only
for unit tests — never for the running application.

## Frontend bet slip

The bet slip (`apps/web/components/betting/`) is client-only **temporary**
state (single selection in Phase 5). It supports add/remove, stake entry,
odds display, potential payout and clear. It is never authoritative — the
backend revalidates everything and surfaces `ODDS_CHANGED`,
`MARKET_SUSPENDED`, `SELECTION_UNAVAILABLE`, `PROVIDER_UNAVAILABLE`,
`BET_REJECTED` and `INSUFFICIENT_BALANCE` states to the user.