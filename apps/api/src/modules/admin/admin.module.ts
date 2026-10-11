import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminUsersController, AdminStaffController } from './admin-users.controller';
import { AdminUserModerationController } from './admin-user-moderation.controller';
import { AdminCatalogController } from './admin-catalog.controller';
import { AdminBetsController } from './admin-bets.controller';
import { AdminWalletsController } from './admin-wallets.controller';
import { AdminSmsProviderController } from './admin-sms-provider.controller';
import { AdminService } from './admin.service';
import { AuthModule } from '../auth/auth.module';
import { SportsbookModule } from '../sportsbook/sportsbook.module';

/**
 * Admin panel module (Phase 2).
 *
 * Read-model endpoints for the /admin frontend plus the single audited event
 * status mutation. Everything reuses the existing global auth chain
 * (ThrottlerGuard → JwtAuthGuard → RolesGuard) and the existing services:
 *   - sport/game CRUD + availability + provider mapping → sports module
 *   - partner provider CRUD/sync + encrypted credentials → sportsbook module
 *   - SMS provider selection → SmsProviderSettingsService (auth module), the
 *     SAME service the OTP flow consults, so the panel and the delivery path
 *     can never disagree about which provider is live
 *   - bet settlement (idempotent) → betting module admin controller
 *   - wallet adjustment (ledger-backed) → wallet module admin controller
 */
@Module({
  // AuthModule is imported (not a cycle) for SmsProviderSettingsService only:
  // AuthModule depends on the global Prisma/RBAC providers, never on AdminModule.
  imports: [SportsbookModule, AuthModule],
  controllers: [
    AdminController,
    AdminUsersController,
    AdminStaffController,
    AdminUserModerationController,
    AdminCatalogController,
    AdminBetsController,
    AdminWalletsController,
    AdminSmsProviderController,
  ],
  providers: [AdminService],
})
export class AdminModule {}
