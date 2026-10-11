import {
  balanceChangeSignatureBase,
  hmacSha256Hex,
  launchTokenBase,
  mintLaunchToken,
  parseLaunchToken,
  safeEqual,
  signBalanceChange,
  signLaunchToken,
  verifyBalanceChangeSignature,
  verifyCallbackToken,
  verifyLaunchToken,
  type BalanceChangeSignatureFields,
} from '../src/modules/winhouse/winhouse-signature';

/**
 * WinHouse (embedded sportsbook, Model B) signature + token contract tests.
 *
 * These pin the PROVIDER'S WIRE CONTRACT — not our own idea of it:
 *
 *   balance-change signature
 *     base      = username + amount + action + ticket_id + transaction_id
 *                 (five fields, concatenated with NO separator, in that order)
 *     signature = HMAC_SHA256(base, WALLET_API_KEY).hex()
 *
 *   launch token
 *     base      = player_id + "|" + expiry + "|" + session
 *     signature = HMAC_SHA256(base, WALLET_API_KEY).hex()
 *     token     = player_id.expiry.session.signature   (≤ 10 minutes ahead)
 *
 * The expected hex digests below are FIXED LITERALS computed independently
 * (node's crypto) from the canonical strings, so a change to the field order,
 * the separator or the key usage fails here instead of failing in production
 * with every stake refused.
 *
 * Every secret in this file is a FAKE test value. The real wallet API key and
 * callback token never appear in the repository or in a test.
 */
const WALLET_API_KEY = 'winhouse-test-wallet-api-key';
const CALLBACK_TOKEN = 'winhouse-test-callback-token';
const PLAYER_ID = 'trwh0123456789abcdef0123456789abcd';

/** Independently computed digests (fake key) — the contract lock. */
const EXPECTED_BALANCE_CHANGE_SIGNATURE =
  '84ad880e02522401beea0dc8a80ece67f75a10c35bf8d79e8f3f5408322b51d8';
const EXPECTED_LAUNCH_SIGNATURE =
  'a171a472c801c28a65977a6385bb9fdf99d6c491740d50f411b0098f8d2234e4';

const BALANCE_FIELDS: BalanceChangeSignatureFields = {
  username: PLAYER_ID,
  amount: '-25.00',
  action: 'bet',
  ticketId: 'TICKET-1',
  transactionId: 'TX-1',
};

describe('winhouse-signature — balance-change canonical string', () => {
  it('concatenates the five documented fields in order with NO separator', () => {
    expect(balanceChangeSignatureBase(BALANCE_FIELDS)).toBe(`${PLAYER_ID}-25.00betTICKET-1TX-1`);
  });

  it('uses the amount EXACTLY as sent on the wire (no re-formatting)', () => {
    expect(balanceChangeSignatureBase({ ...BALANCE_FIELDS, amount: '-25' })).toBe(
      `${PLAYER_ID}-25betTICKET-1TX-1`,
    );
    expect(balanceChangeSignatureBase({ ...BALANCE_FIELDS, amount: '-25' })).not.toBe(
      balanceChangeSignatureBase(BALANCE_FIELDS),
    );
  });

  it('treats a missing field as an empty string (never the text "undefined")', () => {
    const base = balanceChangeSignatureBase({
      username: PLAYER_ID,
      amount: '10.00',
      action: 'win',
      ticketId: '',
      transactionId: 'TX-2',
    });
    expect(base).toBe(`${PLAYER_ID}10.00winTX-2`);
    expect(base).not.toContain('undefined');
  });
});

