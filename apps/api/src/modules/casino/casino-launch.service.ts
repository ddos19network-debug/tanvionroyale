import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { CasinoLaunchMode, CasinoLaunchResponse } from '@tanvion-royale/types';
import { PrismaService } from '../../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { casinoPlayerId } from './casino-player-identity';
import { CasinoProviderError } from './casino-provider.interface';
import { CasinoProviderFactory } from './casino-provider.factory';

export interface CasinoLaunchRequest {
  /** Stable catalog id `${providerRowId}:${externalId}`. */
  gameId: string;
  mode: CasinoLaunchMode;
  currency?: string | undefined;
  locale?: string | undefined;
}

/** Hosts that must never be handed back to a browser as a launch target. */
const BLOCKED_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^\[?::1\]?$/,
  /^\[?f[cd][0-9a-f]{2}:/i,
  /\.local$/i,
  /\.internal$/i,
];

/**
 * Partner game launch.
 *
 * SECURITY CONTRACT
 *  - the browser sends ONLY a catalog game id + mode; every provider
 *    parameter (player id, currency, environment, session) is resolved here;
 *  - provider availability, product type, environment and credentials are
 *    re-validated on EVERY launch (never trusted from the client);
 *  - the launch URL is produced server-side and structurally validated before
 *    it is returned, so a client-supplied/open-redirect URL is impossible;
 *  - the TANVION↔provider player mapping is deterministic (see
 *    casino-player-identity) so no partner account is created per launch.
 */
@Injectable()
export class CasinoLaunchService {
  private readonly logger = new Logger(CasinoLaunchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: CasinoProviderFactory,
    private readonly wallet: WalletService,
  ) {}

  async launch(userId: string, request: CasinoLaunchRequest): Promise<CasinoLaunchResponse> {
    // The catalog id is `${providerRowId}:${externalId}`: the game's OWN
    // provider row decides which integration launches it, so a multi-provider
    // catalog can never launch one provider's game through another's adapter.
    const reference = this.parseCatalogId(request.gameId);
    const resolved = await this.providers.resolveById(reference.providerId);
    if (!resolved) {
      throw new NotFoundException('This game is no longer part of the catalog.');
    }

    if (!resolved.configured || !resolved.row) {
      throw new ServiceUnavailableException(
        resolved.unavailableReason ?? 'Partner casino is not configured.',
      );
    }

    const game = await this.loadLaunchedGame(reference.providerId, reference.externalId);
    if (game.status !== 'ACTIVE' || !game.launchAvailable) {
      throw new ForbiddenException('This game is currently unavailable.');
    }
    if (request.mode === 'DEMO' && !game.demoAvailable) {
      throw new BadRequestException('This game does not offer a demo mode.');
    }

    const row = await this.prisma.partnerProvider.findUnique({
      where: { id: resolved.row.id },
      select: { id: true, status: true, productTypes: true },
    });
    if (!row || row.status !== 'ACTIVE') {
      throw new ServiceUnavailableException('The casino provider is disabled.');
    }
    if (!row.productTypes.includes(game.productType)) {
      throw new ForbiddenException(
        'The casino provider does not serve this product in this environment.',
      );
    }

    const currency = await this.resolveCurrency(userId, request.currency);
    const playerId = casinoPlayerId(userId);

    let result;
    try {
      result =
        request.mode === 'DEMO'
          ? await resolved.provider.launchDemo({
              externalGameId: game.externalId,
              currency,
              locale: request.locale,
              mode: 'DEMO',
            })
          : await resolved.provider.launch({
              playerId,
              externalGameId: game.externalId,
              currency,
              mode: 'REAL',
              locale: request.locale,
            });
    } catch (error) {
      throw this.toHttpError(error);
    }

    const url = this.assertLaunchDestination(
      result.url,
      resolved.config.launchHostAllowlist,
    );

    const sessionId =
      request.mode === 'DEMO'
        ? null
        : await this.recordSession({
            userId,
            providerId: row.id,
            casinoGameId: game.id,
            externalGameId: game.externalId,
            providerPlayerId: playerId,
            providerSessionId: result.providerSessionId,
            providerRoundId: result.providerRoundId,
            currency,
          });

    this.logger.log(
      `casino.launch provider=${resolved.row.name} env=${resolved.config.environment} game=${game.externalId} product=${game.productType} mode=${request.mode} user=${userId} session=${sessionId ?? 'demo'}`,
    );

    return {
      url,
      provider: resolved.row.name,
      gameId: `${row.id}:${game.externalId}`,
      externalGameId: game.externalId,
      mode: request.mode,
      environment: resolved.config.environment,
      sessionId,
    };
  }

