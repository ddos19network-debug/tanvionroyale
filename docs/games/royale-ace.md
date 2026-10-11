# Royale Ace (`royale-ace`)

> Original TANVION ROYALE game. 5 reels × 4 rows, **1024 ways to win**, cascading
> card slot with a golden→wild mechanic, a rising cascade multiplier ladder and a
> free-spins feature. Server-authoritative, provably fair, REAL_MONEY (behind the
> existing gates) and FREE_PLAY.

All names, symbols, art direction, copy and mechanics here are original to
TANVION ROYALE. No third-party game's assets, name, paytable layout or UI are
used or referenced.

---

## 1. Rules

### Grid and ways-to-win

- 5 reels × 4 rows (20 visible positions).
- **1024 ways**: a paying combination is the same symbol (or a WILD substituting
  for it) on reel 0 and on every consecutive reel left-to-right, up to 3/4/5
  reels. Ways multiply: a symbol appearing 2× on reel 0, 3× on reel 1 and 1× on
  reel 2 pays 2×3×1 = 6 ways.
- Only runs of **3+** reels pay. Several symbols can win simultaneously; WILDs are
  shared between them.

### Symbols

| Kind  | Symbols                                   | Notes                                   |
| ----- | ----------------------------------------- | --------------------------------------- |
| Low   | ♠ Spade, ♥ Heart, ♦ Diamond, ♣ Club       | Most frequent                           |
| High  | J, Q, K, A                                | Progressively rarer, pay more           |
| Wild  | ★ (gold)                                  | Substitutes for every card symbol, **never** Scatter |
| Scatter | ✦ (fuchsia)                            | 3+ anywhere triggers Free Spins         |

Any card symbol (low or high) can also land as a **GOLDEN** variant (a gold
border). Golden is a modifier on a normal card — Wild and Scatter are never
golden.

### Cascade

1. Evaluate all ways wins on the current grid.
2. Remove every winning cell. GOLDEN cards that were part of a win are marked to
   become **WILD** on the next step (`goldenToWild`, config).
3. Survivors drop to the bottom of their reel; new symbols fill from the top.
4. Positions marked golden→wild re-enter as WILD.
5. Repeat from step 1. Each consecutive cascade raises the multiplier along the
   ladder. The cascade ends when a step produces no win (or the configured
   `maxCascadeStepsPerSpin` safety bound is hit).

### Multiplier ladder

Base game ladder (config `baseLadderBp`): **×1 → ×2 → ×3 → ×5** (last value
repeats for deeper cascades).

Free-spin ladder (config `freeSpinLadderBp`) is double: **×2 → ×4 → ×6 → ×10**.

The ladder multiplies the **way wins only**. The whole-group Scatter pay is never
multiplied.

### Scatter and Free Spins

- 3+ Scatters anywhere on the initial drop of a spin trigger Free Spins.
- Award table (config `freeSpins.awardByScatterCount`): 3 → 8 spins, then +2 per
  extra Scatter (4 → 10, 5 → 12, …). Index by Scatter count; the last table entry
  repeats for higher counts.
- Retriggers are allowed inside the feature and extend the queue.
- One stake is debited for the whole round; all free-spin wins are credited once
  at the end (`freeSpins.creditMode: END_OF_ROUND`).
- The feature is bounded by `freeSpins.maxSpinsPerRound` (default 250).

### Caps

- Per-round win cap: `maxWinBp` (default 5000× = 500000 bp). The credited payout
  is `floor(stake × min(totalPayBp, cap) / 10000)`.
- Per-player daily win cap per currency: `dailyWinCapMinorUnits` (enforced by the
  responsible-gambling / eligibility layer, not the game math).
- `effectiveMaxWinBp` additionally clamps the cap so `floor(stake × cap / 10000)`

---

## 2. Money flow (REAL_MONEY)

Gate order on **every** spin (fail-closed; a rejection creates no round, no ledger
row and no wallet reservation):

