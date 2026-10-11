import { BadRequestException, ConflictException, Injectable, Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../../database/prisma.service';
import { OtpService } from '../auth/otp.service';
import { normalizePhone } from '../../common/utils/phone';
import { randomToken, sha256 } from '../../common/utils/crypto';
import {
  createFaceVerificationProvider,
  FaceVerificationProvider,
} from './face-verification.provider';
import { getEmailSender } from '../notifications/email-sender';

export interface VerificationStatusResponse {
  /**
   * True when the ONE-OF-TWO initial verification requirement is complete:
   * phoneVerified OR emailVerified. Face verification NEVER contributes to
   * (or blocks) this condition.
   */
  initialVerificationComplete: boolean;
  phone: {
    status: 'VERIFIED' | 'PENDING' | 'NOT_STARTED' | 'REJECTED' | 'EXPIRED';
    phone: string | null;
    verifiedAt: string | null;
    /** True when verification happened automatically during phone signup. */
    autoVerifiedDuringSignup: boolean;
  };
  email: {
    status: 'VERIFIED' | 'PENDING' | 'NOT_STARTED' | 'REJECTED' | 'EXPIRED' | 'UNAVAILABLE';
    email: string | null;
    verifiedAt: string | null;
  };
  face: {
    status: 'NOT_STARTED' | 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED';
    verifiedAt: string | null;
    provider: string;
    /** True when a real biometric provider is configured (vs. the mock/manual-review fallback). */
    configured: boolean;
  };
}

/**
 * Phase 11 — Verification Center.
 * Phone and email verification reuse the same secure OTP/token machinery as
 * authentication. Face verification is fully independent: logging in with
 * Google/Facebook or verifying a phone NEVER changes the face status.
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);
  private faceProvider: FaceVerificationProvider | null | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly otpService: OtpService,
  ) {
    // Face provider resolves lazily (see getFaceProvider) so an unconfigured
    // production environment never breaks the Verification Center; instead it
    // honestly reports configured:false and blocks face verification.,
  }
private getFaceProvider(): FaceVerificationProvider | null {
    if (this.faceProvider === undefined) {
      try {
        this.faceProvider = createFaceVerificationProvider();
      } catch {
        this.faceProvider = null;
      }
    }
    return this.faceProvider;
  }

  async getStatus(userId: string): Promise<VerificationStatusResponse> {
    const [user, phoneVerification, emailVerification, face] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId } }),
      this.prisma.verification.findUnique({
        where: { userId_type: { userId, type: 'PHONE' } },
      }),
      this.prisma.verification.findUnique({
        where: { userId_type: { userId, type: 'EMAIL' } },
      }),
      this.prisma.verification.findUnique({
        where: { userId_type: { userId, type: 'FACE' } },
      }),
    ]);
    if (!user) throw new BadRequestException('User not found');

    return {
      // ONE-OF-TWO rule: phone OR email verification completes the initial
      // requirement; face verification is independent and never blocks access.
      initialVerificationComplete: user.phoneVerified || user.emailVerified,
      phone: {
        status: user.phoneVerified
          ? 'VERIFIED'
          : phoneVerification?.status === 'PENDING'
            ? 'PENDING'
            : phoneVerification?.status === 'REJECTED'
              ? 'REJECTED'
              : phoneVerification?.status === 'EXPIRED'
                ? 'EXPIRED'
                : 'NOT_STARTED',
        phone: user.phone,
        verifiedAt: user.phoneVerifiedAt?.toISOString() ?? null,
        // Authoritative marker: true ONLY when the phone was verified through
        // the phone-signup OTP flow. Manual verification leaves
        // phoneVerifiedDuringSignupAt NULL, so this can never misclassify
        // a manually verified phone as automatic.
        autoVerifiedDuringSignup:
          user.phoneVerified && user.phoneVerifiedDuringSignupAt !== null,
      },
      email: user.email
        ? {
            status: user.emailVerified
              ? 'VERIFIED'
              : emailVerification?.status === 'PENDING'
                ? 'PENDING'
                : emailVerification?.status === 'REJECTED'
                  ? 'REJECTED'
                  : emailVerification?.status === 'EXPIRED'
                    ? 'EXPIRED'
                    : 'NOT_STARTED',
            email: user.email,
            verifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
          }
        : { status: 'UNAVAILABLE', email: null, verifiedAt: null },
      face: {
        status: face?.status ?? 'NOT_STARTED',
        verifiedAt: face?.verifiedAt?.toISOString() ?? null,
        provider: this.getFaceProvider()?.name ?? 'unconfigured',
        configured: this.getFaceProvider()?.configured ?? false,
      },
    };
  }

  // ---------------- Phone verification ----------------

  /**
   * Sends the verification OTP to the user's phone (or sets a new one).
   *
   * CHANGE FLOW (master prompt Part 10): when a DIFFERENT number is supplied,
   * the previous verification NEVER carries over. The new number is stored
   * UNVERIFIED (flags + Verification row reset), every code bound to the
   * previous number is burned, the change is audited, and only then is a fresh
   * OTP issued to the new number — so a phone becomes VERIFIED exclusively
   * through successful OTP verification of that exact number.
   */
  async sendPhoneVerification(userId: string, phone?: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');

    let target = user.phone;
    let phoneChanged = false;
    if (phone) {
      // Same canonical normalizer as signup/login/recovery — the Verification
      // Center must not be able to store a second representation of a number
      // that is already registered under its E.164 form.
      const normalized = normalizePhone(phone);
      if (normalized !== user.phone) {
        const clash = await this.prisma.user.findUnique({ where: { phone: normalized } });
        if (clash && clash.id !== userId) {
          throw new ConflictException('Phone already registered');
        }
        await this.prisma.user.update({
          where: { id: userId },
          data: {
            phone: normalized,
            // A changed phone is NEVER still verified (Part 10) — the OTP to
            // the new number is the only path back to VERIFIED.
            phoneVerified: false,
            phoneVerifiedAt: null,
            phoneVerifiedDuringSignupAt: null,
          },
        });
        await this.prisma.verification.upsert({
          where: { userId_type: { userId, type: 'PHONE' } },
          update: { status: 'NOT_STARTED', verifiedAt: null },
          create: { userId, type: 'PHONE', status: 'NOT_STARTED' },
        });
        // Burn every outstanding code bound to the previous number so a stale
        // OTP can never be replayed against the account (they are keyed by
        // identifier anyway, this keeps the stored state honest).
        if (user.phone) {
          await this.prisma.otpCode.updateMany({
            where: { identifier: user.phone, consumedAt: null },
            data: { consumedAt: new Date() },
          });
        }
        await this.safeAudit(userId, 'USER_PHONE_CHANGED', { before: user.phone, after: normalized });
        target = normalized;
        phoneChanged = true;
      }
    }
    if (!target) throw new BadRequestException('Add a phone number first');
    // Unchanged + already verified → nothing to send. (A changed phone is
    // reset above, so it falls through and receives its first OTP.)
    if (!phoneChanged && user.phoneVerified) throw new ConflictException('Phone already verified');

    await this.otpService.issue(target, 'PHONE_VERIFY', 'sms');
    await this.prisma.verification.upsert({
      where: { userId_type: { userId, type: 'PHONE' } },
      update: { status: 'PENDING', verifiedAt: null },
      create: { userId, type: 'PHONE', status: 'PENDING' },
    });
    return { message: 'If the phone number is valid, a verification code has been sent.' };
  }

  async verifyPhone(userId: string, code: string): Promise<VerificationStatusResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.phone) throw new BadRequestException('Add a phone number first');
    if (user.phoneVerified) throw new ConflictException('Phone already verified');

    await this.otpService.verify(user.phone, 'PHONE_VERIFY', code);
    await this.prisma.user.update({
      where: { id: userId },
      data: { phoneVerified: true, phoneVerifiedAt: new Date() },
    });
    await this.prisma.verification.upsert({
      where: { userId_type: { userId, type: 'PHONE' } },
      update: { status: 'VERIFIED', verifiedAt: new Date() },
      create: { userId, type: 'PHONE', status: 'VERIFIED', verifiedAt: new Date() },
    });
    await this.safeAudit(userId, 'USER_PHONE_VERIFIED', {});
    return this.getStatus(userId);
  }

  // ---------------- Phone removal (Settings Account & Security) ----------------

  /**
   * Removes the phone number from the account — ONLY when another viable
   * sign-in/recovery path remains (master prompt Part 11): a stored email
   * address (email+password login and the email forgot-password flow) or a
   * linked Google/Facebook identity. An account can never end up with no way
   * to sign in or recover.
   *
   * Password confirmation is mandatory (phone is a login credential): OAuth
   * accounts without a password must set one first via the existing
   * set-password flow, which the error message points to.
   */
  async removePhone(
    userId: string,
    currentPassword: string,
    ip?: string,
    userAgent?: string,
  ): Promise<VerificationStatusResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (!user.phone) throw new BadRequestException('No phone number to remove.');
    await this.confirmPassword(user, currentPassword);

    const identities = await this.prisma.authIdentity.findMany({
      where: { userId },
      select: { provider: true },
    });
    const hasOAuth =
      identities.some((i) => i.provider === 'GOOGLE' || i.provider === 'FACEBOOK');
    if (!user.email && !hasOAuth) {
      throw new ConflictException(
        'Removing your phone number would leave this account with no sign-in or recovery method. ' +
          'Add an email address (or link Google/Facebook) first.',
      );
    }

    const previousPhone = user.phone;
    // Burn every outstanding code bound to the number being removed.
    await this.prisma.otpCode.updateMany({
      where: { identifier: previousPhone, consumedAt: null },
      data: { consumedAt: new Date() },
    });
    // The PHONE login identity (phone-signup accounts) must not dangle.
    await this.prisma.authIdentity.deleteMany({ where: { userId, provider: 'PHONE' } });

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        phone: null,
        phoneVerified: false,
        phoneVerifiedAt: null,
        phoneVerifiedDuringSignupAt: null,
      },
    });
    await this.prisma.verification.upsert({
      where: { userId_type: { userId, type: 'PHONE' } },
      update: { status: 'NOT_STARTED', verifiedAt: null },
      create: { userId, type: 'PHONE', status: 'NOT_STARTED' },
    });
    await this.safeAudit(userId, 'USER_PHONE_REMOVED', { before: previousPhone }, ip, userAgent);
    return this.getStatus(userId);
  }

  // ---------------- Email verification ----------------

  /** Sends a one-time, expiring email verification token. */
  async sendEmailVerification(userId: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (!user.email) throw new BadRequestException('Add an email address first');
    if (user.emailVerified) throw new ConflictException('Email already verified');

    // Resend cooldown via the latest EMAIL_VERIFICATION token.
    const latest = await this.prisma.authToken.findFirst({
      where: { userId, type: 'EMAIL_VERIFICATION', usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (latest && Date.now() - latest.createdAt.getTime() < 60 * 1000) {
      throw new ConflictException('Please wait before requesting another email');
    }

    const token = randomToken(32);
    const record = await this.prisma.authToken.create({
      data: {
        userId,
        type: 'EMAIL_VERIFICATION',
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });

    // Deliver through the configured EmailSender. In production an
    // unconfigured provider fails safely (ServiceUnavailableException) and
    // the token is burned — verification can never succeed for an email
    // that was never actually sent. Outside production the dev-log sender
    // logs the token (same convention as the existing flows).
    try {
      await getEmailSender().send({
        to: user.email,
        subject: 'Verify your email address',
        body: `Your verification link: ${process.env.APP_URL ?? ''}/verify-email?token=${token}`,
      });
      await this.prisma.verification.upsert({
        where: { userId_type: { userId, type: 'EMAIL' } },
        update: { status: 'PENDING', verifiedAt: null },
        create: { userId, type: 'EMAIL', status: 'PENDING' },
      });
    } catch (error) {
      await this.prisma.authToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
      if (error instanceof ServiceUnavailableException) throw error;
      this.logger.error(
        `Email delivery failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException('Message delivery is not configured');
    }
    return { message: 'If the email address is valid, a verification link has been sent.' };
  }

  async verifyEmail(token: string): Promise<VerificationStatusResponse> {
    const record = await this.prisma.authToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (
      !record ||
      record.type !== 'EMAIL_VERIFICATION' ||
      record.usedAt ||
      record.expiresAt < new Date()
    ) {
      throw new BadRequestException('Invalid or expired token');
    }
    await this.prisma.authToken.update({
      where: { id: record.id },
      data: { usedAt: new Date() },
    });
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { emailVerified: true, emailVerifiedAt: new Date() },
    });
    await this.prisma.verification.upsert({
      where: { userId_type: { userId: record.userId, type: 'EMAIL' } },
      update: { status: 'VERIFIED', verifiedAt: new Date() },
      create: { userId: record.userId, type: 'EMAIL', status: 'VERIFIED', verifiedAt: new Date() },
    });
    await this.safeAudit(record.userId, 'USER_EMAIL_VERIFIED', {});
    return this.getStatus(record.userId);
  }

  // ---------------- Email OTP verification (verification page) ----------------

  /**
   * Sends a 6-digit OTP to the account's email address through the secure
   * OtpService (purpose EMAIL_VERIFY, channel email). This is the ONE-TIME
   * CODE flow used by the verification page and is intentionally independent
   * of the legacy emailed verification LINK above (different token type /
   * purpose, so neither can consume or invalidate the other).
   */
  async sendEmailOtp(userId: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (!user.email) throw new BadRequestException('Add an email address first');
    if (user.emailVerified) throw new ConflictException('Email already verified');

    await this.otpService.issue(user.email, 'EMAIL_VERIFY', 'email');
    await this.prisma.verification.upsert({
      where: { userId_type: { userId, type: 'EMAIL' } },
      update: { status: 'PENDING', verifiedAt: null },
      create: { userId, type: 'EMAIL', status: 'PENDING' },
    });
    return { message: 'If the email address is valid, a verification code has been sent.' };
  }

  async verifyEmailOtp(userId: string, code: string): Promise<VerificationStatusResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (!user.email) throw new BadRequestException('Add an email address first');
    if (user.emailVerified) throw new ConflictException('Email already verified');

    // Purpose-scoped: an EMAIL_VERIFY code can never satisfy a phone flow and
    // vice versa (the hash binds purpose + identifier + code).
    await this.otpService.verify(user.email, 'EMAIL_VERIFY', code);
    await this.prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true, emailVerifiedAt: new Date() },
    });
    await this.prisma.verification.upsert({
      where: { userId_type: { userId, type: 'EMAIL' } },
      update: { status: 'VERIFIED', verifiedAt: new Date() },
      create: { userId, type: 'EMAIL', status: 'VERIFIED', verifiedAt: new Date() },
    });
    await this.safeAudit(userId, 'USER_EMAIL_VERIFIED', {});
    return this.getStatus(userId);
  }

  // ---------------- Email management (Settings Account & Security) ----------------

  /**
   * Adds the FIRST email address or CHANGES the existing one (master prompt
   * Parts 5/6). The address is stored UNVERIFIED — this endpoint never marks
   * anything VERIFIED; only the existing emailed-link / OTP verification flows
   * can do that. Normalization matches registration (trim + lower-case),
   * uniqueness is enforced, and every credential outstanding for the OLD
   * address is burned so a stale link can never verify the new one.
   *
   * Security-sensitive: requires the account password (Parts 6/11) so a stolen
   * session alone can never swap the recovery address. Accounts without a
   * password (OAuth-only) must set one first via the existing set-password flow.
   */
  async setEmail(
    userId: string,
    email: string,
    currentPassword: string,
    ip?: string,
    userAgent?: string,
  ): Promise<VerificationStatusResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    await this.confirmPassword(user, currentPassword);

    const normalized = (email ?? '').trim().toLowerCase();
    // Mirrors the DTO's @IsEmail so direct service callers are validated too.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) {
      throw new BadRequestException('Enter a valid email address');
    }
    const isChange = user.email !== null;
    const previousEmail = user.email;
    if (normalized === user.email) {
      throw new BadRequestException('This is already your email address.');
    }
    const clash = await this.prisma.user.findUnique({ where: { email: normalized } });
    if (clash && clash.id !== userId) {
      throw new ConflictException('An account with this email already exists.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { email: normalized, emailVerified: false, emailVerifiedAt: null },
    });
    // The Verification row must never keep a stale VERIFIED state for a
    // different address (Part 6: changing email does not auto-verify).
    await this.prisma.verification.upsert({
      where: { userId_type: { userId, type: 'EMAIL' } },
      update: { status: 'NOT_STARTED', verifiedAt: null },
      create: { userId, type: 'EMAIL', status: 'NOT_STARTED' },
    });
    // Snapshot taken BEFORE the write: the OLD address's credentials die even
    // if the underlying row has already moved on.
    await this.burnEmailCredentials(userId, previousEmail);
    await this.safeAudit(
      userId,
      isChange ? 'USER_EMAIL_CHANGED' : 'USER_EMAIL_ADDED',
      { before: previousEmail, after: normalized },
      ip,
      userAgent,
    );
    return this.getStatus(userId);
  }

  /**
   * Removes the email address — ONLY when another viable sign-in/recovery path
   * remains (master prompt Part 7): a stored phone number (phone+password login
   * and phone-recovery OTP) or a linked Google/Facebook identity. If the email
   * is the last way in, the removal is refused with a clear explanation and the
   * Settings UI disables the action the same way (the server is the authority).
   */
  async removeEmail(
    userId: string,
    currentPassword: string,
    ip?: string,
    userAgent?: string,
  ): Promise<VerificationStatusResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new BadRequestException('User not found');
    if (!user.email) throw new BadRequestException('No email address to remove.');
    await this.confirmPassword(user, currentPassword);

    const identities = await this.prisma.authIdentity.findMany({
      where: { userId },
      select: { provider: true },
    });
    const hasOAuth = identities.some(
      (i) => i.provider === 'GOOGLE' || i.provider === 'FACEBOOK',
    );
    if (!user.phone && !hasOAuth) {
      throw new ConflictException(
        'Removing your email would leave this account with no sign-in or recovery method. ' +
          'Add and verify a phone number (or link Google/Facebook) first.',
      );
    }

    const previousEmail = user.email;
    await this.burnEmailCredentials(userId, previousEmail);
    await this.prisma.user.update({
      where: { id: userId },
      data: { email: null, emailVerified: false, emailVerifiedAt: null },
    });
    await this.prisma.verification.upsert({
      where: { userId_type: { userId, type: 'EMAIL' } },
      update: { status: 'NOT_STARTED', verifiedAt: null },
      create: { userId, type: 'EMAIL', status: 'NOT_STARTED' },
    });
    await this.safeAudit(userId, 'USER_EMAIL_REMOVED', { before: previousEmail }, ip, userAgent);
    return this.getStatus(userId);
  }

  // ---------------- Face verification ----------------

  /**
   * Starts an independent face verification case. The result is PENDING
   * (manual review) with the mock provider — face verification is NEVER
   * granted automatically from social login or phone verification.
   */
  async startFaceVerification(userId: string): Promise<VerificationStatusResponse> {
    const face = await this.prisma.verification.findUnique({
      where: { userId_type: { userId, type: 'FACE' } },
    });
    if (face?.status === 'VERIFIED') throw new ConflictException('Face already verified');
    if (face?.status === 'PENDING') throw new ConflictException('Verification pending');

    const provider = this.getFaceProvider();
    if (!provider) {
      throw new ServiceUnavailableException('Face verification is not configured');
    }
    const started = await provider.startCase(userId);
    await this.prisma.verification.upsert({
      where: { userId_type: { userId, type: 'FACE' } },
      update: { status: started.decision, providerRef: started.reference },
      create: { userId, type: 'FACE', status: started.decision, providerRef: started.reference },
    });
    return this.getStatus(userId);
  }

  // ---------------- Login methods (account linking) ----------------

  async getLoginMethods(userId: string) {
    const identities = await this.prisma.authIdentity.findMany({
      where: { userId },
      select: { provider: true, providerAccountId: true, createdAt: true },
    });
    return {
      phone: identities.filter((i) => i.provider === 'PHONE').map((i) => i.providerAccountId),
      google: identities.filter((i) => i.provider === 'GOOGLE').length > 0,
      facebook: identities.filter((i) => i.provider === 'FACEBOOK').length > 0,
    };
  }

  async disconnectMethod(userId: string, provider: 'PHONE' | 'GOOGLE' | 'FACEBOOK') {
    const count = await this.prisma.authIdentity.count({ where: { userId } });
    if (count <= 1) {
      throw new ConflictException(
        'You need at least one other login method before disconnecting this one',
      );
    }
    await this.prisma.authIdentity.deleteMany({ where: { userId, provider } });
    return this.getLoginMethods(userId);
  }

  // ---------------- Shared security helpers ----------------

  /**
   * Password confirmation for security-sensitive identifier changes. Refuses
   * accounts with no functioning password (OAuth-only) with guidance to the
   * existing set-password flow — never a passwordless bypass. The password
   * itself is never logged or echoed anywhere.
   */
  private async confirmPassword(
    user: { passwordHash: string; passwordSetAt: Date | null },
    currentPassword: string,
  ): Promise<void> {
    if (!user.passwordSetAt) {
      throw new BadRequestException(
        'Set a password first (Profile -> Set password), then retry — changing sign-in details always requires password confirmation.',
      );
    }
    const valid = await argon2
      .verify(user.passwordHash, currentPassword)
      .catch(() => false);
    if (!valid) throw new UnauthorizedException('Current password is incorrect');
  }

  /**
   * Burns every outstanding credential bound to the CURRENT email address when
   * that address is about to change or disappear: emailed verification links
   * (AuthToken rows are keyed by user, not address, so a link sent to the OLD
   * address must die), password-reset links sent to it, and email OTP codes.
   * Best-effort: a failure here never blocks the identifier change itself —
   * every verification flow also re-checks against the CURRENT stored address.
   */
  private async burnEmailCredentials(
    userId: string,
    previousEmail: string | null,
  ): Promise<void> {
    try {
      await this.prisma.authToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (previousEmail) {
        await this.prisma.otpCode.updateMany({
          where: { identifier: previousEmail, consumedAt: null },
          data: { consumedAt: new Date() },
        });
      }
    } catch (error) {
      this.logger.warn(
        `Failed to burn outstanding email credentials: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Best-effort audit write — never breaks the operation itself. */
  private async safeAudit(
    actorId: string,
    action: string,
    metadata: Record<string, unknown>,
    ip?: string,
    userAgent?: string,
  ): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorId,
          actorType: 'USER',
          action,
          entityType: 'User',
          entityId: actorId,
          // Identifiers (email/phone) are the audited subject — never
          // passwords, never OTP codes, never tokens.
          newValue: metadata as Prisma.InputJsonValue,
          ip,
          userAgent,
        },
      });
    } catch {
      // Best-effort audit — never break the user-facing operation.
    }
  }
}
