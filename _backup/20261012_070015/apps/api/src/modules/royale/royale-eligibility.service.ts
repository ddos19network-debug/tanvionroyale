import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  loadRoyaleConfig,
  type RoyaleConfig,
} from './royale.config';
import { royaleError } from './royale.errors';
import {
  ResponsibleGamblingService,
} from '../responsible-gambling/responsible-gambling.service';

/**
 * TANVION ROYALE — REAL_MONEY eligibility gate (Task 1 / audit F1, F2, F4).
 *
 * A SINGLE shared gate that both Royale games run BEFORE any wallet
 * reservation, and ONLY when the mode is REAL_MONEY. FREE_PLAY never calls it
 * (free players are never asked for KYC, age or limits).
 *
 * Every check FAILS CLOSED — unknown / missing / malformed data is rejected:
 *   1. account status must be ACTIVE              -> ROYALE_ACCOUNT_NOT_ACTIVE
 *   2. kycStatus must be VERIFIED                -> ROYALE_KYC_REQUIRED
 *   3. dateOfBirth present, valid and >= minAge   -> ROYALE_AGE_RESTRICTED
 *      (minAge defaults to 18 and can never be configured below 18)
 *   4. not self-excluded / cooling-off in force   -> ROYALE_SELF_EXCLUDED
 *   5. within all active play limits              -> ROYALE_LIMIT_EXCEEDED
 * (4 + 5 are delegated to ResponsibleGamblingService.assertCanStake.)
 *
 * All rejections are HTTP 403 with a stable `code` in the body so clients and
 * tests can branch on the exact reason. Because this runs before the
 * reservation transaction is even opened, a rejected request creates NO round,
 * NO ledger entry and NO wallet reservation.
 */
@Injectable()
export class RoyaleEligibilityService {
  private readonly config: RoyaleConfig = loadRoyaleConfig();
  private readonly rg: ResponsibleGamblingService;

  /**
   * `rg` is optional only so the games can construct a default instance in
   * unit tests; in production Nest injects the shared ResponsibleGamblingService.
   */
  constructor(
    private readonly prisma: PrismaService,
    rg?: ResponsibleGamblingService,
  ) {
    this.rg = rg ?? new ResponsibleGamblingService(prisma);
  }

  /**
   * Assert that `userId` may place a REAL_MONEY stake of `amount` `currency`.
   * Throws a structured 403 on the first failed check. Never returns a boolean
   * the caller could ignore — rejection IS the return path.
   */
  async assertEligibleForRealMoney(
    userId: string,
    amount: number,
    currency: string,
  ): Promise<void> {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, kycStatus: true, dateOfBirth: true },
    });

    // 1. Account lifecycle — unknown user fails closed.
    if (!dbUser || dbUser.status !== 'ACTIVE') {
      royaleError(
        'ROYALE_ACCOUNT_NOT_ACTIVE',
        'Your account is not active and cannot place real-money bets',
        403,
      );
    }

    // 2. KYC — identity verification is mandatory for real money.
    if (dbUser.kycStatus !== 'VERIFIED') {
      royaleError(
        'ROYALE_KYC_REQUIRED',
        'Identity verification (KYC) is required before playing for real money',
        403,
      );
    }

    // 3. Age — missing / invalid / under-age date of birth fails closed.
    const dob = dbUser.dateOfBirth;
    const age = dob instanceof Date ? this.ageInUtc(dob, new Date()) : Number.NaN;
    if (!Number.isFinite(age)) {
      royaleError(
        'ROYALE_AGE_RESTRICTED',
        'A valid date of birth is required to play for real money',
        403,
      );
    }
    if (age < this.config.minAge) {
      royaleError(
        'ROYALE_AGE_RESTRICTED',
        `You must be at least ${this.config.minAge} years old to play for real money`,
        403,
        { minAge: this.config.minAge, age },
      );
    }

    // 4 + 5. Self-exclusion + play limits (responsible gambling).
    await this.rg.assertCanStake(userId, amount, currency);
  }

  /**
   * Whole-year age difference computed entirely in UTC so a player near a
   * birthday can never be off by a day depending on the server's local zone.
   * Returns NaN when the date is invalid or in the future.
   */
  private ageInUtc(dob: Date, now: Date): number {
    if (Number.isNaN(dob.getTime())) return Number.NaN;
    if (dob.getTime() > now.getTime()) return Number.NaN; // future DOB is invalid
    let age = now.getUTCFullYear() - dob.getUTCFullYear();
    const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) {
      age -= 1;
    }
    return age;
  }
}
