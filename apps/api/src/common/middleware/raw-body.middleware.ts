import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * `verify` hook for the JSON / urlencoded body parsers that stores the EXACT
 * bytes received on `req.rawBody`.
 *
 * WHY THIS EXISTS (regression guard — see test/raw-body-capture.spec.ts):
 * provider callbacks (WinHouse `balance-change`, BigBang `balance-change`, the
 * casino wallet callbacks) verify an HMAC-SHA256 over the EXACT bytes the
 * provider signed. Re-serializing `req.body` would break that signature: key
 * order, whitespace and number formatting (`-2.50` vs `-2.5`) are all part of
 * the signed payload, and WinHouse signs over the raw `amount` string.
 *
 * Nest only records those bytes when IT registered the parser
 * (`NestFactory.create(AppModule, { rawBody: true })`), because its hook is
 * attached to Nest's own `json()`/`urlencoded()` middleware. That middleware is
 * registered at `app.init()` — i.e. AFTER any parser registered during
 * bootstrap — and body-parser parks an already-consumed body
 * (`req._body === true`) so the Nest hook never fires. The result was
 * `req.rawBody === undefined` on every signed callback, which the controllers
 * correctly rejected with 400 `WINHOUSE_MALFORMED_BODY` (every real stake).
 *
 * Capturing the bytes inside the FIRST parser that consumes the stream makes
 * `req.rawBody` independent of parser registration order. The Nest hook stays
 * enabled too (defense in depth: whichever parser runs first wins).
 */

export function captureRawBody(
  req: IncomingMessage & { rawBody?: Buffer },
  _res: ServerResponse,
  buf: Buffer,
): void {
  // Assigned without a copy, exactly like Nest's own rawBody hook: body-parser
  // hands us a per-request buffer it never reuses, and the bodies accepted here
  // can be large (10mb screenshot uploads).
  req.rawBody = buf;
}
