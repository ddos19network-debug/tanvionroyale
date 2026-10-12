import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsISO31661Alpha2,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Admin DTOs for the central jurisdiction & currency control surface.
 *
 * Everything here is a WRITE that changes where real money may be accepted,
 * so `reason` is required on every mutation (except re-enabling a switch,
 * where the service still records a default reason).
 */

export class UpsertJurisdictionRuleDto {
  @IsISO31661Alpha2()
  countryCode!: string;

  @IsIn(['ALLOWED', 'BLOCKED'])
  status!: 'ALLOWED' | 'BLOCKED';

  /** BDT/USD subset — validated again in the service (no other currency can slip in). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedCurrencies?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(120)
  licenceRef?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class BulkBlockJurisdictionsDto {
  @IsOptional()
  @IsISO31661Alpha2()
  countryCode?: string;

  @IsOptional()
  @IsBoolean()
  all?: boolean;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class SetGameSwitchDto {
  @IsString()
  @Length(3, 60)
  key!: string;

  @IsBoolean()
  enabled!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class JurisdictionAuditQueryDto {
  @Type(() => Number)
  @IsOptional()
  limit?: number;
}
