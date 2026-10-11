/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * BIGBANG WEBHOOK — the security, replay and idempotency boundary.
 *
 * These tests exercise the REAL service and the REAL shared verification
 * module (only the Prisma client is stubbed, exactly like the existing
 * `bigbang-wallet.spec.ts` harness), so they prove the actual contract rather
 * than a mock's.
 *
 * WHAT IS PINNED HERE
 *   1. valid HMAC / 2. invalid HMAC / 3. missing secret / 4. wrong secret
 *   5. modified body / 6. stale timestamp / 7. duplicate event
 *   8. the three documented events, and refusal of anything else
 *   9. a safe error response / 10. no wallet effect / 11. the wallet API key
 *      does not authenticate the webhook
 */
import { createHmac } from 'node:crypto';
import { Prisma } from '../src/generated/prisma';
import { BigBangWebhookService } from '../src/modules/bigbang/bigbang-webhook.service';
import { BigBangWebhookController } from '../src/modules/bigbang/bigbang-webhook.controller';
import {
  computeWebhookSignature,
  hashWebhookPayload,
  redactWebhookPayload,
  verifyWebhookSignature,
} from '../src/modules/webhooks/webhook-security';
import { WebhookIdempotencyService } from '../src/modules/webhooks/webhook-idempotency.service';
import { decryptSecret, encryptSecret } from '../src/common/utils/encryption';
import type { PrismaService } from '../src/database/prisma.service';

const WEBHOOK_SECRET = 'bb-webhook-secret-do-not-leak';
const WALLET_API_KEY = 'bb-wallet-api-key-must-not-authenticate-webhooks';
const PROVIDER_ID = 'provider-row-1';

interface EventRow {
  id: string;
  provider: string;
  eventId: string;
  eventType: string;
  status: string;
  requestId: string | null;
  payloadHash: string;
  payload: unknown;
  errorCode: string | null;
}

function makeHarness(options: { secret?: string | null } = {}) {
  const secret = options.secret === undefined ? WEBHOOK_SECRET : options.secret;
  const events = new Map<string, EventRow>();
  const auditLogs: Array<Record<string, any>> = [];
  let seq = 0;

  const prisma: any = {
    partnerProvider: {
      findMany: jest.fn(async () => [
        {
          id: PROVIDER_ID,
          environment: 'sandbox',
          webhookSecretEnc: secret ? encryptSecret(secret) : null,
        },
      ]),
    },
    providerWebhookEvent: {
      create: jest.fn(async ({ data }: { data: any }) => {
        const key = `${data.provider}:${data.eventId}`;
        if (events.has(key)) {
          // Emulate the Prisma unique violation the service relies on. It must
          // be a REAL PrismaClientKnownRequestError, because that is what the
          // service's `instanceof` guard checks.
          throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
            code: 'P2002',
            clientVersion: '5.22.0',
          });
        }
        const row: EventRow = {
          id: `evt-${++seq}`,
          provider: data.provider,
          eventId: data.eventId,
          eventType: data.eventType,
          status: data.status,
          requestId: data.requestId ?? null,
          payloadHash: data.payloadHash,
          payload: data.payload ?? null,
          errorCode: data.errorCode ?? null,
        };
        events.set(key, row);
        return { id: row.id };
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const row = events.get(
          `${where.provider_eventId.provider}:${where.provider_eventId.eventId}`,
        );
        return row ? { id: row.id, status: row.status } : null;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = [...events.values()].find((r) => r.id === where.id);
        if (row) row.status = data.status;
        return { id: where.id };
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        auditLogs.push(data);
        return data;
      }),
    },
  };

  const idempotency = new WebhookIdempotencyService(prisma as PrismaService);
  const service = new BigBangWebhookService(prisma as PrismaService, idempotency);
  const controller = new BigBangWebhookController(service);

  return {
    service,
    controller,
    prisma,
    auditLogs,
    eventsFor: () => [...events.values()],
    processed: () => [...events.values()].filter((e) => e.status === 'PROCESSED'),
  };
}

const body = (payload: unknown) => JSON.stringify(payload);

function sign(raw: string, secret = WEBHOOK_SECRET): Record<string, string> {
  return { 'x-bigbang-signature': createHmac('sha256', secret).update(raw, 'utf8').digest('hex') };
}

