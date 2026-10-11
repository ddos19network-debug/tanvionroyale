import { Module, type Provider } from '@nestjs/common';
import { PartnerController } from './partner.controller';
import { createBettingProvider } from '../betting/betting-provider.factory';
import { PARTNER_PROVIDER } from './partner.token';
import { PrismaModule } from '../../database/prisma.module';

/**
 * Partner Sports module (Football / Cricket).
 *
 * Reuses the SAME provider factory and contract as the betting domain
 * (OperatorProviderInterface) — there is deliberately ONE partner adapter
 * architecture. The factory fails safely: production without a real partner
 * yields the UnconfiguredOperatorAdapter, and the webhook/status endpoints
 * report "Provider temporarily unavailable" instead of fabricating data.
 */
const partnerProvider: Provider = {
  provide: PARTNER_PROVIDER,
  useFactory: () => createBettingProvider(),
};

@Module({
  imports: [PrismaModule],
  controllers: [PartnerController],
  providers: [partnerProvider],
  exports: [partnerProvider],
})
export class PartnerModule {}