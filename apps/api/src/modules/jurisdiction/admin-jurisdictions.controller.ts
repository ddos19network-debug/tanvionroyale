import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { JurisdictionService } from './jurisdiction.service';
import {
  BulkBlockJurisdictionsDto,
  JurisdictionAuditQueryDto,
  SetGameSwitchDto,
  UpsertJurisdictionRuleDto,
} from './dto/jurisdiction.dto';

/**
 * TANVION ROYALE — PART A: admin surface for the central jurisdiction &
 * currency control.
 *
 * AUTHORIZATION: JwtAuthGuard + RolesGuard + @Roles('ADMIN','SUPER_ADMIN') +
 * @RequirePermissions — reads need ROYALE_READ, every write needs
 * ROYALE_MANAGE. Ordinary users can NEVER reach these routes.
 *
 * Every write: (1) requires a reason, (2) appends a JurisdictionAuditLog row,
 * (3) invalidates the read cache so the new decision is enforced immediately.
 * The responses never include any balance, seed or credential.
 */
@ApiTags('admin/jurisdictions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@Controller('admin/jurisdictions')
export class AdminJurisdictionsController {
  constructor(private readonly jurisdictions: JurisdictionService) {}

  @Get()
  @RequirePermissions(ADMIN_PERMISSIONS.ROYALE_READ)
  @ApiOperation({ summary: 'Country table + kill switches (no secrets, no balances)' })
  async list() {
    const [rules, switches] = await Promise.all([
      this.jurisdictions.listRules(),
      this.jurisdictions.listSwitches(),
    ]);
    return {
      rules: rules.map((r) => ({
        countryCode: r.countryCode,
        status: r.status,
        allowedCurrencies: r.allowedCurrencies ?? [],
        licenceRef: r.licenceRef,
        reason: r.reason,
        effectiveFrom: r.effectiveFrom.toISOString(),
        updatedByAdminId: r.updatedByAdminId,
        updatedAt: r.updatedAt.toISOString(),
      })),
      switches,
      supportedCurrencies: ['BDT', 'USD'],
      note: 'A country with no rule is BLOCKED by default (fail closed).',
    };
  }

  @Get('audit')
  @RequirePermissions(ADMIN_PERMISSIONS.ROYALE_READ)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Append-only jurisdiction change history' })
  async audit(@Query() query: JurisdictionAuditQueryDto) {
    const rows = await this.jurisdictions.listAudit(query.limit ?? 100);
    return {
      audit: rows.map((r) => ({
        id: r.id,
        actorAdminId: r.actorAdminId,
        action: r.action,
        countryCode: r.countryCode,
        oldStatus: r.oldStatus,
        newStatus: r.newStatus,
        oldCurrencies: r.oldCurrencies ?? [],
        newCurrencies: r.newCurrencies ?? [],
        reason: r.reason,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  @Get('export.csv')
  @RequirePermissions(ADMIN_PERMISSIONS.ROYALE_READ)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'CSV export of the whole country table' })
  async exportCsv() {
    return { filename: 'jurisdictions.csv', csv: await this.jurisdictions.exportCsv() };
  }

  @Post()
  @RequirePermissions(ADMIN_PERMISSIONS.ROYALE_MANAGE)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create/update one country (ALLOWED/BLOCKED, currencies, licence)' })
  async upsert(@CurrentUser() admin: AuthenticatedUser, @Body() dto: UpsertJurisdictionRuleDto) {
    const rule = await this.jurisdictions.upsertRule(
      {
        countryCode: dto.countryCode,
        status: dto.status,
        allowedCurrencies: dto.allowedCurrencies,
        licenceRef: dto.licenceRef ?? null,
        reason: dto.reason,
      },
      admin.id,
    );
    return {
      rule: {
        countryCode: rule.countryCode,
        status: rule.status,
        allowedCurrencies: rule.allowedCurrencies ?? [],
        licenceRef: rule.licenceRef,
        reason: rule.reason,
      },
    };
  }

  @Post('bulk-block')
  @RequirePermissions(ADMIN_PERMISSIONS.ROYALE_MANAGE)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Block one country or EVERY known country at once' })
  async bulkBlock(@CurrentUser() admin: AuthenticatedUser, @Body() dto: BulkBlockJurisdictionsDto) {
    if (!dto.all && !dto.countryCode) {
      throw new BadRequestException('countryCode or all=true is required');
    }
    const result = await this.jurisdictions.bulkBlock(
      { countryCode: dto.countryCode, all: dto.all, reason: dto.reason },
      admin.id,
    );
    return result;
  }

  @Post('switches')
  @RequirePermissions(ADMIN_PERMISSIONS.ROYALE_MANAGE)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Flip a kill switch (REAL_MONEY_ALL or GAME:<slug>)' })
  async setSwitch(@CurrentUser() admin: AuthenticatedUser, @Body() dto: SetGameSwitchDto) {
    return this.jurisdictions.setSwitch(
      { key: dto.key, enabled: dto.enabled, reason: dto.reason ?? null },
      admin.id,
    );
  }
}
