/**
 * TANVION ROYALE — Sky Rocket operator-configured crash-point sequence service.
 *
 * The ONLY mutable home of the sequence state (CrashSequenceState singleton).
 * Rules implemented here:
 *
 *  - CONSUMPTION: exactly one configured multiplier per round, consumed at
 *    round creation inside the engine's scheduler transaction. That tx already
 *    holds the scheduler advisory lock (single writer across all instances);
 *    a `SELECT … FOR UPDATE` row lock is taken as defense in depth, so two
 *    simultaneous round creations can never consume the same position.
 *  - PERSISTENCE: every position counter lives in the DATABASE, so the exact
 *    next point survives restarts, deployments and reconnects.
 *  - RUNNING-ROUND SAFETY: consumption happens once, at creation; the point is
 *    frozen on the round row. Admin updates below never touch existing rounds.
 *  - ADMIN SAFETY: every mutation validates strictly, requires ADMIN/SUPER_ADMIN
 *    (enforced by the controller guard) and writes an immutable GameAuditLog
 *    entry with admin id, previous + new configuration and the optional reason.
 *  - HONEST FAIRNESS: when a sequence is configured it — not the HMAC seed —
 *    determines the outcome. Round rows are labeled crashSource=CONFIGURED and
 *    verification says so. Rounds without a configured sequence keep the full
 *    provably-fair pipeline, unchanged.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import type { CrashSequenceMode } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { crashError } from './crash-errors';
import {
  consumeNextPoint,
  reconfigureOriginalState,
  phaseLabel,
  validateCrashPoints,
  validateRepeatExtension,
  CrashPointsValidationError,
  type ConfiguredCrashPoint,
  type CrashSequenceStateData,
} from './crash-sequence-core';

/** Public (player-safe) sequence info — NEVER includes future multipliers. */
export interface CrashSequencePublicView {
  /** True when rounds consume the operator sequence instead of seeds. */
  active: boolean;
  mode: CrashSequenceMode;
  /** 1-based position of the most recently consumed point in its phase. */
  lastIndex: number | null;
  label: string | null;
}

export interface CrashSequenceAdminView extends CrashSequencePublicView {
  originalPoints: number[];
  originalConsumed: number;
  remainingOriginal: number;
  repeatPosition: number;
  repeatEnd: number | null;
  nextPoints: number[] | null;
  newConsumed: number;
  version: number;
  updatedAt: string | null;
}

interface CrashSequenceStateRow {
  id: string;
  gameSlug: string;
  mode: CrashSequenceMode;
  originalPoints: Prisma.JsonValue;
  nextPoints: Prisma.JsonValue | null;
  originalConsumed: number;
  repeatPosition: number;
  repeatEnd: number;
  newConsumed: number;
  version: number;
  updatedAt: Date;
}

function pointsFromJson(raw: Prisma.JsonValue | null): number[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
}

function toStateData(row: CrashSequenceStateRow): CrashSequenceStateData {
  return {
    mode: row.mode,
    originalPoints: pointsFromJson(row.originalPoints) ?? [],
    nextPoints: pointsFromJson(row.nextPoints),
    originalConsumed: row.originalConsumed,
    repeatPosition: row.repeatPosition,
    repeatEnd: row.repeatEnd,
    newConsumed: row.newConsumed,
  };
}

function toRowUpdate(state: CrashSequenceStateData): Prisma.CrashSequenceStateUpdateInput {
  return {
    mode: state.mode,
    originalPoints: state.originalPoints,
    nextPoints: state.nextPoints === null ? Prisma.DbNull : state.nextPoints,
    originalConsumed: state.originalConsumed,
    repeatPosition: state.repeatPosition,
    repeatEnd: state.repeatEnd,
    newConsumed: state.newConsumed,
    version: { increment: 1 },
  };
}

/** Minimal shape of a sequence row needed for the immutable audit entry. */
interface SequenceStateSnapshot {
  mode: string;
  originalPoints: unknown;
  nextPoints: unknown;
  originalConsumed: number;
  repeatPosition: number;
  repeatEnd: number;
  newConsumed: number;
}

