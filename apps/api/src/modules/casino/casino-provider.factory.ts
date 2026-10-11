import { Injectable, Logger } from '@nestjs/common';
import type { CasinoEnvironment } from '@tanvion-royale/types';
import { PrismaService } from '../../database/prisma.service';
import type { PartnerProvider } from '../../generated/prisma';
import { decryptSecret } from '../../common/utils/encryption';
import { loadCasinoEnvConfig, type CasinoEnvConfig } from './casino.config';
import {
  CasinoProviderError,
  type CasinoCatalogProviderContract,
  type CasinoLaunchResult,
  type CasinoProviderCapabilities,
  type CasinoProviderHealth,
  type CasinoRemoteCategory,
  type CasinoRemoteGame,
  type CasinoRemoteGamePage,
  type CasinoRemoteGameQuery,
  type CasinoRemoteProvider,
} from './casino-provider.interface';
import { ScriptCasinoProvider } from './script-casino.provider';
import { BigBangCasinoProvider } from '../bigbang/bigbang.provider';
import {
  BIGBANG_DEFAULT_BASE_URL,
  BIGBANG_PROVIDER_CODE,
  isBigBangBaseUrl,
  loadBigBangEnvConfig,
} from '../bigbang/bigbang.config';
import {
  verifyCasinoSignature,
  type CasinoCallbackHeaders,
} from './casino-signature';

/** Secret-free verdict for an inbound provider (wallet callback) request. */
export type CasinoInboundVerdict =
  | { ok: true; reason: null; providerId: string }
  | { ok: false; reason: string; providerId: string | null };

const NOT_CONFIGURED_MESSAGE =
  'No partner casino provider is configured for this environment.';

/**
 * Safe placeholder used whenever no real casino provider is configured.
 *
 * It exists so the API is structurally complete WITHOUT fabricating anything:
 * health reports unreachable, capabilities report nothing available and every
 * catalog/launch call fails with `NOT_CONFIGURED`. The UI then shows an honest
 * "not configured / unavailable" state instead of fake games.
 */
export class UnconfiguredCasinoProvider implements CasinoCatalogProviderContract {
  readonly name = 'unconfigured';

  constructor(readonly environment: CasinoEnvironment) {}

  isConfigured(): boolean {
    return false;
  }

  async health(): Promise<CasinoProviderHealth> {
    return {
      reachable: false,
      latencyMs: null,
      providersUp: null,
      message: NOT_CONFIGURED_MESSAGE,
    };
  }

  async capabilities(): Promise<CasinoProviderCapabilities> {
    return { casino: false, liveCasino: false, demoSupported: false, source: 'unavailable' };
  }

  async listCategories(): Promise<CasinoRemoteCategory[]> {
    throw new CasinoProviderError(NOT_CONFIGURED_MESSAGE, 'NOT_CONFIGURED');
  }

  async listProviders(): Promise<CasinoRemoteProvider[]> {
    throw new CasinoProviderError(NOT_CONFIGURED_MESSAGE, 'NOT_CONFIGURED');
  }

  async listGames(_query: CasinoRemoteGameQuery): Promise<CasinoRemoteGamePage> {
    throw new CasinoProviderError(NOT_CONFIGURED_MESSAGE, 'NOT_CONFIGURED');
  }

  async getGame(): Promise<CasinoRemoteGame | null> {
    throw new CasinoProviderError(NOT_CONFIGURED_MESSAGE, 'NOT_CONFIGURED');
  }

  async launch(): Promise<CasinoLaunchResult> {
    throw new CasinoProviderError(NOT_CONFIGURED_MESSAGE, 'NOT_CONFIGURED');
  }

  async launchDemo(): Promise<CasinoLaunchResult> {
    throw new CasinoProviderError(NOT_CONFIGURED_MESSAGE, 'NOT_CONFIGURED');
  }

  async closeSession(): Promise<void> {
    throw new CasinoProviderError(NOT_CONFIGURED_MESSAGE, 'NOT_CONFIGURED');
  }
}


