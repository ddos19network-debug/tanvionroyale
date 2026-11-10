import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export type TradingOrderSideDto = 'BUY' | 'SELL';
export type TradingOrderTypeDto = 'MARKET' | 'LIMIT' | 'STOP_LIMIT';

/** Place a virtual trading order. */
export class PlaceTradingOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'instrumentId must be a valid UUID' })
  instrumentId!: string;

  @ApiProperty({ enum: ['BUY', 'SELL'] })
  @IsEnum(['BUY', 'SELL'] as const)
  side!: TradingOrderSideDto;

  @ApiPropertyOptional({ enum: ['MARKET', 'LIMIT', 'STOP_LIMIT'], default: 'MARKET' })
  @IsOptional()
  @IsEnum(['MARKET', 'LIMIT', 'STOP_LIMIT'] as const)
  type?: TradingOrderTypeDto;

  @ApiProperty({ example: 10, description: 'Whole virtual units (shares / contracts)' })
  @IsInt({ message: 'quantity must be a whole number of virtual units' })
  @Min(1)
  quantity!: number;

  @ApiPropertyOptional({ description: 'Limit price in integer minor units (e.g. cents)' })
  @IsOptional()
  @IsInt({ message: 'limitPrice must be an integer in minor units' })
  @Min(1)
  limitPrice?: number;

  @ApiPropertyOptional({ description: 'Stop trigger price in integer minor units' })
  @IsOptional()
  @IsInt({ message: 'stopPrice must be an integer in minor units' })
  @Min(1)
  stopPrice?: number;

  @ApiPropertyOptional({ description: 'Leverage multiplier (e.g. 1 for spot, 5, 10, 20)', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  leverage?: number;
}

/** Demo Faucet / Virtual balance reset. */
export class VirtualBalanceFaucetDto {
  @ApiPropertyOptional({ description: 'Amount in minor units to add (default $10,000.00 = 1000000)' })
  @IsOptional()
  @IsNumber()
  @Min(1000) // min $10
  amount?: number;

  @ApiPropertyOptional({ description: 'Reset balance to this amount instead of adding', default: false })
  @IsOptional()
  @IsBoolean()
  reset?: boolean;
}

/** Admin toggle for a paper instrument. */
export class UpdateTradingInstrumentDto {
  @ApiProperty({ description: 'Enable/disable the instrument for paper trading' })
  @IsBoolean({ message: 'isEnabled must be a boolean' })
  isEnabled!: boolean;
}
