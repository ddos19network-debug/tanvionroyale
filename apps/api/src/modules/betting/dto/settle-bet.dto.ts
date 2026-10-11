import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

const RESULTS = ['WIN', 'LOSS', 'VOID', 'PUSH'] as const;

/** Trusted per-selection settlement result (SINGLE bets in this phase). */
export class SettleSelectionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('4', { message: 'selectionId must be a valid UUID' })
  selectionId!: string;

  @ApiProperty({ enum: RESULTS })
  @IsIn(RESULTS, { message: 'result must be WIN | LOSS | VOID | PUSH' })
  result!: (typeof RESULTS)[number];
}

export class SettleBetDto {
  @ApiProperty({ type: [SettleSelectionDto] })
  @IsArray({ message: 'results must be an array' })
  @ArrayMinSize(1, { message: 'at least one selection result is required' })
  @ValidateNested({ each: true })
  @Type(() => SettleSelectionDto)
  results!: SettleSelectionDto[];
}

export class SettleEventDto extends SettleBetDto {}