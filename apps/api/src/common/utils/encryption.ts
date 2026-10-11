import {
  createHash,
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "crypto";
import { isProduction } from "@tanvion-royale/config";

/**
 * Field-level encryption for sensitive provider credentials stored at rest.
 *
 * Uses AES-256-GCM. The key is derived from ENCRYPTION_KEY (never a
 * literal in source) via SHA-256, so operators can rotate the env value
 * without changing the code. Encrypted values are stored with a version prefix
 * (`v1:`) so future algorithms can be introduced without breaking old rows.
 *
 * NEVER log or return the plaintext. The API only ever exposes masked flags.
 */
const ALGO = "aes-256-gcm";
const PREFIX = "v1:";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function deriveKey(): Buffer {
  const secret =
    process.env.ENCRYPTION_KEY ?? "dev-only-encryption-key-change-me";
  // Defense in depth (see config/production-secrets.ts): production must never
  // encrypt provider credentials or crash server seeds with the source-known
  // development key. main.ts refuses to start without a real ENCRYPTION_KEY;
  // this guard keeps the guarantee local to every call site.
  if (
    isProduction() &&
    (!process.env.ENCRYPTION_KEY ||
      secret === "dev-only-encryption-key-change-me")
  ) {
    throw new Error(
      "ENCRYPTION_KEY is not configured — refusing to encrypt secrets in production",
    );
  }
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGO, deriveKey(), iv, {
    authTagLength: TAG_LENGTH,
  });
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) {
    // Old/foreign format — do not guess; treat as empty so nothing breaks.

    return "";
  }
  const body = stored.slice(PREFIX.length);
  const [ivB64, tagB64, dataB64] = body.split(".");
  if (!ivB64 || !tagB64 || !dataB64) return "";
  try {
    const decipher = createDecipheriv(
      ALGO,
      deriveKey(),
      Buffer.from(ivB64, "base64"),
      { authTagLength: TAG_LENGTH },
    );
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(dataB64, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return "";
  }
}

export function maskSecret(stored: string | null): string | null {
  return stored && stored.length > 0 ? "••••••••" : null;
}

export function hasSecret(stored: string | null | undefined): boolean {
  return Boolean(stored && stored.length > 0);
}
