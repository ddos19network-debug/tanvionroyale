/**
 * Sky Rocket operator-configured crash-point sequence — PURE state machine
 * tests (crash-sequence-core). These map to the acceptance scenarios:
 *
 *   TEST 1: 100 original points run P1→P100 in order, then repeat begins.
 *   TEST 2: Repeat at R31 + extension 10 → R32..R41, then new points.
 *   TEST 3: Repeat at R31 + extension 20 → R32..R51, then new points.
 *   TEST 4: consumption freezes one point per round (running-round safety is
 *           structural — see crash-round-engine comments).
 *   TEST 5: state is pure data → restart resumes at the exact next position.
 *   TEST 8: two consecutive consumptions never return the same position.
 *  + Validation rules (multiplier > 1.00, 2dp, cap) and repeat wrap-around.
 */

import {
  consumeNextPoint,
  initialSequenceState,
  reconfigureOriginalState,
  validateCrashPoints,
  validateRepeatExtension,
  CrashPointsValidationError,
  type CrashSequenceStateData,
} from '../src/modules/crash/crash-sequence-core';

/** Drives `count` rounds through the state machine, returning the multipliers. */
function run(state: CrashSequenceStateData, count: number): {
  multipliers: number[];
  labels: string[];
  modes: string[];
  state: CrashSequenceStateData;
} {
  const multipliers: number[] = [];
  const labels: string[] = [];
  const modes: string[] = [];
  let cursor = state;
  for (let i = 0; i < count; i += 1) {
    const result = consumeNextPoint(cursor);
    if (!result) throw new Error('sequence unexpectedly exhausted');
    multipliers.push(result.point.multiplier);
    labels.push(result.point.label);
    modes.push(result.point.mode);
    cursor = result.state;
  }
  return { multipliers, labels, modes, state: cursor };
}

/** Builds an ORIGINAL state positioned exactly like the spec's R31 example. */
function repeatAt31(original: number[]): CrashSequenceStateData {
  let state = initialSequenceState(original);
  ({ state } = run(state, original.length)); // consume all originals
  ({ state } = run(state, 31)); // R1..R31
  return state;
}

describe('crash sequence — ORIGINAL phase (TEST 1)', () => {
  it('consumes the configured points strictly in order, one per round', () => {
    const points = [1.2, 1.45, 2.1, 3.5, 1.08, 5.2, 1.1, 4.8];
    const { multipliers, labels, modes } = run(initialSequenceState(points), points.length);
    expect(multipliers).toEqual(points);
    expect(labels[0]).toBe('ORIGINAL #1');
    expect(labels[7]).toBe('ORIGINAL #8');
    expect(modes.every((m) => m === 'ORIGINAL')).toBe(true);
  });

  it('flips to REPEAT only AFTER the last original point is consumed (R1 = P1 next)', () => {
    const points = [1.2, 1.5, 2.3, 1.1, 3.2];
    const first = consumeNextPoint(initialSequenceState(points))!;
    expect(first.point.multiplier).toBe(1.2);
    expect(first.state.mode).toBe('ORIGINAL');

    const { state } = run(initialSequenceState(points), points.length);
    expect(state.mode).toBe('REPEAT');
    expect(state.originalConsumed).toBe(points.length);
    expect(state.repeatPosition).toBe(0);

    const r1 = consumeNextPoint(state)!;
    expect(r1.point.multiplier).toBe(1.2); // R1 = P1 — deterministic
    expect(r1.point.label).toBe('REPEAT #1');
  });
});

