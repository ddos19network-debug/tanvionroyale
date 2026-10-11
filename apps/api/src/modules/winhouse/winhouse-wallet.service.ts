import { Injectable, Logger } from '@nestjs/common';
import type {
  WinHouseBalanceChangeResponse,
  WinHouseCallbackDiagnosticView,
  WinHouseUserDataResponse,
} from '@tanvion-royale/types';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import { isWalletError } from '../wallet/wallet-errors';
import { WalletService } from '../wallet/wallet.service';
import { describeWinHouseRefusal, refuseForSignatureReason, winhouseRefuse } from './winhouse-errors';
import {
  extractRawJsonField,
  minorUnitsToProviderAmount,
  signedDecimalToMinorUnits,
  winhouseMovementFingerprint,
} from './winhouse-money';
import {
  WinHouseProviderFactory,
  type WinHouseResolvedProvider,
} from './winhouse-provider.factory';
import { verifyCallbackToken } from './winhouse-signature';

/** Raw provider → TANVION wallet request, exactly as received. */
export interface WinHouseCallbackEnvelope {
  /** `?token=` callback token (never logged). */
  token: string | null;
  /** The EXACT request body text (the signature is built from its values). */
  rawBody: string;
  /** Parsed body (field order in the JSON document is not part of the contract). */
  payload: Record<string, unknown>;
}

/** A player mapping resolved from the provider player id. */
interface ResolvedPlayer {
  providerId: string;
  userId: string;
  currency: string;
  winhouseSessionId: string | null;
  platformSessionId: string | null;
  winhouseSessionStatus: string;
  userAccountType: string;
  userStatus: string;
  platformSessionActive: boolean;
  environment: string | null;
}

/** A validated movement, ready to be applied to the ONE TANVION wallet. */
interface ValidatedMovement {
  providerId: string;
  player: ResolvedPlayer;
  action: 'bet' | 'win';
  /** Signed minor units: negative = stake, positive = payout. */
  amountMinor: number;
  /** The amount exactly as it arrived on the wire (signature forensics). */
  amountWire: string;
  transactionId: string;
  ticketId: string;
  sessionId: string;
  /** True only when the provider quotes back the launch session verbatim. */
  sessionMatches: boolean;
  payloadHash: string;
}

interface AppliedMovementResult {
  response: WinHouseBalanceChangeResponse;
  /** New provider-mapping row id, or null when a locked duplicate was found. */
  entityId: string | null;
  balanceAfter: number;
  duplicate: boolean;
}

/** How many callback outcomes are kept in memory for the admin diagnostics. */
const WINHOUSE_DIAGNOSTIC_BUFFER = 25;

/**
 * Embedded sportsbook (WinHouse, Model B) seamless wallet — the ONLY
 * money-moving entry point for BIG SPORT when the provider hosts the book.
 *
 * THERE IS EXACTLY ONE TANVION WALLET. These callbacks debit/credit the same
 * wallet the sportsbook, deposits, withdrawals, ROYALE PLAY and the partner
 * casino use, through the existing WalletService + WalletTransaction +
 * LedgerEntry ledger. No provider-side balance is ever created, stored or
 * trusted.
 *
 * EVERY movement is:
 *   1. authenticated — callback token (constant-time) + HMAC-SHA256 signature
 *      over the five documented fields, verified BEFORE any database access;
 *   2. validated — action/amount consistency, wallet currency, player mapping,
 *      exactly representable amount;
 *   3. applied EXACTLY ONCE — the provider transaction id is the idempotency
 *      key at BOTH levels (the wallet's own idempotency key and the provider
 *      mapping's unique index), so a retry can never double-debit;
 *   4. refused loudly — 401/404/409/422/400 exactly as the provider's contract
 *      requires, never a 2xx without `status: "ok"` (which the provider would
 *      retry) and never a 5xx for a player-level refusal.
 */
@Injectable()
export class WinHouseWalletService {
  private readonly logger = new Logger(WinHouseWalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: WinHouseProviderFactory,
    private readonly wallet: WalletService,
  ) {}

  /**
   * Callback outcomes observed by THIS process (bounded ring buffer, oldest
   * first). It is deliberately in memory and never persisted: it exists to
   * answer the operator question "is the provider actually calling our wallet
   * endpoints, and if not, with which refusal code?" — the question that could
   * not be answered while every real stake was being refused.
   *
   * It holds a code + HTTP status + timestamp only: never a token, a key, a
   * signature, a payload or a balance.
   */
  private readonly recentCallbacks: WinHouseCallbackDiagnosticView[] = [];


