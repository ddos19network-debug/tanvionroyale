import { Module } from '@nestjs/common';
import { VerificationController } from './verification.controller';
import { VerificationService } from './verification.service';
import { AuthModule } from '../auth/auth.module';

/**
 * Phase 11 — Verification Center module (phone / email / face verification
 * plus linked login methods). Depends on AuthModule for the OTP service.
 */
@Module({
  imports: [AuthModule],
  controllers: [VerificationController],
  providers: [VerificationService],
  exports: [VerificationService],
})
export class VerificationModule {}
