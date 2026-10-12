import { Module } from '@nestjs/common';
import { JurisdictionService } from './jurisdiction.service';
import { AdminJurisdictionsController } from './admin-jurisdictions.controller';

/**
 * PART A — central jurisdiction & currency control.
 *
 * Owns `JurisdictionRule`, the append-only `JurisdictionAuditLog` and the
 * `GlobalGameSwitch` kill switches. The service is EXPORTED so the Royale
 * eligibility gate (RoyaleEligibilityService) can run the jurisdiction +
 * currency check for EVERY REAL_MONEY action in Plinko, Mines and Ace, and so
 * the self-operator capability check can verify "at least one ALLOWED rule"
 * plus the REAL_MONEY_ALL switch.
 *
 * PrismaModule is @Global(), so PrismaService resolves without an import.
 */
@Module({
  controllers: [AdminJurisdictionsController],
  providers: [JurisdictionService],
  exports: [JurisdictionService],
})
export class JurisdictionModule {}
