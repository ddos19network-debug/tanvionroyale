import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type {
  WinHouseBalanceChangeResponse,
  WinHouseUserDataResponse,
} from '@tanvion-royale/types';
import { Public } from '../../common/decorators/public.decorator';
import { SkipResponseEnvelope } from '../../common/decorators/skip-response-envelope.decorator';
import { winhouseRefuse } from './winhouse-errors';
import {
  WinHouseWalletService,
  type WinHouseCallbackEnvelope,
} from './winhouse-wallet.service';

/**
 * Provider → TANVION seamless-wallet callbacks (WinHouse Model B).
 *
 * ROUTES (the base URL registered in the provider's portal:
 * https://tanvionroyale.onrender.com/api/v1/winhouse):
 *   GET  /winhouse/user-data?token=…&username=…
 *   POST /winhouse/balance-change?token=…
 *
 * These routes are NOT normal business endpoints and are NOT reachable with a
 * frontend token. They are reachable from the PROVIDER's servers only, and are
 * authenticated by the callback token (`?token=`, constant-time compared) plus
 * the HMAC-SHA256 signature over the five documented fields with the WALLET API
 * KEY. A request that fails either check is refused before any money-related
 * code runs, and a refusal never moves money.
 *
 * The reply bodies are the provider's own wire format, so both routes opt out
 * of the standard `{ success, data }` envelope (@SkipResponseEnvelope): any 2xx
 * without `status: "ok"`, or a 5xx, makes the provider RETRY the stake.
 */
@ApiTags('winhouse')
@Controller('winhouse')
export class WinHouseCallbacksController {
  private readonly logger = new Logger(WinHouseCallbacksController.name);

  constructor(private readonly wallet: WinHouseWalletService) {}

  @Public()
  @SkipResponseEnvelope()
  @Get('user-data')
  @ApiOperation({
    summary: 'WinHouse: current TANVION wallet balance (callback token verified)',
  })
  async userData(
    @Query('token') token?: string,
    @Query('username') username?: string,
  ): Promise<WinHouseUserDataResponse> {
    return this.wallet.handleUserData({ token: token ?? null, username: username ?? null });
  }

  @Public()
  @SkipResponseEnvelope()
  @Post('balance-change')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'WinHouse: bet debit / win credit on the ONE TANVION wallet (signed, idempotent)',
  })
  async balanceChange(
    @Req() request: RawBodyRequest<Request>,
    @Query('token') token?: string,
  ): Promise<WinHouseBalanceChangeResponse> {
    const rawBody = request.rawBody?.toString('utf8') ?? '';

    // RELIABILITY GUARD: the signature is verified over the EXACT received
    // bytes, so a missing raw body can be neither verified nor replaced by a
    // re-serialized object. When something ELSE consumed the stream (a JSON
    // parser registered before Nest's own rawBody hook) the body is still
    // parsed here — that is OUR misconfiguration, not the provider's, so the
    // answer is a RETRYABLE 503 instead of a final 400 that would silently kill
    // every stake. See common/middleware/raw-body.middleware.ts.
    const parsedBody = request.body as unknown;
    const bodyWasParsed =
      parsedBody !== null &&
      typeof parsedBody === 'object' &&
      !Buffer.isBuffer(parsedBody) &&
      Object.keys(parsedBody as Record<string, unknown>).length > 0;
    if (!rawBody && bodyWasParsed) {
      this.logger.error(
        'winhouse.callback kind=balance-change outcome=rejected reason=raw_body_unavailable',
      );
      winhouseRefuse(
        503,
        'WINHOUSE_RAW_BODY_UNAVAILABLE',
        'The raw request body was not captured; the movement was not applied.',
      );
    }

    // The EXACT bytes the provider signed are parsed here (never re-serialized).
    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      payload = parsed as Record<string, unknown>;
    } catch {
      // Even malformed JSON is subject to callback-token authentication first.
      // A wrong/missing token is 401; only the provider's own authenticated
      // request can receive the malformed-body 400.
      await this.wallet.authenticateCallbackToken(token ?? null);
      this.logger.warn('winhouse.callback kind=balance-change outcome=rejected reason=malformed_body');
      winhouseRefuse(400, 'WINHOUSE_MALFORMED_BODY', 'body is not a JSON object');
    }

    const envelope: WinHouseCallbackEnvelope = {
      token: token ?? null,
      rawBody,
      payload,
    };
    return this.wallet.handleBalanceChange(envelope);
  }
}
