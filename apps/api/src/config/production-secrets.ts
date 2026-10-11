import { isProduction } from "@tanvion-royale/config";

/**
 * Production startup secret validation (Phase — live deployment hardening).
 *
 * The application must REFUSE to start in production when a required secret is
 * missing, a known development placeholder, or absurdly short. We NEVER add
 * insecure defaults: the dev-only fallbacks that exist for local development
 * (see app.module.ts / auth.module.ts / common/utils/encryption.ts) must never
 * be reachable with NODE_ENV=production.
 *
 * Checked secrets:
 *   DATABASE_URL    — PostgreSQL connection string (Prisma datasource).
 *   JWT_SECRET      — signs every access token; a source-known value would let
 *                     anyone mint valid sessions.
 *   ENCRYPTION_KEY  — AES-256-GCM key for provider credentials at rest and the
 *                     provably-fair crash server-seed commitment.
 *
 * Failing here is a HARD startup error (process exits) — never a degraded
 * health state, never a fallback.
 */

/** Known non-production placeholder values that must never reach production. */
const FORBIDDEN_PLACEHOLDER_VALUES = new Set([
  "dev-only-insecure-secret-change-me", // JWT dev fallback (app.module / auth.module)
  "dev-only-encryption-key-change-me", // ENCRYPTION_KEY dev fallback (encryption.ts)
  "change-me-32-byte-encryption-key", // .env.example placeholder
  "change-me-to-a-64-char-random-string-in-production", // .env.example placeholder
]);

/** Minimum accepted entropy floor — Render docs advise 64-char random secrets. */
const MIN_SECRET_LENGTH = 32;

export interface ProductionSecretCheck {
  name: string;
  ok: boolean;
  reason?: string;
}

function checkSecret(
  name: string,
  value: string | undefined,
): ProductionSecretCheck {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return { name, ok: false, reason: `${name} is not configured` };
  }
  if (FORBIDDEN_PLACEHOLDER_VALUES.has(trimmed)) {
    return {
      name,
      ok: false,
      reason: `${name} is still a development placeholder`,
    };
  }
  if (trimmed.length < MIN_SECRET_LENGTH) {
    return {
      name,
      ok: false,
      reason: `${name} is shorter than the required ${MIN_SECRET_LENGTH} characters`,
    };
  }
  return { name, ok: true };
}

/**
 * Validates every secret the production API requires. Returns the list of
 * failed checks (empty array = safe to start).
 */
export function findUnsafeProductionSecrets(
  env: NodeJS.ProcessEnv = process.env,
): ProductionSecretCheck[] {
  return [
    checkSecret("DATABASE_URL", env.DATABASE_URL),
    checkSecret("JWT_SECRET", env.JWT_SECRET),
    checkSecret("ENCRYPTION_KEY", env.ENCRYPTION_KEY),
  ].filter((check) => !check.ok);
}

/**
 * Refuses production startup when required secrets are unsafe. In every other
 * environment this is a no-op so local development keeps working unchanged.
 * Throws an actionable error listing exactly which variables to configure.
 */
export function validateProductionSecrets(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!isProduction(env)) return;

  const failures = findUnsafeProductionSecrets(env);
  if (failures.length > 0) {
    const details = failures.map((f) => ` - ${f.name}: ${f.reason}`).join("\n");
    throw new Error(
      `Refusing to start in production with unsafe or missing secrets. Configure these in the deployment dashboard (never in source):\n${details}`,
    );
  }
}