  /**
   * Resolves the active provider and authenticates only `?token=`.
   * Used before JSON/signature semantics so every callback receives 401 for a
   * bad token before incomplete financial fields can be interpreted.
   */
  async authenticateCallbackToken(
    token: string | null | undefined,
  ): Promise<WinHouseResolvedProvider> {
    const resolved = await this.providers.resolve();
    if (!resolved.configured || !resolved.row) {
      winhouseRefuse(503, 'WINHOUSE_NOT_CONFIGURED', this.providers.unavailableMessage(resolved));
    }
    if (!verifyCallbackToken(token, resolved.callbackToken)) {
      this.logCallback('balance-change', 'rejected', resolved.row.id, 'bad_token');
      winhouseRefuse(401, 'WINHOUSE_BAD_TOKEN', 'Bad callback token');
    }
    return resolved;
  }

  // --------------------------------------------------------------------------
  // GET /winhouse/user-data?token=…&username=…
  // --------------------------------------------------------------------------

  /**
   * The provider asks for the player's current TANVION wallet balance.
   *
   * Answered in the provider's documented shape:
   *   { "username": "…", "balance": "250.00", "currency": "EUR" }
   * A balance that cannot be read as a number is treated by the provider as
   * "balance unknown" (it never assumes zero), so the value is always the exact
   * 2-decimal balance of the ONE TANVION wallet.
   */
  async handleUserData(input: {
    token: string | null | undefined;
    username: string | null | undefined;
  }): Promise<WinHouseUserDataResponse> {
    return this.traceCallback('user-data', () => this.performUserData(input));
  }

  /** The balance lookup itself — wrapped by `handleUserData` for diagnostics. */
  private async performUserData(input: {
    token: string | null | undefined;
    username: string | null | undefined;
  }): Promise<WinHouseUserDataResponse> {
    const resolved = await this.providers.resolve();
    if (!resolved.configured || !resolved.row) {
      winhouseRefuse(503, 'WINHOUSE_NOT_CONFIGURED', this.providers.unavailableMessage(resolved));
    }

    // Constant-time callback-token check BEFORE any database work.
    if (!verifyCallbackToken(input.token, resolved.callbackToken)) {
      this.logCallback('user-data', 'rejected', resolved.row!.id, 'bad_token');
      winhouseRefuse(401, 'WINHOUSE_BAD_TOKEN', 'Bad callback token');
    }

    const username = (input.username ?? '').trim();
    if (!username) {
      winhouseRefuse(404, 'WINHOUSE_UNKNOWN_PLAYER', 'Unknown player');
    }

    const player = await this.resolvePlayer(resolved.row!.id, username!);
    if (!player) {
      this.logCallback('user-data', 'rejected', resolved.row!.id, 'unknown_player');
      winhouseRefuse(404, 'WINHOUSE_UNKNOWN_PLAYER', 'Unknown player');
    }
    await this.assertMovementEligible(player!, null, 'user-data', resolved.row!.id);

    const wallet = await this.wallet.getOrCreateWalletForUser(player!.userId, player!.currency);
    if (wallet.status !== 'ACTIVE') {
      this.logCallback('user-data', 'rejected', resolved.row!.id, 'wallet_inactive', player!.userId);
      winhouseRefuse(404, 'WINHOUSE_UNKNOWN_PLAYER', 'Unknown or inactive player');
    }

    this.logCallback('user-data', 'applied', resolved.row!.id, null, player!.userId);
    return {
      username: username!,
      balance: minorUnitsToProviderAmount(wallet.availableBalance, wallet.currency),
      currency: wallet.currency,
    };
  }


  // --------------------------------------------------------------------------
  // POST /winhouse/balance-change?token=…
  // --------------------------------------------------------------------------

  /**
   * A stake (negative amount, action "bet") or a payout (positive amount,
   * action "win") is applied to the ONE TANVION wallet.
   *
   * Refusal contract (the HTTP status is the provider's retry switch):
   *   401 bad/missing signature or callback token            → final
   *   404 unknown player                                     → final
   *   409 transaction_id reused with a different payload     → final
   *   422 insufficient funds / currency or action mismatch   → final
   *   400 malformed body/amount                              → final
   *   503 our integration is not configured (honest outage → retry later)
   */
  async handleBalanceChange(
    envelope: WinHouseCallbackEnvelope,
  ): Promise<WinHouseBalanceChangeResponse> {
    return this.traceCallback('balance-change', () => this.performBalanceChange(envelope));
  }

