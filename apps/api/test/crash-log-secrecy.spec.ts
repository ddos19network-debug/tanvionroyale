/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * MUST-FIX #3 regression tests — NO pre-round log may reveal the crash result.
 *
 *   F. A consumed sequence point never appears (at any log level) in the
 *      sequence service output.
 *   G. The round engine never logs the configured point, the provably-fair
 *      derived point, or the reconstructed crash time of a LIVE round.
 *   H. Behaviour is unchanged: the point is still consumed/frozen and the
 *      engine still holds the exact crash point internally — only the LOGS are
 *      sanitized.
 *
 * Every Nest Logger level is captured and inspected as one blob, because the
 * audit found LOG_LEVEL is not wired into Nest's logger here: secrecy must not
 * depend on log configuration.
 */

import { Logger } from '@nestjs/common';
import { crashDurationMs } from '../src/modules/crash/crash-math';
import { CrashRoundEngine } from '../src/modules/crash/crash-round-engine';
import { CrashSequenceService } from '../src/modules/crash/crash-sequence.service';
import { consumeNextPoint, initialSequenceState } from '../src/modules/crash/crash-sequence-core';

jest.setTimeout(30_000);

/** Captures every Nest log level; returns the joined lines. */
function captureLogs(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spies = ['log', 'debug', 'warn', 'error', 'verbose'].map((level) => {
    const spy: any = jest.spyOn(Logger.prototype as any, level);
    spy.mockImplementation((message: any, ...rest: any[]) => {
      lines.push(`[${level}] ${String(message)} ${rest.map((r) => String(r)).join(' ')}`);
    });
    return spy;
  });
  return { lines, restore: () => spies.forEach((spy) => spy.mockRestore()) };
}

/** A distinctive value so a leak is unambiguous in the captured log text. */
const SECRET_MULTIPLIER = 7.77;

describe('CrashSequenceService — a consumed future point is never logged (F)', () => {
  it('F/H: consumption still advances the persisted position and returns the point', async () => {
    const stateRow = {
      id: 'seq-1',
      gameSlug: 'sky-rocket',
      mode: 'ORIGINAL',
      originalPoints: [1.2, SECRET_MULTIPLIER, 3.33],
      nextPoints: null,
      originalConsumed: 1,
      repeatPosition: 0,
      repeatEnd: 0,
      newConsumed: 0,
      version: 3,
      updatedAt: new Date(),
    };
    const db: any = {
      $queryRaw: jest.fn(async () => [stateRow]),
      crashSequenceState: { update: jest.fn(async () => stateRow) },
    };
    const service = new CrashSequenceService({} as any);
    const capture = captureLogs();
    try {
      const point = await service.consumeForNewRound(db, 'sky-rocket');

      // H: the sequence behaviour itself is untouched.
      expect(point).not.toBeNull();
      expect(point!.multiplier).toBe(SECRET_MULTIPLIER);
      expect(point!.label).toBe('ORIGINAL #2');
      expect(point!.index).toBe(2);
      expect(point!.mode).toBe('ORIGINAL');
      // The position still advances exactly once, in the caller's transaction.
      expect(db.crashSequenceState.update).toHaveBeenCalledTimes(1);
      expect(db.crashSequenceState.update.mock.calls[0][0].data.originalConsumed).toBe(2);
    } finally {
      capture.restore();
    }

    // F: not the multiplier, not any "×" value, not the old leaky wording.
    const logged = capture.lines.join('\n');
    expect(logged).not.toContain('7.77');
    expect(logged).not.toContain('×');
    expect(logged).not.toMatch(/kept secret/i);
    expect(logged).not.toMatch(/Sequence consumed/);
    expect(logged).not.toMatch(/multiplier/i);
    // …but safe metadata is retained (mode + index, both already public).
    expect(logged).toMatch(/phase=ORIGINAL/);
    expect(logged).toMatch(/index=2/);
    expect(logged).toMatch(/nextMode=ORIGINAL/);
  });

  it('F: the pure state machine is unchanged (H) — points still run in order', () => {
    const state = initialSequenceState([1.2, SECRET_MULTIPLIER, 3.33]);
    const first = consumeNextPoint(state)!;
    const second = consumeNextPoint(first.state)!;
    expect([first.point.multiplier, second.point.multiplier]).toEqual([1.2, SECRET_MULTIPLIER]);
    expect(second.point.label).toBe('ORIGINAL #2');
  });
});

