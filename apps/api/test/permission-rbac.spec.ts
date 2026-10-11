/* eslint-disable @typescript-eslint/no-explicit-any */
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { calculateEffectivePermissions } from '../src/common/auth/effective-permissions';
import { PERMISSIONS_KEY } from '../src/common/decorators/permissions.decorator';
import { ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { RolesGuard } from '../src/common/guards/roles.guard';
import { AdminSupportController } from '../src/modules/support/admin-support.controller';
import { AdminPaymentGatewaysController } from '../src/modules/wallet/admin-payment-gateways.controller';
import { PartnerController } from '../src/modules/partner/partner.controller';
import { AdminStaffController } from '../src/modules/admin/admin-users.controller';
import { AdminController } from '../src/modules/admin/admin.controller';
import { PartnerProvidersController } from '../src/modules/sportsbook/partner-providers.controller';
import { WinHouseAdminController } from '../src/modules/winhouse/winhouse-admin.controller';

function contextFor(user: unknown) {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as any;
}

function guardFor(roles: string[] | undefined, permissions?: string[]) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => {
      if (key === ROLES_KEY) return roles;
      if (key === PERMISSIONS_KEY) return permissions;
      return undefined;
    }),
  } as unknown as Reflector;
  return new RolesGuard(reflector);
}

describe('effective staff permissions', () => {
  it('combines role grants with direct grants and applies direct denies last', () => {
    const result = calculateEffectivePermissions(
      [
        {
          name: 'SUPPORT',
          permissions: [
            { permission: { name: ADMIN_PERMISSIONS.SUPPORT_READ } },
            { permission: { name: ADMIN_PERMISSIONS.SUPPORT_REPLY } },
          ],
        },
      ],
      [
        { effect: 'GRANT', permission: { name: ADMIN_PERMISSIONS.WALLETS_READ } },
        { effect: 'DENY', permission: { name: ADMIN_PERMISSIONS.SUPPORT_REPLY } },
      ],
    );
    expect(result).toEqual([ADMIN_PERMISSIONS.SUPPORT_READ, ADMIN_PERMISSIONS.WALLETS_READ].sort());
  });
});

