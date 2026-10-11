import {
  extractRawJsonField,
  isRepresentableAmount,
  minorUnitsToProviderAmount,
  providerCurrencyExponent,
  signedDecimalToMinorUnits,
} from '../src/modules/winhouse/winhouse-money';

/**
 * WinHouse amount handling — the "amount exactly as sent" boundary.
 *
 * The provider expresses money as a SIGNED 2-decimal number (negative = stake,
 * positive = payout) and signs the literal it sent, so:
 *   - "-25.00" and "-25" must BOTH be readable as the same 500-decimal value,
 *   - but only the literal form is used for signing/verification,
 *   - and an amount that is not exactly representable (sub-cent, exponent
 *     notation, thousands separators, NaN) is refused rather than rounded.
 *
 * TANVION keeps integer MINOR UNITS internally; no floating point is used.
 */
describe('winhouse-money — signed decimal → minor units', () => {
  it('converts a negative stake to negative minor units', () => {
    expect(signedDecimalToMinorUnits('-25.00', 'BDT')).toBe(-2500);
    expect(signedDecimalToMinorUnits('-25', 'BDT')).toBe(-2500);
    expect(signedDecimalToMinorUnits(-25, 'BDT')).toBe(-2500);
    expect(signedDecimalToMinorUnits('-0.01', 'BDT')).toBe(-1);
  });

  it('converts a positive payout to positive minor units', () => {
    expect(signedDecimalToMinorUnits('250.00', 'BDT')).toBe(25000);
    expect(signedDecimalToMinorUnits('0.05', 'USD')).toBe(5);
    expect(signedDecimalToMinorUnits(12.5, 'EUR')).toBe(1250);
  });

  it('treats BDT, USD and EUR identically (all 2-decimal wallets)', () => {
    expect(providerCurrencyExponent('BDT')).toBe(2);
    expect(providerCurrencyExponent('usd')).toBe(2);
    expect(signedDecimalToMinorUnits('-1.00', 'EUR')).toBe(-100);
  });

  it('refuses anything that is not an exactly representable amount', () => {
    for (const value of ['-1.234', 'abc', 'NaN', '1e3', '+5', '', '   ', '1.2.3', '-']) {
      expect(signedDecimalToMinorUnits(value, 'BDT')).toBeNull();
    }
    expect(signedDecimalToMinorUnits(NaN, 'BDT')).toBeNull();
    expect(signedDecimalToMinorUnits(Infinity, 'BDT')).toBeNull();
    expect(signedDecimalToMinorUnits(null, 'BDT')).toBeNull();
    expect(signedDecimalToMinorUnits(undefined, 'BDT')).toBeNull();
    expect(signedDecimalToMinorUnits({}, 'BDT')).toBeNull();
  });

  it('reports representability without converting', () => {
    expect(isRepresentableAmount('-25.00', 'BDT')).toBe(true);
    expect(isRepresentableAmount('-25.001', 'BDT')).toBe(false);
  });
});

describe('winhouse-money — minor units → provider string', () => {
  it('renders the provider wire format (fixed 2 decimals, signed)', () => {
    expect(minorUnitsToProviderAmount(2500, 'BDT')).toBe('25.00');
    expect(minorUnitsToProviderAmount(-2500, 'BDT')).toBe('-25.00');
    expect(minorUnitsToProviderAmount(0, 'BDT')).toBe('0.00');
    expect(minorUnitsToProviderAmount(5, 'USD')).toBe('0.05');
    expect(minorUnitsToProviderAmount(-1, 'EUR')).toBe('-0.01');
  });

  it('round-trips through the signed parser for every supported currency', () => {
    for (const currency of ['BDT', 'USD', 'EUR']) {
      for (const minor of [-123456, -1, 0, 1, 99999]) {
        expect(signedDecimalToMinorUnits(minorUnitsToProviderAmount(minor, currency), currency)).toBe(
          minor,
        );
      }
    }
  });
});

describe('winhouse-money — raw wire amount extraction', () => {
  it('reads the literal amount as it appears in the JSON text', () => {
    expect(extractRawJsonField('{"amount":-25.00}', 'amount')).toBe('-25.00');
    expect(extractRawJsonField('{"amount": -25}', 'amount')).toBe('-25');
    expect(extractRawJsonField('{"amount":"-25.00"}', 'amount')).toBe('-25.00');
  });

  it('is not fooled by a same-named field inside a nested object or a string', () => {
    expect(extractRawJsonField('{"meta":{"amount":99},"amount":-25.00}', 'amount')).toBe('-25.00');
    expect(extractRawJsonField('{"note":"amount":-99,"amount":-25.00}', 'amount')).toBe('-25.00');
  });

  it('returns null when the field is absent or not a scalar', () => {
    expect(extractRawJsonField('{"other":1}', 'amount')).toBeNull();
    expect(extractRawJsonField('', 'amount')).toBeNull();
    expect(extractRawJsonField('{"amount":{"value":1}}', 'amount')).toBeNull();
  });
});
