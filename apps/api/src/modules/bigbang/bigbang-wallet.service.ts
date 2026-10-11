import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import { isWalletError } from '../wallet/wallet-errors';
import { WalletService } from '../wallet/wallet.service';
import { minorUnitsToDecimal } from '../casino/casino-money';
import { extractBigBangRawField, signedBigBangAmountToMinorUnits } from './bigbang-money';
import {
  CasinoProviderFactory,
  type BigBangResolvedCredentials,
} from '../casino/casino-provider.factory';
import { verifyBigBangApiKey, verifyBigBangHmac } from './bigbang-signature';
import { bigbangRefuse } from './bigbang.errors';
import type {
  BigBangBalanceChangeCallbackResponse,
  BigBangUserDataCallbackResponse,
} from './bigbang.interface';

/** Raw provider → TANVION callback request, exactly as received. */
export interface BigBangCallbackEnvelope {
  /** Inbound `X-API-Key` header (never logged, never returned). */
  apiKey: string | null | undefined;
  /** The EXACT request body text (the HMAC is built from its amount spelling). */
  rawBody: string;
  /** Parsed body (JSON field order is not part of the signature contract). */
  payload: Record<string, unknown>;
}

/** A player resolved from the BigBang `username` through its launch session. */
interface ResolvedPlayer {
  sessionId: string;
  userId: string;
  currency: string;
  environment: string;
  sessionStatus: string;
  userStatus: string;
  accountType: string;
}

/** A validated movement, ready to be applied to the ONE TANVION wallet. */
interface ValidatedMovement {
  providerId: string;
  player: ResolvedPlayer;
  transactionId: string;
  /** The amount exactly as it arrived on the wire (persisted for forensics). */
  amountWire: string;
  /** Signed minor units: negative = bet/debit, positive = win/credit, 0 = close. */
  amountMinor: number;
  currency: string;
  game: string;
  gameCategory: string;
  gameId: string | null;
  providerExternalId: string | null;
  roundId: string | null;
  /** BigBang `type` (`bet` | `win` | `refund` | `round`); `round_type` legacy alias. */
  roundType: string | null;
  roundEnd: boolean | null;
  sandbox: boolean;
  payloadHash: string;
}

interface AppliedMovement {
  response: BigBangBalanceChangeCallbackResponse;
  /** The new provider-mapping row id, or null when a locked duplicate was found. */
  entityId: string | null;
}

/**
 * BigBang casino-aggregator seamless wallet — the ONLY money-moving entry point
 * for BIG CASINO / BIG LIVE CASINO.
 *
 * THERE IS EXACTLY ONE TANVION WALLET: every bet/win/refund debits or credits
 * the same wallet the sportsbook, deposits, withdrawals, ROYALE PLAY and the
 * partner casino use, through WalletService + WalletTransaction + LedgerEntry.
 * No provider-side balance is ever created, stored or trusted.
 *
 * EVERY movement is:
 *   1. authenticated — the resolved, environment-matched BigBang API key is
 *      compared with the inbound `X-API-Key` in constant time, and the
 *      HMAC-SHA256 signature over the five documented fields (username, amount,
 *      game, game_category, transaction_id) is verified BEFORE any database
 *      access, using the amount EXACTLY as it arrived;
 *   2. validated — required fields, amount representability in the wallet
 *      currency, currency agreement, player mapping and player eligibility;
 *   3. applied EXACTLY ONCE — the provider `transaction_id` is the idempotency
 *      key at BOTH levels (the wallet's own idempotency key and the
 *      `@@unique([providerId, transactionId])` mapping index), and the launch
 *      session row is locked so two concurrent retries cannot both apply;
 *   4. atomic — the wallet movement, its ledger entries and the provider
 *      mapping row are written in ONE database transaction (or none of them);
 *   5. refused in the provider's documented shape — insufficient balance is
 *      HTTP 400 `{ "error": "insufficient balance" }`, the only answer that
 *      makes BigBang show its "insufficient funds" dialog.
 */
@Injectable()
export class BigBangWalletService {
  private readonly logger = new Logger(BigBangWalletService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providers: CasinoProviderFactory,
    private readonly wallet: WalletService,
  ) {}

