/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { ManualPaymentService } from '../src/modules/wallet/manual-payment.service';
import { WalletService } from '../src/modules/wallet/wallet.service';
import { AdminManualDepositsController } from '../src/modules/wallet/admin-manual-deposits.controller';
import type { SubmitManualDepositDto } from '../src/modules/wallet/dto/manual-payment.dto';

/**
 * Manual deposit PROOF rule + admin visibility of the proof.
 *
 * Business rule under test (regression: both fields used to be required):
 *   1. transaction ID only              → accepted
 *   2. screenshot only                  → accepted
 *   3. transaction ID + screenshot      → accepted
 *   4. neither                          → rejected
 *
 * Plus the admin data path (user upload → ManualPaymentService →
 * ManualDepositRequest.proofPath → admin detail API) and the wallet
 * guarantees (pending never credits, approve credits exactly once through the
 * existing idempotent ledger, reject never credits, non-admins cannot review).
 */

/** 1x1 transparent PNG — the smallest valid allowed proof payload. */
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

const customer = {
  id: 'user-1',
  sessionId: 's-cust',
  roles: ['USER'],
  sessionKind: 'CUSTOMER' as const,
};

const otherCustomer = {
  id: 'user-2',
  sessionId: 's-cust-2',
  roles: ['USER'],
  sessionKind: 'CUSTOMER' as const,
};

const admin = {
  id: 'admin-1',
  sessionId: 's-admin',
  roles: ['ADMIN'],
  sessionKind: 'STAFF' as const,
  permissions: [] as string[],
};

// ---------------------------------------------------------------------------
// In-memory doubles
// ---------------------------------------------------------------------------

interface DepositRow {
  id: string;
  userId: string;
  methodId: string;
  amount: number;
  currency: string;
  referenceId: string | null;
  proofPath: string | null;
  status: string;
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  transactionId: string | null;
  idempotencyKey: string;
  createdAt: Date;
  updatedAt: Date;
}

const users: Record<string, any> = {
  'user-1': {
    id: 'user-1',
    username: 'amina',
    email: 'amina@example.com',
    phone: null,
  },
  'user-2': {
    id: 'user-2',
    username: 'rakib',
    email: 'rakib@example.com',
    phone: null,
  },
};

/**
 * `requireProof: true` is deliberate: the regression was that this per-method
 * flag turned a screenshot into a hard requirement, so a valid
 * transaction-ID-only deposit was rejected.
 */
const bkash: any = {
  id: 'pm-bkash',
  code: 'bkash',
  displayName: 'bKash',
  type: 'MANUAL',
  status: 'ACTIVE',
  supportedCurrencies: ['BDT', 'USD', 'EUR'],
  depositEnabled: true,
  withdrawalEnabled: true,
  gatewayConfigId: null,
  accountNumber: '01712345678',
  accountName: 'TANVION ROYALE',
  bankName: null,
  branch: null,
  routingNumber: null,
  instructions: 'Send the exact amount, then submit your proof.',
  minDeposit: 0,
  maxDeposit: 0,
  minWithdrawal: 0,
  maxWithdrawal: 0,
  requireTransactionId: true,
  requireProof: true,
  sortOrder: 1,
};

