import {
  ApiProperty,
  ApiPropertyOptional,
} from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

import type {
  P2PFiat,
  P2POrderSide,
  P2POrderStatus,
  P2PPaymentMethodCode,
  P2PSymbol,
} from '@tanvion-royale/types';

export const P2P_SUPPORTED_SYMBOLS = [
  'USDT',
  'BTC',
  'ETH',
  'BNB',
] as const satisfies P2PSymbol[];

export const P2P_SUPPORTED_FIAT = ['BDT', 'USD', 'EUR'] as const satisfies P2PFiat[];

export const P2P_PAYMENT_METHODS = [
  'bkash',
  'nagad',
  'rocket',
  'upay',
  'bank',
  'royale-pay',
] as const satisfies P2PPaymentMethodCode[];

/** List marketplace offers with optional filters. */
export class ListP2POffersQueryDto {
  @ApiPropertyOptional({ enum: P2P_SUPPORTED_SYMBOLS, example: 'USDT' })
  @IsOptional()
  @IsEnum(P2P_SUPPORTED_SYMBOLS as unknown as string[])
  symbol?: P2PSymbol;

  @ApiPropertyOptional({ enum: P2P_SUPPORTED_FIAT, example: 'BDT' })
  @IsOptional()
  @IsEnum(P2P_SUPPORTED_FIAT as unknown as string[])
  fiat?: P2PFiat;

  @ApiPropertyOptional({ enum: ['BUY', 'SELL'], example: 'SELL' })
  @IsOptional()
  @IsEnum(['BUY', 'SELL'])
  side?: P2POrderSide;

  @ApiPropertyOptional({
    enum: P2P_PAYMENT_METHODS,
    example: 'bkash',
  })
  @IsOptional()
  @IsEnum(P2P_PAYMENT_METHODS as unknown as string[])
  paymentMethod?: P2PPaymentMethodCode;

  @ApiPropertyOptional({ example: 1000, description: 'Min fiat amount in minor units' })
  @IsOptional()
  @IsInt()
  @Min(1)
  minAmount?: number;

  @ApiPropertyOptional({ example: 100000, description: 'Max fiat amount in minor units' })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxAmount?: number;

  @ApiPropertyOptional({ enum: ['price', 'available', 'relevance'], default: 'price' })
  @IsOptional()
  @IsEnum(['price', 'available', 'relevance'])
  sortBy?: 'price' | 'available' | 'relevance';

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/** Estimate crypto quantity for a fiat amount before creating an order. */
export class P2PQuoteDto {
  @ApiProperty({ enum: P2P_SUPPORTED_SYMBOLS, example: 'USDT' })
  @IsEnum(P2P_SUPPORTED_SYMBOLS as unknown as string[])
  symbol!: P2PSymbol;

  @ApiProperty({ enum: P2P_SUPPORTED_FIAT, example: 'BDT' })
  @IsEnum(P2P_SUPPORTED_FIAT as unknown as string[])
  fiat!: P2PFiat;

  @ApiProperty({ enum: ['BUY', 'SELL'], example: 'BUY' })
  @IsEnum(['BUY', 'SELL'])
  side!: P2POrderSide;

  /** Fiat minor units (for BUY: what user pays; for SELL: what user receives). */
  @ApiProperty({ example: 10000, description: 'Fiat amount in minor units' })
  @IsInt()
  @Min(1)
  fiatAmount!: number;
}

/** Create a P2P order. Idempotency key prevents duplicate orders. */
export class CreateP2POrderDto {
  @ApiProperty({ enum: P2P_SUPPORTED_SYMBOLS, example: 'USDT' })
  @IsEnum(P2P_SUPPORTED_SYMBOLS as unknown as string[])
  symbol!: P2PSymbol;

  @ApiProperty({ enum: P2P_SUPPORTED_FIAT, example: 'BDT' })
  @IsEnum(P2P_SUPPORTED_FIAT as unknown as string[])
  fiat!: P2PFiat;

  @ApiProperty({ enum: ['BUY', 'SELL'], example: 'BUY' })
  @IsEnum(['BUY', 'SELL'])
  side!: P2POrderSide;

  @ApiProperty({ example: 10000, description: 'Fiat amount in minor units' })
  @IsInt()
  @Min(1)
  fiatAmount!: number;

  @ApiProperty({ example: 77, description: 'Crypto base units (asset scale dependent)' })
  @IsInt()
  @Min(1)
  cryptoAmount!: number;

  @ApiProperty({
    example: 13000,
    description: 'Locked price: fiat minor units per 1 crypto base unit',
  })
  @IsInt()
  @Min(1)
  pricePerFiatUnit!: number;

  @ApiProperty({ example: 'offer_uuid', format: 'uuid' })
  @IsUUID('4')
  offerId!: string;

  @ApiProperty({
    enum: P2P_PAYMENT_METHODS,
    example: 'royale-pay',
    description: 'Payment method code',
  })
  @IsEnum(P2P_PAYMENT_METHODS as unknown as string[])
  paymentMethod!: P2PPaymentMethodCode;