/** Where the active credential values came from (never their values). */
export type CasinoCredentialSource = 'environment' | 'database' | 'none';

/** The provider row as exposed to admin (never the raw/encrypted columns). */
export interface CasinoProviderRowView {
  id: string;
  name: string;
  providerCode: string | null;
  baseUrl: string;
  status: 'ACTIVE' | 'INACTIVE';
  environment: CasinoEnvironment | null;
  apiVersion: string | null;
}

export interface BigBangResolvedCredentials {
  row: CasinoProviderRowView;
  apiKey: string;
  environment: CasinoEnvironment;
}

export type BigBangResolution =
  | { ok: true; credentials: BigBangResolvedCredentials }
  | { ok: false; reason: string; providerId: string | null };

export interface CasinoResolvedProvider {
  provider: CasinoCatalogProviderContract;
  config: CasinoEnvConfig;
  row: CasinoProviderRowView | null;
  configured: boolean;
  credentialsSource: CasinoCredentialSource;
  /** Safe, secret-free reason when `configured` is false. */
  unavailableReason: string | null;
}

/**
 * Resolves the ONE partner casino provider for the environment this API process
 * is configured for.
 *
 * SECURITY
 *  - sandbox and production rows are never mixed: a row whose `environment`
 *    disagrees with PARTNER_CASINO_ENV is refused, not silently used;
 *  - the merchant secret comes from the environment (preferred) or from the
 *    AES-256-GCM encrypted PartnerProvider row — it is never logged, never
 *    returned and never sent to the browser;
 *  - a disabled provider row yields `configured = false` (no fake data).
 */