const request = (raw: string) => ({ rawBody: Buffer.from(raw, 'utf8'), requestId: 'req-1' }) as any;

function refusalOf(error: unknown) {
  const exception = error as { getStatus?: () => number; getResponse?: () => any };
  return { status: exception.getStatus?.(), body: exception.getResponse?.() };
}

/**
 * A refusal is a THROWN HttpException (that is what produces the real HTTP
 * status), so every negative test must await the rejection and inspect it.
 */
async function refusalFrom(run: Promise<unknown>) {
  try {
    await run;
  } catch (error) {
    return refusalOf(error);
  }
  throw new Error('expected the webhook to be refused, but it succeeded');
}

beforeEach(() => {
  process.env.BIGBANG_ENV = 'sandbox';
});

describe('BigBang webhook — signature verification', () => {
  it('1. accepts a valid HMAC and records the event as processed', async () => {
    const h = makeHarness();
    const raw = body({ event: 'session.started', username: 'player-1', session_id: 's-1' });

    const ack = await h.controller.receive(request(raw), sign(raw));

    expect(ack).toEqual({ status: 'ok', event: 'session.started', duplicate: false });
    const [row] = h.eventsFor();
    expect(row.status).toBe('PROCESSED');
    expect(row.payloadHash).toBe(hashWebhookPayload(raw));
  });

  it('2. refuses an invalid HMAC and processes nothing', async () => {
    const h = makeHarness();
    const raw = body({ event: 'session.started' });

    const refusal = await refusalFrom(
      h.controller.receive(request(raw), { 'x-bigbang-signature': 'a'.repeat(64) }),
    );

    expect(refusal.status).toBe(401);
    expect(refusal.body.code).toBe('BAD_SIGNATURE');
    expect(h.processed()).toHaveLength(0);
  });

  it('3. refuses with 503 when no webhook secret is configured', async () => {
    const h = makeHarness({ secret: null });
    const raw = body({ event: 'session.started' });

    const refusal = await refusalFrom(h.controller.receive(request(raw), sign(raw)));

    expect(refusal.status).toBe(503);
    expect(refusal.body.code).toBe('BIGBANG_WEBHOOK_NOT_CONFIGURED');
    expect(h.processed()).toHaveLength(0);
  });

  it('4. refuses a signature made with a DIFFERENT secret', async () => {
    const h = makeHarness();
    const raw = body({ event: 'session.ended' });

    const refusal = await refusalFrom(h.controller.receive(request(raw), sign(raw, 'other-secret')));

    expect(refusal.status).toBe(401);
    expect(h.processed()).toHaveLength(0);
  });

  it('5. a MODIFIED body is refused — the raw bytes are what is signed', async () => {
    const h = makeHarness();
    const signed = body({ event: 'round.completed', round_id: 'r-1' });
    const headers = sign(signed);
    // The attacker swaps the body but keeps the original signature.
    const tampered = body({ event: 'round.completed', round_id: 'r-2' });

    const refusal = await refusalFrom(h.controller.receive(request(tampered), headers));

    expect(refusal.status).toBe(401);
    expect(h.processed()).toHaveLength(0);
  });

  it('5b. a missing signature header is refused', async () => {
    const h = makeHarness();
    const raw = body({ event: 'session.started' });

    const refusal = await refusalFrom(h.controller.receive(request(raw), {}));

    expect(refusal.status).toBe(401);
    expect(refusal.body.code).toBe('MISSING_SIGNATURE');
  });

  it('6. refuses a STALE timestamp outside the replay window', async () => {
    const h = makeHarness();
    const raw = body({ event: 'session.started' });
    const stale = String(Math.floor(Date.now() / 1000) - 4000);

    const refusal = await refusalFrom(
      h.controller.receive(request(raw), {
        ...sign(raw),
        'x-bigbang-timestamp': stale,
      }),
    );

    expect(refusal.status).toBe(401);
    expect(refusal.body.code).toBe('STALE_TIMESTAMP');
    expect(h.processed()).toHaveLength(0);
  });

  it('6b. accepts a FRESH timestamp inside the replay window', async () => {
    const h = makeHarness();
    const raw = body({ event: 'session.started' });

    const ack = await h.controller.receive(request(raw), {
      ...sign(raw),
      'x-bigbang-timestamp': String(Math.floor(Date.now() / 1000) - 10),
    });

    expect(ack.duplicate).toBe(false);
  });

  it('7. a REPLAYED delivery is a duplicate and is processed exactly once', async () => {
    const h = makeHarness();
    const raw = body({ event: 'round.completed', round_id: 'r-1', event_id: 'evt-1' });
    const headers = sign(raw);

    const first = await h.controller.receive(request(raw), headers);
    const second = await h.controller.receive(request(raw), headers);
    const third = await h.controller.receive(request(raw), headers);

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(third.duplicate).toBe(true);
    expect(h.eventsFor().filter((e) => e.eventId === 'evt-1')).toHaveLength(1);
    expect(h.processed()).toHaveLength(1);
  });

  it('7b. a derived idempotency key de-duplicates a provider that sends no event id', async () => {
    const h = makeHarness();
    const raw = body({ event: 'round.completed', username: 'p1', round_id: 'r-9' });
    const headers = sign(raw);

    expect((await h.controller.receive(request(raw), headers)).duplicate).toBe(false);
    expect((await h.controller.receive(request(raw), headers)).duplicate).toBe(true);
    expect(h.processed()).toHaveLength(1);
  });

  it('7c. TWO DIFFERENT rounds never collide on the derived key', async () => {
    const h = makeHarness();
    const a = body({ event: 'round.completed', username: 'p1', round_id: 'r-1' });
    const b = body({ event: 'round.completed', username: 'p1', round_id: 'r-2' });

    expect((await h.controller.receive(request(a), sign(a))).duplicate).toBe(false);
    expect((await h.controller.receive(request(b), sign(b))).duplicate).toBe(false);
  });
});

