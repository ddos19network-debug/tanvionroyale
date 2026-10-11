import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export const TRANSACTION_CURRENCIES = ['BDT', 'USD', 'EUR'] as const;

export type TransactionCurrency =
  (typeof TRANSACTION_CURRENCIES)[number];

export class ListTransactionsQueryDto {
  @ApiPropertyOptional({
    example: 1,
    default: 1,
    description: 'Page number.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    example: 20,
    default: 20,
    description: 'Number of transactions per page.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @ApiPropertyOptional({
    example: 'COMPLETED',
    enum: [
      'ALL',
      'PENDING',
      'PROCESSING',
      'COMPLETED',
      'FAILED',
      'CANCELLED',
    ],
    default: 'ALL',
  })
  @IsOptional()
  @IsString()
  @IsIn([
    'ALL',
    'PENDING',
    'PROCESSING',
    'COMPLETED',
    'FAILED',
    'CANCELLED',
  ])
  status?: string = 'ALL';

  @ApiPropertyOptional({
    example: 'BDT',
    enum: TRANSACTION_CURRENCIES,
    description: 'Filter transactions by wallet currency.',
  })
  @IsOptional()
  @IsString()
  @IsIn(TRANSACTION_CURRENCIES, {
    message: 'currency must be one of BDT, USD or EUR',
  })
  currency?: TransactionCurrency;
}
