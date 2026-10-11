import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export type TradingOrderSideDto = 'BUY' | 'SELL';

/** Place a virtual market order (paper trading — never real money). */
export class PlaceTradingOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'instrumentId must be a valid UUID' })
  instrumentId!: string;

  @ApiProperty({ enum: ['BUY', 'SELL'] })
  @IsEnum(['BUY', 'SELL'] as const)
  side!: TradingOrderSideDto;

  @ApiProperty({ example: 10, description: 'Whole virtual units (shares)' })
  @IsInt({ message: 'quantity must be a whole number of virtual units' })
  @Min(1)
  quantity!: number;
}

/** Admin toggle for a paper instrument. */
export class UpdateTradingInstrumentDto {
  @ApiProperty({ description: 'Enable/disable the instrument for paper trading' })
  @IsBoolean({ message: 'isEnabled must be a boolean' })
  isEnabled!: boolean;
}