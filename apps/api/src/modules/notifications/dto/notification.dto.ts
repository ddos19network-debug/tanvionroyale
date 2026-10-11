import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

/** Manual broadcast types an admin may send (subset of NotificationType). */
export const ADMIN_SEND_TYPES = [
  'SYSTEM_ANNOUNCEMENT',
  'PROMOTION',
  'SECURITY_ALERT',
  'GENERAL',
] as const;

export type AdminSendType = (typeof ADMIN_SEND_TYPES)[number];

export class RegisterDeviceDto {
  @IsString()
  @MinLength(10)
  @MaxLength(4096)
  token!: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  platform?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  browser?: string;
}

export class ListNotificationsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  page?: number;

  @IsOptional()
  @IsIn(['all', 'read', 'unread'])
  filter?: 'all' | 'read' | 'unread';
}

export class AdminSendNotificationDto {
  @IsIn(['all', 'selected', 'single'])
  mode!: 'all' | 'selected' | 'single';

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  userIds?: string[];

  @IsOptional()
  @IsUUID('4')
  userId?: string;

  @IsIn([...ADMIN_SEND_TYPES])
  type!: AdminSendType;

  @IsString()
  @MinLength(1)
  @MaxLength(120)
  title!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  actionUrl?: string;
}
