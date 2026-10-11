import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { encryptSecret, hasSecret } from '../../common/utils/encryption';
import type { PartnerProviderView } from './partner-providers.types';
import {
  CreatePartnerProviderDto,
  EMBED_KEY_PATTERN,
  UpdatePartnerProviderDto,
} from './dto/partner-providers.dto';
import {
  makeEmbeddedProviderPublicConfig,
  normalizeProviderDomain,
  normalizeProviderServerIp,
  normalizeWinHouseWalletBaseUrl,
  readEmbeddedProviderPublicConfig,
} from './partner-provider-config';

import { SportsSyncService, type SyncSummary } from './sports-sync.service';
import {
  WINHOUSE_DEFAULT_EMBED_BASE_URL,
  WINHOUSE_TANVION_PRODUCTION_ORIGIN,
  WINHOUSE_TANVION_WALLET_BASE_URL,
} from '../winhouse/winhouse.config';
import {
  BIGBANG_DEFAULT_BASE_URL,
  BIGBANG_PROVIDER_CODE,
  isBigBangBaseUrl,
} from '../bigbang/bigbang.config';

/**
 * Admin CRUD for PartnerProvider rows (Phase 16 - partner sports routing,
 * extended for EMBEDDED sportsbooks / SPORTS_IFRAME).
 *
 * Secrets (apiKey/apiSecret and, for an embedded sportsbook, walletApiKey /
 * callbackToken) are encrypted at rest with ENCRYPTION_KEY and NEVER returned
 * raw -- only boolean *Set flags are exposed from the API. The embed key and
 * the embed base URL are NOT secrets (the key is public by the provider's
 * design) and are returned so the admin can verify the configuration.
 *
 * Production safety: provider credentials must never be encrypted with the
 * source-known development key, so creating/updating a secret REQUIRES the
 * real ENCRYPTION_KEY in production and fails with a structured
 * configuration error otherwise.
 */
