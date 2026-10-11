/**
 * Crash round lifecycle state machine.
 *
 * The ONLY legal transitions are the ones listed below. Invalid transitions
 * (e.g. CRASHED → BETTING_OPEN) throw an invariant error and are never
 * performed, no matter what a client sends or a stray timer suggests.
 */

export type RoundStatus =
  | 'CREATED'
  | 'BETTING_OPEN'
  | 'RUNNING'
  | 'CRASHED'
  | 'SETTLED'
  | 'COMPLETED';

const ALLOWED_TRANSITIONS: Readonly<Record<RoundStatus, readonly RoundStatus[]>> = {
  CREATED: ['BETTING_OPEN', 'COMPLETED'],
  BETTING_OPEN: ['RUNNING', 'COMPLETED'],
  RUNNING: ['CRASHED'],
  CRASHED: ['SETTLED'],
  SETTLED: ['COMPLETED'],
  COMPLETED: [],
};

export class InvalidRoundTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`Invalid crash round state transition: ${from} → ${to}`);
    this.name = 'InvalidRoundTransitionError';
  }
}

export function assertRoundTransition(from: RoundStatus, to: RoundStatus): void {
  if ((ALLOWED_TRANSITIONS[from] ?? []).includes(to)) return;
  throw new InvalidRoundTransitionError(from, to);
}

export function canTransition(from: RoundStatus, to: RoundStatus): boolean {
  return (ALLOWED_TRANSITIONS[from] ?? []).includes(to);
}