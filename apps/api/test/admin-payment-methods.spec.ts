/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../src/common/decorators/permissions.decorator';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { ManualPaymentService } from '../src/modules/wallet/manual-payment.service';
import { WalletService } from '../src/modules/wallet/wallet.service';
import { AdminPaymentMethodsController } from '../src/modules/wallet/admin-payment-methods.controller';
import { AdminManualDepositsController } from '../src/modules/wallet/admin-manual-deposits.controller';

/**
 * Admin payment-method + manual-deposit management (Phase 16/17).
 *
 * Covers the RBAC boundary (RolesGuard) and the existing service CRUD that is
 * now exposed through /admin/payment-methods + /admin/manual-deposits:
 *   - list all (including INACTIVE/ARCHIVED)
 *   - create (duplicate code rejected, audit written)
 *   - update (enabled/disabled/limits)
 *   - archive (archived methods disappear from user-facing ACTIVE lists)
 *   - deposit review is idempotent (approving twice never credits twice)
 */

const admin = { id: 'admin-1', sessionId: 's1', roles: ['ADMIN'], sessionKind: 'STAFF' as const };
const superAdmin = { id: 'super-1', sessionId: 's2', roles: ['SUPER_ADMIN'], sessionKind: 'STAFF' as const };
const user = { id: 'user-1', sessionId: 's3', roles: ['USER'], sessionKind: 'CUSTOMER' as const };

// ---------------------------------------------------------------------------
// RBAC boundary
// ---------------------------------------------------------------------------

function makeContext(a: any) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: a }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as any;
}

