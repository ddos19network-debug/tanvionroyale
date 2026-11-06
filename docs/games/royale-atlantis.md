# ROYALE ATLANTIS (`royale-atlantis`)

> Original TANVION ROYALE free-play slot. 7 reels × 7 rows, **Cluster Pays** (orthogonal adjacency, min cluster 5).
> Signature features: **Tumble Cascade** with multiplier ladder (×1→×2→×3→×5), **Kraken Sweep** (removes 1 random regular symbol type), and **Treasure Chest** instant prize (5×–25× stake).
> Server-authoritative integer basis-point math, one DB transaction per round, points-only ledger.

---

## 1. Rules

### Grid & Win Model
- **Dimensions**: 7 rows × 7 columns (49 cells).
- **Cluster Pays**: 5 or more horizontally or vertically adjacent matching symbols form a winning cluster.
- **Tumble (Cascade)**: Winning clusters are removed, surviving symbols drop to the bottom of their column, and new symbols refill from above. Repeats until no new winning cluster forms (max 15 cascades).
- **Wild Retention**: Wilds not participating in a cluster stay on the board through cascades (verified regression fix).

### Symbols & Paytable
- **Wild**: `tidal_wild` — joins any cluster, never forms all-wild clusters, reusable across simultaneous clusters.
- **Scatter**: `atlantis_gate` — 4+ anywhere awards 10 Free Spins (3+ retrigger = +5 spins).
- **Bonus Symbols**: `treasure_chest`, `kraken_emblem`.
- **High pays**: Ocean King, Mermaid Queen, Golden Trident, Royal Pearl.
- **Low pays**: Atlantis Palace, Sea Dragon, Dolphin, Sea Turtle.

### Signature Features
1. **Kraken Sweep**: When `kraken_emblem` lands, one random regular symbol type is swept from the board before evaluation, triggering cascade refills.
2. **Treasure Chest**: Landing 3+ Treasure Chests anywhere on the grid awards an instant mystery prize between 5× and 25× stake.
3. **Cascade Multiplier Ladder**: ×1 → ×2 → ×3 → ×5 per cascade step.

### Caps & RTP
- **Target RTP**: 96.0% (measured ~96.5% over 200,000 simulated spins).
- **Max Win Cap**: 5,000× stake (50,000,000 bp).
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
