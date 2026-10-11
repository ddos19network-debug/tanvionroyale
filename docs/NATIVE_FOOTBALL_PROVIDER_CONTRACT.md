# Native Football — missing provider contract (authoritative blocker)

Date: 2026-10-09. Status: NO licensed sportsbook provider with a server-side
betting API has been selected. `IMPLEMENTED_REAL_OPERATOR_ADAPTERS` is EMPTY
(by design) and `BET_SLIP_ENABLED` is `false`.


## What is already built (provider-independent, verified against existing code)

- Backend betting lifecycle (betting.service.ts): auth, eligibility, gates,
  validation, stake limits, wallet reserve, idempotent submission, audit.
- Settlement (settlement.service.ts): atomic, exactly-once, snapshot-based.
- Webhook boundary (modules/partner/): HMAC-SHA256 + replay window, audited.
- Native Football board (components/football/ + /football): fixtures,
  competitions, markets, live/pre-match, staging, stake entry, odds confirm.
- Bet history (/my-bets): all statuses incl. VOID.

## Precise missing provider contract (none exist yet)

1. Provider selection: a named, licensed operator (the WinHouse iframe has no
   server-side betting API and cannot back native placement).
2. Official API docs: auth, feeds, placement, bet lookup, results/webhooks,
   signature scheme.
3. Sandbox access with credentials for end-to-end verification.
4. Production credentials + compliance sign-off.

## What must NOT happen until the contract arrives

- Do NOT register any adapter in IMPLEMENTED_REAL_OPERATOR_ADAPTERS.
- Do NOT flip BET_SLIP_ENABLED to true.
- Do NOT invent endpoints, payloads, credentials, or signatures.
- Do NOT display fabricated fixtures, odds, bets, or winnings in production.
