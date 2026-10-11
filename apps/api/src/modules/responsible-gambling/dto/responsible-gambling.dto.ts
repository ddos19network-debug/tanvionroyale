import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Responsible-gambling DTOs (Task 2 / audit F3). Players may only ever send a
 * limit amount, a period/kind, an exclusion type and a reason. They can LOWER
 * limits or self-exclude; the SERVICE is what enforces that a RAISE or an
 * exclusion END only lands after the cooling-off delay.
 */

export class SetLimitDto {
  @IsIn(['DEPOSIT', 'LOSS', 'STAKE_PER_BET'])
  kind!: 'DEPOSIT' | 'LOSS' | 'STAKE_PER_BET';

  @IsIn(['DAILY', 'WEEKLY', 'MONTHLY'])
  period!: 'DAILY' | 'WEEKLY' | 'MONTHLY';

  /** Limit in minor units (never negative — 0 means "block completely"). */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  amount!: number;

  /** ISO 4217 currency the limit applies to (e.g. BDT). */
  @IsString()
  @Length(3, 3)
  currency!: string;
}

export class SelfExcludeDto {
  @IsIn(['COOLING_OFF', 'TEMPORARY', 'PERMANENT'])
  type!: 'COOLING_OFF' | 'TEMPORARY' | 'PERMANENT';

  /** Optional duration for COOLING_OFF / TEMPORARY (hours). Ignored for PERMANENT. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(87_600)
  durationHours?: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class AdminExclusionActionDto {
  @IsString()
  @MaxLength(64)
  exclusionId!: string;
}
