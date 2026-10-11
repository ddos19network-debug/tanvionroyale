import {
  Body,
  Controller,
  Get,
  NotFoundException,
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
import { PrismaService } from '../../database/prisma.service';
import { CasinoCatalogService } from './casino-catalog.service';
import { CasinoProviderFactory } from './casino-provider.factory';
import { CasinoCatalogQueryDto, type CasinoProductParam } from './dto/casino-catalog.dto';
import { CasinoGameAdminDto, CasinoProviderConfigDto } from './dto/casino-admin.dto';

/**
 * Admin surface for BIG CASINO / BIG LIVE CASINO.
 *
 * Reuses the EXISTING admin conventions (JwtAuthGuard + RolesGuard + @Roles,
 * audit log, secret-free responses) and the EXISTING provider registry
 * (`PartnerProvider`) instead of introducing a second one: credentials are
 * still edited only through `/admin/partner-providers`, and this controller
 * simply lets an admin label that row for the casino product (environment,
 * API version, base URL, enabled state) and run/inspect a catalog sync.
 *
 * Secrets are NEVER returned here — only `configured` booleans and status.
 */
@ApiTags('admin/casino')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPER_ADMIN')
@RequirePermissions(ADMIN_PERMISSIONS.CASINO_READ)
@Controller('admin/casino')
export class CasinoAdminController {
  constructor(
    private readonly catalog: CasinoCatalogService,
    private readonly providers: CasinoProviderFactory,
    private readonly prisma: PrismaService,
  ) {}

  private context(req: Request): { ip?: string; userAgent?: string } {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  @Get('status')
  @ApiOperation({ summary: 'Casino provider status/counts (secrets masked)' })
  status() {
    return this.catalog.getAdminStatus();
  }

  @Post('sync')
  @RequirePermissions(ADMIN_PERMISSIONS.CASINO_MANAGE)
  @ApiOperation({ summary: 'Run a partner catalog sync for EVERY eligible provider (admin)' })
  async sync(@CurrentUser() auth: AuthenticatedUser, @Req() req: Request) {
    const summary = await this.catalog.sync();
    await this.audit(auth.id, 'CASINO_CATALOG_SYNCED', summary.provider, {
      providersDiscovered: summary.providersDiscovered,
      providersSynced: summary.providersSynced,
      providersFailed: summary.providersFailed,
      fetched: summary.fetched,
      created: summary.created,
      updated: summary.updated,
      games: summary.games,
      categories: summary.categories,
      deactivated: summary.deactivated,
      providerResults: summary.providerResults,
      errors: summary.errors,
      ip: this.context(req).ip,
    });
    return summary;
  }

  @Get('games')
  @ApiOperation({ summary: 'Admin catalog listing (includes inactive games)' })
  games(@Query() query: CasinoCatalogQueryDto) {
    return this.catalog.getAdminCatalog({
      productType: this.toProduct(query.product),
      providerExternalId: query.provider,
      categorySlug: query.category,
      search: query.search,
      featured: query.featured,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Patch('games/:id')
  @RequirePermissions(ADMIN_PERMISSIONS.CASINO_MANAGE)
  @ApiOperation({ summary: 'Enable/disable/feature one synced game (admin)' })
  async updateGame(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CasinoGameAdminDto,
    @Req() req: Request,
  ) {
    const updated = await this.catalog.setGameFlags(id, {
      status: dto.status,
      isFeatured: dto.featured,
      launchAvailable: dto.launchAvailable,
      demoAvailable: dto.demoAvailable,
      sortOrder: dto.sortOrder,
    });
    if (!updated) throw new NotFoundException('Casino game not found');
    await this.audit(auth.id, 'CASINO_GAME_UPDATED', id, {
      ...dto,
      ip: this.context(req).ip,
    });
    return updated;
  }

  @Get('sessions')
  @ApiOperation({ summary: 'Recent casino sessions (reconciliation)' })
  async sessions(@Query('limit') limit?: string) {
    const take = Math.min(Math.max(Number.parseInt(limit ?? '50', 10) || 50, 1), 200);
    return this.prisma.casinoSession.findMany({
      orderBy: { launchedAt: 'desc' },
      take,
      select: {
        id: true,
        userId: true,
        externalGameId: true,
        providerPlayerId: true,
        providerSessionId: true,
        currency: true,
        environment: true,
        demo: true,
        status: true,
        launchedAt: true,
        closedAt: true,
      },
    });
  }

  @Get('transactions')
  @ApiOperation({ summary: 'Recent casino wallet transactions (reconciliation)' })
  async transactions(@Query('limit') limit?: string) {
    const take = Math.min(Math.max(Number.parseInt(limit ?? '50', 10) || 50, 1), 200);
    return this.prisma.casinoTransaction.findMany({
      orderBy: { createdAt: 'desc' },
      take,
      select: {
        id: true,
        userId: true,
        externalTransactionId: true,
        externalRoundId: true,
        kind: true,
        status: true,
        amount: true,
        currency: true,
        walletTransactionId: true,
        referenceTransactionId: true,
        createdAt: true,
      },
    });
  }

  @Post('providers/:id/config')
  @RequirePermissions(ADMIN_PERMISSIONS.CASINO_MANAGE)
  @ApiOperation({ summary: 'Label an existing PartnerProvider row for the casino product' })
  async configureProvider(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CasinoProviderConfigDto,
    @Req() req: Request,
  ) {
    const existing = await this.prisma.partnerProvider.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Partner provider not found');

    // productTypes is the EXISTING routing column: adding the casino products
    // makes this row selectable by the casino resolver without creating a
    // duplicate provider registry.
    const productTypes = Array.from(
      new Set([...existing.productTypes, 'CASINO', 'LIVE_CASINO']),
    );

    const updated = await this.prisma.partnerProvider.update({
      where: { id },
      data: {
        environment: dto.environment ?? existing.environment,
        apiVersion: dto.apiVersion ?? existing.apiVersion,
        baseUrl: dto.baseUrl ?? existing.baseUrl,
        deepLinkTemplate: dto.deepLinkTemplate ?? existing.deepLinkTemplate,
        status: dto.status ?? existing.status,
        productTypes,
      },
    });

    await this.audit(auth.id, 'CASINO_PROVIDER_CONFIGURED', id, {
      environment: dto.environment ?? null,
      apiVersion: dto.apiVersion ?? null,
      status: dto.status ?? null,
      productTypes,
      ip: this.context(req).ip,
    });

    return {
      id: updated.id,
      name: updated.name,
      baseUrl: updated.baseUrl,
      status: updated.status,
      environment: updated.environment,
      apiVersion: updated.apiVersion,
      productTypes: updated.productTypes,
      // Credentials are never returned — only whether they exist.
      credentialsConfigured: Boolean(
        (updated.apiKeyEnc ?? process.env.PARTNER_CASINO_MERCHANT_ID) &&
          (updated.apiSecretEnc ?? process.env.PARTNER_CASINO_SECRET),
      ),
    };
  }

  private toProduct(product: CasinoProductParam | undefined): 'CASINO' | 'LIVE_CASINO' {
    return product === 'live' ? 'LIVE_CASINO' : 'CASINO';
  }

  private async audit(
    actorId: string,
    action: string,
    entityId: string | null,
    detail: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorId,
        actorType: 'ADMIN',
        action,
        entityType: 'CasinoProvider',
        entityId,
        newValue: detail as never,
      },
    });
  }
}
