import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * Settings Account & Security DTOs (master prompt Parts 5–7 / 11).
 *
 * The global ValidationPipe runs with whitelist + forbidNonWhitelisted, so no
 * unknown field (kycStatus, emailVerified, accountType, …) can ever reach these
 * handlers from the client. Passwords are validated as present and bounded —
 * they are verified server-side against the argon2id hash and never logged.
 */
export class SetEmailDto {
  @ApiProperty({ example: 'tanvirxxxx@gmail.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ description: 'Current account password (confirmation for the identifier change)' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;
}

export class RemoveIdentifierDto {
  @ApiProperty({ description: 'Current account password (confirmation for the removal)' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;
}