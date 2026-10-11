import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AdminService } from './admin.service';
import { ListAdminAuditLogsQueryDto } from './dto/admin-queries.dto';

/**
 * Admin panel core endpoints: authoritative access probe, dashboard summary
 * (real aggregates only) and the read-only audit log view.
 *
 * RBAC: JWT + RolesGuard + @Roles — normal users can never reach these
 * routes; the backend remains the final authority (the admin UI guard is
 * convenience only, never the security boundary).
 */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  private context(req: Request): { ip?: string; userAgent?: string } {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  @Get('access')
  @ApiOperation({ summary: 'Authoritative admin role check for the current session' })
  checkAccess(@CurrentUser() auth: AuthenticatedUser) {
    return this.adminService.checkAccess(auth);
  }

  @Get('settings')
  @RequirePermissions(ADMIN_PERMISSIONS.SETTINGS_READ)
  @ApiOperation({ summary: 'Read-only platform configuration status (no business metrics or secrets)' })
  async settings() {
    return this.adminService.getSettingsView();
  }

  @Get('summary')
  @RequirePermissions(ADMIN_PERMISSIONS.DASHBOARD_READ)
  @ApiOperation({ summary: 'Dashboard summary (real database aggregates only)' })
  async summary() {
    return this.adminService.getSummary();
  }

  @Get('audit-logs')
  @RequirePermissions(ADMIN_PERMISSIONS.AUDIT_LOGS_READ)
  @ApiOperation({ summary: 'List audit log entries (read-only, paginated)' })
  async listAuditLogs(@Query() query: ListAdminAuditLogsQueryDto) {
    return this.adminService.listAuditLogs(query);
  }
}
