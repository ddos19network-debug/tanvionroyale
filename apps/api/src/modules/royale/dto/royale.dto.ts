import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';

/**
 * Royale Play DTOs. Clients may only send a stake, a board choice, a tile
 * index and an idempotency key — NEVER a multiplier, payout, seed, or balance.
 * Structural bounds are checked here; the service re-validates against the
 * server configuration (rows range, grid list, stake limits, RTP caps).
 */

export class DropPlinkoDto {
  /** Stake in minor units (REAL_MONEY) or free-play points (FREE_PLAY). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  stake!: number;

  /** Board row count (service validates against the configured range). */
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(32)
  rows!: number;

  @IsIn(['LOW', 'MEDIUM', 'HIGH'])
  risk!: 'LOW' | 'MEDIUM' | 'HIGH';

  /** Client-generated idempotency key (UUID) — retried drops can never double-spend. */
  @IsOptional()
  @IsUUID()
  clientRequestId?: string;
}

export class StartMinesDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  stake!: number;

  /** Grid size (service validates against the configured square list). */
  @Type(() => Number)
  @IsInt()
  @Min(9)
  @Max(36)
  gridSize!: number;

  /** Mine count (service validates against min/max and grid size). */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(24)
  minesCount!: number;

  @IsOptional()
  @IsUUID()
  clientRequestId?: string;
}

export class RevealMinesTileDto {
  /** Tile index in [0, gridSize). */
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(35)
  tile!: number;
}

export class MinesActionDto {
  @IsOptional()
  @IsUUID()
  clientRequestId?: string;
}

export class RoyaleHistoryQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class PayoutTableQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(32)
  rows!: number;

  @IsIn(['LOW', 'MEDIUM', 'HIGH'])
  risk!: 'LOW' | 'MEDIUM' | 'HIGH';
}

export class AdminSettlementsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  gameSlug?: string;
}