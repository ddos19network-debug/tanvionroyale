/**
 * Admin configuration for the Sky Rocket crash-point sequence.
 *
 * AUTHORIZATION: JwtAuthGuard + RolesGuard + @Roles('ADMIN','SUPER_ADMIN') —
 * ordinary users can NEVER read or modify crash configuration (403 from the
 * guard before the service is reached). Every mutation writes an immutable
 * GameAuditLog entry (admin id, previous + next configuration, reason, ip).
 *
 * RUNNING-ROUND SAFETY: these endpoints only write CrashSequenceState. The
 * crash multiplier of an already-created round is frozen on its own row, so no
 * configuration change can ever mutate a running/finished round.
 */

import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { CrashSequenceService } from './crash-sequence.service';
import {
  SetCrashNextPointsDto,
  SetCrashPointsDto,
  SetRepeatExtensionDto,
} from './dto/crash.dto';

@ApiTags('admin/crash')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@RequirePermissions(ADMIN_PERMISSIONS.CRASH_READ)
@Controller('admin/crash')
export class CrashAdminController {
  constructor(private readonly sequence: CrashSequenceService) {}

  private context(req: Request): { ip?: string; userAgent?: string } {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  @Get('sequence')
  @ApiOperation({ summary: 'Current sequence runtime: mode, position, lists' })
  async getState() {
    return { state: await this.sequence.getAdminView('sky-rocket') };
  }

  @Post('sequence/points')
  @RequirePermissions(ADMIN_PERMISSIONS.CRASH_MANAGE)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Configure the original crash-point list (audited)' })
  async setPoints(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetCrashPointsDto,
    @Req() req: Request,
  ) {
    const state = await this.sequence.setOriginalPoints(
      user,
      'sky-rocket',
      dto.points,
      dto.reason,
      this.context(req),
    );
    return { state, message: `Original sequence configured with ${state.originalPoints.length} points.` };
  }

  @Post('sequence/next-points')
  @RequirePermissions(ADMIN_PERMISSIONS.CRASH_MANAGE)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Queue NEW points that start after the repeat ends (audited)' })
  async setNextPoints(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetCrashNextPointsDto,
    @Req() req: Request,
  ) {
    const state = await this.sequence.setNextPoints(
      user,
      'sky-rocket',
      dto.points,
      dto.reason,
      this.context(req),
    );
    return { state, message: `${state.nextPoints?.length ?? 0} new points queued after the current repeat.` };
  }

  @Post('sequence/extension')
  @RequirePermissions(ADMIN_PERMISSIONS.CRASH_MANAGE)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Extend the CURRENT repeat without resetting position (audited)' })
  async setExtension(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetRepeatExtensionDto,
    @Req() req: Request,
  ) {
    return this.sequence.setRepeatExtension(
      user,
      'sky-rocket',
      dto.extension,
      dto.reason,
      this.context(req),
    );
  }
}