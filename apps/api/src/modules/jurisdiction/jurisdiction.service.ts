import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { normalizeCountryCode } from '../../common/geo/trusted-geo';
import type { JurisdictionRule } from '../../generated/prisma';

/**
 * TANVION ROYALE — PART A: central jurisdiction & currency control.
 *
 * The ONE place that answers "may a REAL_MONEY stake be accepted from this
 * country, in this currency?" for every Royale game (Plinko, Mines, Ace).
 *
 * FAIL-CLOSED posture — `resolve()` returns `allowed: false` unless the rule
 * positively allows it:
 *   - a non ISO-3166-1 alpha-2 country code (including null/unknown) BLOCKS;
 *   - a country with NO JurisdictionRule row BLOCKS;
 *   - `status === 'BLOCKED'` BLOCKS;
 *   - `effectiveFrom` in the future BLOCKS (the decision is not live yet);
 *   - a currency outside `allowedCurrencies` BLOCKS (subset of BDT/USD, and
 *     never an implicit FX conversion).
 *
 * Reads are served from a SHORT-TTL in-memory cache (see `cacheTtlMs`) that is
 * INVALIDATED by every admin write, so flipping a country to BLOCKED takes
 * effect on the very next gate evaluation.
 *
 * The tables this reads/writes hold NO balances. `JurisdictionAuditLog` is
 * APPEND-ONLY: this service never updates or deletes a row in it.
 */

/** Master kill switch key — stops every Royale REAL_MONEY action at once. */
export const MASTER_SWITCH_KEY = 'REAL_MONEY_ALL';

/** Per-game kill switch key (`GAME:plinko`, `GAME:mines`, `GAME:royale-ace`). */
export function gameSwitchKey(gameSlug: string): string {
  return `GAME:${gameSlug}`;
}

/** The only currencies the platform can ever stake (no auto-FX). */
export const SUPPORTED_CURRENCIES = ['BDT', 'USD'] as const;

export type JurisdictionBlockCode =
  | 'UNKNOWN_COUNTRY'
  | 'NO_RULE'
  | 'COUNTRY_BLOCKED'
  | 'RULE_NOT_EFFECTIVE'
  | 'CURRENCY_NOT_ALLOWED';

export interface JurisdictionVerdict {
  allowed: boolean;
  /** `OK` when allowed, otherwise the precise fail-closed block code. */
  code: 'OK' | JurisdictionBlockCode;
  reason: string;
  /** Canonical country actually evaluated (null when it could not be resolved). */
  countryCode: string | null;
  /** Canonical upper-case currency that was evaluated. */
  currency: string;
}

export interface SwitchVerdict {
  enabled: boolean;
  reason: string;
  /** True when no admin row exists (no kill switch engaged). */
  defaulted: boolean;
}

export interface UpsertRuleInput {
  countryCode: string;
  status: 'ALLOWED' | 'BLOCKED';
  allowedCurrencies?: string[];
  licenceRef?: string | null;
  reason: string;
  effectiveFrom?: Date;
}

export interface SetSwitchInput {
  key: string;
  enabled: boolean;
  reason?: string | null;
}

interface RulesCache {
  at: number;
  rows: JurisdictionRule[];
}

interface SwitchCache {
  at: number;
  byKey: Map<string, { key: string; enabled: boolean; reason: string | null }>;
}

@Injectable()
export class JurisdictionService {
  /**
   * Short TTL for cached reads. Admin writes invalidate immediately, so the
   * TTL only bounds how stale a NON-admin change (manual SQL, replica lag)
   * can ever be.
   */
  cacheTtlMs = 15_000;

  private rulesCache: RulesCache | null = null;
  private switchCache: SwitchCache | null = null;

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // Reads (cached, fail-closed)
  // ---------------------------------------------------------------------------

  /**
   * The single jurisdiction + currency decision for one REAL_MONEY stake.
   * Never throws for a "no" — callers branch on `allowed` (the eligibility
   * gate turns it into a structured 403).
   */
  async resolve(
    countryCode: string | null | undefined,
    currency: string,
  ): Promise<JurisdictionVerdict> {
    const code = normalizeCountryCode(countryCode);
    const cur = typeof currency === 'string' ? currency.trim().toUpperCase() : '';

    if (!code) {
      return {
        allowed: false,
        code: 'UNKNOWN_COUNTRY',
        reason: 'Country could not be resolved from a trusted server-side source',
        countryCode: null,
        currency: cur,
      };
    }
    if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(cur)) {
      return {
        allowed: false,
        code: 'CURRENCY_NOT_ALLOWED',
        reason: `Currency "${cur || '(empty)'}" is not supported`,
        countryCode: code,
        currency: cur,
      };
    }

