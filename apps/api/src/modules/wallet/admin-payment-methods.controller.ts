import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
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
  CreateAdminPaymentMethodDto,
  UpdateAdminPaymentMethodDto,
} from './dto/admin-payment-methods.dto';

/**
 * Admin payment-method management (Phase 16+).
 *
 * Exposes the existing ManualPaymentService CRUD (createPaymentMethod /
 * updatePaymentMethod / archivePaymentMethod) as proper admin routes. The
 * service layer owns all validation, duplicate/conflict handling, amount
 * normalization and the audit trail — this controller only adds the admin
 * RBAC boundary (JwtAuthGuard + RolesGuard + @Roles).
 *
 * Provider secrets/credentials are NEVER accepted here; only public payment
 * instructions (account numbers, names, branches, limits) are stored.
 */
@ApiTags('admin/payment-methods')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@RequirePermissions(ADMIN_PERMISSIONS.PAYMENT_METHODS_READ)
@Controller('admin/payment-methods')
export class AdminPaymentMethodsController {
  constructor(
    private readonly manualPaymentService: ManualPaymentService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List payment methods (includes INACTIVE/ARCHIVED for management)',
  })
  list() {
    return this.manualPaymentService.listAllPaymentMethods();
  }

  @Post()
  @RequirePermissions(ADMIN_PERMISSIONS.PAYMENT_METHODS_CREATE)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a manual payment method (bkash/nagad/rocket/bank/card …)' })
  create(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() dto: CreateAdminPaymentMethodDto,
  ) {
    // dto carries the admin-is-who-she-says-she-is identity; auditing uses it.
    return this.manualPaymentService.createPaymentMethod(auth, dto);
  }

  @Patch(':id')
  @RequirePermissions(ADMIN_PERMISSIONS.PAYMENT_METHODS_UPDATE)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Update payment method fields/limits/status' })
  update(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAdminPaymentMethodDto,
  ) {
    return this.manualPaymentService.updatePaymentMethod(auth, id, dto);
  }

  @Post(':id/archive')
  @RequirePermissions(ADMIN_PERMISSIONS.PAYMENT_METHODS_ARCHIVE)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Archive a payment method (removes it from user-facing lists)',
  })
  archive(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.manualPaymentService.archivePaymentMethod(auth, id);
  }
}