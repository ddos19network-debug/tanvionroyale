# ROYALE MYSTIC FOREST (`mystic-forest`)

> Original TANVION ROYALE free-play slot. 5 reels × 4 rows, **1024 ways to win**, cascading tumble woodland slot.
> Signature features: **Enchanted Tumble + Growing Tree Wild** (each cascade step plants a sticky Tree Wild) and **Persistent FS Wilds** (Tree Wilds remain across the entire free spin feature).
> Server-authoritative integer basis-point math, one DB transaction per round, points-only ledger.

---

## 1. Rules

### Grid & Win Model
- **Dimensions**: 5 reels × 4 rows (20 cells).
- **1024 Ways**: Matching symbols on 3+ consecutive reels from left to right.
- **Enchanted Tumble**: Winning symbols tumble and are replaced from above.

### Symbols & Paytable
- **Wild**: `fairy_wild` (reels 2–4). Substitutes for all paying symbols, never for `dragon_egg_scatter`.
- **Special Wild**: `magic_tree_wild` (planted during cascades).
- **Scatter**: `dragon_egg_scatter` (anywhere). 3+ triggers 8 Free Spins.
- **High pays**: Forest Fairy, Magic Crystal, Wise Owl, Enchanted Mushroom.
- **Low pays**: Mystic Deer, Moon Flower, Golden Leaf.

### Signature Features
1. **Growing Tree Wild**: Every cascade step that removes winning symbols generates 1 sticky `magic_tree_wild` on a random non-wild cell (max 5 per spin).
2. **Persistent FS Tree Wilds**: During the 8 Free Spins awarded by 3+ Dragon Eggs, planted Tree Wilds remain sticky across all remaining free spins.
3. **Cascade Multiplier Ladder**: ×1 → ×2 → ×3 → ×5 per cascade.

### Caps & RTP
- **Target RTP**: 96.0% (measured ~95.45% over 200,000 simulated spins).
- **Max Win Cap**: 2,500× stake (25,000,000 bp).
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
