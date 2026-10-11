import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Product selector shared by BIG CASINO and BIG LIVE CASINO.
 *
 * `casino` → BIG CASINO (partner casino games), `live` → BIG LIVE CASINO
 * (partner live-dealer games). The two never mix in one response.
 */
export const CASINO_PRODUCT_VALUES = ['casino', 'live'] as const;
export type CasinoProductParam = (typeof CASINO_PRODUCT_VALUES)[number];

/** Query for a product-scoped catalog page (server-side filter + paging). */
export class CasinoCatalogQueryDto {
  @ApiPropertyOptional({ enum: CASINO_PRODUCT_VALUES, default: 'casino' })
  @IsOptional()
  @IsIn(CASINO_PRODUCT_VALUES)
  product?: CasinoProductParam;

  @ApiPropertyOptional({ description: 'Studio id/name reported by the provider' })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({ description: 'Catalog category slug' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Game name search (case-insensitive)' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Only featured games' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  featured?: boolean;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 48, minimum: 1, maximum: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(60)
  pageSize?: number;
}

/** Launch request — the browser only ever names a known catalog game. */
export class CasinoLaunchDto {
  @ApiProperty({ description: 'Catalog id `${providerRowId}:${externalId}`' })
  @IsString()
  @IsNotEmpty()
  gameId!: string;

  @ApiProperty({ enum: ['REAL', 'DEMO'], default: 'REAL' })
  @IsIn(['REAL', 'DEMO'])
  mode!: 'REAL' | 'DEMO';

  @ApiPropertyOptional({ example: 'BDT' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ example: 'en' })
  @IsOptional()
  @IsString()
  locale?: string;
}