  // --------------------------------------------------------------------------
  // GET /bigbang/callbacks/user-data?username=…
  // --------------------------------------------------------------------------

  /**
   * The provider asks for the player's current TANVION wallet balance.
   *
   * Answered in the provider's documented shape:
   *   { "username": "…", "balance": "1250.00", "currency": "EUR" }
   * A 404 means "unknown player" to BigBang; the balance is always the exact
   * 2-decimal balance of the ONE TANVION wallet (never a provider-side number).
   */
  async handleUserData(input: {
    apiKey: string | null | undefined;
    username: string | null | undefined;
  }): Promise<BigBangUserDataCallbackResponse> {
    const credentials = await this.authenticate(input.apiKey);
    const username = (input.username ?? '').trim();
    if (!username) {
      this.logCallback('rejected', credentials.row.id, 'missing_username', null);
      bigbangRefuse(404, 'BIGBANG_UNKNOWN_PLAYER', 'Unknown player');
    }

    const player = await this.resolvePlayer(credentials.row.id, username);
    if (!player) {
      this.logCallback('rejected', credentials.row.id, 'unknown_player', null);
      bigbangRefuse(404, 'BIGBANG_UNKNOWN_PLAYER', 'Unknown player');
    }
    this.assertEligible(player, credentials.environment, credentials.row.id);

    const canonicalWallet = await this.wallet.getOrCreateWalletForUser(
      player.userId,
      player.currency,
    );
    if (canonicalWallet.status !== 'ACTIVE') {
      this.logCallback('rejected', credentials.row.id, 'wallet_inactive', player.userId);
      bigbangRefuse(404, 'BIGBANG_UNKNOWN_PLAYER', 'Unknown or inactive player');
    }

    this.logCallback('applied', credentials.row.id, null, player.userId);
    return {
      username,
      balance: minorUnitsToDecimal(canonicalWallet.availableBalance, canonicalWallet.currency),
      currency: canonicalWallet.currency,
    };
  }

  // --------------------------------------------------------------------------
  // POST /bigbang/callbacks/balance-change
  // --------------------------------------------------------------------------

  /**
   * A bet (negative amount, debit), a win/refund (positive amount, credit) or a
   * round close (amount exactly 0) applied to the ONE TANVION wallet.
   *
   * Refusal contract (the HTTP status is the provider's retry switch):
   *   401 bad/missing API key or signature          → final
   *   404 unknown/ineligible player                 → final
   *   409 transaction_id reused with another payload → final
   *   400 malformed body / unreadable amount / insufficient balance → final
   *   503 our integration is not configured (honest outage → retry later)
   */
  async handleBalanceChange(
    envelope: BigBangCallbackEnvelope,
  ): Promise<BigBangBalanceChangeCallbackResponse> {
    const credentials = await this.authenticate(envelope.apiKey);
    const movement = await this.validateMovement(envelope, credentials);

    // Idempotency: the provider `transaction_id` is the key. This check
    // precedes the current-account eligibility check on purpose — acknowledging
    // an already-applied retry cannot move money and keeps BigBang from
    // retrying a movement that is already settled.
    const existing = await this.findTransaction(movement.providerId, movement.transactionId);
    if (existing) return this.duplicateResponse(existing, movement);

    // A FIRST movement must belong to an eligible CUSTOMER account with a live
    // launch session, an ACTIVE canonical wallet and the same environment.
    this.assertEligible(movement.player, credentials.environment, movement.providerId);
    const canonicalWallet = await this.wallet.getOrCreateWalletForUser(
      movement.player.userId,
      movement.player.currency,
    );
    if (canonicalWallet.status !== 'ACTIVE') {
      this.logCallback('rejected', movement.providerId, 'wallet_inactive', movement.player.userId);
      bigbangRefuse(404, 'BIGBANG_UNKNOWN_PLAYER', 'Unknown or inactive player');
    }

    try {
      const applied = await this.applyMovement(movement, canonicalWallet.availableBalance);
      if (applied.entityId) {
        await this.audit(applied.entityId, movement, applied.response);
      }
      return applied.response;
    } catch (error) {
      // A concurrent retry won the (providerId, transactionId) unique index:
      // the wallet movement itself is idempotent, so nothing moved twice.
      if (this.isUniqueViolation(error)) {
        const duplicate = await this.findTransaction(movement.providerId, movement.transactionId);
        if (duplicate) return this.duplicateResponse(duplicate, movement);
      }
      if (isWalletError(error, 'INSUFFICIENT_FUNDS')) {
        // The documented BigBang refusal: HTTP 400 { "error": "insufficient
        // balance" } and nothing is persisted (the movement rolled back).
        this.logCallback(
          'rejected',
          movement.providerId,
          'insufficient_funds',
          movement.player.userId,
        );
        bigbangRefuse(400, 'BIGBANG_INSUFFICIENT_FUNDS', 'insufficient balance');
      }
      throw error;
    }
  }

