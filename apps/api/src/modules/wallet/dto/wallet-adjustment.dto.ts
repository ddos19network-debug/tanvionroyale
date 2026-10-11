import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export const WALLET_ADJUSTMENT_CURRENCIES = ['BDT', 'USD', 'EUR'] as const;

export type WalletAdjustmentCurrency =
  (typeof WALLET_ADJUSTMENT_CURRENCIES)[number];

export class WalletAdjustmentDto {
  @ApiProperty({
    example: 50000,
    description:
      'Signed amount in minor units. Positive = credit, negative = debit. Zero is not allowed.',
  })
  @IsNotEmpty()
  amount!: number;

  @ApiPropertyOptional({
    example: 'BDT',
    enum: WALLET_ADJUSTMENT_CURRENCIES,
    default: 'BDT',
    description: 'Wallet currency.',
  })
  @IsOptional()
  @IsString()
  @IsIn(WALLET_ADJUSTMENT_CURRENCIES)
  currency?: WalletAdjustmentCurrency;

  @ApiProperty({
    example: 'Manual balance correction after payment verification',
    description: 'Mandatory reason for the admin wallet adjustment.',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;

  @ApiProperty({
    example: 'admin-adjustment-20260910-001',
    description:
      'Unique idempotency key. Reusing the same key must not create a second balance change.',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9._:-]+$/, {
    message:
      'idempotencyKey may contain only letters, numbers, dot, underscore, colon and hyphen.',
  })
  idempotencyKey!: string;
}
