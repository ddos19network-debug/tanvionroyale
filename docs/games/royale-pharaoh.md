# ROYALE PHARAOH (`royale-pharaoh`)

> Original TANVION ROYALE free-play slot. 5 reels × 4 rows, **25 fixed paylines**, left-to-right, 3+ of a kind.
> Signature features: **Golden Tomb** (expanding wild in free spins) and **Pharaoh's Curse meter** (+1 on dead spins; at 10 awards a free Curse Spin with 2 random reels turned wild).
> Server-authoritative integer basis-point math, one DB transaction per round, points-only ledger.

---

## 1. Rules

### Grid & Win Model
- **Dimensions**: 5 reels × 4 rows (20 visible symbols).
- **25 Fixed Paylines**: wins pay left-to-right starting from the leftmost reel for 3+ consecutive matching symbols along any of the 25 payline shapes.
- **Pay Calculation**: integer basis points of the total stake. `payout = floor(stake × min(totalPayBp, maxWinBp) / 10000)`.

### Symbols & Paytable
- **Wild**: `pharaoh_wild` — lands on reels 2–5. Substitutes for all paying symbols, never for `scarab_scatter`.
- **Scatter**: `scarab_scatter` — lands anywhere. 3+ triggers 10 Free Spins.
- **High pays**: Pharaoh, Golden Mask, Eye of Horus, Ankh.
- **Low pays**: Pyramid, Cartouche, Lotus, Coin.

### Signature Features
1. **Golden Tomb**: During Free Spins, any Wild that lands expands vertically to fill its entire reel.
2. **Pharaoh's Curse Meter**: Increases by +1 on every zero-win base spin. Upon reaching 10, the next spin is a free "Curse Spin" with 2 random reels turned fully Wild before evaluation. The meter then resets to 0.
3. **Retrigger**: 3+ Scatters landing during Free Spins award +5 additional Free Spins (capped at 60 max spins per round).

### Caps & RTP
- **Target RTP**: 96.0% (measured ~96.27% over 200,000 simulated spins).
- **Max Win Cap**: 3,000× stake (30,000,000 bp).
- **Stake Levels**: 10, 20, 50, 100, 200, 500, 1000 points.

---

## 2. Money Flow & Persistence
- Single atomic transaction:
  1. Serialized per-user advisory lock.
  2. Idempotency check on `(userId, clientRequestId)`.
  3. `CrashFreePlayWallet.debitInTx(stake)`.
  4. Server-authoritative derivation (`deriveRound`).
  5. `CrashFreePlayWallet.creditInTx(payout)` if win > 0.
  6. Insert `FreePlaySlotRound` and `GameResult` rows.
  7. Return `balanceAfter`.