  // --------------------------------------------------------------------------
  // Authentication — resolved provider credentials, never an environment key
  // --------------------------------------------------------------------------

  /**
   * Resolves the active BigBang PartnerProvider row for this deployment's
   * environment and authenticates the inbound `X-API-Key` against its decrypted
   * API key in constant time.
   *
   * The API key is NEVER read from an environment variable, NEVER logged and
   * NEVER returned in a response; a missing/inactive/environment-mismatched
   * provider or a wrong key is refused before any database or wallet access.
   */
  async authenticate(apiKey: string | null | undefined): Promise<BigBangResolvedCredentials> {
    const resolved = await this.providers.resolveBigBang();
    if (!resolved.ok) {
      this.logCallback('rejected', resolved.providerId, resolved.reason, null);
      bigbangRefuse(503, 'BIGBANG_NOT_CONFIGURED', this.unavailableMessage(resolved.reason));
    }

    const credentials = resolved.credentials;
    if (!verifyBigBangApiKey(apiKey, credentials.apiKey)) {
      this.logCallback('rejected', credentials.row.id, 'bad_api_key', null);
      bigbangRefuse(401, 'BIGBANG_BAD_API_KEY', 'Bad API key');
    }
    return credentials;
  }

  /** Secret-free, actionable reason for an unusable BigBang integration. */
  private unavailableMessage(reason: string): string {
    switch (reason) {
      case 'provider_disabled':
        return 'The BigBang provider is disabled.';
      case 'environment_mismatch':
        return 'The BigBang provider is registered for another environment.';
      case 'invalid_base_url':
        return 'The BigBang provider has an invalid API base URL.';
      case 'credentials_missing':
        return 'The BigBang provider has no API key configured.';
      default:
        return 'BigBang is not configured for this environment.';
    }
  }

  // --------------------------------------------------------------------------
  // Validation pipeline — authentication and signature FIRST, then semantics
  // --------------------------------------------------------------------------

