import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Partner casino request signing/verification (HMAC-SHA1, Script.Casino-style).
 *
 * Headers (server → provider and provider → server):
 *   X-Merchant-Id, X-Timestamp, X-Nonce, X-Sign
 *
 * Canonical signing payload (the ONE place this is defined):
 *
 *   merchantId + "\n" + timestamp + "\n" + nonce + "\n" + METHOD + "\n" +
 *   pathWithQuery + "\n" + rawBody
 *
 *   X-Sign = lowercase hex HMAC-SHA1(merchantSecret, payload)
 *
 * The raw body is part of the signed payload, so an amount/currency/player id
 * can never be tampered with in transit, and a replay is blocked by the
 * timestamp window plus the per-provider unique nonce.
 *
 * NOTE — provider-spec alignment: the headers and algorithm above follow the
 * supplied API specification. If the issued credentials document a different
 * canonical string order, ONLY `canonicalCasinoSigningPayload` needs adjusting
 * — every call site and every test goes through these two functions.
 *
 * Secrets are never logged and never returned: callers only ever receive a
 * boolean verdict with a reason code.
 */

export const CASINO_MERCHANT_HEADER = 'x-merchant-id';
export const CASINO_TIMESTAMP_HEADER = 'x-timestamp';
export const CASINO_NONCE_HEADER = 'x-nonce';
export const CASINO_SIGN_HEADER = 'x-sign';

/** Replay window for the provider timestamp (seconds, ±5 minutes). */
export const CASINO_TIMESTAMP_TOLERANCE_SECONDS = 300;

/** Nonce charset/length — opaque, high-entropy, single-use per provider. */
const NONCE_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;

export interface CasinoSignatureInput {
  merchantId: string;
  timestamp: string;
  nonce: string;
  /** HTTP method, any case (normalized to upper case). */
  method: string;
  /** Path including the query string, exactly as on the wire. */
  path: string;
  /** Exact raw request/response body (empty string when there is none). */
  rawBody?: string | null;
}

export type CasinoSignatureFailureReason =
  | 'missing_headers'
  | 'missing_nonce'
  | 'bad_nonce'
  | 'merchant_mismatch'
  | 'stale_timestamp'
  | 'bad_signature';

export type CasinoSignatureVerdict =
  | { ok: true }
  | { ok: false; reason: CasinoSignatureFailureReason };

/** Builds the exact canonical string that is signed. */
export function canonicalCasinoSigningPayload(input: CasinoSignatureInput): string {
  return [
    input.merchantId,
    input.timestamp,
    input.nonce,
    (input.method ?? '').toUpperCase(),
    input.path ?? '',
    input.rawBody ?? '',
  ].join('\n');
}

/** Lowercase hex HMAC-SHA1 signature over the canonical payload. */
export function signCasinoPayload(input: CasinoSignatureInput, secret: string): string {
  return createHmac('sha1', secret)
    .update(canonicalCasinoSigningPayload(input), 'utf8')
    .digest('hex');
}

/** Cryptographically strong single-use nonce. */
export function newCasinoNonce(): string {
  return randomBytes(16).toString('hex');
}

/** Constant-time comparison of two hex strings. */
function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export interface CasinoCallbackHeaders {
  merchantId?: string | undefined;
  timestamp?: string | undefined;
  nonce?: string | undefined;
  signature?: string | undefined;
}

/**
 * Verifies an inbound signed provider request.
 *
 * @param headers   the four signing headers as received
 * @param expectedMerchantId merchant id this deployment expects
 * @param secret    the shared merchant secret (never logged)
 * @param request   exact method/path/raw bytes of the request
 * @param now       injectable clock (tests)
 */
export function verifyCasinoSignature(
  headers: CasinoCallbackHeaders,
  expectedMerchantId: string,
  secret: string,
  request: { method: string; path: string; rawBody?: string | null },
  now: number = Date.now(),
): CasinoSignatureVerdict {
  const merchantId = (headers.merchantId ?? '').trim();
  const timestamp = (headers.timestamp ?? '').trim();
  const nonce = (headers.nonce ?? '').trim();
  const signature = (headers.signature ?? '').trim().replace(/^sha1=/i, '');

  if (!merchantId || !timestamp || !signature) {
    return { ok: false, reason: 'missing_headers' };
  }
  if (!nonce) return { ok: false, reason: 'missing_nonce' };
  if (!NONCE_PATTERN.test(nonce)) return { ok: false, reason: 'bad_nonce' };
  if (!secret) return { ok: false, reason: 'bad_signature' };

  // Merchant identity is part of the contract: a signature that is valid for
  // another merchant must never be accepted here.
  if (merchantId !== expectedMerchantId) {
    return { ok: false, reason: 'merchant_mismatch' };
  }

  const seconds = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(seconds)) return { ok: false, reason: 'stale_timestamp' };
  if (Math.abs(now / 1000 - seconds) > CASINO_TIMESTAMP_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'stale_timestamp' };
  }

  const expected = signCasinoPayload(
    {
      merchantId,
      timestamp,
      nonce,
      method: request.method,
      path: request.path,
      rawBody: request.rawBody,
    },
    secret,
  );

  if (!safeEqualHex(signature.toLowerCase(), expected)) {
    return { ok: false, reason: 'bad_signature' };
  }

  return { ok: true };
}

/** Outbound signing headers for a provider call (used by the HTTP adapter). */
export function buildCasinoSignatureHeaders(
  merchantId: string,
  secret: string,
  request: { method: string; path: string; rawBody?: string | null },
  now: number = Date.now(),
): Record<string, string> {
  const timestamp = String(Math.floor(now / 1000));
  const nonce = newCasinoNonce();
  const signature = signCasinoPayload(
    {
      merchantId,
      timestamp,
      nonce,
      method: request.method,
      path: request.path,
      rawBody: request.rawBody,
    },
    secret,
  );
  return {
    [CASINO_MERCHANT_HEADER]: merchantId,
    [CASINO_TIMESTAMP_HEADER]: timestamp,
    [CASINO_NONCE_HEADER]: nonce,
    [CASINO_SIGN_HEADER]: signature,
  };
}

