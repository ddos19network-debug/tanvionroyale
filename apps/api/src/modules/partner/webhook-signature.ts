import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Partner webhook signature verification (Partner Sports Adapter boundary).
 *
 * Contract for the Football/Cricket partner feed:
 *   - Signature header: `x-partner-signature: sha256=<hex>`
 *   - Signature payload: HMAC-SHA256 over the EXACT raw request body using the
 *     shared webhook secret (OPERATOR_WEBHOOK_SECRET).
 *   - A timestamp header `x-partner-timestamp` (unix seconds) MAY be enforced
 *     with a ±5 minute window to stop replay attacks.
 *
 * Verification is constant-time and never depends on parsing the body first,
 * so a malformed payload can never bypass the check.
 */

export const PARTNER_SIGNATURE_HEADER = 'x-partner-signature';
export const PARTNER_TIMESTAMP_HEADER = 'x-partner-timestamp';
/** Replay window in seconds (±5 minutes). */
export const PARTNER_TIMESTAMP_TOLERANCE_SECONDS = 300;

export type WebhookVerificationResult =
  | { ok: true }
  | { ok: false; reason: 'missing_signature' | 'bad_signature' | 'stale_timestamp' };

/** Constant-time hex string comparison. */
function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function computePartnerSignature(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * Verifies a partner webhook request.
 * @param rawBody exact raw request bytes (never a re-serialized object)
 * @param secret shared webhook secret from the environment
 * @param signatureHeader value of the x-partner-signature header
 * @param timestampHeader value of the optional x-partner-timestamp header
 */
export function verifyPartnerWebhookSignature(
  rawBody: Buffer | string,
  secret: string,
  signatureHeader: string | undefined,
  timestampHeader?: string | undefined,
  now: number = Date.now(),
): WebhookVerificationResult {
  if (!signatureHeader) return { ok: false, reason: 'missing_signature' };
  const expected = computePartnerSignature(rawBody, secret);
  const provided = signatureHeader.trim().replace(/^sha256=/i, '');
  if (!provided || !safeEqualHex(provided.toLowerCase(), expected)) {
    return { ok: false, reason: 'bad_signature' };
  }
  if (timestampHeader) {
    const ts = Number.parseInt(timestampHeader, 10);
    if (Number.isFinite(ts)) {
      const drift = Math.abs(now / 1000 - ts);
      if (drift > PARTNER_TIMESTAMP_TOLERANCE_SECONDS) {
        return { ok: false, reason: 'stale_timestamp' };
      }
    }
  }
  return { ok: true };
}