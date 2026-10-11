# TANVION ROYALE — Plinko & Mines

Server-authoritative original games (Plinko + Mines) built on the ONE wallet
ledger (REAL_MONEY) and the ONE free-play points ledger (FREE_PLAY).

> **REAL_MONEY IS DISABLED BY DEFAULT.** The fail-closed gate
> `resolveRoyaleRealMoney()` (`apps/api/src/modules/royale/royale.config.ts`)
> returns `available: false` until a genuine, licensed operator adapter exists.
> By default both games serve **FREE_PLAY points only** (currency `FREEPLAY`),
> clearly separated from the real `Wallet`. Nothing in `.env.example` or
> `render.yaml` enables real money.

---

## 1. Provably-fair scheme

All randomness comes from `crypto.randomBytes` (CSPRNG) + HMAC-SHA256.
`Math.random()` is **never** used for an authoritative result
(`apps/api/src/modules/royale/royale-fair.ts`).

### 1.1 Common seed material (generated per round, server-side)

| Value        | Definition                                        | Published |
|--------------|---------------------------------------------------|-----------|
| `serverSeed` | 32 CSPRNG bytes, hex (64 chars)                   | after settle (Plinko: immediately; Mines: at settlement) |
| `clientSeed` | 16 CSPRNG bytes, hex (32 chars)                   | yes       |
| `commitment` | `SHA-256(serverSeed)` (hex)                       | **before play** |

The commitment proves the seed could not change once betting began.

### 1.2 Plinko path (one bit per row)

```
bit_i   = firstByte( HMAC-SHA256(key = serverSeed,
                                 `${clientSeed}:${nonce}:row:${i}`) ) & 1   // 0 = left, 1 = right
path    = [bit_0, ..., bit_{rows-1}]
binIndex = sum(path)                       // number of right moves
```

The round settles **atomically at creation**, so the revealed `serverSeed` is
stored on the row immediately and anyone can re-derive the exact path.

### 1.3 Mines positions (deterministic Fisher–Yates from an HMAC stream)

```
swap_i  = big-endian uint64 of HMAC-SHA256(key = serverSeed,
                                          `${clientSeed}:${nonce}:swap:${i}`)
j       = swap_i % (i + 1)
// shuffle tiles[0..gridSize-1] from i = gridSize-1 down to 1: swap(tiles[i], tiles[j])
mines   = the FIRST minesCount entries of the shuffled array (then sorted)
```

The `serverSeed` is kept AES-256-GCM encrypted at rest (`serverSeedEnc`) and is
published **only** at settlement (cash-out, bust, or void). The modulo bias of
the `%` reduction is `<= gridSize / 2^64` (negligible for `gridSize <= 36`) and
is documented.

### 1.4 Independent verification

`verifyPlinkoRound(...)` and `verifyMinesRound(...)` (same file) re-derive
everything from the revealed material and compare against what was stored.

**Plinko** — inputs: `serverSeed, clientSeed, nonce, rows, storedHash, storedPath, storedBinIndex`
1. `commitmentHash = SHA-256(serverSeed)` — must equal `storedHash`.
2. Re-derive `path` with the formula in §1.2 — must equal `storedPath` element-by-element.
3. `binIndex = sum(path)` — must equal `storedBinIndex`.
4. `verified` is true only when all three hold.

**Mines** — inputs: `serverSeed, clientSeed, nonce, gridSize, minesCount, storedHash, storedRevealed`
1. `commitmentHash = SHA-256(serverSeed)` — must equal `storedHash`.
2. Re-derive `positions` with the formula in §1.3 — must equal `storedRevealed`
   (when the round settled and the mines were published).
3. `verified` is true only when both hold.

Round-trip endpoints: `GET /games/royale/plinko/rounds/:id/verify` and
`GET /games/royale/mines/rounds/:id/verify`.


---

## 2. RTP & payout tables

All money math is **integer**: stakes/payouts are minor units, multipliers are
**basis points** (`bp`) where `10000 bp = 1.00x`. Payouts ALWAYS floor:

```
payout = floor(stake * multiplierBp / 10000)
```

