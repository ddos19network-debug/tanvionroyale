/**
 * BigBang → TANVION webhook endpoint.
 *
 * ROUTE (the URL registered in the BigBang Dashboard):
 *   POST /api/v1/bigbang/webhooks
 *
 * This is a NEW, SEPARATE route. It does not replace, rename or alter either
 * existing seamless-wallet callback:
 *   GET  /api/v1/bigbang/callbacks/user-data
 *   POST /api/v1/bigbang/callbacks/balance-change
 * Those keep their `X-API-Key` + HMAC authentication and their provider wire
 * formats exactly as they were, and they remain the ONLY money-moving path.
 *
 * AUTHENTICATION
 *   This is a server-to-server endpoint: it does NOT require a user JWT, but it
 *   is NOT anonymous. It is authenticated by HMAC-SHA256 over the EXACT raw
 *   body using the dedicated BigBang WEBHOOK secret (`ProviderProvider
 *   .webhookSecretEnc`), which is a DIFFERENT credential from the wallet API
 *   key. Comparison is constant-time; a bad or missing signature is refused
 *   with 401 before the body is even parsed.
 *
 * WHY IT IS A SEPARATE ROUTE (and not folded into the callbacks controller)
 *   The two existing routes answer in BigBang's OWN wire format and are tuned
 *   for the provider's retry behaviour. A webhook has different semantics
 *   (notifications, 200-on-duplicate, throttling). Keeping it separate means
 *   no existing provider contract can be affected.
 *
 * The body is captured by the route-scoped raw-body parser registered in
 * main.ts, which also enforces a tight size limit for this route.
 */
import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  RawBodyRequest,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { SkipResponseEnvelope } from '../../common/decorators/skip-response-envelope.decorator';
import {
  BigBangWebhookService,
  type BigBangWebhookAck,
} from './bigbang-webhook.service';

@ApiTags('bigbang/webhooks')
@Controller('bigbang/webhooks')
export class BigBangWebhookController {
  constructor(private readonly webhooks: BigBangWebhookService) {}

  @Public()
  @SkipResponseEnvelope()
  @Post()
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  // A webhook burst is legitimate, but it is still an internet-facing,
  // signature-verified endpoint: bounded so a flood cannot exhaust the
  // process. Generous enough for a provider's burst-and-backoff pattern.
  @Throttle({ default: { limit: 600, ttl: 60_000 } })
  @ApiOperation({
    summary: 'BigBang webhook: session/round notifications (HMAC-SHA256 verified, idempotent)',
  })
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<BigBangWebhookAck> {
    // The EXACT bytes the provider signed. Never re-serialised: key order and
    // whitespace are part of the signature.
    const rawBody = request.rawBody?.toString('utf8') ?? '';
    return this.webhooks.handle({
      rawBody,
      headers,
      // Assigned by RequestIdMiddleware for every request; used for audit
      // correlation only.
      requestId: request.requestId ?? null,
    });
  }
}
