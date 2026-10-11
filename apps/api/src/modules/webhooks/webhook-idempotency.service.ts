/**
 * SHARED provider-webhook idempotency + audit engine.
 *
 * Every provider that delivers server-to-server webhooks needs the same four
 * things, so they are implemented ONCE here and reused by
 * `BigBangWebhookService` (and any future provider):
 *
 *   1. a stable idempotency key for a delivery;
 *   2. a first-write-wins claim, so a retried delivery is recognised as a
 *      DUPLICATE instead of being processed twice;
 *   3. a durable event record that survives the request (accepted / duplicate /
 *      rejected / processing failure);
 *   4. a secret-free audit trail.
 *
 * WHY A CLAIM, NOT JUST AN INSERT
 * ------------------------------
 * The naive "insert, catch unique violation" approach only protects the
 * insert. It does NOT stop the work that happens after it, and it cannot tell
 * an in-flight duplicate apart from a completed one. Here a row is written
 * FIRST (status RECEIVED); the caller then processes and flips it to
 * PROCESSED. A concurrent or later retry that loses the unique insert is
 * reported as a duplicate and does no work at all.
 *
 * The `@@unique([provider, eventId])` index is the enforcement mechanism, so
 * correctness survives multiple API instances and does not depend on any
 * in-process cache.
 *
 * WALLET SAFETY: this service has NO reference to WalletService, Wallet or
 * WalletTransaction. Recording an event can never move money.
 */
import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import { redactWebhookPayload } from './webhook-security';

export type WebhookEventStatus = 'RECEIVED' | 'PROCESSED' | 'DUPLICATE' | 'REJECTED';

export interface WebhookEventInput {
  /** Stable provider discriminator, e.g. `BIGBANG`. */
  provider: string;
  /** Resolved PartnerProvider row id (nullable when unresolvable). */
  providerId: string | null;
  /** The provider's event id, or a derived idempotency key. */
  eventId: string;
  /** Normalised event type, e.g. `session.started`. */
  eventType: string;
  /** SHA-256 of the exact verified raw body. */
  payloadHash: string;
  /** Raw body, used ONLY to build the redacted snapshot. */
  rawBody: string;
  /** Correlation id from the request. */
  requestId: string | null;
}

/** Outcome of a claim attempt. */
export type WebhookClaimResult =
  | { claimed: true; eventId: string }
  | { claimed: false; eventId: string; existingStatus: string };


@Injectable()
export class WebhookIdempotencyService {
  private readonly logger = new Logger(WebhookIdempotencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Derives a stable idempotency key for a delivery.
   *
   * A provider-supplied event id is used verbatim when present. When the
   * provider does not send one, the key is a SHA-256 over the documented
   * IMMUTABLE event fields (event type, player, session, round and the
   * provider timestamp), so two genuinely different rounds never collide and a
   * retried delivery of the same round always does.
   *
   * A timestamp-ONLY key is explicitly NOT used: several distinct events can
   * legitimately share one second, which would silently drop real events.
   */
  static deriveEventId(input: {
    eventId?: string | null;
    eventType: string;
    username?: string | null;
    sessionId?: string | null;
    roundId?: string | null;
    providerTimestamp?: string | number | null;
  }): string {
    const provided = (input.eventId ?? '').trim();
    if (provided) return provided.slice(0, 200);

    const canonical = JSON.stringify([
      input.eventType.trim().toLowerCase(),
      (input.username ?? '').trim(),
      (input.sessionId ?? '').trim(),
      (input.roundId ?? '').trim(),
      String(input.providerTimestamp ?? '').trim(),
    ]);
    return `derived:${createHash('sha256').update(canonical, 'utf8').digest('hex')}`;
  }

  /**
   * Claims an event for processing, exactly once.
   *
   * Returns `claimed: true` for the first delivery and `claimed: false` for
   * every later one — which is what makes a replayed `round.completed`
   * harmless.
   */
  async claim(input: WebhookEventInput, parsed: unknown): Promise<WebhookClaimResult> {
    try {
      const row = await this.prisma.providerWebhookEvent.create({
        data: {
          provider: input.provider,
          providerId: input.providerId,
          eventId: input.eventId,
          eventType: input.eventType,
          status: 'RECEIVED',
          requestId: input.requestId,
          payloadHash: input.payloadHash,
          payload: redactWebhookPayload(parsed) as never,
          receivedAt: new Date(),
        },
        select: { id: true },
      });
      return { claimed: true, eventId: row.id };
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        // A delivery we have already seen. Reading the existing status lets the
        // caller distinguish "finished" from "another worker is on it".
        const existing = await this.prisma.providerWebhookEvent.findUnique({
          where: { provider_eventId: { provider: input.provider, eventId: input.eventId } },
          select: { id: true, status: true },
        });
        return {
          claimed: false,
          eventId: existing?.id ?? input.eventId,
          existingStatus: existing?.status ?? 'RECEIVED',
        };
      }
      throw error;
    }
  }

  /** Marks a claimed event as successfully processed. */
  async markProcessed(rowId: string): Promise<void> {
    await this.prisma.providerWebhookEvent.update({
      where: { id: rowId },
      data: { status: 'PROCESSED', processedAt: new Date(), updatedAt: new Date() },
    });
  }

  /**
   * Records a delivery that was refused (bad signature, stale timestamp,
   * malformed body, unconfigured provider).
   *
   * These are AUDIT rows, not idempotency claims: two genuinely distinct
   * refused requests must both be recorded, so the provider/eventId key is
   * suffixed with the request id. A rejected request never reaches the
   * processing path, so it can have no financial effect.
   */
  async recordRejection(input: {
    provider: string;
    providerId: string | null;
    eventType: string;
    requestId: string | null;
    payloadHash: string;
    rawBody: string;
    parsed?: unknown;
    errorCode: string;
    errorMessage: string;
  }): Promise<void> {
    try {
      await this.prisma.providerWebhookEvent.create({
        data: {
          provider: input.provider,
          providerId: input.providerId,
          eventId: `rejected:${input.requestId ?? 'unknown'}:${input.errorCode}`,
          eventType: input.eventType,
          status: 'REJECTED',
          requestId: input.requestId,
          payloadHash: input.payloadHash,
          payload: redactWebhookPayload(
            input.parsed ?? safeJsonParse(input.rawBody),
          ) as never,
          errorCode: input.errorCode,
          // Bounded + credential-free: this string is written to the database
          // and can be shown to an admin, so it must never carry a secret.
          errorMessage: input.errorMessage.slice(0, 300),
          receivedAt: new Date(),
        },
      });
    } catch (error) {
      // Auditing must never turn a refusal into a 500.
      this.logger.warn(
        `webhook.rejection_audit_failed provider=${input.provider} reason=${input.errorCode} error=${String(error)}`,
      );
    }
  }

  /**
   * Append-only, secret-free audit entry.
   *
   * Records the outcome, the provider, the event type, the request id and a
   * safe reason. It NEVER records the signature, the secret, the API key or an
   * Authorization header, because none of those are ever passed to it.
   */
  async audit(input: {
    provider: string;
    action: string;
    entityType: string;
    entityId: string;
    requestId: string | null;
    data: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: null,
          actorType: 'SYSTEM',
          action: input.action,
          entityType: input.entityType,
          entityId: input.entityId,
          newValue: { ...input.data, requestId: input.requestId } as never,
        },
      });
    } catch {
      // Auditing is observability, never part of the request outcome.
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}

/** Parses without throwing; used only to build a redacted audit snapshot. */
function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return { raw: raw.slice(0, 256) };
  }
}

