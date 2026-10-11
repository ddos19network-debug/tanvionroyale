import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import { decryptSecret } from '../../common/utils/encryption';

const WEBHOOK_CURRENCIES = new Set(['BDT', 'USD', 'EUR']);

@Injectable()
export class PaymentWebhooksService {
  private readonly logger = new Logger(PaymentWebhooksService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a verified webhook event. A (provider, eventId) pair is processed
   * at most once - duplicates are acknowledged WITHOUT reprocessing, so a
   * deposit/withdrawal can never be credited or debited twice.
   */
  async ingest(provider: string, body: unknown): Promise<{ received: boolean; duplicate: boolean }> {
    const payload = (body ?? {}) as Record<string, unknown>;
    const code = String(provider ?? '').trim().toLowerCase();
    if (!code) throw new BadRequestException('Webhook provider is required');
    const eventId = String(payload.eventId ?? payload.id ?? '').trim();
    const type = String(payload.type ?? 'unknown');
    if (!eventId) throw new BadRequestException('Webhook event id is required');
    const reference =
      payload.reference != null ? String(payload.reference) : payload.transactionId != null ? String(payload.transactionId) : null;
    const rawAmount = Number(payload.amount);
    const amount = Number.isInteger(rawAmount) && rawAmount > 0 ? rawAmount : null;
    const currency = payload.currency != null ? String(payload.currency).trim().toUpperCase() : null;
    if (currency && !WEBHOOK_CURRENCIES.has(currency)) {
      throw new BadRequestException('Unsupported webhook currency');
    }
    const existing = await this.prisma.paymentWebhookEvent.findUnique({
      where: { provider_eventId: { provider: code, eventId } },
    });
    if (existing) {
      if (existing.status !== 'DUPLICATE') {
        await this.prisma.paymentWebhookEvent.update({
          where: { id: existing.id },
          data: { status: 'DUPLICATE' },
        });
      }
      return { received: true, duplicate: true };
    }
    try {
      await this.prisma.paymentWebhookEvent.create({
        data: {
          provider: code,
          eventId,
          type,
          status: 'PROCESSED',
          reference,
          amount,
          currency,
          payload: payload as Prisma.InputJsonValue,
          signatureValid: true,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Lost the create race - the winning delivery already recorded the event.
        return { received: true, duplicate: true };
      }
      throw error;
    }
    this.logger.log(`Webhook ${code}:${eventId} (${type}) recorded`);
    return { received: true, duplicate: false };
  }

  async logInvalid(provider: string, reason: string): Promise<void> {
    try {
      await this.prisma.paymentWebhookEvent.create({
        data: {
          provider: String(provider ?? '').trim().toLowerCase() || 'unknown',
          eventId: `invalid-${randomUUID()}`,
          type: reason,
          status: 'FAILED',
          signatureValid: false,
        },
      });
    } catch {
      /* best-effort: rejecting an unsigned webhook must never depend on storage */
    }
  }

  async status(provider: string, eventId: string): Promise<{ provider: string; eventId: string; status: string }> {
    const code = provider.trim().toLowerCase();
    const row = await this.prisma.paymentWebhookEvent.findUnique({
      where: { provider_eventId: { provider: code, eventId } },
    });
    if (!row) throw new NotFoundException('Webhook event not found');
    return { provider: row.provider, eventId: row.eventId, status: row.status };
  }

  /**
   * Webhook secret resolution: environment first (bootstrap/fallback), then
   * the ACTIVE database gateway configuration for this provider code.
   * Never returns a secret to the client - it is only used for HMAC checks.
   */
  async resolveSecret(provider: string): Promise<string> {
    const envSecret =
      process.env.PAYMENT_WEBHOOK_SECRET?.trim() || process.env.PAYMENT_PROVIDER_SECRET?.trim() || '';
    if (envSecret) return envSecret;
    const code = provider.trim().toLowerCase();
    if (!code) return '';
    const row = await this.prisma.paymentGatewayConfig.findUnique({ where: { code } }).catch(() => null);
    if (!row || row.status !== 'ACTIVE' || !row.webhookSecretEnc) return '';
    try {
      return decryptSecret(row.webhookSecretEnc);
    } catch {
      this.logger.warn(`Could not decrypt webhook secret for gateway ${code}`);
      return '';
    }
  }
}