describe('crash sequence — REPEAT + EXTENSION (TEST 2, TEST 3)', () => {
  const original = Array.from({ length: 100 }, (_, i) => 1.01 + i / 100); // P1..P100

  it('R31 + extension 10 → continues R32..R41 then NEW_SEQUENCE (TEST 2)', () => {
    const nextPoints = [1.3, 2.4, 1.7]; // N1..N3
    // Admin saves extension 10 at R31 (service sets repeatEnd = 31 + 10).
    let state = repeatAt31(original);
    state = { ...state, mode: 'REPEAT_EXTENDED', repeatEnd: 41 };

    const { multipliers, labels, modes, state: after } = run(state, 10);
    expect(multipliers).toEqual(original.slice(31, 41)); // P32..P41 — no reset
    expect(labels[0]).toBe('REPEAT #32');
    expect(labels[9]).toBe('REPEAT #41');
    expect(modes.every((m) => m === 'REPEAT_EXTENDED')).toBe(true);
    expect(after.repeatPosition).toBe(41);
    expect(after.repeatPosition).toBeGreaterThan(31); // position NOT reset

    // With next points queued, R42 does not exist — N1 starts exactly here.
    state = { ...after, nextPoints };
    const n1 = consumeNextPoint(state)!;
    expect(n1.point.mode).toBe('NEW_SEQUENCE');
    expect(n1.point.multiplier).toBe(1.3);
    expect(n1.point.label).toBe('NEW #1');
  });

  it('R31 + extension 20 → continues R32..R51 then NEW_SEQUENCE (TEST 3)', () => {
    let state = repeatAt31(original);
    state = { ...state, mode: 'REPEAT_EXTENDED', repeatEnd: 51 };

    const { multipliers, labels, state: after } = run(state, 20);
    expect(multipliers).toEqual(original.slice(31, 51)); // P32..P51
    expect(labels[19]).toBe('REPEAT #51');
    expect(after.repeatPosition).toBe(51);
    expect(after.mode).toBe('REPEAT_EXTENDED');

    state = { ...after, nextPoints: [1.3, 2.4] };
    const n1 = consumeNextPoint(state)!;
    expect(n1.point.mode).toBe('NEW_SEQUENCE');
    expect(n1.point.multiplier).toBe(1.3);
  });

  it('new points run in order and are then PROMOTED to the repeat source (never discarded)', () => {
    const state: CrashSequenceStateData = {
      ...repeatAt31(original),
      mode: 'REPEAT_EXTENDED',
      repeatEnd: 41,
      nextPoints: [1.3, 2.4, 1.7],
    };
    // R32..R41 (extension), then N1..N3.
    const { multipliers, modes, state: promoted } = run(state, 10 + 3);
    expect(multipliers.slice(10)).toEqual([1.3, 2.4, 1.7]);
    expect(modes[10]).toBe('NEW_SEQUENCE');
    expect(modes[12]).toBe('NEW_SEQUENCE');
    // After the last new point the game continues deterministically over the
    // promoted list — never silently discarded, never a random pick.
    expect(promoted.mode).toBe('REPEAT');
    expect(promoted.originalPoints).toEqual([1.3, 2.4, 1.7]);
    expect(promoted.nextPoints).toBeNull();
    expect(promoted.repeatPosition).toBe(0);

    const nextRound = consumeNextPoint(promoted)!;
    expect(nextRound.point.multiplier).toBe(1.3); // R1 of the new list
  });
});


describe('crash sequence — restart persistence + concurrency semantics (TEST 5, TEST 8)', () => {
  const original = [1.2, 1.5, 2.3, 1.1, 3.2];

  it('state is plain serializable data — persisting + reloading resumes exactly (TEST 5)', () => {
    let state = initialSequenceState(original);
    ({ state } = run(state, 2)); // P1, P2
    const persisted = JSON.parse(JSON.stringify(state)); // ← what the DB stores
    const resumed = consumeNextPoint(persisted)!;
    expect(resumed.point.multiplier).toBe(2.3); // P3 — not restarted at P1
  });

  it('repeat position survives persistence (R31 → next is R32, never R1)', () => {
    const big = Array.from({ length: 100 }, (_, i) => 1.01 + i / 100);
    const persisted = JSON.parse(JSON.stringify(repeatAt31(big)));
    const next = consumeNextPoint(persisted)!;
    expect(next.point.label).toBe('REPEAT #32');
    expect(next.point.multiplier).toBe(big[31]);
  });

  it('two sequential consumptions always advance (no double consumption of one point)', () => {
    let state = initialSequenceState(original);
    const a = consumeNextPoint(state)!;
    const b = consumeNextPoint(a.state)!;
    expect(a.point.index).toBe(1);
    expect(b.point.index).toBe(2);
    expect(a.point.multiplier).not.toBe(b.point.multiplier);
    // The DB write of a.state is what serializes parallel creators — two
    // transactions cannot both read position 1 and both write position 2
    // (advisory lock + FOR UPDATE row lock in CrashSequenceService).
  });

  it('repeat wraps deterministically when no new points are queued (R[n+k] = P[k])', () => {
    let state = initialSequenceState(original);
    ({ state } = run(state, original.length)); // originals done
    const { multipliers, state: afterCycle } = run(state, original.length); // R1..R5
    expect(multipliers).toEqual(original);
    const wrap = run(afterCycle, 2); // R6, R7 → P1, P2
    expect(wrap.multipliers).toEqual([1.2, 1.5]);
    expect(wrap.labels[0]).toBe('REPEAT #6');
  });
});

