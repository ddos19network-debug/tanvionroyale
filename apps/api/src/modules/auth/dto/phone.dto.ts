import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength, Matches } from 'class-validator';
import { IsPhoneNumber } from '../../../common/decorators/is-phone-number.decorator';
import { PHONE_REGEX } from '../../../common/utils/phone';

/**
 * Re-exported for the existing `PHONE_REGEX` consumers (identifier login,
 * canonical-shape checks). The CANONICAL definition now lives in
 * `common/utils/phone.ts` next to `normalizePhone()` â€” this alias keeps the
 * historical import path working without a second, drifting regex.
 */
export { PHONE_REGEX };

/** The one phone-field copy shown in Swagger for every phone DTO. */
const PHONE_API_EXAMPLE = {
  example: '01712345678',
  description:
    'Bangladesh mobile number (01712345678) or any international E.164 number ' +
    '(+447911123456). Both are stored canonically as E.164. Spaces, dashes and ' +
    'parentheses are accepted and ignored.',
};

export class PhoneSignupStartDto {
  @ApiProperty(PHONE_API_EXAMPLE)
  @IsString()
  @IsPhoneNumber()
  phone!: string;

  @ApiProperty({ example: 'Str0ngPassw0rd!' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  // Password strength: lower, upper, digit required (same bar as email signup).
  @Matches(/[a-z]/, { message: 'password must contain a lowercase letter' })
  @Matches(/[A-Z]/, { message: 'password must contain an uppercase letter' })
  @Matches(/\d/, { message: 'password must contain a digit' })
  password!: string;

  @ApiPropertyOptional({ example: 'matchfan_01' })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'username may only contain letters, numbers and underscores',
  })
  username?: string;

  @ApiPropertyOptional({
    example: 'TANVK2P4QZ7M3X8D',
    description:
      'Referral code from /register?ref=... Recorded once, at account creation, and immutable afterwards.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  ref?: string;
}

export class PhoneVerifySignupDto {
  @ApiProperty(PHONE_API_EXAMPLE)
  @IsString()
  @IsPhoneNumber()
  phone!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code!: string;
}

export class PhoneLoginDto {
  @ApiProperty(PHONE_API_EXAMPLE)
  @IsString()
  @IsPhoneNumber()
  phone!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}

export class OAuthExchangeDto {
  @ApiProperty()
  @IsString()
  @MinLength(16)
  @MaxLength(256)
  code!: string;
}

export class PhoneRecoveryStartDto {
  @ApiProperty(PHONE_API_EXAMPLE)
  @IsString()
  @IsPhoneNumber()
  phone!: string;
}

export class PhoneRecoveryResetDto {
  @ApiProperty(PHONE_API_EXAMPLE)
  @IsString()
  @IsPhoneNumber()
  phone!: string;

  @ApiProperty({ example: '123456' })
  @IsString()
  @MinLength(6)
  @MaxLength(6)
  code!: string;

  @ApiProperty({ example: 'Str0ngPassw0rd!' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @Matches(/[a-z]/, { message: 'password must contain a lowercase letter' })
  @Matches(/[A-Z]/, { message: 'password must contain an uppercase letter' })
  @Matches(/\d/, { message: 'password must contain a digit' })
  password!: string;
}
