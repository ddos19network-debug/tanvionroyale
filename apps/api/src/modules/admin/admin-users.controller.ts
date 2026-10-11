import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
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
import { AdminUserDetailDto, ListAdminUsersQueryDto } from './dto/admin-queries.dto';
import {
  CreateAdminUserDto,
  CreateRoleDto,
  UpdateRoleDto,
  UpdateRolePermissionsDto,
  UpdateUserPermissionsDto,
  UpdateUserRolesDto,
} from './dto/admin-management.dto';
import {
  AdminModerationReasonDto,
  AdminResetPasswordDto,
  AdminUpdateUserProfileDto,
} from './dto/admin-moderation.dto';

/**
 * Admin user directory + admin management.
 *
 * Directory reads (GET) stay available to ADMIN and SUPER_ADMIN. Creating
 * staff accounts, replacing a user's roles, listing roles/permissions and
 * replacing a role's permission set are SUPER_ADMIN-only: every mutating
 * route carries a method-level @Roles('SUPER_ADMIN') which overrides the
 * class-level annotation (RolesGuard resolves metadata handler-first via
 * Reflector.getAllAndOverride).
 *
 * Staff directory READ is available to ordinary staff sessions holding
 * ADMINS_READ. Account lifecycle and other management mutations remain
 * SUPER_ADMIN-only (method-level @Roles), so this read exception cannot grant
 * control over another staff account.
 *
 * SUPER_ADMIN can never be granted, removed or edited through these endpoints
 * — the service layer rejects it. The only supported path to SUPER_ADMIN is
 * the database/scripts/promote-admin.ts script run against the target
 * database.
 */
@ApiTags('admin/users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@RequirePermissions(ADMIN_PERMISSIONS.USERS_READ)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  @ApiOperation({ summary: 'Search/list users (paginated, read-only)' })
  async listUsers(@Query() query: ListAdminUsersQueryDto) {
    return this.adminService.listUsers(query);
  }

  // Static GET routes are declared before the parameterized :userId route.

  @Get('roles/list')
  @Roles('SUPER_ADMIN')
  @RequirePermissions(ADMIN_PERMISSIONS.ROLES_READ)
  @ApiOperation({ summary: 'List all roles with their permissions (SUPER_ADMIN only)' })
  async listRoles() {
    return this.adminService.listRoles();
  }

  @Get('permissions/list')
  @Roles('SUPER_ADMIN')
  @RequirePermissions(ADMIN_PERMISSIONS.ROLES_READ)
  @ApiOperation({ summary: 'List all available permissions (SUPER_ADMIN only)' })
  async listPermissions() {
    return this.adminService.listPermissions();
  }

  @Post('roles')
  @Roles('SUPER_ADMIN')
  @RequirePermissions(ADMIN_PERMISSIONS.ROLES_CREATE)
  @ApiOperation({ summary: 'Create a dynamic staff role (SUPER_ADMIN only)' })
  async createRole(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() dto: CreateRoleDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = context(req);
    return this.adminService.createRole(dto, auth, ip, userAgent);
  }

  @Patch('roles/:roleId')
  @Roles('SUPER_ADMIN')
  @RequirePermissions(ADMIN_PERMISSIONS.ROLES_UPDATE)
  @ApiOperation({ summary: 'Edit a dynamic staff role (SUPER_ADMIN only)' })
  async updateRole(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('roleId') roleId: string,
    @Body() dto: UpdateRoleDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = context(req);
    return this.adminService.updateRole(roleId, dto, auth, ip, userAgent);
  }

  @Delete('roles/:roleId')
  @Roles('SUPER_ADMIN')
  @RequirePermissions(ADMIN_PERMISSIONS.ROLES_DELETE)
  @ApiOperation({ summary: 'Delete an unassigned dynamic staff role (SUPER_ADMIN only)' })
  async deleteRole(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('roleId') roleId: string,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = context(req);
    return this.adminService.deleteRole(roleId, auth, ip, userAgent);
  }

  @Put(':userId/permissions')
  @Roles('SUPER_ADMIN')
  @RequirePermissions(ADMIN_PERMISSIONS.ADMINS_ROLES_MANAGE)
  @ApiOperation({ summary: 'Replace direct grants/denies for a staff account (SUPER_ADMIN only)' })
  async updateUserPermissions(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserPermissionsDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = context(req);
    return this.adminService.setUserPermissions(userId, dto, auth, ip, userAgent);
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Customer user detail: status, verification, roles, wallet summary' })
  async getUser(@Param() params: AdminUserDetailDto) {
    // Customer domain only — staff ids resolve to 404 here (they are managed
    // through the staff endpoints), so /admin/users can never leak staff rows.
    return this.adminService.getCustomerUser(params.userId);
  }

  @Post()
  @Roles('SUPER_ADMIN')
  @RequirePermissions(ADMIN_PERMISSIONS.ADMINS_CREATE)
  @ApiOperation({ summary: 'Create a new admin/staff user (SUPER_ADMIN only)' })
  async createAdminUser(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() dto: CreateAdminUserDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = context(req);
    return this.adminService.createAdminUser(dto, auth, ip, userAgent);
  }

  @Put(':userId/roles')
  @Roles('SUPER_ADMIN')
  @RequirePermissions(ADMIN_PERMISSIONS.ROLES_ASSIGN)
  @ApiOperation({ summary: "Replace a user's roles (SUPER_ADMIN only)" })
  async updateUserRoles(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: UpdateUserRolesDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = context(req);
    return this.adminService.assignRolesToUser(userId, dto.roleNames, auth, ip, userAgent);
  }

  @Put('roles/:roleId/permissions')
  @Roles('SUPER_ADMIN')
  @RequirePermissions(ADMIN_PERMISSIONS.ROLES_UPDATE)
  @ApiOperation({ summary: "Replace a role's permissions (SUPER_ADMIN only)" })
  async updateRolePermissions(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('roleId') roleId: string,
    @Body() dto: UpdateRolePermissionsDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = context(req);
    return this.adminService.updateRolePermissions(roleId, dto.permissionNames, auth, ip, userAgent);
  }

  /**
   * Staff profile edit (SUPER_ADMIN only). Email/username uniqueness is
   * enforced by the database (409, never a silent overwrite) and the change is
   * audited with its mandatory reason.
   */
  @Patch(':userId/admin-profile')
  @Roles('SUPER_ADMIN')
  @RequirePermissions(ADMIN_PERMISSIONS.ADMINS_UPDATE)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: "Edit a staff account's email/username/name (SUPER_ADMIN only)" })
  async updateAdminProfile(
    @CurrentUser() auth: AuthenticatedUser,
    @Param() params: AdminUserDetailDto,
    @Body() dto: AdminUpdateUserProfileDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = context(req);
    return this.adminService.updateAdminProfile(params.userId, dto, auth, ip, userAgent);
  }

  /**
   * Staff password reset (SUPER_ADMIN only) — same machinery as the user
   * variant: reason required, hash-only storage, every session revoked.
   */
  @Post(':userId/admin-password-reset')
  @Roles('SUPER_ADMIN')
  @RequirePermissions(ADMIN_PERMISSIONS.ADMINS_RESET_PASSWORD)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: "Reset a staff account's password (SUPER_ADMIN only)" })
  async resetAdminPassword(
    @CurrentUser() auth: AuthenticatedUser,
    @Param() params: AdminUserDetailDto,
    @Body() dto: AdminResetPasswordDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = context(req);
    return this.adminService.resetAdminPassword(params.userId, dto, auth, ip, userAgent);
  }
}

