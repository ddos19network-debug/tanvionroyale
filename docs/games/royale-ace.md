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

| Kind    | Symbols                             | Notes                                                |
| ------- | ----------------------------------- | ---------------------------------------------------- |
| Low     | ♠ Spade, ♥ Heart, ♦ Diamond, ♣ Club | Most frequent                                        |
| High    | J, Q, K, A                          | Progressively rarer, pay more                        |
| Wild    | ★ (gold)                            | Substitutes for every card symbol, **never** Scatter |
| Scatter | ✦ (fuchsia)                         | 3+ anywhere triggers Free Spins                      |

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

| Field                               | Meaning                                                        |
| ----------------------------------- | -------------------------------------------------------------- |
| `strips[reel]`                      | Weighted symbol entries `{ symbol, weight, golden }` per reel  |
| `paytableBp[sym][n]`                | bp of stake **per way** for an n-reel run (n = 3/4/5)          |
| `scatterPayBp[count]`               | whole-group Scatter pay in bp (index = count, last repeats)    |
| `baseLadderBp` / `freeSpinLadderBp` | cascade multipliers in bp                                      |
| `goldenToWild`                      | golden winners become WILD on the next cascade                 |
| `freeSpins`                         | award table, retrigger policy, max spins, credit mode          |
| `maxWinBp`                          | per-round win cap                                              |
| `betLevels[currency]`               | min/max/step in **minor units** (no auto-FX)                   |
| `dailyWinCapMinorUnits[currency]`   | per-player/day win cap                                         |
| `jurisdiction`                      | blocked countries, currency-by-country, unknown-country policy |
| `targetRtpBp`                       | target RTP used by the simulator gate                          |

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

| Route                                           | Purpose                                                           |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| `GET  /games/royale-ace/config`                 | config, paytable, ladders, bet levels, REAL/FREE gate status      |
| `POST /games/royale-ace/spin`                   | play one full round (whole outcome derived + settled server-side) |
| `POST /games/royale-ace/autoplay/limits`        | validate autoplay loss/win/spin-count limits                      |
| `GET  /games/royale-ace/history`                | my recent rounds                                                  |
| `GET  /games/royale-ace/rounds/:roundId/verify` | re-derive a settled round from the revealed seeds                 |

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

### Theming (recolor = edit one file)

Every Royale Ace color is a token. The single source of truth is
`apps/web/src/games/royale-ace/theme.ts`; `tokens.css` (mirrored, drift-checked
by a test) publishes each token as a `--ra-*` CSS variable per theme scope, and
`tailwind.config.ts` maps every legacy `royale.*` utility to
`rgb(var(--ra-*) / <alpha-value>)` — so the existing component classes
(`bg-royale-gold`, `ring-royale-goldDeep/60`, …) recolor automatically and every
opacity modifier keeps working. No component, glow or Tailwind class needs to
change to recolor the game.

Three presets ship and prove the tokens are live: **default** (the launch
palette), **emerald** and **crimson**. Switch between them with a `?theme=` URL
param (`/games/play/royale-ace?theme=emerald`) or the in-game theme switcher in
the header (persisted per browser via `localStorage`). `useAceTheme` resolves
`?theme=` → stored choice → `default`, then sets `data-ra-theme` on `<html>`
(the only runtime switch); it is SSR-safe (first render is always `default`).

```bash
pnpm --filter @tanvion-royale/web test:ace-theme   # palette, presets, no-drift, wiring
```

### Layout, motion & chrome (section 2 spec)

The game screen is measured against a single **388 × 848 portrait design
canvas** and the WHOLE board scales with one factor `--unit = width / 388`, so
every phone keeps identical proportions (no reflow, no clipped cards):

| Element   | Design px                                 | Notes                                          |
| --------- | ----------------------------------------- | ---------------------------------------------- |
| Card      | **68 × 86** (portrait, ~0.79:1, radius 6) | one box for every symbol; only the art changes |
| Gaps      | 8 (x) / 7 (y)                             | column pitch 76, row pitch 93                  |
| Board     | **372 × 365**                             | `5·68 + 4·8 = 372`, `4·86 + 3·7 = 365`         |
| Board top | y = 256                                   | ~30% down the canvas                           |

`src/games/royale-ace/ace-geometry.ts` is the single source of truth for those
numbers and emits them as `--ra-*` layout custom properties
(`aceGeometryCssVars`); the board/cards read them, so a card is exactly 68×86 at
388 px (±1 px) and everything shrinks by the same ratio on a 360 px phone.

**Drop choreography** (`src/games/royale-ace/ace-drop.ts`, pure): cards ALWAYS
come DOWN from the TOP, LINE BY LINE — never fade, pop or slide sideways. New
cards enter from ABOVE the board (clipped by `overflow: hidden`) and land
**bottom row first, then up to the top row** (all 5 cards in a row start
together with a bounded ±jitter). Old cards drop OUT downward, bottom row first.
Turbo shortens every duration to ~40% but keeps the SAME top-to-bottom order;
`dropMode: 'row' | 'column'` is a pure reordering for a future column build.
The component applies the plan as a CSS `transform` + per-cell
`animation-delay` (no per-frame JS → 60 fps on a mid-range phone).

**Game chrome** (`components/games/ace-chrome.tsx`, all token-colored, no
hard-coded hex): the curved gold **multiplier ribbon** (x1 x2 x3 x5, active rung
glows), the auto-rotating **message strip** (marquees when long), the five
**pillars** above the reels, the **WIN** readout row, the **footer** (version ·
last round id · green/red network indicator), the left slide-out **side menu**
(Backpack / Mission / Win More / Tournament / Bell), the **BUY BONUS** badge +
confirm dialog (price = bet × factor; presentation-only in this play-money
build — the server never charges for a feature and the outcome is unchanged),
the **COMBO** banner during a cascade, the full-screen **big-win** celebration
with coin rain (Big / Mega / Super at 10× / 25× / 50× of the bet), and the
**connection** banner that pauses play when the socket drops.

**Loading → splash → game** (`components/games/ace-loading.tsx`): an original
sunburst background with floating gold coins, the ROYALE ACE logo (our own
crown/ace SVG emblem), 5 heat pips, a 6-slide **tips carousel** with
arrows + dot indicators that auto-advances ~every 2 s, a thin progress bar with
real preload percentage ("Loading… 77%"), a persisted "Don't show next time"
checkbox, a green **Continue** at 100%, then a **splash** with the logo and a
gold **PLAY** button.

```bash
# browser-free unit tests for the layout, drop order and chrome
pnpm --filter @tanvion-royale/web test:ace-geometry   # 68x86 card, 8/7 gaps, 372x365 board
pnpm --filter @tanvion-royale/web test:ace-drop       # bottom-row-first, from above, turbo ~40%
pnpm --filter @tanvion-royale/web test:ace-chrome     # ribbon/pillars/WIN/footer/menu/buy-bonus/bigwin
pnpm --filter @tanvion-royale/web test:ace             # ALL of the above + the replayer + theme
```

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
