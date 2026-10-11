import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString, IsUrl, Matches } from 'class-validator';

/**
 * Admin config for an allowlisted partner provider.
 *
 * INTEGRATION TYPES
 *  - omitted / SPORTS_API  → the pre-existing server-side sports API + deep
 *    link behaviour (deepLinkTemplate is required, exactly as before);
 *  - SPORTS_IFRAME (WinHouse) → the provider's own book is EMBEDDED in BIG
 *    SPORT. There is no per-event deep link and no fake API secret: the row
 *    carries the PUBLIC embed key, the book origin, the environment and the two
 *    SERVER-ONLY secrets (wallet API key + callback token, AES-256-GCM
 *    encrypted at rest);
 *  - CASINO_API / LIVE_CASINO_API → represented for the product taxonomy; those
 *    integrations are configured through their own module + productTypes;
 *  - CASINO_AGGREGATOR (e.g. BigBang) → external B2B casino/game aggregator
 *    with server-to-server catalog, game launch, and seamless wallet.
 */
export const PARTNER_INTEGRATION_TYPES = [
  'SPORTS_API',
  'SPORTS_IFRAME',
  'CASINO_API',
  'LIVE_CASINO_API',
  'CASINO_AGGREGATOR',
] as const;

/** `ifr_` + 40 hex characters — the PUBLIC WinHouse embed key. */
export const EMBED_KEY_PATTERN = /^ifr_[0-9a-f]{40}$/i;

export class CreatePartnerProviderDto {
  @ApiPropertyOptional({ example: 'sports-partner-1' })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'BIGBANG', description: 'Stable provider adapter discriminator' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]*$/, { message: 'providerCode must be an uppercase adapter code' })
  providerCode?: string;

  @ApiProperty({ example: 'https://partner.example.com' })
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  baseUrl: string;

  /**
   * Server-resolved sports deep link. Required for an API integration; for an
   * EMBEDDED sportsbook (SPORTS_IFRAME) it is omitted — the book has no
   * per-event deep link — and the stored value stays empty.
   */
  @ApiPropertyOptional({ example: '/sport/{sportSlug}/event/{externalEventId}' })
  @IsOptional()
  @IsString()
  deepLinkTemplate?: string;

  @ApiPropertyOptional({ enum: PARTNER_INTEGRATION_TYPES })
  @IsOptional()
  @IsIn([...PARTNER_INTEGRATION_TYPES])
  integrationType?: (typeof PARTNER_INTEGRATION_TYPES)[number];

  @ApiPropertyOptional({ enum: ['sandbox', 'production'] })
  @IsOptional()
  @IsIn(['sandbox', 'production'])
  environment?: 'sandbox' | 'production';

  /** PUBLIC embed key (`ifr_` + 40 hex). Never the wallet API key. */
  @ApiPropertyOptional({ example: 'ifr_0123456789abcdef0123456789abcdef01234567' })
  @IsOptional()
  @IsString()
  @Matches(EMBED_KEY_PATTERN, {
    message: 'embedKey must look like ifr_ followed by 40 hex characters',
  })
  embedKey?: string;

  /** Book origin the loader/iframe is served from. */
  @ApiPropertyOptional({ example: 'https://iframe.winhouse.bet' })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  embedBaseUrl?: string;

  /** Exact frontend origin to register in the provider portal (public metadata). */
  @ApiPropertyOptional({ example: 'https://tanvionroyale.vercel.app' })
  @IsOptional()
  @IsString()
  domain?: string;

  /** Exact callback base; the provider appends /user-data and /balance-change. */
  @ApiPropertyOptional({ example: 'https://tanvionroyale.onrender.com/api/v1/winhouse' })
  @IsOptional()
  @IsString()
  walletBaseUrl?: string;

  /** Optional exact public outbound IP for the provider's server whitelist. */
  @ApiPropertyOptional({ example: '<verified Render Dedicated Outbound IP>' })
  @IsOptional()
  @IsString()
  serverIp?: string;

  /** Server-only HMAC signing key — encrypted at rest, never returned. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  walletApiKey?: string;

  /** Server-only callback token — encrypted at rest, never returned. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  callbackToken?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  /** API key -- encrypted at rest; never returned raw from the API. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  apiKey?: string;

  /** API secret -- encrypted at rest; never returned raw from the API. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  apiSecret?: string;

  @ApiPropertyOptional({ example: 'api-key' })
  @IsOptional()
  @IsString()
  authMode?: string;

  @ApiPropertyOptional({ example: 'v2' })
  @IsOptional()
  @IsString()
  apiVersion?: string;
}

export class UpdatePartnerProviderDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ example: 'BIGBANG', description: 'Stable provider adapter discriminator' })
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z][A-Z0-9_]*$/, { message: 'providerCode must be an uppercase adapter code' })
  providerCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https'] })
  baseUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  deepLinkTemplate?: string;

  @ApiPropertyOptional({ enum: PARTNER_INTEGRATION_TYPES })
  @IsOptional()
  @IsIn([...PARTNER_INTEGRATION_TYPES])
  integrationType?: (typeof PARTNER_INTEGRATION_TYPES)[number];

  @ApiPropertyOptional({ enum: ['sandbox', 'production'] })
  @IsOptional()
  @IsIn(['sandbox', 'production'])
  environment?: 'sandbox' | 'production';

  /** PUBLIC embed key; '' clears it (an embedded row without a key is unusable). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  embedKey?: string;

  /** Book origin; '' clears it, omission keeps it. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  embedBaseUrl?: string;

  /** Exact frontend origin registered in the provider portal (public metadata). */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  domain?: string;

  /** Exact callback base; the provider appends /user-data and /balance-change. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  walletBaseUrl?: string;

  /** Optional exact public outbound IP; '' clears it, omission preserves it. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  serverIp?: string;

  /** Server-only wallet API key; '' clears it, omission keeps it. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  walletApiKey?: string;

  /** Server-only callback token; '' clears it, omission keeps it. */
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  callbackToken?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  apiKey?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  apiSecret?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  authMode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  apiVersion?: string;
}