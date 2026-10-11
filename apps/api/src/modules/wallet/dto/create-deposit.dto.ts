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

export const WALLET_CURRENCIES = ['BDT', 'USD', 'EUR'] as const;

export type WalletCurrency = (typeof WALLET_CURRENCIES)[number];

export class CreateDepositDto {
  @ApiProperty({
    example: 1000,
    description:
      'Deposit amount in the selected currency minor unit / amount format used by the wallet system.',
  })
  @IsInt({ message: 'amount must be an integer' })
  @Min(1, { message: 'amount must be greater than 0' })
  @Max(100_000_000, { message: 'amount is too large' })
  amount!: number;

  @ApiPropertyOptional({
    example: 'BDT',
    enum: WALLET_CURRENCIES,
    default: 'BDT',
    description: 'Wallet currency. Supported currencies: BDT, USD and EUR.',
  })
  @IsOptional()
  @IsString()
  @IsIn(WALLET_CURRENCIES, {
    message: 'currency must be one of BDT, USD or EUR',
  })
  currency?: WalletCurrency;

  @ApiProperty({
    example: 'deposit-2026-000001',
    description: 'Idempotency key. Must be unique for the same deposit request.',
  })
  @IsString()
  @Length(8, 128, {
    message: 'idempotencyKey must be between 8 and 128 characters',
  })
  idempotencyKey!: string;
}
