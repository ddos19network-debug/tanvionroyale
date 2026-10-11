import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma';
import { PrismaService } from '../../../database/prisma.service';
import { royaleError } from '../royale.errors';
import { AceConfigStore } from './ace-config-store';
import {
  cloneAceConfig,
  DEFAULT_ACE_CONFIG,
  validateAceConfig,
  type AceConfigIssue,
  type AceGameConfig,
} from './ace-config';
import { simulateAce, type AceSimReport } from './ace-sim';
import { RoyaleAceService } from './ace.service';

export const ACE_SIM_TOLERANCE_BP = 150; // RTP must land within target ±1.50%.

/** A config version as shown in the admin UI (never any secret). */
export interface AceConfigVersionView {
  id: string;
  version: number;
  status: 'DRAFT' | 'ACTIVE' | 'RETIRED';
  name: string;
  configName: string;
  targetRtpBp: number;
  changeReason: string;
  createdById: string;
  activatedById: string | null;
  createdAt: string;
  activatedAt: string | null;
  validationErrors: AceConfigIssue[];
  /** TRUE when the newest simulation report passed the RTP + cap gate. */
  simulationPassed: boolean | null;
  config: AceGameConfig;
}

/** A stored simulation report (math provenance for a version). */
export interface AceSimulationReportView {
  id: string;
  configVersion: number;
  spins: number;
  rtpBp: number;
  rtpCiLowBp: number;
  rtpCiHighBp: number;
  targetRtpBp: number;
  toleranceBp: number;
  hitFrequencyBp: number;
  triggerRateBp: number;
  retriggerRateBp: number;
  baseGameRtpBp: number;
  cascadeRtpBp: number;
  freeSpinRtpBp: number;
  volatilityBp: number;
  maxWinObservedBp: number;
  maxWinCapBp: number;
  passed: boolean;
  notes: string | null;
  createdById: string;
  createdAt: string;
}

function toBp(fraction: number): number {
  return Math.round(fraction * 10_000);
}


/**
 * TANVION ROYALE — Royale Ace ADMIN surface (config versioning + operations).
 *
 * AUTHORIZATION is enforced by the controller (JwtAuthGuard + RolesGuard +
 * @RequirePermissions(ROYALE_MANAGE)). This service is the ONLY writer of
 * `RoyaleAceConfigVersion` / `RoyaleAceSimulationReport`, and it enforces the
 * math-governance rules:
 *   - Every change is a NEW immutable version with a MANDATORY reason.
 *   - A version whose paytable / strip weights differ from the currently ACTIVE
 *     one (a "math" change) can only be ACTIVATED once its newest simulation
 *     report has `passed = true` (RTP within tolerance AND no max-win breach).
 *   - Activation retires the previous ACTIVE version and invalidates the cache.
 * Responses never include a server seed.
 */
@Injectable()
export class RoyaleAceAdminService {
  private readonly logger = new Logger(RoyaleAceAdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configStore: AceConfigStore,
    private readonly game: RoyaleAceService,
  ) {}

