/**
 * TANVION ROYALE — Royale Ace replay state machine (PURE — no React, no DOM).
 *
 * The client is a DUMB REPLAYER: one POST /games/royale-ace/spin returns the
 * ENTIRE pre-derived round (initial grid, every cascade step, golden→wild
 * placements, the multiplier ladder, the scatter trigger and the full
 * free-spin sequence), all settled server-side. This module only decides HOW
 * that outcome is walked through for presentation:
 *
 *   - `reduceAceReplay` drives the phase machine
 *       SPIN → DROP(step 0) → STEP → BURST → DROP(step n) → … → (FREE_INTRO)
 *       → SPIN(free i) → … → IDLE(done)
 *     and NEVER invents, predicts or alters a symbol or a payout. Skipping the
 *     animation (all timings 0) yields the exact same grids and win.
 *   - `aceReplayTimings` collapses every duration to 0 for turbo and/or
 *     prefers-reduced-motion.
 *   - `aceAutoplayAfterRound` is the single autoplay stop decision
 *     (feature trigger / spin count / loss limit / win limit / user stop).
 *   - `aceDisplayedWinBp` / `aceCountUp` back the win meter.
 *
 * All money values from the server are integer minor units; multipliers are
 * basis points (10000 bp = 1.00x). This module performs no arithmetic on
 * payouts beyond summing what the server already computed.
 */
import type {
  AceCascadeStep,
  AceCell,
  AceSpinResult,
  AceRoundView,
} from '@/lib/api/ace';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

export const ACE_REELS = 5;
export const ACE_ROWS = 4;

/** Stable "reel:row" key used for win / removed / wild cell sets. */
export function aceCellKey(reel: number, row: number): string {
  return `${reel}:${row}`;
}

export function aceEmptyGrid(): AceCell[][] {
  return Array.from({ length: ACE_REELS }, () =>
    Array.from({ length: ACE_ROWS }, () => ({ symbol: 'SPADE' as const, golden: false })),
  );
}

/** The spin currently being replayed (base spin or free spin N). */
export function aceCurrentSpin(state: AceReplayState): AceSpinResult | null {
  if (!state.round) return null;
  if (state.freeSpinIndex < 0) return state.round.result.baseSpin;
  return state.round.result.freeSpins[state.freeSpinIndex] ?? null;
}

// ---------------------------------------------------------------------------
// Timings — turbo and prefers-reduced-motion collapse everything to 0
// ---------------------------------------------------------------------------

export interface AceReplayTimings {
  /** Staggered stop: reel i's streak runs for `spinMs + i × reelStaggerMs`. */
  spinMs: number;
  reelStaggerMs: number;
  /** Highlight of winning cells before they burst. */
  stepHoldMs: number;
  /** Winning-cell burst (fade + scale out). */
  burstMs: number;
  /** Survivors drop + new cells fall from the top. */
  dropMs: number;
  /** Free-spins feature intro card. */
  freeIntroMs: number;
  /** Pause between autoplay spins. */
  autoplayGapMs: number;
}

/**
 * Presentation-only durations. Turbo ≈ 4× faster; reduced motion removes all
 * animation while keeping the exact same server outcome (every step is still
 * visited, just instantly).
 */
export function aceReplayTimings(opts: {
  turbo: boolean;
  reducedMotion: boolean;
}): AceReplayTimings {
  if (opts.reducedMotion) {
    return {
      spinMs: 0,
      reelStaggerMs: 0,
      stepHoldMs: 0,
      burstMs: 0,
      dropMs: 0,
      freeIntroMs: 0,
      autoplayGapMs: 0,
    };
  }
  const fast = opts.turbo;
  return {
    spinMs: fast ? 220 : 740,
    reelStaggerMs: fast ? 25 : 90,
    stepHoldMs: fast ? 60 : 240,
    burstMs: fast ? 60 : 240,
    dropMs: fast ? 80 : 320,
    freeIntroMs: fast ? 400 : 1600,
    autoplayGapMs: fast ? 120 : 520,
  };
}

/** Total time until reel `i` stops (used for the staggered-stop timers). */
export function aceReelStopMs(t: AceReplayTimings, reel: number): number {
  return t.spinMs + reel * t.reelStaggerMs;
}

