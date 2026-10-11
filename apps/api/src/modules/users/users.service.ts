import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import { toPublicUser } from '../auth/auth.service';
import { normalizePhone } from '../../common/utils/phone';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import type { PublicUser, SessionInfo } from '@tanvion-royale/types';
import type { UpdateProfileDto } from './dto/update-profile.dto';
import type { ChangePasswordDto } from './dto/change-password.dto';
import * as argon2 from 'argon2';

/** Editable profile fields and their DB columns (audit-diffed on update). */
const EDITABLE_FIELDS = [
  'firstName',
  'lastName',
  'country',
  'timezone',
  'phone',
] as const;

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  // --------------------------------------------------------------------------
  // Profile
  // --------------------------------------------------------------------------

  async getMe(auth: AuthenticatedUser): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) throw new UnauthorizedException('User not found');
    return toPublicUser(user);
  }

  async updateProfile(
    auth: AuthenticatedUser,
    dto: UpdateProfileDto,
    ip?: string,
    userAgent?: string,
  ): Promise<PublicUser> {
    const user = await this.prisma.user.findUnique({ where: { id: auth.id } });
    if (!user) throw new UnauthorizedException('User not found');

    // Only include fields actually present so partial updates never clear data.
    const changes: Record<string, unknown> = {};
    for (const field of EDITABLE_FIELDS) {
      if (dto[field] !== undefined && dto[field] !== user[field]) {
        changes[field] = dto[field];
      }
    }

    // Phone changes go through the SAME security rule as the Verification
    // Center (master prompt Part 10): a changed number is NEVER still verified.
    // Canonical E.164 normalization (shared common/utils/phone normalizer - no
    // second format invented here), uniqueness enforced, verification flags
    // reset so the new number must pass OTP before it can ever read VERIFIED.
    let phoneVerificationReset = false;
    if (changes['phone'] !== undefined) {
      // SAME canonicalizer as signup/login/recovery: a profile edit with
      // `01712345678` and a signup with `+8801712345678` resolve to ONE row, so
      // the profile can never introduce a second representation of a number
      // that already exists (which would look like an unrelated account).
      const newPhone = normalizePhone(changes['phone']);
      const currentPhone = (user.phone ?? '').trim();
      if (newPhone === currentPhone) {
        delete changes['phone']; // formatting-only edit â€” nothing to write
      } else {
        const taken = await this.prisma.user.findUnique({ where: { phone: newPhone } });
        if (taken && taken.id !== auth.id) {
          throw new ConflictException('That phone number is already in use.');
        }
        changes['phone'] = newPhone;
        changes['phoneVerified'] = false;
        changes['phoneVerifiedAt'] = null;
        changes['phoneVerifiedDuringSignupAt'] = null;
        phoneVerificationReset = true;
      }
    }

    // Username: validated by DTO (3-32, letters/numbers/underscores), uniqueness
    // enforced here + by the DB unique constraint. Never trust client alone.
    if (dto.username !== undefined && dto.username !== user.username) {
      const taken = await this.prisma.user.findUnique({ where: { username: dto.username } });
      if (taken && taken.id !== auth.id) {
        throw new ConflictException('Username is already taken');
      }
      changes['username'] = dto.username;
    }

    if (Object.keys(changes).length === 0) {
      return toPublicUser(user);
    }

    const oldValue: Record<string, unknown> = {};
    for (const key of Object.keys(changes)) {
      oldValue[key] = user[key as keyof typeof user];
    }

    const updated = await this.prisma.user.update({
      where: { id: auth.id },
      data: changes,
    });

    // Keep the Verification Center row honest after a phone swap: back to
    // NOT_STARTED until the new number completes the OTP flow.
    if (phoneVerificationReset) {
      await this.prisma.verification.upsert({
        where: { userId_type: { userId: auth.id, type: 'PHONE' } },
        update: { status: 'NOT_STARTED', verifiedAt: null },
        create: { userId: auth.id, type: 'PHONE', status: 'NOT_STARTED' },
      });
    }

    await this.audit(auth.id, 'USER_PROFILE_UPDATED', 'User', auth.id, oldValue, changes, ip, userAgent);
    return toPublicUser(updated);
  }

  // --------------------------------------------------------------------------
  // Password
  // --------------------------------------------------------------------------

  async changePassword(
    auth: AuthenticatedUser,
    dto: ChangePasswordDto,
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: auth.id },
      select: { id: true, passwordHash: true },
    });
    if (!user) throw new UnauthorizedException('User not found');

    const valid = await argon2.verify(user.passwordHash, dto.currentPassword);
    if (!valid) {
      await this.securityEvent(auth.id, 'PASSWORD_CHANGE_FAILURE', ip, userAgent);
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await argon2.hash(dto.newPassword, { type: argon2.argon2id });

    // Change the password and revoke every OTHER session in one transaction.
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: auth.id },
        data: { passwordHash, passwordSetAt: new Date() },
      }),
      this.prisma.session.updateMany({
        where: { userId: auth.id, id: { not: auth.sessionId }, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.securityEvent(auth.id, 'PASSWORD_CHANGED', ip, userAgent);
    await this.audit(auth.id, 'USER_PASSWORD_CHANGED', 'User', auth.id, null, null, ip, userAgent);
  }

  /**
   * OAuth-only accounts (no known current password) opt into password login
   * through this authenticated flow. This is the ONLY way such an account
   * gains a password â€” it is never emailed. Since the caller must already hold
   * a valid session, no current-password check is needed; we refuse to run if a
   * password was already set (those users must use change-password instead).
   */
  async setPassword(
    auth: AuthenticatedUser,
    newPassword: string,
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: auth.id },
      select: { id: true, passwordSetAt: true },
    });
    if (!user) throw new UnauthorizedException('User not found');
    if (user.passwordSetAt !== null) {
      throw new ConflictException('A password is already set. Use change password to update it.');
    }

    const passwordHash = await argon2.hash(newPassword, { type: argon2.argon2id });
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: auth.id },
        data: { passwordHash, passwordSetAt: new Date() },
      }),
      // Hardening: revoke every OTHER session; the current OAuth session stays.
      this.prisma.session.updateMany({
        where: { userId: auth.id, id: { not: auth.sessionId }, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.securityEvent(auth.id, 'PASSWORD_CHANGED', ip, userAgent);
    await this.audit(auth.id, 'USER_PASSWORD_SET', 'User', auth.id, null, null, ip, userAgent);
  }

  // --------------------------------------------------------------------------
  // Sessions
  // --------------------------------------------------------------------------

  async listSessions(auth: AuthenticatedUser): Promise<SessionInfo[]> {
    const sessions = await this.prisma.session.findMany({
      where: { userId: auth.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });

    return sessions.map((session) => ({
      id: session.id,
      ip: session.ip,
      userAgent: session.userAgent,
      createdAt: session.createdAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      current: session.id === auth.sessionId,
    }));
  }

  async revokeSession(
    auth: AuthenticatedUser,
    sessionId: string,
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
    const session = await this.prisma.session.findUnique({ where: { id: sessionId } });
    if (!session || session.userId !== auth.id) {
      throw new NotFoundException('Session not found');
    }
    if (session.revokedAt) return; // idempotent
    if (session.id === auth.sessionId) {
      throw new ForbiddenException('Use logout to end the current session');
    }

    await this.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });

    await this.audit(auth.id, 'USER_SESSION_REVOKED', 'Session', sessionId, null, null, ip, userAgent);
  }

  // --------------------------------------------------------------------------
  // Internals
  // --------------------------------------------------------------------------

  private async audit(
    actorId: string,
    action: string,
    entityType: string,
    entityId: string,
    oldValue: Record<string, unknown> | null,
    newValue: Record<string, unknown> | null,
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId,
          actorType: 'USER',
          action,
          entityType,
          entityId,
          oldValue: oldValue === null ? Prisma.JsonNull : (oldValue as Prisma.InputJsonValue),
          newValue: newValue === null ? Prisma.JsonNull : (newValue as Prisma.InputJsonValue),
          ip,
          userAgent,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to write audit log ${action}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async securityEvent(
    userId: string,
    type: string,
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
    try {
      await this.prisma.securityEvent.create({
        data: { userId, type, ip, userAgent },
      });
    } catch (error) {
      this.logger.warn(
        `Failed to record security event ${type}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
