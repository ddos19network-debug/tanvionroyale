/* eslint-disable @typescript-eslint/no-explicit-any */
import express, { json, urlencoded } from 'express';
import request from 'supertest';
import { captureRawBody } from '../src/common/middleware/raw-body.middleware';
import { extractRawJsonField } from '../src/modules/winhouse/winhouse-money';
import {
  signBalanceChange,
  verifyBalanceChangeSignature,
} from '../src/modules/winhouse/winhouse-signature';

/**
 * REGRESSION — "the bet is accepted inside the embedded book but the TANVION
 * wallet is never debited".
 *
 * Provider callbacks (WinHouse `balance-change`, BigBang `balance-change`, the
 * casino wallet callbacks) verify an HMAC over the EXACT bytes the provider
 * signed. `main.ts` registers its own JSON parser during bootstrap, which is
 * BEFORE Nest's rawBody-enabled parser (registered at `app.init()`), and
 * body-parser never re-reads an already-consumed stream — so `req.rawBody` was
 * `undefined`, the controller parsed an empty string and answered
 * 400 `WINHOUSE_MALFORMED_BODY` to every stake.
 *
 * This spec reproduces main.ts's parser ORDER (ours first, Nest's afterwards)
 * and asserts the raw bytes — and therefore the signature — survive.
 */

const WALLET_API_KEY = 'wallet-api-key-for-raw-body-spec';
const USERNAME = 'trwh0123456789abcdef0123456789abcd';
const CALLBACK_PATH = '/api/v1/winhouse/balance-change';

/** The exact wire bytes a provider signs: note the whitespace and key order. */
function rawBody(amountLiteral: string, signature: string): string {
  return `{
  "username": "${USERNAME}",
  "amount": ${amountLiteral},
  "action": "bet",
  "ticket_id": "T-1",
  "transaction_id": "TX-1",
  "signature": "${signature}"
}`;
}

function sign(amount: string): string {
  return signBalanceChange(
    {
      username: USERNAME,
      amount,
      action: 'bet',
      ticketId: 'T-1',
      transactionId: 'TX-1',
    },
    WALLET_API_KEY,
  );
}


/**
 * Mirrors `main.ts` exactly:
 *  1. our own JSON parser, registered during bootstrap;
 *  2. our own urlencoded parser;
 *  3. Nest's rawBody-enabled parser, which `NestFactory.create(AppModule,
 *     { rawBody: true })` registers at `app.init()` — i.e. LAST.
 *
 * The route handler mirrors the real controller + wallet service: it reads
 * `req.rawBody`, extracts the amount LITERAL from those bytes and verifies the
 * five-field signature over it.
 */
function buildApp(captureHook: boolean) {
  const app = express();
  app.use(
    captureHook
      ? json({ limit: '10mb', verify: captureRawBody })
      : json({ limit: '10mb' }),
  );
  app.use(urlencoded({ limit: '10mb', extended: true, verify: captureRawBody }));
  app.use(
    json({
      verify: (req: any, _res: any, buf: Buffer) => {
        req.rawBody = buf;
      },
    }),
  );

  app.post(CALLBACK_PATH, (req: any, res) => {
    const raw = req.rawBody?.toString('utf8') ?? '';
    if (!raw) {
      // The controller's reliability guard: retryable, never a final refusal.
      res.status(503).json({ code: 'WINHOUSE_RAW_BODY_UNAVAILABLE' });
      return;
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const wireAmount = extractRawJsonField(raw, 'amount');
    const verdict = verifyBalanceChangeSignature(
      {
        username: String(parsed.username),
        action: String(parsed.action),
        ticketId: String(parsed.ticket_id),
        transactionId: String(parsed.transaction_id),
      },
      [wireAmount ?? ''],
      String(parsed.signature),
      WALLET_API_KEY,
    );

    if (!verdict.ok) {
      res.status(401).json({ code: 'WINHOUSE_BAD_SIGNATURE', reason: verdict.reason });
      return;
    }
    res.json({ status: 'ok', balance: '97.50', amount: wireAmount });
  });

  return app;
}

describe('provider callback raw body capture', () => {
  it('captures the exact bytes, so the five-field signature verifies', async () => {
    const body = rawBody('"-2.50"', sign('-2.50'));

    const response = await request(buildApp(true))
      .post(CALLBACK_PATH)
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', amount: '-2.50' });
  });

  it('preserves the amount LITERAL the provider signed (never re-serialized)', async () => {
    const body = rawBody('"2.5"', sign('2.5'));

    const response = await request(buildApp(true))
      .post(CALLBACK_PATH)
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(200);
    // "2.5" must NOT be normalized to "2.50" before verification, or the HMAC
    // (which the provider computed over "2.5") could never match.
    expect(response.body.amount).toBe('2.5');
  });

  it('refuses a body whose amount literal was changed after signing', async () => {
    // Signed over "2.5", delivered as "2.50": a different byte sequence.
    const body = rawBody('"2.50"', sign('2.5'));

    const response = await request(buildApp(true))
      .post(CALLBACK_PATH)
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('WINHOUSE_BAD_SIGNATURE');
  });

  it('answers 503 (retryable) when the raw body was never captured — the regression', async () => {
    const body = rawBody('"-2.50"', sign('-2.50'));

    // Without `verify: captureRawBody` the bootstrap parser consumes the stream
    // first and Nest's hook never fires: exactly the production failure.
    const response = await request(buildApp(false))
      .post(CALLBACK_PATH)
      .set('Content-Type', 'application/json')
      .send(body);

    expect(response.status).toBe(503);
    expect(response.body.code).toBe('WINHOUSE_RAW_BODY_UNAVAILABLE');
  });

  it('captures the signed bytes even when the provider labels them differently', async () => {
    const app = express();
    // The global parsers only accept JSON media types ...
    app.use(json({ limit: '10mb', verify: captureRawBody }));
    // ... so main.ts also registers a route-scoped capture that accepts ANY
    // label on the signed callback route only.
    app.use(
      `${CALLBACK_PATH}`,
      json({ type: () => true, limit: '10mb', verify: captureRawBody }),
    );
    app.post(CALLBACK_PATH, (req: any, res) => {
      res.json({ raw: req.rawBody?.toString('utf8') ?? null });
    });

    const payload = '{"amount":"-2.50"}';
    const response = await request(app)
      .post(CALLBACK_PATH)
      .set('Content-Type', 'text/plain')
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body.raw).toBe(payload);
  });

  it('captures raw bytes for form-encoded posts too (same shared hook)', async () => {
    const app = express();
    app.use(urlencoded({ limit: '10mb', extended: true, verify: captureRawBody }));
    app.post('/echo', (req: any, res) => {
      res.json({ raw: req.rawBody?.toString('utf8') ?? null });
    });

    const response = await request(app)
      .post('/echo')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send('token=abc&username=trwh1');

    expect(response.status).toBe(200);
    expect(response.body.raw).toBe('token=abc&username=trwh1');
  });
});
