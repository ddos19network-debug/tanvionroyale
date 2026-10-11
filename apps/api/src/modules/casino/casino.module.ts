import { Module } from '@nestjs/common';
import { WalletModule } from '../wallet/wallet.module';
import { BigBangCallbacksController } from '../bigbang/bigbang-callbacks.controller';
import { BigBangWalletService } from '../bigbang/bigbang-wallet.service';
import { BigBangWebhookController } from '../bigbang/bigbang-webhook.controller';
import { BigBangWebhookService } from '../bigbang/bigbang-webhook.service';
import { BigBangWebhookConfigService } from '../bigbang/bigbang-webhook-config.service';
import { BigBangWebhookAdminController } from '../bigbang/bigbang-webhook-admin.controller';
import { WebhookIdempotencyService } from '../webhooks/webhook-idempotency.service';
import { CasinoCatalogService } from './casino-catalog.service';
import { CasinoProviderFactory } from './casino-provider.factory';
import { CasinoLaunchService } from './casino-launch.service';
import { CasinoWalletService } from './casino-wallet.service';
import { CasinoController } from './casino.controller';
import { CasinoCallbacksController } from './casino-callbacks.controller';
import { CasinoAdminController } from './casino-admin.controller';

/**
 * Partner casino module — BIG CASINO (CASINO) and BIG LIVE CASINO
 * (LIVE_CASINO).
 *
 * Boundaries this module deliberately keeps:
 *  - the partner API is only ever called from here (server-side adapter);
 *  - the catalog the frontend sees comes from the normalized DB cache, so a
 *    provider outage degrades instead of breaking the platform;
 *  - money movements reuse the ONE wallet (`WalletModule`) — no partner,
 *    casino or live-casino balance exists anywhere;
 *  - provider callbacks are signature-verified provider → TANVION routes.
 *
 * The BIGBANG CASINO_AGGREGATOR adapter lives in `modules/bigbang`; its
 * seamless-wallet callbacks (user_data / balance_change) are registered here so
 * the whole partner-casino integration is wired through ONE module and the ONE
 * wallet. Its factory and credentials resolver are `CasinoProviderFactory`.
 */
@Module({
  imports: [WalletModule],
  controllers: [
    CasinoController,
    CasinoCallbacksController,
    CasinoAdminController,
    BigBangCallbacksController,
    // BigBang's server-to-server webhook (notifications only - it never moves
    // money). Separate from the two seamless-wallet callbacks above, which are
    // unchanged and remain the only money-moving path.
    BigBangWebhookController,
    // BigBang portal configuration (URLs + one-time webhook secret) for the
    // Admin panel. Same admin surface and RBAC as /admin/partner-providers.
    BigBangWebhookAdminController,
  ],
  providers: [
    CasinoProviderFactory,
    CasinoCatalogService,
    CasinoLaunchService,
    CasinoWalletService,
    BigBangWalletService,
    BigBangWebhookService,
    BigBangWebhookConfigService,
    // Shared, provider-agnostic idempotency/audit engine. A new provider
    // reuses this service rather than writing its own claim/duplicate logic.
    WebhookIdempotencyService,
  ],
  exports: [CasinoCatalogService, CasinoProviderFactory, CasinoWalletService, BigBangWalletService],
})
export class CasinoModule {}
