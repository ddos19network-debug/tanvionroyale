import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { NotificationService } from './notification.service';
import { ListNotificationsQueryDto, RegisterDeviceDto } from './dto/notification.dto';

/** Authenticated user notification center (own rows only, IDOR-safe). */
@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  @Post('devices')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Register this browser for push (FCM token)' })
  registerDevice(@CurrentUser() auth: AuthenticatedUser, @Body() dto: RegisterDeviceDto) {
    return this.notifications.registerDevice(auth.id, {
      token: dto.token,
      platform: dto.platform ?? 'web',
      browser: dto.browser,
    });
  }

  @Post('devices/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deactivate this browser push registration' })
  deactivate(@CurrentUser() auth: AuthenticatedUser, @Body() dto: RegisterDeviceDto) {
    return this.notifications.deactivateDevice(auth.id, dto.token).then(() => ({ ok: true }));
  }

  @Get()
  @ApiOperation({ summary: 'List my notifications (newest first)' })
  list(@CurrentUser() auth: AuthenticatedUser, @Query() query: ListNotificationsQueryDto) {
    return this.notifications.listForUser(auth.id, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Unread notification count for the badge' })
  unread(@CurrentUser() auth: AuthenticatedUser) {
    return this.notifications.unreadCount(auth.id);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark one notification read (own rows only)' })
  async markRead(@CurrentUser() auth: AuthenticatedUser, @Param('id') id: string) {
    try {
      await this.notifications.markRead(auth.id, id);
      return { ok: true };
    } catch {
      throw new NotFoundException('Notification not found');
    }
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Mark all my notifications read' })
  readAll(@CurrentUser() auth: AuthenticatedUser) {
    return this.notifications.markAllRead(auth.id);
  }
}
