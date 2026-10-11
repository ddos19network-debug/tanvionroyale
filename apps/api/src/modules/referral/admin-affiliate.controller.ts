/**
 * ADMIN AFFILIATE API.
 *
 * AUTHORIZATION: `@Roles('ADMIN', 'SUPER_ADMIN')` plus the project's EXISTING
 * `UsersGuard` + `RequirePermissions` pair, the same protection the sibling
 * `AdminReferralController` uses. A normal user can never reach this
 * controller, and a customer session is refused by the guard's `sessionKind`
 * check even if the account is promoted mid-session.
 *
 * It extends the referral admin namespace (`/admin/affiliate`) rather than
 * creating a parallel admin API, so there is one place to look for referral
 * and affiliate administration.
 *
 * FINANCIAL SAFETY: no route here accepts a reward amount, an income figure or
 * a paid/approved status. `PUT /:userId/target` sets CONFIGURATION only, and
 * every target and content change is written to the audit log.
 *
 * CONTENT SCOPES (GLOBAL vs INDIVIDUAL)
 *   The global routes (`content/blocks...`) only ever touch blocks whose
 *   `affiliateUserId` is NULL. The per-affiliate routes (`:userId/content...`)
 *   only ever touch blocks whose `affiliateUserId` equals the selected, verified
 *   ACTIVE affiliate. The two cannot reach each other's rows, and the scope is
 *   always derived from the URL - never from the request body.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AffiliateService } from './affiliate.service';
import { ReferralService } from './referral.service';
import { SearchReferrersDto } from './dto/referral.dto';
import {
  ReorderAffiliateContentDto,
  SetAffiliateStatusDto,
  SetAffiliateTargetDto,
  UpsertAffiliateContentDto,
} from './dto/affiliate.dto';

@ApiTags('admin/affiliate')
@ApiBearerAuth()
@Roles('ADMIN', 'SUPER_ADMIN')
@Controller('admin/affiliate')
export class AdminAffiliateController {
  constructor(
    private readonly affiliate: AffiliateService,
    private readonly referrals: ReferralService,
  ) {}

  @Get()
  @RequirePermissions(ADMIN_PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'Affiliate program overview (affiliates, clicks, conversions, rewards)' })
  async overview() {
    return this.affiliate.getAdminOverview();
  }

  // ---------------------------------------------------------------------------
  // ROUTE ORDER
  // The literal `content/blocks...` paths are declared BEFORE `@Get(':userId')`.
  // In Express the first matching route wins, so a `:userId` declared first
  // would swallow `content/blocks` and try to look up an affiliate whose id is
  // literally the string "content". Keeping the static paths first makes that
  // impossible. The same reason puts `affiliates` above `:userId`.
  // ---------------------------------------------------------------------------

  @Get('content/blocks')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'All affiliate content blocks, enabled or not' })
  async listContent() {
    return { items: await this.affiliate.listContentForAdmin() };
  }

  @Post('content/blocks')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'Add an affiliate content section (audited)' })
  async createContent(
    @Body() dto: UpsertAffiliateContentDto,
    @CurrentUser() auth: AuthenticatedUser,
  ) {
    return this.affiliate.createContent(dto, auth.id);
  }

  @Post('content/blocks/reorder')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'Reorder affiliate sections from an explicit ordered id list' })
  async reorderContent(
    @Body() dto: ReorderAffiliateContentDto,
    @CurrentUser() auth: AuthenticatedUser,
  ) {
    return { items: await this.affiliate.reorderContent(dto.ids, auth.id) };
  }

  @Post('content/blocks/:id')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'Update an affiliate content section (audited)' })
  async updateContent(
    @Param('id') id: string,
    @Body() dto: UpsertAffiliateContentDto,
    @CurrentUser() auth: AuthenticatedUser,
  ) {
    return this.affiliate.updateContent(id, dto, auth.id);
  }

  @Delete('content/blocks/:id')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'Remove an affiliate content section (audited)' })
  async deleteContent(
    @Param('id') id: string,
    @CurrentUser() auth: AuthenticatedUser,
  ) {
    return this.affiliate.deleteContent(id, auth.id);
  }

  /**
   * The ACTIVE affiliate list.
   *
   * Backed by `AffiliateProfile.status = 'ACTIVE'`, so a user who merely owns
   * a referral code never appears here. Paginated, so the browser does not load
   * every affiliate. The normal referral admin list is unchanged and still
   * shows referral users.
   */
  @Get('affiliates')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'Search ACTIVE affiliates by username, user id or referral code' })
  async searchAffiliates(@Query() query: SearchReferrersDto) {
    return this.affiliate.searchActiveAffiliates(query.search, {
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  /**
   * Deactivate or reactivate an affiliate.
   *
   * Writes the membership flag only: no referral, reward, click, wallet or
   * ledger row is touched, and the existing click history is preserved. The
   * change is recorded in the audit log with the admin as the actor.
   */
  @Post(':userId/status')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'Activate or deactivate an affiliate (audited)' })
  async setStatus(
    @Param('userId') userId: string,
    @Body() dto: SetAffiliateStatusDto,
    @CurrentUser() auth: AuthenticatedUser,
  ) {
    return this.affiliate.setStatus(userId, dto, auth.id);
  }

  @Get(':userId')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'One affiliate: identity, activation, stats, target and target history' })
  async detail(@Param('userId') userId: string) {
    return this.affiliate.getAdminAffiliateDetail(userId);
  }

  /** Reuses the existing referred-user query; no duplicate implementation. */
  @Get(':userId/referrals')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'Users one affiliate referred (paginated)' })
  async referrals_(@Param('userId') userId: string, @Query() query: SearchReferrersDto) {
    return this.referrals.getMyReferredUsers(userId, {
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  /** Reuses the existing reward ledger search; no duplicate implementation. */
  @Get(':userId/transactions')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'One affiliate reward ledger (paginated, server-side totals)' })
  async transactions(@Param('userId') userId: string, @Query() query: SearchReferrersDto) {
    return this.referrals.searchRewards(
      {},
      { page: query.page, pageSize: query.pageSize },
    );
  }

  @Put(':userId/target')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'Set one monthly target for one affiliate (audited)' })
  async setTarget(
    @Param('userId') userId: string,
    @Body() dto: SetAffiliateTargetDto,
    @CurrentUser() auth: AuthenticatedUser,
  ) {
    return this.affiliate.setTarget(userId, dto, auth.id);
  }

  // ---------------------------------------------------------------------------
  // INDIVIDUAL (per-affiliate) page content
  //
  // The scope is DERIVED from the `:userId` path segment and re-verified
  // server-side against an ACTIVE `AffiliateProfile`. The request body has no
  // scope field at all, so a browser cannot name somebody else's affiliate
  // page, and the acting admin's own id is never substituted for the
  // selected affiliate.
  //
  // ROUTE ORDER (same reason as above): the literal `content/reorder` path is
  // declared BEFORE `content/:contentId`. In Express the first match wins, so a
  // `:contentId` route declared first would swallow the literal "reorder" and
  // then 404 on an unknown block id instead of reordering.
  // ---------------------------------------------------------------------------

  @Get(':userId/content')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS_READ)
  @ApiOperation({
    summary: "One affiliate's own page content (never another affiliate's, never global)",
  })
  async listIndividualContent(@Param('userId') userId: string) {
    return this.affiliate.getIndividualContentForAdmin(userId);
  }

  @Post(':userId/content')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS_READ)
  @ApiOperation({
    summary: 'Add a page section for one ACTIVE affiliate (audited, scope derived from the URL)',
  })
  async createIndividualContent(
    @Param('userId') userId: string,
    @Body() dto: UpsertAffiliateContentDto,
    @CurrentUser() auth: AuthenticatedUser,
  ) {
    return this.affiliate.createIndividualContent(userId, dto, auth.id);
  }

  @Post(':userId/content/reorder')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS_READ)
  @ApiOperation({
    summary: 'Reorder ONE affiliate sections; global and other affiliates are untouched',
  })
  async reorderIndividualContent(
    @Param('userId') userId: string,
    @Body() dto: ReorderAffiliateContentDto,
    @CurrentUser() auth: AuthenticatedUser,
  ) {
    return { items: await this.affiliate.reorderIndividualContent(userId, dto.ids, auth.id) };
  }

  @Patch(':userId/content/:contentId')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS_READ)
  @ApiOperation({
    summary: 'Edit one section owned by the selected affiliate (404 on any other owner)',
  })
  async updateIndividualContent(
    @Param('userId') userId: string,
    @Param('contentId') contentId: string,
    @Body() dto: UpsertAffiliateContentDto,
    @CurrentUser() auth: AuthenticatedUser,
  ) {
    return this.affiliate.updateIndividualContent(userId, contentId, dto, auth.id);
  }

  @Delete(':userId/content/:contentId')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'Remove one section owned by the selected affiliate (audited)' })
  async deleteIndividualContent(
    @Param('userId') userId: string,
    @Param('contentId') contentId: string,
    @CurrentUser() auth: AuthenticatedUser,
  ) {
    return this.affiliate.deleteIndividualContent(userId, contentId, auth.id);
  }

  /**
   * Remove ONE monthly target of the selected affiliate.
   *
   * A target is configuration, not a financial transaction: this removes the
   * single `AffiliateMonthlyTarget` row and leaves every referral, reward,
   * click, wallet and ledger record - and every other affiliate's targets -
   * exactly as they were. Ownership is verified on the server, so changing the
   * `:userId` segment cannot reach another affiliate's target.
   */
  @Delete(':userId/target/:targetId')
  @RequirePermissions(ADMIN_PERMISSIONS.USERS_READ)
  @ApiOperation({ summary: 'Remove one monthly target for one affiliate (audited)' })
  async deleteTarget(
    @Param('userId') userId: string,
    @Param('targetId') targetId: string,
    @CurrentUser() auth: AuthenticatedUser,
  ) {
    return this.affiliate.deleteTarget(userId, targetId, auth.id);
  }
}
