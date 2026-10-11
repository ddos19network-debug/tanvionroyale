import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const REFERRAL_BONUS_TYPES = ['FIXED_AMOUNT', 'PERCENTAGE'] as const;
export const REFERRAL_QUALIFICATION_RULES = [
  'REGISTRATION',
  'VERIFIED_ACCOUNT',
  'MIN_DEPOSIT',
  'MIN_WAGER',
  'DEPOSIT_AND_WAGER',
] as const;
export const REFERRAL_REWARD_STATUSES = [
  'PENDING',
  'QUALIFIED',
  'PAID',
  'REJECTED',
  'CANCELLED',
] as const;

export type ReferralBonusTypeParam = (typeof REFERRAL_BONUS_TYPES)[number];
export type ReferralQualificationRuleParam =
  (typeof REFERRAL_QUALIFICATION_RULES)[number];

/**
 * Admin configuration of the referral program.
 *
 * EVERY value is optional so an admin can change one setting without resending
 * the rest, and EVERY value is validated server-side. Nothing about a reward is
 * hard-coded in the service or in the UI.
 *
 * Amounts are integer MINOR UNITS (e.g. 25000 = 250.00 BDT), so a bonus can
 * never carry a rounding error.
 */
export class UpdateReferralSettingsDto {
  @ApiPropertyOptional({ description: 'Master switch for the whole program' })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isEnabled?: boolean;

  @ApiPropertyOptional({ example: 'BDT' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @ApiPropertyOptional({ example: '/register', description: 'Signup path a code is appended to' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  signupPath?: string;

  @ApiPropertyOptional({ enum: REFERRAL_BONUS_TYPES })
  @IsOptional()
  @IsIn(REFERRAL_BONUS_TYPES)
  referrerBonusType?: ReferralBonusTypeParam;

  @ApiPropertyOptional({ example: 25000, description: 'Minor units, FIXED_AMOUNT only' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  referrerBonusAmount?: number;

  @ApiPropertyOptional({ example: 5, minimum: 0, maximum: 100, description: 'Percent, PERCENTAGE only' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  referrerBonusPercent?: number;

  @ApiPropertyOptional({ enum: REFERRAL_BONUS_TYPES })
  @IsOptional()
  @IsIn(REFERRAL_BONUS_TYPES)
  referredBonusType?: ReferralBonusTypeParam;

  @ApiPropertyOptional({ example: 10000, description: 'Minor units, FIXED_AMOUNT only' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  referredBonusAmount?: number;

  @ApiPropertyOptional({ example: 2, minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  referredBonusPercent?: number;

  @ApiPropertyOptional({ enum: REFERRAL_QUALIFICATION_RULES })
  @IsOptional()
  @IsIn(REFERRAL_QUALIFICATION_RULES)
  qualificationRule?: ReferralQualificationRuleParam;

  @ApiPropertyOptional({ example: 50000, description: 'Minimum qualifying deposit (minor units)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minDepositAmount?: number;

  @ApiPropertyOptional({ example: 100000, description: 'Minimum qualifying wager (minor units)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minWagerAmount?: number;

  @ApiPropertyOptional({ example: 50000, description: 'Cap per referral; 0 = uncapped' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxRewardPerReferral?: number;

  @ApiPropertyOptional({ description: 'Lifetime cap per beneficiary; omit for uncapped' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxTotalRewardPerUser?: number | null;

  @ApiPropertyOptional({ example: 30, description: 'Days a referral may qualify; omit = never expires' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  qualificationExpiresInDays?: number | null;

  @ApiPropertyOptional({ description: 'Additionally require a verified email/phone' })
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  requireVerifiedAccount?: boolean;
}

/** Admin search over referrers (username OR user id OR referral code). */
export class SearchReferrersDto {
  @ApiProperty({ example: 'tanveer123' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  search!: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

/** Admin search over the reward ledger. */
export class SearchReferralRewardsDto {
  @ApiPropertyOptional({ example: 'tanveer123' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  search?: string;

  @ApiPropertyOptional({ enum: REFERRAL_REWARD_STATUSES })
  @IsOptional()
  @IsIn(REFERRAL_REWARD_STATUSES)
  status?: (typeof REFERRAL_REWARD_STATUSES)[number];

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}

/** A manual, audited correction of one referral reward. */
export class AdjustReferralRewardDto {
  @ApiProperty({
    example: 5000,
    description: 'Signed delta in minor units. Negative claws back an over-payment.',
  })
  @Type(() => Number)
  @IsInt()
  @Min(-100_000_000)
  @Max(100_000_000)
  amount!: number;

  @ApiProperty({
    example: 'Corrected a duplicate referral bonus (ticket #4821)',
    minLength: 5,
    maxLength: 500,
  })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

/** Reject or cancel a referral relationship (audited, never deleted). */
export class ReferralStatusDto {
  @ApiProperty({ enum: ['REJECTED', 'CANCELLED'] })
  @IsIn(['REJECTED', 'CANCELLED'])
  status!: 'REJECTED' | 'CANCELLED';

  @ApiProperty({ example: 'Confirmed self-referral ring', minLength: 5, maxLength: 500 })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}

/** Pagination for the caller's own referral lists. */
export class ReferralListQueryDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