function makeEngine(configuredPoint: number | null) {
  const engine = new CrashRoundEngine({} as any, {} as any, {} as any, {} as any, {
    consumeForNewRound:
      configuredPoint == null
        ? jest.fn(async () => null)
        : jest.fn(async () => ({
            multiplier: configuredPoint,
            mode: 'REPEAT',
            index: 9,
            label: 'REPEAT #9',
          })),
  } as any);
  return engine;
}

describe('CrashRoundEngine — committing a round never logs its crash point (G)', () => {
  it('G/H: the configured point is frozen on the row but never logged', async () => {
    const engine = makeEngine(3.33);
    const createdRow = {
      id: 'round-1',
      roundNumber: 5,
      serverSeedHash: 'a'.repeat(64),
      status: 'CREATED',
    };
    const db: any = {
      crashRound: {
        findFirst: jest.fn(async () => ({ roundNumber: 4 })),
        create: jest.fn(async () => createdRow),
      },
    };

    const capture = captureLogs();
    let row: any;
    try {
      row = await (engine as any).createRoundInTx(db);
    } finally {
      capture.restore();
    }

    // H: the pre-determined point is still consumed and frozen, unchanged.
    expect(row).toBe(createdRow);
    const data = db.crashRound.create.mock.calls[0][0].data;
    expect(data.crashPointConfigured).toBe(3.33);
    expect(data.crashSource).toBe('CONFIGURED');
    expect(data.sequenceMode).toBe('REPEAT');
    expect(data.sequenceIndex).toBe(9);

    // G: no value, no "×", no legacy leaky wording.
    const logged = capture.lines.join('\n');
    expect(logged).not.toContain('3.33');
    expect(logged).not.toContain('×');
    expect(logged).not.toContain('configuredPoint=');
    expect(logged).not.toMatch(/kept secret/i);
    // …while safe metadata (round number, hash prefix, phase + index) remains.
    expect(logged).toMatch(/Round #5 committed/);
    expect(logged).toMatch(/source=CONFIGURED/);
    expect(logged).toMatch(/index=9/);
  });

  it('G: the provably-fair path logs no derived crash point either', async () => {
    const engine = makeEngine(null);
    const createdRow = {
      id: 'round-2',
      roundNumber: 6,
      serverSeedHash: 'b'.repeat(64),
      status: 'CREATED',
    };
    const db: any = {
      crashRound: {
        findFirst: jest.fn(async () => ({ roundNumber: 5 })),
        create: jest.fn(async () => createdRow),
      },
    };

    const capture = captureLogs();
    try {
      await (engine as any).createRoundInTx(db);
    } finally {
      capture.restore();
    }

    const data = db.crashRound.create.mock.calls[0][0].data;
    expect(data.crashSource).toBe('PROVABLY_FAIR');
    expect(data.crashPointConfigured).toBeNull();

    const logged = capture.lines.join('\n');
    expect(logged).not.toContain('×');
    expect(logged).not.toMatch(/crashPoint=\d/);
    expect(logged).not.toMatch(/kept secret/i);
    expect(logged).toMatch(/source=PROVABLY_FAIR/);
  });
});

describe('CrashRoundEngine — recovering a LIVE round logs no result/time (G)', () => {
  it('G/H: the point is resumed internally but the crash time is not disclosed', async () => {
    const secret = 8.88;
    const startAt = new Date(Date.now() - 1_000);
    const round = {
      id: 'round-9',
      gameSlug: 'sky-rocket',
      status: 'RUNNING',
      roundNumber: 77,
      crashSource: 'CONFIGURED',
      crashPointConfigured: secret,
      crashPointSeedEnc: null,
      clientSeed: 'c'.repeat(32),
      nonce: 1,
      startAt,
    };
    const engine = makeEngine(null);
    (engine as any).prisma = { crashRound: { findFirst: jest.fn(async () => round) } };

    const capture = captureLogs();
    try {
      await (engine as any).recoverRunningRound();
    } finally {
      capture.restore();
    }

    // H: the engine really did resume the same pre-determined result…
    const timing = (engine as any).running.get('round-9');
    expect(timing.crashMultiplier).toBe(secret);
    expect(timing.crashAtMs).toBe(startAt.getTime() + crashDurationMs(secret));

    // …without writing it (or the derived crash instant) to any log level.
    const logged = capture.lines.join('\n');
    const derivedCrashAt = new Date(startAt.getTime() + crashDurationMs(secret)).toISOString();
    expect(logged).not.toContain('8.88');
    expect(logged).not.toContain('×');
    expect(logged).not.toContain(derivedCrashAt);
    expect(logged).not.toMatch(/crashes at/);
    expect(logged).toMatch(/Recovered RUNNING round #77/);
  });
});

