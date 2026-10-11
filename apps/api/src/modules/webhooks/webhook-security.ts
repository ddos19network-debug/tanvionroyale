/**
 * SHARED provider-webhook verification primitives.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A provider webhook is authenticated by an HMAC over the EXACT bytes the
 * provider sent, using a DEDICATED webhook secret that is different from the
 * wallet API key. That logic is identical for every provider that follows this
 * contract, so it lives here ONCE. `BigBangWebhookService` and any future
 * `SoftApiWebhookService` / `ProviderXWebhookService` call into this module
 * instead of re-implementing (and re-mis-implementing) signature handling.
 *
 * THE THREE INVARIANTS THIS ENFORCES
 * -----------------------------------
 * 1. THE RAW BODY IS THE SIGNED MESSAGE. The caller passes the exact
 *    `Buffer`/`string` captured by `captureRawBody` (see
 *    common/middleware/raw-body.middleware.ts). Nothing here parses, reorders
 *    or re-serialises JSON before hashing — key order, whitespace and number
 *    formatting are all part of what the provider signed, and re-stringifying
 *    would break the signature.
 * 2. COMPARISON IS TIMING-SAFE. `timingSafeEqual` over equal-length buffers.
 *    A plain `a === b` is never used, and a length mismatch is answered
 *    before the comparison (the length of a hex digest is public).
 * 3. SECRETS NEVER LEAVE THIS MODULE. `verifyWebhookSignature` returns a
 *    verdict object; it never returns, throws or logs the expected signature.
 *
 * This module is deliberately independent of the wallet: nothing here can
 * move money, and no wallet service is imported.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Header names accepted for the signature.
 *
 * A provider integration differs in the exact header spelling it uses, so the
 * resolution is done ONCE here rather than in each provider service. The list
 * is checked in order and the first non-empty value wins; the raw value is
 * still verified cryptographically, so an attacker cannot smuggle a value
 * through a different header without knowing the secret.
 */
export const WEBHOOK_SIGNATURE_HEADERS = [
  'x-bigbang-signature',
  'x-signature',
  'x-webhook-signature',
  'x-hub-signature-256',
] as const;

/** Header carrying the provider's unix-seconds (or millisecond) timestamp. */
export const WEBHOOK_TIMESTAMP_HEADERS = [
  'x-bigbang-timestamp',
  'x-timestamp',
  'x-webhook-timestamp',
] as const;

/**
 * Default replay window, in seconds. BigBang does not document a mandatory
 * timestamp, so the window is only enforced WHEN a timestamp header is
 * present (see `verifyWebhookSignature`). This matches the existing partner
 * `webhook-signature.ts` and `casino-signature.ts` conventions.
 */
export const WEBHOOK_DEFAULT_REPLAY_WINDOW_SECONDS = 300;

export type WebhookVerificationFailure =
  | 'MISSING_SIGNATURE'
  | 'MALFORMED_SIGNATURE'
  | 'BAD_SIGNATURE'
  | 'STALE_TIMESTAMP';

export type WebhookVerificationVerdict =
  | { ok: true }
  | { ok: false; reason: WebhookVerificationFailure };

/**
 * The signing message: the EXACT raw body bytes.
 *
 * Documented BigBang contract: the webhook is "signed with HMAC-SHA256 using
 * the webhook secret". No timestamp or event id is stated as part of the
 * signed string, so the body alone is hashed — matching the same convention
 * this project already uses for `partner/webhook-signature.ts` and the payment
 * gateway webhook. If the provider's issued documentation states otherwise,
 * ONLY this function needs to change.
 */
