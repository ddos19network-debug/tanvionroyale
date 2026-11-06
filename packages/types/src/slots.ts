/**
 * TANVION ROYALE — Shared slot types (server + web).
 *
 * All symbol ids are snake_case. Payouts are integer basis points of the total
 * stake (10000 bp = 1× stake). No floating-point money anywhere.
 */

// ---------------------------------------------------------------------------
// Symbol identifiers
// ---------------------------------------------------------------------------

/** Snake-case symbol id used by all 10 slot games. */
export type SlotSymbolId = string;

export interface SlotSymbolMeta {
  id: SlotSymbolId;
  name: string;
  /** 'high' | 'low' | 'wild' | 'scatter' | 'bonus' */
  tier: 'high' | 'low' | 'wild' | 'scatter' | 'bonus';
  /** Public asset path, e.g. /assets/image/royale-pharaoh/ankh.svg */
  asset?: string;
  /** Text/emoji fallback rendered when asset is missing. */
  glyph: string;
}

// ---------------------------------------------------------------------------
// Win structures
// ---------------------------------------------------------------------------

export interface SlotWinLine {
  symbolId: SlotSymbolId;
  /** For payline games: which payline index (0-based). */
  lineIndex?: number;
  /** For ways games: number of ways. */
  ways?: number;
  /** For cluster games: positions {row,col}[]. */
  positions?: Array<{ row: number; col: number }>;
  count: number;
  /** Pay for this win in bp of stake, before cascade multiplier. */
  basepayBp: number;
  /** Cascade multiplier applied (10000 = ×1). */
  multiplierBp: number;
  /** Final pay after multiplier, in bp of stake. */
  payBp: number;
}

export interface SlotCascadeStep {
  kind: 'CASCADE' | 'RESPIN' | 'EXPAND' | 'FEATURE';
  /** Grid after wins removed and new symbols fall in. rows×cols, [row][col]. */
  gridAfter: SlotSymbolId[][];
  wins: SlotWinLine[];
  /** Active cascade multiplier for this step (10000 = ×1). */
  multiplierBp: number;
  /** Total bp win for this step (sum of wins × multiplier). */
  stepPayBp: number;
  /** Feature-specific metadata (e.g. curseMeterValue, pressureValue). */
  meta?: Record<string, unknown>;
}

export interface SlotFreeSpinEntry {
  /** Initial grid for this free spin. */
  baseGrid: SlotSymbolId[][];
  /** Cascade/respin steps within this free spin. */
  steps: SlotCascadeStep[];
  /** Total bp win for this free spin. */
  spinPayBp: number;
}

export interface SlotFreeSpinsResult {
  triggered: boolean;
  /** How many free spins were initially awarded (0 if not triggered). */
  awarded: number;
  /** Number of retriggers that occurred. */
  retriggers: number;
  spins: SlotFreeSpinEntry[];
  /** Total win across all free spins in bp. */
  totalPayBp: number;
}

// ---------------------------------------------------------------------------
// API request / response
// ---------------------------------------------------------------------------

export interface SlotSpinRequest {
  stake: number;
  /** UUID v4 — the same id may be retried safely (idempotent). */
  clientRequestId: string;
}

export interface SlotSpinResponse {
  roundId: string;
  gameSlug: string;
  stake: number;
  /** Initial grid (rows×cols). */
  baseGrid: SlotSymbolId[][];
  /** Cascade/respin steps in the base game. */
  steps: SlotCascadeStep[];
  /** Free-spin feature result. */
  freeSpins: SlotFreeSpinsResult;
  /** Uncapped total win across base + all free spins, in bp of stake. */
  totalPayBp: number;
  /** Actual payout credited (integer points, 0 on a loss). */
  payout: number;
  /** TRUE when the round hit the maxWinBp cap. */
  capped: boolean;
  /** Player's balance AFTER credit, in points. */
  balanceAfter: number;
  message: string;
}

// ---------------------------------------------------------------------------
// Config endpoint
// ---------------------------------------------------------------------------

export interface SlotPaytableEntry {
  symbolId: SlotSymbolId;
  /** Indexed by count (index 0–2 unused; index 3 = 3-of-a-kind, etc.). */
  payBp: number[];
}

export interface SlotFeatureDescription {
  id: string;
  name: string;
  description: string;
}

export interface SlotConfigView {
  gameSlug: string;
  title: string;
  /** 'paylines' | 'ways' | 'cluster' */
  winModel: 'paylines' | 'ways' | 'cluster';
  reels: number;
  rows: number;
  /** Number of fixed paylines (paylines mode only). */
  lineCount?: number;
  symbols: SlotSymbolMeta[];
  paytable: SlotPaytableEntry[];
  /** Allowed stake values (integer points). */
  stakeLevels: number[];
  features: SlotFeatureDescription[];
  /** Hard per-round win cap in bp of stake. */
  maxWinBp: number;
  freeSpins: {
    triggerCount: number;
    awarded: number;
    retriggerCount?: number;
    retriggerAwarded?: number;
  };
}

// ---------------------------------------------------------------------------
// Round history
// ---------------------------------------------------------------------------

export interface SlotRoundHistoryEntry {
  roundId: string;
  gameSlug: string;
  stake: number;
  payout: number;
  totalPayBp: number;
  capped: boolean;
  createdAt: string;
}