describe('BigBang webhook — documented events', () => {
  it.each(['session.started', 'session.ended', 'round.completed'])(
    '8. accepts the documented event %s',
    async (event) => {
      const h = makeHarness();
      const raw = body({ event, session_id: 's-1' });

      const ack = await h.controller.receive(request(raw), sign(raw));

      expect(ack).toEqual({ status: 'ok', event, duplicate: false });
    },
  );

  it('8b. refuses an UNDOCUMENTED event instead of guessing', async () => {
    const h = makeHarness();
    const raw = body({ event: 'balance.changed', amount: 1000 });

    const refusal = await refusalFrom(h.controller.receive(request(raw), sign(raw)));

    expect(refusal.status).toBe(400);
    expect(refusal.body.code).toBe('BIGBANG_WEBHOOK_UNSUPPORTED_EVENT');
  });

  it('8c. refuses a malformed body only AFTER the signature is verified', async () => {
    const h = makeHarness();
    const bad = '{not json';
    // A bad signature on a malformed body stays 401 — the check comes first.
    const unauth = await refusalFrom(
      h.controller.receive(request(bad), { 'x-bigbang-signature': 'b'.repeat(64) }),
    );
    expect(unauth.status).toBe(401);

    const auth = await refusalFrom(h.controller.receive(request(bad), sign(bad)));
    expect(auth.status).toBe(400);
    expect(auth.body.code).toBe('BIGBANG_WEBHOOK_MALFORMED_BODY');
  });
});

