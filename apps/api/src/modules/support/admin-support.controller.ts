import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { SupportService } from './support.service';
import {
  AssignSupportTicketDto,
  ListSupportTicketsQueryDto,
  SendSupportMessageDto,
  UpdateSupportTicketStatusDto,
} from './dto/support.dto';

/**
 * Admin Support inbox (ADMIN/SUPER_ADMIN only — existing RBAC guards).
 * Reads every conversation; replies are attributed to the authenticated
 * admin and notify the user through the existing notification system.
 */
@ApiTags('admin/support')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@RequirePermissions(ADMIN_PERMISSIONS.SUPPORT_READ)
@Controller('admin/support')
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get('tickets')
  @ApiOperation({ summary: 'List support conversations (filters + search)' })
  list(@Query() query: ListSupportTicketsQueryDto) {
    return this.support.adminListTickets(query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Total unread user messages (inbox badge)' })
  unreadCount() {
    return this.support.adminUnreadCount();
  }

  @Get('tickets/:id')
  @ApiOperation({ summary: 'Full conversation with all messages' })
  getTicket(@Param('id', ParseUUIDPipe) id: string) {
    return this.support.adminGetTicket(id);
  }

  @Post('tickets/:id/read')
  @RequirePermissions(ADMIN_PERMISSIONS.SUPPORT_UPDATE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark the conversation as read (admin side)' })
  markRead(@Param('id', ParseUUIDPipe) id: string) {
    return this.support.adminMarkRead(id);
  }

  @Post('tickets/:id/reply')
  @RequirePermissions(ADMIN_PERMISSIONS.SUPPORT_REPLY)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Reply to a user conversation' })
  reply(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendSupportMessageDto,
  ) {
    return this.support.adminReply(id, auth.id, dto);
  }

  @Patch('tickets/:id/status')
  @RequirePermissions(ADMIN_PERMISSIONS.SUPPORT_UPDATE)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Set conversation status (OPEN/IN_PROGRESS/WAITING_FOR_USER/RESOLVED/CLOSED)',
  })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSupportTicketStatusDto,
  ) {
    return this.support.adminUpdateStatus(id, dto.status);
  }

  @Post('tickets/:id/assign')
  @RequirePermissions(ADMIN_PERMISSIONS.SUPPORT_ASSIGN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Assign to self (no body) / to an admin (adminId) / unassign (adminId: null)',
  })
  assign(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignSupportTicketDto,
  ) {
    return this.support.adminAssign(id, { id: auth.id }, dto.adminId);
  }
}
