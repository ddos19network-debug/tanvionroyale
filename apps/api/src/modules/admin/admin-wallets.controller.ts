import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { AdminService } from './admin.service';
import {
  AdminUserDetailDto,
  ListAdminWalletTransactionsQueryDto,
} from './dto/admin-queries.dto';

/**
 * Admin wallet view (READ-ONLY).
 *
 * The ONLY balance-changing admin operation remains the existing
 * POST /admin/wallets/:userId/adjustments (ledger-backed, reason-required,
 * idempotent, audited) in the wallet module. This controller adds no write
 * path at all — a client-only balance change is impossible by design.
 */
@ApiTags('admin/wallets')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@RequirePermissions(ADMIN_PERMISSIONS.WALLETS_READ)
@Controller('admin/wallets')
export class AdminWalletsController {
  constructor(private readonly adminService: AdminService) {}

  @Get(':userId')
  @ApiOperation({ summary: 'Wallets + transaction history for one user (read-only)' })
  async getWalletDetail(
    @Param() params: AdminUserDetailDto,
    @Query() query: ListAdminWalletTransactionsQueryDto,
  ) {
    return this.adminService.getUserWalletDetail(params.userId, query);
  }
}
