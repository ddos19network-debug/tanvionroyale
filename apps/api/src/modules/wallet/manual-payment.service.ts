import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import {
  WalletService,
  type WalletTransactionRow,
} from './wallet.service';
import { walletError } from './wallet-errors';
import type {
  AdminListManualDepositsQueryDto,
  AdminReviewManualDepositDto,
  ListPaymentMethodsQueryDto,
  SubmitManualDepositDto,
} from './dto/manual-payment.dto';
import type {
  AdminListManualWithdrawalsQueryDto,
  AdminReviewManualWithdrawalDto,
  AdminCompleteManualWithdrawalDto,
} from './dto/admin-manual-withdrawals.dto';
import type { CreateManualWithdrawalDto } from './dto/create-manual-withdrawal.dto';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { NotificationService } from '../notifications/notification.service';
import {
  resolveWithdrawalDestinationKind,
  sanitiseWithdrawalDestinationForKind,
  withdrawalDestinationFieldsFor,
  type WithdrawalRequestView,
} from '@tanvion-royale/types';

const SUPPORTED_CURRENCIES = ['BDT', 'USD', 'EUR'] as const;

type Currency = (typeof SUPPORTED_CURRENCIES)[number];

const MAX_PROOF_DATA_URL_LENGTH = 2_500_000;

const ALLOWED_PAYMENT_METHOD_CODES = [
  'bkash',
  'nagad',
  'rocket',
  'bank',
  'card',
];

export interface PaymentMethodView {
  id: string;
  code: string;
  displayName: string;
  type: string;
  status: string;
  supportedCurrencies: string[];
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  gatewayConfigId: string | null;
  gatewayName: string | null;
  accountNumber: string | null;
  accountName: string | null;
  bankName: string | null;
  branch: string | null;
  routingNumber: string | null;
  instructions: string | null;
  minDeposit: number;
  maxDeposit: number;
  minWithdrawal: number;
  maxWithdrawal: number;
  requireTransactionId: boolean;
  requireProof: boolean;
  sortOrder: number;
}

