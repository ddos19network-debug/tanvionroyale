import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ManualPaymentService } from './manual-payment.service';
import {
  AdminListManualDepositsQueryDto,
  AdminReviewManualDepositDto,
} from './dto/manual-payment.dto';

/**
 * Admin manual-deposit management (Phase 16+).
 *
 * Reuses the existing idempotent review flow in ManualPaymentService: approval
 * credits the wallet through WalletService.creditManualDeposit (ledger-backed,
 * idempotency-keyed), so approving twice NEVER credits twice.
 */
@ApiTags('admin/manual-deposits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@RequirePermissions(ADMIN_PERMISSIONS.DEPOSITS_READ)
@Controller('admin/manual-deposits')
export class AdminManualDepositsController {
  constructor(
    private readonly manualPaymentService: ManualPaymentService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List manual deposits (filterable by status)' })
  list(@Query() query: AdminListManualDepositsQueryDto) {
    return this.manualPaymentService.listAdminDeposits(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Manual deposit details including the requesting user' })
  detail(@Param('id') id: string) {
    return this.manualPaymentService.getAdminDeposit(id);
  }

  @Post(':id/review')
  @RequirePermissions(ADMIN_PERMISSIONS.DEPOSITS_REVIEW)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Approve or reject a manual deposit (idempotent — never double-credits)' })
  review(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminReviewManualDepositDto,
  ) {
    return this.manualPaymentService.reviewManualDeposit(auth, id, dto);
  }
}