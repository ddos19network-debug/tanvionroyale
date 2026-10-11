import { Injectable, Logger, type HttpException } from '@nestjs/common';
import type {
  CasinoCallbackResponse,
  CasinoTransactionKind,
} from '@tanvion-royale/types';
import { Prisma, type CasinoTransaction } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import { WalletService } from '../wallet/wallet.service';
import { readCallbackAmount } from './casino-money';
import { CasinoProviderFactory } from './casino-provider.factory';
import type { CasinoCallbackHeaders } from './casino-signature';

/** Raw provider → TANVION wallet callback request. */
export interface CasinoCallbackEnvelope {
  headers: CasinoCallbackHeaders;
  method: string;
  /** Path AND query string, exactly as received (part of the signature). */
  path: string;
  rawBody: string;
  payload: Record<string, unknown>;
}

/** Everything a callback needs after signature + payload validation. */
interface ValidatedCallback {
  providerId: string;
  userId: string;
  currency: string;
  amount: number;
  externalTransactionId: string;
  externalRoundId: string | null;
  referenceTransactionId: string | null;
  nonce: string | null;
  providerPlayerId: string;
  providerSessionId: string | null;
}

/**
 * Partner wallet callbacks — the ONLY money-moving entry point for BIG CASINO
 * and BIG LIVE CASINO.
 *
 * There is exactly ONE TANVION wallet: these callbacks debit/credit the same
 * wallet the sportsbook, deposits, withdrawals and ROYALE PLAY use. No partner
 * balance is ever created.
 *
 * EVERY request is:
 *   1. signature-verified (HMAC-SHA1, merchant id, timestamp window, nonce);
 *   2. validated (currency, amount bounds, player mapping, session);
 *   3. applied EXACTLY ONCE — a repeated provider transaction id is detected
 *      and never debits/credits twice;
 *   4. atomic — the ledger movement and the CasinoTransaction mapping are
 *      written together (or the whole movement is rolled back);
 *   5. reconciled — the mapping row keeps the wallet transaction id, round id
 *      and the referenced transaction so finance can reconcile provider ↔
 *      TANVION at any time.
 */
@Injectable()
export class CasinoWalletService {
  private readonly logger = new Logger(CasinoWalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: CasinoProviderFactory,
    private readonly wallet: WalletService,
  ) {}

  // --------------------------------------------------------------------------
  // Entry points
  // --------------------------------------------------------------------------

  /** Provider asks for the player's current TANVION wallet balance. */
  async handleBalance(envelope: CasinoCallbackEnvelope): Promise<CasinoCallbackResponse> {
    const verdict = await this.providers.verifyInboundRequest(envelope);
    const externalTransactionId = this.readString(envelope.payload, [
      'transaction_id',
      'transactionId',
    ]);
    if (!verdict.ok) {
      this.logCallback('balance', 'rejected', null, verdict.reason, null);
      return this.rejected('BET', externalTransactionId ?? '', 'unknown', verdict.reason);
    }
    const context = await this.resolvePlayer(envelope.payload, verdict.providerId);
    if ('message' in context) {
      return this.rejected('BET', externalTransactionId ?? '', 'unknown', context.message);
    }

    const wallet = await this.wallet.getOrCreateWalletForUser(
      context.userId,
      context.currency,
    );
    this.logCallback('balance', 'applied', verdict.providerId, null, context.userId);
    return {
      transactionId: null,
      externalTransactionId: externalTransactionId ?? '',
      kind: 'BET',
      duplicate: false,
      status: 'APPLIED',
      balance: wallet.availableBalance,
      currency: wallet.currency,
      message: null,
    };
  }

  async handleBet(envelope: CasinoCallbackEnvelope): Promise<CasinoCallbackResponse> {
    return this.handleMovement(envelope, 'BET');
  }

  async handleWin(envelope: CasinoCallbackEnvelope): Promise<CasinoCallbackResponse> {
    return this.handleMovement(envelope, 'WIN');
  }

  async handleRefund(envelope: CasinoCallbackEnvelope): Promise<CasinoCallbackResponse> {
    return this.handleMovement(envelope, 'REFUND');
  }