describe('endpoint permission enforcement', () => {
  it('allows a staff session with SUPPORT_READ to read support', () => {
    const guard = guardFor(['ADMIN', 'SUPER_ADMIN'], [ADMIN_PERMISSIONS.SUPPORT_READ]);
    expect(
      guard.canActivate(
        contextFor({
          id: 'staff-1',
          roles: ['ADMIN'],
          sessionKind: 'STAFF',
          permissions: [ADMIN_PERMISSIONS.SUPPORT_READ],
        }),
      ),
    ).toBe(true);
  });

  it('blocks SUPPORT_READ-only staff from reply and reports 403', () => {
    const guard = guardFor(['ADMIN', 'SUPER_ADMIN'], [ADMIN_PERMISSIONS.SUPPORT_REPLY]);
    expect(() =>
      guard.canActivate(
        contextFor({
          id: 'staff-1',
          roles: ['ADMIN'],
          sessionKind: 'STAFF',
          permissions: [ADMIN_PERMISSIONS.SUPPORT_READ],
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('blocks a staff session with no module read permission', () => {
    const guard = guardFor(['ADMIN', 'SUPER_ADMIN'], [ADMIN_PERMISSIONS.SUPPORT_READ]);
    expect(() =>
      guard.canActivate(
        contextFor({ id: 'staff-1', roles: ['ADMIN'], sessionKind: 'STAFF', permissions: [] }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows ADMINS_READ to read the staff directory but blocks Master-only deactivation', () => {
    const readGuard = guardFor(['ADMIN', 'SUPER_ADMIN'], [ADMIN_PERMISSIONS.ADMINS_READ]);
    expect(
      readGuard.canActivate(
        contextFor({
          id: 'staff-1',
          roles: ['ADMIN'],
          sessionKind: 'STAFF',
          permissions: [ADMIN_PERMISSIONS.ADMINS_READ],
        }),
      ),
    ).toBe(true);

    const deactivateGuard = guardFor(['SUPER_ADMIN'], [ADMIN_PERMISSIONS.ADMINS_DEACTIVATE]);
    expect(() =>
      deactivateGuard.canActivate(
        contextFor({
          id: 'staff-1',
          roles: ['ADMIN'],
          sessionKind: 'STAFF',
          permissions: [ADMIN_PERMISSIONS.ADMINS_READ],
        }),
      ),
    ).toThrow(ForbiddenException);
  });

  it('requires both the controller READ and handler action capabilities', () => {
    const reflector = new Reflector();
    const guard = new RolesGuard(reflector);
    const context = {
      getHandler: () => AdminSupportController.prototype.reply,
      getClass: () => AdminSupportController,
      switchToHttp: () => ({
        getRequest: () => ({
          user: {
            id: 'staff-1',
            roles: ['ADMIN'],
            sessionKind: 'STAFF',
            permissions: [ADMIN_PERMISSIONS.SUPPORT_REPLY],
          },
        }),
      }),
    } as any;
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('does not let a customer session reach a permission-protected admin route', () => {
    const guard = guardFor(['ADMIN', 'SUPER_ADMIN'], [ADMIN_PERMISSIONS.SUPPORT_READ]);
    expect(() =>
      guard.canActivate(
        contextFor({
          id: 'customer-1',
          roles: ['ADMIN'],
          sessionKind: 'CUSTOMER',
          permissions: [ADMIN_PERMISSIONS.SUPPORT_READ],
        }),
      ),
    ).toThrow(UnauthorizedException);
  });

  it('allows the allowlisted Master Admin context to bypass missing rows', () => {
    const guard = guardFor(['SUPER_ADMIN'], [ADMIN_PERMISSIONS.SUPPORT_REPLY]);
    expect(
      guard.canActivate(
        contextFor({
          id: 'master-1',
          roles: ['SUPER_ADMIN'],
          sessionKind: 'STAFF',
          permissions: [],
          isMasterAdmin: true,
        }),
      ),
    ).toBe(true);
  });
});

describe('canonical route metadata', () => {
  it('declares partner provider CRUD/sync capabilities on the existing controller', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PartnerProvidersController)).toEqual([
      ADMIN_PERMISSIONS.PARTNER_PROVIDERS_READ,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PartnerProvidersController.prototype.create)).toEqual([
      ADMIN_PERMISSIONS.PARTNER_PROVIDERS_CREATE,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PartnerProvidersController.prototype.update)).toEqual([
      ADMIN_PERMISSIONS.PARTNER_PROVIDERS_UPDATE,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PartnerProvidersController.prototype.remove)).toEqual([
      ADMIN_PERMISSIONS.PARTNER_PROVIDERS_DELETE,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, PartnerProvidersController.prototype.sync)).toEqual([
      ADMIN_PERMISSIONS.PARTNER_PROVIDERS_SYNC,
    ]);
  });

  it('declares WinHouse read and self-test capabilities without replacing the guard', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, WinHouseAdminController)).toEqual([
      ADMIN_PERMISSIONS.WINHOUSE_READ,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, WinHouseAdminController.prototype.selfTest)).toEqual([
      ADMIN_PERMISSIONS.WINHOUSE_TEST,
    ]);
  });

  it('declares support read/reply capabilities on the existing controller', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AdminSupportController)).toEqual([
      ADMIN_PERMISSIONS.SUPPORT_READ,
    ]);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, AdminSupportController.prototype.reply),
    ).toEqual([ADMIN_PERMISSIONS.SUPPORT_REPLY]);
  });

  it('declares payment gateway action capabilities separately from read', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AdminPaymentGatewaysController)).toEqual([
      ADMIN_PERMISSIONS.PAYMENT_GATEWAYS_READ,
    ]);
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, AdminPaymentGatewaysController.prototype.test),
    ).toEqual([ADMIN_PERMISSIONS.PAYMENT_GATEWAYS_TEST]);
  });

  it('declares settings read independently from dashboard read', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AdminController.prototype.settings)).toEqual([
      ADMIN_PERMISSIONS.SETTINGS_READ,
    ]);
  });

  it('declares partner admin health as a read capability', () => {
    expect(
      Reflect.getMetadata(PERMISSIONS_KEY, PartnerController.prototype.adminStatus),
    ).toEqual([ADMIN_PERMISSIONS.PARTNER_PROVIDERS_READ]);
  });

  it('declares staff-directory read separately from Master-only deactivation', () => {
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AdminStaffController)).toEqual([
      ADMIN_PERMISSIONS.ADMINS_READ,
    ]);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, AdminStaffController.prototype.deactivate)).toEqual([
      ADMIN_PERMISSIONS.ADMINS_DEACTIVATE,
    ]);
    expect(Reflect.getMetadata(ROLES_KEY, AdminStaffController.prototype.deactivate)).toEqual([
      'SUPER_ADMIN',
    ]);
  });
});