    const rules = await this.loadRules();
    const rule = rules.find((r) => r.countryCode === code);
    if (!rule) {
      return {
        allowed: false,
        code: 'NO_RULE',
        reason: `No jurisdiction rule exists for ${code} (default is BLOCKED)`,
        countryCode: code,
        currency: cur,
      };
    }
    if (rule.status !== 'ALLOWED') {
      return {
        allowed: false,
        code: 'COUNTRY_BLOCKED',
        reason: rule.reason || `${code} is blocked for real-money play`,
        countryCode: code,
        currency: cur,
      };
    }
    if (rule.effectiveFrom.getTime() > Date.now()) {
      return {
        allowed: false,
        code: 'RULE_NOT_EFFECTIVE',
        reason: `The ${code} permission is not effective yet`,
        countryCode: code,
        currency: cur,
      };
    }
    const allowedCurrencies = (rule.allowedCurrencies ?? []).map((c) => c.toUpperCase());
    if (!allowedCurrencies.includes(cur)) {
      return {
        allowed: false,
        code: 'CURRENCY_NOT_ALLOWED',
        reason: `Currency ${cur} is not permitted in ${code} (no auto-FX)`,
        countryCode: code,
        currency: cur,
      };
    }
    return {
      allowed: true,
      code: 'OK',
      reason: rule.reason || `${code} is allowed for ${cur}`,
      countryCode: code,
      currency: cur,
    };
  }

  /**
   * Kill-switch state. ABSENCE of a row means "no kill switch engaged"
   * (enabled) — the fail-closed posture for jurisdictions comes from the
   * default-BLOCKED rule, not from these switches.
   */
  async switchState(key: string): Promise<SwitchVerdict> {
    const byKey = await this.loadSwitches();
    const row = byKey.get(key);
    if (!row) {
      return {
        enabled: true,
        reason: 'No kill switch configured for this key (default: enabled)',
        defaulted: true,
      };
    }
    return {
      enabled: row.enabled,
      reason: row.enabled
        ? row.reason || 'Enabled by administrator'
        : row.reason || 'Disabled by administrator',
      defaulted: false,
    };
  }

  /** Drop every cached read. Called by EVERY admin write below. */
  invalidateCache(): void {
    this.rulesCache = null;
    this.switchCache = null;
  }

  private async loadRules(): Promise<JurisdictionRule[]> {
    const now = Date.now();
    if (this.rulesCache && now - this.rulesCache.at < this.cacheTtlMs) {
      return this.rulesCache.rows;
    }
    const rows = await this.prisma.jurisdictionRule.findMany({
      orderBy: { countryCode: 'asc' },
    });
    this.rulesCache = { at: now, rows };
    return rows;
  }

  private async loadSwitches(): Promise<SwitchCache['byKey']> {
    const now = Date.now();
    if (this.switchCache && now - this.switchCache.at < this.cacheTtlMs) {
      return this.switchCache.byKey;
    }
    const rows = await this.prisma.globalGameSwitch.findMany({});
    const byKey = new Map<string, { key: string; enabled: boolean; reason: string | null }>();
    for (const row of rows) byKey.set(row.key, row);
    this.switchCache = { at: now, byKey };
    return byKey;
  }

  // ---------------------------------------------------------------------------
  // Admin writes (always invalidate the cache + append an audit row)
  // ---------------------------------------------------------------------------

  async listRules(): Promise<JurisdictionRule[]> {
    return this.prisma.jurisdictionRule.findMany({ orderBy: { countryCode: 'asc' } });
  }

  async getRule(countryCode: string): Promise<JurisdictionRule> {
    const code = requireCountryCode(countryCode);
    const rule = await this.prisma.jurisdictionRule.findUnique({ where: { countryCode: code } });
    if (!rule) throw new NotFoundException(`No jurisdiction rule for ${code}`);
    return rule;
  }

  /**
   * Create or update one country's rule. `reason` is REQUIRED for both
   * ALLOWED and BLOCKED decisions, and an ALLOWED decision must carry the
   * licence reference it rests on. The previous decision is written to the
   * append-only audit log before the new one is applied.
   */
  async upsertRule(input: UpsertRuleInput, adminId: string): Promise<JurisdictionRule> {
    const countryCode = requireCountryCode(input.countryCode);
    const reason = requireReason(input.reason);
    const status = normalizeStatus(input.status);
    const allowedCurrencies = normalizeCurrencies(input.allowedCurrencies, status);
    const licenceRef = input.licenceRef?.trim() ? input.licenceRef.trim() : null;
    if (status === 'ALLOWED' && !licenceRef) {
      throw new BadRequestException('licenceRef is required for an ALLOWED rule');
    }

    const previous = await this.prisma.jurisdictionRule.findUnique({
      where: { countryCode },
    });

    const data = {
      status,
      allowedCurrencies,
      licenceRef,
      reason,
      effectiveFrom: input.effectiveFrom ?? new Date(),
      updatedByAdminId: adminId,
    };

    const rule = previous
      ? await this.prisma.jurisdictionRule.update({ where: { countryCode }, data })
      : await this.prisma.jurisdictionRule.create({ data: { countryCode, ...data } });

    await this.appendAudit({
      actorAdminId: adminId,
      action: previous ? 'UPDATE' : 'CREATE',
      countryCode,
      oldStatus: previous?.status ?? null,
      newStatus: status,
      oldCurrencies: previous?.allowedCurrencies ?? [],
      newCurrencies: allowedCurrencies,
      oldLicenceRef: previous?.licenceRef ?? null,
      newLicenceRef: licenceRef,
      reason,
    });

    this.invalidateCache();
    return rule;
  }

  /**
   * Bulk-block: set `BLOCKED` on every country listed, or on EVERY rule when
   * `all` is true (the "block everyone" emergency action). Creates a BLOCKED
   * row for any listed country that has none, so the decision is explicit and
   * auditable rather than only relying on the default.
   */
  async bulkBlock(
    input: { countryCode?: string; all?: boolean; reason: string },
    adminId: string,
  ): Promise<{ blocked: number }> {
    const reason = requireReason(input.reason);
    const codes = input.all
      ? (await this.listRules()).map((r) => r.countryCode)
      : [requireCountryCode(input.countryCode)];

    let blocked = 0;
    for (const countryCode of codes) {
      const previous = await this.prisma.jurisdictionRule.findUnique({
        where: { countryCode },
      });
      if (previous) {
        await this.prisma.jurisdictionRule.update({
          where: { countryCode },
          data: { status: 'BLOCKED', allowedCurrencies: [], reason, updatedByAdminId: adminId },
        });
      } else {
        await this.prisma.jurisdictionRule.create({
          data: {
            countryCode,
            status: 'BLOCKED',
            allowedCurrencies: [],
            licenceRef: null,
            reason,
            updatedByAdminId: adminId,
          },
        });
      }
      await this.appendAudit({
        actorAdminId: adminId,
        action: 'BULK_BLOCK',
        countryCode,
        oldStatus: previous?.status ?? null,
        newStatus: 'BLOCKED',
        oldCurrencies: previous?.allowedCurrencies ?? [],
        newCurrencies: [],
        oldLicenceRef: previous?.licenceRef ?? null,
        newLicenceRef: null,
        reason,
      });
      blocked += 1;
    }

    this.invalidateCache();
    return { blocked };
  }

  /** Flip a kill switch (REAL_MONEY_ALL or GAME:<slug>). */
  async setSwitch(
    input: SetSwitchInput,
    adminId: string,
  ): Promise<{ key: string; enabled: boolean }> {
    const key = (input.key ?? '').trim();
    if (!key) throw new BadRequestException('Switch key is required');
    if (key !== MASTER_SWITCH_KEY && !/^GAME:[a-z0-9-]+$/.test(key)) {
      throw new BadRequestException('Unknown switch key');
    }
    const enabled = input.enabled === true;
    const reason = enabled
      ? input.reason?.trim() || 'Enabled by administrator'
      : requireReason(input.reason);

    const previous = await this.prisma.globalGameSwitch.findUnique({ where: { key } });
    if (previous) {
      await this.prisma.globalGameSwitch.update({
        where: { key },
        data: { enabled, reason, updatedByAdminId: adminId },
      });
    } else {
      await this.prisma.globalGameSwitch.create({
        data: { key, enabled, reason, updatedByAdminId: adminId },
      });
    }

    await this.appendAudit({
      actorAdminId: adminId,
      action: previous ? 'SWITCH' : 'SWITCH_CREATE',
      countryCode: '*',
      oldStatus: previous ? String(previous.enabled) : null,
      newStatus: String(enabled),
      oldCurrencies: [],
      newCurrencies: [],
      oldLicenceRef: previous ? previous.key : null,
      newLicenceRef: key,
      reason,
    });

    this.invalidateCache();
    return { key, enabled };
  }

  /**
   * Every switch the admin UI needs, including the ones that have never been
   * written (absent == no kill switch engaged == enabled).
   */
  async listSwitches(): Promise<
    {
      key: string;
      enabled: boolean;
      reason: string | null;
      updatedByAdminId: string | null;
      updatedAt: Date;
    }[]
  > {
    const rows = await this.prisma.globalGameSwitch.findMany({ orderBy: { key: 'asc' } });
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const keys = [MASTER_SWITCH_KEY, 'GAME:plinko', 'GAME:mines', 'GAME:royale-ace'];
    return keys.map((key) => {
      const row = byKey.get(key);
      return {
        key,
        enabled: row?.enabled ?? true,
        reason: row?.reason ?? null,
        updatedByAdminId: row?.updatedByAdminId ?? null,
        updatedAt: row?.updatedAt ?? new Date(0),
      };
    });
  }

  /** Append-only change history (never updated or deleted). */
  async listAudit(
    limit = 100,
  ): Promise<
    {
      id: string;
      actorAdminId: string;
      action: string;
      countryCode: string;
      oldStatus: string | null;
      newStatus: string | null;
      oldCurrencies: string[];
      newCurrencies: string[];
      reason: string;
      createdAt: Date;
    }[]
  > {
    return this.prisma.jurisdictionAuditLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 500),
    });
  }

  /** CSV export of the whole country table (for compliance records). */
  async exportCsv(): Promise<string> {
    const rows = await this.listRules();
    const header =
      'countryCode,status,allowedCurrencies,licenceRef,reason,effectiveFrom,updatedByAdminId,updatedAt';
    const lines = rows.map((r) =>
      [
        r.countryCode,
        r.status,
        `"${(r.allowedCurrencies ?? []).join('|')}"`,
        csvCell(r.licenceRef),
        csvCell(r.reason),
        r.effectiveFrom.toISOString(),
        csvCell(r.updatedByAdminId),
        r.updatedAt.toISOString(),
      ].join(','),
    );
    return [header, ...lines].join('\n');
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async appendAudit(entry: {
    actorAdminId: string;
    action: string;
    countryCode: string;
    oldStatus: string | null;
    newStatus: string | null;
    oldCurrencies: string[];
    newCurrencies: string[];
    oldLicenceRef: string | null;
    newLicenceRef: string | null;
    reason: string;
  }): Promise<void> {
    await this.prisma.jurisdictionAuditLog.create({ data: entry });
  }
}

function csvCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  const escaped = value.replace(/"/g, '""');
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped;
}

function requireCountryCode(raw: string | undefined): string {
  const code = normalizeCountryCode(raw);
  if (!code) {
    throw new BadRequestException('countryCode must be an ISO-3166-1 alpha-2 code (e.g. BD)');
  }
  return code;
}

function requireReason(raw: string | null | undefined): string {
  const reason = (raw ?? '').trim();
  if (reason.length < 3) {
    throw new BadRequestException('A reason is required to change a jurisdiction or switch');
  }
  return reason;
}

function normalizeStatus(raw: string): 'ALLOWED' | 'BLOCKED' {
  const status = (raw ?? '').toUpperCase();
  if (status !== 'ALLOWED' && status !== 'BLOCKED') {
    throw new BadRequestException('status must be ALLOWED or BLOCKED');
  }
  return status;
}

function normalizeCurrencies(list: string[] | undefined, status: 'ALLOWED' | 'BLOCKED'): string[] {
  if (status === 'BLOCKED') return [];
  const raw = list ?? [];
  if (raw.length === 0) {
    throw new BadRequestException('An ALLOWED rule must permit at least one currency');
  }
  const out: string[] = [];
  for (const entry of raw) {
    const cur = (entry ?? '').trim().toUpperCase();
    if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(cur)) {
      throw new BadRequestException(
        `Currency "${cur}" is not supported (allowed: ${SUPPORTED_CURRENCIES.join(', ')})`,
      );
    }
    if (!out.includes(cur)) out.push(cur);
  }
  return out;
}


