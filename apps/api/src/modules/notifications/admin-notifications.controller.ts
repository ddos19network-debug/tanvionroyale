import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { NotificationService } from './notification.service';
import { AdminSendNotificationDto, ListNotificationsQueryDto } from './dto/notification.dto';

/**
 * Admin notification management (ADMIN/SUPER_ADMIN only, existing RBAC).
 * Reuses the same NotificationService as user flows — no second system.
 */
@ApiTags('admin/notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@RequirePermissions(ADMIN_PERMISSIONS.NOTIFICATIONS_READ)
@Controller('admin/notifications')
export class AdminNotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'Admin notification center (admin-audience feed)' })
  list(@CurrentUser() auth: AuthenticatedUser, @Query() query: ListNotificationsQueryDto) {
    return this.notifications.listForUser(auth.id, query, 'ADMIN');
  }

  @Get('stats')
  @ApiOperation({ summary: 'Notification delivery stats' })
  stats() {
    return this.notifications.adminStats();
  }

  @Post('send')
  @RequirePermissions(ADMIN_PERMISSIONS.NOTIFICATIONS_SEND)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send manual notification (all | selected | single)' })
  async send(@CurrentUser() auth: AuthenticatedUser, @Body() dto: AdminSendNotificationDto) {
    return this.notifications.adminSend(auth.id, dto);
  }
}
