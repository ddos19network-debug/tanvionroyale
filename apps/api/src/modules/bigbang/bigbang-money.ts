import { currencyExponent, decimalToMinorUnits } from '../casino/casino-money';

/** Parse a signed BigBang decimal amount without floats or exponent syntax. */
export function signedBigBangAmountToMinorUnits(value: unknown, currency: string): number | null {
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
  if (!/^\d+(?:\.\d+)?$/.test(magnitude)) return null;
  const minor = decimalToMinorUnits(magnitude, currency);
  if (minor === null || currencyExponent(currency) < 0) return null;
  return negative ? -minor : minor;
}

/**
 * Return the exact scalar spelling of a TOP-LEVEL JSON field.
 *
 * BigBang signs `String(p.amount)`, not a re-serialized request object. This
 * scanner is deliberately independent from the WinHouse parser: it walks the
 * whole top-level object, skips nested objects/arrays and quoted strings, and
 * only returns a scalar for the requested key. A non-matching quoted field must
 * not terminate the scan.
 */
export function extractBigBangRawField(rawBody: string, field: string): string | null {
  const text = rawBody ?? '';
  let index = skipWhitespace(text, 0);
  if (text[index] !== '{') return null;
  index = skipWhitespace(text, index + 1);

  while (index < text.length && text[index] !== '}') {
    if (text[index] !== '"') return null;
    const keyEnd = skipString(text, index + 1);
    if (keyEnd >= text.length) return null;
    let key: string;
    try {
      key = JSON.parse(text.slice(index, keyEnd + 1)) as string;
    } catch {
      return null;
    }
    index = skipWhitespace(text, keyEnd + 1);
    if (text[index] !== ':') return null;
    const valueStart = skipWhitespace(text, index + 1);
    const valueEnd = readJsonValueEnd(text, valueStart);
    if (valueEnd <= valueStart) return null;
    const literal = text.slice(valueStart, valueEnd);
    if (key === field && literal[0] !== '{' && literal[0] !== '[') {
      if (literal[0] === '"') {
        try {
          const decoded = JSON.parse(literal) as unknown;
          return typeof decoded === 'string' ? decoded : null;
        } catch {
          return null;
        }
      }
      return literal;
    }
    index = skipWhitespace(text, valueEnd);
    if (text[index] === ',') {
      index = skipWhitespace(text, index + 1);
      continue;
    }
    if (text[index] === '}') return null;
    return null;
  }
  return null;
}

function skipWhitespace(text: string, from: number): number {
  let index = from;
  while (index < text.length && /\s/.test(text[index])) index += 1;
  return index;
}

function skipString(text: string, from: number): number {
  let index = from;
  while (index < text.length) {
    if (text[index] === '\\') {
      index += 2;
      continue;
    }
    if (text[index] === '"') return index;
    index += 1;
  }
  return text.length;
}

function readJsonValueEnd(text: string, from: number): number {
  const first = text[from];
  if (first === '"') return skipString(text, from + 1) + 1;
  if (first === '{' || first === '[') {
    let depth = 0;
    let index = from;
    while (index < text.length) {
      const char = text[index];
      if (char === '"') {
        index = skipString(text, index + 1) + 1;
        continue;
      }
      if (char === '{' || char === '[') depth += 1;
      else if (char === '}' || char === ']') {
        depth -= 1;
        if (depth === 0) return index + 1;
      }
      index += 1;
    }
    return text.length;
  }
  let index = from;
  while (index < text.length && !/[\s,}]/.test(text[index])) index += 1;
  return index;
}

