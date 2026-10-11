import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ArrayNotEmpty,
  ArrayMaxSize,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class PlaceCrashBetDto {
  /** Stake in minor units (REAL_MONEY) or free-play points (FREE_PLAY). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  stake!: number;

  /**
   * Client-generated idempotency key (UUID). The same request retried with the
   * same key can never create two bets (unique (userId, idempotencyKey)).
   */
  @IsOptional()
  @IsUUID()
  clientRequestId?: string;
}

export class CashOutCrashBetDto {
  /** Optional client request id for idempotent cash-out retries. */
  @IsOptional()
  @IsUUID()
  clientRequestId?: string;
}

export class CrashHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class CrashMyHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  /** Filter by game mode; defaults to the server's configured mode. */
  @IsOptional()
  @IsString()
  @MaxLength(16)
  @Matches(/^(FREE_PLAY|REAL_MONEY)$/)
  mode?: 'FREE_PLAY' | 'REAL_MONEY';
}

export class CrashRoundVerifyQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  roundNumber!: number;
}

/**
 * Admin crash-sequence configuration. Every rule is re-validated server-side
 * (crash-sequence-core): multiplier > 1.00, ≤ 10000, ≤ 2 decimal places,
 * list size ≤ 1000. Only ADMIN / SUPER_ADMIN reach this controller.
 */
export class SetCrashPointsDto {
  /** Crash multipliers in play order, e.g. [1.20, 1.45, 2.10, 3.50]. */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(1_000)
  @IsNumber({}, { each: true })
  points!: number[];

  /** Optional audit reason recorded with the configuration change. */
  @IsOptional()
  @IsString()
  @MaxLength(280)
  reason?: string;
}

export class SetCrashNextPointsDto {
  /** New admin points that activate after the current repeat finishes. */
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(1_000)
  @IsNumber({}, { each: true })
  points!: number[];

  @IsOptional()
  @IsString()
  @MaxLength(280)
  reason?: string;
}

export class SetRepeatExtensionDto {
  /** Repeat continues from the CURRENT position for this many more points. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1_000)
  extension!: number;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  reason?: string;
}