  /**
   * Validates a documented balance_change callback WITHOUT moving money.
   *
   * The order is deliberate: the signature is verified over the EXACT amount
   * spelling received before any database access, so an unauthenticated request
   * can neither read nor write anything (and is refused with 401, which BigBang
   * treats as final). The amount sign is the provider's own semantics and is
   * never rewritten: negative = debit, positive = credit, exactly 0 = close.
   */
  private async validateMovement(
    envelope: BigBangCallbackEnvelope,
    credentials: BigBangResolvedCredentials,
  ): Promise<ValidatedMovement> {
    const body = envelope.payload;
    const providerId = credentials.row.id;

    const username = this.readString(body, ['username']);
    const transactionId = this.readString(body, ['transaction_id', 'transactionId']);
    const game = this.readString(body, ['game']);
    const gameCategory = this.readString(body, ['game_category', 'gameCategory']);

    if (!username || !game || !gameCategory) {
      this.logCallback('rejected', providerId, 'malformed_body', null);
      bigbangRefuse(
        400,
        'BIGBANG_MALFORMED_BODY',
        'username, game and game_category are required',
      );
    }
    if (!transactionId) {
      this.logCallback('rejected', providerId, 'malformed_body', null);
      bigbangRefuse(400, 'BIGBANG_MALFORMED_BODY', 'transaction_id is required');
    }

    // The signed amount: the literal spelling of the top-level JSON field is
    // what the provider signed, so it is used VERBATIM (never reformatted).
    const wireAmount = extractBigBangRawField(envelope.rawBody, 'amount');
    const amountCandidates = this.amountCandidates(body['amount'], wireAmount);
    if (amountCandidates.length === 0) {
      this.logCallback('rejected', providerId, 'invalid_amount', null);
      bigbangRefuse(400, 'BIGBANG_INVALID_AMOUNT', 'bad amount');
    }

    const signature = this.readString(body, ['signature']);
    if (!signature) {
      this.logCallback('rejected', providerId, 'missing_signature', null);
      bigbangRefuse(401, 'BIGBANG_MISSING_SIGNATURE', 'Missing signature');
    }
    const signed = amountCandidates.some((amount) =>
      verifyBigBangHmac(
        credentials.apiKey,
        {
          username: username as string,
          amount,
          game: game as string,
          game_category: gameCategory as string,
          transaction_id: transactionId as string,
        },
        signature,
      ),
    );
    if (!signed) {
      this.logCallback('rejected', providerId, 'bad_signature', null);
      bigbangRefuse(401, 'BIGBANG_BAD_SIGNATURE', 'Bad signature');
    }

    // The provider `username` is the stable TANVION player id handed to BigBang
    // as `user_token` at launch, so it resolves through the launch session.
    const player = await this.resolvePlayer(providerId, username as string);
    if (!player) {
      this.logCallback('rejected', providerId, 'unknown_player', null);
      bigbangRefuse(404, 'BIGBANG_UNKNOWN_PLAYER', 'Unknown player');
    }

    // Currency is never converted: a mismatch is refused outright.
    const providedCurrency = this.readString(body, ['currency']);
    const walletCurrency = player.currency;
    if (providedCurrency && providedCurrency.toUpperCase() !== walletCurrency.toUpperCase()) {
      this.logCallback('rejected', providerId, 'currency_mismatch', player.userId);
      bigbangRefuse(422, 'BIGBANG_CURRENCY_MISMATCH', 'currency does not match the wallet');
    }

    const parsedAmount = body['amount'];
    const amountMinor =
      signedBigBangAmountToMinorUnits(parsedAmount, walletCurrency) ??
      signedBigBangAmountToMinorUnits(amountCandidates[0], walletCurrency);
    if (amountMinor === null) {
      this.logCallback('rejected', providerId, 'invalid_amount', player.userId);
      bigbangRefuse(400, 'BIGBANG_INVALID_AMOUNT', 'bad amount');
    }

    const roundId = this.readString(body, ['round_id', 'roundId']);
    const roundType = this.readString(body, ['type', 'round_type']);
    const roundEnd = this.readBoolean(body['round_end'] ?? body['roundEnd']);
    const gameId = this.readString(body, ['game_id', 'gameId']);
    const providerExternalId = this.readString(body, ['provider_id', 'providerId']);
    const sandbox = this.readBoolean(body['sandbox']) === true;

    return {
      providerId,
      player,
      transactionId: transactionId as string,
      amountWire: amountCandidates[0] ?? String(amountMinor),
      amountMinor,
      currency: walletCurrency,
      game: game as string,
      gameCategory: gameCategory as string,
      gameId,
      providerExternalId,
      roundId,
      roundType,
      roundEnd,
      sandbox,
      // Deterministic, secret-free fingerprint of the PARSED movement, so a
      // retry that re-stringifies the same amount ("-2.50" vs "-2.5") is still
      // the SAME transaction while a different amount/round is a conflict.
      payloadHash: this.payloadHash({
        username: username as string,
        amountMinor,
        currency: walletCurrency,
        game: game as string,
        gameCategory: gameCategory as string,
        roundId,
        roundType,
        roundEnd,
        gameId,
        providerExternalId,
        sandbox,
      }),
    };
  }

