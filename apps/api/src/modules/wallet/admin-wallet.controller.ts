import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
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
import { WalletService } from './wallet.service';
import { WalletAdjustmentDto } from './dto/wallet-adjustment.dto';

/**
 * Minimal admin wallet capability (Phase 6). There is NO arbitrary balance
 * editing: the only available operation is a signed adjustment which always
 * creates a ledger entry, requires a reason, is idempotent and is audited.
 *
 * RBAC: ADMIN and SUPER_ADMIN are both accepted (matches the rest of the
 * admin panel); normal users can never reach this controller.
 */
@ApiTags('admin-wallet')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@RequirePermissions(ADMIN_PERMISSIONS.WALLETS_READ, ADMIN_PERMISSIONS.WALLETS_MANAGE)
@Controller('admin/wallets')
export class AdminWalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post(':userId/adjustments')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Signed wallet adjustment (ledger-backed, audited, idempotent)' })
  async adjust(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body() dto: WalletAdjustmentDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = { ip: req.ip, userAgent: req.headers['user-agent'] };
    const result = await this.walletService.adjustWallet(
      userId,
      { ...dto, currency: dto.currency ?? 'BDT' },
      auth.id,
    );
    await this.walletService.audit(
      'WALLET_ADJUSTMENT',
      auth.id,
      'Wallet',
      result.wallet.id,
      { targetUserId: userId, amount: dto.amount, reason: dto.reason, ip, userAgent },
    );
    return result;
  }
}
