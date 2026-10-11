/**
 * USER AFFILIATE API — strictly scoped to the authenticated caller.
 *
 * ROUTE NAMING
 *   These live under a caller-scoped `/me/affiliate` surface rather than a new
 *   `/api/v1/affiliate/*` tree, because the affiliate page is a view of the
 *   referral program. That keeps ONE caller-scoped namespace instead of two
 *   overlapping ones, and the two existing endpoints that already answer this
 *   data (`/me/referral/users` and `/me/referral/rewards`) are REUSED rather
 *   than duplicated.
 *
 * SECURITY
 *   Every route derives from `auth.id` taken from the verified JWT. There is no
 *   `/:userId` parameter anywhere, so no user can read another affiliate's
 *   income, referred users, transactions or target. There is also no route
 *   that accepts a reward amount, an income figure or a status from the
 *   browser — all of that is computed server-side.
 *
 *   `POST /track-click` is the ONE public route. It is throttled, it accepts
 *   only a referral CODE (never a user id), the code is validated server-side
 *   through the existing resolver, and it stores no personal data.
 */
import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { Public } from '../../common/decorators/public.decorator';
import { resolvePublicSiteUrl } from '../../config/site-url';
import { AffiliateService } from './affiliate.service';
import { ActivateAffiliateDto, TrackAffiliateClickDto } from './dto/affiliate.dto';
import { ReferralService } from './referral.service';
import { ReferralListQueryDto } from './dto/referral.dto';

@ApiTags('affiliate')
@ApiBearerAuth()
@Controller('me/affiliate')
export class AffiliateController {
  constructor(
    private readonly affiliate: AffiliateService,
    private readonly referrals: ReferralService,
    private readonly config: ConfigService,
  ) {}

  /**
   * The canonical public frontend origin, taken from the existing shared
   * configuration (config/site-url.ts) — the same resolver the referral
   * controller uses, so the affiliate link and the referral link can never be
   * built from two different origins. Never a hard-coded localhost or domain.
   */
  private siteUrl(): string {
    return resolvePublicSiteUrl((key) => this.config.get<string>(key));
  }

  @Get('dashboard')
  @ApiOperation({
    summary: 'My affiliate state: activation, link, stats, monthly target and page content',
  })
  async dashboard(@CurrentUser() auth: AuthenticatedUser) {
    return this.affiliate.getDashboard(auth.id, this.siteUrl());
  }

  /**
   * Activation state only, with the form prefill.
   *
   * Separate from `dashboard` so the "Become an Affiliate" card can be
   * rendered without ever holding a link or a figure it must not show.
   */
  @Get('status')
  @ApiOperation({ summary: 'My affiliate activation state and form prefill' })
  async status(@CurrentUser() auth: AuthenticatedUser) {
    return this.affiliate.getActivationView(auth.id);
  }

  /**
   * Explicit affiliate activation.
   *
   * `userId` comes from the verified JWT, never from the body, so a caller can
   * only ever activate THEMSELVES. Idempotent: submitting twice returns the
   * same active state rather than a second profile. No reward is created and
   * no wallet balance changes as a result.
   */
  @Post('activate')
  @ApiOperation({ summary: 'Activate the affiliate program (idempotent)' })
  async activate(@CurrentUser() auth: AuthenticatedUser, @Body() dto: ActivateAffiliateDto) {
    return this.affiliate.activate(auth.id, dto);
  }

  /** Self-service opt-out. Referral code, referrals and rewards are kept. */
  @Post('deactivate')
  @ApiOperation({ summary: 'Deactivate my own affiliate account' })
  async deactivate(@CurrentUser() auth: AuthenticatedUser) {
    return this.affiliate.deactivate(auth.id);
  }

  @Get('stats')
  @ApiOperation({ summary: 'My affiliate counters (server-aggregated)' })
  async stats(@CurrentUser() auth: AuthenticatedUser) {
    return this.affiliate.getStats(auth.id);
  }

