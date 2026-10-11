import {
  buildCasinoSignatureHeaders,
  canonicalCasinoSigningPayload,
  CASINO_MERCHANT_HEADER,
  CASINO_NONCE_HEADER,
  CASINO_SIGN_HEADER,
  CASINO_TIMESTAMP_HEADER,
  CASINO_TIMESTAMP_TOLERANCE_SECONDS,
  newCasinoNonce,
  signCasinoPayload,
  verifyCasinoSignature,
  type CasinoCallbackHeaders,
} from '../src/modules/casino/casino-signature';

/**
 * Partner casino signature tests (HMAC-SHA1, Script.Casino-style).
 *
 * These cover the security boundary that guards every provider callback:
 * tampering, replay (stale timestamp), invalid nonce, merchant mismatch and
 * missing headers must all fail closed.
 */
const MERCHANT = 'merchant-abc';
const SECRET = 'super-secret-value';
const PATH = '/casino/callbacks/bet?x=1';
const BODY = JSON.stringify({ transaction_id: 'TX-1', amount_minor: 1000, currency: 'BDT' });
const REQUEST = { method: 'POST', path: PATH, rawBody: BODY };

function headersFor(now = Date.now(), overrides: Partial<CasinoCallbackHeaders> = {}): CasinoCallbackHeaders {
  const timestamp = String(Math.floor(now / 1000));
  const nonce = 'nonce-abcdefgh1234';
  const signature = signCasinoPayload(
    { merchantId: MERCHANT, timestamp, nonce, method: 'POST', path: PATH, rawBody: BODY },
    SECRET,
  );
  return { merchantId: MERCHANT, timestamp, nonce, signature, ...overrides };
}

describe('casino-signature — header contract', () => {
  it('uses the provider-specified header names', () => {
    expect(CASINO_MERCHANT_HEADER).toBe('x-merchant-id');
    expect(CASINO_TIMESTAMP_HEADER).toBe('x-timestamp');
    expect(CASINO_NONCE_HEADER).toBe('x-nonce');
    expect(CASINO_SIGN_HEADER).toBe('x-sign');
  });
});

describe('casino-signature — inbound verification', () => {
  it('accepts a correctly signed request', () => {
    expect(verifyCasinoSignature(headersFor(), MERCHANT, SECRET, REQUEST)).toEqual({ ok: true });
  });

  it('accepts a sha1= prefixed signature', () => {
    const headers = headersFor();
    expect(
      verifyCasinoSignature(
        { ...headers, signature: `sha1=${headers.signature}` },
        MERCHANT,
        SECRET,
        REQUEST,
      ),
    ).toEqual({ ok: true });
  });

  it('rejects a tampered body (amount changed in transit)', () => {
    expect(
      verifyCasinoSignature(headersFor(), MERCHANT, SECRET, {
        ...REQUEST,
        rawBody: BODY.replace('1000', '999000'),
      }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a tampered path', () => {
    expect(
      verifyCasinoSignature(headersFor(), MERCHANT, SECRET, {
        ...REQUEST,
        path: '/casino/callbacks/win',
      }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a tampered timestamp header (signature no longer matches)', () => {
    const headers = headersFor();
    expect(
      verifyCasinoSignature(
        { ...headers, timestamp: String(Number(headers.timestamp) + 1) },
        MERCHANT,
        SECRET,
        REQUEST,
      ),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });
  it('rejects an expired timestamp (replay)', () => {
    const now = Date.now();
    const stale = headersFor(now - (CASINO_TIMESTAMP_TOLERANCE_SECONDS + 30) * 1000);
    expect(verifyCasinoSignature(stale, MERCHANT, SECRET, REQUEST, now)).toEqual({
      ok: false,
      reason: 'stale_timestamp',
    });
  });

  it('rejects a non-numeric timestamp', () => {
    expect(
      verifyCasinoSignature(headersFor(undefined, { timestamp: 'nope' }), MERCHANT, SECRET, REQUEST),
    ).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  it('rejects an invalid nonce', () => {
    expect(
      verifyCasinoSignature(headersFor(undefined, { nonce: 'short' }), MERCHANT, SECRET, REQUEST),
    ).toEqual({ ok: false, reason: 'bad_nonce' });
  });

  it('rejects a missing nonce', () => {
    expect(
      verifyCasinoSignature(headersFor(undefined, { nonce: '' }), MERCHANT, SECRET, REQUEST),
    ).toEqual({ ok: false, reason: 'missing_nonce' });
  });

  it('rejects missing headers', () => {
    expect(verifyCasinoSignature({}, MERCHANT, SECRET, REQUEST)).toEqual({
      ok: false,
      reason: 'missing_headers',
    });
  });

  it('rejects a merchant mismatch even with an otherwise valid signature', () => {
    expect(verifyCasinoSignature(headersFor(), 'other-merchant', SECRET, REQUEST)).toEqual({
      ok: false,
      reason: 'merchant_mismatch',
    });
  });

  it('rejects when no secret is configured', () => {
    expect(verifyCasinoSignature(headersFor(), MERCHANT, '', REQUEST)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects a signature produced with the wrong secret', () => {
    const headers = headersFor();
    expect(
      verifyCasinoSignature(
        {
          ...headers,
          signature: signCasinoPayload(
            {
              merchantId: MERCHANT,
              timestamp: headers.timestamp ?? '',
              nonce: headers.nonce ?? '',
              method: 'POST',
              path: PATH,
              rawBody: BODY,
            },
            'wrong-secret',
          ),
        },
        MERCHANT,
        SECRET,
        REQUEST,
      ),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });
});

describe('casino-signature — outbound signing', () => {
  it('builds headers that verify against the same request', () => {
    const headers = buildCasinoSignatureHeaders(MERCHANT, SECRET, {
      method: 'GET',
      path: '/catalog/games',
      rawBody: '',
    });
    expect(headers[CASINO_MERCHANT_HEADER]).toBe(MERCHANT);
    expect(headers[CASINO_NONCE_HEADER]).toMatch(/^[0-9a-f]{32}$/);
    expect(
      verifyCasinoSignature(
        {
          merchantId: headers[CASINO_MERCHANT_HEADER],
          timestamp: headers[CASINO_TIMESTAMP_HEADER],
          nonce: headers[CASINO_NONCE_HEADER],
          signature: headers[CASINO_SIGN_HEADER],
        },
        MERCHANT,
        SECRET,
        { method: 'GET', path: '/catalog/games', rawBody: '' },
      ),
    ).toEqual({ ok: true });
  });

  it('uses a unique nonce per call', () => {
    expect(newCasinoNonce()).not.toBe(newCasinoNonce());
  });

  it('signs a canonical payload whose field order is fixed', () => {
    expect(
      canonicalCasinoSigningPayload({
        merchantId: 'm',
        timestamp: 't',
        nonce: 'n',
        method: 'post',
        path: '/p',
        rawBody: '{}',
      }),
    ).toBe('m\nt\nn\nPOST\n/p\n{}');
  });
});