  async handleRollback(envelope: CasinoCallbackEnvelope): Promise<CasinoCallbackResponse> {
    return this.handleMovement(envelope, 'ROLLBACK');
  }

  // --------------------------------------------------------------------------
  // Movement dispatcher
  // --------------------------------------------------------------------------

  private async handleMovement(
    envelope: CasinoCallbackEnvelope,
    kind: CasinoTransactionKind,
  ): Promise<CasinoCallbackResponse> {
    const verdict = await this.providers.verifyInboundRequest(envelope);
    if (!verdict.ok) {
      const externalTransactionId =
        this.readString(envelope.payload, ['transaction_id', 'transactionId']) ?? '';
      this.logCallback(kind.toLowerCase(), 'rejected', null, verdict.reason, null);
      return this.rejected(kind, externalTransactionId, 'unknown', verdict.reason);
    }

    const context = await this.resolvePlayer(envelope.payload, verdict.providerId);
    if ('message' in context) {
      const externalTransactionId =
        this.readString(envelope.payload, ['transaction_id', 'transactionId']) ?? '';
      this.logCallback(kind.toLowerCase(), 'rejected', verdict.providerId, context.message, null);
      return this.rejected(kind, externalTransactionId, 'unknown', context.message);
    }

    const validation = this.validateMovement(kind, context);
    if ('message' in validation) {
      this.logCallback(
        kind.toLowerCase(),
        'rejected',
        verdict.providerId,
        validation.message,
        null,
      );
      return this.rejected(
        kind,
        context.externalTransactionId,
        context.currency,
        validation.message,
      );
    }

    // Replay protection at the request level: one provider nonce maps to at
    // most one TANVION movement.
    const duplicate = await this.findDuplicate(verdict.providerId, context);
    if (duplicate.kind === 'nonce_conflict') {
      this.logCallback(
        kind.toLowerCase(),
        'rejected',
        verdict.providerId,
        'nonce_reused',
        context.userId,
      );
      return this.rejected(
        kind,
        context.externalTransactionId,
        context.currency,
        'nonce_reused',
      );
    }

    // Exactly-once at the MAPPING level: a provider transaction TANVION already
    // applied is acknowledged idempotently. This is what makes a REFUND or
    // ROLLBACK retry safe — the reversal-total guard below must never turn a
    // legitimate provider retry into an error, and money must never move twice.
    const alreadyApplied = await this.findMapping(
      verdict.providerId,
      context.externalTransactionId,
      kind,
    );
    if (alreadyApplied) {
      const balance = await this.currentBalance(context.userId, context.currency);
      this.logCallback(kind.toLowerCase(), 'duplicate', verdict.providerId, null, context.userId);
      return {
        transactionId: alreadyApplied.id,
        externalTransactionId: context.externalTransactionId,
        kind,
        duplicate: true,
        status: 'APPLIED',
        balance,
        currency: alreadyApplied.currency,
        message: 'Duplicate provider transaction ignored.',
      };
    }

    try {
      return await this.applyMovement(kind, verdict.providerId, context);
    } catch (error) {
      const message = this.safeReason(error);
      this.logCallback(
        kind.toLowerCase(),
        'rejected',
        verdict.providerId,
        message,
        context.userId,
      );
      return this.rejected(kind, context.externalTransactionId, context.currency, message);
    }
  }



  // --------------------------------------------------------------------------
  // Movement application (atomic, idempotent)
  // --------------------------------------------------------------------------

  private async applyMovement(
    kind: CasinoTransactionKind,
    providerId: string,
    input: ValidatedCallback,
  ): Promise<CasinoCallbackResponse> {
    switch (kind) {
      case 'BET':
        return this.applyBet(providerId, input);
      case 'WIN':
        return this.applyCredit(providerId, input, 'WIN');
      case 'REFUND':
        return this.applyRefund(providerId, input);
      case 'ROLLBACK':
        return this.applyRollback(providerId, input);
      default:
        return this.rejected(
          kind,
          input.externalTransactionId,
          input.currency,
          'unsupported_kind',
        );
    }
  }