export interface ManualDepositView {
  id: string;
  userId: string;
  methodId: string;
  method: PaymentMethodView | null;
  amount: number;
  currency: string;
  referenceId: string | null;
  proofPath: string | null;
  status: string;
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  transactionId: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

/** Admin view of one manual deposit including its owner (GET /admin/manual-deposits/:id). */
export interface AdminManualDepositDetailView {
  deposit: ManualDepositView;
  user: {
    id: string;
    username: string;
    email: string | null;
    phone: string | null;
  };
}

@Injectable()
export class ManualPaymentService {
  private readonly logger = new Logger(
    ManualPaymentService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly walletService: WalletService,
    // Global NotificationsModule provider; optional so unit tests that new
    // ManualPaymentService directly (2-arg) keep compiling. Every call site
    // uses optional chaining - notification failure NEVER fails a payment.
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  // --------------------------------------------------------------------------
  // PAYMENT METHODS
  // --------------------------------------------------------------------------

  async listPaymentMethods(
    query?: ListPaymentMethodsQueryDto,
  ): Promise<PaymentMethodView[]> {
    const currency = query?.currency
      ? this.normalizeCurrency(query.currency)
      : undefined;

    const purpose = query?.purpose ?? 'deposit';

    const rows =
      await this.prisma.paymentMethod.findMany({
        where: {
          status: 'ACTIVE',
          ...(currency
            ? {
                supportedCurrencies: {
                  has: currency,
                },
              }
            : {}),
          ...(purpose === 'deposit'
            ? {
                depositEnabled: true,
              }
            : {
                withdrawalEnabled: true,
              }),
        },
        include: {
          gatewayConfig: {
            select: {
              id: true,
              status: true,
            },
          },
        },
        orderBy: [
          {
            sortOrder: 'asc',
          },
          {
            displayName: 'asc',
          },
        ],
      });

    /*
     * GATEWAY methods are only usable while their linked gateway
     * configuration exists and is ACTIVE. Without this guard an admin
     * disabling a gateway would leave dead methods visible to users.
     * MANUAL methods never depend on gateway availability.
     */
    const usable = rows.filter(
      (row) =>
        row.type !== 'GATEWAY' ||
        (row.gatewayConfig?.status ===
          'ACTIVE'),
    );

    return usable.map((row) =>
      this.serializePaymentMethod(row),
    );
  }

  // --------------------------------------------------------------------------
  // ADMIN: LIST ALL PAYMENT METHODS (including INACTIVE / ARCHIVED)
  // --------------------------------------------------------------------------

  async listAllPaymentMethods(): Promise<
    PaymentMethodView[]
  > {
    const rows =
      await this.prisma.paymentMethod.findMany({
        orderBy: [
          {
            status: 'asc',
          },
          {
            sortOrder: 'asc',
          },
          {
            displayName: 'asc',
          },
        ],
      });

    return rows.map((row) =>
      this.serializePaymentMethod(row),
    );
  }

  // --------------------------------------------------------------------------
  // USER: SUBMIT MANUAL DEPOSIT
  // --------------------------------------------------------------------------

  async submitManualDeposit(
    auth: AuthenticatedUser,
    dto: SubmitManualDepositDto,
  ): Promise<ManualDepositView> {
    const currency = this.normalizeCurrency(
      dto.currency,
    );

    const amount = this.normalizeAmount(
      dto.amount,
    );

    const methodCode =
      dto.methodCode.trim().toLowerCase();

    if (!methodCode) {
      throw new BadRequestException(
        'Payment method is required',
      );
    }

    const paymentMethod =
      await this.prisma.paymentMethod.findFirst({
        where: {
          code: methodCode,
          status: 'ACTIVE',
          type: 'MANUAL',
          depositEnabled: true,
        },
      });

    if (!paymentMethod) {
      throw new NotFoundException(
        'Selected payment method is not available',
      );
    }

    if (
      !paymentMethod.supportedCurrencies.includes(
        currency,
      )
    ) {
      walletError(
        'UNSUPPORTED_CURRENCY',
        `This payment method does not support ${currency}`,
        400,
      );
    }

    this.assertPaymentMethodAmount(
      amount,
      paymentMethod.minDeposit,
      paymentMethod.maxDeposit,
    );

    const referenceId =
      dto.referenceId?.trim() || null;

    const proofDataUrl =
      dto.proofDataUrl?.trim() || null;

    /*
     * PROOF RULE — AT LEAST ONE, NEVER BOTH.
     *
     *   transaction ID only → accepted
     *   screenshot only     → accepted
     *   both                → accepted
     *   neither             → rejected
     *
     * Neither field is individually required, so the per-method
     * `requireTransactionId` / `requireProof` flags must never be allowed to
     * turn one of them into a hard requirement here. A method flagged
     * `requireProof` previously rejected a perfectly valid
     * transaction-ID-only deposit, which is what made the form behave as if
     * BOTH proofs were mandatory.
     *
     * This is the authoritative check — the frontend guard is convenience
     * only and is never trusted.
     */
    const hasTransactionId =
      typeof referenceId === 'string' &&
      referenceId.trim().length > 0;

    const hasScreenshot =
      typeof proofDataUrl === 'string' &&
      proofDataUrl.trim().length > 0;

    if (!hasTransactionId && !hasScreenshot) {
      throw new BadRequestException(
        'Provide a transaction ID or payment screenshot',
      );
    }

    if (
      referenceId &&
      referenceId.length < 4
    ) {
      throw new BadRequestException(
        'Transaction ID is too short',
      );
    }

    if (
      proofDataUrl &&
      proofDataUrl.length >
        MAX_PROOF_DATA_URL_LENGTH
    ) {
      throw new BadRequestException(
        'Payment screenshot is too large',
      );
    }

    if (
      proofDataUrl &&
      !this.isAllowedImageDataUrl(
        proofDataUrl,
      )
    ) {
      throw new BadRequestException(
        'Only JPG, PNG, WEBP or GIF screenshots are allowed',
      );
    }

    const idempotencyKey =
      dto.idempotencyKey?.trim() ||
      undefined;

    if (idempotencyKey) {
      const existing =
        await this.prisma.manualDepositRequest.findFirst(
          {
            where: {
              userId: auth.id,
              idempotencyKey,
            },
            include: {
              method: true,
            },
          },
        );

      if (existing) {
        return this.serializeDeposit(
          existing,
        );
      }
    }

    if (referenceId) {
      const duplicateReference =
        await this.prisma.manualDepositRequest.findFirst(
          {
            where: {
              userId: auth.id,
              referenceId,
              status: {
                in: [
                  'PENDING',
                  'UNDER_REVIEW',
                  'APPROVED',
                ],
              },
            },
            include: {
              method: true,
            },
          },
        );

      if (duplicateReference) {
        throw new BadRequestException(
          'This transaction ID has already been submitted',
        );
      }
    }

    const request =
      await this.prisma.manualDepositRequest.create(
        {
          data: {
            userId: auth.id,
            methodId: paymentMethod.id,
            amount,
            currency,
            referenceId,
            /*
             * The current schema has proofPath, not proofDataUrl.
             *
             * We store the supplied image data here so the current schema
             * can work without requiring a new upload-storage service.
             *
             * For production object storage, this field can later contain
             * an authorized private storage path instead.
             */
            proofPath: proofDataUrl,
            status: 'PENDING',
            ...(idempotencyKey
              ? {
                  idempotencyKey,
                }
              : {}),
          },
          include: {
            method: true,
          },
        },
      );

    await this.writeAudit(
      'MANUAL_DEPOSIT_SUBMITTED',
      auth.id,
      request.id,
      {
        methodCode,
        currency,
        amount,
        hasReferenceId: Boolean(
          referenceId,
        ),
        hasProof: Boolean(
          proofDataUrl,
        ),
      },
    );

    // Operational signal: admins get a NEW_DEPOSIT_REQUEST in their own
    // notification center (DB row only; the push fan-out is best-effort and
    // can never fail this submission).
    await this.notifications?.notifyNewDepositRequest({
      amount,
      currency,
      requestId: request.id,
      username: auth.id,
    });

    return this.serializeDeposit(
      request,
    );
  }

  // --------------------------------------------------------------------------
  // USER: SUBMIT MANUAL WITHDRAWAL (reserve -> PENDING)
  // --------------------------------------------------------------------------

  async submitManualWithdrawal(auth: AuthenticatedUser, dto: CreateManualWithdrawalDto): Promise<any> {
    const currency = this.normalizeCurrency(dto.currency);
    const amount = this.normalizeAmount(dto.amount);
    const methodCode = dto.methodCode.trim().toLowerCase();
    if (!methodCode) throw new BadRequestException('Payment method is required');
    const method = await this.prisma.paymentMethod.findFirst({
      where: { code: methodCode, status: 'ACTIVE', withdrawalEnabled: true },
    });
    if (!method) throw new NotFoundException('Selected payment method is not available');
    if (method.type !== 'MANUAL') throw new BadRequestException('Selected method does not support manual withdrawal');
    // Card methods are gateway-ready only: manual card payouts would require
    // collecting CVV/PIN/OTP, which is never accepted or stored.
    if (resolveWithdrawalDestinationKind(method.code) === 'CARD') {
      throw new BadRequestException('Card withdrawals are processed through the configured payment gateway');
    }
    if (!method.supportedCurrencies.includes(currency)) {
      walletError('UNSUPPORTED_CURRENCY', `This payment method does not support ${currency}`, 400);
    }
    if (method.minWithdrawal > 0 && amount < method.minWithdrawal) {
      throw new BadRequestException('Amount is below the method minimum');
    }
    if (method.maxWithdrawal > 0 && amount > method.maxWithdrawal) {
      throw new BadRequestException('Amount exceeds the method maximum');
    }
    const idempotencyKey = dto.idempotencyKey.trim();
    // Category-driven destination validation: the required/allowed fields
    // come from the admin-configured payment method, so UI and API agree.
    const fields = withdrawalDestinationFieldsFor(method.code, {
      methodRoutingNumber:
        typeof method.routingNumber === 'string'
          ? method.routingNumber
          : null,
    });
    const destination = sanitiseWithdrawalDestinationForKind(
      fields.kind,
      {
        accountNumber: dto.accountNumber,
        accountName: dto.accountName,
        bankName: dto.bankName,
        branch: dto.branch,
        routingNumber: dto.routingNumber,
      },
    );
    if (!destination.accountNumber) {
      throw new BadRequestException(
        fields.kind === 'BANK'
          ? 'Account number is required.'
          : 'Mobile/account number is required.',
      );
    }
    if (!destination.accountName) {
      throw new BadRequestException('Account holder name is required.');
    }
    if (fields.requireBankName && !destination.bankName) {
      throw new BadRequestException('Bank name is required.');
    }
    if (fields.requireBranch && !destination.branch) {
      throw new BadRequestException('Branch is required.');
    }
    if (fields.requireRoutingNumber && !destination.routingNumber) {
      throw new BadRequestException('Routing number is required.');
    }
    const dup = await this.prisma.withdrawalRequest.findFirst({ where: { userId: auth.id, idempotencyKey }, include: { method: true } });
    if (dup) {
      const wallet = await this.walletService.getOrCreateWalletForUser(auth.id, currency);
      return { withdrawal: this.serializeWithdrawal(dup), wallet };
    }
    const walletRow = await this.walletService.getOrCreateWalletForUser(auth.id, currency);
    if (walletRow.availableBalance < amount) walletError('INSUFFICIENT_FUNDS', 'Insufficient balance', 400);
    const reserved = await this.walletService.reserveManualWithdrawal(walletRow, { amount, currency, reference: `manual-wd:${idempotencyKey}` });
    if (!reserved.transactionId) {
      walletError('WITHDRAWAL_RESERVATION_CONFLICT', 'Could not reserve funds for this withdrawal, please retry', 409);
    }
    let created: Awaited<ReturnType<typeof this.createWithdrawalRow>>;
    try {
      created = await this.createWithdrawalRow(auth, method.id, destination, amount, currency, reserved.transactionId, idempotencyKey);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        /*
         * Concurrent duplicate submit with the same idempotency key: the
         * first request won the unique constraint (and the single fund
         * reservation - the reserve call above dedupes on the ledger key).
         * Return the winner instead of a 500.
         */
        const winner = await this.prisma.withdrawalRequest.findFirst({
          where: { userId: auth.id, idempotencyKey },
          include: { method: true },
        });
        if (winner) {
          const wallet = await this.walletService.getOrCreateWalletForUser(auth.id, currency);
          return { withdrawal: this.serializeWithdrawal(winner), wallet };
        }
      }
      throw error;
    }
    await this.writeAudit('MANUAL_WITHDRAWAL_SUBMITTED', auth.id, created.id, { amount, currency });
    // Operational signal: admins get a NEW_WITHDRAWAL_REQUEST in their own
    // notification center (DB row only; never fails this submission).
    await this.notifications?.notifyNewWithdrawalRequest({
      amount,
      currency,
      requestId: created.id,
      username: auth.id,
    });
    const fresh = await this.walletService.getOrCreateWalletForUser(auth.id, currency);
    return { withdrawal: this.serializeWithdrawal(created), wallet: fresh };
  }