describe('BigBang webhook — no wallet effect and no leakage', () => {
  it('9. the error response never contains the secret, signature or raw body', async () => {
    const h = makeHarness();
    const raw = body({ event: 'session.started' });

    const refusal = await refusalFrom(
      h.controller.receive(request(raw), { 'x-bigbang-signature': 'c'.repeat(64) }),
    );
    const serialised = JSON.stringify(refusal.body);

    expect(serialised).not.toContain(WEBHOOK_SECRET);
    expect(serialised).not.toContain('c'.repeat(64));
    expect(serialised).not.toContain('session.started');
  });

  it('10. a stored payload is redacted, so an echoed credential is never persisted', async () => {
    const h = makeHarness();
    const raw = body({
      event: 'session.started',
      session_id: 's-1',
      api_key: WALLET_API_KEY,
      authorization: 'Bearer super-secret',
    });

    await h.controller.receive(request(raw), sign(raw));

    const [row] = h.eventsFor();
    const stored = JSON.stringify(row.payload);
    expect(stored).not.toContain(WALLET_API_KEY);
    expect(stored).not.toContain('super-secret');
    expect(stored).toContain('[redacted]');
  });

  it('10b. the audit trail never contains the secret or an expected signature', async () => {
    const h = makeHarness();
    const raw = body({ event: 'session.started' });
    await h.controller.receive(request(raw), sign(raw));

    const serialised = JSON.stringify(h.auditLogs);
    expect(serialised).not.toContain(WEBHOOK_SECRET);
    expect(serialised).not.toContain(computeWebhookSignature(raw, WEBHOOK_SECRET));
  });

  it('11. the wallet API key does NOT authenticate the webhook', async () => {
    const h = makeHarness();
    const raw = body({ event: 'session.started' });

    // Signed with the wallet key, not the webhook secret.
    const refusal = await refusalFrom(h.controller.receive(request(raw), sign(raw, WALLET_API_KEY)));

    expect(refusal.status).toBe(401);
    expect(h.processed()).toHaveLength(0);
  });

  it('11b. the configured webhook secret is genuinely encrypted at rest', () => {
    expect(encryptSecret(WEBHOOK_SECRET)).not.toContain(WEBHOOK_SECRET);
    expect(decryptSecret(encryptSecret(WEBHOOK_SECRET))).toBe(WEBHOOK_SECRET);
  });
});

describe('shared webhook security primitives', () => {
  it('computes a hex HMAC-SHA256 over the exact bytes', () => {
    const raw = '{"a":1}';
    expect(computeWebhookSignature(raw, 's')).toBe(
      createHmac('sha256', 's').update(raw, 'utf8').digest('hex'),
    );
  });

  it('rejects a malformed (non-64-hex) signature without comparing', () => {
    expect(verifyWebhookSignature('x', 's', 'short')).toEqual({
      ok: false,
      reason: 'MALFORMED_SIGNATURE',
    });
  });

  it('treats an absent secret as a bad signature (no configuration oracle)', () => {
    expect(verifyWebhookSignature('x', '', 'a'.repeat(64))).toEqual({
      ok: false,
      reason: 'BAD_SIGNATURE',
    });
  });

  it('tolerates a sha256= prefix', () => {
    const raw = 'body';
    const hex = computeWebhookSignature(raw, 's');
    expect(verifyWebhookSignature(raw, 's', `sha256=${hex}`).ok).toBe(true);
  });

  it('bounds and redacts nested payloads', () => {
    const deep: any = { a: { b: { c: { d: { e: 'too deep' } } } } };
    expect(JSON.stringify(redactWebhookPayload(deep, 3, 5, 20))).toContain('[truncated]');

    const long = redactWebhookPayload({ note: 'x'.repeat(500) }, 4, 10, 20) as any;
    expect(long.note.length).toBeLessThanOrEqual(21);
  });
});

describe('idempotency key derivation', () => {
  it('uses a provider event id verbatim when one is supplied', () => {
    expect(
      WebhookIdempotencyService.deriveEventId({ eventId: 'evt-1', eventType: 'session.ended' }),
    ).toBe('evt-1');
  });

  it('derives a stable key from immutable fields when none is supplied', () => {
    const input = {
      eventType: 'round.completed',
      username: 'p1',
      roundId: 'r-1',
      providerTimestamp: '1000',
    };
    const first = WebhookIdempotencyService.deriveEventId(input);
    const second = WebhookIdempotencyService.deriveEventId({ ...input });
    expect(first).toBe(second);
    expect(first).toMatch(/^derived:[0-9a-f]{64}$/);
  });

  it('is NOT timestamp-only: two rounds in the same second stay distinct', () => {
    const a = WebhookIdempotencyService.deriveEventId({
      eventType: 'round.completed',
      roundId: 'r-1',
      providerTimestamp: '1000',
    });
    const b = WebhookIdempotencyService.deriveEventId({
      eventType: 'round.completed',
      roundId: 'r-2',
      providerTimestamp: '1000',
    });
    expect(a).not.toBe(b);
  });
});