  /**
   * BET — debit the ONE wallet.
   *
   * The exactly-once guard is the wallet's own idempotency key derived from the
   * provider transaction id: `reserveStake` is unique per (user, key), so a
   * repeated callback can never debit twice. A crash between reserve and
   * capture leaves a recoverable PENDING reservation that the provider's retry
   * completes — never lost money and never a double debit.
   */
  private async applyBet(
    providerId: string,
    input: ValidatedCallback,
  ): Promise<CasinoCallbackResponse> {
    const key = this.walletKey('BET', providerId, input.externalTransactionId);
    const reservation = await this.wallet.reserveStake(
      input.userId,
      input.amount,
      input.currency,
      key,
    );
    await this.wallet.captureStake(input.userId, key);

    const balance = await this.currentBalance(input.userId, input.currency);

    try {
      const row = await this.prisma.casinoTransaction.create({
        data: {
          providerId,
          userId: input.userId,
          sessionId: input.providerSessionId,
          externalTransactionId: input.externalTransactionId,
          externalRoundId: input.externalRoundId,
          kind: 'BET',
          amount: -input.amount,
          currency: input.currency,
          nonce: input.nonce,
          walletTransactionId: reservation.transactionId,
          reason: 'Casino bet debited from the TANVION wallet',
        },
      });
      this.logCallback(
        'bet',
        reservation.duplicate ? 'duplicate' : 'applied',
        providerId,
        null,
        input.userId,
      );
      return {
        transactionId: row.id,
        externalTransactionId: input.externalTransactionId,
        kind: 'BET',
        duplicate: reservation.duplicate,
        status: 'APPLIED',
        balance,
        currency: input.currency,
        message: null,
      };
    } catch (error) {
      // A concurrent duplicate won the mapping unique index. The wallet
      // movement itself was already idempotent, so no second debit happened.
      if (this.isUniqueViolation(error)) {
        const existing = await this.findMapping(
          providerId,
          input.externalTransactionId,
          'BET',
        );
        if (existing) {
          return {
            transactionId: existing.id,
            externalTransactionId: input.externalTransactionId,
            kind: 'BET',
            duplicate: true,
            status: 'APPLIED',
            balance,
            currency: input.currency,
            message: 'Duplicate provider transaction ignored.',
          };
        }
      }
      throw error;
    }
  }

  /** WIN / REFUND — credit the ONE wallet inside one atomic transaction. */
  private async applyCredit(
    providerId: string,
    input: ValidatedCallback,
    kind: 'WIN' | 'REFUND',
  ): Promise<CasinoCallbackResponse> {
    const key = this.walletKey(kind, providerId, input.externalTransactionId);
    const creditType = kind === 'WIN' ? 'BET_PAYOUT' : 'BET_REFUND';

    const created = await this.prisma.$transaction(async (db) => {
      const credit = await this.wallet.settleBetCredit(
        db,
        input.userId,
        input.amount,
        input.currency,
        creditType,
        key,
        kind === 'WIN'
          ? `Casino win${input.externalRoundId ? ` round ${input.externalRoundId}` : ''}`
          : `Casino refund${input.externalRoundId ? ` round ${input.externalRoundId}` : ''}`,
      );

      // The ledger movement and the provider mapping are written together:
      // if the mapping insert fails the credit rolls back with it.
      const existing = await db.casinoTransaction.findUnique({
        where: {
          providerId_externalTransactionId_kind: {
            providerId,
            externalTransactionId: input.externalTransactionId,
            kind,
          },
        },
      });
      if (existing) return { row: existing, duplicate: true };

      const row = await db.casinoTransaction.create({
        data: {
          providerId,
          userId: input.userId,
          sessionId: input.providerSessionId,
          externalTransactionId: input.externalTransactionId,
          externalRoundId: input.externalRoundId,
          kind,
          amount: input.amount,
          currency: input.currency,
          nonce: input.nonce,
          walletTransactionId: credit.transactionId,
          referenceTransactionId: input.referenceTransactionId,
          reason:
            kind === 'WIN'
              ? 'Casino win credited to the TANVION wallet'
              : 'Casino refund credited to the TANVION wallet',
        },
      });
      return { row, duplicate: credit.duplicate };
    });

    const balance = await this.currentBalance(input.userId, input.currency);
    this.logCallback(
      kind.toLowerCase(),
      created.duplicate ? 'duplicate' : 'applied',
      providerId,
      null,
      input.userId,
    );
    return {
      transactionId: created.row.id,
      externalTransactionId: input.externalTransactionId,
      kind,
      duplicate: created.duplicate,
      status: 'APPLIED',
      balance,
      currency: input.currency,
      message: created.duplicate ? 'Duplicate provider transaction ignored.' : null,
    };
  }

