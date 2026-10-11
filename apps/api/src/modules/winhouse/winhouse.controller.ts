import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { WinHouseLaunchResponse } from '@tanvion-royale/types';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { WinHouseLaunchService } from './winhouse-launch.service';

/**
 * BIG SPORT → embedded sportsbook launch (authenticated TANVION user only).
 *
 * `GET /winhouse/launch` mints the provider's short-lived launch token for the
 * SIGNED-IN user and returns the PUBLIC embed configuration the loader needs.
 *
 * What the browser receives: the signed launch token (expires in minutes), the
 * public embed key (`ifr_…`, public by provider design), the book origin and
 * presentation hints.
 * What it NEVER receives: the wallet API key, the callback token, or any other
 * credential. Those stay server-side for the whole lifetime of the integration.
 */
@ApiTags('winhouse')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('winhouse')
export class WinHouseController {
  constructor(private readonly launch: WinHouseLaunchService) {}

  @Get('launch')
  @ApiOperation({
    summary: 'Mint the WinHouse launch token for the signed-in player (Model B SSO)',
  })
  async launchBook(@CurrentUser() auth: AuthenticatedUser): Promise<WinHouseLaunchResponse> {
    return this.launch.launch({
      userId: auth.id,
      platformSessionId: auth.sessionId ?? null,
    });
  }
}
