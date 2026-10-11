import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '../generated/prisma';

/**
 * Central database access service. Business modules must NOT talk to Prisma
 * directly from controllers — access flows through domain services that use
 * this provider.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Database connection established');
    } catch (error) {
      this.logger.error(
        'Database connection failed. If running locally, ensure PostgreSQL is up (docker compose up -d).',
        error instanceof Error ? error.message : String(error),
      );
      // Do not crash the process in development so health checks can report degraded state.
      if (process.env.NODE_ENV === 'production') {
        throw error;
      }
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /** Used by the health module to probe connectivity. */
  async isHealthy(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Schema-drift sentinel.
   *
   * Reads ZERO rows (`LIMIT 0`) — it only verifies the tables/columns the
   * generated client SELECTs actually exist in the database. A pending Prisma
   * migration surfaces here as P2021/P2022 instead of hiding behind a
   * `SELECT 1` health check while the affected endpoints 500:
   *   - 20260913000000_add_session_previous_refresh_token_hash -> /auth/refresh,
   *     /auth/oauth/exchange (Session.previousRefreshTokenHash)
   *   - 20260914010000_add_support_chat -> /support/chat, /admin/support
   *     (SupportTicket + SupportMessage)
   *   - 20260915000001_add_support_problem_reports -> /support/report,
   *     /support/reports (SupportTicket.source / contact* ,
   *     SupportMessage.attachmentDataUrl)
   *
   * NOTE: keep this list in sync whenever a user-facing model is added or gains
   * a column — drift of ANY queried table/column must be loud in /health.
   */
  async isSchemaUpToDate(): Promise<boolean> {
    try {
      await this.$queryRaw`
        SELECT "id", "refreshTokenHash", "previousRefreshTokenHash"
        FROM "Session"
        LIMIT 0
      `;
      await this.$queryRaw`
        SELECT "id", "userId", "status", "assignedAdminId", "adminUnreadCount",
               "userUnreadCount", "lastMessageAt", "source", "contactName",
               "contactEmail", "contactPhone"
        FROM "SupportTicket"
        LIMIT 0
      `;
      await this.$queryRaw`
        SELECT "id", "ticketId", "authorUserId", "authorRole", "body", "clientRef",
               "attachmentDataUrl"
        FROM "SupportMessage"
        LIMIT 0
      `;
      return true;
    } catch {
      return false;
    }
  }
}