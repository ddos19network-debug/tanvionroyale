import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AdminService } from './admin.service';
import {
  AdminEventStatusReasonDto,
  ListAdminEventsQueryDto,
} from './dto/admin-queries.dto';

/**
 * Admin catalog + event read model, plus the ONLY admin event mutation:
 * an audited, reason-backed status change (Phase 5). Sport/game CRUD and
 * availability/provider mapping live in the existing sports module admin
 * controller (POST/PATCH /admin/sports, /admin/games, ...) and are reused —
 * nothing here duplicates or replaces them.
 */
@ApiTags('admin/catalog')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@RequirePermissions(ADMIN_PERMISSIONS.SPORTS_READ)
@Controller('admin')
export class AdminCatalogController {
  constructor(private readonly adminService: AdminService) {}

  private context(req: Request): { ip?: string; userAgent?: string } {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  @Get('sports')
  @ApiOperation({ summary: 'List ALL sports (including INACTIVE), with counts' })
  async listSports() {
    return this.adminService.listCatalogSports();
  }

  @Get('sports/:sportId')
  @ApiOperation({ summary: 'Sport detail: competitions and games (all statuses)' })
  async getSport(@Param('sportId') sportId: string) {
    return this.adminService.getCatalogSport(sportId);
  }

  @Get('competitions')
  @ApiOperation({ summary: 'List competitions/leagues with their sport and event counts' })
  async listCompetitions() {
    return this.adminService.listCompetitions();
  }

  @Get('events')
  @ApiOperation({ summary: 'List events with filters (status/sport/competition/search)' })
  async listEvents(@Query() query: ListAdminEventsQueryDto) {
    return this.adminService.listEvents(query);
  }

  @Patch('events/:eventId/status')
  @RequirePermissions(ADMIN_PERMISSIONS.SPORTS_MANAGE)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Change event status (audited, reason required)' })
  async updateEventStatus(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('eventId') eventId: string,
    @Body() dto: AdminEventStatusReasonDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.adminService.updateEventStatus(eventId, dto.status, dto.reason, auth, ip, userAgent);
  }
}