@Injectable()
export class CasinoProviderFactory {
  private readonly logger = new Logger(CasinoProviderFactory.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Verifies the existing Script.Casino callback signature. BigBang uses its
   * separate API-key/HMAC callback service and must never be accepted by this
   * legacy verifier, even if a BigBang row happens to be the only casino row.
   */
  async verifyInboundRequest(input: {
    headers: CasinoCallbackHeaders;
    method: string;
    path: string;
    rawBody: string;
  }): Promise<CasinoInboundVerdict> {
    const config = this.config();
    const row = await this.findProviderRow(config);
    if (!row) return { ok: false, reason: 'not_configured', providerId: null };
    if (row.integrationType === 'CASINO_AGGREGATOR' || row.providerCode === BIGBANG_PROVIDER_CODE) {
      return { ok: false, reason: 'not_configured', providerId: row.id };
    }
    if (row.status !== 'ACTIVE') return { ok: false, reason: 'provider_disabled', providerId: row.id };
    const rowEnvironment = (row.environment ?? '').trim().toLowerCase();
    if (rowEnvironment && rowEnvironment !== config.environment) {
      return { ok: false, reason: 'environment_mismatch', providerId: row.id };
    }
    const dbMerchantId = row.apiKeyEnc ? decryptSecret(row.apiKeyEnc).trim() : '';
    const merchantId = config.merchantId ?? (dbMerchantId || null);
    const dbSecret = row.apiSecretEnc ? decryptSecret(row.apiSecretEnc).trim() : '';
    const secret = config.secret ?? (dbSecret || null);
    if (!merchantId || !secret) return { ok: false, reason: 'credentials_missing', providerId: row.id };
    const verdict = verifyCasinoSignature(input.headers, merchantId, secret, {
      method: input.method,
      path: input.path,
      rawBody: input.rawBody,
    });
    return verdict.ok
      ? { ok: true, reason: null, providerId: row.id }
      : { ok: false, reason: verdict.reason, providerId: row.id };
  }

  /** Loads the environment configuration (pure, no DB access). */
  config(): CasinoEnvConfig {
    return loadCasinoEnvConfig();
  }

  /**
   * BigBang's per-purpose timeout trio.
   *
   * Resolved separately from the generic casino config so the three budgets can
   * be tuned independently (`BIGBANG_HEALTH_TIMEOUT_MS`,
   * `BIGBANG_CATALOG_TIMEOUT_MS`, `BIGBANG_LAUNCH_TIMEOUT_MS`) without
   * affecting the Script.Casino adapter. Pure and env-only, so it is safe to
   * call on every resolution.
   */
  private bigBangTimeouts() {
    const fromEnv = loadBigBangEnvConfig();
    return {
      healthTimeoutMs: fromEnv.healthTimeoutMs,
      launchTimeoutMs: fromEnv.launchTimeoutMs,
    };
  }

  /**
   * Resolve only the active BIGBANG row for the current casino environment.
   * This is intentionally separate from the legacy Script.Casino credential
   * resolver: an aggregator has one API key, not a merchant id + secret pair.
   */
  async resolveBigBang(): Promise<BigBangResolution> {
    const config = this.config();
    const row = await this.findBigBangRow(config);
    if (!row) return { ok: false, reason: 'not_configured', providerId: null };
    if (row.status !== 'ACTIVE') return { ok: false, reason: 'provider_disabled', providerId: row.id };
    const environment = (row.environment ?? '').trim().toLowerCase();
    if (environment !== config.environment) return { ok: false, reason: 'environment_mismatch', providerId: row.id };
    if (!isBigBangBaseUrl(row.baseUrl)) return { ok: false, reason: 'invalid_base_url', providerId: row.id };
    const apiKey = row.apiKeyEnc ? decryptSecret(row.apiKeyEnc).trim() : '';
    if (!apiKey) return { ok: false, reason: 'credentials_missing', providerId: row.id };
    return {
      ok: true,
      credentials: {
        // The row is exposed only through the secret-free view (never the
        // encrypted columns and never the decrypted API key).
        row: this.toRowView(row),
        apiKey,
        environment: config.environment,
      },
    };
  }

  async resolve(): Promise<CasinoResolvedProvider> {
    const config = this.config();
    const row = await this.findProviderRow(config);

    if (!row) {
      return this.unavailable(
        config,
        null,
        config.providerRowName
          ? `No PartnerProvider named "${config.providerRowName}" is registered for the casino product.`
          : 'No casino PartnerProvider row is registered. Configure one in Admin → Partner Providers.',
      );
    }

    return this.resolveRow(row, config);
  }

  /**
   * Resolve the adapter for ONE specific provider row (multi-provider support).
   *
   * A catalog/launch request names a game that belongs to a known provider row,
   * so the adapter must be built from THAT row — never from the process's single
   * "primary" row. Returns null when the row does not exist.
   */
  async resolveById(providerId: string): Promise<CasinoResolvedProvider | null> {
    const config = this.config();
    const row = await this.prisma.partnerProvider.findUnique({
      where: { id: providerId },
    });
    if (!row) return null;
    return this.resolveRow(row, config);
  }

  /**
   * EVERY ACTIVE, casino-capable provider row for the environment this process
   * runs in, each with its own resolved adapter.
   *
   * This is what a catalog SYNC walks: with N configured providers all N are
   * synced, not just the first one. Rows declaring another environment are
   * skipped (sandbox and production are never mixed) and rows that are INACTIVE
   * are never eligible.
   */
  async listResolvableProviders(): Promise<CasinoResolvedProvider[]> {
    const config = this.config();
    const rows = await this.prisma.partnerProvider.findMany({
      where: {
        status: 'ACTIVE',
        productTypes: { hasSome: ['CASINO', 'LIVE_CASINO'] },
      },
      orderBy: { createdAt: 'asc' },
    });

    const eligible = rows.filter((row) => {
      const environment = (row.environment ?? 'sandbox').trim().toLowerCase();
      return environment === config.environment;
    });

    return Promise.all(eligible.map((row) => this.resolveRow(row, config)));
  }

  /** Builds the adapter/credentials view for ONE already-loaded provider row. */
  private async resolveRow(
    row: PartnerProvider,
    config: CasinoEnvConfig,
  ): Promise<CasinoResolvedProvider> {
    const rowView = this.toRowView(row);
    const rowEnvironment = (row.environment ?? '').trim().toLowerCase();

    if (rowEnvironment && rowEnvironment !== config.environment) {
      return this.unavailable(
        config,
        rowView,
        `Provider "${row.name}" is registered for ${rowEnvironment}, but this deployment runs PARTNER_CASINO_ENV=${config.environment}. Sandbox and production are never mixed.`,
      );
    }

    if (row.status !== 'ACTIVE') {
      return this.unavailable(config, rowView, `Provider "${row.name}" is disabled.`);
    }

    const providerCode = (row.providerCode ?? '').trim().toUpperCase();
    if (row.integrationType === 'CASINO_AGGREGATOR' || providerCode === BIGBANG_PROVIDER_CODE) {
      if (providerCode !== BIGBANG_PROVIDER_CODE) {
        return this.unavailable(config, rowView, `Casino aggregator "${row.name}" has no supported provider adapter code.`);
      }
      if (!isBigBangBaseUrl(row.baseUrl)) {
        return this.unavailable(config, rowView, `BigBang provider "${row.name}" must use the verified BigBang API base URL.`);
      }
      const apiKey = row.apiKeyEnc ? decryptSecret(row.apiKeyEnc).trim() : '';
      if (!apiKey) {
        return this.unavailable(config, rowView, `BigBang provider "${row.name}" is missing its encrypted API key.`);
      }
      const bigBangTimeouts = this.bigBangTimeouts();
      return {
        provider: new BigBangCasinoProvider({
          name: row.name,
          environment: config.environment,
          baseUrl: BIGBANG_DEFAULT_BASE_URL,
          apiKey,
          timeoutMs: config.timeoutMs,
          // The catalog walk is many bounded page calls over a ~1,860-row
          // inventory, so it gets its own page size and its own (larger) budget
          // instead of the interactive one used for launch/balance calls.
          catalogPageSize: config.catalogPageSize,
          catalogTimeoutMs: config.catalogTimeoutMs,
          // Per-purpose budgets, so raising the catalog ceiling for a big
          // inventory can never make the health probe or a launch hang.
          healthTimeoutMs: bigBangTimeouts.healthTimeoutMs,
          launchTimeoutMs: bigBangTimeouts.launchTimeoutMs,
          catalogCacheTtlMs: config.cacheTtlMs,
        }),
        config,
        row: rowView,
        configured: true,
        credentialsSource: 'database',
        unavailableReason: null,
      };
    }

    const envMerchantId = config.merchantId;
    const dbMerchantId = row.apiKeyEnc ? decryptSecret(row.apiKeyEnc).trim() : '';
    const merchantId = envMerchantId ?? (dbMerchantId || null);

    const envSecret = config.secret;
    const dbSecret = row.apiSecretEnc ? decryptSecret(row.apiSecretEnc).trim() : '';
    const secret = envSecret ?? (dbSecret || null);

    const credentialsSource: CasinoCredentialSource =
      envMerchantId && envSecret
        ? 'environment'
        : merchantId && secret
          ? 'database'
          : 'none';

    const usableBaseUrl = this.normalizeBaseUrl(row.baseUrl);
    if (!usableBaseUrl || !merchantId || !secret) {
      return {
        provider: new UnconfiguredCasinoProvider(config.environment),
        config,
        row: rowView,
        configured: false,
        credentialsSource,
        unavailableReason: !usableBaseUrl
          ? `Provider "${row.name}" has no usable HTTPS base URL.`
          : `Provider "${row.name}" is missing the merchant id or the merchant secret. Provide them through the environment or store them (encrypted) in Admin → Partner Providers.`,
      };
    }

    const apiVersion = (row.apiVersion ?? config.apiVersion ?? 'v1').trim() || 'v1';

    return {
      provider: new ScriptCasinoProvider({
        name: row.name,
        environment: config.environment,
        baseUrl: usableBaseUrl,
        merchantId,
        secret,
        apiVersion,
        timeoutMs: config.timeoutMs,
      }),
      config,
      row: rowView,
      configured: true,
      credentialsSource,
      unavailableReason: null,
    };
  }


  /**
   * True when the provider supports the requested product. Uses the live
   * provider inventory (`capabilities()`), never an assumption.
   */
  async supportsProduct(
    resolved: CasinoResolvedProvider,
    productType: 'CASINO' | 'LIVE_CASINO',
  ): Promise<boolean> {
    if (!resolved.configured) return false;
    const capabilities = await resolved.provider.capabilities();
    return productType === 'LIVE_CASINO' ? capabilities.liveCasino : capabilities.casino;
  }

  private async findBigBangRow(config: CasinoEnvConfig) {
    if (config.providerRowName) {
      return this.prisma.partnerProvider.findUnique({ where: { name: config.providerRowName } });
    }
    const candidates = await this.prisma.partnerProvider.findMany({
      where: {
        status: 'ACTIVE',
        integrationType: 'CASINO_AGGREGATOR',
        providerCode: BIGBANG_PROVIDER_CODE,
        productTypes: { hasSome: ['CASINO', 'LIVE_CASINO'] },
      },
      orderBy: { createdAt: 'asc' },
    });
    return candidates.find((row) => (row.environment ?? '').trim().toLowerCase() === config.environment) ?? null;
  }

  private async findProviderRow(config: CasinoEnvConfig) {
    if (config.providerRowName) {
      return this.prisma.partnerProvider.findUnique({
        where: { name: config.providerRowName },
      });
    }
    // Auto-select: a casino-capable row in the environment this process runs
    // in. Rows without an environment are treated as sandbox-scoped so a
    // production deployment can never accidentally pick up an unlabelled row.
    const candidates = await this.prisma.partnerProvider.findMany({
      where: {
        status: 'ACTIVE',
        productTypes: { hasSome: ['CASINO', 'LIVE_CASINO'] },
      },
      orderBy: { createdAt: 'asc' },
    });
    return (
      candidates.find((row) => {
        const env = (row.environment ?? 'sandbox').trim().toLowerCase();
        return env === config.environment;
      }) ?? null
    );
  }

  private toRowView(row: {
    id: string;
    name: string;
    baseUrl: string;
    status: string;
    environment: string | null;
    providerCode?: string | null;
    apiVersion: string | null;
  }): CasinoProviderRowView {
    const status: CasinoProviderRowView['status'] =
      row.status === 'ACTIVE' ? 'ACTIVE' : 'INACTIVE';
    const rawEnv = (row.environment ?? '').trim().toLowerCase();
    const environment: CasinoProviderRowView['environment'] =
      rawEnv === 'sandbox' || rawEnv === 'production' ? rawEnv : null;
    return {
      id: row.id,
      name: row.name,
      providerCode: row.providerCode ?? null,
      baseUrl: row.baseUrl,
      status,
      environment,
      apiVersion: row.apiVersion,
    };
  }

  private unavailable(
    config: CasinoEnvConfig,
    row: CasinoProviderRowView | null,
    reason: string,
  ): CasinoResolvedProvider {
    return {
      provider: new UnconfiguredCasinoProvider(config.environment),
      config,
      row,
      configured: false,
      credentialsSource: 'none',
      unavailableReason: reason,
    };
  }

  /** Only an https origin (path allowed) is ever used as a provider base URL. */
  private normalizeBaseUrl(baseUrl: string): string | null {
    const candidate = (baseUrl ?? '').trim();
    if (!candidate) return null;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'https:') return null;
      const pathname = parsed.pathname.replace(/\/+$/, '');
      return `${parsed.origin}${pathname}`;
    } catch {
      return null;
    }
  }

  /** Structured, secret-free log line for provider diagnostics. */
  logResolution(resolved: CasinoResolvedProvider): void {
    this.logger.log(
      `casino.provider.resolved provider=${resolved.row?.name ?? 'none'} env=${
        resolved.config.environment
      } configured=${resolved.configured} credentials=${resolved.credentialsSource}`,
    );
  }
}

