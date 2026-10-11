import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  RawBodyRequest,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { CasinoCallbackResponse } from '@tanvion-royale/types';
import { Public } from '../../common/decorators/public.decorator';
import { PrismaService } from '../../database/prisma.service';
import {
  CASINO_MERCHANT_HEADER,
  CASINO_NONCE_HEADER,
  CASINO_SIGN_HEADER,
  CASINO_TIMESTAMP_HEADER,
} from './casino-signature';
import {
  CasinoWalletService,
  type CasinoCallbackEnvelope,
} from './casino-wallet.service';

/**
 * Partner → TANVION wallet callbacks.
 *
 * These routes are NOT public business endpoints: they are provider callbacks
 * authenticated by HMAC-SHA1 (X-Merchant-Id / X-Timestamp / X-Nonce / X-Sign)
 * over the EXACT raw body. A request without a valid signature is rejected
 * before any money-related code runs, and a rejected request NEVER moves money.
 *
 * The response is deliberately a provider-friendly payload with a `REJECTED`
 * status (rather than a 5xx) so provider retry policies behave correctly —
 * except when the integration itself is unusable, which fails safely.
 */
@ApiTags('casino/callbacks')
@Controller('casino/callbacks')
export class CasinoCallbacksController {
  private readonly logger = new Logger(CasinoCallbacksController.name);

  constructor(
    private readonly wallet: CasinoWalletService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post('balance')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Provider asks for the player wallet balance (signature-verified)' })
  async balance(
    @Req() request: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<CasinoCallbackResponse> {
    return this.handle('balance', request, headers, (envelope) =>
      this.wallet.handleBalance(envelope),
    );
  }

  @Public()
  @Post('bet')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Provider bet → debit the TANVION wallet (idempotent)' })
  async bet(
    @Req() request: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<CasinoCallbackResponse> {
    return this.handle('bet', request, headers, (envelope) =>
      this.wallet.handleBet(envelope),
    );
  }

  @Public()
  @Post('win')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Provider win → credit the TANVION wallet (idempotent)' })
  async win(
    @Req() request: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<CasinoCallbackResponse> {
    return this.handle('win', request, headers, (envelope) =>
      this.wallet.handleWin(envelope),
    );
  }

  @Public()
  @Post('refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Provider refund of a valid previous bet (idempotent)' })
  async refund(
    @Req() request: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<CasinoCallbackResponse> {
    return this.handle('refund', request, headers, (envelope) =>
      this.wallet.handleRefund(envelope),
    );
  }

  @Public()
  @Post('rollback')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Provider rollback of a prior transaction (idempotent)' })
  async rollback(
    @Req() request: RawBodyRequest<Request>,
    @Headers() headers: Record<string, string | undefined>,
  ): Promise<CasinoCallbackResponse> {
    return this.handle('rollback', request, headers, (envelope) =>
      this.wallet.handleRollback(envelope),
    );
  }

  /**
   * Shared edge handling: the raw body is used for BOTH signature verification
   * and payload parsing, so what the provider signed is exactly what is
   * applied. Nothing is trusted before the signature check inside the service.
   */
  private async handle(
    kind: string,
    request: RawBodyRequest<Request>,
    headers: Record<string, string | undefined>,
    run: (envelope: CasinoCallbackEnvelope) => Promise<CasinoCallbackResponse>,
  ): Promise<CasinoCallbackResponse> {
    const rawBody = request.rawBody?.toString('utf8') ?? '';
    if (!rawBody.trim()) {
      // Nothing to verify against → never process an unsigned callback.
      throw new ServiceUnavailableException('Casino provider callback body is empty.');
    }

    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(rawBody) as unknown;
      payload =
        parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      this.logger.warn(`casino.callback kind=${kind} outcome=rejected reason=malformed_body`);
      throw new ServiceUnavailableException(
        'Casino provider callback body is not valid JSON.',
      );
    }

    const envelope: CasinoCallbackEnvelope = {
      headers: {
        merchantId: headers[CASINO_MERCHANT_HEADER],
        timestamp: headers[CASINO_TIMESTAMP_HEADER],
        nonce: headers[CASINO_NONCE_HEADER],
        signature: headers[CASINO_SIGN_HEADER],
      },
      method: 'POST',
      path: this.signedPath(request),
      rawBody,
      payload,
    };

    const response = await run(envelope);
    // Audit every callback outcome (no secrets, no raw provider payload).
    await this.audit(kind, response);
    return response;
  }

  /** Path + query exactly as the provider signed it (global prefix stripped). */
  private signedPath(request: Request): string {
    const original = request.originalUrl ?? request.url ?? '';
    const withoutPrefix = original.replace(/^\/api\/v\d+(?=\/)/i, '');
    return withoutPrefix || '/';
  }

  private async audit(kind: string, response: CasinoCallbackResponse): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: null,
          actorType: 'SYSTEM',
          action: `CASINO_CALLBACK_${response.status}`,
          entityType: 'CasinoCallback',
          entityId: response.transactionId ?? null,
          newValue: {
            kind,
            requestedKind: response.kind,
            duplicate: response.duplicate,
            externalTransactionId: response.externalTransactionId,
            currency: response.currency,
            message: response.message,
          } as never,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to write casino callback audit log: ${
          error instanceof Error ? error.message : 'error'
        }`,
      );
    }
  }
}
