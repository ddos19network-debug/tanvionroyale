import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ReferralService } from './referral.service';
import {
  AdjustReferralRewardDto,
  ReferralStatusDto,
  SearchReferralRewardsDto,
  SearchReferrersDto,
  UpdateReferralSettingsDto,
} from './dto/referral.dto';

/**
 * ADMIN REFERRAL API.
 *
 * AUTHORIZATION: `@Roles('ADMIN', 'SUPER_ADMIN')` on the controller, using the
 * project's EXISTING `RolesGuard`. There is no other referral admin route, so
 * this is the only way to read another user's referral data or change the
 * program configuration.
 */
@ApiTags('admin/referral')
@ApiBearerAuth()
@Roles('ADMIN', 'SUPER_ADMIN')
@Controller('admin/referral')
export class AdminReferralController {
  constructor(private readonly referrals: ReferralService) {}

  @Get('settings')
  @ApiOperation({ summary: 'Referral program configuration' })
  settings() {
    return this.referrals.getSettings();
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update the referral program configuration' })
  updateSettings(
    @Body() dto: UpdateReferralSettingsDto,
    @CurrentUser() auth: AuthenticatedUser,
  ) {
    return this.referrals.updateSettings(dto, auth.id);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Referral dashboard counters' })
  stats() {
    return this.referrals.getAdminStats();
  }

  @Get('top-referrers')
  @ApiOperation({ summary: 'Top referrers by qualified count' })
  async topReferrers() {
    return { items: await this.referrals.getTopReferrers(10) };
  }

  @Get('referrers')
  @ApiOperation({ summary: 'Search referrers by username, user id or referral code' })
  referrers(@Query() query: SearchReferrersDto) {
    return this.referrals.searchReferrers(query.search, {
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Get('rewards')
  @ApiOperation({ summary: 'Search the referral reward ledger' })
  rewards(@Query() query: SearchReferralRewardsDto) {
    return this.referrals.searchRewards(
      { search: query.search, status: query.status },
      { page: query.page, pageSize: query.pageSize },
    );
  }

  @Post('rewards/:id/adjust')
  @ApiOperation({ summary: 'Audited manual adjustment of one referral reward' })
  adjust(
    @Param('id') id: string,
    @Body() dto: AdjustReferralRewardDto,
    @CurrentUser() auth: AuthenticatedUser,
  ) {
    return this.referrals.adjustReward(id, dto.amount, dto.reason, auth.id);
  }

  @Post('referrals/:id/status')
  @ApiOperation({ summary: 'Reject or cancel a referral (audited, never deleted)' })
  setStatus(
    @Param('id') id: string,
    @Body() dto: ReferralStatusDto,
    @CurrentUser() auth: AuthenticatedUser,
  ) {
    return this.referrals.setReferralStatus(id, dto.status, dto.reason, auth.id);
  }

  @Post('evaluate/:userId')
  @ApiOperation({ summary: 'Re-evaluate the pending referral of one user' })
  async evaluate(@Param('userId') userId: string) {
    return this.referrals.syncUser(userId);
  }
}
