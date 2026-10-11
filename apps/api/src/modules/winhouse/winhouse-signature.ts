import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * WinHouse (embedded sportsbook) signing/verification — Model B.
 *
 * This file is the ONE place the provider's canonical strings are defined.
 * Both directions go through it, and every test asserts against it, so a
 * future credential document with a different order changes ONE function.
 *
 * ── THE TWO SECRETS (never interchangeable) ────────────────────────────────
 *   wallet API key  — HMAC key for the balance-change signature AND launch
 *                     tokens. It NEVER travels.
 *   callback token  — travels in `?token=` on calls TO US and authenticates
 *                     them. It is NOT a signing key.
 *
 * ── balance-change signature (exact provider contract) ─────────────────────
 *   base      = username + amount + action + ticket_id + transaction_id
 *   signature = HMAC_SHA256(base, wallet_api_key).hex()
 *   Five fields concatenated with NO SEPARATOR, in exactly that order; a
 *   missing field contributes an empty string; `amount` is used EXACTLY as it
 *   arrived on the wire ("-25", not "-25.00", when that is what was sent).
 *
 * ── launch token (exact provider contract) ─────────────────────────────────
 *   launch    = <player_id>.<expiry>.<session>.<signature>
 *   signature = HMAC_SHA256("<player_id>|<expiry>|<session>", wallet_api_key).hex()
 *   `expiry` is epoch MILLISECONDS, in the future, never more than 10 minutes
 *   ahead. Fields joined with `|` (the ONLY place a separator is used).
 *
 * Secrets, raw signatures and tokens are NEVER logged by this module: callers
 * only ever receive a boolean verdict plus a secret-free reason code.
 */

/** A launch token is the only place the provider uses `|` as a separator. */
const LAUNCH_FIELD_SEPARATOR = '|';

/** Constant-time comparison of two strings. */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Authenticates an inbound provider request by its callback token.
 *
 * The callback token is compared in CONSTANT TIME against the configured value
 * and is never echoed back, logged or included in any error.
 */
export function verifyCallbackToken(
  provided: string | null | undefined,
  expected: string | null | undefined,
): boolean {
  const expectedToken = (expected ?? '').trim();
  if (!expectedToken) return false;
  const providedToken = typeof provided === 'string' ? provided : '';
  if (!providedToken) return false;
  return safeEqual(providedToken, expectedToken);
}


export interface BalanceChangeSignatureFields {
  username: string;
  /** The amount EXACTLY as it arrived on the wire. */
  amount: string;
  action: string;
  ticketId: string;
  transactionId: string;
}

/** Builds the exact string the provider signs for a balance-change. */
export function balanceChangeSignatureBase(fields: BalanceChangeSignatureFields): string {
  return (
    String(fields.username ?? '') +
    String(fields.amount ?? '') +
    String(fields.action ?? '') +
    String(fields.ticketId ?? '') +
    String(fields.transactionId ?? '')
  );
}

/** Lowercase hex HMAC-SHA256 of an arbitrary string under the wallet API key. */
export function hmacSha256Hex(base: string, walletApiKey: string): string {
  return createHmac('sha256', walletApiKey).update(base, 'utf8').digest('hex');
}

/** Lowercase hex HMAC-SHA256 balance-change signature. */
export function signBalanceChange(
  fields: BalanceChangeSignatureFields,
  walletApiKey: string,
): string {
  return hmacSha256Hex(balanceChangeSignatureBase(fields), walletApiKey);
}

export type WinHouseSignatureFailureReason =
  | 'signature_missing'
  | 'wallet_key_missing'
  | 'bad_signature';

export type WinHouseSignatureVerdict =
  | { ok: true }
  | { ok: false; reason: WinHouseSignatureFailureReason };

/**
 * Verifies a balance-change signature.
 *
 * `amountCandidates` exists because the provider stringifies the amount "as
 * sent on the wire": a JSON body parsed and re-serialized would turn "-25.00"
 * into "-25" and break a literal comparison. The caller passes the parsed value
 * AND the raw wire literal, and a match on exactly one of them is accepted —
 * the HMAC over all five fields (keyed with the wallet API key) is what
 * authorises the movement, so an extra representation of the SAME value cannot
 * widen the attack surface.
 */