function makeWorld() {
  const deposits = new Map<string, DepositRow>();
  const audits: any[] = [];
  const credits: Array<{
    userId: string;
    amount: number;
    currency: string;
    requestId: string;
    referenceId?: string;
  }> = [];
  let seq = 0;

  const methods = new Map<string, any>();
  methods.set(bkash.id, bkash);

  const attach = (row: DepositRow) => ({
    ...row,
    method: methods.get(row.methodId) ?? null,
  });

  const prisma: any = {
    paymentMethod: {
      findFirst: jest.fn(async ({ where }: any) => {
        for (const row of methods.values()) {
          if (where.code && row.code !== where.code) continue;
          if (where.status && row.status !== where.status) continue;
          if (where.type && row.type !== where.type) continue;
          if (
            where.depositEnabled !== undefined &&
            row.depositEnabled !== where.depositEnabled
          ) {
            continue;
          }
          return row;
        }
        return null;
      }),
    },
    manualDepositRequest: {
      create: jest.fn(async ({ data }: any) => {
        seq += 1;
        const row: DepositRow = {
          id: `dep-${seq}`,
          userId: data.userId,
          methodId: data.methodId,
          amount: data.amount,
          currency: data.currency,
          referenceId: data.referenceId ?? null,
          proofPath: data.proofPath ?? null,
          status: data.status,
          rejectionReason: null,
          reviewedBy: null,
          reviewedAt: null,
          transactionId: null,
          idempotencyKey: data.idempotencyKey ?? `auto-${seq}`,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        };
        deposits.set(row.id, row);
        return attach(row);
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        for (const row of deposits.values()) {
          if (where.userId && row.userId !== where.userId) continue;
          if (
            where.idempotencyKey &&
            row.idempotencyKey !== where.idempotencyKey
          ) {
            continue;
          }
          if (
            where.referenceId &&
            row.referenceId !== where.referenceId
          ) {
            continue;
          }
          if (
            where.status?.in &&
            !where.status.in.includes(row.status)
          ) {
            continue;
          }
          return attach(row);
        }
        return null;
      }),
      findUnique: jest.fn(async ({ where }: any) => {
        const row = deposits.get(where.id);
        if (!row) return null;
        return {
          ...attach(row),
          user: users[row.userId] ?? null,
        };
      }),
      findMany: jest.fn(async ({ where }: any) =>
        [...deposits.values()]
          .filter(
            (row) =>
              !where?.userId || row.userId === where.userId,
          )
          .map(attach),
      ),
      update: jest.fn(async ({ where, data }: any) => {
        const row = deposits.get(where.id)!;
        const updated = { ...row, ...data };
        deposits.set(where.id, updated);
        return attach(updated);
      }),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        audits.push(data);
        return data;
      }),
    },
  };

  const walletService = {
    creditManualDeposit: jest.fn(
      async (
        userId: string,
        amount: number,
        currency: string,
        requestId: string,
        referenceId?: string,
      ) => {
        credits.push({
          userId,
          amount,
          currency,
          requestId,
          referenceId,
        });
        return {
          transactionId: `wtx-${requestId}`,
          // The real ledger is keyed on the manual-request id, so a repeated
          // call is reported as a duplicate instead of crediting again.
          duplicate: credits.length > 1,
        };
      },
    ),
  } as unknown as WalletService;

  const service = new ManualPaymentService(
    prisma,
    walletService,
  );

  return {
    service,
    prisma,
    walletService,
    deposits,
    audits,
    credits,
  };
}

/** 1,000.00 BDT expressed in minor units. */
const BASE_DTO = {
  methodCode: 'bkash',
  currency: 'BDT',
  amount: 100_000,
};

function dto(
  patch: Partial<SubmitManualDepositDto>,
): SubmitManualDepositDto {
  return {
    ...BASE_DTO,
    ...patch,
  } as unknown as SubmitManualDepositDto;
}

// ---------------------------------------------------------------------------
// 1–4. The proof rule
// ---------------------------------------------------------------------------

