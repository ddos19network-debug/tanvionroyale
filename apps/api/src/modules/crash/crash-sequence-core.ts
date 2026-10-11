/**
 * TANVION ROYALE — Sky Rocket operator-configured crash-point sequence.
 *
 * PURE state machine (no Prisma, no I/O) so every rule is unit-testable:
 *
 *   ORIGINAL        P1 → P2 → … → Pn        (one configured point per round)
 *   REPEAT          R1 → R2 → …             (R_k = originalPoints[(k-1) mod n],
 *                                            deterministic — never random)
 *   REPEAT_EXTENDED repeat continues to the admin-extended end WITHOUT resetting
 *                   the position (R31 + extension 10 → ends at R41), after
 *                   which pending new admin points activate
 *   NEW_SEQUENCE    N1 → N2 → … → Nm        (after the last new point the list
 *                                            is promoted to the repeat source,
 *                                            so nothing is silently discarded)
 *   PROVABLY_FAIR   no sequence configured — the engine falls back to the
 *                   existing HMAC commit/reveal derivation, untouched.
 *
 * CONSUMPTION RULES (enforced by the engine, not here):
 *   - exactly ONE point is consumed per round, at round CREATION, inside the
 *     scheduler transaction (advisory lock + row lock → no double consumption);
 *   - the consumed multiplier is frozen on the round row forever — admin
 *     updates NEVER mutate a running round;
 *   - positions are persisted in CrashSequenceState, so restarts resume at
 *     the exact next position.
 */

export type CrashSequenceMode =
  | 'PROVABLY_FAIR'
  | 'ORIGINAL'
  | 'REPEAT'
  | 'REPEAT_EXTENDED'
  | 'NEW_SEQUENCE';

/** Minimum legal configured multiplier (never crash at or below 1.00x). */
export const MIN_CRASH_POINT = 1.0;
/** Hard safety cap — mirrors the provably-fair MAX_CRASH_MULTIPLIER. */
export const MAX_CRASH_POINT = 10_000;
/** Configured points use exactly 2 decimal places (1.20x, not 1.234x). */
export const CRASH_POINT_DECIMALS = 2;
/** Sanity bound on list size. */
export const MAX_SEQUENCE_POINTS = 1_000;

export interface CrashSequenceStateData {
  mode: CrashSequenceMode;
  /** Canonical original list P1..Pn (also the repeat source). */
  originalPoints: number[];
  /** Pending new admin points N1..Nm (null when none queued). */
  nextPoints: number[] | null;
  /** Consumed original count (next original = P[originalConsumed + 1]). */
  originalConsumed: number;
  /** Consumed repeat count (next repeat = R[repeatPosition + 1]). */
  repeatPosition: number;
  /** Effective end of the current repeat phase. */
  repeatEnd: number;
  /** Consumed new-sequence count. */
  newConsumed: number;
}

export interface ConfiguredCrashPoint {
  /** The multiplier this round must crash at (2dp). */
  multiplier: number;
  /** Phase the round belongs to (recorded on the round row for audit). */
  mode: CrashSequenceMode;
  /** 1-based position within the phase (P#, R# or N#). */
  index: number;
  /** Human-readable label, e.g. "ORIGINAL #3" / "REPEAT #31". */
  label: string;
}

export interface SequenceConsumeResult {
  point: ConfiguredCrashPoint;
  /** New persisted state AFTER consuming (must be written atomically). */
  state: CrashSequenceStateData;
}

/** Creates the persisted state for a freshly configured original list. */
export function initialSequenceState(points: number[]): CrashSequenceStateData {
  return {
    mode: 'ORIGINAL',
    originalPoints: [...points],
    nextPoints: null,
    originalConsumed: 0,
    repeatPosition: 0,
    repeatEnd: points.length,
    newConsumed: 0,
  };
}

/**
 * Applies an admin edit of the ORIGINAL list WITHOUT ever resetting the game.
 *
 *  - First configuration (or a row still in PROVABLY_FAIR): the sequence starts
 *    fresh at P1.
 *  - Still in the ORIGINAL phase: the ALREADY-CONSUMED prefix is frozen on the
 *    round rows, so the persisted position is preserved and only the FUTURE
 *    points change. The next round continues from P[k+1] — consumed points are
 *    never replayed.
 *  - Every configured point already consumed: the edited list simply becomes
 *    the repeat source, so the next round starts the deterministic repeat.
 *
 * The caller (service) rejects edits that would shorten the frozen prefix.
 */
