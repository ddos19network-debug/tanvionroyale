import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { Public } from '../../common/decorators/public.decorator';
import { PaymentWebhooksService } from './payment-webhooks.service';

/**
 * Payment gateway webhooks: signature-verified, idempotent, replay-safe.
 * Duplicates are acknowledged without double credit/debit; invalid
 * signatures are rejected; amounts are never trusted without validation.
 */
@ApiTags('payments/webhooks')
@Controller('payments/webhooks')
export class PaymentWebhooksController {
  constructor(private readonly webhooks: PaymentWebhooksService) {}

  @Public()
  @Post(':provider')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'Receive a gateway webhook (signature verified)' })
  async receive(
    @Param('provider') provider: string,
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('x-webhook-signature') signature?: string,
    @Headers('x-webhook-timestamp') timestamp?: string,
  ) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}), 'utf8');
    const secret = await this.webhooks.resolveSecret(provider);
    if (!secret) {
      throw new ServiceUnavailableException('Payment webhooks are not configured');
    }
    const ok = PaymentWebhooksController.verify(raw, secret, signature, timestamp);
    if (!ok) {
      await this.webhooks.logInvalid(provider, 'invalid-signature');
      throw new UnauthorizedException('Invalid webhook signature');
    }
    return this.webhooks.ingest(provider, req.body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPER_ADMIN')
  @RequirePermissions(ADMIN_PERMISSIONS.PAYMENT_GATEWAYS_READ, ADMIN_PERMISSIONS.PAYMENT_GATEWAYS_UPDATE)
  @ApiBearerAuth()
  @Post(':provider/replay/:eventId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Acknowledge a webhook event status (admin, audited)' })
  replay(@Param('provider') provider: string, @Param('eventId') eventId: string) {
    return this.webhooks.status(provider, eventId);
  }

  static verify(raw: Buffer, secret: string, signature?: string, timestamp?: string): boolean {
    if (!signature) return false;
    if (timestamp) {
      const ts = Number(timestamp);
      if (Number.isFinite(ts)) {
        const ageMs = Math.abs(Date.now() - (ts > 1e12 ? ts : ts * 1000));
        const maxAge = Number(process.env.WEBHOOK_MAX_AGE_SECONDS ?? 300) * 1000;
        if (ageMs > maxAge) return false;
      }
    }
    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(String(signature).trim(), 'utf8');
    if (a.length !== b.length) return false;
    try {
      return timingSafeEqual(a, b);
    } catch {
      return false;
    }
  }
}
