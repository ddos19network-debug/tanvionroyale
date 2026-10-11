import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const ADMIN_PAYMENT_METHOD_CURRENCIES = ['BDT', 'USD', 'EUR'] as const;

export class CreateAdminPaymentMethodDto {
  @ApiProperty({ example: 'bkash' })
  @IsString()
  @Matches(/^[a-z0-9_-]{2,40}$/, { message: 'Invalid payment method code' })
  code!: string;

  @ApiProperty({ example: 'bKash' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayName!: string;

  /** Execution mode: MANUAL (admin reviewed) or GATEWAY (real adapter). */
  @ApiPropertyOptional({ enum: ['MANUAL', 'GATEWAY'], default: 'MANUAL' })
  @IsOptional()
  @IsIn(['MANUAL', 'GATEWAY'])
  type?: 'MANUAL' | 'GATEWAY';

  /** Optional link to a database-backed gateway config (required for GATEWAY). */
  @ApiPropertyOptional({ example: 'gateway-config-id' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  gatewayConfigId?: string;

  @ApiProperty({ example: ['BDT'], enum: ADMIN_PAYMENT_METHOD_CURRENCIES })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(ADMIN_PAYMENT_METHOD_CURRENCIES, { each: true })
  supportedCurrencies!: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  depositEnabled?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  withdrawalEnabled?: boolean;

  @ApiPropertyOptional({ example: '01712345678' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  accountNumber?: string;

  @ApiPropertyOptional({ example: 'TANVION ROYALE' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  accountName?: string;

  @ApiPropertyOptional({ example: 'BRAC Bank' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;

  @ApiPropertyOptional({ example: 'Gulshan' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  branch?: string;

  @ApiPropertyOptional({ example: '060277536' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  routingNumber?: string;

  @ApiPropertyOptional({ example: 'Send the exact amount and enter the transaction ID.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  minDeposit?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxDeposit?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  minWithdrawal?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxWithdrawal?: number;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  requireTransactionId?: boolean;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  requireProof?: boolean;

  @ApiPropertyOptional({ minimum: -1000, maximum: 1000 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

/** Partial update of an existing payment method (fields are optional). */
export class UpdateAdminPaymentMethodDto {
  @ApiPropertyOptional({ example: 'bKash' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  displayName?: string;

  /** Execution mode toggle: MANUAL or GATEWAY. */
  @ApiPropertyOptional({ enum: ['MANUAL', 'GATEWAY'] })
  @IsOptional()
  @IsIn(['MANUAL', 'GATEWAY'])
  type?: 'MANUAL' | 'GATEWAY';

  /** Gateway config link (required for GATEWAY; null clears it for MANUAL). */
  @ApiPropertyOptional({ example: 'gateway-config-id' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  gatewayConfigId?: string | null;

  /** Active / inactive toggle (true = ACTIVE). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'ARCHIVED'])
  status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

  @ApiPropertyOptional({ example: ['BDT', 'USD', 'EUR'], enum: ADMIN_PAYMENT_METHOD_CURRENCIES })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(ADMIN_PAYMENT_METHOD_CURRENCIES, { each: true })
  supportedCurrencies?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  depositEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  withdrawalEnabled?: boolean;

  @ApiPropertyOptional({ example: '01712345678' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  accountNumber?: string;

  @ApiPropertyOptional({ example: 'TANVION ROYALE' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  accountName?: string;

  @ApiPropertyOptional({ example: 'BRAC Bank' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  bankName?: string;

  @ApiPropertyOptional({ example: 'Gulshan' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  branch?: string;

  @ApiPropertyOptional({ example: '060277536' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  routingNumber?: string;

  @ApiPropertyOptional({ example: 'Send the exact amount and enter the transaction ID.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  instructions?: string;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  minDeposit?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxDeposit?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  minWithdrawal?: number;

  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  maxWithdrawal?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requireTransactionId?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  requireProof?: boolean;

  @ApiPropertyOptional({ minimum: -1000, maximum: 1000 })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}