/**
 * BigBang webhook service — the provider-specific adapter.
 *
 * This is a THIN layer. It owns only what is genuinely BigBang-specific:
 *   - the three DOCUMENTED event names (`session.started`, `session.ended`,
 *     `round.completed`) and how to read them out of the payload;
 *   - resolving the BigBang provider row and its WEBHOOK secret.
 *
 * Everything else — signature verification, replay window, idempotency,
 * event storage, audit — is the shared `webhook-security` /
 * `WebhookIdempotencyService`, exactly as a future provider would.
 *
 * WALLET SAFETY — THE MOST IMPORTANT RULE IN THIS FILE
 * ----------------------------------------------------
 * The BigBang documentation (repo: bigbang-agent.tmp.md, section 4) states the
 * webhooks are "optional, separate from the money path" and must be treated
 * as notifications only. Accordingly:
 *
 *   - `round.completed` does NOT debit, credit, reserve or refund anything.
 *   - It is recorded as a reconciliation/audit event and nothing more.
 *   - Money moves ONLY through the existing seamless-wallet
 *     `POST /bigbang/callbacks/balance-change` route, which is unchanged and
 *     remains the single money-moving entry point.
 *
 * This service therefore has NO dependency on `WalletService`, `Wallet` or
 * `WalletTransaction`, and a duplicated delivery can never double-settle.
 */