function snapshotMetadata(s: SequenceStateSnapshot): Record<string, unknown> {
  return {
    mode: s.mode,
    originalPoints: s.originalPoints,
    nextPoints: s.nextPoints,
    originalConsumed: s.originalConsumed,
    repeatPosition: s.repeatPosition,
    repeatEnd: s.repeatEnd,
    newConsumed: s.newConsumed,
  };
}

@Injectable()
export class CrashSequenceService {
  private readonly logger = new Logger(CrashSequenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  // --------------------------------------------------------------------------
  // Engine-side consumption (called ONLY inside the scheduler transaction)
  // --------------------------------------------------------------------------

  /**
   * Consume the next configured crash point for a new round. MUST be called
   * inside the engine's scheduler transaction (advisory lock already held).
   *
   * Returns null when no sequence is configured — the engine then derives the
   * point from the provably-fair seed exactly as before.
   */
  async consumeForNewRound(
    db: Prisma.TransactionClient,
    gameSlug: string,
  ): Promise<ConfiguredCrashPoint | null> {
    // Row lock: defense in depth against any writer outside the scheduler tx.
    const rows = (await db.$queryRaw<CrashSequenceStateRow[]>`
      SELECT id, "gameSlug", mode, "originalPoints", "nextPoints",
             "originalConsumed", "repeatPosition", "repeatEnd",
             "newConsumed", version, "updatedAt"
      FROM "CrashSequenceState"
      WHERE "gameSlug" = ${gameSlug}
      FOR UPDATE
    `) as unknown as CrashSequenceStateRow[];
    const row = rows[0];
    if (!row || row.mode === 'PROVABLY_FAIR') return null;

    const state = toStateData(row);
    if (state.originalPoints.length === 0) return null;

    const consumed = consumeNextPoint(state);
    if (!consumed) return null;

    // Advance the persisted position in the SAME transaction that creates the
    // round — atomic with the round row, so no position is ever double-spent
    // and none is lost if round creation fails.
    await db.crashSequenceState.update({
      where: { id: row.id },
      data: toRowUpdate(consumed.state),
    });
    // SECURITY: the consumed multiplier is a PREDETERMINED upcoming crash
    // result. It is NEVER logged — at any level, including debug — because
    // anyone with log access could otherwise learn the next crash point before
    // betting (LOG_LEVEL is not a reliable gate: it is not wired into Nest's
    // logger here). Only non-sensitive metadata is recorded.
    this.logger.debug(
      `Sequence point consumed (phase=${consumed.point.mode}, index=${consumed.point.index}, nextMode=${consumed.state.mode}) — value withheld until the round settles`,
    );
    return consumed.point;
  }

  /** Last consumed position (player-safe view; no future multipliers). */
  async getPublicView(gameSlug: string): Promise<CrashSequencePublicView> {
    const row = await this.prisma.crashSequenceState.findUnique({
      where: { gameSlug },
    });
    if (!row || row.mode === 'PROVABLY_FAIR') {
      return { active: false, mode: 'PROVABLY_FAIR', lastIndex: null, label: null };
    }
    const state = toStateData(row as unknown as CrashSequenceStateRow);
    const lastIndex = this.lastConsumedIndex(state);
    return {
      active: true,
      mode: state.mode,
      lastIndex,
      label: lastIndex == null ? null : phaseLabel(state.mode, lastIndex),
    };
  }

  private lastConsumedIndex(state: CrashSequenceStateData): number | null {
    switch (state.mode) {
      case 'ORIGINAL':
        return state.originalConsumed || null;
      case 'NEW_SEQUENCE':
        return state.newConsumed || null;
      case 'REPEAT':
      case 'REPEAT_EXTENDED':
        return state.repeatPosition || null;
      default:
        return null;
    }
  }

  // --------------------------------------------------------------------------
  // Admin view (future multipliers ARE included — admin-only endpoint)
  // --------------------------------------------------------------------------

  async getAdminView(gameSlug: string): Promise<CrashSequenceAdminView> {
    const row = await this.prisma.crashSequenceState.findUnique({
      where: { gameSlug },
    });
    if (!row) {
      return {
        active: false,
        mode: 'PROVABLY_FAIR',
        lastIndex: null,
        label: null,
        originalPoints: [],
        originalConsumed: 0,
        remainingOriginal: 0,
        repeatPosition: 0,
        repeatEnd: null,
        nextPoints: null,
        newConsumed: 0,
        version: 0,
        updatedAt: null,
      };
    }
    const state = toStateData(row as unknown as CrashSequenceStateRow);
    const lastIndex = this.lastConsumedIndex(state);
    return {
      active: true,
      mode: state.mode,
      lastIndex,
      label: lastIndex == null ? null : phaseLabel(state.mode, lastIndex),
      originalPoints: state.originalPoints,
      originalConsumed: state.originalConsumed,
      remainingOriginal: Math.max(0, state.originalPoints.length - state.originalConsumed),
      repeatPosition: state.repeatPosition,
      repeatEnd: state.repeatEnd > 0 ? state.repeatEnd : null,
      nextPoints: state.nextPoints,
      newConsumed: state.newConsumed,
      version: row.version,
      updatedAt: row.updatedAt.toISOString(),
    };
  }


  // --------------------------------------------------------------------------
  // Admin mutations (validated + audited; NEVER touch a running round)
  // --------------------------------------------------------------------------

  /**
   * Configure the original list — or, while the ORIGINAL phase is running, edit
   * only its FUTURE points: the already-consumed prefix must stay identical and
   * the persisted position is PRESERVED (consumed points are never replayed).
   * Full replacement is only possible before the sequence starts.
   */
  async setOriginalPoints(
    admin: AuthenticatedUser,
    gameSlug: string,
    rawPoints: unknown,
    reason: string | undefined,
    context: { ip?: string; userAgent?: string } = {},
  ): Promise<CrashSequenceAdminView> {
    const points = this.validated(() => validateCrashPoints(rawPoints, 'points'));
    const previous = await this.prisma.crashSequenceState.findUnique({
      where: { gameSlug },
    });

    if (previous && previous.mode === 'ORIGINAL') {
      // Editing future points is allowed; already-consumed points are frozen.
      const consumed = pointsFromJson(previous.originalPoints) ?? [];
      const before = consumed.slice(0, previous.originalConsumed);
      const mismatch = before.some((p, i) => points[i] !== p);
      if (points.length < before.length || mismatch) {
        crashError(
          'VALIDATION_ERROR',
          'Cannot change already-consumed points — only future points may be edited',
          400,
        );
      }
    } else if (previous && previous.mode !== 'PROVABLY_FAIR') {
      crashError(
        'INVALID_BET_STATE',
        'Original list is locked while REPEAT / NEW_SEQUENCE is running — queue new points via next-points instead',
        409,
      );
    }

    const data = reconfigureOriginalState(
      previous ? toStateData(previous as unknown as CrashSequenceStateRow) : null,
      points,
    );
    const row = await this.prisma.crashSequenceState.upsert({
      where: { gameSlug },
      create: {
        gameSlug,
        mode: data.mode,
        originalPoints: data.originalPoints,
        nextPoints: data.nextPoints === null ? Prisma.DbNull : data.nextPoints,
        originalConsumed: data.originalConsumed,
        repeatPosition: data.repeatPosition,
        repeatEnd: data.repeatEnd,
        newConsumed: data.newConsumed,
      },
      update: {
        mode: data.mode,
        originalPoints: data.originalPoints,
        nextPoints: Prisma.DbNull,
        // Position is PRESERVED when the ORIGINAL phase is already running —
        // already-consumed points are never replayed (see
        // reconfigureOriginalState).
        originalConsumed: data.originalConsumed,
        repeatPosition: data.repeatPosition,
        repeatEnd: data.repeatEnd,
        newConsumed: data.newConsumed,
        version: { increment: 1 },
      },
    });

    await this.audit(admin, gameSlug, 'SEQUENCE_POINTS_SET', previous, row, reason, context);
    this.logger.log(`Admin ${admin.id} configured ${points.length} original crash points`);
    return this.getAdminView(gameSlug);
  }

  /** Queue the NEW admin points that start after the current repeat ends. */
  async setNextPoints(
    admin: AuthenticatedUser,
    gameSlug: string,
    rawPoints: unknown,
    reason: string | undefined,
    context: { ip?: string; userAgent?: string } = {},
  ): Promise<CrashSequenceAdminView> {
    const points = this.validated(() => validateCrashPoints(rawPoints, 'nextPoints'));
    const previous = await this.prisma.crashSequenceState.findUnique({
      where: { gameSlug },
    });
    if (!previous || previous.mode === 'PROVABLY_FAIR') {
      crashError(
        'INVALID_BET_STATE',
        'Configure the original crash points first — new points activate after the repeat finishes',
        409,
      );
    }
    const row = await this.prisma.crashSequenceState.update({
      where: { gameSlug },
      data: { nextPoints: points, version: { increment: 1 } },
    });
    await this.audit(admin, gameSlug, 'SEQUENCE_NEXT_POINTS_SET', previous, row, reason, context);
    this.logger.log(
      `Admin ${admin.id} queued ${points.length} new crash points after the current repeat`,
    );
    return this.getAdminView(gameSlug);
  }

  /**
   * Extend the CURRENT repeat WITHOUT resetting its position:
   * repeatEnd := repeatPosition + extension (R31 + 10 → ends at R41).
   * The running round is never touched; the change applies to upcoming rounds.
   */
  async setRepeatExtension(
    admin: AuthenticatedUser,
    gameSlug: string,
    rawExtension: unknown,
    reason: string | undefined,
    context: { ip?: string; userAgent?: string } = {},
  ): Promise<{ state: CrashSequenceAdminView; message: string }> {
    const extension = this.validated(() => validateRepeatExtension(rawExtension));
    const previous = await this.prisma.crashSequenceState.findUnique({
      where: { gameSlug },
    });
    if (!previous || (previous.mode !== 'REPEAT' && previous.mode !== 'REPEAT_EXTENDED')) {
      crashError(
        'INVALID_BET_STATE',
        'The repeat phase has not started yet — extensions apply to the current repeat only',
        409,
      );
    }
    const from = previous.repeatPosition;
    const to = from + extension;
    const row = await this.prisma.crashSequenceState.update({
      where: { gameSlug },
      data: { mode: 'REPEAT_EXTENDED', repeatEnd: to, version: { increment: 1 } },
    });
    await this.audit(admin, gameSlug, 'SEQUENCE_REPEAT_EXTENDED', previous, row, reason, context);
    this.logger.log(`Admin ${admin.id} extended the repeat from #${from} to #${to}`);
    return {
      state: await this.getAdminView(gameSlug),
      message: `Repeat extended from #${from} to #${to}.`,
    };
  }


  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private validated<T>(fn: () => T): T {
    try {
      return fn();
    } catch (error) {
      if (error instanceof CrashPointsValidationError) {
        crashError('VALIDATION_ERROR', error.message, 400);
      }
      throw error;
    }
  }

  private async audit(
    admin: AuthenticatedUser,
    gameSlug: string,
    action: string,
    previous: SequenceStateSnapshot | null,
    next: SequenceStateSnapshot,
    reason: string | undefined,
    context: { ip?: string; userAgent?: string },
  ): Promise<void> {
    await this.prisma.gameAuditLog.create({
      data: {
        gameSlug,
        userId: admin.id,
        action,
        metadata: {
          adminId: admin.id,
          adminRoles: admin.roles,
          reason: reason ?? null,
          userAgent: context.userAgent ?? null,
          previous: previous ? snapshotMetadata(previous) : null,
          next: snapshotMetadata(next),
        } as unknown as Prisma.InputJsonValue,
        ip: context.ip ?? null,
      },
    });
  }
}

