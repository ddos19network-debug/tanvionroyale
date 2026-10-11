import {
  Controller,
  Get,
  Headers,
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
import { Public } from '../../common/decorators/public.decorator';
import { SkipResponseEnvelope } from '../../common/decorators/skip-response-envelope.decorator';
import { BIGBANG_API_KEY_HEADER } from './bigbang.config';
import { bigbangRefuse } from './bigbang.errors';
import type {
  BigBangBalanceChangeCallbackResponse,
  BigBangUserDataCallbackResponse,
} from './bigbang.interface';
import {
  BigBangWalletService,
  type BigBangCallbackEnvelope,
} from './bigbang-wallet.service';

/**
 * BigBang → TANVION seamless-wallet callbacks.
 *
 * ROUTES (the two URLs registered on the API key in the BigBang Dashboard,
 * under this deployment's global prefix + version, e.g.
 * https://<host>/api/v1/bigbang/callbacks/…):
 *   GET  /bigbang/callbacks/user-data?username=…      (balance read)
 *   POST /bigbang/callbacks/balance-change            (bet/win/refund + close)
 *
 * These routes are NOT business endpoints and are NOT reachable with a
 * frontend token: they are called from the provider's servers only, and are
 * authenticated by the `X-API-Key` header (constant-time compared with the
 * DECRYPTED PartnerProvider key) plus the HMAC-SHA256 signature over the five
 * documented fields. A request failing either check is refused before any
 * money-related code runs, and a refusal never moves money.
 *
 * Both replies are BigBang's own wire format (`{ status: "ok", balance }` /
 * `{ username, balance, currency }`), so they opt out of the standard
 * `{ success, data }` envelope: a wrapped body would make the provider read an
 * applied movement as "in doubt" and retry it for hours.
 */
@ApiTags('bigbang/callbacks')
@Controller('bigbang/callbacks')
export class BigBangCallbacksController {
  private readonly logger = new Logger(BigBangCallbacksController.name);

  constructor(private readonly wallet: BigBangWalletService) {}

  @Public()
  @SkipResponseEnvelope()
  @Get('user-data')
  @ApiOperation({ summary: 'BigBang: current TANVION wallet balance (API key verified)' })
  async userData(
    @Headers() headers: Record<string, string | undefined>,
    @Query('username') username?: string,
  ): Promise<BigBangUserDataCallbackResponse> {
    return this.wallet.handleUserData({
      apiKey: this.readApiKey(headers),
      username: username ?? null,
    });
  }

  @Public()
  @SkipResponseEnvelope()
  @Post('balance-change')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'BigBang: bet debit / win credit on the ONE TANVION wallet (signed, idempotent)',
  })
  async balanceChange(
    @Req() request: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<BigBangBalanceChangeCallbackResponse> {
    const apiKey = this.readApiKey(headers);
    const rawBody = request.rawBody?.toString('utf8') ?? '';

    // The EXACT bytes the provider signed are parsed here (never re-serialized),
    // so `extractBigBangRawField` sees the amount spelling that was signed.
    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not an object');
      }
      payload = parsed as Record<string, unknown>;
    } catch {
      // Even a malformed body is subject to API-key authentication first: a
      // wrong/missing key stays 401 (final), only the provider's own
      // authenticated request receives the malformed-body 400.
      await this.wallet.authenticate(apiKey);
      this.logger.warn('bigbang.callback outcome=rejected reason=malformed_body');
      bigbangRefuse(400, 'BIGBANG_MALFORMED_BODY', 'body is not a JSON object');
    }

    const envelope: BigBangCallbackEnvelope = { apiKey, rawBody, payload };
    return this.wallet.handleBalanceChange(envelope);
  }

  /** The documented inbound credential header — never logged, never echoed. */
  private readApiKey(headers: Record<string, string | undefined>): string | null {
    const value = headers[BIGBANG_API_KEY_HEADER];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }
}