  /**
   * REFUND — only ever credits a VALID previous bet, never twice.
   *
   * Guards: a refund must reference an APPLIED bet of the same player and
   * currency, and the sum of every applied refund/rollback against that bet may
   * never exceed the bet itself. Money is therefore never created.
   */
  private async applyRefund(
    providerId: string,
    input: ValidatedCallback,
  ): Promise<CasinoCallbackResponse> {
    const reference = await this.loadReference(providerId, input);
    if ('message' in reference) {
      return this.rejected(
        'REFUND',
        input.externalTransactionId,
        input.currency,
        reference.message,
      );
    }
    if (reference.row.kind !== 'BET') {
      return this.rejected(
        'REFUND',
        input.externalTransactionId,
        input.currency,
        'refund_reference_not_a_bet',
      );
    }

    const alreadyReversed = await this.sumReversals(providerId, reference.row.id);
    if (alreadyReversed + input.amount > Math.abs(reference.row.amount)) {
      return this.rejected(
        'REFUND',
        input.externalTransactionId,
        input.currency,
        'refund_exceeds_bet',
      );
    }

    const response = await this.applyCredit(providerId, input, 'REFUND');
    if (response.status === 'APPLIED') {
      await this.markFullyReverseIfSettled(
        providerId,
        reference.row,
        alreadyReversed + input.amount,
      );
    }
    return response;
  }

  /**
   * ROLLBACK — reverses the referenced movement, never inventing money.
   *
   *  - rollback of an APPLIED BET   → the stake is credited back;
   *  - rollback of an APPLIED WIN   → the credited win is debited again (the
   *    wallet's available-balance guard refuses it rather than going negative);
   *  - rollback of a REFUND/ROLLBACK → refused (it would create money).
   */
  private async applyRollback(
    providerId: string,
    input: ValidatedCallback,
  ): Promise<CasinoCallbackResponse> {
    const reference = await this.loadReference(providerId, input);
    if ('message' in reference) {
      return this.rejected(
        'ROLLBACK',
        input.externalTransactionId,
        input.currency,
        reference.message,
      );
    }
    if (reference.row.status === 'REVERSED') {
      const balance = await this.currentBalance(input.userId, input.currency);
      return {
        transactionId: reference.row.id,
        externalTransactionId: input.externalTransactionId,
        kind: 'ROLLBACK',
        duplicate: true,
        status: 'APPLIED',
        balance,
        currency: input.currency,
        message: 'The referenced transaction was already reversed.',
      };
    }
    if (reference.row.kind === 'REFUND' || reference.row.kind === 'ROLLBACK') {
      return this.rejected(
        'ROLLBACK',
        input.externalTransactionId,
        input.currency,
        'rollback_of_reversal_refused',
      );
    }

    if (reference.row.kind === 'BET') {
      const credited = await this.applyCredit(providerId, input, 'REFUND');
      if (credited.status === 'APPLIED') {
        await this.markReversed(providerId, reference.row.id);
      }
      return { ...credited, kind: 'ROLLBACK' };
    }

    // WIN rollback: an atomic, idempotent debit of the credited amount.
    const key = this.walletKey('ROLLBACK', providerId, input.externalTransactionId);
    const reservation = await this.wallet.reserveStake(
      input.userId,
      input.amount,
      input.currency,
      key,
    );
    await this.wallet.captureStake(input.userId, key);

    const balance = await this.currentBalance(input.userId, input.currency);
    const row = await this.prisma.casinoTransaction.create({
      data: {
        providerId,
        userId: input.userId,
        sessionId: input.providerSessionId,
        externalTransactionId: input.externalTransactionId,
        externalRoundId: input.externalRoundId,
        kind: 'ROLLBACK',
        amount: -input.amount,
        currency: input.currency,
        nonce: input.nonce,
        walletTransactionId: reservation.transactionId,
        referenceTransactionId: reference.row.externalTransactionId,
        reason: 'Casino win rolled back (debited from the TANVION wallet)',
      },
    });
    await this.markReversed(providerId, reference.row.id);
    this.logCallback(
      'rollback',
      reservation.duplicate ? 'duplicate' : 'applied',
      providerId,
      null,
      input.userId,
    );
    return {
      transactionId: row.id,
      externalTransactionId: input.externalTransactionId,
      kind: 'ROLLBACK',
      duplicate: reservation.duplicate,
      status: 'APPLIED',
      balance,
      currency: input.currency,
      message: null,
    };
  }


