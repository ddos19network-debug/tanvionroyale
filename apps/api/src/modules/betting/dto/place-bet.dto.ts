import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Min,
} from 'class-validator';

export class PlaceBetDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'eventId must be a valid UUID' })
  eventId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'marketId must be a valid UUID' })
  marketId!: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'selectionId must be a valid UUID' })
  selectionId!: string;

  @ApiProperty({ example: 1000, description: 'Stake in integer minor units (e.g. poisha for BDT)' })
  @IsInt({ message: 'Stake must be an integer in minor units' })
  @Min(1)
  stake!: number;

  @ApiProperty({ example: '1.85', description: 'Decimal odds the customer reviewed, up to 2 dp' })
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, { message: 'requestedOdds must be a decimal string such as "1.85"' })
  requestedOdds!: string;

  @ApiPropertyOptional({ example: 'BDT', description: 'ISO 4217 currency code (wallet-supported: BDT/USD/EUR)' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be an ISO 4217 code (e.g. BDT)' })
  currency?: string;

  @ApiProperty({ example: 'uuid-or-opaque-key', description: 'Idempotency key (min 8 chars)' })
  @IsString()
  @Length(8, 128, { message: 'idempotencyKey must be between 8 and 128 characters' })
  idempotencyKey!: string;
}