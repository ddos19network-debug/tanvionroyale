import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { PartnerProvidersService } from './partner-providers.service';
import { CreatePartnerProviderDto, UpdatePartnerProviderDto } from './dto/partner-providers.dto';

/**
 * Admin-only sports partner provider configuration + sync trigger.
 *
 * Secrets are never returned raw -- only *Set boolean flags. Normal users
 * can never access these routes (JWT + RolesGuard + @Roles).
 */
@ApiTags('admin/partner-providers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@RequirePermissions(ADMIN_PERMISSIONS.PARTNER_PROVIDERS_READ)
@Controller('admin/partner-providers')
export class PartnerProvidersController {
  constructor(private readonly service: PartnerProvidersService) {}

  private context(req: Request): { ip?: string; userAgent?: string } {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  @Get()
  @ApiOperation({ summary: 'List partner providers (secrets masked)' })
  async list() {
    return this.service.list();
  }

  @Post()
  @RequirePermissions(ADMIN_PERMISSIONS.PARTNER_PROVIDERS_CREATE)
  @ApiOperation({ summary: 'Create a partner provider (admin)' })
  async create(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() dto: CreatePartnerProviderDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.service.create(auth, dto, ip, userAgent);
  }

  @Patch(':id')
  @RequirePermissions(ADMIN_PERMISSIONS.PARTNER_PROVIDERS_UPDATE)
  @ApiOperation({ summary: 'Update a partner provider (admin)' })
  async update(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePartnerProviderDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.service.update(id, auth, dto, ip, userAgent);
  }

  @Delete(':id')
  @RequirePermissions(ADMIN_PERMISSIONS.PARTNER_PROVIDERS_DELETE)
  @ApiOperation({ summary: 'Delete a partner provider (admin)' })
  async remove(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    await this.service.remove(id, auth, ip, userAgent);
  }

  @Post('sync')
  @RequirePermissions(ADMIN_PERMISSIONS.PARTNER_PROVIDERS_SYNC)
  @ApiOperation({ summary: 'Run a sports sync (admin; optional providerId)' })
  async sync(
    @CurrentUser() auth: AuthenticatedUser,
    @Req() req: Request,
    @Query('providerId') providerId?: string,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.service.runSync(providerId, auth, ip, userAgent);
  }
}