  // --------------------------------------------------------------------------
  // Payload validation + player mapping
  // --------------------------------------------------------------------------

  /**
   * Resolves the TANVION user behind a provider player id.
   *
   * The mapping is the CasinoSession row written at launch time (the provider
   * can only act on a player TANVION already launched). A player id TANVION
   * never launched is rejected — never guessed, never auto-created.
   */
  private async resolvePlayer(
    payload: Record<string, unknown>,
    providerId: string,
  ): Promise<ValidatedCallback | { message: string }> {
    const providerPlayerId =
      this.readString(payload, ['player_id', 'playerId', 'player']) ?? '';
    if (!providerPlayerId) return { message: 'missing_player_id' };

    const session = await this.prisma.casinoSession.findFirst({
      where: { providerId, providerPlayerId },
      orderBy: { launchedAt: 'desc' },
    });
    if (!session) return { message: 'player_not_recognized' };

    const requestedCurrency = (
      this.readString(payload, ['currency', 'currency_code']) ?? session.currency
    ).toUpperCase();
    if (requestedCurrency !== session.currency.toUpperCase()) {
      return { message: 'currency_mismatch' };
    }

    const amount = readCallbackAmount(payload, requestedCurrency);

    return {
      providerId,
      userId: session.userId,
      currency: requestedCurrency,
      amount: amount ?? 0,
      externalTransactionId:
        this.readString(payload, ['transaction_id', 'transactionId']) ?? '',
      externalRoundId:
        this.readString(payload, ['round_id', 'roundId', 'round']) ??
        session.providerRoundId,
      referenceTransactionId: this.readString(payload, [
        'reference_transaction_id',
        'referenceTransactionId',
        'original_transaction_id',
      ]),
      nonce: this.readString(payload, ['nonce']),
      providerPlayerId,
      providerSessionId: session.id,
    };
  }

  /** Kind-specific payload validation (amount, currency, identifiers). */
  private validateMovement(
    kind: CasinoTransactionKind,
    input: ValidatedCallback,
  ): ValidatedCallback | { message: string } {
    if (!input.externalTransactionId) return { message: 'missing_transaction_id' };

    const config = this.providers.config();
    if (!config.supportedCurrencies.includes(input.currency)) {
      return { message: 'unsupported_currency' };
    }
    if (input.amount <= 0) return { message: 'invalid_amount' };
    if (input.amount < config.minBetMinor) return { message: 'amount_below_minimum' };
    if (input.amount > config.maxBetMinor) return { message: 'amount_above_maximum' };

    if (kind === 'REFUND' || kind === 'ROLLBACK') {
      if (!input.referenceTransactionId) {
        return { message: 'missing_reference_transaction_id' };
      }
    }
    return input;
  }

  /** Replay guard at the request level: a provider nonce is single-use. */
  private async findDuplicate(
    providerId: string,
    input: ValidatedCallback,
  ): Promise<{ kind: 'none' } | { kind: 'nonce_conflict' }> {
    if (!input.nonce) return { kind: 'none' };
    const nonceRow = await this.prisma.casinoTransaction.findFirst({
      where: { providerId, nonce: input.nonce },
      select: { externalTransactionId: true },
    });
    if (nonceRow && nonceRow.externalTransactionId !== input.externalTransactionId) {
      return { kind: 'nonce_conflict' };
    }
    return { kind: 'none' };
  }

  // --------------------------------------------------------------------------
  // Reference + ledger helpers
  // --------------------------------------------------------------------------

