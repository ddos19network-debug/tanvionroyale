import { Module, MiddlewareConsumer, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModule } from "@nestjs/throttler";
import { AllExceptionsFilter } from "./common/filters/all-exceptions.filter";
import { RequestIdMiddleware } from "./common/middleware/request-id.middleware";
import { TrustedGeoMiddleware } from "./common/middleware/trusted-geo.middleware";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { RolesGuard } from "./common/guards/roles.guard";
import { TransformInterceptor } from "./common/interceptors/transform.interceptor";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { PrismaModule } from "./database/prisma.module";
import { VerificationModule } from "./modules/verification/verification.module";
import { AuthModule } from "./modules/auth/auth.module";
import { SupportModule } from "./modules/support/support.module";
import { HealthModule } from "./modules/health/health.module";
import { UsersModule } from "./modules/users/users.module";
import { SportsModule } from "./modules/sports/sports.module";
import { SportsbookModule } from "./modules/sportsbook/sportsbook.module";
import { WalletModule } from "./modules/wallet/wallet.module";
import { BettingModule } from "./modules/betting/betting.module";
import { GamesModule } from "./modules/games/games.module";
import { CrashModule } from "./modules/crash/crash.module";
import { RoyaleModule } from "./modules/royale/royale.module";
import { AdminModule } from "./modules/admin/admin.module";
import { TradingModule } from "./modules/trading/trading.module";
import { PartnerModule } from "./modules/partner/partner.module";
import { CasinoModule } from "./modules/casino/casino.module";
import { WinHouseModule } from "./modules/winhouse/winhouse.module";
import { NotificationsModule } from "./modules/notifications/notifications.module";
import { ReferralModule } from "./modules/referral/referral.module";
import { ResponsibleGamblingModule } from "./modules/responsible-gambling/responsible-gambling.module";
import { JurisdictionModule } from "./modules/jurisdiction/jurisdiction.module";
import { isProduction } from "@tanvion-royale/config";

/**
 * The dev-only JWT fallback exists for local development ONLY. Production
 * resolves the real secret or throws (main.ts also hard-gates at bootstrap —
 * this is defense in depth so no code path can silently mint tokens with a
 * source-known secret in production).
 */
function resolveJwtSecret(): string {
  const configured = (process.env.JWT_SECRET ?? "").trim();
  if (configured) return configured;
  if (isProduction()) {
    throw new Error(
      "JWT_SECRET is not configured — refusing to sign tokens in production",
    );
  }
  return "dev-only-insecure-secret-change-me";
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env", "../../.env", "../../.env.local"],
    }),
    // Global rate limiting; auth endpoints carry stricter per-route limits.
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 100 }]),
    // Global JWT so the global JwtAuthGuard can resolve JwtService anywhere.
    // An empty/whitespace JWT_SECRET is treated as unset (never an empty
    // secret — an empty secret would break verification and is insecure).
    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({
        secret: resolveJwtSecret(),
        signOptions: { issuer: "tanvion-royale-api" },
      }),
    }),
    PrismaModule,
    AuthModule,
    HealthModule,
    UsersModule,
    SportsModule,
    SportsbookModule,
    WalletModule,
    BettingModule,
    GamesModule,
    CrashModule,
    // Royale Play: original server-authoritative Plinko + Mines (reuses the
    // ONE wallet ledger and the ONE free-play points ledger).
    RoyaleModule,
    AdminModule,
    TradingModule,
    PartnerModule,
    // Partner casino (BIG CASINO / BIG LIVE CASINO): catalog sync, server-side
    // launch and the signature-verified wallet callbacks. Its catalog is cached
    // in the DB so a provider outage degrades instead of breaking the platform.
    CasinoModule,
    // Embedded sportsbook (BIG SPORT → WinHouse, SPORTS_IFRAME): launches a
    // SHORT-LIVED signed token server-side and applies the provider's
    // seamless-wallet callbacks to the ONE TANVION wallet. The provider hosts
    // the book; TANVION owns identity and money.
    WinHouseModule,
    VerificationModule,
    NotificationsModule,
    // User referral program. Exported so the auth flow can attribute a new
    // registration to the code that was submitted with it.
    ReferralModule,
    // Responsible gambling (self-exclusion + play limits). Imported here so the
    // player/admin RG routes are registered, and by RoyaleModule so the
    // REAL_MONEY eligibility gate can assert every stake against it.
    ResponsibleGamblingModule,
    // Central jurisdiction & currency control (PART A). Imported here so the
    // admin surface /admin/jurisdictions is registered, and by RoyaleModule so
    // the REAL_MONEY eligibility gate can enforce the per-country rules.
    JurisdictionModule,
    SupportModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // JWT auth runs before RolesGuard so request.user is populated for role checks.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule implements NestModule {
  /**
   * Every request gets a stable correlation ID before anything else runs so
   * the global AllExceptionsFilter (and all logs) can trace the exact request.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, TrustedGeoMiddleware).forRoutes('*');
  }
}