1. **Master switch** — `RoyaleConfig.enabled` / `realMoneyAvailable`.
2. **Game switch** — the ACTIVE `AceGameConfig.enabled`.
3. **Jurisdiction + currency** — `AceJurisdictionRules` (admin-managed, versioned
   with the config). Fail-closed: a blocked or unknown country under the `BLOCK`
   policy is refused.
4. **Account status, KYC, 18+** — `RoyaleEligibilityService`.
5. **Responsible-gambling limits / self-exclusion** — `RoyaleEligibilityService`.

A failed gate returns the same "real money unavailable" shape as the other Royale
games; FREE_PLAY skips 3–5 entirely and **never** touches the real wallet.

One spin = **one database transaction**:

- REAL_MONEY: `WalletService.reserveStakeInTx` → `captureStakeInTx` →
  `settleBetCredit(capped win)`. All keyed, all exactly-once.
- FREE_PLAY: `CrashFreePlayWallet.debitInTx` → `creditInTx(capped win)`.
- An immutable ledger row, a `RoyaleAceRound` record, a `RoyaleSettlement` and a
  `GameAuditLog` entry are written in the same transaction.

**Idempotency**: `(userId, clientRequestId)` is unique; a retried spin returns the
existing round and can never double-spend or double-pay. One in-flight round per
user per currency is enforced with a Postgres advisory lock.

**Free spins** are part of the triggering round: the stake is debited once and all
wins credit at settlement. The whole free-spin sequence is pre-derived at spin
time, so a round settles atomically. A round left `ACTIVE` (process death, admin
action, or a mid-round country flip) is completed by the **reconciler**
(`RoyaleAceService.reconcile`), which can only ever apply the exact pre-derived
outcome — it never invents a result. If the encrypted seed is unrecoverable it
VOIDs (refunds) instead.

**Country flips to BLOCKED mid-round**: `finishBlockedCountryRounds` (config)
decides whether the in-flight round finishes; new real-money spins are always
rejected. Withdrawals remain possible per the existing flag.

---

## 3. Math and configuration

Everything lives in **one versioned typed config** (`RoyaleAceConfigVersion`,
`configJson`), loaded through `AceConfigStore` (cached, fail-closed to
`DEFAULT_ACE_CONFIG`).

| Field | Meaning |
| ----- | ------- |
| `strips[reel]` | Weighted symbol entries `{ symbol, weight, golden }` per reel |
| `paytableBp[sym][n]` | bp of stake **per way** for an n-reel run (n = 3/4/5) |
| `scatterPayBp[count]` | whole-group Scatter pay in bp (index = count, last repeats) |
| `baseLadderBp` / `freeSpinLadderBp` | cascade multipliers in bp |
| `goldenToWild` | golden winners become WILD on the next cascade |
| `freeSpins` | award table, retrigger policy, max spins, credit mode |
| `maxWinBp` | per-round win cap |
| `betLevels[currency]` | min/max/step in **minor units** (no auto-FX) |
| `dailyWinCapMinorUnits[currency]` | per-player/day win cap |
| `jurisdiction` | blocked countries, currency-by-country, unknown-country policy |
| `targetRtpBp` | target RTP used by the simulator gate |