  /** The money movement itself — wrapped by `handleBalanceChange` for diagnostics. */
  private async performBalanceChange(
    envelope: WinHouseCallbackEnvelope,
  ): Promise<WinHouseBalanceChangeResponse> {
    // Authenticate the callback token before interpreting any signed financial
    // fields. A wrong/missing token must remain a final 401 even when the body is
    // incomplete or malformed.
    const resolvedProvider = await this.authenticateCallbackToken(envelope.token);
    const movement = await this.validateMovement(envelope, resolvedProvider);
    const existing = await this.findTransaction(movement.providerId, movement.transactionId);

    if (existing) {
      // Idempotency: the SAME transaction id with the SAME payload returns the
      // ORIGINAL resulting balance and moves nothing. This check deliberately
      // precedes current-account/session eligibility: acknowledging an already
      // applied retry cannot move money and keeps the provider from retrying it.
      if (existing.payloadHash !== movement.payloadHash) {
        this.logCallback(
          movement.action,
          'rejected',
          movement.providerId,
          'transaction_conflict',
          movement.player.userId,
        );
        winhouseRefuse(
          409,
          'WINHOUSE_TRANSACTION_CONFLICT',
          'transaction_id reused with a different payload',
        );
      }
      this.logCallback(
        movement.action,
        'duplicate',
        movement.providerId,
        null,
        movement.player.userId,
      );
      return {
        status: 'ok',
        balance: minorUnitsToProviderAmount(existing.balanceAfter, existing.currency),
      };
    }

    // A first-time movement must belong to an eligible CUSTOMER account, an
    // ACTIVE canonical wallet and the still-live launch session. The provider
    // must quote that platform session back exactly.
    await this.assertMovementEligible(
      movement.player,
      movement.sessionId,
      movement.action,
      movement.providerId,
    );
    const canonicalWallet = await this.wallet.getOrCreateWalletForUser(
      movement.player.userId,
      movement.player.currency,
    );
    if (canonicalWallet.status !== 'ACTIVE') {
      this.logCallback(
        movement.action,
        'rejected',
        movement.providerId,
        'wallet_inactive',
        movement.player.userId,
      );
      winhouseRefuse(404, 'WINHOUSE_UNKNOWN_PLAYER', 'Unknown or inactive player');
    }

    try {
      const applied = await this.applyMovement(movement);
      if (applied.entityId) {
        await this.audit(
          movement.action,
          applied.entityId,
          movement,
          applied.balanceAfter,
          applied.duplicate,
        );
      }
      return applied.response;
    } catch (error) {
      // A concurrent retry won the provider-mapping unique index: the wallet
      // movement itself was already idempotent, so nothing moved twice.
      if (this.isUniqueViolation(error)) {
        const duplicate = await this.findTransaction(movement.providerId, movement.transactionId);
        if (duplicate) {
          if (duplicate.payloadHash !== movement.payloadHash) {
            winhouseRefuse(
              409,
              'WINHOUSE_TRANSACTION_CONFLICT',
              'transaction_id reused with a different payload',
            );
          }
          return {
            status: 'ok',
            balance: minorUnitsToProviderAmount(duplicate.balanceAfter, duplicate.currency),
          };
        }
      }
      // Insufficient funds is a player-level REFUSAL (422), never a retryable
      // failure: the provider must reject the bet, not retry the stake.
      if (isWalletError(error, 'INSUFFICIENT_FUNDS')) {
        this.logCallback(
          movement.action,
          'rejected',
          movement.providerId,
          'insufficient_funds',
          movement.player.userId,
        );
        winhouseRefuse(422, 'WINHOUSE_INSUFFICIENT_FUNDS', 'insufficient balance');
      }
      throw error;
    }
  }


  // --------------------------------------------------------------------------
  // Validation pipeline — authentication FIRST, then semantics
  // --------------------------------------------------------------------------

