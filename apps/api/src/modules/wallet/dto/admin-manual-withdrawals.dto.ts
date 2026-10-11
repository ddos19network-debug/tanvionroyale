import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export const ADMIN_WITHDRAWAL_STATUSES = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'COMPLETED',
  'CANCELLED',
] as const;

export type AdminWithdrawalStatusFilter =
  (typeof ADMIN_WITHDRAWAL_STATUSES)[number];

/** Admin manual-withdrawal list query. */
export class AdminListManualWithdrawalsQueryDto {
  @ApiPropertyOptional({ enum: ADMIN_WITHDRAWAL_STATUSES })
  @IsOptional()
  @IsIn(ADMIN_WITHDRAWAL_STATUSES)
  status?: AdminWithdrawalStatusFilter;

  @ApiPropertyOptional({ minimum: 1, maximum: 200, default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ minimum: 0, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

/** Admin review action for a withdrawal request. */
export class AdminReviewManualWithdrawalDto {
  @ApiProperty({ enum: ['APPROVE', 'REJECT'] })
  @IsIn(['APPROVE', 'REJECT'])
  action!: 'APPROVE' | 'REJECT';

  /** Required when rejecting (also accepted with approve as a note). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}

/** Admin "mark as completed" (manual payout executed off-platform). */
export class AdminCompleteManualWithdrawalDto {
  /** Optional external payout reference entered by the operator. */
  @ApiPropertyOptional({ example: 'external-payout-123' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  providerReference?: string;
}