/** Request context recorded with every staff-management audit entry. */
function context(req: Request): { ip?: string; userAgent?: string } {
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
}

/**
 * Staff account deactivation (SUPER_ADMIN only).
 *
 * Declared as its own controller because NestJS route prefixes are per-class
 * and the prompt-mandated path is /admin/admins/:userId. Guardrails are the
 * same as everywhere else in the admin panel:
 *   * SUPER_ADMIN targets are rejected (promote-admin script only),
 *   * the last active SUPER_ADMIN can never be deactivated,
 *   * a SUPER_ADMIN can never deactivate their own account,
 *   * deactivation = every role stripped + soft delete (CLOSED + anonymized +
 *     unusable password + sessions revoked), so the account can neither open an
 *     /admin route nor sign in as a customer.
 */
@ApiTags('admin/admins')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@RequirePermissions(ADMIN_PERMISSIONS.ADMINS_READ)
@Controller('admin/admins')
export class AdminStaffController {
  constructor(private readonly adminService: AdminService) {}

  @Delete(':userId')
  @Roles('SUPER_ADMIN')
  @RequirePermissions(ADMIN_PERMISSIONS.ADMINS_DEACTIVATE)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Deactivate a staff account: roles stripped + soft delete (SUPER_ADMIN only)',
  })
  async deactivate(
    @CurrentUser() auth: AuthenticatedUser,
    @Param() params: AdminUserDetailDto,
    @Body() dto: AdminModerationReasonDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = context(req);
    return this.adminService.deactivateAdmin(params.userId, dto, auth, ip, userAgent);
  }

  /**
   * STAFF directory for the Admin -> Admins page (master admins + ordinary
   * staff, never customers). The population split is enforced in the service
   * WHERE clause — the frontend just renders what this returns. Inherited
   * class-level @Roles('SUPER_ADMIN') keeps it in admin-management territory,
   * exactly like the page's own gate.
   */
  @Get()
  @ApiOperation({ summary: 'Search/list STAFF accounts only (paginated, read-only)' })
  async listStaff(@Query() query: ListAdminUsersQueryDto) {
    return this.adminService.listStaffAccounts(query);
  }
}