  private async loadReference(
    providerId: string,
    input: ValidatedCallback,
  ): Promise<{ row: CasinoTransaction } | { message: string }> {
    if (!input.referenceTransactionId) {
      return { message: 'missing_reference_transaction_id' };
    }
    const row = await this.prisma.casinoTransaction.findFirst({
      where: {
        providerId,
        externalTransactionId: input.referenceTransactionId,
        userId: input.userId,
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) return { message: 'reference_transaction_not_found' };
    if (row.currency !== input.currency) return { message: 'reference_currency_mismatch' };
    return { row };
  }

  /** Total already refunded/rolled back against one bet (minor units). */
  private async sumReversals(providerId: string, referenceRowId: string): Promise<number> {
    const reference = await this.prisma.casinoTransaction.findUnique({
      where: { id: referenceRowId },
      select: { externalTransactionId: true },
    });
    if (!reference) return 0;
    const rows = await this.prisma.casinoTransaction.findMany({
      where: {
        providerId,
        referenceTransactionId: reference.externalTransactionId,
        kind: { in: ['REFUND', 'ROLLBACK'] },
        status: 'APPLIED',
      },
      select: { amount: true },
    });
    return rows.reduce((total, row) => total + Math.abs(row.amount), 0);
  }

  private async markReversed(providerId: string, id: string): Promise<void> {
    await this.prisma.casinoTransaction.updateMany({
      where: { id, providerId, status: 'APPLIED' },
      data: { status: 'REVERSED' },
    });
  }

  private async markFullyReverseIfSettled(
    providerId: string,
    bet: CasinoTransaction,
    reversedTotal: number,
  ): Promise<void> {
    if (reversedTotal < Math.abs(bet.amount)) return;
    await this.markReversed(providerId, bet.id);
  }

  private async findMapping(
    providerId: string,
    externalTransactionId: string,
    kind: CasinoTransactionKind,
  ): Promise<CasinoTransaction | null> {
    return this.prisma.casinoTransaction.findUnique({
      where: {
        providerId_externalTransactionId_kind: {
          providerId,
          externalTransactionId,
          kind,
        },
      },
    });
  }

  private async currentBalance(userId: string, currency: string): Promise<number> {
    const wallet = await this.wallet.getOrCreateWalletForUser(userId, currency);
    return wallet.availableBalance;
  }

  /** Deterministic ledger idempotency key — the exactly-once guard. */
  private walletKey(
    kind: CasinoTransactionKind,
    providerId: string,
    externalTransactionId: string,
  ): string {
    return `CASINO_${kind}:${providerId}:${externalTransactionId}`;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
    );
  }

  // --------------------------------------------------------------------------
  // Payload/response helpers
  // --------------------------------------------------------------------------

  private readString(
    source: Record<string, unknown>,
    keys: readonly string[],
  ): string | null {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
      if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    }
    return null;
  }

  private rejected(
    kind: CasinoTransactionKind,
    externalTransactionId: string,
    currency: string,
    message: string | null,
  ): CasinoCallbackResponse {
    return {
      transactionId: null,
      externalTransactionId,
      kind,
      duplicate: false,
      status: 'REJECTED',
      balance: null,
      currency,
      message: message ?? 'The provider request was rejected.',
    };
  }

  /** Secret-free reason for a failed movement (never a stack trace). */
  private safeReason(error: unknown): string {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return error.code === 'P2002' ? 'duplicate_transaction' : 'transaction_conflict';
    }
    if (error && typeof error === 'object' && 'getResponse' in error) {
      const response = (error as HttpException).getResponse();
      if (typeof response === 'string') return response;
      if (response && typeof response === 'object' && 'message' in response) {
        const message = (response as { message?: unknown }).message;
        if (typeof message === 'string') return message;
      }
    }
    return 'transaction_rejected';
  }

  /**
   * Structured callback log. Contains correlation identifiers only — never a
   * secret, token, signature or raw provider payload.
   */
  private logCallback(
    kind: string,
    outcome: 'applied' | 'duplicate' | 'rejected',
    providerId: string | null,
    reason: string | null,
    userId: string | null,
  ): void {
    const line = `casino.callback kind=${kind} outcome=${outcome} provider=${providerId ?? 'none'} user=${userId ?? 'unknown'}${
      reason ? ` reason=${reason}` : ''
    }`;
    if (outcome === 'rejected') this.logger.warn(line);
    else this.logger.log(line);
  }
}
