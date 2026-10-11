import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import {
  SMS_PROVIDER_MODES,
  SMS_PROVIDER_NAMES,
  type SmsProviderMode,
  type SmsProviderName,
} from '../../auth/sms-provider-common';

/**
 * Admin write of the SMS provider selection.
 *
 * EVERY field is optional so an admin can change one setting without resending
 * the rest, and EVERY field is validated server-side against the closed set of
 * providers the platform actually implements — an unknown provider name is a
 * 400, never a silently stored value that would break delivery later.
 *
 * CREDENTIALS ARE NOT PART OF THIS DTO
 *   There is deliberately no field for an Account SID, an API key, a secret or
 *   a sender number. Provider credentials are configured once in the
 *   server/Render environment; this endpoint can only choose WHICH of the
 *   already-configured providers delivers the codes.
 */
export class UpdateSmsProviderSettingsDto {
  @ApiPropertyOptional({ enum: SMS_PROVIDER_MODES, description: 'twilio | vonage | auto' })
  @IsOptional()
  @IsIn(SMS_PROVIDER_MODES)
  smsProvider?: SmsProviderMode;

  @ApiPropertyOptional({ enum: SMS_PROVIDER_NAMES, description: 'Used first in auto mode' })
  @IsOptional()
  @IsIn(SMS_PROVIDER_NAMES)
  primarySmsProvider?: SmsProviderName;

  @ApiPropertyOptional({ enum: SMS_PROVIDER_NAMES, description: 'Used once after the primary fails' })
  @IsOptional()
  @IsIn(SMS_PROVIDER_NAMES)
  fallbackSmsProvider?: SmsProviderName;
}
