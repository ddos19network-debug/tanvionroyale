import type { CrashSnapshotView, MultiplierUpdateEvent } from '@/lib/api/crash';

/** Reconcile a live server sample without reviving a finished or unrelated round. */
export function applyRunningUpdate(
  snapshot: CrashSnapshotView | null,
  event: MultiplierUpdateEvent,
): CrashSnapshotView | null {
  const round = snapshot?.round;
  if (!snapshot || !round || round.id !== event.roundId ||
      event.state !== 'RUNNING' || !Number.isFinite(event.serverTime) ||
      typeof event.multiplier !== 'number' || !Number.isFinite(event.multiplier) ||
      event.multiplier < 1 ||
      !['CREATED', 'BETTING_OPEN', 'RUNNING'].includes(round.status) ||
      event.serverTime < Date.parse(round.serverTime) ||
      event.multiplier < (round.currentMultiplier ?? 1)) return snapshot;

  return {
    ...snapshot,
    round: {
      ...round,
      status: 'RUNNING',
      bettingOpen: false,
      currentMultiplier: event.multiplier,
      serverTime: new Date(event.serverTime).toISOString(),
    },
  };
}

/** A delayed REST response must not roll live flight back into betting. */
export function isOlderSnapshot(
  current: CrashSnapshotView | null,
  incoming: CrashSnapshotView,
): boolean {
  const before = current?.round;
  const after = incoming.round;
  if (!before) return false;
  if (!after) return true;
  if (after.roundNumber !== before.roundNumber) return after.roundNumber < before.roundNumber;
  if (after.id !== before.id) return true;
  const phases = ['CREATED', 'BETTING_OPEN', 'RUNNING', 'CRASHED', 'SETTLED', 'COMPLETED'];
  return phases.indexOf(after.status) < phases.indexOf(before.status) ||
    Date.parse(after.serverTime) < Date.parse(before.serverTime) ||
    (after.status === 'RUNNING' && before.status === 'RUNNING' &&
      (after.currentMultiplier ?? 1) < (before.currentMultiplier ?? 1));
}