  private createWithdrawalRow(
    auth: AuthenticatedUser,
    methodId: string,
    destination: {
      accountNumber: string | null;
      accountName: string | null;
      bankName: string | null;
      branch: string | null;
      routingNumber: string | null;
    },
    amount: number,
    currency: string,
    walletTransactionId: string,
    idempotencyKey: string,
  ) {
    // Already validated + sanitised by category in submitManualWithdrawal:
    // non-bank requests carry NULL bank columns, so stale hidden fields can
    // never leak into storage.
    const safe = destination;
    return this.prisma.withdrawalRequest.create({
      data: {
        userId: auth.id,
        methodId,
        amount,
        currency,
        destinationAccount: safe.accountNumber,
        destinationName: safe.accountName,
        bankName: safe.bankName,
        branch: safe.branch,
        routingNumber: safe.routingNumber,
        status: 'PENDING',
        walletTransactionId,
        idempotencyKey,
      },
      include: { method: true },
    });
  }

  async listMyWithdrawals(auth: AuthenticatedUser): Promise<any[]> {
    const rows = await this.prisma.withdrawalRequest.findMany({
      where: { userId: auth.id }, orderBy: { createdAt: 'desc' }, take: 100, include: { method: true },
    });
    return rows.map((row) => this.serializeWithdrawal(row));
  }

  async listAdminWithdrawals(query?: AdminListManualWithdrawalsQueryDto): Promise<any[]> {
    const rows = await this.prisma.withdrawalRequest.findMany({
      // Customer domain only — staff rows are excluded from the withdrawal
      // queue at the query level (they have no customer wallet to withdraw).
      where: {
        user: { accountType: 'CUSTOMER' },
        ...(query?.status ? { status: query.status as never } : {}),
      },
      orderBy: { createdAt: 'desc' }, take: 100, include: { method: true },
    });
    return rows.map((row) => this.serializeWithdrawal(row));
  }

  async getAdminWithdrawal(id: string): Promise<any> {
    const row = await this.prisma.withdrawalRequest.findUnique({ where: { id }, include: { method: true } });
    if (!row) throw new NotFoundException('Withdrawal request not found');
    return this.serializeWithdrawal(row);
  }

