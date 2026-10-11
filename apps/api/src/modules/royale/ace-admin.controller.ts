import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { RoyaleAceAdminService } from './ace/ace-admin.service';
import {
  AceRoundsQueryDto,
  ActivateAceConfigDto,
  CreateAceConfigDto,
  RunAceSimulationDto,
  SetAceEnabledDto,
  VoidAceRoundDto,
} from './dto/ace.dto';
import { DEFAULT_ACE_CONFIG, type AceGameConfig } from './ace/ace-config';

/**
 * TANVION ROYALE — "Royale Ace" (royale-ace) ADMIN surface.
 *
 * AUTHORIZATION: JwtAuthGuard + RolesGuard + @Roles('ADMIN','SUPER_ADMIN') plus
 * a per-route permission — the EXISTING royale permissions, so no new
 * permission rows are introduced:
 *   read    -> ROYALE_READ   (list versions/reports, view rounds, replay)
 *   write   -> ROYALE_MANAGE (create/activate versions, toggle, void, reconcile)
 * Ordinary customers can NEVER reach these routes.
 *
 * Governance enforced by the service (this controller only wires routes):
 *   - Every config change is a NEW immutable version with a mandatory reason.
 *   - A math change can only be ACTIVATED with a passing simulation report.
 *   - Responses NEVER include a server seed or encrypted seed; the viewer
 *     exposes only the stored, hash-committed outcome for replay/verification.
 */
@ApiTags('admin/royale-ace')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@RequirePermissions(ADMIN_PERMISSIONS.ROYALE_READ, ADMIN_PERMISSIONS.ROYALE_MANAGE)
@Controller('admin/royale-ace')
export class RoyaleAceAdminController {
  constructor(private readonly admin: RoyaleAceAdminService) {}


  // -------------------------------------------------------------------------
  // Configuration versions
  // -------------------------------------------------------------------------

  @Get('config/versions')
  @ApiOperation({ summary: 'List every config version (newest first) with sim status' })
  listVersions() {
    return { versions: this.admin.listVersions() };
  }

  @Get('config/versions/:version')
  @ApiOperation({ summary: 'One config version by number' })
  getVersion(@Param('version') version: string) {
    return this.admin.getVersion(Number.parseInt(version, 10));
  }

  @Get('config/versions/:version/reports')
  @ApiOperation({ summary: 'Stored simulation reports for a config version' })
  listReports(@Param('version') version: string) {
    return { reports: this.admin.listReports(Number.parseInt(version, 10)) };
  }

  @Get('config/default')
  @ApiOperation({ summary: 'The built-in launch configuration (baseline for a new draft)' })
  getDefault() {
    const config: AceGameConfig = DEFAULT_ACE_CONFIG;
    return { config };
  }

  @Post('config/versions')
  @RequirePermissions(ADMIN_PERMISSIONS.ROYALE_MANAGE)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a new DRAFT config version (mandatory reason)' })
  createVersion(@CurrentUser() actor: AuthenticatedUser, @Body() dto: CreateAceConfigDto) {
    return this.admin.createVersion(actor.id, dto.config as unknown as AceGameConfig, dto.reason);
  }

  @Post('config/versions/:version/simulate')
  @RequirePermissions(ADMIN_PERMISSIONS.ROYALE_MANAGE)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Run + store a bounded simulation report for a version' })
  runSimulation(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('version') version: string,
    @Body() dto: RunAceSimulationDto,
  ) {
    return this.admin.runSimulation(actor.id, Number.parseInt(version, 10), {
      spins: dto.spins,
      seed: dto.seed,
    });
  }

  @Post('config/versions/:version/activate')
  @RequirePermissions(ADMIN_PERMISSIONS.ROYALE_MANAGE)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Activate a config version (math changes require a passing sim)' })
  activate(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('version') version: string,
    @Body() dto: ActivateAceConfigDto,
  ) {
    return this.admin.activate(actor.id, Number.parseInt(version, 10), dto.reason);
  }

  @Post('config/enabled')
  @RequirePermissions(ADMIN_PERMISSIONS.ROYALE_MANAGE)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Enable/disable the game on the ACTIVE config (mandatory reason)' })
  setEnabled(@CurrentUser() actor: AuthenticatedUser, @Body() dto: SetAceEnabledDto) {
    return this.admin.setEnabled(actor.id, dto.enabled, dto.reason);
  }

  // -------------------------------------------------------------------------
  // Round / spin viewer + operations
  // -------------------------------------------------------------------------

  @Get('rounds')
  @ApiOperation({ summary: 'Recent rounds (operational viewer; never a seed)' })
  listRounds(@Query() query: AceRoundsQueryDto) {
    return this.admin.listRounds({
      userId: query.userId,
      status: query.status,
      limit: query.limit,
    });
  }

  @Get('rounds/:roundId')
  @ApiOperation({ summary: 'One round with its full pre-derived outcome (for replay)' })
  getRound(@Param('roundId') roundId: string) {
    return this.admin.getRoundForReplay(roundId);
  }

  @Post('rounds/:roundId/void')
  @RequirePermissions(ADMIN_PERMISSIONS.ROYALE_MANAGE)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Void an unpaid REAL_MONEY round (mandatory reason)' })
  voidRound(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('roundId') roundId: string,
    @Body() dto: VoidAceRoundDto,
  ) {
    return this.admin.voidRound(actor.id, roundId, dto.reason);
  }

  @Post('reconcile')
  @RequirePermissions(ADMIN_PERMISSIONS.ROYALE_MANAGE)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Trigger the stuck-round reconciler on demand' })
  reconcile() {
    return this.admin.reconcileNow();
  }
}
