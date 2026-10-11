import { SetMetadata } from '@nestjs/common';

export const SKIP_RESPONSE_ENVELOPE_KEY = 'skipResponseEnvelope';

/**
 * Returns the route's value VERBATIM instead of wrapping it in the standard
 * `{ success: true, data }` envelope (see common/interceptors).
 *
 * WHY THIS EXISTS
 * ---------------
 * External providers define their own wire format. WinHouse's seamless-wallet
 * callbacks (and the SSO hand-off) are read by the provider's servers, not by
 * our frontend: `balance-change` must answer exactly
 * `{"status":"ok","balance":"225.00"}` and `user-data` exactly
 * `{"username":"…","balance":"…","currency":"…"}`. Any wrapper (or a 200
 * without `status: "ok"`) is read as "in doubt" and the provider RETRIES the
 * stake with the same transaction id.
 *
 * The opt-out is per route and metadata-gated, so every other endpoint keeps
 * the envelope exactly as before.
 */
export const SkipResponseEnvelope = () => SetMetadata(SKIP_RESPONSE_ENVELOPE_KEY, true);