export function reconfigureOriginalState(
  previous: CrashSequenceStateData | null,
  points: number[],
): CrashSequenceStateData {
  const fresh = initialSequenceState(points);
  const consumed = previous?.mode === 'ORIGINAL' ? previous.originalConsumed : 0;
  if (consumed <= 0) return fresh;
  if (consumed >= points.length) {
    // Nothing future left to edit — continue with the repeat over this list.
    return {
      ...fresh,
      mode: 'REPEAT',
      originalConsumed: points.length,
      repeatPosition: 0,
      repeatEnd: points.length,
    };
  }
  return { ...fresh, originalConsumed: consumed };
}

function isSequencePhase(mode: CrashSequenceMode): boolean {
  return mode === 'REPEAT' || mode === 'REPEAT_EXTENDED' || mode === 'NEW_SEQUENCE';
}

function nextRepeatPoint(state: CrashSequenceStateData, index: number): number {
  const n = state.originalPoints.length;
  // Deterministic modulo cycling — R101 = P1 when the list wraps. NO randomness.
  return state.originalPoints[(index - 1) % n];
}

/** Phase label used on round rows, admin UI and WS payloads. */
export function phaseLabel(mode: CrashSequenceMode, index: number): string {
  const prefix =
    mode === 'ORIGINAL' ? 'ORIGINAL' : mode === 'NEW_SEQUENCE' ? 'NEW' : 'REPEAT';
  return `${prefix} #${index}`;
}

function promoteNewPoints(working: CrashSequenceStateData): CrashSequenceStateData {
  // Last new point consumed → promote it to the repeat source so the
  // configured points are never silently discarded and the game continues
  // deterministically.
  const promoted = working.nextPoints as number[];
  return {
    ...working,
    mode: 'REPEAT',
    originalPoints: promoted,
    nextPoints: null,
    originalConsumed: promoted.length,
    repeatPosition: 0,
    repeatEnd: promoted.length,
    newConsumed: 0,
  };
}

/**
 * Consume the NEXT crash point for a round. Returns null when the sequence is
 * empty or in PROVABLY_FAIR mode (the caller falls back to seed derivation).
 *
 * The returned `state` is the new persisted state — the caller MUST write it
 * in the same database transaction that creates the round.
 */
