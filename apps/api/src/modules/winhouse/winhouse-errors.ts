import { HttpException } from '@nestjs/common';

/**
 * Provider-facing refusal codes for the WinHouse wallet callbacks.
 *
 * The PROVIDER's retry policy is driven by the HTTP STATUS, not by the body:
 *
 *   401 403 404 409 422  deliberate refusal — FINAL, the bet is rejected and
 *                        NOT retried (the provider's documented list).
 *   400                  malformed request (the provider's own reference
 *                        implementation answers 400 for an unreadable amount).
 *   5xx / timeout        "in doubt", stays pending and is RETRIED LATER with
 *                        the same transaction_id — so a 5xx is never used to
 *                        refuse a player (it would retry forever) and a
 *                        deliberate refusal is never answered with 2xx.
 */
export type WinHouseRefusalCode =
  | 'WINHOUSE_BAD_TOKEN'
  | 'WINHOUSE_BAD_SIGNATURE'
  | 'WINHOUSE_MISSING_SIGNATURE'
  | 'WINHOUSE_MALFORMED_BODY'
  | 'WINHOUSE_INVALID_AMOUNT'
  | 'WINHOUSE_UNSUPPORTED_ACTION'
  | 'WINHOUSE_ACTION_AMOUNT_MISMATCH'
  | 'WINHOUSE_UNKNOWN_PLAYER'
  | 'WINHOUSE_CURRENCY_MISMATCH'
  | 'WINHOUSE_TRANSACTION_CONFLICT'
  | 'WINHOUSE_INSUFFICIENT_FUNDS'
  | 'WINHOUSE_NOT_CONFIGURED'
  | 'WINHOUSE_RAW_BODY_UNAVAILABLE'
  | 'WINHOUSE_UNAVAILABLE';

/**
 * Throws a structured, secret-free refusal. The body never contains a token, a
 * key, a signature or a payload dump — only a reason code and a short message.
 */
export function winhouseRefuse(
  status: 400 | 401 | 403 | 404 | 409 | 422 | 503,
  code: WinHouseRefusalCode,
  message: string,
): never {
  throw new HttpException({ error: message, code }, status);
}

/** Maps a secret-free signature/token verdict reason onto a refusal. */
export function refuseForSignatureReason(reason: string): never {
  if (reason === 'not_configured') {
    winhouseRefuse(
      503,
      'WINHOUSE_NOT_CONFIGURED',
      'The embedded sportsbook wallet is not configured for this environment.',
    );
  }
  if (reason === 'signature_missing') {
    winhouseRefuse(401, 'WINHOUSE_MISSING_SIGNATURE', 'Missing signature');
  }
  if (reason === 'wallet_key_missing') {
    // Our own misconfiguration: the movement cannot be authorised at all, so
    // the provider must retry once the wallet key is deployed.
    winhouseRefuse(
      503,
      'WINHOUSE_UNAVAILABLE',
      'The embedded sportsbook wallet is unavailable.',
    );
  }
  if (reason === 'bad_token') {
    winhouseRefuse(401, 'WINHOUSE_BAD_TOKEN', 'Bad callback token');
  }
  winhouseRefuse(401, 'WINHOUSE_BAD_SIGNATURE', 'Bad signature');
}

/**
 * Secret-free description of a refusal, for diagnostics only.
 *
 * Returns the HTTP status the provider received and the stable refusal code
 * from the response body (never the message, never a token, key or signature).
 * A non-HTTP error is reported as a 500 with no code, because an unexpected
 * failure is an "in doubt" outcome the provider retries.
 */
export function describeWinHouseRefusal(error: unknown): {
  status: number;
  code: WinHouseRefusalCode | null;
} {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (response && typeof response === 'object' && 'code' in response) {
      const code = (response as { code?: unknown }).code;
      if (typeof code === 'string') {
        return { status: error.getStatus(), code: code as WinHouseRefusalCode };
      }
    }
    return { status: error.getStatus(), code: null };
  }
  return { status: 500, code: null };
}
