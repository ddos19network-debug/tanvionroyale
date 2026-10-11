import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, MaxLength, Min } from 'class-validator';

const TYPES = [
  'ALL',
  'SPORTS',
  'GAMES',
  'CRASH',
  'DEPOSIT',
  'WITHDRAWAL',
  'WALLET',
  'PROFILE',
] as const;

const STATUSES = ['ALL', 'PENDING', 'WON', 'LOST', 'COMPLETED', 'FAILED', 'CANCELLED', 'PROCESSING'] as const;

const RANGES = ['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_30_DAYS', 'ALL'] as const;

export class ListActivityQueryDto {
  @ApiPropertyOptional({ enum: TYPES, default: 'ALL' })
  @IsOptional()
  @IsIn(TYPES as unknown as string[])
  type?: string;

  @ApiPropertyOptional({ enum: STATUSES, default: 'ALL' })
  @IsOptional()
  @IsIn(STATUSES as unknown as string[])
  status?: string;

  @ApiPropertyOptional({ enum: RANGES, default: 'ALL' })
  @IsOptional()
  @IsIn(RANGES as unknown as string[])
  range?: string;

  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Search id / name / reference' })
  @IsOptional()
  @MaxLength(128)
  @Matches(/^[a-zA-Z0-9 _\-:./+@#]*$/, { message: 'search contains invalid characters' })
  search?: string;
}