  async reviewManualWithdrawal(auth: AuthenticatedUser, id: string, dto: AdminReviewManualWithdrawalDto): Promise<any> {
    const existing = await this.prisma.withdrawalRequest.findUnique({ where: { id }, include: { method: true } });
    if (!existing) throw new NotFoundException('Withdrawal request not found');

    // Idempotent: re-reviewing a settled request returns the current row.
    if (existing.status !== 'PENDING') return this.serializeWithdrawal(existing);

    if (dto.action === 'REJECT') {
      /*
       * Atomic claim: only ONE reviewer can transition PENDING -> REJECTED.
       * The loser of the race gets the current row back (idempotent), so
       * reserved funds can never be released twice.
       */
      const claimed = await this.prisma.withdrawalRequest.updateMany({
        where: { id, status: 'PENDING' },
        data: {
          status: 'REJECTED',
          rejectionReason: dto.reason?.trim() || 'Rejected',
          reviewedBy: auth.id,
          reviewedAt: new Date(),
        },
      });
      if (claimed.count !== 1) {
        const current = await this.prisma.withdrawalRequest.findUnique({ where: { id }, include: { method: true } });
        if (!current) throw new NotFoundException('Withdrawal request not found');
        return this.serializeWithdrawal(current);
      }
      try {
        const wallet = await this.walletService.getOrCreateWalletForUser(existing.userId, existing.currency);
        await this.walletService.releaseManualWithdrawal(wallet, existing.walletTransactionId, existing.amount, `manual-wd:${existing.id}`);
      } catch (error) {
        // Compensate: give the request back so the rejection can be retried.
        await this.prisma.withdrawalRequest.updateMany({
          where: { id, status: 'REJECTED' },
          data: { status: 'PENDING', rejectionReason: null, reviewedBy: null, reviewedAt: null },
        });
        throw error;
      }
      await this.writeAudit('MANUAL_WITHDRAWAL_REJECTED', auth.id, id, { reason: dto.reason ?? null });
      const updated = await this.prisma.withdrawalRequest.findUnique({ where: { id }, include: { method: true } });
      if (!updated) throw new NotFoundException('Withdrawal request not found');

      // Real business event (post-commit only): the REJECTED transition +
      // fund release both succeeded. Best-effort: never throws.
      await this.notifications?.notifyWithdrawalRejected({
        userId: existing.userId,
        amount: Number(existing.amount ?? 0),
        currency: String(existing.currency),
        requestId: id,
        reason: dto.reason ?? null,
      });
      return this.serializeWithdrawal(updated);
    }

    const claimed = await this.prisma.withdrawalRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'APPROVED', reviewedBy: auth.id, reviewedAt: new Date(), rejectionReason: null },
    });
    if (claimed.count !== 1) {
      const current = await this.prisma.withdrawalRequest.findUnique({ where: { id }, include: { method: true } });
      if (!current) throw new NotFoundException('Withdrawal request not found');
      return this.serializeWithdrawal(current);
    }
    // Approved funds stay RESERVED; money only leaves the wallet on completion.
    await this.writeAudit('MANUAL_WITHDRAWAL_APPROVED', auth.id, id, { amount: existing.amount });
    const updated = await this.prisma.withdrawalRequest.findUnique({ where: { id }, include: { method: true } });
    if (!updated) throw new NotFoundException('Withdrawal request not found');

    // Real business event (post-commit only): APPROVED claimed successfully.
    // Best-effort: never throws, never rolls back the approval.
    await this.notifications?.notifyWithdrawalApproved({
      userId: existing.userId,
      amount: Number(existing.amount ?? 0),
      currency: String(existing.currency),
      requestId: id,
    });
    return this.serializeWithdrawal(updated);
  }

  async completeManualWithdrawal(auth: AuthenticatedUser, id: string, dto: AdminCompleteManualWithdrawalDto): Promise<any> {
    const existing = await this.prisma.withdrawalRequest.findUnique({ where: { id }, include: { method: true } });
    if (!existing) throw new NotFoundException('Withdrawal request not found');
    if (existing.status === 'COMPLETED') return this.serializeWithdrawal(existing);
    if (existing.status !== 'APPROVED') throw new BadRequestException('Only APPROVED withdrawals can be completed');
    if (!existing.walletTransactionId) {
      throw new ConflictException('Withdrawal reservation is missing; funds cannot be settled');
    }
    /*
     * Atomic claim APPROVED -> COMPLETED. Exactly one caller settles the
     * reserved funds; concurrent duplicate calls return the current row.
     */
    const claimed = await this.prisma.withdrawalRequest.updateMany({
      where: { id, status: 'APPROVED' },
      data: {
        status: 'COMPLETED',
        providerReference: dto.providerReference?.trim() || null,
        reviewedBy: auth.id,
        reviewedAt: new Date(),
      },
    });
    if (claimed.count !== 1) {
      const current = await this.prisma.withdrawalRequest.findUnique({ where: { id }, include: { method: true } });
      if (!current) throw new NotFoundException('Withdrawal request not found');
      return this.serializeWithdrawal(current);
    }
    try {
      const wallet = await this.walletService.getOrCreateWalletForUser(existing.userId, existing.currency);
      await this.walletService.completeManualWithdrawal(wallet, existing.walletTransactionId, existing.amount, `manual-wd:${existing.id}`);
    } catch (error) {
      // Compensate: restore APPROVED so completion can be retried safely.
      await this.prisma.withdrawalRequest.updateMany({
        where: { id, status: 'COMPLETED' },
        data: { status: 'APPROVED', providerReference: null },
      });
      throw error;
    }
    await this.writeAudit('MANUAL_WITHDRAWAL_COMPLETED', auth.id, id, { ref: dto.providerReference ?? null });
    const updated = await this.prisma.withdrawalRequest.findUnique({ where: { id }, include: { method: true } });
    if (!updated) throw new NotFoundException('Withdrawal request not found');

    // Real business event (post-commit only): settlement succeeded, funds left
    // the wallet. Best-effort notification: never throws, never rolls back.
    await this.notifications?.notifyWithdrawalCompleted({
      userId: existing.userId,
      amount: Number(existing.amount ?? 0),
      currency: String(existing.currency),
      requestId: id,
    });
    return this.serializeWithdrawal(updated);
  }

  private serializeWithdrawal(row: any): WithdrawalRequestView {
    return {
      id: row.id, userId: row.userId, methodId: row.methodId,
      methodCode: row.method?.code ?? '', methodName: row.method?.displayName ?? '', methodType: row.method?.type ?? 'MANUAL',
      amount: Number(row.amount ?? 0), currency: String(row.currency).toUpperCase(),
      destinationAccount: row.destinationAccount ?? null, destinationName: row.destinationName ?? null,
      bankName: row.bankName ?? null, branch: row.branch ?? null, routingNumber: row.routingNumber ?? null,
      status: row.status, rejectionReason: row.rejectionReason ?? null,
      reviewedBy: row.reviewedBy ?? null, reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
      walletTransactionId: row.walletTransactionId ?? null, providerReference: row.providerReference ?? null,
      idempotencyKey: row.idempotencyKey, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
    };
  }

  async listMyDeposits(
    auth: AuthenticatedUser,
  ): Promise<ManualDepositView[]> {
    const rows =
      await this.prisma.manualDepositRequest.findMany(
        {
          where: {
            userId: auth.id,
          },
          include: {
            method: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 100,
        },
      );

    return rows.map((row) =>
      this.serializeDeposit(row),
    );
  }

  // --------------------------------------------------------------------------
  // ADMIN: LIST DEPOSITS
  // --------------------------------------------------------------------------

  async listAdminDeposits(
    query?: AdminListManualDepositsQueryDto,
  ): Promise<ManualDepositView[]> {
    const status = query?.status;

    const rows =
      await this.prisma.manualDepositRequest.findMany(
        {
          // Customer domain only — staff rows are excluded from the deposit
          // queue at the query level (staff have no customer deposit flow).
          where: {
            user: { accountType: 'CUSTOMER' },
            ...(status
              ? {
                  status,
                }
              : {}),
          },
          include: {
            method: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: Math.min(
            Number(query?.limit ?? 100),
            200,
          ),
        },
      );

    return rows.map((row) =>
      this.serializeDeposit(row),
    );
  }

  // --------------------------------------------------------------------------
  // ADMIN: VIEW ONE DEPOSIT (owner + method details)
  // --------------------------------------------------------------------------

  async getAdminDeposit(
    depositId: string,
  ): Promise<AdminManualDepositDetailView> {
    const request =
      await this.prisma.manualDepositRequest.findUnique(
        {
          where: {
            id: depositId,
          },
          include: {
            method: true,
            user: {
              select: {
                id: true,
                username: true,
                email: true,
                phone: true,
              },
            },
          },
        },
      );

    if (!request) {
      throw new NotFoundException(
        'Manual deposit request not found',
      );
    }

    return {
      deposit: this.serializeDeposit(request),
      user: request.user,
    };
  }

  // --------------------------------------------------------------------------
  // ADMIN: APPROVE / REJECT
  // --------------------------------------------------------------------------

  async reviewManualDeposit(
    auth: AuthenticatedUser,
    depositId: string,
    dto: AdminReviewManualDepositDto,
  ): Promise<ManualDepositView> {
    const action =
      String(dto.action).toUpperCase();

    const request =
      await this.prisma.manualDepositRequest.findUnique(
        {
          where: {
            id: depositId,
          },
          include: {
            method: true,
          },
        },
      );

    if (!request) {
      throw new NotFoundException(
        'Manual deposit request not found',
      );
    }

    /*
     * APPROVED requests must never be credited again.
     */
    if (request.status === 'APPROVED') {
      return this.serializeDeposit(
        request,
      );
    }

    if (
      request.status === 'REJECTED' ||
      request.status === 'CANCELLED'
    ) {
      throw new BadRequestException(
        `This deposit is already ${request.status.toLowerCase()}`,
      );
    }

    if (
      action !== 'APPROVE' &&
      action !== 'REJECT'
    ) {
      throw new BadRequestException(
        'Action must be APPROVE or REJECT',
      );
    }

    if (action === 'REJECT') {
      const reason =
        dto.reason?.trim() ||
        'Deposit rejected by administrator';

      const updated =
        await this.prisma.manualDepositRequest.update(
          {
            where: {
              id: depositId,
            },
            data: {
              status: 'REJECTED',
              rejectionReason: reason,
              reviewedBy: auth.id,
              reviewedAt: new Date(),
            },
            include: {
              method: true,
            },
          },
        );

      await this.writeAudit(
        'MANUAL_DEPOSIT_REJECTED',
        auth.id,
        depositId,
        {
          reason,
        },
      );

      // Real business event (post-commit only): the REJECTED update above
      // already succeeded, so the user notification is now safe to create.
      await this.notifications?.notifyDepositRejected({
        userId: request.userId,
        amount: Number(request.amount ?? 0),
        currency: String(request.currency),
        requestId: depositId,
        reason,
      });

      return this.serializeDeposit(
        updated,
      );
    }

    /*
     * APPROVAL
     *
     * The balance credit uses WalletService's idempotent
     * `creditManualDeposit()` method.
     *
     * If the same request is approved twice, the wallet transaction
     * idempotency key prevents a second credit.
     */
    const credit =
      await this.walletService.creditManualDeposit(
        request.userId,
        request.amount,
        request.currency,
        request.id,
        request.referenceId ??
          undefined,
      );

    const updated =
      await this.prisma.manualDepositRequest.update(
        {
          where: {
            id: depositId,
          },
          data: {
            status: 'APPROVED',
            reviewedBy: auth.id,
            reviewedAt: new Date(),
            transactionId:
              credit.transactionId,
            rejectionReason: null,
          },
          include: {
            method: true,
          },
        },
      );

    await this.writeAudit(
      'MANUAL_DEPOSIT_APPROVED',
      auth.id,
      depositId,
      {
        amount: request.amount,
        currency: request.currency,
        walletTransactionId:
          credit.transactionId,
        duplicateCredit:
          credit.duplicate,
      },
    );

    // Real business event (post-commit only): credit + APPROVED update both
    // succeeded, so the user notification is now safe to create. Best-effort:
    // never throws, never rolls back the credit.
    await this.notifications?.notifyDepositApproved({
      userId: request.userId,
      amount: Number(request.amount ?? 0),
      currency: String(request.currency),
      requestId: depositId,
    });

    return this.serializeDeposit(
      updated,
    );
  }

  // --------------------------------------------------------------------------
  // ADMIN: CREATE PAYMENT METHOD
  // --------------------------------------------------------------------------

  async createPaymentMethod(
    auth: AuthenticatedUser,
    input: {
      code: string;
      displayName: string;
      supportedCurrencies: string[];
      type?: 'MANUAL' | 'GATEWAY';
      gatewayConfigId?: string;
      accountNumber?: string;
      accountName?: string;
      bankName?: string;
      branch?: string;
      routingNumber?: string;
      instructions?: string;
      depositEnabled?: boolean;
      withdrawalEnabled?: boolean;
      minDeposit?: number;
      maxDeposit?: number;
      minWithdrawal?: number;
      maxWithdrawal?: number;
      requireTransactionId?: boolean;
      requireProof?: boolean;
      sortOrder?: number;
    },
  ): Promise<PaymentMethodView> {
    const code =
      input.code.trim().toLowerCase();

    const displayName =
      input.displayName.trim();

    if (!code) {
      throw new BadRequestException(
        'Payment method code is required',
      );
    }

    if (!displayName) {
      throw new BadRequestException(
        'Payment method name is required',
      );
    }

    if (
      !/^[a-z0-9_-]{2,40}$/.test(
        code,
      )
    ) {
      throw new BadRequestException(
        'Invalid payment method code',
      );
    }

    const supportedCurrencies =
      this.normalizeCurrencyList(
        input.supportedCurrencies,
      );

    const existing =
      await this.prisma.paymentMethod.findUnique(
        {
          where: {
            code,
          },
        },
      );

    if (existing) {
      throw new BadRequestException(
        'Payment method code already exists',
      );
    }

    const methodType = input.type ?? 'MANUAL';
    const gatewayConfigId = await this.resolveGatewayConfigId(input.gatewayConfigId, methodType);

    const created =
      await this.prisma.paymentMethod.create({
        data: {
          code,
          displayName,
          type: methodType,
          status: 'ACTIVE',
          supportedCurrencies,
          depositEnabled:
            input.depositEnabled ??
            true,
          withdrawalEnabled:
            input.withdrawalEnabled ??
            false,
          accountNumber:
            this.cleanOptional(
              input.accountNumber,
            ),
          accountName:
            this.cleanOptional(
              input.accountName,
            ),
          bankName:
            this.cleanOptional(
              input.bankName,
            ),
          branch:
            this.cleanOptional(
              input.branch,
            ),
          routingNumber:
            this.cleanOptional(
              input.routingNumber,
            ),
          instructions:
            this.cleanOptional(
              input.instructions,
            ),
          minDeposit:
            this.normalizeOptionalInteger(
              input.minDeposit,
            ),
          maxDeposit:
            this.normalizeOptionalInteger(
              input.maxDeposit,
            ),
          minWithdrawal:
            this.normalizeOptionalInteger(
              input.minWithdrawal,
            ),
          maxWithdrawal:
            this.normalizeOptionalInteger(
              input.maxWithdrawal,
            ),
          requireTransactionId:
            input.requireTransactionId ??
            true,
          requireProof:
            input.requireProof ??
            false,
          sortOrder:
            this.normalizeOptionalInteger(
              input.sortOrder,
            ) ?? 0,
          ...(gatewayConfigId !== undefined ? { gatewayConfigId } : {}),
        },
        include: { gatewayConfig: { select: { id: true, name: true } } },
      });

    await this.writeAudit(
      'PAYMENT_METHOD_CREATED',
      auth.id,
      created.id,
      {
        code,
        displayName,
        supportedCurrencies,
      },
    );

    return this.serializePaymentMethod(
      created,
    );
  }

  // --------------------------------------------------------------------------
  // ADMIN: UPDATE PAYMENT METHOD
  // --------------------------------------------------------------------------

  async updatePaymentMethod(
    auth: AuthenticatedUser,
    id: string,
    input: Partial<{
      displayName: string;
      status:
        | 'ACTIVE'
        | 'INACTIVE'
        | 'ARCHIVED';
      supportedCurrencies: string[];
      accountNumber: string;
      accountName: string;
      bankName: string;
      branch: string;
      routingNumber: string;
      instructions: string;
      depositEnabled: boolean;
      withdrawalEnabled: boolean;
      minDeposit: number;
      maxDeposit: number;
      minWithdrawal: number;
      maxWithdrawal: number;
      requireTransactionId: boolean;
      requireProof: boolean;
      sortOrder: number;
      type?: 'MANUAL' | 'GATEWAY';
      active?: boolean;
      gatewayConfigId?: string | null;
    }>,
  ): Promise<PaymentMethodView> {
    const existing =
      await this.prisma.paymentMethod.findUnique(
        {
          where: {
            id,
          },
        },
      );

    if (!existing) {
      throw new NotFoundException(
        'Payment method not found',
      );
    }

    const data: Record<
      string,
      unknown
    > = {};

    if (
      input.displayName !==
      undefined
    ) {
      const value =
        input.displayName.trim();

      if (!value) {
        throw new BadRequestException(
          'Payment method name cannot be empty',
        );
      }

      data.displayName = value;
    }

    if (
      input.status !==
      undefined
    ) {
      data.status =
        input.status;
    }

    if (
      (input as { active?: unknown }).active !==
      undefined
    ) {
      data.status = (input as { active?: boolean }).active ? 'ACTIVE' : 'INACTIVE';
    }

    if (
      (input as { type?: unknown }).type !==
      undefined
    ) {
      const nextType = (input as { type?: 'MANUAL' | 'GATEWAY' }).type as 'MANUAL' | 'GATEWAY';
      if (nextType !== 'MANUAL' && nextType !== 'GATEWAY') {
        throw new BadRequestException('Invalid payment method type');
      }
      data.type = nextType;
      const gatewayId = await this.resolveGatewayConfigId(
        (input as { gatewayConfigId?: string | null }).gatewayConfigId,
        nextType,
        (existing as { gatewayConfigId?: string | null }).gatewayConfigId ?? null,
      );
      if (gatewayId !== undefined) data.gatewayConfigId = gatewayId;
    } else if (
      (input as { gatewayConfigId?: unknown }).gatewayConfigId !==
      undefined
    ) {
      const gatewayId = await this.resolveGatewayConfigId(
        (input as { gatewayConfigId?: string | null }).gatewayConfigId,
        (existing as { type?: string }).type === 'GATEWAY' ? 'GATEWAY' : 'MANUAL',
        (existing as { gatewayConfigId?: string | null }).gatewayConfigId ?? null,
      );
      if (gatewayId !== undefined) data.gatewayConfigId = gatewayId;
    }

    if (
      input.supportedCurrencies !==
      undefined
    ) {
      data.supportedCurrencies =
        this.normalizeCurrencyList(
          input.supportedCurrencies,
        );
    }

    const stringFields = [
      'accountNumber',
      'accountName',
      'bankName',
      'branch',
      'routingNumber',
      'instructions',
    ] as const;

    for (const field of stringFields) {
      if (
        input[field] !==
        undefined
      ) {
        data[field] =
          this.cleanOptional(
            input[field],
          );
      }
    }

    const booleanFields = [
      'depositEnabled',
      'withdrawalEnabled',
      'requireTransactionId',
      'requireProof',
    ] as const;

    for (const field of booleanFields) {
      if (
        input[field] !==
        undefined
      ) {
        data[field] =
          input[field];
      }
    }

    const integerFields = [
      'minDeposit',
      'maxDeposit',
      'minWithdrawal',
      'maxWithdrawal',
      'sortOrder',
    ] as const;

    for (const field of integerFields) {
      if (
        input[field] !==
        undefined
      ) {
        data[field] =
          this.normalizeOptionalInteger(
            input[field],
          );
      }
    }

    const updated =
      await this.prisma.paymentMethod.update(
        {
          where: {
            id,
          },
          data: data as never,
          include: { gatewayConfig: { select: { id: true, name: true } } },
        },
      );

    await this.writeAudit(
      'PAYMENT_METHOD_UPDATED',
      auth.id,
      id,
      {
        changedFields:
          Object.keys(data),
      },
    );

    return this.serializePaymentMethod(
      updated,
    );
  }

  // --------------------------------------------------------------------------
  // ADMIN: ARCHIVE PAYMENT METHOD
  // --------------------------------------------------------------------------

  async archivePaymentMethod(
    auth: AuthenticatedUser,
    id: string,
  ): Promise<PaymentMethodView> {
    const existing =
      await this.prisma.paymentMethod.findUnique(
        {
          where: {
            id,
          },
        },
      );

    if (!existing) {
      throw new NotFoundException(
        'Payment method not found',
      );
    }

    const updated =
      await this.prisma.paymentMethod.update(
        {
          where: {
            id,
          },
          data: {
            status: 'ARCHIVED',
            depositEnabled: false,
            withdrawalEnabled: false,
          },
        },
      );

    await this.writeAudit(
      'PAYMENT_METHOD_ARCHIVED',
      auth.id,
      id,
      {
        code: existing.code,
      },
    );

    return this.serializePaymentMethod(
      updated,
    );
  }

  // --------------------------------------------------------------------------
  // SERIALIZERS
  // --------------------------------------------------------------------------

  private serializePaymentMethod(
    row: any,
  ): PaymentMethodView {
    return {
      id: row.id,
      code: row.code,
      displayName:
        row.displayName,
      type: row.type,
      status: row.status,
      supportedCurrencies:
        Array.isArray(
          row.supportedCurrencies,
        )
          ? row.supportedCurrencies
          : [],
      depositEnabled:
        Boolean(
          row.depositEnabled,
        ),
      withdrawalEnabled:
        Boolean(
          row.withdrawalEnabled,
        ),
      gatewayConfigId:
        (row.gatewayConfigId as string | null | undefined) ?? null,
      gatewayName:
        (row.gatewayConfig as { name?: unknown } | null | undefined)?.name != null
          ? String((row.gatewayConfig as { name?: unknown }).name)
          : null,
      accountNumber:
        row.accountNumber ??
        null,
      accountName:
        row.accountName ??
        null,
      bankName:
        row.bankName ?? null,
      branch:
        row.branch ?? null,
      routingNumber:
        row.routingNumber ??
        null,
      instructions:
        row.instructions ??
        null,
      minDeposit:
        Number(
          row.minDeposit ?? 0,
        ),
      maxDeposit:
        Number(
          row.maxDeposit ?? 0,
        ),
      minWithdrawal:
        Number(
          row.minWithdrawal ?? 0,
        ),
      maxWithdrawal:
        Number(
          row.maxWithdrawal ?? 0,
        ),
      requireTransactionId:
        Boolean(
          row.requireTransactionId,
        ),
      requireProof:
        Boolean(
          row.requireProof,
        ),
      sortOrder:
        Number(
          row.sortOrder ?? 0,
        ),
    };
  }

  private serializeDeposit(
    row: any,
  ): ManualDepositView {
    return {
      id: row.id,
      userId: row.userId,
      methodId: row.methodId,
      method: row.method
        ? this.serializePaymentMethod(
            row.method,
          )
        : null,
      amount:
        Number(row.amount ?? 0),
      currency:
        String(
          row.currency,
        ).toUpperCase(),
      referenceId:
        row.referenceId ??
        null,
      proofPath:
        row.proofPath ?? null,
      status:
        row.status,
      rejectionReason:
        row.rejectionReason ??
        null,
      reviewedBy:
        row.reviewedBy ??
        null,
      reviewedAt:
        row.reviewedAt
          ? row.reviewedAt.toISOString()
          : null,
      transactionId:
        row.transactionId ??
        null,
      idempotencyKey:
        row.idempotencyKey,
      createdAt:
        row.createdAt.toISOString(),
      updatedAt:
        row.updatedAt.toISOString(),
    };
  }

  // --------------------------------------------------------------------------
  // VALIDATION HELPERS
  // --------------------------------------------------------------------------

  private normalizeCurrency(
    currency: string,
  ): Currency {
    const value =
      String(currency ?? '')
        .trim()
        .toUpperCase();

    if (
      !SUPPORTED_CURRENCIES.includes(
        value as Currency,
      )
    ) {
      walletError(
        'UNSUPPORTED_CURRENCY',
        `Currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}`,
        400,
      );
    }

    return value as Currency;
  }

  private normalizeCurrencyList(
    currencies: string[],
  ): Currency[] {
    if (
      !Array.isArray(currencies) ||
      currencies.length === 0
    ) {
      throw new BadRequestException(
        'At least one supported currency is required',
      );
    }

    const unique =
      Array.from(
        new Set(
          currencies.map((currency) =>
            this.normalizeCurrency(
              currency,
            ),
          ),
        ),
      );

    return unique;
  }

  private normalizeAmount(
    amount: number,
  ): number {
    const value =
      Number(amount);

    if (
      !Number.isInteger(value) ||
      value <= 0
    ) {
      throw new BadRequestException(
        'Amount must be a positive integer in minor units',
      );
    }

    if (
      value >
      100_000_000
    ) {
      throw new BadRequestException(
        'Amount exceeds the maximum allowed value',
      );
    }

    return value;
  }

  private assertPaymentMethodAmount(
    amount: number,
    minDeposit: number,
    maxDeposit: number,
  ): void {
    if (
      minDeposit > 0 &&
      amount < minDeposit
    ) {
      throw new BadRequestException(
        `Minimum deposit is ${minDeposit} minor units`,
      );
    }

    if (
      maxDeposit > 0 &&
      amount > maxDeposit
    ) {
      throw new BadRequestException(
        `Maximum deposit is ${maxDeposit} minor units`,
      );
    }
  }

  private normalizeOptionalInteger(
    value:
      | number
      | undefined,
  ): number | undefined {
    if (
      value === undefined ||
      value === null
    ) {
      return undefined;
    }

    const number =
      Number(value);

    if (
      !Number.isInteger(
        number,
      ) ||
      number < 0
    ) {
      throw new BadRequestException(
        'Value must be a non-negative integer',
      );
    }

    return number;
  }

  private async resolveGatewayConfigId(
    value: string | null | undefined,
    methodType: 'MANUAL' | 'GATEWAY',
    current?: string | null,
  ): Promise<string | null | undefined> {
    if (value === undefined) {
      if (methodType === 'GATEWAY') return current ?? null;
      return undefined;
    }
    const trimmed = (value ?? '').trim();
    if (!trimmed) {
      if (methodType === 'GATEWAY') {
        throw new BadRequestException('A GATEWAY payment method requires a gateway configuration');
      }
      return null;
    }
    let row: { id: string; status: string } | null = null;
    try {
      row = (await (this.prisma as unknown as {
        paymentGatewayConfig: { findUnique: (args: unknown) => Promise<{ id: string; status: string } | null> };
      }).paymentGatewayConfig.findUnique({ where: { id: trimmed } })) ?? null;
    } catch {
      row = null;
    }
    if (!row) {
      throw new NotFoundException('Gateway configuration not found');
    }
    if (row.status !== 'ACTIVE') {
      throw new BadRequestException('Selected gateway configuration is not active');
    }
    return row.id;
  }

  private cleanOptional(
    value:
      | string
      | undefined,
  ): string | null {
    if (
      value === undefined ||
      value === null
    ) {
      return null;
    }

    const trimmed =
      value.trim();

    return trimmed || null;
  }

  private isAllowedImageDataUrl(
    value: string,
  ): boolean {
    return /^data:image\/(jpeg|jpg|png|webp|gif);base64,/i.test(
      value,
    );
  }

  // --------------------------------------------------------------------------
  // AUDIT
  // --------------------------------------------------------------------------

  private async writeAudit(
    action: string,
    actorId: string,
    entityId: string,
    value: Record<
      string,
      unknown
    >,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create(
        {
          data: {
            actorId,
            actorType: 'ADMIN',
            action,
            entityType:
              'ManualDepositRequest',
            entityId,
            oldValue:
              Prisma.JsonNull,
            newValue:
              value as Prisma.InputJsonValue,
          },
        },
      );
    } catch (error) {
      this.logger.warn(
        `Audit write failed for ${action}: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      );
    }
  }
}
