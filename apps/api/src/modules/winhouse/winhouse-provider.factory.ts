import { Injectable, Logger } from '@nestjs/common';
import type { WinHouseEnvironment } from '@tanvion-royale/types';
import { PrismaService } from '../../database/prisma.service';
import { decryptSecret } from '../../common/utils/encryption';
import {
  isValidEmbedKey,
  loadWinHouseEnvConfig,
  normalizeHttpsOrigin,
  WINHOUSE_DEFAULT_EMBED_BASE_URL,
  WINHOUSE_TANVION_PRODUCTION_ORIGIN,
  WINHOUSE_TANVION_WALLET_BASE_URL,
  type WinHouseEnvConfig,
} from './winhouse.config';
import { readEmbeddedProviderPublicConfig } from '../sportsbook/partner-provider-config';
import {
  verifyBalanceChangeSignature,
  verifyCallbackToken,
} from './winhouse-signature';

/** Where the active credential values came from (never their values). */
export type WinHouseCredentialSource = 'environment' | 'database' | 'none';

/** The provider row as exposed to admin (never an encrypted column). */
export interface WinHouseProviderRowView {
  id: string;
  name: string;
  status: 'ACTIVE' | 'INACTIVE';
  environment: WinHouseEnvironment | null;
  /** Exact origin registered in the provider portal (public configuration). */
  domain: string | null;
  /** Exact wallet base URL registered in the provider portal (public). */
  walletBaseUrl: string | null;
  /** Optional exact public outbound IP registered in the provider portal. */
  serverIp: string | null;
  /** PUBLIC embed key — shown because it is public by provider design. */
  embedKey: string | null;
  embedBaseUrl: string | null;
}

/** Everything the launch/wallet paths need, with the secrets resolved. */
export interface WinHouseResolvedProvider {
  config: WinHouseEnvConfig;
  row: WinHouseProviderRowView | null;
  configured: boolean;
  credentialsSource: WinHouseCredentialSource;
  unavailableReason: string | null;
  /** PUBLIC — safe for the browser (loader `data-key`). */
  embedKey: string | null;
  /** PUBLIC — the book origin the loader/iframe is served from. */
  embedBaseUrl: string | null;
  /** PUBLIC — exact portal Domain origin. */
  domain: string | null;
  /** PUBLIC — exact Seamless wallet base URL. */
  walletBaseUrl: string | null;
  /** PUBLIC — optional exact public outbound IP. */
  serverIp: string | null;
  /** SECRET — the HMAC signing key. Server-side only. */
  walletApiKey: string | null;
  /** SECRET — the inbound callback token. Server-side only. */
  callbackToken: string | null;
}

/** Secret-free verdict for an inbound provider (wallet callback) request. */
export type WinHouseInboundVerdict =
  | { ok: true; reason: null; providerId: string }
  | { ok: false; reason: string; providerId: string | null };


const NOT_CONFIGURED_MESSAGE =
  'No embedded sportsbook (WinHouse) provider is configured for this environment.';

/**
 * Resolves the ONE embedded-sportsbook provider for the environment this API
 * process is configured for, and authenticates its inbound wallet callbacks.
 *
 * SECURITY
 *  - sandbox and production rows are never mixed: a row whose `environment`
 *    disagrees with WINHOUSE_ENV is refused, not silently used;
 *  - the wallet API key and the callback token come from the environment
 *    (preferred for deployed secrets) or from the AES-256-GCM encrypted
 *    PartnerProvider row — they are never logged, never returned in a
 *    response and never sent to the browser;
 *  - the embed key is PUBLIC by provider design and is the only
 *    credential-looking value the browser may receive; it is still validated
 *    as `ifr_` + 40 hex;
 *  - a disabled/absent/unusable row resolves to `configured = false` with a
 *    safe reason — the UI then shows an honest unavailable state, never a fake
 *    book and never invented matches/odds.
 */
