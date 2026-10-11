import { Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { resolvePublicSiteUrl } from '../../config/site-url';
import { ReferralService } from './referral.service';
import { ReferralListQueryDto } from './dto/referral.dto';

/**
 * USER REFERRAL API — strictly scoped to the authenticated caller.
 *
 * SECURITY: every route is derived from `auth.id` taken from the verified JWT.
 * There is deliberately NO `/:userId` parameter anywhere in this controller, so
 * `GET /me/referral/rewards` can only ever describe the caller. There is no
 * public (unauthenticated) referral endpoint at all. The admin equivalents live
 * in a separate controller behind `@Roles('ADMIN','SUPER_ADMIN')`.
 */
@ApiTags('referral')
@ApiBearerAuth()
@Controller('me/referral')
export class ReferralController {
  constructor(
    private readonly referrals: ReferralService,
    private readonly config: ConfigService,
  ) {}

  /**
   * The public base URL of the deployed site (never hard-coded).
   *
   * Delegates to the ONE shared resolver (config/site-url.ts) so the referral
   * link can never drift from the canonical site configuration the rest of the
   * API and the web app already use.
   */
  private siteUrl(): string {
    return resolvePublicSiteUrl((key) => this.config.get<string>(key));
  }

  @Get()
  @ApiOperation({ summary: 'My referral code, link and headline numbers' })
  async me(@CurrentUser() auth: AuthenticatedUser) {
    return this.referrals.getMySummary(auth.id, this.siteUrl());
  }

  @Get('users')
  @ApiOperation({ summary: 'Users I referred (username + masked email only)' })
  async myReferredUsers(
    @CurrentUser() auth: AuthenticatedUser,
    @Query() query: ReferralListQueryDto,
  ) {
    return this.referrals.getMyReferredUsers(auth.id, {
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Get('rewards')
  @ApiOperation({ summary: 'My referral reward history' })
  async myRewards(
    @CurrentUser() auth: AuthenticatedUser,
    @Query() query: ReferralListQueryDto,
  ) {
    return this.referrals.getMyRewards(auth.id, {
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  /**
   * Re-runs the qualification check for the referrals I am on the receiving end
   * of.
   *
   * This is how a deposit or wager made through ANY existing flow is eventually
   * picked up without that flow having to know referrals exist. It is fully
   * idempotent: a referral that already paid cannot pay again.
   */
  @Post('sync')
  @HttpCode(200)
  @ApiOperation({ summary: 'Re-evaluate my pending referral qualifications' })
  async sync(@CurrentUser() auth: AuthenticatedUser) {
    return this.referrals.syncUser(auth.id);
  }
}