describe('winhouse-signature — balance-change signing', () => {
  it('produces the documented HMAC-SHA256 hex digest', () => {
    expect(signBalanceChange(BALANCE_FIELDS, WALLET_API_KEY)).toBe(
      EXPECTED_BALANCE_CHANGE_SIGNATURE,
    );
    expect(hmacSha256Hex(balanceChangeSignatureBase(BALANCE_FIELDS), WALLET_API_KEY)).toBe(
      EXPECTED_BALANCE_CHANGE_SIGNATURE,
    );
  });

  it('is lowercase hex of 64 characters', () => {
    expect(signBalanceChange(BALANCE_FIELDS, WALLET_API_KEY)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes when any signed field changes', () => {
    const variants: Array<Partial<BalanceChangeSignatureFields>> = [
      { username: 'trwhffffffffffffffffffffffffffff' },
      { amount: '-25.01' },
      { action: 'win' },
      { ticketId: 'TICKET-2' },
      { transactionId: 'TX-2' },
    ];
    for (const variant of variants) {
      expect(signBalanceChange({ ...BALANCE_FIELDS, ...variant }, WALLET_API_KEY)).not.toBe(
        EXPECTED_BALANCE_CHANGE_SIGNATURE,
      );
    }
  });
});

describe('winhouse-signature — balance-change verification', () => {
  const fields = {
    username: BALANCE_FIELDS.username,
    action: BALANCE_FIELDS.action,
    ticketId: BALANCE_FIELDS.ticketId,
    transactionId: BALANCE_FIELDS.transactionId,
  };

  it('accepts the signature over the amount exactly as it arrived on the wire', () => {
    expect(
      verifyBalanceChangeSignature(
        fields,
        ['-25.00'],
        EXPECTED_BALANCE_CHANGE_SIGNATURE,
        WALLET_API_KEY,
      ),
    ).toEqual({ ok: true });
  });

  it('accepts an equivalent parsed amount candidate (JSON -25 vs wire -25.00)', () => {
    const signature = signBalanceChange({ ...fields, amount: '-25' }, WALLET_API_KEY);
    expect(verifyBalanceChangeSignature(fields, ['-25', '-25.0'], signature, WALLET_API_KEY)).toEqual(
      { ok: true },
    );
  });

  it('rejects a signature made over a DIFFERENT amount representation', () => {
    const signature = signBalanceChange({ ...fields, amount: '-25' }, WALLET_API_KEY);
    expect(verifyBalanceChangeSignature(fields, ['-25.00'], signature, WALLET_API_KEY)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
  });

  it('rejects a tampered ticket id even though the amount and action match', () => {
    expect(
      verifyBalanceChangeSignature(
        { ...fields, ticketId: 'OTHER-TICKET' },
        ['-25.00'],
        EXPECTED_BALANCE_CHANGE_SIGNATURE,
        WALLET_API_KEY,
      ),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('accepts an upper-case signature (normalized to lowercase hex)', () => {
    expect(
      verifyBalanceChangeSignature(
        fields,
        ['-25.00'],
        EXPECTED_BALANCE_CHANGE_SIGNATURE.toUpperCase(),
        WALLET_API_KEY,
      ),
    ).toEqual({ ok: true });
  });

  it('rejects a missing signature before touching the key', () => {
    for (const provided of [null, undefined, '', '   ']) {
      expect(verifyBalanceChangeSignature(fields, ['-25.00'], provided, WALLET_API_KEY)).toEqual({
        ok: false,
        reason: 'signature_missing',
      });
    }
  });

  it('rejects when no wallet API key is configured (never a partial match)', () => {
    expect(
      verifyBalanceChangeSignature(fields, ['-25.00'], EXPECTED_BALANCE_CHANGE_SIGNATURE, null),
    ).toEqual({ ok: false, reason: 'wallet_key_missing' });
    expect(
      verifyBalanceChangeSignature(fields, ['-25.00'], EXPECTED_BALANCE_CHANGE_SIGNATURE, '  '),
    ).toEqual({ ok: false, reason: 'wallet_key_missing' });
  });

  it('rejects a signature produced with the callback token (it is not a signing key)', () => {
    expect(
      verifyBalanceChangeSignature(
        fields,
        ['-25.00'],
        signBalanceChange(BALANCE_FIELDS, CALLBACK_TOKEN),
        WALLET_API_KEY,
      ),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('never echoes a secret in a verdict', () => {
    const verdict = verifyBalanceChangeSignature(
      fields,
      ['-25.00'],
      EXPECTED_BALANCE_CHANGE_SIGNATURE,
      WALLET_API_KEY,
    );
    expect(JSON.stringify(verdict)).not.toContain(WALLET_API_KEY);
  });
});

describe('winhouse-signature — callback token (constant-time) authentication', () => {
  it('accepts the exact token', () => {
    expect(verifyCallbackToken(CALLBACK_TOKEN, CALLBACK_TOKEN)).toBe(true);
  });

  it('rejects a token that merely starts with the real one, or has extra characters', () => {
    expect(verifyCallbackToken(`${CALLBACK_TOKEN}x`, CALLBACK_TOKEN)).toBe(false);
    expect(verifyCallbackToken(CALLBACK_TOKEN.slice(0, -1), CALLBACK_TOKEN)).toBe(false);
  });

  it('rejects a token of a different LENGTH (the classic timing leak)', () => {
    expect(verifyCallbackToken('short', CALLBACK_TOKEN)).toBe(false);
    expect(safeEqual('short', CALLBACK_TOKEN)).toBe(false);
  });

  it('rejects empty/missing input on either side', () => {
    expect(verifyCallbackToken('', CALLBACK_TOKEN)).toBe(false);
    expect(verifyCallbackToken(null, CALLBACK_TOKEN)).toBe(false);
    expect(verifyCallbackToken(undefined, CALLBACK_TOKEN)).toBe(false);
    expect(verifyCallbackToken(CALLBACK_TOKEN, '')).toBe(false);
    expect(verifyCallbackToken(CALLBACK_TOKEN, null)).toBe(false);
  });

  it('compares case-sensitively (no accidental normalization)', () => {
    expect(verifyCallbackToken(CALLBACK_TOKEN.toUpperCase(), CALLBACK_TOKEN)).toBe(false);
  });

  it('tolerates surrounding whitespace on the CONFIGURED value only', () => {
    expect(verifyCallbackToken(CALLBACK_TOKEN, `  ${CALLBACK_TOKEN}  `)).toBe(true);
    expect(verifyCallbackToken(`  ${CALLBACK_TOKEN}  `, CALLBACK_TOKEN)).toBe(false);
  });
});

describe('winhouse-signature — launch token (Model B SSO)', () => {
  const expiry = 1_700_000_000_000;
  const session = 'session-1';
  const MAX_TTL = 10 * 60 * 1000;

  it('signs player_id|expiry|session — the ONLY place a separator is used', () => {
    expect(launchTokenBase(PLAYER_ID, expiry, session)).toBe(`${PLAYER_ID}|${expiry}|${session}`);
    expect(signLaunchToken(PLAYER_ID, expiry, session, WALLET_API_KEY)).toBe(
      EXPECTED_LAUNCH_SIGNATURE,
    );
  });

  it('mints a four-part token that verifies against the same key', () => {
    const { token, expiryMs } = mintLaunchToken({
      playerId: PLAYER_ID,
      walletApiKey: WALLET_API_KEY,
      session,
      ttlMs: 5 * 60 * 1000,
      maxTtlMs: MAX_TTL,
    });

    const parsed = parseLaunchToken(token);
    expect(parsed?.playerId).toBe(PLAYER_ID);
    expect(parsed?.expiryMs).toBe(expiryMs);
    expect(parsed?.session).toBe(session);
    expect(parsed?.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyLaunchToken({ token, walletApiKey: WALLET_API_KEY, maxTtlMs: MAX_TTL })).toEqual({
      ok: true,
      playerId: PLAYER_ID,
      expiryMs,
      session,
    });
  });

  it('clamps the lifetime to the provider maximum (never more than 10 minutes ahead)', () => {
    const now = 1_700_000_000_000;
    const { expiryMs } = mintLaunchToken({
      playerId: PLAYER_ID,
      walletApiKey: WALLET_API_KEY,
      session,
      ttlMs: 60 * 60 * 1000,
      maxTtlMs: MAX_TTL,
      now,
    });
    expect(expiryMs).toBe(now + MAX_TTL);
  });

  it('enforces a sane minimum lifetime', () => {
    const now = 1_700_000_000_000;
    const { expiryMs } = mintLaunchToken({
      playerId: PLAYER_ID,
      walletApiKey: WALLET_API_KEY,
      session,
      ttlMs: 10,
      maxTtlMs: MAX_TTL,
      now,
    });
    expect(expiryMs).toBe(now + 1000);
  });

  it('rejects an EXPIRED launch token', () => {
    const now = 1_700_000_000_000;
    const { token } = mintLaunchToken({
      playerId: PLAYER_ID,
      walletApiKey: WALLET_API_KEY,
      session,
      ttlMs: 5 * 60 * 1000,
      maxTtlMs: MAX_TTL,
      now,
    });
    expect(
      verifyLaunchToken({
        token,
        walletApiKey: WALLET_API_KEY,
        maxTtlMs: MAX_TTL,
        now: now + 5 * 60 * 1000 + 1,
      }),
    ).toEqual({ ok: false, reason: 'expired' });
  });

  it('rejects a token dated more than the maximum ahead of time', () => {
    const now = 1_700_000_000_000;
    const future = now + 11 * 60 * 1000;
    const token = `${PLAYER_ID}.${future}.${session}.${signLaunchToken(
      PLAYER_ID,
      future,
      session,
      WALLET_API_KEY,
    )}`;
    expect(
      verifyLaunchToken({ token, walletApiKey: WALLET_API_KEY, maxTtlMs: MAX_TTL, now }),
    ).toEqual({ ok: false, reason: 'ttl_exceeded' });
  });

  it('rejects a token signed with the wrong key or with a tampered session', () => {
    const now = Date.now();
    const wrongKey = signLaunchToken(PLAYER_ID, now + 60_000, session, CALLBACK_TOKEN);
    expect(
      verifyLaunchToken({
        token: `${PLAYER_ID}.${now + 60_000}.${session}.${wrongKey}`,
        walletApiKey: WALLET_API_KEY,
        maxTtlMs: MAX_TTL,
      }),
    ).toEqual({ ok: false, reason: 'bad_signature' });

    const { token } = mintLaunchToken({
      playerId: PLAYER_ID,
      walletApiKey: WALLET_API_KEY,
      session,
      ttlMs: 60_000,
      maxTtlMs: MAX_TTL,
    });
    const tampered = token.replace(`.${session}.`, '.other-session.');
    expect(
      verifyLaunchToken({ token: tampered, walletApiKey: WALLET_API_KEY, maxTtlMs: MAX_TTL }),
    ).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('rejects a malformed token and a token when no key is configured', () => {
    expect(parseLaunchToken('not-a-token')).toBeNull();
    expect(parseLaunchToken('a.b.c')).toBeNull();
    expect(parseLaunchToken(`${PLAYER_ID}.abc.${session}.sig`)).toBeNull();
    expect(parseLaunchToken(null)).toBeNull();
    expect(
      verifyLaunchToken({ token: 'not-a-token', walletApiKey: WALLET_API_KEY, maxTtlMs: MAX_TTL }),
    ).toEqual({ ok: false, reason: 'malformed_token' });
    expect(
      verifyLaunchToken({
        token: `${PLAYER_ID}.${Date.now() + 60_000}.${session}.sig`,
        walletApiKey: '',
        maxTtlMs: MAX_TTL,
      }),
    ).toEqual({ ok: false, reason: 'wallet_key_missing' });
  });

  it('supports an empty session (the token still has four parts)', () => {
    const { token } = mintLaunchToken({
      playerId: PLAYER_ID,
      walletApiKey: WALLET_API_KEY,
      session: '',
      ttlMs: 60_000,
      maxTtlMs: MAX_TTL,
    });
    expect(token.split('.')).toHaveLength(4);
    expect(verifyLaunchToken({ token, walletApiKey: WALLET_API_KEY, maxTtlMs: MAX_TTL })).toEqual({
      ok: true,
      playerId: PLAYER_ID,
      expiryMs: expect.any(Number),
      session: '',
    });
  });
});
