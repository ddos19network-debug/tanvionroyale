import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma';

/**
 * Secondary database access.
 *
 * A REAL, independent database connection — its own PrismaClient with its own
 * connection pool — pointed at DATABASE_SECONDARY_URL. It is NOT an alias of
 * the primary {@link PrismaService}: the two clients never share a pool, so a
 * slow or down secondary database can never affect the primary one.
 *
 * Why a runtime datasource override instead of a second `datasource` block:
 * Prisma 5 does not support multiple datasource blocks in one schema (it
 * rejects them with P1012). The supported pattern for "the same schema against
 * a second physical database" is a separate PrismaClient that overrides the
 * `db` datasource URL at construction — which is exactly what this does. It
 * therefore reuses the SAME generated models, so the secondary database MUST
 * carry the same schema as the primary (run the same migrations against it).
 *
 * Lifecycle is fail-safe: when DATABASE_SECONDARY_URL is unset/blank the client
 * stays disabled — it never connects and `isHealthy()` returns false — and the
 * primary datasource is completely unaffected. This mirrors PrismaService's
 * "log, don't crash in dev; hard-fail in production" behaviour for symmetry.
 */
@Injectable()
export class SecondaryPrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SecondaryPrismaService.name);

  /** True when a secondary URL is configured and the client should be used. */
  readonly enabled: boolean;

  constructor() {
    const url = (process.env.DATABASE_SECONDARY_URL ?? '').trim();
    // Disabled when no URL is configured — PrismaClient is still constructed
    // (required by `extends`), but it never opens a connection because
    // onModuleInit() short-circuits.
    super({ datasources: { db: { url } } });
    this.enabled = url.length > 0;
  }

  async onModuleInit(): Promise<void> {
    if (!this.enabled) {
      this.logger.warn(
        'DATABASE_SECONDARY_URL is not set — secondary database is disabled (isHealthy() => false).',
      );
      return;
    }
    try {
      await this.$connect();
      this.logger.log('Secondary database connection established');
    } catch (error) {
      this.logger.error(
        'Secondary database connection failed. Ensure DATABASE_SECONDARY_URL is reachable and migrated.',
        error instanceof Error ? error.message : String(error),
      );
      if (process.env.NODE_ENV === 'production') {
        throw error;
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.enabled) return;
    await this.$disconnect();
  }

  /** Used by the health module to probe secondary connectivity. */
  async isHealthy(): Promise<boolean> {
    if (!this.enabled) return false;
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }
}
