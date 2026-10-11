import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export const MANUAL_WITHDRAWAL_CURRENCIES = ['BDT', 'USD', 'EUR'] as const;

export type ManualWithdrawalCurrency =
  (typeof MANUAL_WITHDRAWAL_CURRENCIES)[number];

/**
 * User-facing manual withdrawal submission.
 *
 * Destination fields only carry the MINIMUM information required by the chosen
 * payment method. CVV/PIN/OTP/passwords/card security data are NEVER accepted.
 */
export class CreateManualWithdrawalDto {
  /** Payment method code: bkash | nagad | rocket | bank | card. */
  @ApiProperty({ example: 'bkash' })
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  methodCode!: string;

  @ApiProperty({ example: 'BDT', enum: MANUAL_WITHDRAWAL_CURRENCIES })
  @IsString()
  @IsIn(MANUAL_WITHDRAWAL_CURRENCIES)
  currency!: ManualWithdrawalCurrency;

  /** Amount in the smallest wallet unit (minor units). */
  @ApiProperty({ example: 200000 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000_000)
  amount!: number;

  /** Mobile/account number (bKash/Nagad/Rocket/Bank). */
  @ApiPropertyOptional({ example: '01712345678' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  accountNumber?: string;

  /** Account/payee holder name where the method requires it. */
  @ApiPropertyOptional({ example: 'TANVION ROYALE USER' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  accountName?: string;

  /** Bank only — bank name. */
  @ApiPropertyOptional({ example: 'BRAC Bank' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;

  /** Bank only — branch. */
  @ApiPropertyOptional({ example: 'Gulshan' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  branch?: string;

  /** Bank only — routing number where required. */
  @ApiPropertyOptional({ example: '060277536' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  routingNumber?: string;

  /** Client-generated idempotency key (prevents duplicate submissions). */
  @ApiProperty({ example: 'wd-2026-000001' })
  @IsString()
  @Length(8, 100, { message: 'idempotencyKey must be between 8 and 100 characters' })
  idempotencyKey!: string;
}