  /**
   * The amount spellings the HMAC is accepted against.
   *
   * The provider signs the amount AS SENT, so the literal spelling of the
   * top-level JSON field is the PRIMARY candidate: a body that says `-2.50`
   * must be verified as `-2.50` and is never reformatted first. BigBang's own
   * reference implementation signs the SHORTEST JavaScript form of the parsed
   * number, so that spelling is accepted as well — but only when both spellings
   * represent the SAME number. A disagreement means the body was altered in
   * transit, and nothing is accepted.
   */
  private amountCandidates(parsed: unknown, wire: string | null): string[] {
    const shortest = this.shortestAmount(parsed);
    const literal = (wire ?? '').trim();
    if (!literal) return shortest ? [shortest] : [];
    if (!shortest) return [];
    if (literal === shortest) return [literal];
    const literalNumber = Number(literal);
    const shortestNumber = Number(shortest);
    const sameValue =
      Number.isFinite(literalNumber) &&
      Number.isFinite(shortestNumber) &&
      literalNumber === shortestNumber;
    return sameValue ? [literal, shortest] : [];
  }

  /** The parsed amount as the provider's own `String(amount)` would render it. */
  private shortestAmount(parsed: unknown): string | null {
    if (typeof parsed === 'number' && Number.isFinite(parsed)) return String(parsed);
    if (typeof parsed === 'string' && parsed.trim()) return parsed.trim();
    return null;
  }

  // --------------------------------------------------------------------------
  // Player resolution + eligibility
  // --------------------------------------------------------------------------

  /**
   * The TANVION CUSTOMER behind a BigBang `username`.
   *
   * BigBang echoes the stable player id TANVION handed it as `user_token` at
   * launch (see casino-player-identity), which is recorded on the CasinoSession
   * row of that launch — exactly like CasinoSession maps BIG CASINO callbacks
   * back to a TANVION user. The NEWEST launch session wins; the account/session
   * status is re-read on every callback so a closed account cannot keep playing.
   * An unknown username resolves to null (never a guessed/auto-created player).
   */
  private async resolvePlayer(
    providerId: string,
    username: string,
  ): Promise<ResolvedPlayer | null> {
    const session = await this.prisma.casinoSession.findFirst({
      where: { providerId, providerPlayerId: username, demo: false },
      orderBy: { launchedAt: 'desc' },
      select: {
        id: true,
        userId: true,
        currency: true,
        environment: true,
        status: true,
        user: { select: { accountType: true, status: true } },
      },
    });
    if (!session?.user) return null;

    return {
      sessionId: session.id,
      userId: session.userId,
      currency: session.currency,
      environment: session.environment,
      sessionStatus: session.status,
      userStatus: session.user.status,
      accountType: session.user.accountType,
    };
  }

  /**
   * Refuses a player who may not play for real money:
   *   - a STAFF account is never a BigBang player (customer population only);
   *   - the account must be ACTIVE (PENDING/SUSPENDED/BANNED/LOCKED/CLOSED are
   *     all refused — the platform's established account rules);
   *   - the launch session must still be ACTIVE;
   *   - sandbox and production are never mixed (the session's environment must
   *     be the environment this callback was authenticated in).
   */
  private assertEligible(
    player: ResolvedPlayer,
    environment: string,
    providerId: string | null = null,
  ): void {
    const accountEligible =
      player.accountType === 'CUSTOMER' &&
      player.userStatus === 'ACTIVE' &&
      player.sessionStatus === 'ACTIVE';
    const environmentMatches =
      (player.environment ?? '').trim().toLowerCase() === environment;

    if (!accountEligible || !environmentMatches) {
      this.logCallback('rejected', providerId, 'player_ineligible', player.userId);
      bigbangRefuse(404, 'BIGBANG_UNKNOWN_PLAYER', 'Unknown or inactive player');
    }
  }

  // --------------------------------------------------------------------------
  // Idempotency — providerId + transactionId, backed by the unique index
  // --------------------------------------------------------------------------

  /** The provider transaction mapping for the idempotency/conflict checks. */
  private async findTransaction(providerId: string, transactionId: string) {
    return this.prisma.bigBangTransaction.findUnique({
      where: { providerId_transactionId: { providerId, transactionId } },
      select: { id: true, payloadHash: true, balanceAfter: true, currency: true },
    });
  }

