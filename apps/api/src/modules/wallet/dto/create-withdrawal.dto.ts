import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';

export const WITHDRAWAL_CURRENCIES = ['BDT', 'USD', 'EUR'] as const;

export type WithdrawalCurrency =
  (typeof WITHDRAWAL_CURRENCIES)[number];

export class CreateWithdrawalDto {
  @ApiProperty({
    example: 2000,
    description: 'Withdrawal amount in the selected wallet currency.',
  })
  @IsInt({ message: 'amount must be an integer' })
  @Min(1, { message: 'amount must be greater than 0' })
  @Max(100_000_000, { message: 'amount is too large' })
  amount!: number;

  @ApiPropertyOptional({
    example: 'BDT',
    enum: WITHDRAWAL_CURRENCIES,
    default: 'BDT',
    description:
      'ISO currency code. Supported currencies are BDT, USD and EUR.',
  })
  @IsOptional()
  @IsString()
  @IsIn(WITHDRAWAL_CURRENCIES, {
    message: 'currency must be one of BDT, USD or EUR',
  })
  currency?: WithdrawalCurrency;

  @ApiProperty({
    example: 'withdrawal-2026-000001',
    description:
      'Unique idempotency key for preventing duplicate withdrawal requests.',
  })
  @IsString()
  @Length(8, 128, {
    message: 'idempotencyKey must be between 8 and 128 characters',
  })
  idempotencyKey!: string;
}