  @ApiProperty({
    example: 'p2p-20261121-abc123',
    description: 'Client-generated idempotency key (8-128 chars)',
  })
  @IsString()
  @Min(8)
  @Max(128)
  idempotencyKey!: string;
}

/** Submit payment evidence for a P2P order. */
export class SubmitP2PPaymentDto {
  @ApiProperty({ example: 'order_uuid', format: 'uuid' })
  @IsUUID('4')
  orderId!: string;

  @ApiProperty({ enum: P2P_PAYMENT_METHODS, example: 'bkash' })
  @IsEnum(P2P_PAYMENT_METHODS as unknown as string[])
  method!: P2PPaymentMethodCode;

  @ApiPropertyOptional({ example: 'BKASH123456', maxLength: 255 })
  @IsOptional()
  @IsString()
  @Max(255)
  reference?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/proof.png' })
  @IsOptional()
  @IsString()
  proofUrl?: string;
}

/** Cancel a P2P order (owner only, before payment verification). */
export class CancelP2POrderDto {
  @ApiProperty({ example: 'order_uuid', format: 'uuid' })
  @IsUUID('4')
  orderId!: string;

  @ApiPropertyOptional({ example: 'Changed my mind', maxLength: 500 })
  @IsOptional()
  @IsString()
  @Max(500)
  reason?: string;
}

/** List user's P2P orders. */
export class ListP2POrdersQueryDto {
  @ApiPropertyOptional({ enum: ['CREATED', 'PAYMENT_PENDING', 'PAYMENT_SUBMITTED', 'PAYMENT_VERIFICATION_PENDING', 'PROCESSING', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'DISPUTED', 'REFUNDED', 'FAILED'] })
  @IsOptional()
  @IsEnum([
    'CREATED',
    'PAYMENT_PENDING',
    'PAYMENT_SUBMITTED',
    'PAYMENT_VERIFICATION_PENDING',
    'PROCESSING',
    'COMPLETED',
    'CANCELLED',
    'EXPIRED',
    'DISPUTED',
    'REFUNDED',
    'FAILED',
  ] as const)
  status?: P2POrderStatus;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

/** Admin: create/update a P2P merchant offer. */
export class AdminP2POfferDto {
  @ApiProperty({ example: 'merchant_user_uuid', format: 'uuid' })
  @IsUUID('4')
  merchantId!: string;

  @ApiProperty({ enum: P2P_SUPPORTED_SYMBOLS, example: 'USDT' })
  @IsEnum(P2P_SUPPORTED_SYMBOLS as unknown as string[])
  symbol!: P2PSymbol;

  @ApiProperty({ enum: P2P_SUPPORTED_FIAT, example: 'BDT' })
  @IsEnum(P2P_SUPPORTED_FIAT as unknown as string[])
  fiat!: P2PFiat;

  @ApiProperty({ enum: ['BUY', 'SELL'], example: 'SELL' })
  @IsEnum(['BUY', 'SELL'])
  side!: P2POrderSide;

  @ApiProperty({
    example: 13000,
    description: 'Fiat minor units per 1 crypto base unit',
  })
  @IsInt()
  @Min(1)
  pricePerFiatUnit!: number;

  @ApiProperty({
    example: 100000000,
    description: 'Crypto base units available (asset scale dependent)',
  })
  @IsNumber()
  @Min(1)
  availableCrypto!: number;

  @ApiProperty({ example: 1000, description: 'Min fiat order in minor units' })
  @IsInt()
  @Min(1)
  minOrderFiat!: number;

  @ApiProperty({ example: 500000, description: 'Max fiat order in minor units' })
  @IsInt()
  @Min(1)
  maxOrderFiat!: number;

  @ApiProperty({
    example: ['bkash', 'nagad', 'royale-pay'],
    description: 'Supported payment method codes',
  })
  @IsString({ each: true })
  @IsEnum(P2P_PAYMENT_METHODS as unknown as string[], { each: true })
  paymentMethods!: P2PPaymentMethodCode[];

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

/** Admin: verify a payment for a P2P order. */
export class AdminVerifyP2PPaymentDto {
  @ApiProperty({ example: 'order_uuid', format: 'uuid' })
  @IsUUID('4')
  orderId!: string;

  @ApiProperty({ enum: ['VERIFIED', 'REJECTED'] })
  @IsEnum(['VERIFIED', 'REJECTED'])
  status: 'VERIFIED' | 'REJECTED';

  @ApiPropertyOptional({ example: 'Reference matches', maxLength: 500 })
  @IsOptional()
  @IsString()
  @Max(500)
  verificationNote?: string;
}

/** Admin: resolve a P2P dispute. */
export class AdminResolveP2PDisputeDto {
  @ApiProperty({ example: 'dispute_uuid', format: 'uuid' })
  @IsUUID('4')
  disputeId!: string;

  @ApiProperty({ enum: ['BUYER_WINS', 'SELLER_WINS', 'SPLIT'] })
  @IsEnum(['BUYER_WINS', 'SELLER_WINS', 'SPLIT'])
  resolution: 'BUYER_WINS' | 'SELLER_WINS' | 'SPLIT';

  @ApiPropertyOptional({ example: 'Buyer provided valid proof', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @Max(1000)
  resolutionNote?: string;
}