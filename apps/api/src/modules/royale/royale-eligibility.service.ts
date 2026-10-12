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
import {
  MASTER_SWITCH_KEY,
  JurisdictionService,
  gameSwitchKey,
} from '../jurisdiction/jurisdiction.service';
import {
  currentTrustedGeoCountry,
  normalizeCountryCode,
} from '../../common/geo/trusted-geo';

/** The Royale REAL_MONEY games that carry their own kill switch. */
export type RoyaleGameSlug = 'plinko' | 'mines' | 'royale-ace';

/**
 * TANVION ROYALE — REAL_MONEY eligibility gate (Task 1 / audit F1, F2, F4)
 * + PART A central jurisdiction & currency control.
 *
 * A SINGLE shared gate that all three Royale games (Plinko, Mines, Ace) run
 * BEFORE any wallet reservation, and ONLY when the mode is REAL_MONEY.
 * FREE_PLAY never calls it (free players are never asked for KYC, age,
 * limits, jurisdiction or switches).
 *
 * The checks run in this exact order and every one of them FAILS CLOSED —
 * unknown / missing / malformed data is rejected:
 *   1. master switch          -> config.enabled + GlobalGameSwitch
 *                                REAL_MONEY_ALL              -> ROYALE_MASTER_SWITCH_OFF
 *   2. game switch            -> GlobalGameSwitch GAME:<slug> -> ROYALE_GAME_SWITCH_OFF
 *   3. jurisdiction + currency-> JurisdictionService.resolve  -> ROYALE_JURISDICTION_BLOCKED
 *      (country comes from SERVER-side sources ONLY: the trusted edge geo
 *       header and the KYC country; a mismatch or an unknown country blocks)
 *   4. KYC VERIFIED + date of birth >= minAge -> ROYALE_KYC_REQUIRED /
 *                                ROYALE_AGE_RESTRICTED (minAge never < 18)
 *   5. responsible gambling   -> ROYALE_SELF_EXCLUDED / ROYALE_LIMIT_EXCEEDED
 *   6. account status ACTIVE  -> ROYALE_ACCOUNT_NOT_ACTIVE
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
  private readonly jurisdiction: JurisdictionService;

  /**
   * `rg` is optional only so the games can construct a default instance in
   * unit tests; in production Nest injects the shared ResponsibleGamblingService.
   * `jurisdiction` follows the same pattern: Nest injects it in production and
   * the unit tests pass one explicitly (the in-memory Prisma double backs it).
   */
  constructor(
    private readonly prisma: PrismaService,
    rg?: ResponsibleGamblingService,
    jurisdiction?: JurisdictionService,
  ) {
    this.rg = rg ?? new ResponsibleGamblingService(prisma);
    this.jurisdiction = jurisdiction ?? new JurisdictionService(prisma);
  }

  /**
   * Assert that `userId` may place a REAL_MONEY stake of `amount` `currency`
   * for `gameSlug`, running the FULL gate in the documented order:
   *   master switch -> game switch -> jurisdiction + currency -> KYC 18+ ->
   *   responsible gambling -> account status.
   * Throws a structured 403 on the first failed check. Never returns a boolean
   * the caller could ignore — rejection IS the return path.
   */
  async assertEligibleForRealMoney(
    userId: string,
    amount: number,
    currency: string,
    gameSlug: RoyaleGameSlug = 'plinko',
  ): Promise<void> {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { status: true, kycStatus: true, dateOfBirth: true, country: true },
    });

    // 0. No account row at all: there is nothing to check — fail closed.
    if (!dbUser) {
      royaleError(
        'ROYALE_ACCOUNT_NOT_ACTIVE',
        'Your account is not active and cannot place real-money bets',
        403,
      );
    }

    // 1. MASTER switch — RoyaleConfig.enabled + GlobalGameSwitch REAL_MONEY_ALL.
    if (!this.config.enabled) {
      royaleError('ROYALE_MASTER_SWITCH_OFF', 'Real-money play is temporarily disabled', 403);
    }
    const master = await this.jurisdiction.switchState(MASTER_SWITCH_KEY);
    if (!master.enabled) {
      royaleError('ROYALE_MASTER_SWITCH_OFF', master.reason, 403, { key: MASTER_SWITCH_KEY });
    }

    // 2. GAME switch — GlobalGameSwitch GAME:<slug> (plinko/mines/royale-ace).
    const gameKey = gameSwitchKey(gameSlug);
    const gameSwitch = await this.jurisdiction.switchState(gameKey);
    if (!gameSwitch.enabled) {
      royaleError('ROYALE_GAME_SWITCH_OFF', gameSwitch.reason, 403, { key: gameKey });
    }

    // 3. Jurisdiction + currency — country from SERVER-side sources ONLY.
    await this.assertJurisdictionAllowed(dbUser.country, currency);

    // 4a. KYC — identity verification is mandatory for real money.
    if (dbUser.kycStatus !== 'VERIFIED') {
      royaleError(
        'ROYALE_KYC_REQUIRED',
        'Identity verification (KYC) is required before playing for real money',
        403,
      );
    }

    // 4b. Age — missing / invalid / under-age date of birth fails closed.
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

    // 5. Self-exclusion + play limits (responsible gambling).
    await this.rg.assertCanStake(userId, amount, currency);

    // 6. Account lifecycle status.
    if (dbUser.status !== 'ACTIVE') {
      royaleError(
        'ROYALE_ACCOUNT_NOT_ACTIVE',
        'Your account is not active and cannot place real-money bets',
        403,
      );
    }
  }

  /**
   * Resolve the player's country from SERVER-side sources only, cross-check
   * them, then apply the central jurisdiction + currency rule.
   *
   *   * the trusted edge geo header AND the KYC country are both known and
   *     DIFFER -> BLOCKED (a spoofed header, travel or a mule account);
   *   * neither is known -> BLOCKED (unknown country);
   *   * otherwise the single known value is used.
   *
   * The browser can never influence this: the header is captured by
   * TrustedGeoMiddleware and the KYC country is server-stored.
   */
  private async assertJurisdictionAllowed(
    kycCountry: string | null,
    currency: string,
  ): Promise<void> {
    const geo = currentTrustedGeoCountry();
    const kyc = normalizeCountryCode(kycCountry);

    if (geo && kyc && geo !== kyc) {
      royaleError(
        'ROYALE_JURISDICTION_BLOCKED',
        'Your verified country does not match the region you are playing from',
        403,
        { geoCountry: geo, kycCountry: kyc },
      );
    }

    const country = geo ?? kyc;
    if (!country) {
      royaleError(
        'ROYALE_JURISDICTION_BLOCKED',
        'Your country could not be verified for real-money play',
        403,
      );
    }

    const verdict = await this.jurisdiction.resolve(country, currency);
    if (!verdict.allowed) {
      royaleError('ROYALE_JURISDICTION_BLOCKED', verdict.reason, 403, {
        country: verdict.countryCode,
        currency: verdict.currency,
        rule: verdict.code,
      });
    }
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
