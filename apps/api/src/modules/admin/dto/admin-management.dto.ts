import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

/**
 * Admin-management DTOs (SUPER_ADMIN-only endpoints).
 *
 * roleNames / permissionNames are FULL replacement sets — anything not listed
 * is removed. SUPER_ADMIN is never grantable or editable through these
 * endpoints (enforced again at service level): the only supported path to
 * SUPER_ADMIN is the database/scripts/promote-admin.ts script.
 */
export class CreateAdminUserDto {
  @ApiProperty({ example: 'staff@example.com' })
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'support_staff', minLength: 3, maxLength: 32 })
  @IsString()
  @MinLength(3)
  @MaxLength(32)
  @Matches(/^[a-zA-Z0-9_]+$/, { message: 'username may only contain letters, numbers and underscores' })
  username!: string;

  @ApiProperty({ example: 'Str0ngPassw0rd!', minLength: 8, maxLength: 128 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  firstName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(64)
  lastName?: string;

  @ApiProperty({
    type: [String],
    example: ['SUPPORT'],
    description: 'Full replacement set of role names. SUPER_ADMIN is rejected — use the promote-admin script.',
  })
  @IsArray()
  @IsString({ each: true })
  roleNames!: string[];

  /** Optional direct grants applied after the role assignment. */
  @ApiPropertyOptional({ type: [String], example: ['support.read'] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  directPermissionNames?: string[];

  /** Optional explicit denies; the server rejects overlap with grants. */
  @ApiPropertyOptional({ type: [String], example: ['wallets.manage'] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  deniedPermissionNames?: string[];
}

export class UpdateUserRolesDto {
  @ApiProperty({
    type: [String],
    example: ['SUPPORT', 'ANALYST'],
    description: 'Full replacement set of role names for this user. SUPER_ADMIN is rejected.',
  })
  @IsArray()
  @IsString({ each: true })
  roleNames!: string[];
}


export class UpdateRolePermissionsDto {
  @ApiProperty({
    type: [String],
    example: ['users.read', 'betting.read'],
    description: 'Full replacement set of permission names for this role.',
  })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionNames!: string[];
}

export class CreateRoleDto {
  @ApiProperty({ example: 'Support Agent' })
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9_\- ]+$/, { message: 'role name contains unsupported characters' })
  name!: string;

  @ApiPropertyOptional({ example: 'Customer support read/reply access' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiProperty({ type: [String], example: ['support.read', 'support.reply'] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionNames!: string[];
}

export class UpdateRoleDto {
  @ApiPropertyOptional({ example: 'Support Agent' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  @Matches(/^[a-zA-Z0-9_\- ]+$/, { message: 'role name contains unsupported characters' })
  name?: string;

  @ApiPropertyOptional({ example: 'Customer support read/reply access' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @ApiPropertyOptional({ type: [String], example: ['support.read'] })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissionNames?: string[];
}

/** Full replacement of a staff member's direct permission assignments. */
export class UpdateUserPermissionsDto {
  @ApiProperty({ type: [String], example: ['support.reply'] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  grantPermissionNames!: string[];

  @ApiProperty({ type: [String], example: ['wallets.manage'] })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  denyPermissionNames!: string[];
}

