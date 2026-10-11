import {
  currencyExponent,
  decimalToMinorUnits,
  minorUnitsToDecimal,
  readCallbackAmount,
} from '../src/modules/casino/casino-money';

/**
 * Provider amount normalization tests.
 *
 * Money is integer minor units everywhere in TANVIONROYALE: a decimal string
 * must convert exactly, sub-cent precision must be REJECTED (never rounded),
 * and floats must never be used for financial arithmetic.
 */
describe('casino-money — decimal → minor units', () => {
  it('converts exact decimals for a 2-decimal currency', () => {
    expect(decimalToMinorUnits('12.50', 'BDT')).toBe(1250);
    expect(decimalToMinorUnits('12.5', 'BDT')).toBe(1250);
    expect(decimalToMinorUnits('12', 'BDT')).toBe(1200);
    expect(decimalToMinorUnits('0.01', 'USD')).toBe(1);
    expect(decimalToMinorUnits('1,234.56', 'EUR')).toBe(123456);
  });

  it('rejects sub-cent precision instead of rounding', () => {
    expect(decimalToMinorUnits('12.505', 'BDT')).toBeNull();
    expect(decimalToMinorUnits(12.555, 'BDT')).toBeNull();
  });

  it('rejects non-amounts', () => {
    expect(decimalToMinorUnits('abc', 'BDT')).toBeNull();
    expect(decimalToMinorUnits('-5.00', 'BDT')).toBeNull();
    expect(decimalToMinorUnits(Number.NaN, 'BDT')).toBeNull();
    expect(decimalToMinorUnits(Number.POSITIVE_INFINITY, 'BDT')).toBeNull();
    expect(decimalToMinorUnits(null, 'BDT')).toBeNull();
    expect(decimalToMinorUnits(undefined, 'BDT')).toBeNull();
    expect(decimalToMinorUnits({}, 'BDT')).toBeNull();
  });

  it('accepts a numeric amount only when it has no sub-cent precision', () => {
    expect(decimalToMinorUnits(12.5, 'BDT')).toBe(1250);
    expect(decimalToMinorUnits(12, 'BDT')).toBe(1200);
  });

  it('uses 2 decimals for every supported wallet currency', () => {
    expect(currencyExponent('BDT')).toBe(2);
    expect(currencyExponent('usd')).toBe(2);
    expect(currencyExponent('EUR')).toBe(2);
  });
});

describe('casino-money — minor units → decimal', () => {
  it('renders a fixed 2-decimal string', () => {
    expect(minorUnitsToDecimal(1250, 'BDT')).toBe('12.50');
    expect(minorUnitsToDecimal(1, 'BDT')).toBe('0.01');
    expect(minorUnitsToDecimal(0, 'BDT')).toBe('0.00');
    expect(minorUnitsToDecimal(-1250, 'BDT')).toBe('-12.50');
  });

  it('round-trips through minor units', () => {
    for (const value of ['0.01', '9.99', '100.00', '1234567.89']) {
      const minor = decimalToMinorUnits(value, 'BDT');
      expect(minor).not.toBeNull();
      expect(minorUnitsToDecimal(minor as number, 'BDT')).toBe(value);
    }
  });
});

describe('casino-money — callback amount reading', () => {
  it('prefers an explicit minor-unit field', () => {
    expect(readCallbackAmount({ amount_minor: 2500, amount: '99.99' }, 'BDT')).toBe(2500);
    expect(readCallbackAmount({ amountInMinor: '700' }, 'BDT')).toBe(700);
    expect(readCallbackAmount({ amount_cents: 5 }, 'BDT')).toBe(5);
  });

  it('falls back to decimal amount fields', () => {
    expect(readCallbackAmount({ amount: '12.50' }, 'BDT')).toBe(1250);
    expect(readCallbackAmount({ bet_amount: 12.5 }, 'BDT')).toBe(1250);
    expect(readCallbackAmount({ win_amount: '0.99' }, 'BDT')).toBe(99);
  });

  it('returns null when the payload carries no usable amount', () => {
    expect(readCallbackAmount({}, 'BDT')).toBeNull();
    expect(readCallbackAmount({ amount: 'not-a-number' }, 'BDT')).toBeNull();
    expect(readCallbackAmount({ amount: '1.005' }, 'BDT')).toBeNull();
  });
});