describe('crash sequence — validation', () => {
  it('rejects multipliers at or below 1.00x', () => {
    expect(() => validateCrashPoints([1.2, 1.0])).toThrow(CrashPointsValidationError);
    expect(() => validateCrashPoints([0.9])).toThrow(CrashPointsValidationError);
    expect(() => validateCrashPoints([1])).toThrow(CrashPointsValidationError);
  });

  it('rejects more than 2 decimal places', () => {
    expect(() => validateCrashPoints([1.234])).toThrow(CrashPointsValidationError);
    expect(() => validateCrashPoints([1.2, 2.1, 3.5])).not.toThrow();
  });

  it('rejects empty lists, non-numbers and oversized values', () => {
    expect(() => validateCrashPoints([])).toThrow(CrashPointsValidationError);
    expect(() => validateCrashPoints(['1.2' as unknown as number])).toThrow(
      CrashPointsValidationError,
    );
    expect(() => validateCrashPoints([10001])).toThrow(CrashPointsValidationError);
  });

  it('normalizes 2dp values and preserves order', () => {
    expect(validateCrashPoints([1.2, 1.45, 2.1, 3.5, 1.08, 5.2])).toEqual([
      1.2, 1.45, 2.1, 3.5, 1.08, 5.2,
    ]);
  });

  it('rejects invalid repeat extensions', () => {
    expect(() => validateRepeatExtension(0)).toThrow(CrashPointsValidationError);
    expect(() => validateRepeatExtension(1.5)).toThrow(CrashPointsValidationError);
    expect(() => validateRepeatExtension(-3)).toThrow(CrashPointsValidationError);
    expect(validateRepeatExtension(10)).toBe(10);
    expect(validateRepeatExtension(20)).toBe(20);
  });
});

describe('crash sequence — admin edits never reset a running sequence', () => {
  it('starts fresh at P1 for a first configuration', () => {
    const state = reconfigureOriginalState(null, [1.2, 1.5, 2.3]);
    expect(state.mode).toBe('ORIGINAL');
    expect(state.originalConsumed).toBe(0);
    expect(consumeNextPoint(state)!.point.multiplier).toBe(1.2);
  });

  it('editing FUTURE points mid-ORIGINAL preserves the position (no replay)', () => {
    const original = [1.2, 1.5, 2.3, 1.1, 3.2];
    let state = initialSequenceState(original);
    ({ state } = run(state, 2)); // P1, P2 consumed

    // Admin keeps the frozen prefix and edits only the future points.
    const edited = reconfigureOriginalState(state, [1.2, 1.5, 9.9, 8.8, 7.7]);
    expect(edited.mode).toBe('ORIGINAL');
    expect(edited.originalConsumed).toBe(2);

    const next = consumeNextPoint(edited)!;
    expect(next.point.multiplier).toBe(9.9); // P3 of the NEW list — not P1
    expect(next.point.label).toBe('ORIGINAL #3');
  });

  it('a previously PROVABLY_FAIR row is configured from P1 (position was never used)', () => {
    const previous: CrashSequenceStateData = {
      mode: 'PROVABLY_FAIR',
      originalPoints: [],
      nextPoints: null,
      originalConsumed: 0,
      repeatPosition: 0,
      repeatEnd: 0,
      newConsumed: 0,
    };
    const state = reconfigureOriginalState(previous, [2.2, 3.3]);
    expect(state.mode).toBe('ORIGINAL');
    expect(consumeNextPoint(state)!.point.multiplier).toBe(2.2);
  });

  it('an edit with nothing future left continues with the repeat over the new list', () => {
    const original = [1.2, 1.5];
    let state = initialSequenceState(original);
    ({ state } = run(state, 2)); // all originals consumed → REPEAT

    // Reconfiguring after the original list finished is blocked by the service
    // (REPEAT/NEW_SEQUENCE lock the list) — the pure rule is still deterministic.
    const edited = reconfigureOriginalState(
      { ...state, mode: 'ORIGINAL', originalConsumed: 2 },
      [1.2, 1.5],
    );
    expect(edited.mode).toBe('REPEAT');
    expect(edited.originalConsumed).toBe(2);
    expect(edited.repeatEnd).toBe(2);
    expect(consumeNextPoint(edited)!.point.multiplier).toBe(1.2); // R1 = P1
  });
});