/** Total time until every reel has stopped (the last staggered stop). */
export function aceSpinEndMs(t: AceReplayTimings): number {
  return aceReelStopMs(t, ACE_REELS - 1);
}

// ---------------------------------------------------------------------------
// Machine state
// ---------------------------------------------------------------------------

export type AceReplayPhase =
  | 'IDLE' // nothing playing (initial mount or after the round finished)
  | 'SPIN' // reels are streaking; columns stop one by one
  | 'DROP' // a step's grid is falling in from the top
  | 'STEP' // a settled step is shown (win highlight before the burst)
  | 'BURST' // winning cells are bursting out
  | 'FREE_INTRO'; // free-spins feature intro card

export interface AceReplayState {
  phase: AceReplayPhase;
  /** The full server-derived round being replayed (never mutated). */
  round: AceRoundView | null;
  /** -1 = base spin; 0..n = index into result.freeSpins. */
  freeSpinIndex: number;
  /** Cascade step cursor into the current spin's `steps`. */
  stepIndex: number;
  /** Grid currently rendered (a verbatim copy of one server step grid). */
  grid: AceCell[][];
  /** Cells bursting out this tick (keys of the CURRENT step's `removed`). */
  removedKeys: string[];
  /** Winning cells of the CURRENT step (keys). */
  winKeys: string[];
  /** Golden→wild flips of the CURRENT step (keys) — glow while shown. */
  wildKeys: string[];
  /** Current cascade multiplier (bp of stake) for the ladder highlight. */
  multiplierBp: number;
  /** 'playing' while a round is being replayed; 'done' after ROUND_COMPLETE. */
  status: 'idle' | 'playing' | 'done';
}

export function initialAceReplay(): AceReplayState {
  return {
    phase: 'IDLE',
    round: null,
    freeSpinIndex: -1,
    stepIndex: 0,
    grid: aceEmptyGrid(),
    removedKeys: [],
    winKeys: [],
    wildKeys: [],
    multiplierBp: 0,
    status: 'idle',
  };
}

export type AceReplayEvent =
  | { type: 'ROUND'; round: AceRoundView }
  | { type: 'SPIN_END' }
  | { type: 'DROP_END' }
  | { type: 'BURST' }
  | { type: 'BURST_END' }
  | { type: 'SPIN_COMPLETE' }
  | { type: 'FREE_INTRO_END' }
  | { type: 'RESET' };

function stepWinKeys(step: AceCascadeStep): string[] {
  const keys = new Set<string>();
  for (const group of step.wins) for (const cell of group.cells) keys.add(aceCellKey(cell.reel, cell.row));
  return [...keys];
}

function stepWildKeys(step: AceCascadeStep): string[] {
  return step.goldenToWild.map((c) => aceCellKey(c.reel, c.row));
}

/** Apply one server step: grid + win/wild highlights + ladder multiplier. */
function applyStep(state: AceReplayState, spin: AceSpinResult, stepIndex: number): AceReplayState {
  const step = spin.steps[stepIndex];
  if (!step) return state;
  return {
    ...state,
    stepIndex,
    grid: step.grid,
    removedKeys: [],
    winKeys: stepWinKeys(step),
    wildKeys: stepWildKeys(step),
    multiplierBp: step.multiplierBp,
  };
}

/**
 * The replay state machine. Pure: same (state, event) → same next state.
 *
 * Callers own the clock: after entering SPIN schedule SPIN_END at
 * `aceSpinEndMs(t)`, after DROP schedule DROP_END at `t.dropMs`, after STEP
 * (when the current step removed cells) schedule BURST at `t.stepHoldMs`, and
 * after BURST schedule BURST_END at `t.burstMs`. With all timings 0 every one
 * of those fires immediately, so the whole round replays in a microtask chain
 * with identical results.
 */
