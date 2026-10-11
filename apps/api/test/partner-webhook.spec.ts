/* eslint-disable @typescript-eslint/no-explicit-any */
import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import {
  PartnerController,
} from '../src/modules/partner/partner.controller';
import {
  computePartnerSignature,
  verifyPartnerWebhookSignature,
} from '../src/modules/partner/webhook-signature';
import { UnconfiguredOperatorAdapter } from '@tanvion-royale/integrations';
import { createBettingProvider } from '../src/modules/betting/betting-provider.factory';

const ENV = process.env;

afterEach(() => {
  process.env = ENV;
  jest.restoreAllMocks();
});

function withEnv(overrides: Record<string, string | undefined>) {
  process.env = { ...ENV, NODE_ENV: 'production', ...overrides };
}

function makePrismaFake() {
  return {
    auditLog: { create: jest.fn(async ({ data }: any) => ({ id: 'a1', ...data })) },
  } as any;
}

describe('Partner webhook signature verification (contract)', () => {
  const secret = 'test-webhook-secret';
  const body = Buffer.from('{"type":"settlement.created","eventId":"e1"}');

  it('accepts a correctly signed payload (HMAC-SHA256 over raw bytes)', () => {
    const signature = computePartnerSignature(body, secret);
    const verdict = verifyPartnerWebhookSignature(
      body,
      secret,
      `sha256=${signature}`,
      String(Math.floor(Date.now() / 1000)),
    );
    expect(verdict).toEqual({ ok: true });
  });

  it('rejects a tampered payload, wrong secret and missing signature', () => {
    const signature = computePartnerSignature(body, secret);
    const tampered = Buffer.from('{"type":"settlement.created","eventId":"e2"}');
    expect(
      verifyPartnerWebhookSignature(tampered, secret, `sha256=${signature}`).ok,
    ).toBe(false);
    expect(
      verifyPartnerWebhookSignature(body, 'other-secret', `sha256=${signature}`).ok,
    ).toBe(false);
    expect(verifyPartnerWebhookSignature(body, secret, undefined).ok).toBe(false);
  });

  it('rejects stale timestamps (replay protection)', () => {
    const signature = computePartnerSignature(body, secret);
    const stale = String(Math.floor(Date.now() / 1000) - 3600);
    const verdict = verifyPartnerWebhookSignature(body, secret, `sha256=${signature}`, stale);
    expect(verdict).toEqual({ ok: false, reason: 'stale_timestamp' });
  });
});

describe('Partner webhook endpoint (fail-safe provider boundary)', () => {
  function makeController(provider: any) {
    return new PartnerController(provider, makePrismaFake());
  }

  function rawRequest(rawBody: Buffer): any {
    return { rawBody, body: JSON.parse(rawBody.toString('utf8')) };
  }

  it('accepts a signed webhook and dispatches to the configured provider', async () => {
    withEnv({ OPERATOR_WEBHOOK_SECRET: 'shared-secret' });
    const handleWebhook = jest.fn(async () => ({ ok: true }));
    const controller = makeController({ handleWebhook } as any);
    const raw = Buffer.from('{"type":"settlement.created","eventId":"evt-1"}');

    const res = await controller.receiveWebhook(
      rawRequest(raw),
      `sha256=${computePartnerSignature(raw, 'shared-secret')}`,
      String(Math.floor(Date.now() / 1000)),
    );

    expect(res.received).toBe(true);
    expect(handleWebhook).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'settlement.created' }),
    );
  });

  it('rejects an invalid signature with 401 before touching the provider', async () => {
    withEnv({ OPERATOR_WEBHOOK_SECRET: 'shared-secret' });
    const handleWebhook = jest.fn();
    const controller = makeController({ handleWebhook } as any);
    const raw = Buffer.from('{"type":"settlement.created","eventId":"evt-1"}');

    await expect(
      controller.receiveWebhook(rawRequest(raw), 'sha256=deadbeef', undefined),
    ).rejects.toThrow(UnauthorizedException);
    expect(handleWebhook).not.toHaveBeenCalled();
  });

  it('fails safely with "Provider temporarily unavailable" when no secret is configured', async () => {
    withEnv({ OPERATOR_WEBHOOK_SECRET: '' });
    const controller = makeController(new UnconfiguredOperatorAdapter());
    const raw = Buffer.from('{"type":"settlement.created","eventId":"evt-1"}');

    await expect(
      controller.receiveWebhook(rawRequest(raw), 'sha256=aa', undefined),
    ).rejects.toThrow(ServiceUnavailableException);
    await expect(
      controller.receiveWebhook(rawRequest(raw), 'sha256=aa', undefined),
    ).rejects.toThrow('Provider temporarily unavailable');
  });

  it('public status reports availability without exposing secrets', () => {
    withEnv({ OPERATOR_PROVIDER: '' });
    const controller = makeController(new UnconfiguredOperatorAdapter());
    const status = controller.partnerStatus();
    expect(status.available).toBe(false);
    expect(status.message).toBe('Provider temporarily unavailable');
    expect(JSON.stringify(status)).not.toMatch(/secret|key|url/i);
  });

  it('provider factory still fails safely in production without configuration', () => {
    withEnv({ OPERATOR_PROVIDER: '' });
    const provider = createBettingProvider();
    expect(provider).toBeInstanceOf(UnconfiguredOperatorAdapter);
  });
});