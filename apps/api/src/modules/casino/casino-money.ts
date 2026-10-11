import type { MinorUnit } from '@tanvion-royale/types';

/**
 * Provider amount normalization.
 *
 * The TANVION wallet stores INTEGER MINOR UNITS and never uses floating-point
 * arithmetic. Partner payloads may express an amount either as an integer in
 * minor units (`amount_minor` / `amountMinor`) or as a DECIMAL string
 * (`amount: "12.50"`). Both are converted here with exact string arithmetic —
 * `Number.parseFloat()` is never used for money, so no rounding artefact can
 * ever invent or lose a minor unit.
 */

/** Minor-unit exponent per supported currency (all three are 2-decimal). */
const CURRENCY_EXPONENTS: Record<string, number> = {
  BDT: 2,
  USD: 2,
  EUR: 2,
};

export function currencyExponent(currency: string): number {
  return CURRENCY_EXPONENTS[currency.toUpperCase()] ?? 2;
}

/**
 * Converts a decimal amount (string or number) into integer minor units.
 * Returns null for anything that is not a valid, finite, non-negative amount
 * with at most `exponent` decimal places — an invalid amount is NEVER guessed.
 */
export function decimalToMinorUnits(value: unknown, currency: string): MinorUnit | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    // A numeric provider amount is only accepted when it has no sub-cent
    // precision, so the string path is never bypassed with a rounded float.
    return decimalToMinorUnits(String(value), currency);
  }
  if (typeof value !== 'string') return null;
  const raw = value.trim().replace(/,/g, '');
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;

  const [whole, fraction = ''] = raw.split('.');
  const exponent = currencyExponent(currency);
  if (fraction.length > exponent) return null;

  const paddedFraction = fraction.padEnd(exponent, '0');
  const minor = Number.parseInt(`${whole}${paddedFraction}`, 10);
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Renders integer minor units back as a fixed 2-decimal decimal string. */
export function minorUnitsToDecimal(amount: MinorUnit, currency: string): string {
  const exponent = currencyExponent(currency);
  const negative = amount < 0;
  const digits = String(Math.abs(amount)).padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  return `${negative ? '-' : ''}${whole}${exponent > 0 ? `.${fraction}` : ''}`;
}

/**
 * Reads a partner amount from a callback payload.
 * Prefers an explicit minor-unit field; falls back to a decimal field.
 * Returns null when the payload carries no usable amount.
 */
export function readCallbackAmount(
  payload: Record<string, unknown>,
  currency: string,
): MinorUnit | null {
  for (const key of ['amount_minor', 'amountMinor', 'amountInMinor', 'amount_cents']) {
    const raw = payload[key];
    if (typeof raw === 'number' && Number.isInteger(raw)) return raw;
    if (typeof raw === 'string' && /^\d+$/.test(raw.trim())) {
      const parsed = Number.parseInt(raw.trim(), 10);
      if (Number.isSafeInteger(parsed)) return parsed;
    }
  }
  for (const key of ['amount', 'bet_amount', 'win_amount']) {
    const converted = decimalToMinorUnits(payload[key], currency);
    if (converted !== null) return converted;
  }
  return null;
}
