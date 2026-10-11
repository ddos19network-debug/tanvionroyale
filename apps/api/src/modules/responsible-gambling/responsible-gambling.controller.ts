import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ResponsibleGamblingService } from './responsible-gambling.service';
import { SelfExcludeDto, SetLimitDto } from './dto/responsible-gambling.dto';

/**
 * TANVION ROYALE — player responsible-gambling endpoints (Task 2 / audit F3).
 *
 * AUTHENTICATION: the global JwtAuthGuard protects every route here (there are
 * no @Public routes), so these are strictly "my own" controls.
 *
 * Players can always LOWER a limit or self-exclude (immediate). A RAISE or an
 * exclusion END is accepted here but only lands after the cooling-off delay —
 * the SERVICE decides, never the client.
 */
@ApiTags('responsible-gambling')
@Controller('responsible-gambling')
export class ResponsibleGamblingController {
  constructor(private readonly rg: ResponsibleGamblingService) {}

  @Get('limits')
  @ApiOperation({ summary: 'My play limits (effective + pending raises)' })
  async getLimits(@CurrentUser() user: AuthenticatedUser) {
    return { limits: await this.rg.getLimits(user.id) };
  }

  @Get('state')
  @ApiOperation({ summary: 'My responsible-gambling state (exclusions + limits)' })
  async getState(@CurrentUser() user: AuthenticatedUser) {
    return { state: await this.rg.getState(user.id) };
  }

  @Put('limits')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Set a limit — lowering is immediate, raising is delayed' })
  async setLimit(@CurrentUser() user: AuthenticatedUser, @Body() dto: SetLimitDto) {
    const limit = await this.rg.setLimit(user.id, dto, { actorId: user.id, actorType: 'USER' });
    return { limit };
  }

  @Post('self-exclude')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Self-exclude immediately (cooling-off / temporary / permanent)' })
  async selfExclude(@CurrentUser() user: AuthenticatedUser, @Body() dto: SelfExcludeDto) {
    const exclusion = await this.rg.selfExclude(user.id, dto, {
      actorId: user.id,
      actorType: 'USER',
    });
    return { exclusion };
  }

  @Post('exclusions/end')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Request to end an exclusion — effective only after cooling-off' })
  async endExclusion(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: { exclusionId: string },
  ) {
    const exclusion = await this.rg.endExclusion(user.id, dto.exclusionId, {
      actorId: user.id,
      actorType: 'USER',
    });
    return { exclusion };
  }
}