export function verifyBalanceChangeSignature(
  fields: Omit<BalanceChangeSignatureFields, 'amount'>,
  amountCandidates: readonly string[],
  providedSignature: string | null | undefined,
  walletApiKey: string | null | undefined,
): WinHouseSignatureVerdict {
  const signature = (providedSignature ?? '').trim().toLowerCase();
  if (!signature) return { ok: false, reason: 'signature_missing' };

  const key = (walletApiKey ?? '').trim();
  if (!key) return { ok: false, reason: 'wallet_key_missing' };

  const candidates = [...new Set(amountCandidates.filter((value) => typeof value === 'string'))];
  for (const amount of candidates) {
    const expected = signBalanceChange({ ...fields, amount }, key);
    if (safeEqual(signature, expected)) return { ok: true };
  }
  return { ok: false, reason: 'bad_signature' };
}

// ---------------------------------------------------------------------------
// Launch tokens (Model B SSO hand-off)
// ---------------------------------------------------------------------------

/** The exact string that is signed for a launch token. */
export function launchTokenBase(playerId: string, expiryMs: number, session: string): string {
  return [String(playerId ?? ''), String(expiryMs), String(session ?? '')].join(
    LAUNCH_FIELD_SEPARATOR,
  );
}

/** Lowercase hex HMAC-SHA256 launch-token signature. */
export function signLaunchToken(
  playerId: string,
  expiryMs: number,
  session: string,
  walletApiKey: string,
): string {
  return hmacSha256Hex(launchTokenBase(playerId, expiryMs, session), walletApiKey);
}

/**
 * Mints the provider's launch token: `<player_id>.<expiry>.<session>.<signature>`.
 *
 * Called per page load. `ttlMs` is clamped to the provider's documented
 * maximum, so a caller (or a misconfiguration) can never mint a token the
 * provider refuses with 401.
 */
export function mintLaunchToken(input: {
  playerId: string;
  walletApiKey: string;
  /** Provider session id quoted back on every wallet call (may be empty). */
  session: string;
  /** Requested lifetime in milliseconds. */
  ttlMs: number;
  /** Provider maximum (10 minutes) the lifetime is clamped to. */
  maxTtlMs: number;
  now?: number;
}): { token: string; expiryMs: number } {
  const now = input.now ?? Date.now();
  const ttl = Math.min(Math.max(input.ttlMs, 1000), input.maxTtlMs);
  const expiryMs = now + ttl;
  const signature = signLaunchToken(input.playerId, expiryMs, input.session, input.walletApiKey);
  return {
    token: `${input.playerId}.${expiryMs}.${input.session}.${signature}`,
    expiryMs,
  };
}

export interface ParsedLaunchToken {
  playerId: string;
  expiryMs: number;
  session: string;
  signature: string;
}

/** Parses a launch token structurally. Returns null when malformed. */
export function parseLaunchToken(token: string | null | undefined): ParsedLaunchToken | null {
  const raw = (token ?? '').trim();
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 4) return null;
  const [playerId, expiryRaw, session, signature] = parts;
  if (!playerId || !expiryRaw || !signature) return null;
  if (!/^\d+$/.test(expiryRaw)) return null;
  return { playerId, expiryMs: Number.parseInt(expiryRaw, 10), session, signature };
}

export type LaunchTokenFailureReason =
  | 'malformed_token'
  | 'wallet_key_missing'
  | 'expired'
  | 'ttl_exceeded'
  | 'bad_signature';

export type LaunchTokenVerdict =
  | { ok: true; playerId: string; expiryMs: number; session: string }
  | { ok: false; reason: LaunchTokenFailureReason };

/**
 * Verifies a launch token exactly like the provider does — four fields, a
 * future expiry no more than 10 minutes ahead, and an HMAC over
 * `player_id|expiry|session` keyed with the WALLET API KEY (never the callback
 * token). Used by the internal self-test and the unit tests; the provider
 * redeems the token itself via POST /tenant/sso.
 */
export function verifyLaunchToken(input: {
  token: string;
  walletApiKey: string | null | undefined;
  maxTtlMs: number;
  now?: number;
}): LaunchTokenVerdict {
  const parsed = parseLaunchToken(input.token);
  if (!parsed) return { ok: false, reason: 'malformed_token' };

  const key = (input.walletApiKey ?? '').trim();
  if (!key) return { ok: false, reason: 'wallet_key_missing' };

  const now = input.now ?? Date.now();
  if (parsed.expiryMs <= now) return { ok: false, reason: 'expired' };
  if (parsed.expiryMs - now > input.maxTtlMs) return { ok: false, reason: 'ttl_exceeded' };

  const expected = signLaunchToken(parsed.playerId, parsed.expiryMs, parsed.session, key);
  if (!safeEqual(parsed.signature.toLowerCase(), expected)) {
    return { ok: false, reason: 'bad_signature' };
  }

  return {
    ok: true,
    playerId: parsed.playerId,
    expiryMs: parsed.expiryMs,
    session: parsed.session,
  };
}