  /**
   * Answers an already-applied `transaction_id` idempotently: the ORIGINAL
   * resulting balance is returned with `duplicate: true`, nothing is moved,
   * no second BigBangTransaction is created and the original row is untouched.
   *
   * The SAME transaction id carrying a DIFFERENT movement is a conflict (409):
   * acknowledging it would silently hide a provider defect or a tampered retry.
   */
  private duplicateResponse(
    existing: { payloadHash: string; balanceAfter: number; currency: string },
    movement: ValidatedMovement,
  ): BigBangBalanceChangeCallbackResponse {
    if (existing.payloadHash !== movement.payloadHash) {
      this.logCallback('rejected', movement.providerId, 'transaction_conflict', movement.player.userId);
      bigbangRefuse(
        409,
        'BIGBANG_TRANSACTION_CONFLICT',
        'transaction_id reused with a different payload',
      );
    }
    this.logCallback('duplicate', movement.providerId, null, movement.player.userId);
    return {
      status: 'ok',
      balance: minorUnitsToDecimal(existing.balanceAfter, existing.currency),
      duplicate: true,
    };
  }

  // --------------------------------------------------------------------------
  // Movement application (atomic, idempotent)
  // --------------------------------------------------------------------------

  /**
   * Applies one movement and its provider mapping in the SAME database
   * transaction.
   *
   * The launch-session row is locked first (the server-authoritative per-player
   * lock), then the mapping is re-read, then WalletService takes the canonical
   * Wallet row lock. A mapping failure therefore rolls back every
   * WalletTransaction/LedgerEntry write instead of leaving money applied
   * without its idempotent provider mapping — and two concurrent retries of the
   * same `transaction_id` can never both move money.
   *
   * `amount 0` is the provider's documented round close: the mapping row is
   * recorded (so the round stays traceable and the retry stays idempotent)
   * without any wallet movement.
   */
  private async applyMovement(
    movement: ValidatedMovement,
    currentBalance: number,
  ): Promise<AppliedMovement> {
    const { player, providerId, transactionId, amountMinor } = movement;
    const key = this.walletKey(providerId, transactionId);

    return this.prisma.$transaction(async (db) => {
      await db.$queryRaw`
        SELECT id
        FROM "CasinoSession"
        WHERE id = ${player.sessionId}
        FOR UPDATE
      `;

      // Re-read after the per-player lock: this closes the race where two
      // identical provider retries both observed no mapping before entering.
      const concurrent = await db.bigBangTransaction.findUnique({
        where: { providerId_transactionId: { providerId, transactionId } },
        select: { id: true, payloadHash: true, balanceAfter: true, currency: true },
      });
      if (concurrent) {
        if (concurrent.payloadHash !== movement.payloadHash) {
          bigbangRefuse(
            409,
            'BIGBANG_TRANSACTION_CONFLICT',
            'transaction_id reused with a different payload',
          );
        }
        return {
          response: {
            status: 'ok' as const,
            balance: minorUnitsToDecimal(concurrent.balanceAfter, concurrent.currency),
            duplicate: true,
          },
          entityId: null,
        };
      }

      let walletTransactionId: string | null = null;
      let balances: { before: number; after: number };

      if (amountMinor < 0) {
        // Debit: the canonical stake reservation (which refuses insufficient
        // funds and therefore rolls the whole movement back) is captured into a
        // completed BET_STAKE debit, exactly like a sportsbook stake.
        const reservation = await this.wallet.reserveStakeInTx(
          db,
          player.userId,
          Math.abs(amountMinor),
          player.currency,
          key,
        );
        await this.wallet.captureStakeInTx(db, player.userId, key);
        walletTransactionId = reservation.transactionId;
        balances = await this.ledgerBalances(db, walletTransactionId);
      } else if (amountMinor > 0) {
        // Credit: a win, or the refund of a cancelled bet. Both go through the
        // ONE wallet ledger; a refund is typed as such for reconciliation.
        const credit = await this.wallet.settleBetCredit(
          db,
          player.userId,
          amountMinor,
          player.currency,
          movement.roundType?.toLowerCase() === 'refund' ? 'BET_REFUND' : 'BET_PAYOUT',
          key,
          'BigBang casino movement credited to the TANVION wallet',
        );
        walletTransactionId = credit.transactionId;
        balances = await this.ledgerBalances(db, walletTransactionId);
      } else {
        // amount 0: a round close with no movement. Nothing is debited or
        // credited; the envelope is the wallet's current balance.
        balances = { before: currentBalance, after: currentBalance };
      }

      const row = await db.bigBangTransaction.create({
        data: {
          providerId,
          userId: player.userId,
          sessionId: player.sessionId,
          transactionId,
          amountMinor,
          amountWire: movement.amountWire,
          currency: player.currency,
          game: movement.game,
          gameCategory: movement.gameCategory,
          gameId: movement.gameId,
          providerExternalId: movement.providerExternalId,
          roundId: movement.roundId,
          roundType: movement.roundType,
          roundEnd: movement.roundEnd,
          payloadHash: movement.payloadHash,
          balanceBefore: balances.before,
          balanceAfter: balances.after,
          walletTransactionId,
          environment: player.environment,
          sandbox: movement.sandbox,
        },
      });

      this.logCallback(
        'applied',
        providerId,
        amountMinor === 0 ? 'round_close' : null,
        player.userId,
      );

      return {
        response: {
          status: 'ok' as const,
          balance: minorUnitsToDecimal(row.balanceAfter, row.currency),
        },
        entityId: row.id,
      };
    });
  }

