import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * User / staff moderation DTOs.
 *
 * Every mutating moderation action REQUIRES a reason — the same accountability
 * rule the existing wallet adjustment endpoint enforces. Nothing here is
 * optional-forever: a reason-less suspend/ban/delete is impossible by design.
 *
 * Profile fields are all optional, but at least one must be present; the
 * service rejects an empty change set (400) instead of writing a no-op.
 * Sending an empty string for email/phone/username clears that field.
 */
export class AdminModerationReasonDto {
  @ApiProperty({
    example: 'Confirmed multi-account bonus abuse (tickets #4821, #4830)',
    minLength: 5,
    maxLength: 500,
    description: 'Mandatory justification for the moderation action. Audited.',
  })
  @IsString()
  @MinLength(5, { message: 'reason must be at least 5 characters' })
  @MaxLength(500, { message: 'reason must be at most 500 characters' })
  reason!: string;
}

/** Admin-editable identity fields of a user (or staff) account. */
export class AdminUpdateUserProfileDto extends AdminModerationReasonDto {
  @ApiPropertyOptional({ example: 'player@example.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({ example: '+447911123456' })
  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'phone must be a valid E.164 number' })
  phone?: string;

  @ApiPropertyOptional({ example: 'matchfan_01', minLength: 3, maxLength: 32 })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  @Matches(/^[a-zA-Z0-9_]+$/, {
    message: 'username may only contain letters, numbers and underscores',
  })
  username?: string;

  @ApiPropertyOptional({ example: 'Md' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  firstName?: string;

  @ApiPropertyOptional({ example: 'Rahman' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  lastName?: string;
}

/**
 * Password reset by an admin.
 *
 * newPassword is OPTIONAL: when omitted the service generates a high-entropy
 * temporary password, returns it once in the response and stores only its
 * argon2id hash. Either way every active session of the target is revoked.
 */
export class AdminResetPasswordDto extends AdminModerationReasonDto {
  @ApiPropertyOptional({
    example: 'Str0ngPassw0rd!',
    minLength: 8,
    maxLength: 128,
    description:
      'New password. Leave empty to have a secure random password generated and returned once.',
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword?: string;
}