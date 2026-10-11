import { SetMetadata } from '@nestjs/common';

/** Metadata key consumed by the existing RolesGuard. */
export const PERMISSIONS_KEY = 'admin_permissions';

/**
 * Require every listed staff capability on a route.
 *
 * This deliberately extends the existing RolesGuard rather than introducing a
 * second authorization guard. Master Admin is checked by the guard using the
 * allowlist-backed `isMasterAdmin` request context.
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
