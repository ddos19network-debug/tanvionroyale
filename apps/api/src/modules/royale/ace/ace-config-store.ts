/**
 * TANVION ROYALE — Royale Ace versioned configuration STORE.
 *
 * The live configuration is ALWAYS the ACTIVE row in `RoyaleAceConfigVersion`.
 * This store is the single loader used by the game service and the admin
 * surface. It caches the ACTIVE config in memory (invalidated on every
 * activation) and FAILS CLOSED: if the stored JSON is missing or invalid, the
 * built-in `DEFAULT_ACE_CONFIG` is used so the game never runs on a corrupt or
 * half-written config. On first use it seeds version 1 from the default.
 *
 * Nothing here trusts a client request; the admin writes come through
 * `RoyaleAceAdminService`, which validates with `validateAceConfig` and only
 * persists a fully valid clone.
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import {
  cloneAceConfig,
  DEFAULT_ACE_CONFIG,
  validateAceConfig,
  type AceConfigIssue,
  type AceGameConfig,
} from './ace-config';

@Injectable()
export class AceConfigStore {
  private readonly logger = new Logger(AceConfigStore.name);
  private cache: AceGameConfig | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The ACTIVE configuration. Falls back to (and seeds) the built-in default
   * when no version has been activated yet. Re-validates on every load so a
   * hand-edited row can never feed the game math an inconsistent object.
   */
  async getActive(): Promise<AceGameConfig> {
    if (this.cache) return this.cache;
    const row = await this.prisma.royaleAceConfigVersion.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });
    if (!row) return this.cache = await this.seedDefault();
    try {
      const parsed = row.configJson as unknown as AceGameConfig;
      const issues = validateAceConfig(parsed);
      if (issues.length > 0) {
        this.logger.error(
          `ACTIVE Royale Ace config v${row.version} failed validation (${issues
            .map((i) => i.path)
            .join(', ')}); falling back to built-in default`,
        );
        return DEFAULT_ACE_CONFIG;
      }
      return (this.cache = parsed);
    } catch (error) {
      this.logger.error(
        `Could not parse ACTIVE Royale Ace config v${row.version}: ${
          error instanceof Error ? error.message : String(error)
        }; falling back to built-in default`,
      );
      return DEFAULT_ACE_CONFIG;
    }
  }

  /** A specific config version (for replay / verification of historical rounds). */
  async getVersion(version: number): Promise<AceGameConfig | null> {
    const row = await this.prisma.royaleAceConfigVersion.findUnique({
      where: { version },
    });
    if (!row) return null;
    try {
      const parsed = row.configJson as unknown as AceGameConfig;
      return validateAceConfig(parsed).length === 0 ? parsed : null;
    } catch {
      return null;
    }
  }

  /** Drop the in-memory cache (called after every activation). */
  invalidate(): void {
    this.cache = null;
  }

  /** Seed version 1 from the built-in default. Idempotent. */
  private async seedDefault(): Promise<AceGameConfig> {
    const config = cloneAceConfig(DEFAULT_ACE_CONFIG);
    const issues: AceConfigIssue[] = validateAceConfig(config);
    try {
      await this.prisma.royaleAceConfigVersion.upsert({
        where: { version: config.version },
        update: {},
        create: {
          version: config.version,
          status: 'ACTIVE',
          name: config.configName,
          configJson: config as never,
          validationErrors: [],
          changeReason: 'Initial seed of the built-in launch configuration.',
          createdById: await this.systemActorId(),
          activatedAt: new Date(),
        },
      });
    } catch (error) {
      // A concurrent seed won the race — fine; just load whatever is active.
      this.logger.warn(
        `Royale Ace default config seed raced: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    this.cache = config;
    return config;
  }

  /**
   * The config-version rows require a real user FK for createdById. On first
   * boot there may be no admin yet, so reuse the oldest existing user (any
   * row satisfies the FK); this is a bookkeeping anchor, not an authorization.
   */
  private async systemActorId(): Promise<string> {
    const any = await this.prisma.user.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!any) {
      throw new Error('Cannot seed Royale Ace config: no user exists to own the row');
    }
    return any.id;
  }
}
