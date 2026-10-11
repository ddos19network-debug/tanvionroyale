import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { WinHouseLaunchResponse } from '@tanvion-royale/types';
import { PrismaService } from '../../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { loadWalletConfig } from '../wallet/wallet.config';
import { winhousePlayerId } from './winhouse-player-identity';
import { WinHouseProviderFactory } from './winhouse-provider.factory';
import { mintLaunchToken } from './winhouse-signature';

/**
 * Model B SSO hand-off for the embedded sportsbook (BIG SPORT).
 *
 * Being signed in on TANVION does not sign the player into the provider's book
 * (separate origins, separate databases). The hand-off is a SHORT-LIVED launch
 * token this server mints and the provider redeems:
 *
 *   launch    = <player_id>.<expiry>.<session>.<signature>
 *   signature = HMAC_SHA256("<player_id>|<expiry>|<session>", wallet_api_key).hex()
 *
 * Security properties:
 *  - the token is minted SERVER-SIDE per page load and expires within the
 *    provider's documented 10-minute maximum (5 minutes by default);
 *  - the browser receives ONLY the signed token plus the PUBLIC embed key and
 *    book origin — never the wallet API key, never the callback token;
 *  - the provider player id is the stable, non-identifying id derived from the
 *    TANVION user id, so the same user always maps to the same provider player
 *    and no account is recreated per page load;
 *  - nothing about the player's money is sent: the provider reads the balance
 *    through the wallet endpoints, which always answer from the ONE TANVION
 *    wallet.
 */
@Injectable()
export class WinHouseLaunchService {
  private readonly logger = new Logger(WinHouseLaunchService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: WinHouseProviderFactory,
    private readonly wallet: WalletService,
  ) {}

  async launch(input: {
    userId: string;
    /** TANVION session id — the provider session of this login. */
    platformSessionId: string | null;
  }): Promise<WinHouseLaunchResponse> {
    // JwtAuthGuard proves the session; this service-level check keeps the
    // customer wallet boundary authoritative even for a valid STAFF session.
    const account = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { accountType: true, status: true },
    });
    if (!account || account.accountType !== 'CUSTOMER' || account.status !== 'ACTIVE') {
      throw new ForbiddenException('Only active customer accounts can launch the sportsbook.');
    }

    const resolved = await this.providers.resolve();
    if (!resolved.configured || !resolved.row || !resolved.walletApiKey) {
      throw new ServiceUnavailableException(this.providers.unavailableMessage(resolved));
    }
    const config = resolved.config;

    // The book plays in the ONE wallet's currency: the same default currency
    // every other TANVION product uses (BDT unless configured otherwise).
    const currency = loadWalletConfig().currency;
    const wallet = await this.wallet.getOrCreateWalletForUser(input.userId, currency);
    if (wallet.status !== 'ACTIVE') {
      throw new ForbiddenException('The customer wallet is not available for sportsbook play.');
    }

    const playerId = winhousePlayerId(input.userId);
    const session = input.platformSessionId ?? '';

    const { token, expiryMs } = mintLaunchToken({
      playerId,
      walletApiKey: resolved.walletApiKey,
      session,
      ttlMs: config.launchTtlMs,
      maxTtlMs: config.maxLaunchTtlMs,
    });

    await this.recordLaunch({
      providerId: resolved.row.id,
      userId: input.userId,
      providerPlayerId: playerId,
      platformSessionId: session || null,
      currency: wallet.currency,
      environment: config.environment,
      expiryMs,
    });

    this.logger.log(
      `winhouse.launch provider=${resolved.row.name} env=${config.environment} user=${
        input.userId
      } player=${playerId} ttlMs=${expiryMs - Date.now()}`,
    );

    return {
      provider: resolved.row.name,
      integration: 'SPORTS_IFRAME',
      product: 'SPORT',
      environment: config.environment,
      embedKey: resolved.embedKey as string,
      embedBaseUrl: resolved.embedBaseUrl as string,
      launch: token,
      expiresAt: new Date(expiryMs).toISOString(),
      playerId,
      language: config.language,
      theme: config.theme,
      frameHeight: config.frameHeight,
      bottomGapPx: config.bottomGapPx,
    };
  }

  /**
   * Records the launch.
   *
   * One ACTIVE session per user+provider: a new page load closes the previous
   * one (the provider player id never changes, so this is an audit trail rather
   * than an identity change) and the newest row is what the wallet callbacks
   * resolve `username` against.
   */
  private async recordLaunch(input: {
    providerId: string;
    userId: string;
    providerPlayerId: string;
    platformSessionId: string | null;
    currency: string;
    environment: string;
    expiryMs: number;
  }): Promise<void> {
    await this.prisma.$transaction(async (db) => {
      await db.winHouseSession.updateMany({
        where: { userId: input.userId, providerId: input.providerId, status: 'ACTIVE' },
        data: { status: 'CLOSED', closedAt: new Date() },
      });
      await db.winHouseSession.create({
        data: {
          providerId: input.providerId,
          userId: input.userId,
          providerPlayerId: input.providerPlayerId,
          platformSessionId: input.platformSessionId,
          currency: input.currency,
          environment: input.environment,
          status: 'ACTIVE',
          launchExpiresAt: new Date(input.expiryMs),
        },
      });
    });
  }
}
