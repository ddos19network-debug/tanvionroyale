/**
 * AFFILIATE request DTOs.
 *
 * These exist to enforce the rule that the BROWSER may never propose a number
 * that ends up as money or as a reported figure:
 *
 *   - No DTO accepts a reward amount, an income amount, a paid/approved status
 *     or a referrer id. Those are all derived server-side from `Referral`,
 *     `ReferralReward` and the admin program settings.
 *   - `SetAffiliateTargetDto` accepts only a month, a target TYPE and a whole
 *     target VALUE. That is configuration, not a payment.
 *   - `UpsertAffiliateContentDto` accepts only plain text, a closed block type
 *     and an https URL — never HTML, never a script, never a data: URL.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
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

/**
 * The ONLY block types the renderer knows how to draw. A closed enum, so an
 * admin can never store a type the frontend has no safe component for.
 */
export const AFFILIATE_CONTENT_BLOCK_TYPES = [
  'TEXT',
  'IMAGE',
  'BANNER',
  'FAQ',
  'CTA',
  'STATS',
  'HOW_IT_WORKS',
] as const;

export type AffiliateContentBlockType = (typeof AFFILIATE_CONTENT_BLOCK_TYPES)[number];

/**
 * The ONLY target metrics the platform can actually measure.
 */
export const AFFILIATE_TARGET_TYPES = ['QUALIFIED_REFERRALS', 'SIGNUPS'] as const;
export type AffiliateTargetTypeParam = (typeof AFFILIATE_TARGET_TYPES)[number];

/**
 * The ONLY channels a member may declare they promote through.
 *
 * A closed set (not free text) because this value is shown to admins as a
 * filterable label; an unlisted channel would be indistinguishable from noise.
 * "OTHER" exists so a real promoter is never forced to mis-describe themselves.
 */
export const AFFILIATE_PROMOTION_METHODS = [
  'SOCIAL_MEDIA',
  'FACEBOOK',
  'YOUTUBE',
  'TIKTOK',
  'TELEGRAM',
  'WEBSITE',
  'COMMUNITY',
  'OTHER',
] as const;

export type AffiliatePromotionMethodParam = (typeof AFFILIATE_PROMOTION_METHODS)[number];

/**
 * https-only absolute URL (or a same-site absolute path such as `/signup`).
 *
 * This single pattern is what makes a stored block incapable of carrying
 * `javascript:`, `data:`, `vbscript:` or any other dangerous protocol, so no
 * image or link can execute anything when the page renders it.
 *
 * A PROTOCOL-RELATIVE url (`//evil.example.com/x.js`) is deliberately NOT
 * allowed: it is a normal site-relative path by the regex but an off-site
 * absolute URL to the browser, which is exactly the kind of surprise this
 * allow-list exists to prevent. The path branch therefore requires a single
 * leading `/` that is not followed by another `/`.
 */
export const AFFILIATE_SAFE_URL_PATTERN =
  /^(\/[^/][\w\-./?=&%]*|https:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+)$/;

/**
 * Explicit affiliate activation.
 *
 * SECURITY / DATA MINIMISATION
 *   This DTO carries NO password, NO card detail, NO identity document and NO
 *   referral code. The code already exists on the account and is never chosen
 *   by the user here; the identity is derived from the verified JWT, and the
 *   activation itself never moves money. Contact fields are contact details
 *   the user already supplied to the platform, resubmitted so the affiliate
 *   record is self-contained for the admin who reviews it.
 */
