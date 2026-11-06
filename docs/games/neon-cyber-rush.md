# ROYALE NEON CYBER RUSH (`neon-cyber-rush`)

> Original TANVION ROYALE free-play slot. 6 reels × 4 rows, **4096 ways to win**, left-to-right, 3+ adjacent reels.
> Signature features: **Overclock Respin** (landing 2+ Glitch Wilds triggers locked-wild respins) and **Data Core Free Spins** (8 FS with all wins multiplied by ×2).
> Server-authoritative integer basis-point math, one DB transaction per round, points-only ledger.

---

## 1. Rules

### Grid & Win Model
- **Dimensions**: 6 reels × 4 rows (24 positions).
- **4096 Ways**: Consecutive symbols on adjacent reels starting from reel 0 left-to-right. Multiplier: number of matching symbols on each reel multiply ways.
- **Pay Calculation**: integer basis points. `payout = floor(stake × min(totalPayBp, maxWinBp) / 10000)`.

### Symbols & Paytable
- **Wild**: `glitch_wild` (reels 2–6). Substitutes for all paying symbols, never for `data_core_scatter`.
- **Scatter**: `data_core_scatter` (anywhere). 3+ triggers 8 Free Spins.
- **High pays**: Cyber Robot, Hacker, Neon Chip, Hologram.
- **Low pays**: Energy Core, Circuit Board, Data Byte, Pixel Block.

### Signature Features
1. **Overclock Respin**: Landing 2 or more Glitch Wilds locks those Wilds in place and awards a respin. Landing an additional Wild during the respin resets the respin counter (max 3 respins, up to 6 chained).
2. **Data Core Boost**: All wins during Free Spins are doubled (×2 ladder multiplier).
3. **Retrigger**: 3+ Scatters in Free Spins award +5 additional spins.

### Caps & RTP
- **Target RTP**: 96.0% (measured ~95.04% over 200,000 simulated spins).
- **Max Win Cap**: 4,000× stake (40,000,000 bp).
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
