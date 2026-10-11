import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../types/authenticated-user';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { PrismaService } from '../../database/prisma.service';
import { isBlockedAccountStatus } from '../utils/account-status';
import { isMasterAdminEmail } from '../../config/master-admins';
import { calculateEffectivePermissions } from '../auth/effective-permissions';

/** Express request extended with the authenticated user context. */
export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

interface JwtPayload {
  sub: string;
  sid: string;
  roles: string[];
}

/**
 * Verifies the Bearer access token (short-lived JWT) and attaches the
 * authenticated user context to the request. Registered as a global guard,
 * so it runs BEFORE the global RolesGuard — which needs request.user to be
 * populated. Routes marked @Public() skip authentication entirely.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly logger = new Logger(JwtAuthGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing access token');
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(header.slice(7).trim());

      // The access token is stateless and short-lived, so on its own it cannot
      // immediately reflect logout, session revocation/expiry, or a change in
      // account status. Consult the authoritative Session row + User status on
      // every authenticated request so a revoked session or a SUSPENDED/LOCKED/
      // CLOSED account is rejected at the boundary for ALL auth methods.
      // The row also carries the session KIND (customer vs staff context),
      // read here so RolesGuard can refuse admin routes for customer sessions.
      const session = await this.prisma.session.findUnique({
        where: { id: payload.sid },
        select: {
          kind: true,
          revokedAt: true,
          expiresAt: true,
          user: {
            select: {
              status: true,
              email: true,
              accountType: true,
              // Roles and permissions are loaded from the database on every
              // request. A role/permission change therefore takes effect
              // without waiting for a token expiry or browser restart.
              userRoles: {
                select: {
                  role: {
                    select: {
                      name: true,
                      permissions: {
                        select: { permission: { select: { name: true } } },
                      },
                    },
                  },
                },
              },
              directPermissions: {
                select: {
                  effect: true,
                  permission: { select: { name: true } },
                },
              },
            },
          },
        },
      });
      if (!session || session.revokedAt || session.expiresAt < new Date()) {
        throw new UnauthorizedException('Session is no longer valid');
      }
      if (isBlockedAccountStatus(session.user.status)) {
        throw new ForbiddenException('Account is not permitted to access this resource');
      }
      // Account-domain separation at the auth boundary: a CUSTOMER session
      // whose account has since been classified STAFF (or was never a customer
      // at all) is refused here — staff authenticate only through the dedicated
      // staff login, which mints STAFF sessions. Fail-closed: RolesGuard still
      // refuses CUSTOMER sessions on every ADMIN/SUPER_ADMIN route.
      if (session.kind === 'CUSTOMER' && session.user.accountType === 'STAFF') {
        throw new UnauthorizedException('Staff accounts must sign in at the staff login.');
      }

      const tokenRoles = payload.roles ?? [];
      const roleRows = session.user.userRoles;
      const directPermissionRows = session.user.directPermissions;

      // Prefer the database role set whenever the relation was returned. This
      // makes role removal/reassignment effective immediately. The tokenRoles
      // fallback is retained only for old pre-migration/test session rows that
      // do not expose the relation; real Prisma sessions always return it.
      const authoritativeRoles = Array.isArray(roleRows)
        ? [...new Set(roleRows.map((row) => row.role.name))]
        : tokenRoles;
      let roles = authoritativeRoles;

      /*
       * SUPER_ADMIN retention — MASTER_ADMIN_EMAILS (capped at
       * MASTER_ADMIN_LIMIT addresses) is the only source of who may HOLD the
       * privilege, so it is re-checked at the authorization boundary on every
       * request, not only at grant time by the scripts. A SUPER_ADMIN claim
       * for an address outside the allowlist is stripped before RolesGuard
       * sees the roles: the account keeps its other roles, loses every
       * SUPER_ADMIN-only route, and nothing is written to the database.
       */
      if (roles.includes('SUPER_ADMIN') && !isMasterAdminEmail(session.user.email)) {
        roles = roles.filter((role) => role !== 'SUPER_ADMIN');
        this.logger.warn(
          `Stripped non-allowlisted SUPER_ADMIN from request authorization (userId=${payload.sub})`,
        );
      }

      const roleRowsForPermissions = Array.isArray(roleRows)
        ? roleRows.map((row) => ({
            name: row.role.name,
            permissions: row.role.permissions,
          }))
        : roles.map((name) => ({ name, permissions: [] }));
      const permissions = calculateEffectivePermissions(
        roleRowsForPermissions,
        Array.isArray(directPermissionRows) ? directPermissionRows : [],
      );
      const isMasterAdmin = roles.includes('SUPER_ADMIN') && isMasterAdminEmail(session.user.email);

      request.user = {
        id: payload.sub,
        sessionId: payload.sid,
        roles,
        permissions,
        isMasterAdmin,
        sessionKind: session.kind,
      } satisfies AuthenticatedUser;
      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
