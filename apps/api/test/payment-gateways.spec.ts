/**
 * Payment gateway + webhook + manual-withdrawal regression tests.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../src/common/decorators/permissions.decorator';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { PaymentGatewaysService } from '../src/modules/wallet/payment-gateways.service';
import { PaymentWebhooksController } from '../src/modules/wallet/payment-webhooks.controller';
import { ManualPaymentService } from '../src/modules/wallet/manual-payment.service';

function makeContext(a: any) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: a }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as any;
}

function makeGuard(required: string[] | undefined) {
  return new RolesGuard({
    getAllAndOverride: jest.fn((key: string) =>
      key === ROLES_KEY ? required : key === PERMISSIONS_KEY ? undefined : undefined,
    ),
  } as unknown as Reflector);
}

// ---------------------------------------------------------------------------
// Withdrawal destination category resolver (shared with apps/web)
// ---------------------------------------------------------------------------

describe('withdrawal destination kind resolver', () => {
  const {
    resolveWithdrawalDestinationKind,
    withdrawalDestinationFieldsFor,
  } = require('@tanvion-royale/types');

  it('maps known wallet codes to MOBILE_WALLET', () => {
    for (const code of ['bkash', 'NAGAD', 'Rocket', 'upay', 'SureCash']) {
      expect(resolveWithdrawalDestinationKind(code)).toBe('MOBILE_WALLET');
    }
  });

  it('maps bank and card codes', () => {
    expect(resolveWithdrawalDestinationKind('bank')).toBe('BANK');
    expect(resolveWithdrawalDestinationKind('bank-al-rafah')).toBe('BANK');
    expect(resolveWithdrawalDestinationKind('card')).toBe('CARD');
    expect(resolveWithdrawalDestinationKind('')).toBe('UNKNOWN');
  });

  it('routing is only required when the admin configured one', () => {
    expect(withdrawalDestinationFieldsFor('bank', { methodRoutingNumber: null }).requireRoutingNumber).toBe(false);
    expect(withdrawalDestinationFieldsFor('bank', { methodRoutingNumber: '060277536' }).requireRoutingNumber).toBe(true);
    expect(withdrawalDestinationFieldsFor('nagad').allowRoutingNumber).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Manual payment methods
// ---------------------------------------------------------------------------

describe('payment admin RBAC', () => {
  const user = { id: 'u1', roles: ['USER'], sessionKind: 'CUSTOMER' as const };
  const admin = { id: 'a1', roles: ['ADMIN'], sessionKind: 'STAFF' as const };
  const superAdmin = { id: 's1', roles: ['SUPER_ADMIN'], sessionKind: 'STAFF' as const };

  it('rejects a normal USER with 403', () => {
    expect(() => makeGuard(['ADMIN', 'SUPER_ADMIN']).canActivate(makeContext(user))).toThrow(ForbiddenException);
  });
  it('allows ADMIN', () => {
    expect(makeGuard(['ADMIN', 'SUPER_ADMIN']).canActivate(makeContext(admin))).toBe(true);
  });
  it('allows SUPER_ADMIN', () => {
    expect(makeGuard(['ADMIN', 'SUPER_ADMIN']).canActivate(makeContext(superAdmin))).toBe(true);
  });
});

describe('PaymentGatewaysService.toView', () => {
  it('never exposes raw secrets - only boolean *Set flags', () => {
    const service = new PaymentGatewaysService({} as any);
    const view = service.toView({
      id: 'g1', name: 'bKash Gateway', code: 'bkash-gateway', providerType: 'generic-http',
      baseUrl: 'https://gateway.example.com', status: 'ACTIVE',
      apiKeyEnc: 'v1:abc.def.ghi', apiSecretEnc: null, webhookSecretEnc: 'v1:xyz.uvw.rst',
      authMode: 'api-key', apiVersion: 'v1', timeoutMs: 15000,
      supportedCurrencies: ['BDT'], depositEnabled: true, withdrawalEnabled: true,
      createdAt: new Date('2026-01-01T00:00:00Z'), updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const raw = JSON.stringify(view);
    expect(view.apiKeySet).toBe(true);
    expect(view.webhookSecretSet).toBe(true);
    expect(view.apiSecretSet).toBe(false);
    expect(raw).not.toContain('v1:abc');
    expect(raw).not.toContain('apiKeyEnc');
    expect(raw).not.toContain('webhookSecretEnc');
  });
});

describe('PaymentWebhooksController.verify', () => {
  const cryptoMod = require('crypto') as typeof import('crypto');
  const secret = 'shared-webhook-secret';
  const timestamp = String(Math.floor(Date.now() / 1000));
  const hmac = (key: string) => (body: Buffer) => cryptoMod.createHmac('sha256', key).update(body).digest('hex');
  const sign = hmac(secret);

  it('accepts a valid signature over the raw body with a fresh timestamp', () => {
    const body = Buffer.from('{"eventId":"evt-1","amount":1000,"currency":"BDT"}', 'utf8');
    expect(PaymentWebhooksController.verify(body, secret, sign(body), timestamp)).toBe(true);
  });
  it('rejects a tampered payload (signature mismatch)', () => {
    const original = Buffer.from('{"eventId":"evt-1","amount":1000}', 'utf8');
    const tampered = Buffer.from('{"eventId":"evt-1","amount":99999}', 'utf8');
    expect(PaymentWebhooksController.verify(tampered, secret, sign(original), timestamp)).toBe(false);
  });
  it('rejects a signature produced with the wrong secret', () => {
    const body = Buffer.from('{"eventId":"evt-1"}', 'utf8');
    const wrong = hmac('other')(body);
    expect(PaymentWebhooksController.verify(body, secret, wrong, timestamp)).toBe(false);
  });
  it('rejects a stale timestamp (replay protection)', () => {
    const body = Buffer.from('{"eventId":"evt-1"}', 'utf8');
    const stale = String(Math.floor(Date.now() / 1000) - 3600);
    expect(PaymentWebhooksController.verify(body, secret, sign(body), stale)).toBe(false);
  });
  it('rejects a missing signature', () => {
    const body = Buffer.from('{"eventId":"evt-1"}', 'utf8');
    expect(PaymentWebhooksController.verify(body, secret, undefined, timestamp)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Manual withdrawal submission: reserve exactly once + idempotency
// ---------------------------------------------------------------------------

describe('ManualPaymentService.submitManualWithdrawal', () => {
  function makeService() {
    const reserved: Array<{ amount: number }> = [];
    const walletRow = { id: 'w1', userId: 'user-1', currency: 'BDT', availableBalance: 100000, lockedBalance: 0, status: 'ACTIVE' };
    const walletService = {
      getOrCreateWalletForUser: jest.fn(async () => ({ ...walletRow })),
      reserveManualWithdrawal: jest.fn(async (_wallet: any, input: any) => {
        reserved.push({ amount: input.amount });
        return { transactionId: 'tx-1', duplicate: false };
      }),
      releaseManualWithdrawal: jest.fn(async () => undefined),
      completeManualWithdrawal: jest.fn(async () => undefined),
    } as any;

    const rows: any[] = [];
    const prisma = {
      paymentMethod: {
        findFirst: jest.fn(async () => ({
          id: 'pm-1', code: 'bkash', displayName: 'bKash', type: 'MANUAL',
          supportedCurrencies: ['BDT'], withdrawalEnabled: true,
          minWithdrawal: 100, maxWithdrawal: 0, status: 'ACTIVE',
        })),
      },
      withdrawalRequest: {
        findFirst: jest.fn(async () => rows.find((r) => r.userId === 'user-1' && r.idempotencyKey === 'wd-key-0001') ?? null),
        findUnique: jest.fn(async () => null),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `wr-${rows.length + 1}`, method: { code: 'bkash', displayName: 'bKash', type: 'MANUAL' }, createdAt: new Date(), updatedAt: new Date(), ...data };
          rows.push(row);
          return row;
        }),
        update: jest.fn(),
        findMany: jest.fn(async () => rows),
      },
      auditLog: { create: jest.fn() },
    } as any;

    const service = new ManualPaymentService(prisma, walletService);
    return { service, prisma, reserved, rows };
  }

  const auth = { id: 'user-1', sessionId: 's1', roles: ['USER'] };
  const dto = { methodCode: 'bkash', currency: 'BDT', amount: 2000, accountNumber: '01712345678', accountName: 'Tanvion Royale', idempotencyKey: 'wd-key-0001' };

  it('reserves funds and returns a PENDING request', async () => {
    const { service, reserved, rows } = makeService();
    const result = await service.submitManualWithdrawal(auth, dto as any);
    expect(reserved).toHaveLength(1);
    expect(reserved[0].amount).toBe(2000);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('PENDING');
    expect(rows[0].walletTransactionId).toBe('tx-1');
    expect(result.withdrawal.status).toBe('PENDING');
  });

  it('is idempotent - a repeated submission never reserves twice', async () => {
    const { service, reserved, rows } = makeService();
    await service.submitManualWithdrawal(auth, dto as any);
    const second = await service.submitManualWithdrawal(auth, dto as any);
    expect(reserved).toHaveLength(1);
    expect(rows).toHaveLength(1);
    expect(second.withdrawal.status).toBe('PENDING');
  });

  it('rejects an unavailable method', async () => {
    const { service, prisma } = makeService();
    prisma.paymentMethod.findFirst.mockResolvedValue(null);
    await expect(
      service.submitManualWithdrawal(auth, { ...dto, methodCode: 'nagad', idempotencyKey: 'wd-key-0009' } as any),
    ).rejects.toThrow();
  });

  it('mobile wallet: strips irrelevant bank fields and requires holder name', async () => {
    const { service, rows } = makeService();
    const result = await service.submitManualWithdrawal(
      auth,
      {
        ...dto,
        methodCode: 'nagad',
        idempotencyKey: 'wd-key-0010',
        bankName: 'Should Be Dropped',
        branch: 'Should Be Dropped',
        routingNumber: '000000000',
      } as any,
    );
    expect(result.withdrawal.status).toBe('PENDING');
    expect(rows[0].bankName).toBeNull();
    expect(rows[0].branch).toBeNull();
    expect(rows[0].routingNumber).toBeNull();
    expect(rows[0].destinationAccount).toBe('01712345678');
    await expect(
      service.submitManualWithdrawal(
        auth,
        { ...dto, methodCode: 'nagad', accountName: '  ', idempotencyKey: 'wd-key-0011' } as any,
      ),
    ).rejects.toThrow('Account holder name is required.');
  });

  it('bank: requires bank name/branch and persists them', async () => {
    const { service, prisma, rows } = makeService();
    prisma.paymentMethod.findFirst.mockResolvedValue({
      id: 'pm-bank', code: 'bank', displayName: 'Bank', type: 'MANUAL',
      supportedCurrencies: ['BDT'], withdrawalEnabled: true,
      minWithdrawal: 0, maxWithdrawal: 0, status: 'ACTIVE',
      routingNumber: null,
    });
    await expect(
      service.submitManualWithdrawal(
        auth,
        { ...dto, methodCode: 'bank', accountName: 'Tanvion Royale', idempotencyKey: 'wd-key-0020' } as any,
      ),
    ).rejects.toThrow('Bank name is required.');
    const result = await service.submitManualWithdrawal(
      auth,
      {
        ...dto,
        methodCode: 'bank',
        accountName: 'Tanvion Royale',
        bankName: 'BRAC Bank',
        branch: 'Gulshan',
        idempotencyKey: 'wd-key-0021',
      } as any,
    );
    expect(result.withdrawal.status).toBe('PENDING');
    expect(rows[rows.length - 1].bankName).toBe('BRAC Bank');
    expect(rows[rows.length - 1].branch).toBe('Gulshan');
  });

  it('card: manual card withdrawal is gateway-only', async () => {
    const { service, prisma } = makeService();
    prisma.paymentMethod.findFirst.mockResolvedValue({
      id: 'pm-card', code: 'card', displayName: 'Card', type: 'MANUAL',
      supportedCurrencies: ['BDT'], withdrawalEnabled: true,
      minWithdrawal: 0, maxWithdrawal: 0, status: 'ACTIVE',
      routingNumber: null,
    });
    await expect(
      service.submitManualWithdrawal(
        auth,
        { ...dto, methodCode: 'card', idempotencyKey: 'wd-key-0030' } as any,
      ),
    ).rejects.toThrow('Card withdrawals are processed through the configured payment gateway');
  });
});