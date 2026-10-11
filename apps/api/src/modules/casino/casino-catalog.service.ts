import { Injectable, Logger } from '@nestjs/common';
import type {
  AdminCasinoStatus,
  CatalogCategorySummary,
  CatalogGame,
  CatalogPage,
  CatalogProviderSummary,
  CatalogResponse,
  CasinoCapabilityReport,
  CasinoProviderRowSummary,
  CasinoProviderSyncResult,
  CasinoSyncSummary,
  ProductType,
} from '@tanvion-royale/types';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import {
  CasinoProviderFactory,
  type CasinoResolvedProvider,
} from './casino-provider.factory';
import { CasinoProviderError, type CasinoRemoteGame } from './casino-provider.interface';

type CasinoProduct = Extract<ProductType, 'CASINO' | 'LIVE_CASINO'>;

/** User-facing catalog query (every field is server-validated). */
export interface CasinoCatalogQuery {
  productType: CasinoProduct;
  /** Studio id/name reported by the provider (NOT the PartnerProvider row). */
  providerExternalId?: string | undefined;
  categorySlug?: string | undefined;
  search?: string | undefined;
  featured?: boolean | undefined;
  page?: number | undefined;
  pageSize?: number | undefined;
  /** Admin/reporting only: include INACTIVE rows. */
  includeInactive?: boolean | undefined;
}