  /**
   * The wallet balance immediately before/after the movement, taken from the
   * immutable LedgerEntry rows written WITH it (never recomputed from a later
   * read, which could include a concurrent movement).
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

  // --------------------------------------------------------------------------
  // Idempotency / logging helpers
  // --------------------------------------------------------------------------

  /**
   * Deterministic ledger idempotency key — the exactly-once guard at the WALLET
   * level (unique per user+key), independent of the provider mapping index.
   */
  private walletKey(providerId: string, transactionId: string): string {
    return `BIGBANG:${providerId}:${transactionId}`;
  }

  /**
   * SHA-256 over the PARSED movement fields (never the raw payload, never a
   * secret). Used to detect a `transaction_id` reused for a different movement
   * while still treating a re-stringified retry as the same transaction.
   */
  private payloadHash(fields: {
    username: string;
    amountMinor: number;
    currency: string;
    game: string;
    gameCategory: string;
    roundId: string | null;
    roundType: string | null;
    roundEnd: boolean | null;
    gameId: string | null;
    providerExternalId: string | null;
    sandbox: boolean;
  }): string {
    const canonical = JSON.stringify([
      fields.username,
      fields.amountMinor,
      fields.currency.toUpperCase(),
      fields.game,
      fields.gameCategory,
      fields.roundId,
      fields.roundType,
      fields.roundEnd,
      fields.gameId,
      fields.providerExternalId,
      fields.sandbox,
    ]);
    return createHash('sha256').update(canonical, 'utf8').digest('hex');
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

  /** `true`/`false`, `"true"`/`"false"` and `1`/`0` — anything else is unknown. */
  private readBoolean(value: unknown): boolean | null {
    if (typeof value === 'boolean') return value;
    if (value === 1 || value === '1' || value === 'true') return true;
    if (value === 0 || value === '0' || value === 'false') return false;
    return null;
  }

  /**
   * Structured callback log: outcome/provider/user/reason correlation only —
   * never an API key, never a signature, never the raw provider payload.
   */
  private logCallback(
    outcome: 'applied' | 'duplicate' | 'rejected',
    providerId: string | null,
    reason: string | null,
    userId: string | null,
  ): void {
    const line = `bigbang.callback outcome=${outcome} provider=${providerId ?? 'none'}${
      userId ? ` user=${userId}` : ''
    }${reason ? ` reason=${reason}` : ''}`;
    if (outcome === 'rejected') this.logger.warn(line);
    else this.logger.log(line);
  }

  /** Best-effort audit trail of an applied movement (never breaks the money path). */
  private async audit(
    entityId: string,
    movement: ValidatedMovement,
    response: BigBangBalanceChangeCallbackResponse,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId: null,
          actorType: 'SYSTEM',
          action: 'BIGBANG_CALLBACK_APPLIED',
          entityType: 'BigBangTransaction',
          entityId,
          newValue: {
            transactionId: movement.transactionId,
            roundId: movement.roundId,
            gameId: movement.gameId,
            currency: movement.currency,
            amountMinor: movement.amountMinor,
            balance: response.balance,
            sandbox: movement.sandbox,
          } as never,
        },
      });
    } catch {
      // Auditing is observability, not part of the money movement.
    }
  }
}