@Injectable()
export class PartnerProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: SportsSyncService,
  ) {}

  /** Known non-production placeholder keys that must never encrypt real secrets. */
  private static readonly DEV_ENCRYPTION_PLACEHOLDERS = new Set([
    'dev-only-encryption-key-change-me', // code fallback (see common/utils/encryption.ts)
    'change-me-32-byte-encryption-key', // .env.example placeholder
  ]);

  /** In production a real ENCRYPTION_KEY is mandatory before any secret is stored. */
  private ensureEncryptionConfigured(): void {
    if (process.env.NODE_ENV === 'production') {
      const key = process.env.ENCRYPTION_KEY;
      if (!key || PartnerProvidersService.DEV_ENCRYPTION_PLACEHOLDERS.has(key)) {
        throw new ServiceUnavailableException(
          'Provider credentials cannot be stored securely: ENCRYPTION_KEY is not configured.',
        );
      }
    }
  }

  async list(): Promise<PartnerProviderView[]> {
    const rows = await this.prisma.partnerProvider.findMany({ orderBy: { name: 'asc' } });
    return rows.map((row) => this.toView(row as unknown as PartnerProviderRow));
  }

  async create(
    actor: AuthenticatedUser,
    dto: CreatePartnerProviderDto,
    ip?: string,
    userAgent?: string,
  ): Promise<PartnerProviderView> {
    const integrationType = dto.integrationType ?? 'SPORTS_API';
    const providerCode = dto.providerCode?.trim().toUpperCase() || null;
    const deepLinkTemplate = this.resolveDeepLinkTemplate(integrationType, dto.deepLinkTemplate);
    const suppliedWalletApiKey = dto.walletApiKey?.trim() ?? '';
    const suppliedCallbackToken = dto.callbackToken?.trim() ?? '';

    if (
      suppliedWalletApiKey ||
      suppliedCallbackToken ||
      dto.apiKey ||
      dto.apiSecret
    ) {
      this.ensureEncryptionConfigured();
    }
    if (integrationType === 'SPORTS_IFRAME') {
      this.assertEmbeddedConfig({
        embedKey: dto.embedKey,
        embedBaseUrl: dto.embedBaseUrl,
        environment: dto.environment,
        domain: dto.domain,
        walletBaseUrl: dto.walletBaseUrl,
        serverIp: dto.serverIp,
        walletApiKey:
          suppliedWalletApiKey ||
          (this.hasEnvironmentSecret('WINHOUSE_WALLET_API_KEY') ? 'stored' : undefined),
        callbackToken:
          suppliedCallbackToken ||
          (this.hasEnvironmentSecret('WINHOUSE_CALLBACK_TOKEN') ? 'stored' : undefined),
        requireSecrets: true,
      });
    }
    if (integrationType === 'CASINO_AGGREGATOR') {
      this.assertCasinoAggregatorConfig({
        providerCode,
        baseUrl: dto.baseUrl,
        environment: dto.environment,
        apiKey: dto.apiKey,
        requireApiKey: dto.status !== 'INACTIVE',
      });
    }

    const existing = await this.prisma.partnerProvider.findUnique({ where: { name: dto.name } });
    if (existing) {
      throw new ConflictException(`A partner provider named "${dto.name}" already exists`);
    }
    const row = await this.prisma.partnerProvider.create({
      data: {
        name: dto.name,
        providerCode,
        baseUrl: dto.baseUrl.replace(/\/+$/, ''),
        deepLinkTemplate,
        status: dto.status ?? 'ACTIVE',
        apiKeyEnc: dto.apiKey ? encryptSecret(dto.apiKey) : undefined,
        apiSecretEnc: dto.apiSecret ? encryptSecret(dto.apiSecret) : undefined,
        authMode: dto.authMode ?? null,
        apiVersion: dto.apiVersion ?? null,
        integrationType,
        environment: dto.environment ?? null,
        embedKey: dto.embedKey ? dto.embedKey.trim() : null,
        embedBaseUrl: dto.embedBaseUrl ? normalizeProviderDomain(dto.embedBaseUrl) : null,
        walletApiKeyEnc: suppliedWalletApiKey ? encryptSecret(suppliedWalletApiKey) : undefined,
        callbackTokenEnc: suppliedCallbackToken ? encryptSecret(suppliedCallbackToken) : undefined,
        // An embedded sportsbook serves the SPORT section; a casino aggregator
        // serves CASINO and LIVE_CASINO; an API row keeps the
        // pre-existing (empty) product list so nothing about it changes.
        productTypes:
          integrationType === 'SPORTS_IFRAME'
            ? ['SPORT']
            : integrationType === 'CASINO_AGGREGATOR' || integrationType === 'CASINO_API'
              ? ['CASINO', 'LIVE_CASINO']
              : [],
        config:
          integrationType === 'SPORTS_IFRAME'
            ? makeEmbeddedProviderPublicConfig({
                domain: dto.domain,
                walletBaseUrl: dto.walletBaseUrl,
                serverIp: dto.serverIp,
              })
            : undefined,
      },
    });
    await this.audit(
      actor.id,
      'PARTNER_PROVIDER_CREATED',
      row.id,
      null,
      this.toAuditRecord(row as unknown as PartnerProviderRow),
      ip,
      userAgent,
    );
    return this.toView(row as unknown as PartnerProviderRow);
  }

  async update(
    id: string,
    actor: AuthenticatedUser,
    dto: UpdatePartnerProviderDto,
    ip?: string,
    userAgent?: string,
  ): Promise<PartnerProviderView> {
    const existing = await this.prisma.partnerProvider.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Partner provider not found');

    const integrationType = dto.integrationType ?? existing.integrationType ?? 'SPORTS_API';
    const providerCode =
      dto.providerCode !== undefined
        ? dto.providerCode.trim().toUpperCase() || null
        : integrationType === 'CASINO_AGGREGATOR'
          ? existing.providerCode
          : null;
    const existingPublicConfig = readEmbeddedProviderPublicConfig(existing.config);
    const suppliedWalletApiKey = dto.walletApiKey?.trim() ?? '';
    const suppliedCallbackToken = dto.callbackToken?.trim() ?? '';
    const clearsWalletApiKey = dto.walletApiKey !== undefined && !suppliedWalletApiKey;
    const clearsCallbackToken = dto.callbackToken !== undefined && !suppliedCallbackToken;

    // Only re-encrypt when a new secret value is actually supplied.
    if (
      (dto.apiKey ?? '') !== '' ||
      (dto.apiSecret ?? '') !== '' ||
      suppliedWalletApiKey !== '' ||
      suppliedCallbackToken !== ''
    ) {
      this.ensureEncryptionConfigured();
    }

    const embeddedSecretClear =
      integrationType === 'SPORTS_IFRAME' && (clearsWalletApiKey || clearsCallbackToken);
    const clearsAggregatorApiKey =
      integrationType === 'CASINO_AGGREGATOR' && dto.apiKey !== undefined && !dto.apiKey.trim();
    const nextStatus = embeddedSecretClear || clearsAggregatorApiKey
      ? 'INACTIVE'
      : dto.status ?? existing.status;
    const hasEmbeddedConfigEdit =
      dto.embedKey !== undefined ||
      dto.embedBaseUrl !== undefined ||
      dto.environment !== undefined ||
      dto.domain !== undefined ||
      dto.walletBaseUrl !== undefined ||
      dto.serverIp !== undefined ||
      dto.walletApiKey !== undefined ||
      dto.callbackToken !== undefined;
    const hasCompleteStoredConfig =
      Boolean(existingPublicConfig.domain && existingPublicConfig.walletBaseUrl) &&
      Boolean(existing.embedKey && /^ifr_[0-9a-f]{40}$/i.test(existing.embedKey)) &&
      Boolean(existing.embedBaseUrl) &&
      (hasSecret(existing.walletApiKeyEnc) || this.hasEnvironmentSecret('WINHOUSE_WALLET_API_KEY')) &&
      (hasSecret(existing.callbackTokenEnc) || this.hasEnvironmentSecret('WINHOUSE_CALLBACK_TOKEN'));
    const isIframeShapeChange =
      integrationType === 'SPORTS_IFRAME' &&
      dto.integrationType === 'SPORTS_IFRAME' &&
      (existing.integrationType ?? 'SPORTS_API') !== 'SPORTS_IFRAME';
    // Disabling must always remain possible, even for an incomplete legacy row.
    // An active complete row stays validated on ordinary edits. An incomplete
    // active legacy row may receive unrelated metadata edits, but activation or
    // any explicit public/secret configuration edit must be made complete first.
    if (
      integrationType === 'SPORTS_IFRAME' &&
      nextStatus === 'ACTIVE' &&
      (hasEmbeddedConfigEdit ||
        hasCompleteStoredConfig ||
        isIframeShapeChange ||
        (dto.status === 'ACTIVE' && existing.status !== 'ACTIVE'))
    ) {
      // PRESENCE of a usable credential (new or existing) is required.
      this.assertEmbeddedConfig({
        embedKey: dto.embedKey ?? existing.embedKey ?? undefined,
        embedBaseUrl: dto.embedBaseUrl ?? existing.embedBaseUrl ?? undefined,
        environment: dto.environment ?? (existing.environment as 'sandbox' | 'production' | null),
        domain: dto.domain ?? existingPublicConfig.domain,
        walletBaseUrl: dto.walletBaseUrl ?? existingPublicConfig.walletBaseUrl,
        serverIp:
          dto.serverIp === undefined ? existingPublicConfig.serverIp : dto.serverIp,
        walletApiKey:
          dto.walletApiKey !== undefined
            ? suppliedWalletApiKey || undefined
            : hasSecret(existing.walletApiKeyEnc) || this.hasEnvironmentSecret('WINHOUSE_WALLET_API_KEY')
              ? 'stored'
              : undefined,
        callbackToken:
          dto.callbackToken !== undefined
            ? suppliedCallbackToken || undefined
            : hasSecret(existing.callbackTokenEnc) || this.hasEnvironmentSecret('WINHOUSE_CALLBACK_TOKEN')
              ? 'stored'
              : undefined,
        // An explicit empty string is an intentional clear/rotation and may make
        // the integration unavailable. Omitted fields use the stored sentinel and
        // therefore remain subject to complete-config validation.
        requireSecrets: !clearsWalletApiKey && !clearsCallbackToken,
      });
    }

    if (integrationType === 'CASINO_AGGREGATOR' && nextStatus === 'ACTIVE') {
      this.assertCasinoAggregatorConfig({
        providerCode,
        baseUrl: dto.baseUrl ?? existing.baseUrl,
        environment: dto.environment ?? existing.environment,
        apiKey:
          dto.apiKey !== undefined
            ? dto.apiKey || undefined
            : hasSecret(existing.apiKeyEnc)
              ? 'stored'
              : undefined,
        requireApiKey: true,
      });
    }

    const data: Prisma.PartnerProviderUpdateInput = {
      name: dto.name ?? undefined,
      providerCode,
      baseUrl: dto.baseUrl ? dto.baseUrl.replace(/\/+$/, '') : undefined,
      deepLinkTemplate:
        dto.deepLinkTemplate === undefined
          ? undefined
          : this.resolveDeepLinkTemplate(integrationType, dto.deepLinkTemplate, existing.deepLinkTemplate),
      status: embeddedSecretClear || clearsAggregatorApiKey ? 'INACTIVE' : dto.status ?? undefined,
      authMode: dto.authMode === undefined ? undefined : (dto.authMode || null),
      apiVersion: dto.apiVersion === undefined ? undefined : (dto.apiVersion || null),
      integrationType: dto.integrationType ?? undefined,
      environment:
        dto.environment === undefined ? undefined : (dto.environment || null),
      embedKey: dto.embedKey === undefined ? undefined : (dto.embedKey.trim() || null),
      embedBaseUrl:
        dto.embedBaseUrl === undefined
          ? undefined
          : dto.embedBaseUrl
            ? this.normalizeOrigin(dto.embedBaseUrl)
            : null,
      // An embedded sportsbook always serves SPORT; a casino aggregator
      // serves CASINO and LIVE_CASINO.
      productTypes:
        integrationType === 'SPORTS_IFRAME'
          ? ['SPORT']
          : integrationType === 'CASINO_AGGREGATOR' || integrationType === 'CASINO_API'
            ? ['CASINO', 'LIVE_CASINO']
            : undefined,
      config:
        integrationType === 'SPORTS_IFRAME'
          ? makeEmbeddedProviderPublicConfig({
              domain: dto.domain ?? existingPublicConfig.domain,
              walletBaseUrl: dto.walletBaseUrl ?? existingPublicConfig.walletBaseUrl,
              serverIp:
                dto.serverIp === undefined ? existingPublicConfig.serverIp : dto.serverIp,
            })
          : undefined,
    };
    // Empty string clears the secret; a value encrypts it; omission keeps it.
    if (dto.apiKey === '') data.apiKeyEnc = null;
    else if (dto.apiKey) data.apiKeyEnc = encryptSecret(dto.apiKey);
    if (dto.apiSecret === '') data.apiSecretEnc = null;
    else if (dto.apiSecret) data.apiSecretEnc = encryptSecret(dto.apiSecret);
    // The wallet API key and the callback token are SEPARATE secrets: clearing
    // one never touches the other.
    if (clearsWalletApiKey) data.walletApiKeyEnc = null;
    else if (suppliedWalletApiKey) data.walletApiKeyEnc = encryptSecret(suppliedWalletApiKey);
    if (clearsCallbackToken) data.callbackTokenEnc = null;
    else if (suppliedCallbackToken) data.callbackTokenEnc = encryptSecret(suppliedCallbackToken);

    const updated = await this.prisma.partnerProvider.update({ where: { id }, data });

    await this.audit(
      actor.id,
      'PARTNER_PROVIDER_UPDATED',
      id,
      this.toAuditRecord(existing as unknown as PartnerProviderRow),
      this.toAuditRecord(updated as unknown as PartnerProviderRow),
      ip,
      userAgent,
    );
    return this.toView(updated as unknown as PartnerProviderRow);
  }

  async remove(id: string, actor: AuthenticatedUser, ip?: string, userAgent?: string): Promise<void> {
    const row = await this.prisma.partnerProvider.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Partner provider not found');
    await this.prisma.partnerProvider.delete({ where: { id } });
    await this.audit(
      actor.id,
      'PARTNER_PROVIDER_DELETED',
      id,
      this.toAuditRecord(row as unknown as PartnerProviderRow),
      null,
      ip,
      userAgent,
    );
  }

  /** Runs the sync for one (or all active) partner provider(s). */
  async runSync(
    providerId?: string,
    actor?: AuthenticatedUser,
    ip?: string,
    userAgent?: string,
  ): Promise<{ message: string; summary: SyncSummary }> {
    const summary = await this.sync.syncAll(providerId, actor, ip, userAgent);
    return { message: 'Sync finished', summary };
  }

  private toView(row: PartnerProviderRow): PartnerProviderView {
    const publicConfig = readEmbeddedProviderPublicConfig(row.config);
    return {
      id: row.id,
      name: row.name,
      providerCode: row.providerCode,
      baseUrl: row.baseUrl,
      deepLinkTemplate: row.deepLinkTemplate,
      status: row.status as 'ACTIVE' | 'INACTIVE',
      integrationType: (row.integrationType as PartnerProviderView['integrationType']) ?? 'SPORTS_API',
      environment: (row.environment as PartnerProviderView['environment']) ?? null,
      domain: publicConfig.domain,
      walletBaseUrl: publicConfig.walletBaseUrl,
      serverIp: publicConfig.serverIp,
      embedKey: row.embedKey ?? null,
      embedBaseUrl: normalizeProviderDomain(row.embedBaseUrl),
      walletApiKeySet: hasSecret(row.walletApiKeyEnc),
      callbackTokenSet: hasSecret(row.callbackTokenEnc),
      apiKeySet: hasSecret(row.apiKeyEnc),
      apiSecretSet: hasSecret(row.apiSecretEnc),
      authMode: row.authMode ?? null,
      apiVersion: row.apiVersion ?? null,
      syncStatus: row.syncStatus ?? null,
      lastSyncAt: row.lastSyncAt ? row.lastSyncAt.toISOString() : null,
      lastSyncError: row.lastSyncError ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * The deep-link template for the requested integration type.
   *
   *  - SPORTS_API (and legacy rows): REQUIRED, exactly as before — the backend
   *    resolves partner event links server-side with it;
   *  - SPORTS_IFRAME: meaningless. The provider serves its own book, so the
   *    column is stored EMPTY rather than with a made-up template
   *    (Admin → Partner providers no longer asks for one for WinHouse).
   */
  private resolveDeepLinkTemplate(
    integrationType: string,
    template: string | undefined,
    fallback = '',
  ): string {
    const trimmed = (template ?? '').trim();
    if (
      integrationType === 'SPORTS_IFRAME' ||
      integrationType === 'CASINO_AGGREGATOR' ||
      integrationType === 'CASINO_API' ||
      integrationType === 'LIVE_CASINO_API'
    ) {
      return '';
    }
    if (!trimmed) {
      // A legacy/API row keeps whatever it already had (update) or fails clearly.
      if (fallback) return fallback;
      throw new BadRequestException(
        'deepLinkTemplate is required for a server-side (SPORTS_API) sports provider.',
      );
    }
    return trimmed;
  }

  /**
   * Cross-field validation for a casino aggregator row. BigBang currently uses
   * one API key (also its HMAC secret), a verified base URL and an explicit
   * environment. Unknown future adapter codes are not silently treated as
   * BigBang.
   */
  private assertCasinoAggregatorConfig(input: {
    providerCode: string | null;
    baseUrl: string;
    environment?: string | null;
    apiKey?: string;
    requireApiKey: boolean;
  }): void {
    if (input.providerCode !== BIGBANG_PROVIDER_CODE) {
      throw new BadRequestException('CASINO_AGGREGATOR providerCode must be BIGBANG.');
    }
    if (!isBigBangBaseUrl(input.baseUrl)) {
      throw new BadRequestException(`BigBang baseUrl must be exactly ${BIGBANG_DEFAULT_BASE_URL}.`);
    }
    const environment = (input.environment ?? '').trim().toLowerCase();
    if (environment !== 'sandbox' && environment !== 'production') {
      throw new BadRequestException('BigBang environment must be sandbox or production.');
    }
    if (input.requireApiKey && !input.apiKey) {
      throw new BadRequestException('BigBang API key is required for an active casino aggregator.');
    }
  }

  /**
   * Cross-field validation for an EMBEDDED sportsbook (SPORTS_IFRAME).
   *
   * The embed key and the wallet credentials are DIFFERENT things: the key is
   * public by provider design, while the wallet API key and the callback token
   * are server-only secrets. Everything here is validated so a half-configured
   * provider can never be saved and later fail silently inside the iframe.
   */
  /** Secret presence only — the value is never read into a response or log. */
  private hasEnvironmentSecret(name: 'WINHOUSE_WALLET_API_KEY' | 'WINHOUSE_CALLBACK_TOKEN'): boolean {
    return (process.env[name] ?? '').trim().length > 0;
  }

  private assertEmbeddedConfig(input: {
    embedKey?: string | undefined;
    embedBaseUrl?: string | null | undefined;
    environment?: string | null | undefined;
    domain?: string | null | undefined;
    walletBaseUrl?: string | null | undefined;
    serverIp?: string | null | undefined;
    walletApiKey?: string | undefined;
    callbackToken?: string | undefined;
    requireSecrets: boolean;
  }): void {
    const embedKey = (input.embedKey ?? '').trim();
    if (!embedKey) {
      throw new BadRequestException('embedKey (ifr_…) is required for an embedded sportsbook.');
    }
    if (!EMBED_KEY_PATTERN.test(embedKey)) {
      throw new BadRequestException(
        'embedKey must look like ifr_ followed by 40 hex characters.',
      );
    }

    const normalizedEmbedBaseUrl = normalizeProviderDomain(input.embedBaseUrl);
    if (normalizedEmbedBaseUrl !== WINHOUSE_DEFAULT_EMBED_BASE_URL) {
      throw new BadRequestException(
        `embedBaseUrl must be the official exact origin ${WINHOUSE_DEFAULT_EMBED_BASE_URL}.`,
      );
    }

    const environment = (input.environment ?? '').trim().toLowerCase();
    if (environment !== 'sandbox' && environment !== 'production') {
      throw new BadRequestException(
        'environment must be "sandbox" or "production" for an embedded sportsbook (sandbox and production are never mixed).',
      );
    }

    const normalizedDomain = normalizeProviderDomain(input.domain);
    if (!normalizedDomain) {
      throw new BadRequestException(
        'domain is required for an embedded sportsbook and must be one exact https origin (no path or wildcard).',
      );
    }
    if (
      environment === 'production' &&
      normalizedDomain !== WINHOUSE_TANVION_PRODUCTION_ORIGIN
    ) {
      throw new BadRequestException(
        `Production domain must be exactly ${WINHOUSE_TANVION_PRODUCTION_ORIGIN}.`,
      );
    }

    const normalizedWalletBaseUrl = normalizeWinHouseWalletBaseUrl(input.walletBaseUrl);
    if (!normalizedWalletBaseUrl) {
      throw new BadRequestException(
        'walletBaseUrl must be an https URL ending in /api/v1/winhouse; WinHouse appends /user-data and /balance-change.',
      );
    }
    if (
      environment === 'production' &&
      normalizedWalletBaseUrl !== WINHOUSE_TANVION_WALLET_BASE_URL
    ) {
      throw new BadRequestException(
        `Production walletBaseUrl must be exactly ${WINHOUSE_TANVION_WALLET_BASE_URL}.`,
      );
    }

    if (input.serverIp && !normalizeProviderServerIp(input.serverIp)) {
      throw new BadRequestException(
        'serverIp must be one exact public IP address; CIDR ranges, private/local addresses, and documentation examples are not accepted.',
      );
    }

    if (input.requireSecrets) {
      if (!input.walletApiKey) {
        throw new BadRequestException(
          'walletApiKey is required for an embedded sportsbook (it is the HMAC signing key, not the embed key).',
        );
      }
      if (!input.callbackToken) {
        throw new BadRequestException(
          'callbackToken is required for an embedded sportsbook (it authenticates the provider callbacks).',
        );
      }
    }
  }

  /** An https origin (path allowed) or null — never a non-TLS/invalid value. */
  private normalizeOrigin(raw: string | null | undefined): string | null {
    const candidate = (raw ?? '').trim();
    if (!candidate) return null;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'https:') return null;
      if (parsed.username || parsed.password) return null;
      const pathname = parsed.pathname.replace(/\/+$/, '');
      return `${parsed.origin}${pathname}`;
    } catch {
      return null;
    }
  }

  /**
   * Audit-safe provider snapshot. Encrypted credential columns are deliberately
   * excluded: ciphertext is still secret material and must not be copied into
   * the admin audit stream. The response is built from the same public
   * allowlist used by the Admin API.
   */
  private toAuditRecord(row: PartnerProviderRow): Record<string, unknown> {
    return this.toView(row) as unknown as Record<string, unknown>;
  }

  private async audit(
    actorId: string,
    action: string,
    entityId: string,
    oldValue: Record<string, unknown> | null,
    newValue: Record<string, unknown> | null,
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId,
          actorType: 'ADMIN',
          action,
          entityType: 'PartnerProvider',
          entityId,
          oldValue: oldValue === null ? Prisma.JsonNull : (oldValue as Prisma.InputJsonValue),
          newValue: newValue === null ? Prisma.JsonNull : (newValue as Prisma.InputJsonValue),
          ip,
          userAgent,
        },
      });
    } catch {
      // Best-effort audit -- never break the CRUD operation.
    }
  }
}

interface PartnerProviderRow {
  id: string;
  name: string;
  providerCode: string | null;
  baseUrl: string;
  deepLinkTemplate: string;
  status: string;
  integrationType: string | null;
  environment: string | null;
  embedKey: string | null;
  embedBaseUrl: string | null;
  walletApiKeyEnc: string | null;
  callbackTokenEnc: string | null;
  config: unknown;
  apiKeyEnc: string | null;
  apiSecretEnc: string | null;
  authMode: string | null;
  apiVersion: string | null;
  syncStatus: string | null;
  lastSyncAt: Date | null;
  lastSyncError: string | null;
  createdAt: Date;
}