/** The studio name a provider reports for a game (never the raw payload). */
function studioNameFromRaw(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = (raw as Record<string, unknown>).providerName;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * BIG CASINO / BIG LIVE CASINO catalog service.
 *
 * The frontend NEVER talks to the partner API. The flow is always:
 *
 *   Partner API → this backend (sync) → normalized catalog (DB) → frontend
 *
 * Why the DB is in the middle:
 *   - the catalog keeps working (cached) when the provider is briefly down;
 *   - search/filter/pagination are server-side (no per-card provider calls);
 *   - provider credentials never leave this process.
 *
 * HONESTY RULE: no game, category or provider row is ever invented. When the
 * provider is not configured or supplies nothing for a product, the response
 * reports `available: false` with a secret-free message.
 */
@Injectable()
export class CasinoCatalogService {
  private readonly logger = new Logger(CasinoCatalogService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: CasinoProviderFactory,
  ) {}

  // --------------------------------------------------------------------------
  // Admin status (secrets are only ever reported as boolean flags)
  // --------------------------------------------------------------------------

  async getAdminStatus(): Promise<AdminCasinoStatus> {
    const resolved = await this.providers.resolve();
    const report = await this.getCapabilityReport();
    const [games, categories, sessions, transactions, studios, providerRows] =
      await Promise.all([
        this.countGames(),
        this.prisma.casinoCategory.count(),
        this.prisma.casinoSession.count(),
        this.prisma.casinoTransaction.count(),
        this.prisma.casinoGame.groupBy({
          by: ['providerId'],
          where: { status: 'ACTIVE' },
        }),
        this.providerRowSummaries(),
      ]);

    return {
      ...report,
      credentials: {
        // Booleans only: the values are never read here, let alone returned.
        merchantConfigured: resolved.configured || Boolean(resolved.config.merchantId),
        secretConfigured: resolved.configured || Boolean(resolved.config.secret),
        source: resolved.credentialsSource,
      },
      counts: {
        games: games.total,
        casinoGames: games.casino,
        liveCasinoGames: games.liveCasino,
        featured: games.featured,
        inactive: games.inactive,
        categories,
        providers: studios.length,
        sessions,
        transactions,
      },
      apiVersion: resolved.config.apiVersion,
      providerRow: resolved.row,
      // ALL configured providers (not just the primary row), with real counts.
      providerRows,
    };
  }

  /** Admin catalog listing (includes INACTIVE rows for maintenance control). */
  async getAdminCatalog(query: CasinoCatalogQuery): Promise<CatalogResponse> {
    return this.getCatalog({ ...query, includeInactive: true });
  }

  async setGameFlags(
    id: string,
    patch: {
      status?: 'ACTIVE' | 'INACTIVE';
      isFeatured?: boolean;
      launchAvailable?: boolean;
      demoAvailable?: boolean;
      sortOrder?: number;
    },
  ): Promise<CatalogGame | null> {
    const updated = await this.prisma.casinoGame.updateMany({ where: { id }, data: patch });
    if (updated.count === 0) return null;
    const row = await this.prisma.casinoGame.findUnique({ where: { id } });
    if (!row) return null;
    return this.toCatalogGame(row, await this.providerNamesById());
  }

  // --------------------------------------------------------------------------
  // Capability report (admin + frontend honesty state)
  // --------------------------------------------------------------------------

  /**
   * Capability report (admin + frontend honesty state).
   *
   * PERFORMANCE / HONESTY CONTRACT: this method is called by BOTH
   * `GET /admin/casino/status` and the public `GET /casino/status`, so it must
   * never download the provider's whole inventory.
   *
   * It previously called `provider.capabilities()`, which for an aggregator
   * walks the ENTIRE catalog (~1,800+ rows) just to answer "does this product
   * have any games". That put a multi-page provider download in front of every
   * admin page load — and the verdict it produced was then thrown away,
   * because the database counts computed on the line above already knew the
   * answer exactly.
   *
   * The catalog is now read from the database, which is the authoritative,
   * always-available record of the last successful sync:
   *   - reachability comes from the CHEAP health probe (`GET /games?limit=1`),
   *     so "Reachable" reflects the provider RIGHT NOW, never a stale success;
   *   - product availability comes from the stored catalog counts.
   * A full inventory walk now happens only during an explicit catalog sync.
   */
  async getCapabilityReport(): Promise<CasinoCapabilityReport> {
    const resolved = await this.providers.resolve();
    const counts = await this.countGames();
    const lastSync = await this.lastSyncRow(resolved.row?.id ?? null);

    let reachable = false;
    const casino = counts.casino > 0;
    const liveCasino = counts.liveCasino > 0;
    const demoSupported = counts.demo > 0;
    let message = resolved.unavailableReason;

    if (resolved.configured) {
      const health = await resolved.provider.health();
      reachable = health.reachable;
      if (!health.reachable) {
        /*
         * Keep the provider's OWN reason (it is already classified and
         * secret-free: rejected key / wrong path / timeout / DNS failure).
         * Replacing it with a blanket "temporarily unreachable" is what hid
         * "invalid API key" behind a connectivity warning and made a working
         * catalog look like a broken casino system. The last-synced snapshot
         * is still intact, so the wording says exactly that.
         */
        const reason = health.message?.trim() || 'the provider did not answer';
        message =
          `The partner casino provider could not be verified: ${reason}. ` +
          'The catalog below is the last successfully synced snapshot and is unchanged.';
      } else if (!message && casino === false && liveCasino === false) {
        message =
          'The partner casino provider is reachable but the catalog holds no active games yet. ' +
          'Run a catalog sync to import the provider inventory.';
      }
    }

    return {
      configured: resolved.configured,
      environment: resolved.config.environment,
      provider: resolved.row?.name ?? null,
      reachable,
      casino,
      liveCasino,
      demoSupported,
      message,
      lastSyncAt: lastSync?.lastSyncAt?.toISOString() ?? null,
      lastSyncError: lastSync?.lastSyncError ?? null,
    };
  }


  // --------------------------------------------------------------------------
  // Product-scoped catalog page
  // --------------------------------------------------------------------------

  /**
   * Product-scoped catalog page. Only rows of the requested product type are
   * ever returned, so BIG CASINO search can never surface a live-dealer title
   * and BIG LIVE CASINO can never surface a slot.
   */
  async getCatalog(query: CasinoCatalogQuery): Promise<CatalogResponse> {
    const resolved = await this.providers.resolve();
    const config = resolved.config;
    const page = Math.max(query.page ?? 1, 1);
    const pageSize = Math.min(
      Math.max(query.pageSize ?? config.pageSizeDefault, 1),
      config.pageSizeMax,
    );

    const [categories, providers] = await Promise.all([
      this.listCategories(query.productType),
      this.listProviders(query.productType),
    ]);

    const where = await this.buildWhere(query);
    const [rows, total] = await Promise.all([
      this.prisma.casinoGame.findMany({
        where,
        orderBy: [{ isFeatured: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.casinoGame.count({ where }),
    ]);

    const providerNames = await this.providerNamesById();
    const games: CatalogPage<CatalogGame> = {
      items: rows.map((row) => this.toCatalogGame(row, providerNames)),
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };

    await this.logCatalogDiagnostics(query, where, page, pageSize, total, rows.length);

    const lastSync = await this.lastSyncRow(resolved.row?.id ?? null);
    const available = total > 0;

    return {
      productType: query.productType,
      available,
      configured: resolved.configured,
      environment: config.environment,
      provider: resolved.row?.name ?? null,
      message: available
        ? null
        : (resolved.unavailableReason ??
          (resolved.configured
            ? 'The partner supplies no games for this product yet.'
            : null)),
      games,
      categories,
      providers,
      syncedAt: lastSync?.lastSyncAt?.toISOString() ?? null,
    };
  }

  /**
   * Single game by its stable TANVION catalog id (`providerRowId:externalId`).
   *
   * PUBLIC visibility is enforced here too: an INACTIVE game or a game of an
   * INACTIVE provider is never returned publicly (the admin path passes
   * `includeInactive = true`).
   */
  async getGameById(id: string, includeInactive = false): Promise<CatalogGame | null> {
    const separator = id.indexOf(':');
    if (separator <= 0) return null;
    const providerId = id.slice(0, separator);
    const externalId = id.slice(separator + 1);
    if (!providerId || !externalId) return null;

    const row = await this.prisma.casinoGame.findUnique({
      where: { providerId_externalId: { providerId, externalId } },
      include: { provider: { select: { status: true } } },
    });
    if (!row) return null;
    if (!includeInactive) {
      if (row.status !== 'ACTIVE') return null;
      const providerStatus =
        (row as { provider?: { status?: string } }).provider?.status ?? 'ACTIVE';
      if (providerStatus !== 'ACTIVE') return null;
    }
    return this.toCatalogGame(row, await this.providerNamesById());
  }

  /**
   * STUDIO FACETS — the one implementation behind both the public provider
   * endpoint and {@link listStudios}.
   *
   * A "studio" is what a player actually picks: the game supplier the PARTNER
   * reports for a title (JILI, TATAP, PG SOFT, ...). Sync stores it on every
   * `CasinoGame` as `raw.providerExternalId` (stable id) + `raw.providerName`
   * (display name), and `buildWhere` matches `?provider=` against exactly those
   * two values — so the chips the UI renders and the filter it sends can never
   * disagree.
   *
   * Grouping by `PartnerProvider` instead would list the OPERATOR wiring (one
   * entry per integrated feed — a single "BIGBANG" row) rather than the studios
   * inside it, which is precisely why "pick JILI / TATAP / PG SOFT" was
   * impossible even though the games were there.
   *
   * A game whose payload carried no studio at all stays reachable under its own
   * `PartnerProvider` row (the id `buildWhere` already matches on `providerId`),
   * so nothing silently disappears from the catalog.
   */
  private async studioFacets(productType: CasinoProduct): Promise<CatalogProviderSummary[]> {
    const rows = await this.prisma.casinoGame.findMany({
      where: { productType, status: 'ACTIVE', provider: { status: 'ACTIVE' } },
      select: { providerId: true, raw: true },
    });
    if (rows.length === 0) return [];

    const providerNames = await this.providerNamesById();
    const facets = new Map<string, { id: string; name: string; gameCount: number }>();

    for (const row of rows) {
      const raw =
        row.raw && typeof row.raw === 'object' && !Array.isArray(row.raw)
          ? (row.raw as Record<string, unknown>)
          : {};
      const studioName = studioNameFromRaw(raw) ?? '';
      const rawExternalId = raw.providerExternalId;
      const studioId =
        typeof rawExternalId === 'string' && rawExternalId.trim()
          ? rawExternalId.trim()
          : '';
      const key = studioId || studioName || row.providerId;
      const existing = facets.get(key);
      if (existing) {
        existing.gameCount += 1;
        continue;
      }
      facets.set(key, {
        id: key,
        name: studioName || providerNames.get(row.providerId) || row.providerId,
        gameCount: 1,
      });
    }

    return [...facets.values()]
      .sort((a, b) => b.gameCount - a.gameCount || a.name.localeCompare(b.name))
      .map((facet) => ({
        id: facet.id,
        name: facet.name,
        gameCount: facet.gameCount,
        productType,
      }));
  }

  /**
   * The PUBLIC provider filter: one entry per studio that actually holds ACTIVE
   * games of this product.
   *
   * Derived entirely from the database, so:
   *   - a studio the partner syncs appears automatically;
   *   - a studio whose games all became INACTIVE (or whose `PartnerProvider` row
   *     is INACTIVE) disappears;
   *   - no studio name or id is ever hard-coded.
   */
  async listProviders(productType: CasinoProduct): Promise<CatalogProviderSummary[]> {
    return this.studioFacets(productType);
  }

  /**
   * Legacy alias of {@link listProviders} (same studio dimension). Kept so the
   * existing studio contract and its tests keep resolving.
   */
  async listStudios(productType: CasinoProduct): Promise<CatalogProviderSummary[]> {
    return this.studioFacets(productType);
  }

  async listCategories(productType: CasinoProduct): Promise<CatalogCategorySummary[]> {
    const rows = await this.prisma.casinoCategory.findMany({
      where: { productType, status: 'ACTIVE' },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.externalId,
      name: row.name,
      slug: row.slug,
      gameCount: row.gameCount,
      productType,
    }));
  }

  /** The player's recently played partner games (from real launch sessions). */
  async listRecentGames(
    userId: string,
    productType: CasinoProduct,
    limit = 12,
  ): Promise<CatalogGame[]> {
    const sessions = await this.prisma.casinoSession.findMany({
      where: {
        userId,
        provider: { productTypes: { hasSome: [productType] } },
        game: { productType, status: 'ACTIVE' },
      },
      orderBy: { launchedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 24) * 3,
      select: { casinoGameId: true },
    });
    const ids: string[] = [];
    for (const session of sessions) {
      if (!ids.includes(session.casinoGameId)) ids.push(session.casinoGameId);
      if (ids.length >= limit) break;
    }
    if (ids.length === 0) return [];

    const providerNames = await this.providerNamesById();
    const rows = await this.prisma.casinoGame.findMany({ where: { id: { in: ids } } });
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids
      .map((id) => byId.get(id))
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .map((row) => this.toCatalogGame(row, providerNames));
  }

  // --------------------------------------------------------------------------
  // Sync (partner API → normalized catalog)
  // --------------------------------------------------------------------------

  /**
   * Pulls EVERY eligible provider catalog and upserts it.
   *
   * Multi-provider contract (this is the fix for "only the first provider's
   * games ever synced"):
   *   - EVERY ACTIVE, casino-capable, environment-matched PartnerProvider row is
   *     discovered and synced — the run never stops after the first provider;
   *   - a provider that fails is reported (and recorded on its own row) while
   *     the other providers' successful work is kept;
   *   - each provider's games are upserted under ITS OWN providerId, so a game
   *     name shared by two providers stays two rows and no provider can
   *     overwrite/delete another provider's inventory.
   *
   * Only REAL provider rows are written. Games that disappeared from a
   * provider's inventory are marked INACTIVE (never deleted) so wallet
   * transactions/sessions keep their foreign keys and favourites keep working.
   */
  async sync(): Promise<CasinoSyncSummary> {
    const config = this.providers.config();
    const discovered = await this.providers.listResolvableProviders();

    const summary: CasinoSyncSummary = {
      provider: discovered.length === 1 ? (discovered[0]?.row?.name ?? null) : null,
      environment: config.environment,
      providersDiscovered: discovered.length,
      providersSynced: 0,
      providersFailed: 0,
      categories: 0,
      providers: 0,
      fetched: 0,
      created: 0,
      updated: 0,
      games: 0,
      casinoGames: 0,
      liveCasinoGames: 0,
      featured: 0,
      deactivated: 0,
      providerResults: [],
      errors: [],
    };

    if (discovered.length === 0) {
      const resolved = await this.providers.resolve();
      summary.errors.push(
        resolved.unavailableReason ?? 'No partner casino provider is configured.',
      );
      this.logger.warn(
        `casino.sync.skipped providers=0 env=${config.environment} reason=${summary.errors[0]}`,
      );
      return summary;
    }

    this.logger.log(
      `casino.sync.start providers=${discovered.length} env=${config.environment}`,
    );

    for (const resolved of discovered) {
      const result = await this.syncProvider(resolved);
      summary.providerResults.push({
        providerId: result.providerId,
        provider: result.provider,
        status: result.status,
        fetched: result.fetched,
        created: result.created,
        updated: result.updated,
        deactivated: result.deactivated,
        categories: result.categories,
        truncated: result.truncated,
        error: result.error,
      });

      if (result.status === 'SYNCED') {
        summary.providersSynced += 1;
      } else {
        summary.providersFailed += 1;
        if (result.error) summary.errors.push(result.error);
      }

      summary.categories += result.categories;
      summary.fetched += result.fetched;
      summary.games += result.fetched;
      summary.created += result.created;
      summary.updated += result.updated;
      summary.deactivated += result.deactivated;
      summary.casinoGames += result.casinoGames;
      summary.liveCasinoGames += result.liveCasinoGames;
      summary.featured += result.featured;
      summary.providers += result.studios;
    }

    if (summary.provider === null) {
      // More than one provider contributed — report a count, never a single
      // provider's name as if it were the whole catalog.
      summary.provider = `${discovered.length} providers`;
    }

    this.logger.log(
      `casino.sync.end providers discovered=${summary.providersDiscovered} synced=${summary.providersSynced} failed=${summary.providersFailed} fetched=${summary.fetched} created=${summary.created} updated=${summary.updated} deactivated=${summary.deactivated}`,
    );

    return summary;
  }

  /**
   * Syncs ONE provider row in isolation: a failure (network, credentials,
   * malformed payload) is recorded for THAT provider only and never aborts the
   * remaining providers of the same run.
   */
  private async syncProvider(resolved: CasinoResolvedProvider): Promise<
    CasinoProviderSyncResult & {
      casinoGames: number;
      liveCasinoGames: number;
      featured: number;
      studios: number;
    }
  > {
    const config = resolved.config;
    const providerId = resolved.row?.id ?? '';
    const providerName = resolved.row?.name ?? 'unknown';
    const result = {
      providerId,
      provider: providerName,
      status: 'SYNCED' as CasinoProviderSyncResult['status'],
      fetched: 0,
      created: 0,
      updated: 0,
      deactivated: 0,
      categories: 0,
      truncated: false,
      error: null as string | null,
      casinoGames: 0,
      liveCasinoGames: 0,
      featured: 0,
      studios: 0,
    };

    if (!resolved.configured || !resolved.row) {
      result.status = 'FAILED';
      result.error =
        resolved.unavailableReason ??
        `Provider "${providerName}" is not usable for ${config.environment}.`;
      this.logger.warn(
        `casino.sync.provider_skipped provider=${providerName} reason=${result.error}`,
      );
      return result;
    }

    await this.prisma.partnerProvider.update({
      where: { id: providerId },
      data: { syncStatus: 'SYNCING', lastSyncError: null },
    });

    try {
      const categoryMap = await this.syncCategories(resolved, providerId);
      result.categories = categoryMap.size;
      result.studios = (await resolved.provider.listProviders()).length;

      const seenExternalIds = new Set<string>();
      let page = 1;
      let hasMore = true;
      let reportedTotal = 0;
      while (hasMore && page <= config.maxSyncPages) {
        const remote = await resolved.provider.listGames({
          page,
          // Reaching the provider's WHOLE catalog is the goal, so the dedicated
          // sync page size is used instead of the public browser page cap.
          pageSize: config.syncPageSize,
        });
        if (Number.isFinite(remote.total) && remote.total > reportedTotal) {
          reportedTotal = remote.total;
        }
        for (const game of remote.items) {
          const outcome = await this.upsertGame(providerId, categoryMap, game);
          if (outcome === 'created') result.created += 1;
          else result.updated += 1;
          seenExternalIds.add(game.externalId);
          result.fetched += 1;
          if (game.productType === 'LIVE_CASINO') result.liveCasinoGames += 1;
          else result.casinoGames += 1;
          if (game.isFeatured) result.featured += 1;
        }
        hasMore = remote.hasMore && remote.items.length > 0;
        page += 1;
      }

      // Honest reporting: when the walk stopped before the provider's own
      // reported total, say so instead of pretending the catalog is complete.
      if (reportedTotal > 0 && seenExternalIds.size < reportedTotal) {
        result.truncated = true;
        this.logger.warn(
          `casino.sync.truncated provider=${providerName} fetched=${seenExternalIds.size} reportedTotal=${reportedTotal} maxPages=${config.maxSyncPages}`,
        );
      }

      result.deactivated = await this.deactivateMissing(providerId, seenExternalIds);

      await this.prisma.partnerProvider.update({
        where: { id: providerId },
        data: {
          syncStatus: 'OK',
          lastSyncAt: new Date(),
          lastSyncError: null,
          productTypes: ['CASINO', 'LIVE_CASINO'],
          environment: config.environment,
        },
      });

      this.logger.log(
        `casino.sync.provider_end provider=${providerName} fetched=${result.fetched} created=${result.created} updated=${result.updated} categories=${result.categories} deactivated=${result.deactivated}`,
      );
      return result;
    } catch (error) {
      const message = this.safeErrorMessage(error);
      result.status = 'FAILED';
      result.error = `${providerName}: ${message}`;
      await this.prisma.partnerProvider.update({
        where: { id: providerId },
        data: { syncStatus: 'ERROR', lastSyncAt: new Date(), lastSyncError: message },
      });
      this.logger.error(
        `casino.sync.provider_error provider=${providerName} env=${config.environment} error=${message}`,
      );
      return result;
    }
  }

  // --------------------------------------------------------------------------
  // Private — sync helpers
  // --------------------------------------------------------------------------

  private async syncCategories(
    resolved: CasinoResolvedProvider,
    providerId: string,
  ): Promise<Map<string, { id: string; name: string; slug: string }>> {
    const map = new Map<string, { id: string; name: string; slug: string }>();
    for (const productType of ['CASINO', 'LIVE_CASINO'] as const) {
      const remote = await resolved.provider.listCategories(productType);
      for (const category of remote) {
        const row = await this.prisma.casinoCategory.upsert({
          where: {
            providerId_externalId: { providerId, externalId: category.externalId },
          },
          create: {
            providerId,
            externalId: category.externalId,
            name: category.name,
            slug: category.slug,
            productType,
            gameCount: category.gameCount,
            status: 'ACTIVE',
            lastSyncedAt: new Date(),
          },
          update: {
            name: category.name,
            slug: category.slug,
            productType,
            gameCount: category.gameCount,
            status: 'ACTIVE',
            lastSyncedAt: new Date(),
          },
        });
        map.set(`${productType}:${category.externalId}`, {
          id: row.id,
          name: row.name,
          slug: row.slug,
        });
      }
    }
    return map;
  }

  /**
   * Upserts ONE provider game under its OWN provider identity.
   *
   * The uniqueness key is `(providerId, externalId)` — NEVER the display name —
   * so two providers offering a game with the same title produce two separate,
   * valid rows and neither can overwrite the other. Returns whether the row was
   * created (for the per-provider sync report).
   */
  private async upsertGame(
    providerId: string,
    categoryMap: Map<string, { id: string; name: string; slug: string }>,
    game: CasinoRemoteGame,
  ): Promise<'created' | 'updated'> {
    const category =
      game.categoryExternalId !== null
        ? categoryMap.get(`${game.productType}:${game.categoryExternalId}`)
        : undefined;

    const existing = await this.prisma.casinoGame.findUnique({
      where: { providerId_externalId: { providerId, externalId: game.externalId } },
      select: { id: true },
    });

    const data = {
      name: game.name,
      slug: game.slug || `game-${game.externalId}`,
      thumbnail: game.thumbnail,
      banner: game.banner,
      categoryId: category?.id ?? null,
      categoryName: game.categoryName ?? category?.name ?? null,
      tags: game.tags,
      productType: game.productType,
      status: (game.active ? 'ACTIVE' : 'INACTIVE') as 'ACTIVE' | 'INACTIVE',
      isFeatured: game.isFeatured,
      launchAvailable: game.launchAvailable,
      demoAvailable: game.demoAvailable,
      raw: {
        providerName: game.providerName,
        providerExternalId: game.providerExternalId,
        categoryExternalId: game.categoryExternalId,
      } as Prisma.InputJsonValue,
      lastSyncedAt: new Date(),
    };

    await this.prisma.casinoGame.upsert({
      where: { providerId_externalId: { providerId, externalId: game.externalId } },
      create: { providerId, externalId: game.externalId, ...data },
      update: data,
    });

    return existing ? 'updated' : 'created';
  }

  /**
   * Marks games the provider no longer lists as INACTIVE. They are never
   * deleted: sessions/wallet mappings reference them and user favourites must
   * keep resolving after a catalog sync.
   */
  private async deactivateMissing(
    providerId: string,
    seenExternalIds: Set<string>,
  ): Promise<number> {
    if (seenExternalIds.size === 0) return 0;
    const result = await this.prisma.casinoGame.updateMany({
      where: {
        providerId,
        status: 'ACTIVE',
        externalId: { notIn: [...seenExternalIds] },
      },
      data: { status: 'INACTIVE', launchAvailable: false },
    });
    return result.count;
  }

  private safeErrorMessage(error: unknown): string {
    if (error instanceof CasinoProviderError) return `${error.code}: ${error.message}`;
    if (error instanceof Error) return error.message;
    return 'Unknown provider error';
  }


  // --------------------------------------------------------------------------
  // Private — read helpers
  // --------------------------------------------------------------------------

  private async buildWhere(query: CasinoCatalogQuery): Promise<Prisma.CasinoGameWhereInput> {
    const conditions: Prisma.CasinoGameWhereInput[] = [
      { productType: query.productType },
    ];
    if (!query.includeInactive) {
      conditions.push({ status: 'ACTIVE' });
      // PUBLIC VISIBILITY: only games belonging to an ACTIVE provider row are
      // exposed. Deactivating a provider in Admin hides its games immediately
      // (they stay in the database, so sessions/favourites keep resolving).
      conditions.push({ provider: { status: 'ACTIVE' } });
    }
    if (query.featured) conditions.push({ isFeatured: true });
    if (query.providerExternalId) {
      const value = query.providerExternalId.trim();
      // A provider/studio that does not exist must yield an empty page — never
      // an unfiltered fallback (that would leak another provider's games).
      conditions.push({
        OR: [
          // 1. The PartnerProvider row itself — what the public provider filter
          //    sends (`?provider=<partnerProvider.id>`).
          { providerId: value },
          { provider: { name: { equals: value, mode: 'insensitive' } } },
          // 2. Backwards compatibility: the studio id/name reported by the
          //    partner catalog (`?provider=studio-two`) keeps matching the same
          //    games, so existing links/bookmarks never break.
          { raw: { path: ['providerExternalId'], equals: value } },
          { raw: { path: ['providerName'], equals: value } },
        ],
      });
    }
    if (query.categorySlug) {
      const category = await this.prisma.casinoCategory.findFirst({
        where: { slug: query.categorySlug, productType: query.productType },
        select: { id: true, name: true },
      });
      conditions.push(
        category
          ? {
              OR: [
                { categoryId: category.id },
                { categoryName: { equals: category.name, mode: 'insensitive' } },
              ],
            }
          : { categoryId: '__no_such_category__' },
      );
    }
    const term = (query.search ?? '').trim();
    if (term) conditions.push({ name: { contains: term, mode: 'insensitive' } });
    return { AND: conditions };
  }

  private toCatalogGame(
    row: {
      providerId: string;
      externalId: string;
      name: string;
      slug: string;
      thumbnail: string | null;
      banner: string | null;
      categoryName: string | null;
      tags: string[];
      productType: string;
      status: string;
      isFeatured: boolean;
      launchAvailable: boolean;
      demoAvailable: boolean;
      raw: unknown;
    },
    providerNames: Map<string, string>,
  ): CatalogGame {
    return {
      // Stable across syncs, so a favourite/URL keeps resolving.
      id: `${row.providerId}:${row.externalId}`,
      provider:
        studioNameFromRaw(row.raw) ?? providerNames.get(row.providerId) ?? 'Partner',
      providerId: row.providerId,
      externalId: row.externalId,
      name: row.name,
      slug: row.slug,
      thumbnail: row.thumbnail,
      banner: row.banner,
      category: row.categoryName,
      categorySlug: row.categoryName ? this.slugify(row.categoryName) : null,
      tags: row.tags,
      productType: row.productType as ProductType,
      source: 'PARTNER',
      status: row.status as CatalogGame['status'],
      isFeatured: row.isFeatured,
      launchAvailable: row.launchAvailable,
      demoAvailable: row.demoAvailable,
    };
  }

  private async countGames(): Promise<{
    total: number;
    casino: number;
    liveCasino: number;
    featured: number;
    inactive: number;
    /** ACTIVE games that offer a demo launch (drives `demoSupported`). */
    demo: number;
  }> {
    const [total, casino, liveCasino, featured, inactive, demo] = await Promise.all([
      this.prisma.casinoGame.count(),
      this.prisma.casinoGame.count({ where: { productType: 'CASINO', status: 'ACTIVE' } }),
      this.prisma.casinoGame.count({
        where: { productType: 'LIVE_CASINO', status: 'ACTIVE' },
      }),
      this.prisma.casinoGame.count({ where: { isFeatured: true, status: 'ACTIVE' } }),
      this.prisma.casinoGame.count({ where: { status: 'INACTIVE' } }),
      this.prisma.casinoGame.count({ where: { demoAvailable: true, status: 'ACTIVE' } }),
    ]);
    return { total, casino, liveCasino, featured, inactive, demo };
  }

  private async lastSyncRow(providerId: string | null) {
    if (!providerId) return null;
    return this.prisma.partnerProvider.findUnique({
      where: { id: providerId },
      select: { lastSyncAt: true, lastSyncError: true },
    });
  }

  private async providerNamesById(): Promise<Map<string, string>> {
    const rows = await this.prisma.partnerProvider.findMany({
      select: { id: true, name: true },
    });
    return new Map(rows.map((row) => [row.id, row.name]));
  }

  /**
   * EVERY casino-capable provider row for the environment this process runs in,
   * with real game counts — so an admin sees ALL configured providers (not just
   * the primary one/studio feed) and whether their games are currently public.
   * Provider secrets/URLs are never part of this view.
   */
  private async providerRowSummaries(): Promise<CasinoProviderRowSummary[]> {
    const environment = this.providers.config().environment;
    const rows = await this.prisma.partnerProvider.findMany({
      where: { productTypes: { hasSome: ['CASINO', 'LIVE_CASINO'] } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        name: true,
        providerCode: true,
        status: true,
        environment: true,
        lastSyncAt: true,
        lastSyncError: true,
      },
    });

    const groups = await this.prisma.casinoGame.groupBy({
      by: ['providerId', 'status'],
      _count: { _all: true },
    });
    const total = new Map<string, number>();
    const active = new Map<string, number>();
    for (const group of groups) {
      total.set(group.providerId, (total.get(group.providerId) ?? 0) + group._count._all);
      if (group.status === 'ACTIVE') {
        active.set(group.providerId, (active.get(group.providerId) ?? 0) + group._count._all);
      }
    }

    return rows
      .filter((row) => (row.environment ?? 'sandbox').trim().toLowerCase() === environment)
      .map((row) => ({
        id: row.id,
        name: row.name,
        providerCode: row.providerCode ?? null,
        status: row.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
        environment:
          (row.environment ?? '').trim().toLowerCase() === 'production'
            ? ('production' as const)
            : (row.environment ?? '').trim().toLowerCase() === 'sandbox'
              ? ('sandbox' as const)
              : null,
        gameCount: total.get(row.id) ?? 0,
        activeGameCount: active.get(row.id) ?? 0,
        lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
        lastSyncError: row.lastSyncError ?? null,
      }));
  }

  /**
   * DEVELOPMENT-ONLY diagnostic: logs the exact provider/game counts behind one
   * catalog page (providers and their totals, the page window, the rows actually
   * returned). It returns immediately in production and never logs a credential.
   */
  private async logCatalogDiagnostics(
    query: CasinoCatalogQuery,
    where: Prisma.CasinoGameWhereInput,
    page: number,
    pageSize: number,
    total: number,
    returned: number,
  ): Promise<void> {
    if (process.env.NODE_ENV === 'production') return;
    try {
      const groups = await this.prisma.casinoGame.groupBy({
        by: ['providerId'],
        where,
        _count: { _all: true },
      });
      const names = await this.providerNamesById();
      this.logger.log(
        `casino.catalog.diagnostic product=${query.productType} provider=${
          query.providerExternalId ?? 'all'
        } category=${query.categorySlug ?? 'all'} search=${
          (query.search ?? '').trim() || 'none'
        } page=${page} pageSize=${pageSize} total=${total} returned=${returned} providers=${
          groups.length
        } [${groups
          .map((group) => `${names.get(group.providerId) ?? group.providerId}=${group._count._all}`)
          .join(', ')}]`,
      );
    } catch {
      // Diagnostics must never break a catalog read.
    }
  }

  private slugify(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
  }
}
