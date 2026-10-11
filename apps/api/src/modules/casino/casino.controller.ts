import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CatalogGame } from '@tanvion-royale/types';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CasinoCatalogService } from './casino-catalog.service';
import { CasinoLaunchService } from './casino-launch.service';
import {
  CasinoCatalogQueryDto,
  CasinoLaunchDto,
  type CasinoProductParam,
} from './dto/casino-catalog.dto';

function toProduct(product: CasinoProductParam | undefined): 'CASINO' | 'LIVE_CASINO' {
  return product === 'live' ? 'LIVE_CASINO' : 'CASINO';
}

/**
 * BIG CASINO + BIG LIVE CASINO user API.
 *
 * Product separation is enforced by a single required query parameter, so one
 * section can never return the other's games:
 *   /casino/catalog?product=casino  → BIG CASINO      (partner casino titles)
 *   /casino/catalog?product=live    → BIG LIVE CASINO (partner live-dealer)
 *
 * Everything the frontend renders comes from THIS backend — the browser never
 * receives a provider credential, a provider URL or a raw provider payload.
 * Launching requires authentication; browsing does not (same as the existing
 * public /games catalog).
 */
@ApiTags('casino')
@Controller('casino')
export class CasinoController {
  constructor(
    private readonly catalog: CasinoCatalogService,
    private readonly launch: CasinoLaunchService,
  ) {}

  @Public()
  @Get('status')
  @ApiOperation({ summary: 'Provider capability/health (no secrets)' })
  status() {
    return this.catalog.getCapabilityReport();
  }

  @Public()
  @Get('catalog')
  @ApiOperation({ summary: 'Product-scoped catalog page (casino | live)' })
  listCatalog(@Query() query: CasinoCatalogQueryDto) {
    return this.catalog.getCatalog({
      productType: toProduct(query.product),
      providerExternalId: query.provider,
      categorySlug: query.category,
      search: query.search,
      featured: query.featured,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Public()
  @Get('catalog/featured')
  @ApiOperation({ summary: 'Featured games for one product' })
  listFeatured(@Query() query: CasinoCatalogQueryDto) {
    return this.catalog.getCatalog({
      productType: toProduct(query.product),
      providerExternalId: query.provider,
      categorySlug: query.category,
      search: query.search,
      featured: true,
      page: query.page,
      pageSize: query.pageSize,
    });
  }

  @Public()
  @Get('catalog/categories')
  @ApiOperation({ summary: 'Catalog categories for one product' })
  async listCategories(@Query() query: CasinoCatalogQueryDto) {
    return this.catalog.listCategories(toProduct(query.product));
  }

  @Public()
  @Get('catalog/providers')
  @ApiOperation({ summary: 'Studios (providers) actually present in one product' })
  async listProviders(@Query() query: CasinoCatalogQueryDto) {
    return this.catalog.listProviders(toProduct(query.product));
  }

  @ApiBearerAuth()
  @Get('catalog/recent')
  @ApiOperation({ summary: 'My recently played games for one product (auth required)' })
  async listRecent(
    @CurrentUser() auth: AuthenticatedUser,
    @Query() query: CasinoCatalogQueryDto,
  ): Promise<CatalogGame[]> {
    return this.catalog.listRecentGames(auth.id, toProduct(query.product));
  }

  @Public()
  @Get('games/:gameId')
  @ApiOperation({ summary: 'Single catalog game by its stable TANVION catalog id' })
  async getGame(@Param('gameId') gameId: string) {
    // The catalog id contains a ':' which is URL-encoded by clients; decode it
    // defensively so both `a:b` and `a%3Ab` resolve.
    const id = decodeURIComponent(gameId);
    return this.catalog.getGameById(id);
  }

  @ApiBearerAuth()
  @Post('launch')
  @ApiOperation({ summary: 'Launch a partner game (auth required; URL is server-issued)' })
  async launchGame(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() dto: CasinoLaunchDto,
  ) {
    return this.launch.launch(auth.id, {
      gameId: dto.gameId,
      mode: dto.mode,
      currency: dto.currency,
      locale: dto.locale,
    });
  }

  @ApiBearerAuth()
  @Post('sessions/:sessionId/close')
  @ApiOperation({ summary: 'Close my casino session (auth required, ownership enforced)' })
  async closeSession(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('sessionId') sessionId: string,
  ) {
    return this.launch.closeSession(auth.id, sessionId);
  }
}