Every config version is validated by `validateAceConfig` (structural + numeric).
Nothing is persisted unless fully valid. A **math** change (paytable, strips,
ladders, free-spin settings, caps) can only be ACTIVATED once its newest
simulation report has `passed = true`. Gating-only changes (enabled, bet levels,

---

## 4. Fairness and verification

Randomness is a **CSPRNG + HMAC-SHA256 stream** keyed by `serverSeed`, derived
from `${clientSeed}:${nonce}:${stream}:${counter}` and mapped into ranges with
**rejection sampling** (no modulo bias). Never `Math.random()`.

- The **base game** and **each free spin** draw from their own namespaced
  sub-stream, so an extra RNG call in one phase can never shift another.
- The **entire round** (initial grid, every cascade, golden→wild placements,
  multipliers, the scatter trigger, the whole free-spin sequence and the capped
  total) is generated from those draws BEFORE any money moves.
- Commitment = `SHA-256(serverSeed)`, shown before play. On settlement the
  `serverSeed` is revealed and stored encrypted at rest.

`verifyAceSpin(config, seeds, stake, storedOutcome)` re-derives the full round
from the seeds + the exact config version and checks the totals. It is exposed at
`GET /games/royale-ace/rounds/:roundId/verify` for players and in the admin
viewer for operators.

### RNG certification note

Some regulators and test labs require their own **RNG certification** and do not
accept an HMAC provably-fair stream alone for slots. The game logic therefore
depends only on the `AceRandomSource` interface, so a certified external RNG can
be swapped in **without touching any game math**. See `ace-math.ts`
(`AceRandomSource`) and `ace-fair.ts` (`HmacRandomStream`).

---

## 5. API

Player (authenticated; `apps/api/src/modules/royale/ace.controller.ts`):

| Route | Purpose |
| ----- | ------- |
| `GET  /games/royale-ace/config` | config, paytable, ladders, bet levels, REAL/FREE gate status |
| `POST /games/royale-ace/spin` | play one full round (whole outcome derived + settled server-side) |
| `POST /games/royale-ace/autoplay/limits` | validate autoplay loss/win/spin-count limits |
| `GET  /games/royale-ace/history` | my recent rounds |
| `GET  /games/royale-ace/rounds/:roundId/verify` | re-derive a settled round from the revealed seeds |

Admin (`admin/royale-ace`, RBAC `ROYALE_READ` / `ROYALE_MANAGE`):
`ace-admin.controller.ts` — config version list/create/activate, simulation run,
enable/disable toggle, round viewer + replay, safe void (unpaid rounds only), and
an on-demand reconciler trigger.

Clients may only send a stake, an optional currency, an idempotency key and
presentation flags (turbo / autoplay limits). Never a multiplier, payout, seed,
grid, cascade, free-spin count or balance.

---

## 6. Frontend

`apps/web/components/games/ace-slot-game.tsx` (mobile-first, 360px). Gold-and-navy
"royal casino night" theme with original CSS card art. It is a **dumb replayer**:
one POST returns the whole round and the component animates it. It never invents
a symbol, predicts a cascade or changes a payout, and it uses no near-miss or
"almost won" effects. Controls: stake selector (currency-limited to what the
player's country allows), spin, turbo, autoplay with limits, sound (muted by
default), REAL/FREE badge. The info modal shows the paytable, ways rules, ladder,
RTP, max win, volatility, the fairness panel (commitment, nonce, Verify spin) and
responsible-gambling links with a session timer / reality check. Accessible:
reduced-motion, readable contrast, keyboard support (Space/Enter to spin).

---

## 7. Responsible play

- Autoplay is a client loop over `spin` with required loss/win/spin-count limits;
  it **stops on a feature trigger** and when any limit is reached.
- Session timer + reality check in the info panel.
- No hidden odds, no near-miss effects, no misleading "almost won" animations.
- REAL_MONEY is gated behind jurisdiction, currency, KYC/18+ and
  responsible-gambling limits; self-exclusion and deposit limits are enforced by
  the shared responsible-gambling module before any wallet reservation.

jurisdiction) activate without a new simulation.

### Target RTP and math profile

The default launch table is calibrated by `tuneAceConfig` (4,000,000 seeded
rounds) to **96.18% RTP** [95.89%–96.46%] — inside the 96% ±1.5% tolerance. The
simulator reports the RTP split into base-game, cascade and free-spin
contributions, plus hit frequency, volatility, max win and the free-spin trigger
and retrigger rates. See `AceSimReport`.

```bash
pnpm sim:royale-ace --spins 50000000 --seed royale-ace-v1
pnpm sim:tune:royale-ace            # calibrate strip/paytable weights toward target RTP
```

The CI gate (`runAceSimGate`) fails if RTP deviates beyond tolerance or the
max-win cap is exceeded.

  can never exceed the Postgres INTEGER payout ceiling.