function makeGuard(required: string[] | undefined) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) =>
      key === ROLES_KEY ? required : key === PERMISSIONS_KEY ? undefined : undefined,
    ),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('Admin payment-methods RBAC', () => {
  it('rejects a normal USER with 403', () => {
    const guard = makeGuard(['ADMIN', 'SUPER_ADMIN']);
    expect(() => guard.canActivate(makeContext(user))).toThrow(ForbiddenException);
  });

  it('allows ADMIN', () => {
    expect(makeGuard(['ADMIN', 'SUPER_ADMIN']).canActivate(makeContext(admin))).toBe(true);
  });

  it('allows SUPER_ADMIN', () => {
    expect(makeGuard(['ADMIN', 'SUPER_ADMIN']).canActivate(makeContext(superAdmin))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Service CRUD fakes
// ---------------------------------------------------------------------------

interface MethodRow {
  id: string;
  code: string;
  displayName: string;
  type: string;
  status: string;
  supportedCurrencies: string[];
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  accountNumber: string | null;
  instructions: string | null;
  minDeposit: number;
  maxDeposit: number;
  minWithdrawal: number;
  maxWithdrawal: number;
  requireTransactionId: boolean;
  requireProof: boolean;
  sortOrder: number;
}

function makeServiceFake() {
  const methods = new Map<string, MethodRow>();
  const audits: unknown[] = [];
  const ledgerCredits: unknown[] = [];
  let seq = 0;
  const id = () => `pm-${++seq}`;

  const prisma: any = {
    paymentMethod: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.code !== undefined) {
          return [...methods.values()].find((m) => m.code === where.code) ?? null;
        }
        return methods.get(where.id) ?? null;
      }),
      findMany: jest.fn(async ({ where }: any) => {
        let rows = [...methods.values()];
        if (where?.status) rows = rows.filter((m) => m.status === where.status);
        if (where?.depositEnabled !== undefined) {
          rows = rows.filter((m) => m.depositEnabled === where.depositEnabled);
        }
        if (where?.supportedCurrencies?.has) {
          rows = rows.filter((m) => m.supportedCurrencies.includes(where.supportedCurrencies.has));
        }
        rows.sort((a, b) => a.sortOrder - b.sortOrder);
        return rows;
      }),
      create: jest.fn(async ({ data }: any) => {
        const row: MethodRow = {
          id: id(),
          code: data.code,
          displayName: data.displayName,
          supportedCurrencies: data.supportedCurrencies,
          type: data.type ?? 'MANUAL',
          status: data.status ?? 'ACTIVE',
          depositEnabled: data.depositEnabled ?? true,
          withdrawalEnabled: data.withdrawalEnabled ?? false,
          accountNumber: data.accountNumber ?? null,
          instructions: data.instructions ?? null,
          minDeposit: data.minDeposit ?? 0,
          maxDeposit: data.maxDeposit ?? 0,
          minWithdrawal: data.minWithdrawal ?? 0,
          maxWithdrawal: data.maxWithdrawal ?? 0,
          requireTransactionId: data.requireTransactionId ?? true,
          requireProof: data.requireProof ?? false,
          sortOrder: data.sortOrder ?? 0,
        };
        methods.set(row.id, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = methods.get(where.id)!;
        const updated = { ...row, ...data };
        methods.set(row.id, updated);
        return updated;
      }),
    },
    manualDepositRequest: {
      findUnique: jest.fn(async () => null),
      update: jest.fn(),
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
      async (userId: string, amount: number, currency: string, reqId: string, referenceId?: string) => {
        ledgerCredits.push({ userId, amount, currency, reqId, referenceId });
        return { transactionId: `tx-${reqId}`, duplicate: false };
      },
    ),
  } as unknown as WalletService;

  const service = new ManualPaymentService(prisma as any, walletService as any);
  return { service, prisma, methods, audits, ledgerCredits, walletService };
}
describe('ManualPaymentService — admin payment-method CRUD', () => {
  it('creates an ACTIVE method and writes an audit entry', async () => {
    const { service, methods, audits } = makeServiceFake();
    const created = await service.createPaymentMethod(admin, {
      code: 'bkash',
      displayName: 'bKash',
      supportedCurrencies: ['BDT'],
      accountNumber: '01712345678',
      instructions: 'Send the exact amount and enter the transaction ID.',
      minDeposit: 500,
      maxDeposit: 100000,
    });
    expect(created.code).toBe('bkash');
    expect(created.status).toBe('ACTIVE');
    expect(created.depositEnabled).toBe(true);
    expect(methods.get(created.id)?.accountNumber).toBe('01712345678');
    expect(audits.some((a: any) => a.action === 'PAYMENT_METHOD_CREATED')).toBe(true);
  });

  it('rejects a duplicate payment-method code', async () => {
    const { service } = makeServiceFake();
    await service.createPaymentMethod(admin, {
      code: 'nagad',
      displayName: 'Nagad',
      supportedCurrencies: ['BDT'],
    });
    await expect(
      service.createPaymentMethod(admin, {
        code: 'NAGAD', // normalized to lowercase → duplicate
        displayName: 'Nagad 2',
        supportedCurrencies: ['BDT'],
      }),
    ).rejects.toThrow(/already exists/);
  });

  it('listAllPaymentMethods includes INACTIVE + ARCHIVED (admin management view)', async () => {
    const { service } = makeServiceFake();
    await service.createPaymentMethod(admin, { code: 'bkash', displayName: 'bKash', supportedCurrencies: ['BDT'] });
    const rocket = await service.createPaymentMethod(admin, { code: 'rocket', displayName: 'Rocket', supportedCurrencies: ['BDT'] });
    await service.updatePaymentMethod(admin, rocket.id, { status: 'INACTIVE' });

    const activeOnly = await service.listPaymentMethods({ currency: 'BDT', purpose: 'deposit' });
    const all = await service.listAllPaymentMethods();
    expect(activeOnly.some((m) => m.code === 'rocket')).toBe(false);
    expect(all.some((m) => m.code === 'rocket')).toBe(true);
    expect(all.some((m) => m.code === 'bkash')).toBe(true);
  });

  it('updatePaymentMethod toggles enable/disable + limits', async () => {
    const { service } = makeServiceFake();
    const created = await service.createPaymentMethod(admin, {
      code: 'bank',
      displayName: 'Bank Transfer',
      supportedCurrencies: ['BDT'],
      depositEnabled: true,
      withdrawalEnabled: false,
      minDeposit: 100,
    });
    expect(created.withdrawalEnabled).toBe(false);

    const updated = await service.updatePaymentMethod(admin, created.id, {
      withdrawalEnabled: true,
      maxDeposit: 500000,
      sortOrder: 5,
    });
    expect(updated.withdrawalEnabled).toBe(true);
    expect(updated.maxDeposit).toBe(500000);
    expect(updated.sortOrder).toBe(5);
  });

  it('updatePaymentMethod on a missing method gives 404', async () => {
    const { service } = makeServiceFake();
    await expect(
      service.updatePaymentMethod(admin, 'missing', { displayName: 'x' }),
    ).rejects.toThrow(NotFoundException);
  });

  it('archiving sets ARCHIVED and disables deposit/withdrawal', async () => {
    const { service } = makeServiceFake();
    const created = await service.createPaymentMethod(admin, {
      code: 'card',
      displayName: 'Card',
      supportedCurrencies: ['BDT', 'USD'],
      depositEnabled: true,
      withdrawalEnabled: true,
    });
    const archived = await service.archivePaymentMethod(admin, created.id);
    expect(archived.status).toBe('ARCHIVED');
    expect(archived.depositEnabled).toBe(false);
    expect(archived.withdrawalEnabled).toBe(false);
  });

  it('a newly created ACTIVE method is visible to users via listPaymentMethods', async () => {
    const { service } = makeServiceFake();
    const created = await service.createPaymentMethod(admin, {
      code: 'bkash',
      displayName: 'bKash',
      supportedCurrencies: ['BDT'],
      depositEnabled: true,
    });
    const visible = await service.listPaymentMethods({ currency: 'BDT', purpose: 'deposit' });
    expect(visible.some((m) => m.id === created.id)).toBe(true);
  });

  it('getAdminDeposit returns the deposit with the requesting user', async () => {
    const { service, prisma } = makeServiceFake();
    const deposit = {
      id: 'dep-1',
      userId: 'user-1',
      methodId: 'pm-1',
      amount: 1000,
      currency: 'BDT',
      status: 'PENDING',
      rejectionReason: null,
      reviewedBy: null,
      reviewedAt: null,
      transactionId: null,
      referenceId: 'TX1234',
      createdAt: new Date(),
      updatedAt: new Date(),
      method: { code: 'bkash', displayName: 'bKash' },
      user: { id: 'user-1', username: 'testuser', email: 't@example.com', phone: '+8801' },
    };
    prisma.manualDepositRequest.findUnique.mockResolvedValue(deposit);
    const detail = await service.getAdminDeposit('dep-1');
    expect(detail.deposit.status).toBe('PENDING');
    expect(detail.user.username).toBe('testuser');
  });

  it('getAdminDeposit on a missing request gives 404', async () => {
    const { service } = makeServiceFake();
    await expect(service.getAdminDeposit('missing')).rejects.toThrow(NotFoundException);
  });
});
describe('ManualPaymentService — deposit review idempotency (admin)', () => {
  it('approving an already-APPROVED request never credits twice', async () => {
    const { service, walletService, ledgerCredits } = makeServiceFake();
    const deposit = {
      id: 'dep-1',
      userId: 'user-1',
      methodId: 'pm-1',
      amount: 1000,
      currency: 'BDT',
      status: 'APPROVED',
      rejectionReason: null,
      reviewedBy: 'admin-1',
      reviewedAt: new Date(),
      transactionId: 'tx-1',
      referenceId: 'REF1',
      createdAt: new Date(),
      updatedAt: new Date(),
      method: { code: 'bkash', displayName: 'bKash' },
    };
    const prisma = (service as any).prisma;
    prisma.manualDepositRequest.findUnique.mockResolvedValue(deposit);

    await service.reviewManualDeposit(admin, 'dep-1', { action: 'APPROVE' });
    expect((walletService.creditManualDeposit as jest.Mock).mock.calls.length).toBe(0);
    expect(ledgerCredits.length).toBe(0);
  });

  it('rejects a REJECTED/CANCELLED request instead of approving it', async () => {
    const { service, walletService } = makeServiceFake();
    const deposit = {
      id: 'dep-2',
      userId: 'user-1',
      methodId: 'pm-1',
      amount: 1000,
      currency: 'BDT',
      status: 'REJECTED',
      rejectionReason: 'nope',
      reviewedBy: 'admin-1',
      reviewedAt: new Date(),
      transactionId: null,
      referenceId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      method: { code: 'bkash', displayName: 'bKash' },
    };
    (service as any).prisma.manualDepositRequest.findUnique.mockResolvedValue(deposit);
    await expect(
      service.reviewManualDeposit(admin, 'dep-2', { action: 'APPROVE' }),
    ).rejects.toThrow(BadRequestException);
    expect((walletService.creditManualDeposit as jest.Mock).mock.calls.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Controller wiring (routes delegate to the service)
// ---------------------------------------------------------------------------

describe('AdminPaymentMethodsController', () => {
  it('delegates GET/POST/PATCH/archive to the service', () => {
    const service = {
      listAllPaymentMethods: jest.fn(async () => []),
      createPaymentMethod: jest.fn(async () => ({})),
      updatePaymentMethod: jest.fn(async () => ({})),
      archivePaymentMethod: jest.fn(async () => ({})),
    } as any;
    const ctrl = new AdminPaymentMethodsController(service);
    void ctrl.list();
    void ctrl.create(admin, { code: 'bkash', displayName: 'bKash', supportedCurrencies: ['BDT'] } as any);
    void ctrl.update(admin, 'id-1', { maxDeposit: 1000 } as any);
    void ctrl.archive(admin, 'id-1');
    expect(service.listAllPaymentMethods).toHaveBeenCalled();
    expect(service.createPaymentMethod).toHaveBeenCalled();
    expect(service.updatePaymentMethod).toHaveBeenCalledWith(admin, 'id-1', { maxDeposit: 1000 });
    expect(service.archivePaymentMethod).toHaveBeenCalledWith(admin, 'id-1');
  });
});

describe('AdminManualDepositsController', () => {
  it('delegates list/detail/review to the service', () => {
    const service = {
      listAdminDeposits: jest.fn(async () => []),
      getAdminDeposit: jest.fn(async () => ({})),
      reviewManualDeposit: jest.fn(async () => ({})),
    } as any;
    const ctrl = new AdminManualDepositsController(service);
    void ctrl.list({ status: 'PENDING' } as any);
    void ctrl.detail('dep-1');
    void ctrl.review(admin, 'dep-1', { action: 'APPROVE' });
    expect(service.listAdminDeposits).toHaveBeenCalledWith({ status: 'PENDING' });
    expect(service.getAdminDeposit).toHaveBeenCalledWith('dep-1');
    expect(service.reviewManualDeposit).toHaveBeenCalledWith(admin, 'dep-1', { action: 'APPROVE' });
  });
});