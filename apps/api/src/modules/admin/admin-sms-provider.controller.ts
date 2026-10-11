import { Body, Controller, Get, Patch, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { SmsProviderSettingsService } from '../auth/sms-provider-settings.service';
import { UpdateSmsProviderSettingsDto } from './dto/admin-sms-provider.dto';

/**
 * ADMIN SMS PROVIDER API.
 *
 * AUTHORIZATION
 *   Uses the project's EXISTING guard chain: the global JwtAuthGuard plus
 *   RolesGuard, `@Roles('ADMIN','SUPER_ADMIN')` on the controller (so a customer
 *   session can never reach it) and the existing staff capability system:
 *     - read  -> `settings.read`  (the same capability GET /admin/settings uses)
 *     - write -> `settings.write` (a separate capability, so viewing the SMS
 *                 configuration and changing how OTP messages leave the platform
 *                 are never the same grant)
 *   The RolesGuard requires cumulative permissions, so the write route still
 *   demands the read capability declared at controller level.
 *
 * SECRETS
 *   The response is the provider SELECTION plus a boolean `configured` flag per
 *   provider. There is no API secret, auth token, Account SID or API key in any
 *   shape of this endpoint, and no field that could carry one.
 */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@RequirePermissions(ADMIN_PERMISSIONS.SETTINGS_READ)
@Controller('admin/settings')
export class AdminSmsProviderController {
  constructor(private readonly smsProviderSettings: SmsProviderSettingsService) {}

  @Get('sms-provider')
  @ApiOperation({
    summary: 'Current SMS provider selection and per-provider configuration status (no secrets)',
  })
  getSmsProvider() {
    return this.smsProviderSettings.getView();
  }

  @Put('sms-provider')
  @RequirePermissions(ADMIN_PERMISSIONS.SETTINGS_WRITE)
  @ApiOperation({ summary: 'Select which SMS provider delivers the one-time codes' })
  updateSmsProvider(
    @Body() dto: UpdateSmsProviderSettingsDto,
    @CurrentUser() auth: AuthenticatedUser,
  ) {
    return this.smsProviderSettings.update(dto, auth.id);
  }

  /** PATCH is an accepted alias of PUT so either verb can drive the panel. */
  @Patch('sms-provider')
  @RequirePermissions(ADMIN_PERMISSIONS.SETTINGS_WRITE)
  @ApiOperation({ summary: 'Select which SMS provider delivers the one-time codes (alias of PUT)' })
  patchSmsProvider(
    @Body() dto: UpdateSmsProviderSettingsDto,
    @CurrentUser() auth: AuthenticatedUser,
  ) {
    return this.smsProviderSettings.update(dto, auth.id);
  }
}
