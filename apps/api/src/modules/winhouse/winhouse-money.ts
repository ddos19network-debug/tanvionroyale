import { createHash } from 'node:crypto';
import {
  currencyExponent,
  decimalToMinorUnits,
  minorUnitsToDecimal,
} from '../casino/casino-money';

/**
 * WinHouse amount handling.
 *
 * The provider expresses money as a 2-decimal number in the book currency:
 * NEGATIVE = stake (bet), POSITIVE = payout (win). TANVION stores integer
 * MINOR UNITS and never uses floating point for money, so every amount is
 * converted with exact string arithmetic.
 *
 * The generic conversion helpers are the EXISTING ones from the casino module
 * (`casino-money.ts`, already unit-tested) — this file adds only what is
 * genuinely WinHouse-specific: a signed amount, the provider's refusal codes
 * and the "amount exactly as sent on the wire" extraction the balance-change
 * signature requires.
 */

/**
 * Parses a signed decimal provider amount into signed integer minor units.
 * Returns null for anything that is not a finite, valid amount with at most
 * `exponent` decimal places — an invalid amount is NEVER guessed or rounded.
 *
 * Accepts both a JSON number (-25, -25.5) and a decimal string ("-25.00"), and
 * refuses ambiguous forms ("1e3", "NaN", "1,000.50", "+5").
 */
export function signedDecimalToMinorUnits(
  value: unknown,
  currency: string,
): number | null {
  let raw: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    raw = String(value);
  } else if (typeof value === 'string') {
    raw = value.trim();
  } else {
    return null;
  }
  if (!raw) return null;

  const negative = raw.startsWith('-');
  const magnitude = negative ? raw.slice(1) : raw;
  // The magnitude goes through the SAME normalizer the casino callbacks use:
  // digits with an optional single decimal separator, never an exponent.
  const minor = decimalToMinorUnits(magnitude, currency);
  if (minor === null) return null;
  return negative ? -minor : minor;
}

/** Renders signed minor units as the provider's fixed 2-decimal string. */
export function minorUnitsToProviderAmount(amountMinor: number, currency: string): string {
  return minorUnitsToDecimal(amountMinor, currency);
}

/** True when the amount is exactly representable in the wallet currency. */
export function isRepresentableAmount(value: unknown, currency: string): boolean {
  return signedDecimalToMinorUnits(value, currency) !== null;
}

/** The number of decimal places the wallet currency uses (BDT/USD/EUR = 2). */
export function providerCurrencyExponent(currency: string): number {
  return currencyExponent(currency);
}

/**
 * Reads the RAW JSON literal of a top-level `field` from the request text.
 *
 * Why: the provider signs `amount` "as sent on the wire" (-25 vs -25.00), and a
 * parsed-then-reserialized number loses that form. The scanner walks the JSON
 * text tracking string state, so a value inside another string (or a nested
 * object) can never be mistaken for the field. Returns null when the field is
 * absent, or when its value is not a scalar.
 */
export function extractRawJsonField(rawBody: string, field: string): string | null {
  const text = rawBody ?? '';
  let depth = 0;
  let index = 0;

  while (index < text.length) {
    const char = text[index];

    if (char === '"') {
      const start = index + 1;
      const cursor = skipString(text, start);
      const key = text.slice(start, cursor);
      const afterKey = text[cursor + 1];

      if (afterKey === ':') {
        const valueStart = skipWhitespace(text, cursor + 2);
        const valueEnd = readScalarEnd(text, valueStart);
        const value = text.slice(valueStart, valueEnd);
        // Only a TOP-LEVEL field of the object we are in (depth === 1) counts,
        // and only a SCALAR value: an object/array is a different shape and is
        // skipped whole (its own braces are consumed by readScalarEnd, so the
        // depth of the object we are scanning stays accurate and a `"amount"`
        // nested inside it — or any field AFTER it — is still found).
        const isContainer = value.startsWith('{') || value.startsWith('[');
        if (key === field && depth === 1 && !isContainer && value.length > 0) {
          return value.startsWith('"') ? value.slice(1, -1) : value;
        }
        index = valueEnd;
        continue;
      }
      index = cursor + 1;
      continue;
    }

    if (char === '{' || char === '[') depth += 1;
    else if (char === '}' || char === ']') depth -= 1;
    index += 1;
  }

  return null;
}

/** Skips whitespace from `from` and returns the first content index. */
function skipWhitespace(text: string, from: number): number {
  let index = from;
  while (index < text.length && /\s/.test(text[index])) index += 1;
  return index;
}

/** Index of the closing quote of a JSON string whose body starts at `start`. */
function skipString(text: string, start: number): number {
  let cursor = start;
  while (cursor < text.length) {
    if (text[cursor] === '\\') {
      cursor += 2;
      continue;
    }
    if (text[cursor] === '"') return cursor;
    cursor += 1;
  }
  return text.length;
}

/** End index (exclusive) of the scalar literal starting at `start`. */
function readScalarEnd(text: string, start: number): number {
  if (text[start] === '"') return skipString(text, start + 1) + 1;
  // An object/array value is consumed WHOLE (balanced, string-aware) so the
  // caller can recognise it as non-scalar AND keep the depth bookkeeping exact.
  if (text[start] === '{' || text[start] === '[') return readContainerEnd(text, start);
  let cursor = start;
  while (cursor < text.length && !/[,}\]]/.test(text[cursor])) cursor += 1;
  return cursor;
}

/** End index (exclusive) just after the balanced container starting at `start`. */
function readContainerEnd(text: string, start: number): number {
  let depth = 0;
  let cursor = start;
  while (cursor < text.length) {
    const char = text[cursor];
    if (char === '"') {
      cursor = skipString(text, cursor + 1) + 1;
      continue;
    }
    if (char === '{' || char === '[') {
      depth += 1;
    } else if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0) return cursor + 1;
    }
    cursor += 1;
  }
  return text.length;
}

/**
 * SHA-256 fingerprint of a validated movement — the ONE definition of "the same
 * provider transaction with the same payload".
 *
 * It is compared against `WinHouseTransaction.payloadHash` to answer a retried
 * `transaction_id`: an identical fingerprint replays the ORIGINAL result and
 * moves nothing, a different fingerprint is refused with 409
 * (`WINHOUSE_TRANSACTION_CONFLICT`) and moves nothing. The payload itself is
 * never stored, and the fingerprint is order-stable (a fixed array, never a JSON
 * object's key order) so the comparison cannot drift between deploys.
 *
 * Exported so the admin self-test exercises the SAME comparison logic the money
 * path uses instead of re-implementing it.
 */
export function winhouseMovementFingerprint(fields: {
  username: string;
  amountMinor: number;
  currency: string;
  action: string;
  ticketId: string;
  session: string;
}): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        fields.username,
        fields.amountMinor,
        fields.currency.toUpperCase(),
        fields.action.toLowerCase(),
        fields.ticketId,
        fields.session,
      ]),
      'utf8',
    )
    .digest('hex');
}
