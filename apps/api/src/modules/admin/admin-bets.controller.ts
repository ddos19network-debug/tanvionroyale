import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { AdminService } from './admin.service';
import { ListAdminBetsQueryDto } from './dto/admin-queries.dto';

/**
 * Admin bet list (READ-ONLY). Settlement itself stays in the existing
 * AdminBettingController (POST /admin/betting/bets/:id/settle and
 * POST /admin/betting/events/:id/settle, @Roles('ADMIN', 'SUPER_ADMIN')) — this controller
 * only provides the search/filter views the admin panel needs. Settlement
 * results are never invented here; duplicate settlement remains impossible
 * through the idempotent settlement service.
 */
@ApiTags('admin/bets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@RequirePermissions(ADMIN_PERMISSIONS.BETTING_READ)
@Controller('admin/bets')
export class AdminBetsController {
  constructor(private readonly adminService: AdminService) {}

  @Get()
  @ApiOperation({ summary: 'Search/list bets (status/user/event filters, paginated)' })
  async listBets(@Query() query: ListAdminBetsQueryDto) {
    return this.adminService.listBets(query);
  }
}
