/**
 * BigBang portal configuration (admin only).
 *
 * WHAT THIS EXPOSES
 *   - the three URLs to register in the BigBang Dashboard, built from the
 *     canonical API origin (never a hard-coded production domain);
 *   - whether a webhook secret is configured, as a BOOLEAN only;
 *   - generate / rotate, which returns the secret EXACTLY ONCE.
 *
 * SECRET HANDLING — the rules this file exists to enforce
 *   1. The stored value is AES-256-GCM encrypted (`encryptSecret`), never plain.
 *   2. NO read endpoint ever returns the stored secret. The only way to see it
 *      is the response of a generate/rotate call, and the admin UI is required
 *      to show it once and never persist it.
 *   3. The secret is never logged, never audited and never included in an
 *      error message.
 *   4. It is a DISTINCT credential from `apiKeyEnc` (seamless callbacks) and
 *      `walletApiKeyEnc`; the webhook route never falls back to either.
 */
import { Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../database/prisma.service';
import { encryptSecret } from '../../common/utils/encryption';
import { BIGBANG_PROVIDER_CODE } from './bigbang.config';

export interface BigBangWebhookConfigView {
  providerId: string;
  providerName: string;
  /** Canonical callback + webhook URLs, derived from the configured API origin. */
  urls: {
    userData: string;
    balanceChange: string;
    webhook: string;
  };
  /** True once a webhook secret has been generated. Never the secret itself. */
  webhookSecretConfigured: boolean;
  /** The webhook secret. Returned ONLY by generate/rotate. */
  webhookSecret?: string;
}

@Injectable()
export class BigBangWebhookConfigService {
  private readonly logger = new Logger(BigBangWebhookConfigService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The canonical public API origin.
   *
   * Resolution order (first valid http(s) URL wins), and nothing is ever
   * hard-coded: API_PUBLIC_URL -> API_ORIGIN -> APP_URL -> RENDER_EXTERNAL_URL.
   */
  private apiOrigin(): string | null {
    const candidates = [
      process.env.API_PUBLIC_URL,
      process.env.API_ORIGIN,
      process.env.APP_URL,
      process.env.RENDER_EXTERNAL_URL,
    ];
    for (const candidate of candidates) {
      const value = (candidate ?? '').trim();
      if (!value) continue;
      try {
        const parsed = new URL(value);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          return parsed.origin;
        }
      } catch {
        // Ignore an unparseable value and try the next candidate.
      }
    }
    return null;
  }

  /** The three URLs an operator registers, from one canonical origin. */
  private urls(): { userData: string; balanceChange: string; webhook: string } | null {
    const origin = this.apiOrigin();
    if (!origin) return null;
    return {
      userData: `${origin}/api/v1/bigbang/callbacks/user-data`,
      balanceChange: `${origin}/api/v1/bigbang/callbacks/balance-change`,
      webhook: `${origin}/api/v1/bigbang/webhooks`,
    };
  }

  /** Finds the environment-matched ACTIVE BigBang provider row. */
  private async findProvider(providerId?: string) {
    if (providerId) {
      return this.prisma.partnerProvider.findFirst({
        where: { id: providerId, providerCode: BIGBANG_PROVIDER_CODE },
        select: { id: true, name: true, webhookSecretEnc: true },
      });
    }
    const rows = await this.prisma.partnerProvider.findMany({
      where: { providerCode: BIGBANG_PROVIDER_CODE, integrationType: 'CASINO_AGGREGATOR' },
      select: { id: true, name: true, webhookSecretEnc: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows[0] ?? null;
  }

  /** Config + URLs + a boolean secret flag. Never the secret. */
  async getConfig(providerId?: string): Promise<BigBangWebhookConfigView | null> {
    const row = await this.findProvider(providerId);
    if (!row) return null;
    const urls = this.urls();
    if (!urls) {
      // Fail loudly rather than showing an operator a wrong URL: without a
      // configured API origin there is no honest webhook URL to register.
      throw new Error(
        'API_PUBLIC_URL (or API_ORIGIN / APP_URL) must be configured to show BigBang portal URLs',
      );
    }
    return {
      providerId: row.id,
      providerName: row.name,
      urls,
      webhookSecretConfigured: Boolean(row.webhookSecretEnc),
    };
  }

  /**
   * Generates (first call) or rotates (subsequent calls) the webhook secret.
   *
   * The plaintext is returned in THIS response only. It is never persisted in
   * clear text, never logged and never retrievable afterwards.
   */
  async generateSecret(
    actorId: string,
    providerId?: string,
  ): Promise<BigBangWebhookConfigView & { webhookSecret: string }> {
    const row = await this.findProvider(providerId);
    if (!row) {
      throw new Error('No BigBang provider is configured');
    }
    // 32 random bytes -> 64 hex characters. CSPRNG only, never Math.random.
    const secret = randomBytes(32).toString('hex');
    const encrypted = encryptSecret(secret);

    await this.prisma.partnerProvider.update({
      where: { id: row.id },
      data: { webhookSecretEnc: encrypted },
    });

    // The audit entry records THAT a secret was rotated — never its value.
    await this.prisma.auditLog.create({
      data: {
        actorId,
        actorType: 'ADMIN',
        action: row.webhookSecretEnc
          ? 'BIGBANG_WEBHOOK_SECRET_ROTATED'
          : 'BIGBANG_WEBHOOK_SECRET_GENERATED',
        entityType: 'PartnerProvider',
        entityId: row.id,
        newValue: {
          providerCode: BIGBANG_PROVIDER_CODE,
          rotated: Boolean(row.webhookSecretEnc),
        } as never,
      },
    });

    this.logger.log(
      `bigbang.webhook_secret ${row.webhookSecretEnc ? 'rotated' : 'generated'} providerId=${row.id}`,
    );

    const config = await this.getConfig(row.id);
    return { ...config!, webhookSecret: secret };
  }
}