  /**
   * Authenticates + validates a balance-change request without moving money.
   *
   * The order is deliberate: the callback token is compared in constant time
   * and the HMAC-SHA256 signature over the five documented fields is verified
   * BEFORE any database access, so an unauthenticated request can neither read
   * nor write anything (and is refused with 401, which the provider treats as
   * final).
   */
  private async validateMovement(
    envelope: WinHouseCallbackEnvelope,
    resolvedProvider: WinHouseResolvedProvider,
  ): Promise<ValidatedMovement> {
    const body = envelope.payload;

    const username = this.readString(body, ['username']);
    const transactionId = this.readString(body, ['transaction_id', 'transactionId']);
    const actionRaw = this.readString(body, ['action']);
    const ticketId = this.readString(body, ['ticket_id', 'ticketId']) ?? '';
    const sessionId = this.readString(body, ['session']) ?? '';

    if (!username || !transactionId || !actionRaw) {
      winhouseRefuse(
        400,
        'WINHOUSE_MALFORMED_BODY',
        'username, transaction_id and action are required',
      );
    }

    // The amount is SIGNED (negative = stake, positive = payout) and must be
    // exactly representable in the wallet currency — never rounded, never
    // guessed. The provider signs the amount AS SENT, so the raw wire literal
    // and the parsed value are both considered.
    const parsedAmount = body['amount'];
    const wireAmount = extractRawJsonField(envelope.rawBody, 'amount');
    const candidates = this.amountCandidates(parsedAmount, wireAmount);
    if (candidates.length === 0) {
      winhouseRefuse(400, 'WINHOUSE_INVALID_AMOUNT', 'bad amount');
    }

    const verdict = await this.providers.verifyInboundCallback(
      {
        token: envelope.token,
        signature: this.readString(body, ['signature']),
        fields: {
          username: username as string,
          action: actionRaw as string,
          ticketId,
          transactionId: transactionId as string,
        },
        amountCandidates: candidates,
      },
      resolvedProvider,
    );
    if (!verdict.ok || !verdict.providerId) {
      refuseForSignatureReason(verdict.reason ?? 'bad_signature');
    }
    const providerId = verdict.providerId as string;

    const player = await this.resolvePlayer(providerId, username as string);
    if (!player) {
      this.logCallback(actionRaw, 'rejected', providerId, 'unknown_player');
      winhouseRefuse(404, 'WINHOUSE_UNKNOWN_PLAYER', 'unknown player');
    }
    const resolvedPlayer = player as ResolvedPlayer;

    // Currency is NEVER converted: the provider book plays in exactly one
    // currency (the wallet's) and a different one is refused outright.
    const providedCurrency = this.readString(body, ['currency']);
    if (
      providedCurrency &&
      providedCurrency.toUpperCase() !== resolvedPlayer.currency.toUpperCase()
    ) {
      this.logCallback(
        actionRaw,
        'rejected',
        providerId,
        'currency_mismatch',
        resolvedPlayer.userId,
      );
      winhouseRefuse(422, 'WINHOUSE_CURRENCY_MISMATCH', 'currency does not match the wallet');
    }

    const action = (actionRaw as string).toLowerCase();
    if (action !== 'bet' && action !== 'win') {
      winhouseRefuse(422, 'WINHOUSE_UNSUPPORTED_ACTION', 'unsupported action');
    }

    const amountMinor =
      signedDecimalToMinorUnits(parsedAmount, resolvedPlayer.currency) ??
      signedDecimalToMinorUnits(wireAmount, resolvedPlayer.currency);
    if (amountMinor === null || amountMinor === 0) {
      winhouseRefuse(400, 'WINHOUSE_INVALID_AMOUNT', 'bad amount');
    }

    // action and amount sign must agree (negative = stake, positive = payout).
    if ((action === 'bet' && amountMinor > 0) || (action === 'win' && amountMinor < 0)) {
      this.logCallback(
        action,
        'rejected',
        providerId,
        'action_amount_mismatch',
        resolvedPlayer.userId,
      );
      winhouseRefuse(
        422,
        'WINHOUSE_ACTION_AMOUNT_MISMATCH',
        'action does not match the amount sign',
      );
    }

    return {
      providerId,
      player: resolvedPlayer,
      action,
      amountMinor,
      amountWire: candidates[0] ?? String(amountMinor),
      transactionId: transactionId as string,
      ticketId,
      sessionId,
      sessionMatches: sessionId === (resolvedPlayer.platformSessionId ?? ''),
      // The idempotency COMPARISON is over the parsed movement fields (the
      // provider's own reference implementation re-serializes the parsed body
      // too), so a retry that re-stringifies the same amount — "-25.00" vs
      // "-25" — is still the SAME transaction, while a different amount,
      // action, ticket or session is a conflict (409).
      payloadHash: this.payloadHash({
        username: username as string,
        amountMinor,
        currency: resolvedPlayer.currency,
        action,
        ticketId,
        session: sessionId,
      }),
    };
  }


