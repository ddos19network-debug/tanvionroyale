import { Body, Controller, Get, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ResponsibleGamblingService } from './responsible-gambling.service';
import { AdminExclusionActionDto, SetLimitDto } from './dto/responsible-gambling.dto';

/**
 * TANVION ROYALE — admin responsible-gambling read/override (Task 2 / audit F3).
 *
 * AUTHORIZATION: JwtAuthGuard + RolesGuard (global) + @Roles('ADMIN','SUPER_ADMIN')
 * plus a per-route permission — the EXISTING royale permissions, so no new
 * permission rows are introduced:
 *   read    -> ROYALE_READ   (inspect a player's protection state)
 *   override-> ROYALE_MANAGE (revoke an exclusion / set a limit immediately)
 *
 * Ordinary users can NEVER reach these routes. Every override writes an
 * AuditLog row with actorType ADMIN.
 */
@ApiTags('admin/responsible-gambling')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@Controller('admin/responsible-gambling')
export class AdminResponsibleGamblingController {
  constructor(private readonly rg: ResponsibleGamblingService) {}

  @Get('state')
  @RequirePermissions(ADMIN_PERMISSIONS.ROYALE_READ)
  @ApiOperation({ summary: 'Read a player responsible-gambling state (exclusions + limits)' })
  async getState(@Query('userId') userId: string) {
    return { state: await this.rg.getState(userId) };
  }

  @Put('limits')
  @RequirePermissions(ADMIN_PERMISSIONS.ROYALE_MANAGE)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Override: set a player limit IMMEDIATELY (no cooling-off)' })
  async setLimit(
    @Query('userId') userId: string,
    @Body() dto: SetLimitDto,
  ) {
    const limit = await this.rg.adminSetLimit(userId, dto, { actorType: 'ADMIN' });
    return { limit };
  }

  @Post('exclusions/revoke')
  @RequirePermissions(ADMIN_PERMISSIONS.ROYALE_MANAGE)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Override: lift a player exclusion IMMEDIATELY' })
  async revokeExclusion(
    @Query('userId') userId: string,
    @Body() dto: AdminExclusionActionDto,
  ) {
    const exclusion = await this.rg.adminRevokeExclusion(userId, dto.exclusionId, {
      actorType: 'ADMIN',
    });
    return { exclusion };
  }
}
