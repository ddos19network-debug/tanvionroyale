import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Royale Ace DTOs. Clients may only send a stake, an optional currency, an
 * idempotency key and optional presentation flags (turbo / autoplay limits).
 * NEVER a multiplier, payout, seed, grid, cascade, free-spin count or balance —
 * the server derives the ENTIRE round; the client only replays it.
 * Structural bounds live here; the service re-validates against the ACTIVE
 * versioned config (bet levels, caps, ladders, jurisdiction).
 */

export class AceSpinDto {
  /** Stake in minor units (REAL_MONEY) or free-play points (FREE_PLAY). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  stake!: number;

  /**
   * Currency for REAL_MONEY bet levels (BDT/USD). Omitted => the operator
   * default. The service re-checks it against the jurisdiction rules; there is
   * NO auto-FX, so a currency the player's country cannot use is rejected.
   */
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  /** Client-generated idempotency key (UUID) — retried spins never double-spend. */
  @IsOptional()
  @IsUUID()
  clientRequestId?: string;

  /** Presentation only — never affects the outcome (the round is pre-derived). */
  @IsOptional()
  @IsBoolean()
  turbo?: boolean;
}

/**
 * Autoplay request. Autoplay is a CLIENT loop that calls `spin` once per round
 * with a fresh idempotency key; these limits are echoed back for the UI and the
 * reality-check timer, and the client MUST stop when any limit is reached or a
 * feature triggers. They are validated here so a malformed limit is rejected
 * up front (responsible-play requirement).
 */
export class AceAutoplayLimitsDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  spinCount!: number;

  /** Stop after this many consecutive net-loss spins (minor units). */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  lossLimit!: number;

  /** Stop once total net win reaches this (minor units). 0 = no win limit. */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  winLimit!: number;
}

export class AceHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
