import {
  Body,
  Controller,
  Delete,
  Param,
  Patch,
  Post,
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
import { AdminUserDetailDto } from './dto/admin-queries.dto';
import {
  AdminModerationReasonDto,
  AdminResetPasswordDto,
  AdminUpdateUserProfileDto,
} from './dto/admin-moderation.dto';

/**
 * User account moderation (ADMIN + SUPER_ADMIN).
 *
 * Every route here is reason-required and audited with the actor's ip/user
 * agent, and every one of them is enforced again in AdminService:
 *   * an admin can never suspend/ban/delete their OWN account (self-lockout);
 *   * SUPER_ADMIN accounts can never be touched — the only supported path is
 *     the promote-admin script;
 *   * suspend/ban/password-reset revoke every active session of the target, so
 *     a banned user cannot keep using an already-authenticated device;
 *   * DELETE is a SOFT delete (CLOSED + anonymized + unusable password) — the
 *     betting/wallet/audit history is never destroyed.
 *
 * The frontend guard is convenience only: these endpoints (and RolesGuard)
 * are the security boundary, so a normal user can never reach any of them.
 */
@ApiTags('admin/users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@RequirePermissions(ADMIN_PERMISSIONS.USERS_READ)
@Controller('admin/users')
export class AdminUserModerationController {
  constructor(private readonly adminService: AdminService) {}

  private context(req: Request): { ip?: string; userAgent?: string } {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  @Patch(':userId/profile')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS_UPDATE)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: "Edit a user's identity fields (reason required, audited)" })
  async updateProfile(
    @CurrentUser() auth: AuthenticatedUser,
    @Param() params: AdminUserDetailDto,
    @Body() dto: AdminUpdateUserProfileDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.adminService.updateUserProfile(params.userId, dto, auth, ip, userAgent);
  }

  @Post(':userId/reset-password')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS_RESET_PASSWORD)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Set (or generate) a new password and revoke every session (reason required)',
  })
  async resetPassword(
    @CurrentUser() auth: AuthenticatedUser,
    @Param() params: AdminUserDetailDto,
    @Body() dto: AdminResetPasswordDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.adminService.resetUserPassword(params.userId, dto, auth, ip, userAgent);
  }

  @Post(':userId/suspend')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS_SUSPEND)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Suspend an account (temporary/reversible, reason required)' })
  async suspend(
    @CurrentUser() auth: AuthenticatedUser,
    @Param() params: AdminUserDetailDto,
    @Body() dto: AdminModerationReasonDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.adminService.suspendUser(params.userId, dto, auth, ip, userAgent);
  }

  @Post(':userId/unsuspend')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS_UNBAN)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Lift a suspension (only from SUSPENDED, reason required)' })
  async unsuspend(
    @CurrentUser() auth: AuthenticatedUser,
    @Param() params: AdminUserDetailDto,
    @Body() dto: AdminModerationReasonDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.adminService.unsuspendUser(params.userId, dto, auth, ip, userAgent);
  }

  @Post(':userId/ban')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS_BAN)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Ban an account (permanent/severe, reason required)' })
  async ban(
    @CurrentUser() auth: AuthenticatedUser,
    @Param() params: AdminUserDetailDto,
    @Body() dto: AdminModerationReasonDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.adminService.banUser(params.userId, dto, auth, ip, userAgent);
  }

  @Post(':userId/unban')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS_UNBAN)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Lift a ban (only from BANNED, reason required)' })
  async unban(
    @CurrentUser() auth: AuthenticatedUser,
    @Param() params: AdminUserDetailDto,
    @Body() dto: AdminModerationReasonDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.adminService.unbanUser(params.userId, dto, auth, ip, userAgent);
  }

  @Delete(':userId')
  @Roles('SUPER_ADMIN')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS_DELETE)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Soft-delete an account: CLOSED + anonymized + sessions revoked (SUPER_ADMIN only)',
  })
  async softDelete(
    @CurrentUser() auth: AuthenticatedUser,
    @Param() params: AdminUserDetailDto,
    @Body() dto: AdminModerationReasonDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.adminService.softDeleteUser(params.userId, dto, auth, ip, userAgent);
  }
}
