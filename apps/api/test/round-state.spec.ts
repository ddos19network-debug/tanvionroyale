/**
 * Unit tests for the crash round lifecycle state machine.
 */

import {
  assertRoundTransition,
  canTransition,
  InvalidRoundTransitionError,
} from '../src/modules/crash/round-state';

describe('round-state', () => {
  it('allows exactly the documented lifecycle', () => {
    expect(canTransition('CREATED', 'BETTING_OPEN')).toBe(true);
    expect(canTransition('BETTING_OPEN', 'RUNNING')).toBe(true);
    expect(canTransition('RUNNING', 'CRASHED')).toBe(true);
    expect(canTransition('CRASHED', 'SETTLED')).toBe(true);
    expect(canTransition('SETTLED', 'COMPLETED')).toBe(true);
  });

  it('rejects CRASHED → BETTING_OPEN and RUNNING → BETTING_OPEN', () => {
    expect(canTransition('CRASHED', 'BETTING_OPEN')).toBe(false);
    expect(canTransition('RUNNING', 'BETTING_OPEN')).toBe(false);
    expect(() => assertRoundTransition('CRASHED', 'BETTING_OPEN')).toThrow(
      InvalidRoundTransitionError,
    );
    expect(() => assertRoundTransition('RUNNING', 'BETTING_OPEN')).toThrow(
      InvalidRoundTransitionError,
    );
  });

  it('rejects skipping the settlement flow and terminal COMPLETED moves', () => {
    expect(canTransition('RUNNING', 'SETTLED')).toBe(false);
    expect(canTransition('BETTING_OPEN', 'CRASHED')).toBe(false);
    expect(canTransition('COMPLETED', 'BETTING_OPEN')).toBe(false);
    expect(canTransition('COMPLETED', 'RUNNING')).toBe(false);
  });
});