  /**
   * The amount representations the signature is accepted against.
   *
   * The provider signs the amount "as sent on the wire": a JSON body we parsed
   * and re-stringified would turn "-25.00" into "-25" and break a literal
   * comparison. Both the raw wire literal and the parsed value are therefore
   * offered — but only when they represent the SAME number: a disagreement
   * means the body was altered in transit, and the signature would not match
   * anyway. When both agree, ONLY the wire literal is used (that is exactly
   * what the provider signed).
   */
  private amountCandidates(parsed: unknown, wire: string | null): string[] {
    const parsedAsString =
      typeof parsed === 'number'
        ? String(parsed)
        : typeof parsed === 'string'
          ? parsed.trim()
          : '';

    if (wire && wire.length > 0) {
      if (!parsedAsString) return [wire];
      const wireNumber = Number(wire);
      const parsedNumber = Number(parsedAsString);
      const sameValue =
        Number.isFinite(wireNumber) && Number.isFinite(parsedNumber) && wireNumber === parsedNumber;
      return sameValue ? [wire] : [];
    }

    return parsedAsString ? [parsedAsString] : [];
  }

  // --------------------------------------------------------------------------
  // Movement application (atomic, idempotent)
  // --------------------------------------------------------------------------

  /**
   * Applies one movement and its provider mapping in the SAME database
   * transaction. The WinHouseSession row is the server-authoritative player
   * lock; WalletService then takes the canonical Wallet row lock. A mapping
   * failure therefore rolls back every WalletTransaction and LedgerEntry write
   * instead of leaving money applied without its idempotent semantic result.
   */
  private async applyMovement(movement: ValidatedMovement): Promise<AppliedMovementResult> {
    const { player, action, providerId, transactionId } = movement;
    const key = this.walletKey(action, providerId, transactionId);

    const applied = await this.prisma.$transaction(async (db) => {
      if (!player.winhouseSessionId) {
        throw new Error('Resolved WinHouse player has no launch-session lock.');
      }
      await db.$queryRaw`
        SELECT id
        FROM "WinHouseSession"
        WHERE id = ${player.winhouseSessionId}
        FOR UPDATE
      `;

      // Re-read after the per-player lock. This closes the race where two
      // identical provider retries both observed no mapping before entering.
      const concurrent = await db.winHouseTransaction.findUnique({
        where: { providerId_transactionId: { providerId, transactionId } },
        select: { id: true, payloadHash: true, balanceAfter: true, currency: true },
      });
      if (concurrent) {
        if (concurrent.payloadHash !== movement.payloadHash) {
          winhouseRefuse(
            409,
            'WINHOUSE_TRANSACTION_CONFLICT',
            'transaction_id reused with a different payload',
          );
        }
        return {
          response: {
            status: 'ok' as const,
            balance: minorUnitsToProviderAmount(
              concurrent.balanceAfter,
              concurrent.currency,
            ),
          },
          entityId: null,
          balanceAfter: concurrent.balanceAfter,
          duplicate: true,
        };
      }

      let walletTransactionId: string;
      let duplicate: boolean;
      if (action === 'bet') {
        const reservation = await this.wallet.reserveStakeInTx(
          db,
          player.userId,
          Math.abs(movement.amountMinor),
          player.currency,
          key,
        );
        await this.wallet.captureStakeInTx(db, player.userId, key);
        walletTransactionId = reservation.transactionId;
        duplicate = reservation.duplicate;
      } else {
        const credit = await this.wallet.settleBetCredit(
          db,
          player.userId,
          movement.amountMinor,
          player.currency,
          'BET_PAYOUT',
          key,
          'WinHouse sportsbook payout credited to the TANVION wallet',
        );
        walletTransactionId = credit.transactionId;
        duplicate = credit.duplicate;
      }

      const balances = await this.ledgerBalances(db, walletTransactionId);
      const row = await db.winHouseTransaction.create({
        data: {
          providerId,
          userId: player.userId,
          transactionId,
          action,
          ticketId: movement.ticketId || null,
          sessionId: movement.sessionId || null,
          winhouseSessionId: player.winhouseSessionId,
          amountMinor: movement.amountMinor,
          amountWire: movement.amountWire,
          currency: player.currency,
          balanceBefore: balances.before,
          balanceAfter: balances.after,
          payloadHash: movement.payloadHash,
          walletTransactionId,
          environment: player.environment,
        },
      });

      return {
        response: {
          status: 'ok' as const,
          balance: minorUnitsToProviderAmount(row.balanceAfter, row.currency),
        },
        entityId: row.id,
        balanceAfter: row.balanceAfter,
        duplicate,
      };
    });

    this.logCallback(
      action,
      applied.duplicate ? 'duplicate' : 'applied',
      providerId,
      null,
      player.userId,
    );
    return applied;
  }


