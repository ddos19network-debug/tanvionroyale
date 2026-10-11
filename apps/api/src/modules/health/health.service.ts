import { Injectable, Logger } from '@nestjs/common';
import type { HealthStatus } from '@tanvion-royale/types';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOverallStatus(): Promise<HealthStatus> {
    const dbUp = await this.prisma.isHealthy();
    const schemaUpToDate = await this.prisma.isSchemaUpToDate();
    const logger = this.logger;

    const checks: HealthStatus['checks'] = {
      db: dbUp ? 'up' : 'down',
      // Schema drift sentinel: the generated Prisma client must match the
      // live database. A pending migration (e.g. the Session
      // previousRefreshTokenHash column from 2026-09-13) must sink /health
      // instead of reporting db: up while /auth/* throws P2022 -> 500.
      schema: schemaUpToDate ? 'up' : 'down',
      redis: this.redisState(),
      provider: this.providerState(),
    };

    if (!schemaUpToDate && dbUp) {
      logger.warn(
        'DATABASE SCHEMA DRIFT DETECTED — the database is missing columns/tables the API expects. ' +
          'Run `prisma migrate deploy` against the deployment database (Render runs it in buildCommand).',
      );
    }

    const down = Object.values(checks).filter((v) => v === 'down').length;
    const up = Object.values(checks).filter((v) => v === 'up').length;

    return {
      status: down === 0 ? (up > 0 ? 'ok' : 'degraded') : 'degraded',
      service: 'tanvion-royale-api',
      checks,
      timestamp: new Date().toISOString(),
    };
  }

  private redisState(): 'up' | 'down' | 'unknown' {
    // Redis wiring arrives with queue jobs (Phase 1+/5). Until then unknown.
    return 'unknown';
  }

  private providerState(): 'up' | 'down' | 'unknown' {
    // Live operator connectivity checks arrive with the integration module.
    return 'unknown';
  }
}