@Injectable()
export class WinHouseProviderFactory {
  private readonly logger = new Logger(WinHouseProviderFactory.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Loads the environment configuration (pure, no DB access). */
  config(): WinHouseEnvConfig {
    return loadWinHouseEnvConfig();
  }

  async resolve(): Promise<WinHouseResolvedProvider> {
    const config = this.config();
    if (process.env.NODE_ENV === 'production' && !config.environmentExplicit) {
      return this.unavailable(
        config,
        null,
        'WINHOUSE_ENV must be explicitly set to sandbox or production in production; no provider row was selected.',
        'none',
      );
    }
    const row = await this.findProviderRow(config);

    if (!row) {
      return this.unavailable(
        config,
        null,
        config.providerRowName
          ? `No PartnerProvider named "${config.providerRowName}" is registered for the embedded sportsbook.`
          : 'No embedded-sportsbook PartnerProvider row is registered. Configure one in Admin → Partner providers (Integration: WinHouse Iframe).',
        'none',
      );
    }

    const rowView = this.toRowView(row);
    const rowEnvironment = (row.environment ?? 'sandbox').trim().toLowerCase();

    if (rowEnvironment !== config.environment) {
      return this.unavailable(
        config,
        rowView,
        `Provider "${row.name}" is registered for ${rowEnvironment}, but this deployment runs WINHOUSE_ENV=${config.environment}. Sandbox and production are never mixed.`,
        'none',
      );
    }

    if (row.status !== 'ACTIVE') {
      return this.unavailable(config, rowView, `Provider "${row.name}" is disabled.`, 'none');
    }

    // Environment wins over the encrypted DB value, exactly like the casino
    // module: a rotated secret can be deployed without touching the database.
    const dbWalletApiKey = row.walletApiKeyEnc ? decryptSecret(row.walletApiKeyEnc).trim() : '';
    const dbCallbackToken = row.callbackTokenEnc ? decryptSecret(row.callbackTokenEnc).trim() : '';
    const walletApiKey = config.walletApiKey ?? (dbWalletApiKey || null);
    const callbackToken = config.callbackToken ?? (dbCallbackToken || null);
    const credentialsSource: WinHouseCredentialSource =
      config.walletApiKey && config.callbackToken
        ? 'environment'
        : walletApiKey && callbackToken
          ? 'database'
          : 'none';

    const publicConfig = readEmbeddedProviderPublicConfig(row.config);
    const embedKey = config.embedKey ?? row.embedKey ?? null;
    const embedBaseUrl =
      config.embedBaseUrl ??
      normalizeHttpsOrigin(row.embedBaseUrl) ??
      normalizeHttpsOrigin(row.baseUrl) ??
      WINHOUSE_DEFAULT_EMBED_BASE_URL;

    // These public portal values are mandatory for a complete, safely launchable
    // provider. A legacy runtime row without them remains unavailable.
    if (!publicConfig.domain || !publicConfig.walletBaseUrl) {
      return this.unavailable(
        config,
        rowView,
        `Provider "${row.name}" is missing its exact Domain or Seamless wallet base URL configuration.`,
        credentialsSource,
      );
    }

    if (
      config.environment === 'production' &&
      (publicConfig.domain !== WINHOUSE_TANVION_PRODUCTION_ORIGIN ||
        publicConfig.walletBaseUrl !== WINHOUSE_TANVION_WALLET_BASE_URL)
    ) {
      return this.unavailable(
        config,
        rowView,
        `Provider "${row.name}" does not use TANVION's exact production Domain and Seamless wallet base URL.`,
        credentialsSource,
      );
    }

    if (!walletApiKey || !callbackToken) {
      return this.unavailable(
        config,
        rowView,
        `Provider "${row.name}" is missing the wallet API key or the callback token. Provide them through the environment or store them (encrypted) in Admin → Partner providers.`,
        credentialsSource,
      );
    }

    if (!isValidEmbedKey(embedKey)) {
      return this.unavailable(
        config,
        rowView,
        `Provider "${row.name}" has no valid public embed key (ifr_…) configured.`,
        credentialsSource,
      );
    }

    if (embedBaseUrl !== WINHOUSE_DEFAULT_EMBED_BASE_URL) {
      return this.unavailable(
        config,
        rowView,
        `Provider "${row.name}" must use the official book origin ${WINHOUSE_DEFAULT_EMBED_BASE_URL}.`,
        credentialsSource,
      );
    }

    return {
      config,
      row: rowView,
      configured: true,
      credentialsSource,
      unavailableReason: null,
      embedKey,
      embedBaseUrl,
      domain: publicConfig.domain,
      walletBaseUrl: publicConfig.walletBaseUrl,
      serverIp: publicConfig.serverIp,
      walletApiKey,
      callbackToken,
    };
  }


  /**
   * Authenticates an inbound provider wallet callback.
   *
   * The CALLBACK TOKEN is verified in constant time before anything else (no
   * database work, no signature math), then the HMAC-SHA256 signature is
   * verified over the five documented fields with the WALLET API KEY. Only a
   * secret-free verdict (reason code + provider row id) is returned, so no
   * route can log or echo a credential.
   */
  async verifyInboundCallback(
    input: {
      token: string | null | undefined;
      signature: string | null | undefined;
      fields: { username: string; action: string; ticketId: string; transactionId: string };
      /** Amount representations to accept (wire literal + parsed value). */
      amountCandidates: readonly string[];
    },
    preResolved?: WinHouseResolvedProvider,
  ): Promise<WinHouseInboundVerdict> {
    const resolved = preResolved ?? (await this.resolve());
    if (!resolved.configured || !resolved.row) {
      return { ok: false, reason: 'not_configured', providerId: resolved.row?.id ?? null };
    }

    if (!verifyCallbackToken(input.token, resolved.callbackToken)) {
      return { ok: false, reason: 'bad_token', providerId: resolved.row.id };
    }

    const verdict = verifyBalanceChangeSignature(
      input.fields,
      input.amountCandidates,
      input.signature,
      resolved.walletApiKey,
    );
    if (!verdict.ok) {
      return { ok: false, reason: verdict.reason, providerId: resolved.row.id };
    }

    return { ok: true, reason: null, providerId: resolved.row.id };
  }

  /** Secret-free availability message for the honest unavailable UI/API. */
  unavailableMessage(resolved: WinHouseResolvedProvider): string {
    return resolved.unavailableReason ?? NOT_CONFIGURED_MESSAGE;
  }

  /**
   * Finds the provider row this process may use.
   *
   * Only rows that are actually EMBEDDED sportsbooks are eligible: a legacy
   * sports row (integrationType NULL = SPORTS_API) or a casino row can never
   * be picked up by the embedded-sportsbook paths.
   */
  private async findProviderRow(config: WinHouseEnvConfig) {
    if (config.providerRowName) {
      const row = await this.prisma.partnerProvider.findUnique({
        where: { name: config.providerRowName },
      });
      if (!row) return null;
      // An explicitly named row must still be an embedded-sportsbook row.
      if ((row.integrationType ?? null) !== 'SPORTS_IFRAME') return null;
      return row;
    }

    const candidates = await this.prisma.partnerProvider.findMany({
      where: { status: 'ACTIVE', integrationType: 'SPORTS_IFRAME' },
      orderBy: { createdAt: 'asc' },
    });
    return (
      candidates.find((row) => {
        // Rows without an environment are treated as sandbox-scoped so a
        // production deployment can never accidentally pick up an unlabelled
        // row (same rule as the casino module).
        const env = (row.environment ?? 'sandbox').trim().toLowerCase();
        return env === config.environment;
      }) ?? null
    );
  }

  private toRowView(row: {
    id: string;
    name: string;
    status: string;
    environment: string | null;
    embedKey: string | null;
    embedBaseUrl: string | null;
    config: unknown;
  }): WinHouseProviderRowView {
    const rawEnv = (row.environment ?? '').trim().toLowerCase();
    const publicConfig = readEmbeddedProviderPublicConfig(row.config);
    const environment: WinHouseProviderRowView['environment'] =
      rawEnv === 'sandbox' || rawEnv === 'production' ? rawEnv : null;
    return {
      id: row.id,
      name: row.name,
      status: row.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE',
      environment,
      domain: publicConfig.domain,
      walletBaseUrl: publicConfig.walletBaseUrl,
      serverIp: publicConfig.serverIp,
      // Never echo a value that does not look like an embed key.
      embedKey: row.embedKey && /^ifr_[0-9a-f]{40}$/i.test(row.embedKey) ? row.embedKey : null,
      embedBaseUrl: normalizeHttpsOrigin(row.embedBaseUrl),
    };
  }

  private unavailable(
    config: WinHouseEnvConfig,
    row: WinHouseProviderRowView | null,
    reason: string,
    credentialsSource: WinHouseCredentialSource,
  ): WinHouseResolvedProvider {
    return {
      config,
      row,
      configured: false,
      credentialsSource,
      unavailableReason: reason,
      embedKey: null,
      embedBaseUrl: null,
      domain: null,
      walletBaseUrl: null,
      serverIp: null,
      walletApiKey: null,
      callbackToken: null,
    };
  }

  /** Structured, secret-free log line for diagnostics. */
  logResolution(resolved: WinHouseResolvedProvider): void {
    this.logger.log(
      `winhouse.provider.resolved provider=${resolved.row?.name ?? 'none'} env=${
        resolved.config.environment
      } configured=${resolved.configured} credentials=${resolved.credentialsSource}`,
    );
  }
}
