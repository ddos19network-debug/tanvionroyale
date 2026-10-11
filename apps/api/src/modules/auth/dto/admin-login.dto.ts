import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Staff sign-in payload (POST /auth/admin-login).
 *
 * `identifier` accepts EITHER the staff username or the Gmail address — the
 * dedicated admin login screen offers one "Username / Gmail" field. Deliberately
 * a separate DTO from the customer LoginDto (whose identifier is an email OR
 * E.164 phone number, never a username): the staff entry point keeps its own,
 * wider identity rule while customer sign-in accepts email or phone only.
 */
export class AdminLoginDto {
  @ApiProperty({ description: 'Staff username or Gmail address', example: 'staff_username' })
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