  // --------------------------------------------------------------------------
  // Ledger / mapping helpers
  // --------------------------------------------------------------------------

  /**
   * The wallet balance immediately before/after the movement, taken from the
   * immutable LedgerEntry rows that were written WITH it (never recomputed from
   * a later read, which could include a concurrent movement).
   *
   * A stake writes two entries (reserve then capture) and a payout one, so the
   * exact envelope is max(availableBefore) → min(availableAfter); this is
   * deterministic and does not depend on same-millisecond row ordering.
   */
  private async ledgerBalances(
    db: Prisma.TransactionClient,
    walletTransactionId: string,
  ): Promise<{ before: number; after: number }> {
    const entries = await db.ledgerEntry.findMany({
      where: { transactionId: walletTransactionId },
      select: { availableBefore: true, availableAfter: true },
    });

    if (entries.length === 0) {
      // A canonical wallet mutation without its immutable ledger entry is an
      // invariant violation. Roll the whole provider transaction back; never
      // fabricate a balance for the provider mapping.
      throw new Error('Wallet movement has no LedgerEntry.');
    }

    return {
      before: Math.max(...entries.map((entry) => entry.availableBefore)),
      after: Math.min(...entries.map((entry) => entry.availableAfter)),
    };
  }

  /** The provider transaction mapping for the idempotency/conflict checks. */
  private async findTransaction(providerId: string, transactionId: string) {
    return this.prisma.winHouseTransaction.findUnique({
      where: { providerId_transactionId: { providerId, transactionId } },
      select: { id: true, payloadHash: true, balanceAfter: true, currency: true },
    });
  }

  /**
   * Refuses a FIRST movement unless every server-authoritative eligibility
   * condition still holds. `expectedSession === null` is used by user-data,
   * whose provider contract has no session parameter; balance-change passes the
   * quoted session and therefore must match it exactly.
   */
  private async assertMovementEligible(
    player: ResolvedPlayer,
    expectedSession: string | null,
    kind: string,
    providerId: string,
  ): Promise<void> {
    const accountEligible =
      player.userAccountType === 'CUSTOMER' &&
      player.userStatus === 'ACTIVE' &&
      player.winhouseSessionStatus === 'ACTIVE' &&
      player.platformSessionActive;
    if (!accountEligible) {
      this.logCallback(kind, 'rejected', providerId, 'player_ineligible', player.userId);
      winhouseRefuse(404, 'WINHOUSE_UNKNOWN_PLAYER', 'Unknown or inactive player');
    }

    if (expectedSession !== null && expectedSession !== (player.platformSessionId ?? '')) {
      this.logCallback(kind, 'rejected', providerId, 'session_mismatch', player.userId);
      winhouseRefuse(404, 'WINHOUSE_UNKNOWN_PLAYER', 'Unknown or inactive player session');
    }
  }