export function consumeNextPoint(
  state: CrashSequenceStateData,
): SequenceConsumeResult | null {
  if (state.originalPoints.length === 0) return null;

  // ---------------- ORIGINAL ----------------
  if (state.mode === 'ORIGINAL' || state.mode === 'PROVABLY_FAIR') {
    if (state.originalConsumed < state.originalPoints.length) {
      const index = state.originalConsumed + 1;
      const multiplier = state.originalPoints[state.originalConsumed];
      const next: CrashSequenceStateData = {
        ...state,
        mode: 'ORIGINAL',
        originalConsumed: index,
      };
      if (index >= state.originalPoints.length) {
        // Original list exhausted — the NEXT round begins the deterministic
        // repeat over the same list (R1 = P1). Position persists from here on.
        next.mode = 'REPEAT';
        next.repeatPosition = 0;
        next.repeatEnd = state.originalPoints.length;
      }
      return {
        point: { multiplier, mode: 'ORIGINAL', index, label: phaseLabel('ORIGINAL', index) },
        state: next,
      };
    }
    // Defensive: ORIGINAL flag with nothing left — fall through to repeat
    // semantics instead of ever blocking round creation.
  }

  // ---------------- REPEAT / REPEAT_EXTENDED / NEW_SEQUENCE ----------------
  const working: CrashSequenceStateData = isSequencePhase(state.mode)
    ? { ...state }
    : {
        // Defensive normalization (ORIGINAL consumed fully but flag not flipped).
        ...state,
        mode: 'REPEAT',
        repeatPosition: state.repeatPosition,
        repeatEnd: state.repeatEnd > 0 ? state.repeatEnd : state.originalPoints.length,
      };

  // Repeat phase finished at its effective end?
  if (
    (working.mode === 'REPEAT' || working.mode === 'REPEAT_EXTENDED') &&
    working.repeatPosition >= working.repeatEnd
  ) {
    if (working.nextPoints && working.nextPoints.length > 0) {
      // New admin points become active EXACTLY here (persisted transition).
      const index = working.newConsumed + 1;
      const multiplier = working.nextPoints[working.newConsumed];
      const next: CrashSequenceStateData = {
        ...working,
        mode: 'NEW_SEQUENCE',
        newConsumed: index,
      };
      if (index >= working.nextPoints.length) {
        return {
          point: { multiplier, mode: 'NEW_SEQUENCE', index, label: phaseLabel('NEW_SEQUENCE', index) },
          state: promoteNewPoints(next),
        };
      }
      return {
        point: { multiplier, mode: 'NEW_SEQUENCE', index, label: phaseLabel('NEW_SEQUENCE', index) },
        state: next,
      };
    }
    // No new points queued — the repeat keeps cycling deterministically
    // (R[end+1] = originalPoints[end % n]); extension flag clears.
    working.mode = 'REPEAT';
  }

  if (working.mode === 'NEW_SEQUENCE') {
    if (working.nextPoints && working.newConsumed < working.nextPoints.length) {
      const index = working.newConsumed + 1;
      const multiplier = working.nextPoints[working.newConsumed];
      const next: CrashSequenceStateData = { ...working, newConsumed: index };
      if (index >= working.nextPoints.length) {
        return {
          point: { multiplier, mode: 'NEW_SEQUENCE', index, label: phaseLabel('NEW_SEQUENCE', index) },
          state: promoteNewPoints(next),
        };
      }
      return {
        point: { multiplier, mode: 'NEW_SEQUENCE', index, label: phaseLabel('NEW_SEQUENCE', index) },
        state: next,
      };
    }
    // Defensive: NEW_SEQUENCE with nothing left — fall back to repeat cycling.
    working.mode = 'REPEAT';
  }

  // Plain deterministic repeat consumption (REPEAT or REPEAT_EXTENDED).
  const index = working.repeatPosition + 1;
  const multiplier = nextRepeatPoint(working, index);
  const next: CrashSequenceStateData = { ...working, repeatPosition: index };
  return {
    point: {
      multiplier,
      mode: working.mode === 'REPEAT_EXTENDED' ? 'REPEAT_EXTENDED' : 'REPEAT',
      index,
      label: phaseLabel('REPEAT', index),
    },
    state: next,
  };
}

// ----------------------------------------------------------------------------
// Validation (admin writes) — every rule from the operator requirements.
// ----------------------------------------------------------------------------

export class CrashPointsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CrashPointsValidationError';
  }
}

/**
 * Validates and normalizes an admin-supplied list of crash multipliers.
 * Rules: number[], non-empty, ≤ MAX_SEQUENCE_POINTS entries, every point
 * > 1.00, ≤ MAX_CRASH_POINT, at most 2 decimal places. Returns rounded 2dp
 * numbers in list order.
 */
export function validateCrashPoints(raw: unknown, field = 'points'): number[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new CrashPointsValidationError(`${field} must be a non-empty list of multipliers`);
  }
  if (raw.length > MAX_SEQUENCE_POINTS) {
    throw new CrashPointsValidationError(
      `${field} must contain at most ${MAX_SEQUENCE_POINTS} points`,
    );
  }
  const out: number[] = [];
  raw.forEach((value, i) => {
    const label = `${field}[${i + 1}]`;
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new CrashPointsValidationError(`${label} must be a number`);
    }
    const rounded = Math.round(value * 100) / 100;
    if (Math.abs(value - rounded) > 1e-9) {
      throw new CrashPointsValidationError(
        `${label} must have at most ${CRASH_POINT_DECIMALS} decimal places (e.g. 1.20)`,
      );
    }
    if (rounded <= MIN_CRASH_POINT) {
      throw new CrashPointsValidationError(`${label} must be greater than 1.00x`);
    }
    if (rounded > MAX_CRASH_POINT) {
      throw new CrashPointsValidationError(
        `${label} must not exceed ${MAX_CRASH_POINT.toFixed(2)}x`,
      );
    }
    out.push(rounded);
  });
  return out;
}

/** Validates a repeat extension (integer ≥ 1). */
export function validateRepeatExtension(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1) {
    throw new CrashPointsValidationError('extension must be a positive integer (≥ 1)');
  }
  if (raw > MAX_SEQUENCE_POINTS) {
    throw new CrashPointsValidationError(`extension must not exceed ${MAX_SEQUENCE_POINTS}`);
  }
  return raw;
}