describe('ManualPaymentService.submitManualDeposit — at least one proof', () => {
  it('CASE 1: transaction ID only is accepted (even when the method requires proof)', async () => {
    const { service, credits } = makeWorld();

    const view = await service.submitManualDeposit(
      customer,
      dto({ referenceId: 'TX123456789' }),
    );

    expect(view.status).toBe('PENDING');
    expect(view.referenceId).toBe('TX123456789');
    expect(view.proofPath).toBeNull();
    // A pending deposit never touches the wallet.
    expect(credits).toHaveLength(0);
  });

  it('CASE 2: screenshot only is accepted', async () => {
    const { service, credits } = makeWorld();

    const view = await service.submitManualDeposit(
      customer,
      dto({ proofDataUrl: PNG_DATA_URL }),
    );

    expect(view.status).toBe('PENDING');
    expect(view.referenceId).toBeNull();
    expect(view.proofPath).toBe(PNG_DATA_URL);
    expect(credits).toHaveLength(0);
  });

  it('CASE 3: transaction ID and screenshot together are accepted', async () => {
    const { service } = makeWorld();

    const view = await service.submitManualDeposit(
      customer,
      dto({
        referenceId: 'TX123456789',
        proofDataUrl: PNG_DATA_URL,
      }),
    );

    expect(view.referenceId).toBe('TX123456789');
    expect(view.proofPath).toBe(PNG_DATA_URL);
  });

  it('CASE 4: neither a transaction ID nor a screenshot is rejected', async () => {
    const { service, prisma } = makeWorld();

    await expect(
      service.submitManualDeposit(customer, dto({})),
    ).rejects.toThrow(BadRequestException);

    await expect(
      service.submitManualDeposit(customer, dto({})),
    ).rejects.toThrow(
      /transaction ID or payment screenshot/i,
    );

    // Whitespace-only values are "missing", not a proof.
    await expect(
      service.submitManualDeposit(
        customer,
        dto({ referenceId: '   ', proofDataUrl: '  ' }),
      ),
    ).rejects.toThrow(BadRequestException);

    expect(
      prisma.manualDepositRequest.create,
    ).not.toHaveBeenCalled();
  });

  it('rejects a non-image screenshot instead of storing it', async () => {
    const { service } = makeWorld();

    await expect(
      service.submitManualDeposit(
        customer,
        dto({ proofDataUrl: 'data:text/html;base64,PHNjcmlwdD4=' }),
      ),
    ).rejects.toThrow(/JPG, PNG, WEBP or GIF/i);
  });
});

// ---------------------------------------------------------------------------
// 5–7. The admin data path
// ---------------------------------------------------------------------------