Flooring (and the multiplier cap) can only ever pay out **less**, so rounding
never inflates RTP. Target RTP is `ROYALE_RTP_BP` (default `9900` = 99.00%),
clamped to `(0, 10000]`.

### 2.1 Plinko table (rows `n`, risk skew `a`, target RTP `r`, cap `c`)

```
p_k  = C(n, k) / 2^n                    // exact landing probabilities
S    = sum_k p_k^(1 - a)                // for a = 1, S = n + 1 exactly
f    = (r / 10000) / S                  // normalizer so pre-rounding EV = r
bp_k = min(c, floor(10000 * f * p_k^(-a)))
EV(bp) = sum_k p_k * bp_k / 10000 <= r / 10000
```

Risk skew `a`: **LOW 0.8** (flatter, centre pays more), **MEDIUM 1.0**
(binomial-fair shape), **HIGH 1.25** (edges pay more, centre pays less).
Exact tables per `(rows, risk)` are served by
`GET /games/royale/plinko/payout-table?rows=..&risk=..` (server-computed and
sanity-checked with `checkPlinkoTable` before ever being returned).

### 2.2 Mines table (grid `g`, mines `m`, safe picks `k`, target RTP `r`)

```
P(survive k) = prod_{i=0..k-1} (g - m - i) / (g - i)
bp_k         = min(c, floor( r * A / B )),   A = prod_{i<k}(g - i), B = prod_{i<k}(g - m - i)
```

Computed with `BigInt` — exact, no float drift. A cash-out at `k = 0` is
defined as exactly `1.00x` (`10000 bp`). The sequence is strictly increasing in
`k`, and the EV of cashing out after `k` safe picks equals `r / 10000` before
flooring.

---

## 3. REAL_MONEY prerequisites checklist

Real money only activates when **every** item below is satisfied simultaneously
(the in-repo gate enforces items 1–4; item 5 is a legal/operational sign-off):

- [ ] **Licensed operator adapter (E1).** A real adapter class implementing
      `OperatorProviderInterface` (auth/getEvents/placeBet/settle) is registered
      in `IMPLEMENTED_REAL_OPERATOR_ADAPTERS`
      (`betting-provider.factory.ts`) — that map is **intentionally empty** today.
      See `docs/operator-adapter-requirements.md`.
- [ ] **KYC + age.** Every player is `ACTIVE` and `kycStatus = VERIFIED`, with a
      valid `dateOfBirth` proving they are `>= ROYALE_MIN_AGE` (default 18,
      never configurable below 18). Enforced by `RoyaleEligibilityService`.
- [ ] **Responsible-gambling controls.** Self-exclusion and play limits
      (`SelfExclusion` / `PlayLimit`) are live and enforced by
      `ResponsibleGamblingService.assertCanStake` before any reservation.
- [ ] **Payment provider.** A real provider is configured for BOTH deposits and
      withdrawals (`PAYMENT_PROVIDER` + URL/key/secret), and the runtime is
      `NODE_ENV=production` with `ROYALE_MODE=REAL_MONEY` and
      `ROYALE_REAL_MONEY_ALLOWED=true`.
- [ ] **Reconciliation = zero drift.** `GET /admin/royale/reconcile` reports
      `matches.realMoneyWins === true` (settlement payout totals agree with the
      wallet ledger) for a sustained period before go-live.
- [ ] **Legal / licensing sign-off** for the target jurisdiction(s).

Until the operator adapter (E1), payment credentials (D1) and legal sign-off are
supplied by the operator, **leave `ROYALE_MODE=FREE_PLAY` and
`ROYALE_REAL_MONEY_ALLOWED=false`** — the gate stays closed regardless.

---

## 4. Responsible gambling (summary)

- Lowering a limit or self-excluding is **immediate**.
- Raising a limit or ending an exclusion only takes effect after a cooling-off
  delay (`ROYALE_RG_COOLING_OFF_HOURS`, default 24h).
- A **PERMANENT** exclusion can never be lifted by the player (admin override
  only).
- Only **new** REAL_MONEY stakes are gated. An already-reserved Mines round can
  always be finished/cashed out — a player is never trapped.