  /**
   * The TANVION user behind a provider player id, resolved through the launch
   * session recorded when the book was opened. The newest row is used even when
   * closed so an already-applied provider retry can be acknowledged; any NEW
   * movement is subsequently refused by assertMovementEligible until the user,
   * wallet, launch and platform session are all active again.
   */
  private async resolvePlayer(
    providerId: string,
    providerPlayerId: string,
  ): Promise<ResolvedPlayer | null> {
    const session = await this.prisma.winHouseSession.findFirst({
      where: { providerId, providerPlayerId },
      orderBy: { launchedAt: 'desc' },
      select: {
        id: true,
        userId: true,
        currency: true,
        environment: true,
        status: true,
        platformSessionId: true,
        user: { select: { accountType: true, status: true } },
      },
    });
    if (!session?.user) return null;

    let platformSessionActive = true;
    if (session.platformSessionId) {
      const platformSession = await this.prisma.session.findFirst({
        where: {
          id: session.platformSessionId,
          userId: session.userId,
          kind: 'CUSTOMER',
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true },
      });
      platformSessionActive = platformSession !== null;
    }

    return {
      providerId,
      userId: session.userId,
      currency: session.currency,
      winhouseSessionId: session.id,
      platformSessionId: session.platformSessionId,
      winhouseSessionStatus: session.status,
      userAccountType: session.user.accountType,
      userStatus: session.user.status,
      platformSessionActive,
      environment: session.environment,
    };
  }

  /**
   * Deterministic ledger idempotency key — the exactly-once guard at the WALLET
   * level (unique per user+key), independent of the provider mapping index.
   */
  private walletKey(action: 'bet' | 'win', providerId: string, transactionId: string): string {
    return `WINHOUSE_${action.toUpperCase()}:${providerId}:${transactionId}`;
  }

  /**
   * SHA-256 over the parsed movement fields (409 detection, no payload stored).
   * The definition lives in `winhouseMovementFingerprint` so the admin self-test
   * exercises the SAME comparison the money path uses.
   */
  private payloadHash(fields: {
    username: string;
    amountMinor: number;
    currency: string;
    action: string;
    ticketId: string;
    session: string;
  }): string {
    return winhouseMovementFingerprint(fields);
  }

  /**
   * Records a callback outcome, then always re-throws the ORIGINAL error, so the
   * provider-facing refusal contract (status + code) is exactly as before.
   */
  private async traceCallback<T>(
    kind: WinHouseCallbackDiagnosticView['kind'],
    run: () => Promise<T>,
  ): Promise<T> {
    try {
      const result = await run();
      this.recordCallback(kind, 'ok', 200, null);
      return result;
    } catch (error) {
      const refusal = describeWinHouseRefusal(error);
      this.recordCallback(kind, 'rejected', refusal.status, refusal.code);
      throw error;
    }
  }

  private recordCallback(
    kind: WinHouseCallbackDiagnosticView['kind'],
    outcome: 'ok' | 'rejected',
    status: number,
    code: string | null,
  ): void {
    this.recentCallbacks.push({
      kind,
      outcome,
      code,
      status,
      at: new Date().toISOString(),
    });
    while (this.recentCallbacks.length > WINHOUSE_DIAGNOSTIC_BUFFER) {
      this.recentCallbacks.shift();
    }
  }

  /**
   * Last callback of each kind since this process started — the admin status
   * view's "are the provider's calls reaching us?" answer. `lastError` is the
   * most recent REFUSAL with its stable code (e.g. `WINHOUSE_BAD_SIGNATURE`).
   */
  diagnosticsSnapshot(): {
    lastCallback: WinHouseCallbackDiagnosticView | null;
    lastBalanceChange: WinHouseCallbackDiagnosticView | null;
    lastError: WinHouseCallbackDiagnosticView | null;
  } {
    const all = this.recentCallbacks;
    const reversed = [...all].reverse();
    return {
      lastCallback: all.length > 0 ? all[all.length - 1] : null,
      lastBalanceChange: reversed.find((entry) => entry.kind === 'balance-change') ?? null,
      lastError: reversed.find((entry) => entry.outcome === 'rejected') ?? null,
    };
  }

