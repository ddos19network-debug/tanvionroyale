import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { isProduction } from "@tanvion-royale/config";
import { AuthService } from "./auth.service";
import { AuthController } from "./auth.controller";
import { OtpService } from "./otp.service";
import { OAuthService } from "./oauth.service";
import { SmsProviderSettingsService } from "./sms-provider-settings.service";

/**
 * Phase 2 authentication module, extended in Phase 11 with:
 * - Phone + password + OTP authentication (OtpService).
 * - Google / Facebook server-side OAuth (OAuthService).
 * - Access tokens: short-lived JWTs (stateless).
 * - Refresh tokens: opaque, sha256-hashed at rest, bound to a Session row and
 *   rotated on every use.
 * - Passwords: argon2id.
 */
/**
 * The dev-only JWT fallback exists for local development ONLY; production
 * throws instead of ever using a source-known secret (same policy as
 * app.module.ts — see resolveJwtSecret there).
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
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: resolveJwtSecret(),
        signOptions: { issuer: "tanvion-royale-api" },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, OtpService, OAuthService, SmsProviderSettingsService],
  // SmsProviderSettingsService is exported so the Admin Panel controller can
  // read and change the SMS provider selection through the SAME service the
  // OTP flow consults, instead of duplicating the selection rules.
  exports: [AuthService, JwtModule, OtpService, OAuthService, SmsProviderSettingsService],
})
export class AuthModule {}
