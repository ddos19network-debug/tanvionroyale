/**
 * ADMIN endpoint for the BigBang portal configuration.
 *
 * AUTHORIZATION: `@Roles('ADMIN', 'SUPER_ADMIN')` + the existing
 * `PARTNER_PROVIDERS_READ`/`_UPDATE` permissions through the project's
 * `RolesGuard`. It reuses the SAME admin provider surface as
 * `PartnerProvidersController` — there is no second, looser provider admin
 * API. A normal user can never reach this controller.
 *
 * ROUTES
 *   GET  /admin/partner-providers/bigbang/webhook          -> URLs + secret flag
 *   POST /admin/partner-providers/bigbang/webhook/secret   -> generate / rotate
 *
 * The generate/rotate response is the ONLY place the plaintext secret is ever
 * returned. The GET route answers with a boolean, never the value.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { BigBangWebhookConfigService } from './bigbang-webhook-config.service';

/** Optional filter so a multi-BigBang deployment can target one row. */
export class BigBangWebhookSecretDto {
  @ApiPropertyOptional()
  providerId?: string;
}

@ApiTags('admin/partner-providers')
@ApiBearerAuth()
@Roles('ADMIN', 'SUPER_ADMIN')
@Controller('admin/partner-providers/bigbang/webhook')
export class BigBangWebhookAdminController {
  constructor(private readonly config: BigBangWebhookConfigService) {}

  @Get()
  @RequirePermissions(ADMIN_PERMISSIONS.PARTNER_PROVIDERS_READ)
  @ApiOperation({
    summary: 'BigBang portal URLs and webhook-secret status (secret is never returned)',
  })
  async getConfig(@CurrentUser() _auth: AuthenticatedUser) {
    return this.config.getConfig();
  }

  @Post('secret')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(ADMIN_PERMISSIONS.PARTNER_PROVIDERS_UPDATE)
  @ApiOperation({
    summary: 'Generate or rotate the BigBang webhook secret (returned exactly once)',
  })
  async generateSecret(
    @Body() dto: BigBangWebhookSecretDto,
    @CurrentUser() auth: AuthenticatedUser,
  ) {
    return this.config.generateSecret(auth.id, dto?.providerId);
  }
}
