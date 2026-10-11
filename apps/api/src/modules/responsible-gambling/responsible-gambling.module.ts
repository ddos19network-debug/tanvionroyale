import { Module } from '@nestjs/common';
import { ResponsibleGamblingService } from './responsible-gambling.service';
import { ResponsibleGamblingController } from './responsible-gambling.controller';
import { AdminResponsibleGamblingController } from './admin-responsible-gambling.controller';

/**
 * Responsible Gambling module (Task 2 / audit F3).
 *
 * Owns the self-exclusion + play-limit PROTECTION records and exposes both the
 * player endpoints (GET/PUT limits, POST self-exclude) and the admin read /
 * override endpoints. The service is EXPORTED so the Royale eligibility gate
 * (RoyaleEligibilityService) can assert every REAL_MONEY stake against it.
 *
 * PrismaModule is @Global(), so PrismaService resolves without an import.
 */
@Module({
  controllers: [ResponsibleGamblingController, AdminResponsibleGamblingController],
  providers: [ResponsibleGamblingService],
  exports: [ResponsibleGamblingService],
})
export class ResponsibleGamblingModule {}