export function computeWebhookSignature(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/** Constant-time hex comparison. Never `a === b`. */
function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * The signing message: the EXACT raw body bytes.
 *
 * Documented BigBang contract: the webhook is "signed with HMAC-SHA256 using
 * the webhook secret". No timestamp or event id is stated as part of the
 * signed string, so the body alone is hashed — matching the same convention
 * this project already uses for `partner/webhook-signature.ts` and the payment
 * gateway webhook. If the provider's issued documentation states otherwise,
 * ONLY this function needs to change.

/**
 * Verifies one inbound webhook request.
 *
 * @param rawBody  the EXACT request bytes (never a re-serialised object)
 * @param secret   the provider's webhook secret (never logged or returned)
 * @param signatureHeader value of the first present signature header
 * @param timestampHeader value of the first present timestamp header
 * @param replayWindowSeconds accepted timestamp drift; defaults to 5 minutes
 * @param now      injectable clock (tests)
 */
export function verifyWebhookSignature(
  rawBody: Buffer | string,
  secret: string,
  signatureHeader: string | null | undefined,
  timestampHeader?: string | null,
  replayWindowSeconds: number = WEBHOOK_DEFAULT_REPLAY_WINDOW_SECONDS,
  now: number = Date.now(),
): WebhookVerificationVerdict {
  // No secret configured is a CONFIGURATION problem, not a caller problem, so
  // it is reported as a bad signature rather than leaking "not configured" to
  // an unauthenticated prober through a distinguishable response.
  if (!secret) return { ok: false, reason: 'BAD_SIGNATURE' };

  const provided = (signatureHeader ?? '')
    .trim()
    // Tolerate the `sha256=` prefix some gateways prepend.
    .replace(/^sha256=/i, '')
    .toLowerCase();
  if (!provided) return { ok: false, reason: 'MISSING_SIGNATURE' };
  // A hex HMAC-SHA256 digest is exactly 64 characters; anything else can never
  // match and is rejected before the comparison.
  if (!/^[0-9a-f]{64}$/.test(provided)) return { ok: false, reason: 'MALFORMED_SIGNATURE' };

  if (timestampHeader) {
    const parsed = Number.parseInt(timestampHeader.trim(), 10);
    if (Number.isFinite(parsed)) {
      // Providers send either unix seconds or unix milliseconds.
      const seconds = parsed > 1e12 ? parsed / 1000 : parsed;
      if (Math.abs(now / 1000 - seconds) > replayWindowSeconds) {
        return { ok: false, reason: 'STALE_TIMESTAMP' };
      }
    }
  }

  const expected = computeWebhookSignature(rawBody, secret);
  if (!safeEqualHex(provided, expected)) return { ok: false, reason: 'BAD_SIGNATURE' };
  return { ok: true };
}

/**
 * SHA-256 over the exact raw body, stored on every event row.
 *
 * This is what ties an audit record to the bytes that were actually verified,
 * and it is a digest — the raw body (which may contain player identifiers) is
 * never used as a lookup key.
 */
export function hashWebhookPayload(rawBody: Buffer | string): string {
  return createHash('sha256').update(rawBody).digest('hex');
}

/** First non-empty header value from a list of candidate names. */
export function readFirstHeader(
  headers: Record<string, string | undefined>,
  names: readonly string[],
): string | null {
  for (const name of names) {
    const value = headers[name];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

/**
 * A SAFE, bounded, redacted snapshot of a webhook payload for the audit row.
 *
 * The stored value is deliberately NOT the raw provider document:
 *  - depth/width are capped so a deeply nested or huge payload can never bloat
 *    a database row or blow the response;
 *  - any key that LOOKS like a credential (api key, secret, token, password,
 *    signature, authorization) has its value replaced with the literal
 *    `[redacted]`, so a provider that ever echoes a credential back at us can
 *    never have it persisted;
 *  - long strings are truncated.
 *
 * The signed bytes themselves are already proven by `payloadHash`, so nothing
 * security-relevant is lost by not storing the original.
 */
export function redactWebhookPayload(
  payload: unknown,
  maxDepth = 4,
  maxKeys = 40,
  maxStringLength = 256,
): unknown {
  const SECRET_KEY_PATTERN =
    /(api[-_]?key|secret|token|password|passwd|authorization|signature|sign|credential|cookie|session)/i;

  const walk = (value: unknown, depth: number, budget: number): unknown => {
    if (budget <= 0) return '[truncated]';
    if (value === null || typeof value === 'boolean' || typeof value === 'number') {
      return value;
    }
    if (typeof value === 'string') {
      return value.length > maxStringLength ? `${value.slice(0, maxStringLength)}…` : value;
    }
    if (typeof value !== 'object') return String(value);
    if (depth >= maxDepth) return '[truncated]';
    if (Array.isArray(value)) {
      return value.slice(0, maxKeys).map((entry) => walk(entry, depth + 1, budget - 1));
    }
    const out: Record<string, unknown> = {};
    let remaining = Math.min(maxKeys, Object.keys(value as object).length);
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (remaining <= 0) {
        out['…'] = '[truncated]';
        break;
      }
      remaining -= 1;
      out[key] = SECRET_KEY_PATTERN.test(key)
        ? '[redacted]'
        : walk(entry, depth + 1, budget - 1);
    }
    return out;
  };

  return walk(payload, 0, maxKeys * maxKeys);
}

