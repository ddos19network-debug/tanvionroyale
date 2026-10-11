import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import type { AuthenticatedUser } from '../types/authenticated-user';

/** Roles that make up the staff/admin surface of the application. */
const STAFF_ROLES = new Set(['ADMIN', 'SUPER_ADMIN']);

/**
 * The existing RBAC boundary, extended with endpoint-level capabilities.
 *
 * Role checks and the STAFF-session check remain exactly where they were. A
 * route may additionally declare @RequirePermissions(...); every declared
 * capability must be present in the request's server-loaded effective set.
 * Master Admin is the sole bypass and is marked by JwtAuthGuard only after the
 * configured allowlist has been checked.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Permission metadata is cumulative: a controller's READ capability must
    // remain required when a handler adds an action capability. This prevents a
    // direct mutation request from bypassing the module-level access boundary.
    const handlerPermissions = this.reflector.getAllAndOverride<string[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler()],
    );
    const controllerPermissions = this.reflector.getAllAndOverride<string[] | undefined>(
      PERMISSIONS_KEY,
      [context.getClass()],
    );
    const requiredPermissions = [
      ...new Set([...(controllerPermissions ?? []), ...(handlerPermissions ?? [])]),
    ];

    // Preserve the established behaviour for authenticated/non-admin routes
    // that do not declare either role or capability metadata.
    if ((!required || required.length === 0) && (!requiredPermissions || requiredPermissions.length === 0)) {
      return true;
    }

    const user = context.switchToHttp().getRequest().user as AuthenticatedUser | undefined;
    const hasRequiredRole = !required?.length || !!user?.roles?.some((role) => required.includes(role));
    if (!hasRequiredRole) {
      throw new ForbiddenException('Insufficient role');
    }

    const requiresStaffSession =
      !!requiredPermissions?.length || (required?.some((role) => STAFF_ROLES.has(role)) ?? false);
    if (requiresStaffSession && user?.sessionKind !== 'STAFF') {
      throw new UnauthorizedException('A staff sign-in session is required for this endpoint.');
    }

    if (requiredPermissions?.length) {
      // JwtAuthGuard always supplies this field for HTTP requests. Treat an
      // absent field as an empty set rather than trusting a hand-built token
      // object: a permission-protected endpoint fails closed.
      const isMasterAdmin = user?.isMasterAdmin === true;
      const granted = user?.permissions ?? [];
      const missing = requiredPermissions.filter((permission) => !granted.includes(permission));
      if (!isMasterAdmin && missing.length > 0) {
        throw new ForbiddenException(`Missing admin permission: ${missing.join(', ')}`);
      }
    }

    return true;
  }
}

