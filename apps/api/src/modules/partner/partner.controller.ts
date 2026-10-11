import {
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Post,
  RawBodyRequest,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  OperatorProviderInterface,
  type ProviderWebhookEvent,
} from '@tanvion-royale/integrations';
import {
  PARTNER_SIGNATURE_HEADER,
  PARTNER_TIMESTAMP_HEADER,
  verifyPartnerWebhookSignature,
} from './webhook-signature';
import { PARTNER_PROVIDER } from './partner.token';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../database/prisma.service';
import { configuredBettingProviderName } from '../betting/betting-provider.factory';

/**
 * Partner Sports adapter boundary (Football / Cricket).
 *
 * The provider contract itself is the EXISTING OperatorProviderInterface
 * (packages/integrations) — no second provider architecture. This controller
 * adds the two pieces the HTTP edge still needs:
 *
 *  1. POST /partner/webhooks — a signature-verified webhook receiver. The
 *     signature is HMAC-SHA256 over the EXACT raw body with the shared
 *     OPERATOR_WEBHOOK_SECRET; unconfigured providers fail safely with
 *     "Provider temporarily unavailable" and nothing is ever fabricated.
 *  2. Status endpoints (public + admin RBAC) used by the frontend and the
 *     admin panel to render honest "Provider temporarily unavailable" states
 *     and provider health. Secrets are NEVER exposed.
 */
@ApiTags('partner')
@Controller('partner')
export class PartnerController {
  private readonly logger = new Logger(PartnerController.name);

  constructor(
    @Inject(PARTNER_PROVIDER) private readonly provider: OperatorProviderInterface,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Get('status')
  @ApiOperation({ summary: 'Public partner availability (no secrets)' })
  partnerStatus() {
    const provider = configuredBettingProviderName();
    return {
      available: provider !== null,
      // Only the display name of the configured provider; never secrets/URLs.
      provider,
      message:
        provider === null
          ? 'Provider temporarily unavailable'
          : null,
    };
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPER_ADMIN', 'ADMIN')
  @RequirePermissions(ADMIN_PERMISSIONS.PARTNER_PROVIDERS_READ)
  @Get('admin/status')
  @ApiOperation({ summary: 'Admin partner health: configured adapter + reachability' })
  async adminStatus() {
    const provider = configuredBettingProviderName();
    let reachable = false;
    let detail = provider
      ? null
      : 'Provider temporarily unavailable (no partner adapter configured)';
    if (provider) {
      try {
        await this.provider.authenticate();
        reachable = true;
      } catch (error) {
        detail =
          error instanceof Error
            ? `Provider authentication failed: ${error.message}`
            : 'Provider authentication failed';
      }
    }
    return {
      configured: provider !== null,
      provider,
      reachable,
      message: detail,
      // Mock/dev adapters must never be reported as production-ready.
      mode: provider ? 'real' : 'unconfigured',
    };
  }

  /**
   * Signature-verified partner webhook receiver. The provider contract for
   * the event body is defined by ProviderWebhookEvent; the signature is
   * computed over the RAW body bytes so the payload cannot be tampered with.
   */
  @Public()
  @Post('webhooks')
  @HttpCode(HttpStatus.OK)
  async receiveWebhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers(PARTNER_SIGNATURE_HEADER) signature?: string,
    @Headers(PARTNER_TIMESTAMP_HEADER) timestamp?: string,
  ): Promise<Record<string, unknown>> {
    const secret = process.env.OPERATOR_WEBHOOK_SECRET?.trim() ?? '';
    if (!secret) {
      // Fail safe: no shared secret configured -> treat as unconfigured.
      throw new ServiceUnavailableException('Provider temporarily unavailable');
    }
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');
    const verdict = verifyPartnerWebhookSignature(rawBody, secret, signature, timestamp);
    if (!verdict.ok) {
      this.logger.warn(`Partner webhook rejected (${verdict.reason})`);
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // Only now is the payload trusted. Unconfigured adapters fail safely.
    const event = req.body as ProviderWebhookEvent;
    try {
      const result = await this.provider.handleWebhook(event);
      await this.auditWebhook(event, true, null);
      return { received: true, type: event?.type ?? null, result: result ?? null };
    } catch (error) {
      await this.auditWebhook(event, false, error instanceof Error ? error.message : 'error');
      // Surface the provider's own safe failure (e.g. unconfigured -> 503).
      throw error;
    }
  }

  private async auditWebhook(
    event: ProviderWebhookEvent | undefined,
    accepted: boolean,
    error: string | null,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: null,
          actorType: 'SYSTEM',
          action: accepted ? 'PARTNER_WEBHOOK_ACCEPTED' : 'PARTNER_WEBHOOK_FAILED',
          entityType: 'PartnerWebhook',
          entityId: event?.eventId ?? null,
          newValue: {
            type: event?.type ?? null,
            accepted,
            ...(error ? { error } : {}),
          } as never,
        },
      });
    } catch (auditError) {
      this.logger.warn(
        `Failed to write webhook audit log: ${auditError instanceof Error ? auditError.message : 'error'}`,
      );
    }
  }
}