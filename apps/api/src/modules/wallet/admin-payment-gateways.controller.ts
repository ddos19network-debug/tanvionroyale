import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import { PaymentGatewaysService } from './payment-gateways.service';
import {
  CreatePaymentGatewayDto,
  UpdatePaymentGatewayDto,
} from './dto/payment-gateways.dto';

/**
 * Admin gateway provider management.
 *
 * Database-backed gateway configs (secrets encrypted at rest, only boolean
 * *Set flags exposed). RBAC enforced server-side via JwtAuthGuard + RolesGuard.
 */
@ApiTags('admin/payment-gateways')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@RequirePermissions(ADMIN_PERMISSIONS.PAYMENT_GATEWAYS_READ)
@Controller('admin/payment-gateways')
export class AdminPaymentGatewaysController {
  constructor(private readonly gateways: PaymentGatewaysService) {}

  private context(req: Request): { ip?: string; userAgent?: string } {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  @Get()
  @ApiOperation({ summary: 'List payment gateways (secrets masked)' })
  list() {
    return this.gateways.list();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Gateway detail (secrets masked)' })
  detail(@Param('id') id: string) {
    return this.gateways.detail(id);
  }

  @Post()
  @RequirePermissions(ADMIN_PERMISSIONS.PAYMENT_GATEWAYS_CREATE)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a payment gateway' })
  create(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() dto: CreatePaymentGatewayDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.gateways.create(auth, dto, ip, userAgent);
  }

  @Patch(':id')
  @RequirePermissions(ADMIN_PERMISSIONS.PAYMENT_GATEWAYS_UPDATE)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Update a payment gateway' })
  update(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePaymentGatewayDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.gateways.update(id, auth, dto, ip, userAgent);
  }

  @Delete(':id')
  @RequirePermissions(ADMIN_PERMISSIONS.PAYMENT_GATEWAYS_DELETE)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Archive a payment gateway' })
  remove(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.gateways.remove(id, auth, ip, userAgent);
  }

  @Post(':id/enable')
  @RequirePermissions(ADMIN_PERMISSIONS.PAYMENT_GATEWAYS_UPDATE)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Enable a gateway' })
  enable(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.gateways.setStatus(id, auth, 'ACTIVE', ip, userAgent);
  }

  @Post(':id/disable')
  @RequirePermissions(ADMIN_PERMISSIONS.PAYMENT_GATEWAYS_UPDATE)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Disable a gateway' })
  disable(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.gateways.setStatus(id, auth, 'INACTIVE', ip, userAgent);
  }

  @Post(':id/test')
  @RequirePermissions(ADMIN_PERMISSIONS.PAYMENT_GATEWAYS_TEST)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Test gateway connectivity (real server-side request)' })
  test(@Param('id') id: string) {
    return this.gateways.testConnection(id);
  }
}