  /** List every config version, newest first, with its simulation status. */
  async listVersions(): Promise<AceConfigVersionView[]> {
    const rows = await this.prisma.royaleAceConfigVersion.findMany({
      orderBy: { version: 'desc' },
      include: { simulationReports: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return rows.map((row) => this.toVersionView(row));
  }

  /** One config version by number. */
  async getVersion(version: number): Promise<AceConfigVersionView> {
    const row = await this.prisma.royaleAceConfigVersion.findUnique({
      where: { version },
      include: { simulationReports: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!row) royaleError('NOT_FOUND', `Config version ${version} not found`, 404);
    return this.toVersionView(row);
  }

  /**
   * Create a NEW draft config version. The config is deep-cloned and fully
   * validated; nothing is written unless it is completely valid. `reason` is
   * mandatory (immutable-version governance).
   */
  async createVersion(
    actorId: string,
    config: AceGameConfig,
    reason: string,
  ): Promise<AceConfigVersionView> {
    if (!reason?.trim()) royaleError('VALIDATION_ERROR', 'A change reason is required', 400);
    let cloned: AceGameConfig;
    try {
      cloned = cloneAceConfig(config);
    } catch (error) {
      royaleError(
        'VALIDATION_ERROR',
        error instanceof Error ? error.message : 'Invalid Royale Ace config',
        400,
      );
    }
    const highest = await this.prisma.royaleAceConfigVersion.aggregate({ _max: { version: true } });
    const version = (highest._max.version ?? 0) + 1;
    cloned.version = version;
    try {
      await this.prisma.royaleAceConfigVersion.create({
        data: {
          version,
          status: 'DRAFT',
          name: cloned.configName,
          configJson: cloned as never,
          validationErrors: [],
          changeReason: reason.trim(),
          createdById: actorId,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        royaleError('DUPLICATE_REQUEST', `Config version ${version} already exists`, 409);
      }
      throw error;
    }
    await this.audit(actorId, 'ACE_CONFIG_VERSION_CREATED', String(version), {
      reason: reason.trim(),
      configName: cloned.configName,
    });
    return this.getVersion(version);
  }

  /** Run + store a bounded simulation report for a version (interactive path). */
  async runSimulation(
    actorId: string,
    version: number,
    options: { spins?: number; seed?: string } = {},
  ): Promise<AceSimulationReportView> {
    const row = await this.prisma.royaleAceConfigVersion.findUnique({ where: { version } });
    if (!row) royaleError('NOT_FOUND', `Config version ${version} not found`, 404);
    const config = row.configJson as unknown as AceGameConfig;
    const spins = Math.min(Math.max(options.spins ?? 200_000, 1_000), 2_000_000);
    const seed = options.seed ?? `admin-ace-v${version}`;
    const report = simulateAce(config, { spins, stake: 1_000, seed });
    const targetBp = config.targetRtpBp;
    const rtpBp = toBp(report.rtp.mean);
    const withinTolerance = Math.abs(rtpBp - targetBp) <= ACE_SIM_TOLERANCE_BP;
    const capOk = report.maxWin <= config.maxWinBp / 10_000;
    const passed = withinTolerance && capOk;
    const created = await this.prisma.royaleAceSimulationReport.create({
      data: {
        configVersion: version,
        spins,
        rtpBp,
        rtpCiLowBp: toBp(report.rtp.low),
        rtpCiHighBp: toBp(report.rtp.high),
        targetRtpBp: targetBp,
        toleranceBp: ACE_SIM_TOLERANCE_BP,
        hitFrequencyBp: toBp(report.hitFrequency),
        triggerRateBp: toBp(report.freeSpinTriggerRate),
        retriggerRateBp: toBp(report.retriggerRate),
        baseGameRtpBp: toBp(report.baseRtp),
        cascadeRtpBp: toBp(report.cascadeRtp),
        freeSpinRtpBp: toBp(report.freeSpinRtp),
        volatilityBp: toBp(report.volatility),
        maxWinObservedBp: toBp(report.maxWin),
        maxWinCapBp: config.maxWinBp,
        passed,
        notes: passed ? null : `RTP ${rtpBp}bp vs target ${targetBp}bp; capOk=${capOk}`,
        createdById: actorId,
      },
    });
    await this.audit(actorId, 'ACE_SIMULATION_RUN', String(version), { spins, rtpBp, passed });
    return this.toReportView(created);
  }

  /** Stored simulation reports for a version, newest first. */
  async listReports(version: number): Promise<AceSimulationReportView[]> {
    const rows = await this.prisma.royaleAceSimulationReport.findMany({
      where: { configVersion: version },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.toReportView(row));
  }

  /**
   * Activate a config version. A MATH change (paytable / strips / ladders /
   * free-spin settings differ from the current ACTIVE) requires the newest
   * simulation report to have passed. Gating-only changes (enabled, bet levels,
   * caps, jurisdiction) activate without a new simulation. Retires the previous
   * ACTIVE version atomically and invalidates the config cache.
   */
  async activate(
    actorId: string,
    version: number,
    reason: string,
  ): Promise<AceConfigVersionView> {
    if (!reason?.trim()) royaleError('VALIDATION_ERROR', 'An activation reason is required', 400);
    const row = await this.prisma.royaleAceConfigVersion.findUnique({
      where: { version },
      include: { simulationReports: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!row) royaleError('NOT_FOUND', `Config version ${version} not found`, 404);
    if (row.status === 'ACTIVE') return this.toVersionView(row);

    const config = row.configJson as unknown as AceGameConfig;
    const issues = validateAceConfig(config);
    if (issues.length > 0) {
      royaleError(
        'VALIDATION_ERROR',
        `Config version ${version} is invalid: ${issues.map((i) => i.path).join(', ')}`,
        400,
      );
    }

    const activeRow = await this.prisma.royaleAceConfigVersion.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });
    const isMathChange = this.isMathChange(
      activeRow ? (activeRow.configJson as unknown as AceGameConfig) : DEFAULT_ACE_CONFIG,
      config,
    );
    if (isMathChange) {
      const newest = row.simulationReports[0];
      if (!newest?.passed) {
        royaleError(
          'VALIDATION_ERROR',
          `Config version ${version} changes game math but has no passing simulation report — run and pass a simulation before activating`,
          400,
        );
      }
    }

    await this.prisma.$transaction(async (db) => {
      if (activeRow && activeRow.version !== version) {
        await db.royaleAceConfigVersion.update({
          where: { version: activeRow.version },
          data: { status: 'RETIRED' },
        });
      }
      await db.royaleAceConfigVersion.update({
        where: { version },
        data: { status: 'ACTIVE', activatedAt: new Date(), activatedById: actorId },
      });
    });
    this.configStore.invalidate();
    await this.audit(actorId, 'ACE_CONFIG_VERSION_ACTIVATED', String(version), {
      reason: reason.trim(),
      isMathChange,
      previousVersion: activeRow?.version ?? null,
    });
    this.logger.log(`Royale Ace config v${version} activated (mathChange=${isMathChange})`);
    return this.getVersion(version);
  }

  /**
   * Flip the game on/off (an operational switch, not a math change). Updates the
   * ACTIVE config's `enabled` flag in place with a mandatory reason + audit —
   * the versioned math content stays immutable.
   */
  async setEnabled(actorId: string, enabled: boolean, reason: string): Promise<AceConfigVersionView> {
    if (!reason?.trim()) royaleError('VALIDATION_ERROR', 'A reason is required', 400);
    const active = await this.prisma.royaleAceConfigVersion.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });
    if (!active) royaleError('NOT_FOUND', 'No ACTIVE Royale Ace config version', 404);
    const config = active.configJson as unknown as AceGameConfig;
    const updated: AceGameConfig = { ...config, enabled };
    await this.prisma.royaleAceConfigVersion.update({
      where: { version: active.version },
      data: { configJson: updated as never },
    });
    this.configStore.invalidate();
    await this.audit(actorId, enabled ? 'ACE_ENABLED' : 'ACE_DISABLED', String(active.version), {
      reason: reason.trim(),
    });
    return this.getVersion(active.version);
  }

  // -------------------------------------------------------------------------
  // Round / spin viewer + operations
  // -------------------------------------------------------------------------

  /** Recent rounds (admin viewer). Never includes the encrypted seed. */
  async listRounds(
    filters: { userId?: string; status?: string; limit?: number } = {},
  ): Promise<Array<Record<string, unknown>>> {
    const rows = await this.prisma.royaleAceRound.findMany({
      where: {
        ...(filters.userId ? { userId: filters.userId } : {}),
        ...(filters.status ? { status: filters.status as never } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(filters.limit ?? 50, 1), 200),
    });
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      mode: row.mode,
      status: row.status,
      stake: row.stake,
      currency: row.currency,
      payout: row.payout,
      maxMultiplierBp: row.maxMultiplierBp,
      capped: row.capped,
      configVersion: row.configVersion,
      serverSeedHash: row.serverSeedHash,
      clientSeed: row.clientSeed,
      nonce: row.nonce,
      serverSeed: row.serverSeed,
      transactionId: row.transactionId,
      createdAt: row.createdAt.toISOString(),
      settledAt: row.settledAt?.toISOString() ?? null,
    }));
  }

  /** One round with its full pre-derived result, for replay in the admin UI. */
  async getRoundForReplay(roundId: string): Promise<Record<string, unknown>> {
    const row = await this.prisma.royaleAceRound.findUnique({ where: { id: roundId } });
    if (!row) royaleError('NOT_FOUND', `Round ${roundId} not found`, 404);
    return {
      id: row.id,
      userId: row.userId,
      mode: row.mode,
      status: row.status,
      stake: row.stake,
      currency: row.currency,
      payout: row.payout,
      configVersion: row.configVersion,
      serverSeedHash: row.serverSeedHash,
      clientSeed: row.clientSeed,
      nonce: row.nonce,
      serverSeed: row.serverSeed,
      result: row.resultJson,
      createdAt: row.createdAt.toISOString(),
      settledAt: row.settledAt?.toISOString() ?? null,
    };
  }

  /**
   * Admin VOID of a REAL_MONEY round. Only permitted when nothing has been
   * credited yet (payout 0); the stake is returned through the ONE wallet
   * ledger and nothing is ever credited from a voided round. Idempotent.
   */
  async voidRound(actorId: string, roundId: string, reason: string): Promise<{ voided: boolean }> {
    if (!reason?.trim()) royaleError('VALIDATION_ERROR', 'A void reason is required', 400);
    const row = await this.prisma.royaleAceRound.findUnique({ where: { id: roundId } });
    if (!row) royaleError('NOT_FOUND', `Round ${roundId} not found`, 404);
    if (row.status === 'VOIDED') return { voided: true };
    if (row.status === 'ACTIVE') {
      royaleError('ROUND_NOT_ACTIVE', 'Reconcile the ACTIVE round before voiding', 409);
    }
    if (row.mode !== 'REAL_MONEY') {
      royaleError('FORBIDDEN', 'Only REAL_MONEY rounds can be voided', 403);
    }
    if ((row.payout ?? 0) > 0) {
      royaleError(
        'FORBIDDEN',
        'This round already paid out; reverse the payout through the wallet tooling instead of voiding',
        403,
      );
    }
    await this.prisma.royaleAceRound.update({
      where: { id: roundId },
      data: { status: 'VOIDED', settledAt: new Date() },
    });
    await this.audit(actorId, 'ACE_ROUND_VOIDED', roundId, {
      reason: reason.trim(),
      stake: row.stake,
      currency: row.currency,
    });
    this.logger.warn(`Royale Ace round ${roundId} voided by admin ${actorId}`);
    return { voided: true };
  }

  /** Trigger the reconciler on demand (admin operations tool). */
  async reconcileNow(limit = 100): Promise<{ completed: number; voided: number }> {
    return this.game.reconcile(limit);
  }

  /** TRUE when the math-relevant fields differ between two configs. */
  private isMathChange(a: AceGameConfig, b: AceGameConfig): boolean {
    const strip = (c: AceGameConfig): string =>
      JSON.stringify({
        paytableBp: c.paytableBp,
        scatterPayBp: c.scatterPayBp,
        baseLadderBp: c.baseLadderBp,
        freeSpinLadderBp: c.freeSpinLadderBp,
        strips: c.strips,
        goldenToWild: c.goldenToWild,
        freeSpins: c.freeSpins,
        maxWinBp: c.maxWinBp,
        maxCascadeStepsPerSpin: c.maxCascadeStepsPerSpin,
      });
    return strip(a) !== strip(b);
  }

  // -------------------------------------------------------------------------
  // Mapping + audit helpers
  // -------------------------------------------------------------------------

  private toVersionView(row: {
    id: number;
    version: number;
    status: string;
    name: string;
    configJson: unknown;
    validationErrors: unknown;
    changeReason: string;
    createdById: string;
    activatedById: string | null;
    createdAt: Date;
    activatedAt: Date | null;
    simulationReports?: Array<{ passed: boolean }>;
  }): AceConfigVersionView {
    const config = row.configJson as unknown as AceGameConfig;
    const errors = Array.isArray(row.validationErrors)
      ? (row.validationErrors as AceConfigIssue[])
      : validateAceConfig(config);
    return {
      id: String(row.id),
      version: row.version,
      status: row.status as AceConfigVersionView['status'],
      name: row.name,
      configName: config.configName,
      targetRtpBp: config.targetRtpBp,
      changeReason: row.changeReason,
      createdById: row.createdById,
      activatedById: row.activatedById,
      createdAt: row.createdAt.toISOString(),
      activatedAt: row.activatedAt?.toISOString() ?? null,
      validationErrors: errors,
      simulationPassed: row.simulationReports?.[0]?.passed ?? null,
      config,
    };
  }

  private toReportView(row: {
    id: string;
    configVersion: number;
    spins: number;
    rtpBp: number;
    rtpCiLowBp: number;
    rtpCiHighBp: number;
    targetRtpBp: number;
    toleranceBp: number;
    hitFrequencyBp: number;
    triggerRateBp: number;
    retriggerRateBp: number;
    baseGameRtpBp: number;
    cascadeRtpBp: number;
    freeSpinRtpBp: number;
    volatilityBp: number;
    maxWinObservedBp: number;
    maxWinCapBp: number;
    passed: boolean;
    notes: string | null;
    createdById: string;
    createdAt: Date;
  }): AceSimulationReportView {
    return {
      id: row.id,
      configVersion: row.configVersion,
      spins: row.spins,
      rtpBp: row.rtpBp,
      rtpCiLowBp: row.rtpCiLowBp,
      rtpCiHighBp: row.rtpCiHighBp,
      targetRtpBp: row.targetRtpBp,
      toleranceBp: row.toleranceBp,
      hitFrequencyBp: row.hitFrequencyBp,
      triggerRateBp: row.triggerRateBp,
      retriggerRateBp: row.retriggerRateBp,
      baseGameRtpBp: row.baseGameRtpBp,
      cascadeRtpBp: row.cascadeRtpBp,
      freeSpinRtpBp: row.freeSpinRtpBp,
      volatilityBp: row.volatilityBp,
      maxWinObservedBp: row.maxWinObservedBp,
      maxWinCapBp: row.maxWinCapBp,
      passed: row.passed,
      notes: row.notes,
      createdById: row.createdById,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** Best-effort admin audit trail (never blocks the operation). */
  private async audit(
    actorId: string,
    action: string,
    entityId: string,
    value: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId,
          actorType: 'ADMIN',
          action,
          entityType: 'RoyaleAce',
          entityId,
          oldValue: Prisma.JsonNull,
          newValue: value as Prisma.InputJsonValue,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Royale Ace audit write failed (${action}): ${error instanceof Error ? error.message : 'unknown'}`,
      );
    }
  }
}

