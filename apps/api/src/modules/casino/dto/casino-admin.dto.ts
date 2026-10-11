import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Min,
} from 'class-validator';

/**
 * Admin configuration of the casino use of an EXISTING PartnerProvider row.
 *
 * Credentials are deliberately NOT edited here: they already have one admin
 * surface (`/admin/partner-providers`, AES-256-GCM encrypted at rest) and this
 * endpoint must never become a second place where a secret can be written or
 * read back.
 */
export class CasinoProviderConfigDto {
  @ApiPropertyOptional({ enum: ['sandbox', 'production'] })
  @IsOptional()
  @IsIn(['sandbox', 'production'])
  environment?: 'sandbox' | 'production';

  @ApiPropertyOptional({ example: 'v1' })
  @IsOptional()
  @IsString()
  apiVersion?: string;

  @ApiPropertyOptional({ example: 'https://api.partner.example' })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  baseUrl?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @ApiPropertyOptional({ description: 'Deep-link template (unused by casino but required by the row)' })
  @IsOptional()
  @IsString()
  deepLinkTemplate?: string;
}

/** Admin: enable/disable one synced game (or its demo/feature flag). */
export class CasinoGameAdminDto {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  launchAvailable?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  demoAvailable?: boolean;

  /** Optional internal ordering (0 = default). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
