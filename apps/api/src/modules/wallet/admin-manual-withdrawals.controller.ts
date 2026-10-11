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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  AdminCompleteManualWithdrawalDto,
  AdminListManualWithdrawalsQueryDto,
  AdminReviewManualWithdrawalDto,
} from './dto/admin-manual-withdrawals.dto';

/**
 * Admin manual-withdrawal management (reserve -> approve -> complete,
 * or reject/cancel -> release). Every mutation is transactional,
 * idempotent and audited.
 */
@ApiTags('admin/manual-withdrawals')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@RequirePermissions(ADMIN_PERMISSIONS.WITHDRAWALS_READ)
@Controller('admin/manual-withdrawals')
export class AdminManualWithdrawalsController {
  constructor(private readonly manualPaymentService: ManualPaymentService) {}

  @Get()
  @ApiOperation({ summary: 'List manual withdrawals (filterable)' })
  list(@Query() query: AdminListManualWithdrawalsQueryDto) {
    return this.manualPaymentService.listAdminWithdrawals(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Manual withdrawal detail' })
  detail(@Param('id') id: string) {
    return this.manualPaymentService.getAdminWithdrawal(id);
  }

  @Post(':id/review')
  @RequirePermissions(ADMIN_PERMISSIONS.WITHDRAWALS_REVIEW)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Approve or reject a manual withdrawal' })
  review(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminReviewManualWithdrawalDto,
  ) {
    return this.manualPaymentService.reviewManualWithdrawal(auth, id, dto);
  }

  @Post(':id/complete')
  @RequirePermissions(ADMIN_PERMISSIONS.WITHDRAWALS_COMPLETE)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Mark an approved withdrawal as completed' })
  complete(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminCompleteManualWithdrawalDto,
  ) {
    return this.manualPaymentService.completeManualWithdrawal(auth, id, dto);
  }
}
