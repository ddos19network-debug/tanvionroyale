import { Module, type Provider } from '@nestjs/common';
import { createBettingProvider } from '../betting/betting-provider.factory';
import { SPORTS_PROVIDER } from './sports-provider.token';
import { PartnerProvidersController } from './partner-providers.controller';
import { PartnerProvidersService } from './partner-providers.service';
import { SportsSyncService } from './sports-sync.service';

/**
 * Phase 16 — sportsbook partner administration.
 *
 * Provides the admin PartnerProvider CRUD (secrets encrypted at rest, masked
 * in API responses) and the sports sync service. The sync uses the same
 * operator-provider factory as betting:in production no real provider means
 * sync fails safely (never fake sports; provider rows go ERROR with lastSyncError).
 */
const sportsProvider: Provider = {
  provide: SPORTS_PROVIDER,
  useFactory: () => createBettingProvider(),
};

@Module({
  controllers: [PartnerProvidersController],
  providers: [PartnerProvidersService, SportsSyncService, sportsProvider],
  exports: [PartnerProvidersService],
})
export class SportsbookModule {}