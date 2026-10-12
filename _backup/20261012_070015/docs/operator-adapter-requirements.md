# Operator Adapter Requirements (REAL_MONEY — audit E1)

> **STATUS: NOT IMPLEMENTED — BY DESIGN.** No real, licensed operator adapter
> exists in this repository, and none may be added until the operator supplies
> the inputs in §3. This document is a specification only; it intentionally
> contains **no adapter code**.
>
> `IMPLEMENTED_REAL_OPERATOR_ADAPTERS`
> (`apps/api/src/modules/betting/betting-provider.factory.ts`) is an **empty
> `Map`** and must stay empty until a real adapter is reviewed and registered
> there. Until then the fail-closed gate `resolveRoyaleRealMoney()` returns
> `available: false`, so the Royale games (and the crash engine) stay in
> FREE_PLAY no matter what environment variables are set.

---

## 1. Why the map is empty

A provider **name** (`OPERATOR_PROVIDER=operator-http`) is never proof that a
real adapter exists. The gate therefore ignores names and only trusts the
registry. A stub/mock adapter registered there would let a bare env var turn on
real money with a fake operator behind it — exactly what the gate exists to
prevent. Never register a placeholder here.

---

## 2. The contract an adapter must implement

The application depends only on `OperatorProviderInterface`
(`packages/integrations/src/interfaces/operator-provider.interface.ts`). Money
is integer minor units; odds are decimal strings. An adapter must implement:

| Method | Purpose |
|--------|---------|
| `readonly name` | Stable provider identifier (must not be `mock`/`unconfigured`). |
| `authenticate()` | Authenticate against the operator and prepare the API client. |
| `getSports()` / `getCompetitions()` / `getEvents(sportExternalId?)` / `getEvent(eventExternalId)` | Catalog reads. |
| `getMarkets(eventExternalId)` / `getSelections(marketExternalId)` / `getOdds(marketExternalId)` | Market + price reads. |
| `placeBet(request)` | Submit a bet. **Must be idempotency-safe.** |
| `getBet(externalBetId)` | Read a placed bet's authoritative state (used for settlement reconciliation). |
| `getBalance(accountRef)` | Operator-side balance for an account reference. |
| `createDeposit(...)` / `getTransaction(...)` / `requestWithdrawal(...)` | Money movement through the operator. |
| `handleWebhook(event)` | Deliver / describe a **verified** provider webhook (settlement, bet results, transaction updates). |

**Settlement** is delivered primarily through `handleWebhook` (bet/settlement
events) and reconciled with `getBet`; there is no separate `settle` method —
settlement correctness must be provable from `getBet` + webhook payloads.

### Invariants every adapter must uphold

- **Fail closed:** any unknown/missing/malformed data results in a rejection,
  never a silent success.
- **Idempotency:** `placeBet` and money movement must be exactly-once under
  retries (correlate via the existing idempotency keys).
- **No local outcome authority:** the operator is the source of truth for real
  outcomes; the adapter never invents results.
- **Secrets:** credentials and webhook secrets are server-only, never logged and
  never returned by any API.

---

## 3. Inputs required from the operator (before any adapter is written)

Nothing can be built until the operator provides:

1. **License / jurisdiction** — the licence number, issuing regulator, and the
   exact jurisdictions/product scope the adapter will serve.
2. **Official API documentation** — the full operator API reference (auth,
   catalog, placeBet, settlement/webhooks, deposits/withdrawals), including
   error codes and rate limits.
3. **Sandbox credentials** — a sandbox/staging base URL plus API key/secret (or
   OAuth client credentials) to develop and test against. Production credentials
   are provided separately and never committed.
4. **Webhook signing details** — how operator webhooks are signed/verified
   (algorithm, header names, timestamp tolerance, replay protection) and the
   shared secret.
5. **Settlement semantics** — how/when bets settle, cancellation/void rules, and
   the exact fields that indicate a terminal outcome.
6. **Responsible-gambling / limits hooks** — any operator-side limit or
   self-exclusion signals the adapter must honour.

---

## 4. Adapter test checklist (to run before registering the adapter)

- [ ] Unit tests cover `authenticate`, `getEvents`, `placeBet`, `getBet`, and
      `handleWebhook` against recorded sandbox responses (success + every error
      path).
- [ ] `placeBet` is proven idempotent: the same request retried N times yields
      exactly one bet at the operator.
- [ ] Webhook signature verification rejects unsigned / tampered / replayed /
      stale payloads.
- [ ] Sandbox end-to-end: place bet -> operator settles -> webhook + `getBet`
      agree -> wallet reconciliation shows **zero drift**.
- [ ] Failure modes fail closed: operator timeout, 5xx, malformed body, and
      unknown event types never produce a fabricated outcome or a wallet
      movement.
- [ ] The adapter's `name` is registered in `IMPLEMENTED_REAL_OPERATOR_ADAPTERS`
      ONLY after the above passes and legal/licensing sign-off is recorded.
- [ ] `resolveRoyaleRealMoney()` is re-verified to still return
      `available: false` in every environment lacking the full set of
      prerequisites (see `docs/games/plinko-mines.md` §3).

---

## 5. Related documents

- `docs/games/plinko-mines.md` — REAL_MONEY prerequisites checklist and the
  provably-fair scheme for the Royale games.
- `apps/api/src/modules/betting/betting-provider.factory.ts` — the empty
  registry and the fail-closed capability check.
