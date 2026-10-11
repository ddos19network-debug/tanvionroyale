import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, MaxLength, Min } from 'class-validator';

const STATUS_FILTERS = ['ALL', 'PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'SETTLED', 'VOID'] as const;
export type BetsStatusFilter = (typeof STATUS_FILTERS)[number];

const RESULTS = ['ALL', 'WIN', 'LOSS', 'VOID', 'PUSH'] as const;

export class ListBetsQueryDto {
  @ApiPropertyOptional({ enum: STATUS_FILTERS, default: 'ALL' })
  @IsOptional()
  @IsIn(STATUS_FILTERS)
  status?: BetsStatusFilter;

  @ApiPropertyOptional({ enum: RESULTS, default: 'ALL' })
  @IsOptional()
  @IsIn(RESULTS)
  result?: string;

  @ApiPropertyOptional({ example: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Search bet id / event / selection' })
  @IsOptional()
  @MaxLength(128)
  @Matches(/^[a-zA-Z0-9 _\-:./+@#]*$/, { message: 'search contains invalid characters' })
  search?: string;
}