export class ActivateAffiliateDto {
  @ApiProperty({ description: 'The member\'s display name as it should appear to an admin' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  fullName!: string;

  @ApiPropertyOptional({ description: 'Contact email; defaults to the account email' })
  @IsOptional()
  @IsString()
  @MaxLength(160)
  @Matches(/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, { message: 'email must be a valid address' })
  email?: string;

  @ApiPropertyOptional({ description: 'Contact phone; defaults to the account phone' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  @ApiProperty({ enum: AFFILIATE_PROMOTION_METHODS })
  @IsIn(AFFILIATE_PROMOTION_METHODS)
  promotionMethod!: AffiliatePromotionMethodParam;

  @ApiPropertyOptional({
    description: 'Profile / website / channel URL. https:// or a site-relative path.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(AFFILIATE_SAFE_URL_PATTERN, {
    message: 'promotionUrl must be an https:// URL or a site-relative path',
  })
  promotionUrl?: string;

  @ApiPropertyOptional({ description: 'How will you promote TANVIONROYALE?' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ description: 'Must be true. The agreement cannot be skipped.' })
  @IsBoolean()
  @Type(() => Boolean)
  acceptTerms!: boolean;
}

/**
 * Admin-controlled affiliate status.
 *
 * A closed boolean intent rather than a free-form status string, so an admin
 * can never invent a state the service does not understand. It carries NO
 * amount, NO income and NO reward field on purpose.
 */
export class SetAffiliateStatusDto {
  @ApiProperty({ description: 'true = ACTIVE, false = INACTIVE' })
  @IsBoolean()
  @Type(() => Boolean)
  isActive!: boolean;

  @ApiPropertyOptional({ description: 'Why the status changed (kept in the audit trail)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

/** Records one click on an affiliate link (public, unauthenticated, throttled). */
export class TrackAffiliateClickDto {
  @ApiProperty({ description: 'Referral code from ?ref=; validated server-side' })
  @IsString()
  @MinLength(4)
  @MaxLength(64)
  code!: string;

  @ApiPropertyOptional({
    description: 'Coarse landing path, e.g. /signup. Query strings are ignored.',
    example: '/signup',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  path?: string;
}

/** Creates or updates one monthly target for one affiliate. */
export class SetAffiliateTargetDto {
  @ApiProperty({ example: 2026, minimum: 2000, maximum: 2999 })
  @Type(() => Number)
  @IsInt()
  @Min(2000)
  @Max(2999)
  year!: number;

  @ApiProperty({ example: 9, minimum: 1, maximum: 12 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @ApiProperty({ enum: AFFILIATE_TARGET_TYPES })
  @IsIn(AFFILIATE_TARGET_TYPES)
  targetType!: AffiliateTargetTypeParam;

  @ApiProperty({ example: 100, minimum: 0, description: 'Whole units of targetType' })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  targetValue!: number;
}

/** Create/update an affiliate content block. Data only — never executable. */
export class UpsertAffiliateContentDto {
  @ApiPropertyOptional({ example: 'hero' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{1,48}$/)
  key?: string;

  @ApiProperty({ enum: AFFILIATE_CONTENT_BLOCK_TYPES })
  @IsIn(AFFILIATE_CONTENT_BLOCK_TYPES)
  type!: AffiliateContentBlockType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(400)
  subtitle?: string;

  @ApiPropertyOptional({ description: 'Plain text. Rendered as text, never as HTML.' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string;

  @ApiPropertyOptional({ description: 'One item per line (or "Question|Answer" for FAQ)' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  items?: string;

  @ApiPropertyOptional({ description: 'https:// or a site-relative path. Never data:/javascript:' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(AFFILIATE_SAFE_URL_PATTERN, {
    message: 'imageUrl must be an https:// URL or a site-relative path',
  })
  imageUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(80)
  ctaText?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Matches(AFFILIATE_SAFE_URL_PATTERN, {
    message: 'ctaUrl must be an https:// URL or a site-relative path',
  })
  ctaUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  sortOrder?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  @Type(() => Boolean)
  isEnabled?: boolean;
}

/** Explicit, deterministic ordering (no drag-and-drop dependency). */
export class ReorderAffiliateContentDto {
  @ApiProperty({ type: [String], description: 'Block ids in their new display order' })
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  ids!: string[];
}