  /** Closes the provider-side session and marks the TANVION mapping CLOSED. */
  async closeSession(userId: string, sessionId: string): Promise<{ closed: boolean }> {
    const session = await this.prisma.casinoSession.findUnique({
      where: { id: sessionId },
    });
    if (!session || session.userId !== userId) {
      throw new NotFoundException('Casino session not found');
    }
    if (session.status === 'CLOSED') return { closed: true };

    if (session.providerSessionId) {
      // The session's OWN provider row closes it (multi-provider safe).
      const resolved = await this.providers.resolveById(session.providerId);
      if (resolved?.configured) {
        try {
          await resolved.provider.closeSession(session.providerSessionId);
        } catch (error) {
          // A provider-side close failure must not lose the TANVION mapping:
          // the session is still closed locally and the failure is logged.
          this.logger.warn(
            `casino.session.close_failed session=${session.id} provider=${
              resolved.row?.name ?? 'none'
            } reason=${error instanceof Error ? error.message : 'error'}`,
          );
        }
      }
    }

    await this.prisma.casinoSession.updateMany({
      where: { id: session.id, status: 'ACTIVE' },
      data: { status: 'CLOSED', closedAt: new Date() },
    });
    return { closed: true };
  }


  // --------------------------------------------------------------------------
  // Private helpers (all security-relevant validation lives here)
  // --------------------------------------------------------------------------

  /** Splits a stable catalog id (`providerRowId:externalId`) safely. */
  private parseCatalogId(gameId: string): { providerId: string; externalId: string } {
    const separator = gameId.indexOf(':');
    if (separator <= 0) {
      throw new BadRequestException('Invalid game reference.');
    }
    const providerId = gameId.slice(0, separator);
    const externalId = gameId.slice(separator + 1);
    if (!providerId || !externalId) {
      throw new BadRequestException('Invalid game reference.');
    }
    return { providerId, externalId };
  }

  private async loadLaunchedGame(providerId: string, externalId: string) {
    const game = await this.prisma.casinoGame.findUnique({
      where: { providerId_externalId: { providerId, externalId } },
      select: {
        id: true,
        externalId: true,
        status: true,
        productType: true,
        launchAvailable: true,
        demoAvailable: true,
        name: true,
      },
    });
    if (!game) throw new NotFoundException('Game not found');
    return game;
  }

  /** The TANVION wallet currency is authoritative — never a client value. */
  private async resolveCurrency(userId: string, requested?: string): Promise<string> {
    const supported = this.providers.config().supportedCurrencies;
    const candidate = (requested ?? '').trim().toUpperCase();
    const currency = candidate && supported.includes(candidate) ? candidate : supported[0];
    const wallet = await this.wallet.getOrCreateWalletForUser(userId, currency);
    if (!supported.includes(wallet.currency)) {
      throw new BadRequestException('Unsupported wallet currency.');
    }
    return wallet.currency;
  }

  private async recordSession(input: {
    userId: string;
    providerId: string;
    casinoGameId: string;
    externalGameId: string;
    providerPlayerId: string;
    providerSessionId: string | null;
    providerRoundId: string | null;
    currency: string;
  }): Promise<string> {
    const resolved = this.providers.config();
    const created = await this.prisma.$transaction(async (db) => {
      // Only one ACTIVE session per user+game so a re-launch cannot leak
      // dangling ACTIVE sessions.
      await db.casinoSession.updateMany({
        where: { userId: input.userId, casinoGameId: input.casinoGameId, status: 'ACTIVE' },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
      return db.casinoSession.create({
        data: {
          userId: input.userId,
          providerId: input.providerId,
          casinoGameId: input.casinoGameId,
          externalGameId: input.externalGameId,
          providerPlayerId: input.providerPlayerId,
          providerSessionId: input.providerSessionId,
          providerRoundId: input.providerRoundId,
          currency: input.currency,
          environment: resolved.environment,
          demo: false,
          status: 'ACTIVE',
        },
      });
    });
    return created.id;
  }

  /**
   * The launch URL is produced by the provider server-side. It is still
   * validated: https only, no embedded credentials, no loopback/private host,
   * and — when an allowlist is configured — the host must be on it. This makes
   * an open redirect impossible even if a provider is compromised.
   */
  private assertLaunchDestination(rawUrl: string, allowlist: string[]): string {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      throw new ServiceUnavailableException('The provider returned an invalid game URL.');
    }
    if (parsed.protocol !== 'https:') {
      throw new ServiceUnavailableException('The provider returned an insecure game URL.');
    }
    if (parsed.username || parsed.password) {
      throw new ServiceUnavailableException('The provider returned an unsafe game URL.');
    }
    const host = parsed.hostname.toLowerCase();
    if (BLOCKED_HOST_PATTERNS.some((pattern) => pattern.test(host))) {
      throw new ServiceUnavailableException('The provider returned an unsafe game URL.');
    }
    if (allowlist.length > 0 && !allowlist.includes(host)) {
      throw new ServiceUnavailableException('The provider game host is not allowlisted.');
    }
    return parsed.toString();
  }

  private toHttpError(error: unknown): Error {
    if (error instanceof CasinoProviderError) {
      if (error.code === 'NOT_CONFIGURED') {
        return new ServiceUnavailableException(
          'Partner casino is not configured for this environment.',
        );
      }
      return new ServiceUnavailableException(
        'The game could not be launched right now. Please try again.',
      );
    }
    return error instanceof Error
      ? error
      : new ServiceUnavailableException('The game could not be launched right now.');
  }
}