import { HttpException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { decryptSecret } from '../../common/utils/encryption';
import { BIGBANG_PROVIDER_CODE, loadBigBangEnvConfig } from './bigbang.config';
import {
  hashWebhookPayload,
  readFirstHeader,
  verifyWebhookSignature,
  WEBHOOK_SIGNATURE_HEADERS,
  WEBHOOK_TIMESTAMP_HEADERS,
  type WebhookVerificationVerdict,
} from '../webhooks/webhook-security';
import { WebhookIdempotencyService } from '../webhooks/webhook-idempotency.service';

/** The ONLY documented BigBang webhook events. Nothing else is accepted. */
export const BIGBANG_WEBHOOK_EVENTS = [
  'session.started',
  'session.ended',
  'round.completed',
] as const;

export type BigBangWebhookEventType = (typeof BIGBANG_WEBHOOK_EVENTS)[number];

/** Provider-facing response. Never contains a secret or an internal id. */
export interface BigBangWebhookAck {
  status: 'ok';
  event: BigBangWebhookEventType;
  /** True when this exact delivery was already processed. */
  duplicate: boolean;
}

@Injectable()
export class BigBangWebhookService {
  private readonly logger = new Logger(BigBangWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly idempotency: WebhookIdempotencyService,
  ) {}

  /**
   * Handles one `POST /bigbang/webhooks` delivery.
   *
   * ORDER OF OPERATIONS (deliberate):
   *   1. read the EXACT raw body (the signed message);
   *   2. resolve the provider + decrypt the webhook secret;
   *   3. verify the signature over the raw bytes, with a replay window when a
   *      timestamp is supplied;
   *   4. parse the JSON and validate the event name;
   *   5. claim the event (idempotency) — a duplicate does no further work;
   *   6. record the event and flip it to PROCESSED.
   *
   * No step before (5) can move money, and no step after (5) runs twice.
   */
  async handle(input: {
    rawBody: string;
    headers: Record<string, string | undefined>;
    requestId: string | null;
  }): Promise<BigBangWebhookAck> {
    const rawBody = input.rawBody;
    const payloadHash = hashWebhookPayload(rawBody);

    // ---- 2. provider + webhook secret -------------------------------------
    const provider = await this.resolveProvider();
    if (!provider) {
      this.refuse(input, {
        providerId: null,
        eventType: 'unknown',
        payloadHash,
        status: 503,
        code: 'BIGBANG_WEBHOOK_NOT_CONFIGURED',
        message: 'BigBang webhooks are not configured for this environment',
      });
    }
    // The WEBHOOK secret only. It is a different credential from the wallet API
    // key, and there is deliberately NO fallback to that key.
    const secret = decryptSecret(provider!.webhookSecretEnc ?? '');
    if (!secret) {
      this.refuse(input, {
        providerId: provider!.id,
        eventType: 'unknown',
        payloadHash,
        status: 503,
        code: 'BIGBANG_WEBHOOK_NOT_CONFIGURED',
        message: 'BigBang webhook secret is not configured',
      });
    }

    // ---- 3. signature over the EXACT raw bytes ----------------------------
    const signatureHeader = readFirstHeader(input.headers, WEBHOOK_SIGNATURE_HEADERS);
    const timestampHeader = readFirstHeader(input.headers, WEBHOOK_TIMESTAMP_HEADERS);
    const verdict: WebhookVerificationVerdict = verifyWebhookSignature(
      rawBody,
      secret!,
      signatureHeader,
      timestampHeader,
    );
    if (!verdict.ok) {
      // The signature is checked BEFORE the body is parsed, so a malformed or
      // hostile body can never reach any business logic.
      this.refuse(input, {
        providerId: provider!.id,
        eventType: 'unknown',
        payloadHash,
        status: 401,
        code: verdict.reason,
        message: 'Invalid webhook signature',
      });
    }

    // ---- 4. parse + validate the event name -------------------------------
    const payload = this.parseOrRefuse(input, {
      providerId: provider!.id,
      payloadHash,
    });

    const eventType = this.readEventType(payload);
    if (!eventType) {
      // `refuse` always throws; it is typed `Promise<never>` and the throw is
      // made directly here so the control flow is unambiguous to the compiler.
      this.refuse(input, {
        providerId: provider!.id,
        eventType: 'unknown',
        payloadHash,
        status: 400,
        code: 'BIGBANG_WEBHOOK_UNSUPPORTED_EVENT',
        message: 'Unsupported event type',
      });
    }

    // ---- 5. idempotency claim ---------------------------------------------
    const username = this.readString(payload, ['username', 'user', 'player', 'player_id']);
    const sessionId = this.readString(payload, ['session_id', 'sessionId', 'session']);
    const roundId = this.readString(payload, ['round_id', 'roundId', 'round']);
    const eventId = WebhookIdempotencyService.deriveEventId({
      eventId: this.readString(payload, ['event_id', 'eventId', 'id']),
      eventType: eventType!,
      username,
      sessionId,
      roundId,
      providerTimestamp:
        this.readString(payload, ['timestamp', 'created_at', 'occurred_at']) ?? timestampHeader,
    });

    const claim = await this.idempotency.claim(
      {
        provider: BIGBANG_PROVIDER_CODE,
        providerId: provider!.id,
        eventId,
        eventType: eventType!,
        payloadHash,
        rawBody,
        requestId: input.requestId,
      },
      payload,
    );

    if (!claim.claimed) {
      // A retried delivery. Answer 200 so the provider stops retrying, and do
      // NO further work — this is what makes a replayed `round.completed`
      // completely inert.
      this.logger.log(
        `bigbang.webhook event=${eventType} outcome=duplicate requestId=${input.requestId ?? 'none'}`,
      );
      await this.idempotency.audit({
        provider: BIGBANG_PROVIDER_CODE,
        action: 'BIGBANG_WEBHOOK_DUPLICATE',
        entityType: 'ProviderWebhookEvent',
        entityId: claim.eventId,
        requestId: input.requestId,
        data: { eventType: eventType!, providerId: provider!.id },
      });
      return { status: 'ok', event: eventType!, duplicate: true };
    }

    // ---- 6. record --------------------------------------------------------
    // INFORMATIONAL ONLY. See the WALLET SAFETY note at the top of the file:
    // no wallet is read or written here, for any event type.
    await this.idempotency.markProcessed(claim.eventId);
    await this.idempotency.audit({
      provider: BIGBANG_PROVIDER_CODE,
      action: 'BIGBANG_WEBHOOK_ACCEPTED',
      entityType: 'ProviderWebhookEvent',
      entityId: claim.eventId,
      requestId: input.requestId,
      data: {
        eventType: eventType!,
        providerId: provider!.id,
        // Player/session/round identifiers only. No balance, no amount.
        username: username ?? null,
        sessionId: sessionId ?? null,
        roundId: roundId ?? null,
        walletEffect: 'none',
      },
    });

    this.logger.log(
      `bigbang.webhook event=${eventType} outcome=accepted requestId=${input.requestId ?? 'none'}`,
    );
    return { status: 'ok', event: eventType!, duplicate: false };
  }

  /**
   * Parses the verified body, refusing a non-object body.
   *
   * Split out of `handle` so the happy path reads a single expression and the
   * compiler can see that `payload` is always assigned. The signature has
   * already been verified at this point, so nothing hostile reaches here.
   */
  private parseOrRefuse(
    input: { rawBody: string; requestId: string | null },
    context: { providerId: string | null; payloadHash: string },
  ): Record<string, unknown> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.rawBody) as unknown;
    } catch {
      this.refuse(input, {
        ...context,
        eventType: 'unknown',
        status: 400,
        code: 'BIGBANG_WEBHOOK_MALFORMED_BODY',
        message: 'Body is not a JSON object',
      });
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      this.refuse(input, {
        ...context,
        eventType: 'unknown',
        status: 400,
        code: 'BIGBANG_WEBHOOK_MALFORMED_BODY',
        message: 'Body is not a JSON object',
      });
    }
    return parsed as Record<string, unknown>;
  }

  /**
   * The environment-matched, ACTIVE BigBang provider row.
   *
   * Resolved through the SAME indexed lookup every other BigBang code path
   * uses (`@@index([providerCode, environment])` on PartnerProvider), so adding
   * a webhook costs no new discovery query per request. Returns only the three
   * columns this service needs — never the API key or the wallet key.
   */
  private async resolveProvider(): Promise<{
    id: string;
    webhookSecretEnc: string | null;
  } | null> {
    const { environment } = loadBigBangEnvConfig();
    const candidates = await this.prisma.partnerProvider.findMany({
      where: {
        status: 'ACTIVE',
        integrationType: 'CASINO_AGGREGATOR',
        providerCode: BIGBANG_PROVIDER_CODE,
      },
      select: { id: true, environment: true, webhookSecretEnc: true },
      orderBy: { createdAt: 'asc' },
    });
    return (
      candidates.find(
        (row) => (row.environment ?? '').trim().toLowerCase() === environment,
      ) ?? null
    );
  }

  /**
   * Normalises the event name to one of the three DOCUMENTED values.
   *
   * Accepts the common spellings providers use for the same event
   * (`session.started` / `session_started` / `sessionStarted`) but never
   * invents an event: an unrecognised name is refused rather than guessed at.
   */
  private readEventType(payload: Record<string, unknown>): BigBangWebhookEventType | null {
    const raw =
      this.readString(payload, ['event', 'event_type', 'eventType', 'type', 'name']) ?? '';
    const normalized = raw.trim().toLowerCase().replace(/[\s-]+/g, '_');
    const candidate = normalized.replace(/_/g, '.');
    const match = BIGBANG_WEBHOOK_EVENTS.find(
      (event) => event === candidate || event.replace('.', '_') === normalized,
    );
    return match ?? null;
  }

  private readString(source: Record<string, unknown>, keys: readonly string[]): string | null {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
    return null;
  }

  /**
   * Records the refusal, then throws a SAFE, provider-shaped error.
   *
   * The response body contains only a code and a generic message: never the
   * expected signature, never the secret, never the raw body and never an
   * internal identifier. The audit row keeps the correlation id so an operator
   * can trace the exact request.
   *
   * It is SYNCHRONOUS on purpose: the audit write is fire-and-forget, so the
   * request is never delayed by observability, and the thrown exception makes
   * the control flow unambiguous at every call site.
   */
  private refuse(
    input: { rawBody: string; requestId: string | null },
    context: {
      providerId: string | null;
      eventType: string;
      payloadHash: string;
      status: 400 | 401 | 503;
      code: string;
      message: string;
    },
  ): never {
    this.logger.warn(
      `bigbang.webhook outcome=rejected reason=${context.code} requestId=${input.requestId ?? 'none'}`,
    );
    // Best-effort, deliberately not awaited: auditing must never turn a refusal
    // into a hang, and the request path stays fast.
    void this.idempotency
      .recordRejection({
        provider: BIGBANG_PROVIDER_CODE,
        providerId: context.providerId,
        eventType: context.eventType,
        requestId: input.requestId,
        payloadHash: context.payloadHash,
        rawBody: input.rawBody,
        errorCode: context.code,
        errorMessage: context.message,
      })
      .catch(() => undefined);
    void this.idempotency
      .audit({
        provider: BIGBANG_PROVIDER_CODE,
        action: 'BIGBANG_WEBHOOK_REJECTED',
        entityType: 'ProviderWebhookEvent',
        entityId: context.providerId ?? 'none',
        requestId: input.requestId,
        data: { reason: context.code, eventType: context.eventType },
      })
      .catch(() => undefined);
    throw new HttpException({ error: context.message, code: context.code }, context.status);
  }
}


