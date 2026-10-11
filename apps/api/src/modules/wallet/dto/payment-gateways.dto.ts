import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export const PAYMENT_GATEWAY_CURRENCIES = ['BDT', 'USD', 'EUR'] as const;
export const PAYMENT_GATEWAY_TYPES = ['generic-http', 'gateway', 'rest'] as const;

export class CreatePaymentGatewayDto {
  @ApiProperty({ example: 'bKash Gateway' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @ApiProperty({ example: 'bkash-gateway' })
  @IsString()
  @Matches(/^[a-z0-9_-]{2,40}$/, { message: 'Invalid gateway code' })
  code!: string;

  @ApiPropertyOptional({ enum: PAYMENT_GATEWAY_TYPES, default: 'generic-http' })
  @IsOptional()
  @IsIn(PAYMENT_GATEWAY_TYPES)
  providerType?: string;

  @ApiProperty({ example: 'https://gateway.example.com/api' })
  @IsUrl({ require_protocol: true, protocols: ['https', 'http'] })
  @MaxLength(500)
  baseUrl!: string;

  @ApiPropertyOptional({ enum: ['BDT', 'USD', 'EUR'] })
  @IsOptional()
  @IsArray()
  @IsIn(PAYMENT_GATEWAY_CURRENCIES, { each: true })
  supportedCurrencies?: string[];

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  depositEnabled?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  withdrawalEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiSecret?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  webhookSecret?: string;

  @ApiPropertyOptional({ example: 'api-key' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  authMode?: string;

  @ApiPropertyOptional({ example: 'v1' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  apiVersion?: string;

  @ApiPropertyOptional({ default: 15000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(60000)
  timeoutMs?: number;
}

export class UpdatePaymentGatewayDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https', 'http'] })
  @MaxLength(500)
  baseUrl?: string;

  @ApiPropertyOptional({ enum: PAYMENT_GATEWAY_TYPES })
  @IsOptional()
  @IsIn(PAYMENT_GATEWAY_TYPES)
  providerType?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE', 'ARCHIVED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE', 'ARCHIVED'])
  status?: 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';

  @ApiPropertyOptional({ enum: ['BDT', 'USD', 'EUR'] })
  @IsOptional()
  @IsArray()
  @IsIn(PAYMENT_GATEWAY_CURRENCIES, { each: true })
  supportedCurrencies?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  depositEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  withdrawalEnabled?: boolean;

  @ApiPropertyOptional({ description: 'New API key; empty string clears it; omit to keep it.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiKey?: string;

  @ApiPropertyOptional({ description: 'New API secret; empty string clears it; omit to keep it.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  apiSecret?: string;

  @ApiPropertyOptional({ description: 'New webhook secret; empty string clears it; omit to keep it.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  webhookSecret?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  authMode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(40)
  apiVersion?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(60000)
  timeoutMs?: number;
}