  /**
   * SAFE money-path dry run for the admin self-test.
   *
   * It drives the REAL wallet ledger — stake reservation, a repeated reservation
   * with the SAME key (wallet-level idempotency), stake capture and a win payout
   * — inside ONE database transaction that is ALWAYS rolled back, so no balance,
   * ledger entry or transaction row is ever changed for a real player.
   *
   * Rationale: before a real bet can work, the ONE TANVION wallet must be
   * debitable and creditable through `WalletService` in THIS deployment. This
   * proves it end to end (including the row-lock path) without risking a single
   * unit of real money.
   */
  async probeWalletRoundTrip(): Promise<{ ok: boolean; detail: string | null }> {
    const ROLLBACK = 'WINHOUSE_SELF_TEST_ROLLBACK';
    try {
      const target = await this.prisma.wallet.findFirst({
        orderBy: { updatedAt: 'desc' },
        select: { userId: true, currency: true },
      });
      if (!target) {
        // Nothing to dry-run yet — not a failure, and never a fabricated pass.
        return { ok: true, detail: 'no wallet exists yet; nothing to dry-run' };
      }

      try {
        await this.prisma.$transaction(async (db) => {
          const where = {
            userId_currency: { userId: target.userId, currency: target.currency },
          };
          const before = await db.wallet.findUnique({
            where,
            select: { availableBalance: true, lockedBalance: true },
          });
          if (!before) throw new Error('WINHOUSE_SELF_TEST_WALLET_MISSING');

          const key = `WINHOUSE_SELFTEST:${Date.now()}:${Math.random().toString(16).slice(2)}`;
          const stakeKey = `${key}:STAKE`;

          const stake = await this.wallet.reserveStakeInTx(
            db,
            target.userId,
            1,
            target.currency,
            stakeKey,
          );
          // The SAME provider idempotency key must resolve to the ORIGINAL
          // reservation: a retried callback can never debit twice.
          const repeat = await this.wallet.reserveStakeInTx(
            db,
            target.userId,
            1,
            target.currency,
            stakeKey,
          );
          const captured = await this.wallet.captureStakeInTx(db, target.userId, stakeKey);
          const payout = await this.wallet.settleBetCredit(
            db,
            target.userId,
            2,
            target.currency,
            'BET_PAYOUT',
            `${key}:PAYOUT`,
            'WINHOUSE_SELF_TEST',
          );

          const after = await db.wallet.findUnique({
            where,
            select: { availableBalance: true, lockedBalance: true },
          });

          const ok =
            !stake.duplicate &&
            repeat.duplicate &&
            repeat.transactionId === stake.transactionId &&
            captured.status === 'COMPLETED' &&
            !payout.duplicate &&
            after !== null &&
            after.lockedBalance === before.lockedBalance &&
            after.availableBalance === before.availableBalance + 1;

          if (!ok) throw new Error('WINHOUSE_SELF_TEST_ROUND_TRIP_MISMATCH');

          // Never commit: the dry run must leave the wallet exactly as it was.
          throw new Error(ROLLBACK);
        });
      } catch (error) {
        if (!(error instanceof Error) || error.message !== ROLLBACK) throw error;
      }

      return {
        ok: true,
        detail: 'stake debit + capture + payout credit verified, then rolled back',
      };
    } catch (error) {
      return { ok: false, detail: this.safeErrorDetail(error) };
    }
  }

  /**
   * A short, credential-free description of a failure for the admin self-test.
   * Connection strings are redacted: a Prisma initialization error can contain
   * the database URL, and no admin UI may ever display one.
   */
  private safeErrorDetail(error: unknown): string {
    const raw =
      error instanceof Error ? `${error.name}: ${error.message}` : 'round_trip_failed';
    return raw.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<redacted-url>').slice(0, 160);
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
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
   * Structured callback log: provider/ticket/outcome correlation only — never a
   * token, never a signature, never a wallet key, never the raw payload.
   */
  private logCallback(
    kind: string,
    outcome: 'applied' | 'duplicate' | 'rejected',
    providerId: string | null,
    reason: string | null,
    userId?: string | null,
  ): void {
    const line = `winhouse.callback kind=${kind} outcome=${outcome} provider=${
      providerId ?? 'none'
    }${userId ? ` user=${userId}` : ''}${reason ? ` reason=${reason}` : ''}`;
    if (outcome === 'rejected') this.logger.warn(line);
    else this.logger.log(line);
  }

  /** Best-effort audit trail of an applied movement (never breaks the money path). */
  private async audit(
    action: string,
    entityId: string,
    movement: ValidatedMovement,
    balanceAfter: number,
    duplicate: boolean,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: null,
          actorType: 'SYSTEM',
          action: 'WINHOUSE_CALLBACK_APPLIED',
          entityType: 'WinHouseTransaction',
          entityId,
          newValue: {
            movement: action,
            transactionId: movement.transactionId,
            ticketId: movement.ticketId || null,
            currency: movement.player.currency,
            amountMinor: movement.amountMinor,
            balanceAfter,
            duplicate,
          } as never,
        },
      });
    } catch {
      // Auditing is observability, not part of the money movement.
    }
  }
}