export function reduceAceReplay(state: AceReplayState, event: AceReplayEvent): AceReplayState {
  switch (event.type) {
    case 'RESET':
      return initialAceReplay();

    case 'ROUND': {
      // A new server round arrives: start (or restart) at the base spin.
      return {
        ...initialAceReplay(),
        phase: 'SPIN',
        round: event.round,
        status: 'playing',
        grid: state.grid, // keep the last real grid visible under the spin streaks
      };
    }

    case 'SPIN_END': {
      // Reels have stopped: land the initial drop (step 0) from the top.
      const spin = aceCurrentSpin(state);
      if (!spin) return { ...state, phase: 'IDLE', status: 'idle' };
      const landed = applyStep(state, spin, 0);
      return { ...landed, phase: 'DROP' };
    }

    case 'DROP_END':
      return { ...state, phase: 'STEP' };

    case 'BURST': {
      const spin = aceCurrentSpin(state);
      const step = spin?.steps[state.stepIndex];
      if (!step || step.removed.length === 0) return state; // nothing to burst
      return {
        ...state,
        phase: 'BURST',
        removedKeys: step.removed.map((c) => aceCellKey(c.reel, c.row)),
      };
    }

    case 'BURST_END': {
      const spin = aceCurrentSpin(state);
      if (!spin) return { ...state, phase: 'IDLE', status: 'idle' };
      const next = state.stepIndex + 1;
      if (next >= spin.steps.length) {
        // Cascade exhausted — complete the spin (base → feature or done).
        return reduceAceReplay(state, { type: 'SPIN_COMPLETE' });
      }
      const landed = applyStep(state, spin, next);
      return { ...landed, phase: 'DROP' };
    }

    case 'SPIN_COMPLETE': {
      const round = state.round;
      if (!round) return initialAceReplay();
      if (state.freeSpinIndex < 0) {
        if (round.result.freeSpins.length > 0) {
          // Feature triggered: show the intro card, then play free spin 0.
          return { ...state, phase: 'FREE_INTRO' };
        }
        return { ...state, phase: 'IDLE', status: 'done' };
      }
      const nextFree = state.freeSpinIndex + 1;
      if (nextFree < round.result.freeSpins.length) {
        // Retrigger or queue: straight into the next free spin.
        return { ...state, phase: 'SPIN', freeSpinIndex: nextFree, stepIndex: 0 };
      }
      return { ...state, phase: 'IDLE', status: 'done' };
    }

    case 'FREE_INTRO_END': {
      const round = state.round;
      if (!round || round.result.freeSpins.length === 0) {
        return { ...state, phase: 'IDLE', status: 'done' };
      }
      return { ...state, phase: 'SPIN', freeSpinIndex: 0, stepIndex: 0 };
    }

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Win display
// ---------------------------------------------------------------------------

/** Winning cells of the step on screen (used to ring/highlight them). */
export function aceWinKeysForStep(spin: AceSpinResult | null, stepIndex: number): Set<string> {
  const set = new Set<string>();
  const step = spin?.steps[stepIndex];
  if (!step) return set;
  for (const group of step.wins) for (const cell of group.cells) set.add(aceCellKey(cell.reel, cell.row));
  return set;
}

/** Golden→wild flips applied by the step on screen (glow while settling). */
export function aceWildKeysForStep(spin: AceSpinResult | null, stepIndex: number): Set<string> {
  const set = new Set<string>();
  const step = spin?.steps[stepIndex];
  if (!step) return set;
  for (const cell of step.goldenToWild) set.add(aceCellKey(cell.reel, cell.row));
  return set;
}

/**
 * Win meter target in bp of stake: every finished spin's total plus the steps
 * already replayed of the spin in progress. Server-computed values only.
 */
export function aceDisplayedWinBp(state: AceReplayState): number {
  const round = state.round;
  if (!round) return 0;
  let total = 0;
  if (state.freeSpinIndex >= 0) total += round.result.baseSpin.totalPayBp;
  for (let i = 0; i < state.freeSpinIndex; i += 1) {
    total += round.result.freeSpins[i]?.totalPayBp ?? 0;
  }
  const spin = aceCurrentSpin(state);
  if (spin && state.phase !== 'SPIN' && state.phase !== 'FREE_INTRO') {
    const last = Math.min(state.stepIndex, spin.steps.length - 1);
    for (let i = 0; i <= last; i += 1) total += spin.steps[i]?.payBp ?? 0;
  }
  return total;
}

/** Ease-out count-up interpolation for the win meter (t in [0,1]). */
export function aceCountUp(from: number, to: number, t: number): number {
  const clamped = t <= 0 ? 0 : t >= 1 ? 1 : t;
  const eased = 1 - (1 - clamped) * (1 - clamped);
  return Math.round(from + (to - from) * eased);
}

// ---------------------------------------------------------------------------
// Ladder
// ---------------------------------------------------------------------------

/**
 * Index of the ladder rung to highlight: the last rung the current multiplier
 * has reached (or -1 when the multiplier is 0 / below the first rung).
 */
export function aceLadderIndex(ladderBp: readonly number[], multiplierBp: number): number {
  if (multiplierBp <= 0 || ladderBp.length === 0) return -1;
  let index = -1;
  for (let i = 0; i < ladderBp.length; i += 1) {
    if (ladderBp[i] > 0 && multiplierBp >= ladderBp[i]) index = i;
  }
  return index;
}

// ---------------------------------------------------------------------------
// Autoplay
// ---------------------------------------------------------------------------

export interface AceAutoplayState {
  active: boolean;
  /** Spins remaining in the session (including the one just finished). */
  spinsLeft: number;
  /** Session net in minor units (win − stake per settled spin). */
  netMinor: number;
  /** Stop when net ≤ −lossLimitMinor (0 = never). */
  lossLimitMinor: number;
  /** Stop when net ≥ winLimitMinor (0 = never). */
  winLimitMinor: number;
}

export type AceAutoplayStopReason =
  | 'user'
  | 'feature'
  | 'count'
  | 'loss-limit'
  | 'win-limit'
  | 'inactive';

export interface AceAutoplayDecision {
  /** 'continue' = schedule the next spin (spinsLeft already decremented). */
  action: 'continue' | 'stop';
  reason: AceAutoplayStopReason | null;
  next: AceAutoplayState;
}

/**
 * The single autoplay stop decision, evaluated AFTER a round settles.
 *
 * Stop order (mirrors the server's autoplay/limits contract):
 *   1. user pressed stop / autoplay inactive,
 *   2. a feature was triggered (base spin awarded free spins),
 *   3. loss limit reached,
 *   4. win limit reached,
 *   5. spin count exhausted.
 */
export function aceAutoplayAfterRound(
  prev: AceAutoplayState,
  opts: { featureTriggered: boolean; netDeltaMinor: number },
): AceAutoplayDecision {
  const next: AceAutoplayState = {
    ...prev,
    spinsLeft: Math.max(0, prev.spinsLeft - 1),
    netMinor: prev.netMinor + opts.netDeltaMinor,
  };
  if (!prev.active) {
    return { action: 'stop', reason: 'inactive', next: { ...next, active: false, spinsLeft: 0 } };
  }
  if (opts.featureTriggered) {
    return { action: 'stop', reason: 'feature', next: { ...next, active: false, spinsLeft: 0 } };
  }
  if (next.lossLimitMinor > 0 && next.netMinor <= -next.lossLimitMinor) {
    return { action: 'stop', reason: 'loss-limit', next: { ...next, active: false, spinsLeft: 0 } };
  }
  if (next.winLimitMinor > 0 && next.netMinor >= next.winLimitMinor) {
    return { action: 'stop', reason: 'win-limit', next: { ...next, active: false, spinsLeft: 0 } };
  }
  if (next.spinsLeft <= 0) {
    return { action: 'stop', reason: 'count', next: { ...next, active: false, spinsLeft: 0 } };
  }
  return { action: 'continue', reason: null, next };
}

// ---------------------------------------------------------------------------
// Bet stepper
// ---------------------------------------------------------------------------

export interface AceBetLevels {
  minStake: number;
  maxStake: number;
  step: number;
}

/** Bet stepper: clamp to the server-provided levels and snap to the step grid. */
export function aceNextStake(current: number, direction: 1 | -1, levels: AceBetLevels): number {
  const step = levels.step > 0 ? levels.step : 1;
  const raw = current + direction * step;
  const snapped = levels.minStake + Math.round((raw - levels.minStake) / step) * step;
  return Math.min(levels.maxStake, Math.max(levels.minStake, snapped));
}

/** Clamp a typed stake into the server-provided bounds (never widen them). */
export function aceClampStake(value: number, levels: AceBetLevels): number {
  if (!Number.isFinite(value)) return levels.minStake;
  return Math.min(levels.maxStake, Math.max(levels.minStake, Math.round(value)));
}