  /**
   * The affiliate link, but ONLY for an active affiliate.
   *
   * An inactive or never-activated caller receives `null` for both fields. The
   * user's own referral code still exists and is still served by
   * `GET /me/referral` — this route simply must not act as a way around the
   * activation gate.
   */
  @Get('link')
  @ApiOperation({ summary: 'My affiliate code and shareable link (active affiliates only)' })
  async link(@CurrentUser() auth: AuthenticatedUser) {
    const dashboard = await this.affiliate.getDashboard(auth.id, this.siteUrl());
    return {
      affiliateStatus: dashboard.affiliateStatus,
      referralCode: dashboard.referralCode,
      referralLink: dashboard.referralLink,
    };
  }

  @Get('target')
  @ApiOperation({ summary: 'My monthly target and progress' })
  async target(@CurrentUser() auth: AuthenticatedUser) {
    return this.affiliate.getTarget(auth.id);
  }

  @Get('content')
  @ApiOperation({ summary: 'The admin-configured affiliate page content' })
  async content() {
    return { items: await this.affiliate.listContent() };
  }

  /**
   * Reuses the EXISTING referred-users endpoint rather than adding an
   * `/affiliate/referrals` duplicate of it.
   */
  @Get('referrals')
  @ApiOperation({ summary: 'Users I referred (paginated; same source as /me/referral/users)' })
  async myReferrals(@CurrentUser() auth: AuthenticatedUser, @Query() query: ReferralListQueryDto) {
    return this.referrals.getMyReferredUsers(auth.id, {
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  /**
   * Reuses the EXISTING reward-history endpoint rather than adding an
   * `/affiliate/transactions` duplicate of it.
   */
  @Get('transactions')
  @ApiOperation({ summary: 'My affiliate transaction history (paginated)' })
  async transactions(@CurrentUser() auth: AuthenticatedUser, @Query() query: ReferralListQueryDto) {
    return this.referrals.getMyRewards(auth.id, { page: query.page, pageSize: query.pageSize });
  }

  /**
   * Records one click on an affiliate link.
   *
   * Public by necessity (a visitor is not signed in yet) but tightly bounded:
   *   - throttled per IP;
   *   - accepts ONLY a code, which the server resolves and validates;
   *   - de-duplicated per visitor per day, so a refresh is not a new click;
   *   - stores no IP, user agent, cookie or fingerprint.
   */
  @Public()
  @Post('track-click')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Record one affiliate link click (throttled, de-duplicated)' })
  async trackClick(@Body() dto: TrackAffiliateClickDto, @Req() request: Request) {
    await this.affiliate.trackClick({
      code: dto.code,
      landingPath: dto.path ?? null,
      fingerprint: {
        ipPrefix: ipPrefix(request.ip),
        userAgentFamily: userAgentFamily(request.headers['user-agent']),
      },
    });
  }
}

/**
 * A coarse /24-style prefix of the client IP.
 *
 * Only ever fed into a SHA-256 de-duplication key and never stored, so it
 * cannot identify a person — it merely stops a single visitor inflating the
 * click count from one machine.
 */
function ipPrefix(ip: string | undefined): string | null {
  if (!ip) return null;
  if (ip.includes(':')) return ip.split(':').slice(0, 4).join(':');
  const parts = ip.split('.');
  return parts.length === 4 ? parts.slice(0, 3).join('.') : null;
}

/**
 * The BROADEST useful signal about the client — a family, not the raw string.
 *
 * The full user agent is never stored: it is a fingerprint. Reducing it to
 * one of a handful of families keeps de-duplication useful without persisting
 * anything that identifies a browser.
 */
function userAgentFamily(userAgent: string | undefined): string | null {
  if (!userAgent) return null;
  const value = userAgent.toLowerCase();
  if (value.includes('edg/')) return 'edge';
  if (value.includes('chrome/')) return 'chrome';
  if (value.includes('firefox/')) return 'firefox';
  if (value.includes('safari/')) return 'safari';
  if (value.includes('bot') || value.includes('crawler')) return 'bot';
  return 'other';
}

