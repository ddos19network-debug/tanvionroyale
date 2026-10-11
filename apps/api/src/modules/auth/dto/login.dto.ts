import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Customer sign-in payload (POST /auth/login) — ONE field for both customer
 * identifier kinds: an email address OR an E.164 phone number, matching the
 * single "Email or Phone Number" field on the customer login screen.
 *
 * Format detection happens server-side in AuthService.login() (canonical
 * E.164 PHONE_REGEX → phone path, everything else → trimmed/lower-cased email
 * path). Strict shape only: no other properties are accepted (the global
 * ValidationPipe runs with whitelist + forbidNonWhitelisted), and the password
 * bar is unchanged (min 8 / max 128).
 */
export class LoginDto {
  @ApiProperty({
    description: 'Email address or E.164 phone number',
    example: 'user@example.com',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(254)
  identifier!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