describe('ManualPaymentService — admin receives the stored proof', () => {
  it('CASE 5: the admin detail API returns the submitted screenshot', async () => {
    const { service } = makeWorld();
    const created = await service.submitManualDeposit(
      customer,
      dto({
        referenceId: 'TX123456789',
        proofDataUrl: PNG_DATA_URL,
      }),
    );

    const detail = await service.getAdminDeposit(created.id);

    expect(detail.deposit.proofPath).toBe(PNG_DATA_URL);
    expect(detail.deposit.referenceId).toBe('TX123456789');
    expect(detail.user.username).toBe('amina');
  });

  it('CASE 6: the admin list also carries the screenshot so a reviewer can spot it', async () => {
    const { service } = makeWorld();
    await service.submitManualDeposit(
      customer,
      dto({ proofDataUrl: PNG_DATA_URL }),
    );

    const rows = await service.listAdminDeposits({});

    expect(rows).toHaveLength(1);
    expect(rows[0].proofPath).toBe(PNG_DATA_URL);
  });

  it('CASE 7: a transaction-ID-only deposit reports "no screenshot" as null', async () => {
    const { service } = makeWorld();
    const created = await service.submitManualDeposit(
      customer,
      dto({ referenceId: 'TX123456789' }),
    );

    const detail = await service.getAdminDeposit(created.id);

    expect(detail.deposit.referenceId).toBe('TX123456789');
    expect(detail.deposit.proofPath).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 8. Ownership
// ---------------------------------------------------------------------------

describe('ManualPaymentService.listMyDeposits — ownership', () => {
  it('CASE 8: a user can never see another user’s deposit', async () => {
    const { service, prisma } = makeWorld();
    await service.submitManualDeposit(
      otherCustomer,
      dto({ referenceId: 'TX-OTHER-0001' }),
    );

    const mine = await service.listMyDeposits(customer);

    expect(mine).toHaveLength(0);
    expect(
      prisma.manualDepositRequest.findMany.mock.calls[0][0].where
        .userId,
    ).toBe('user-1');

    // ...and the owner still sees their own row.
    const theirs = await service.listMyDeposits(otherCustomer);
    expect(theirs).toHaveLength(1);
    expect(theirs[0].id).toBe('dep-1');
  });
});

// ---------------------------------------------------------------------------
// 9. Only a permitted admin may review
// ---------------------------------------------------------------------------

describe('AdminManualDepositsController — review authorisation', () => {
  /**
   * A real Reflector reads the @Roles / @RequirePermissions metadata that is
   * actually declared on the controller, so this cannot drift from the guards.
   */
  const guard = new RolesGuard(new Reflector());

  const context = (user: any, handler: any) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: () => handler,
      getClass: () => AdminManualDepositsController,
    }) as any;

  it('CASE 9: a normal customer session cannot approve or reject', () => {
    const review =
      AdminManualDepositsController.prototype.review;

    expect(() =>
      guard.canActivate(context(customer, review)),
    ).toThrow(ForbiddenException);
    expect(() =>
      guard.canActivate(context(otherCustomer, review)),
    ).toThrow(ForbiddenException);
  });

  it('CASE 9: a staff session without the review permission is refused', () => {
    const review =
      AdminManualDepositsController.prototype.review;

    expect(() =>
      guard.canActivate(context(admin, review)),
    ).toThrow(ForbiddenException);
  });

  it('a permitted admin passes the guard', () => {
    const review =
      AdminManualDepositsController.prototype.review;
    const permitted = {
      ...admin,
      permissions: ['deposits.read', 'deposits.review'],
    };

    expect(
      guard.canActivate(context(permitted, review)),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 10–11. Wallet behaviour
// ---------------------------------------------------------------------------

describe('ManualPaymentService.reviewManualDeposit — wallet', () => {
  it('CASE 10: approving credits the wallet exactly once and stays idempotent', async () => {
    const { service, credits, walletService } = makeWorld();
    const created = await service.submitManualDeposit(
      customer,
      dto({ referenceId: 'TX123456789' }),
    );

    const approved = await service.reviewManualDeposit(
      admin,
      created.id,
      { action: 'APPROVE' },
    );

    expect(approved.status).toBe('APPROVED');
    expect(credits).toHaveLength(1);
    expect(credits[0]).toMatchObject({
      userId: 'user-1',
      amount: 100_000,
      currency: 'BDT',
      // The manual-request id IS the wallet idempotency key.
      requestId: created.id,
    });

    // Approving the same deposit again must not credit again.
    const again = await service.reviewManualDeposit(
      admin,
      created.id,
      { action: 'APPROVE' },
    );

    expect(again.status).toBe('APPROVED');
    expect(credits).toHaveLength(1);
    expect(
      (walletService.creditManualDeposit as jest.Mock).mock.calls
        .length,
    ).toBe(1);
  });

  it('CASE 11: rejecting never credits the wallet', async () => {
    const { service, credits } = makeWorld();
    const created = await service.submitManualDeposit(
      customer,
      dto({ proofDataUrl: PNG_DATA_URL }),
    );

    const rejected = await service.reviewManualDeposit(
      admin,
      created.id,
      { action: 'REJECT', reason: 'Could not verify' },
    );

    expect(rejected.status).toBe('REJECTED');
    expect(rejected.rejectionReason).toBe('Could not verify');
    expect(credits).toHaveLength(0);
  });

  it('a screenshot-only deposit can still be approved and credited', async () => {
    const { service, credits } = makeWorld();
    const created = await service.submitManualDeposit(
      customer,
      dto({ proofDataUrl: PNG_DATA_URL }),
    );

    await service.reviewManualDeposit(admin, created.id, {
      action: 'APPROVE',
    });

    expect(credits).toHaveLength(1);
  });
});
