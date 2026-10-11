import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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

/**
 * Admin panel query DTOs.
 *
 * Everything the admin UI sends is validated here so database queries
 * never trust raw client input.
 *
 * Pagination follows the shared Paginated<T> contract.
 */

const EVENT_STATUSES = [
  'SCHEDULED',
  'LIVE',
  'SUSPENDED',
  'FINISHED',
  'CANCELLED',
] as const;

const BET_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'CANCELLED',
  'SETTLED',
  'VOID',
] as const;

const USER_STATUSES = [
  'PENDING',
  'ACTIVE',
  'SUSPENDED',
  'BANNED',
  'LOCKED',
  'CLOSED',
] as const;

const TX_TYPES = [
  'DEPOSIT',
  'WITHDRAWAL',
  'BET_STAKE',
  'BET_PAYOUT',
  'BET_REFUND',
  'ADJUSTMENT',
] as const;

const TX_STATUSES = [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'REVERSED',
] as const;

const WALLET_CURRENCIES = ['BDT', 'USD', 'EUR'] as const;

export class AdminPaginationDto {
  @ApiPropertyOptional({
    example: 1,
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    example: 20,
    minimum: 1,
    maximum: 100,
    default: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class ListAdminUsersQueryDto extends AdminPaginationDto {
  @ApiPropertyOptional({
    description: 'Search email / username / phone / name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    enum: USER_STATUSES,
  })
  @IsOptional()
  @IsIn(USER_STATUSES)
  status?: (typeof USER_STATUSES)[number];
}

export class AdminUserDetailDto {
  @ApiProperty({
    format: 'uuid',
  })
  @IsUUID('4', {
    message: 'userId must be a valid UUID',
  })
  userId!: string;
}

export class ListAdminBetsQueryDto extends AdminPaginationDto {
  @ApiPropertyOptional({
    description: 'Search bet id / username / event name',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({
    enum: BET_STATUSES,
  })
  @IsOptional()
  @IsIn(BET_STATUSES)
  status?: (typeof BET_STATUSES)[number];

  @ApiPropertyOptional({
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4', {
    message: 'userId must be a valid UUID',
  })
  userId?: string;

  @ApiPropertyOptional({
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4', {
    message: 'eventId must be a valid UUID',
  })
  eventId?: string;
}

export class ListAdminEventsQueryDto extends AdminPaginationDto {
  @ApiPropertyOptional({
    enum: EVENT_STATUSES,
  })
  @IsOptional()
  @IsIn(EVENT_STATUSES)
  status?: (typeof EVENT_STATUSES)[number];

  @ApiPropertyOptional({
    description: 'Sport slug, e.g. football',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  sport?: string;

  @ApiPropertyOptional({
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4', {
    message: 'competitionId must be a valid UUID',
  })
  competitionId?: string;

  @ApiPropertyOptional({
    description: 'Search event name / teams',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

export class UpdateAdminEventStatusDto {
  @ApiProperty({
    enum: EVENT_STATUSES,
  })
  @IsIn(EVENT_STATUSES, {
    message: 'status must be a valid EventStatus',
  })
  status!: (typeof EVENT_STATUSES)[number];
}

export class ListAdminWalletTransactionsQueryDto
  extends AdminPaginationDto
{
  @ApiPropertyOptional({
    enum: TX_TYPES,
  })
  @IsOptional()
  @IsIn(TX_TYPES)
  type?: (typeof TX_TYPES)[number];

  @ApiPropertyOptional({
    enum: TX_STATUSES,
  })
  @IsOptional()
  @IsIn(TX_STATUSES)
  status?: (typeof TX_STATUSES)[number];

  @ApiPropertyOptional({
    enum: WALLET_CURRENCIES,
    example: 'BDT',
    description: 'Filter wallet transactions by currency',
  })
  @IsOptional()
  @IsIn(WALLET_CURRENCIES)
  currency?: (typeof WALLET_CURRENCIES)[number];
}

export class ListAdminAuditLogsQueryDto extends AdminPaginationDto {
  @ApiPropertyOptional({
    description: 'Filter by action, e.g. WALLET_ADJUSTMENT',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional({
    format: 'uuid',
  })
  @IsOptional()
  @IsUUID('4', {
    message: 'actorId must be a valid UUID',
  })
  actorId?: string;

  @ApiPropertyOptional({
    description: 'Filter by entity type, e.g. PartnerProvider',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  entityType?: string;
}

/**
 * Mandatory justification recorded with admin event status changes.
 */
export class AdminEventStatusReasonDto extends UpdateAdminEventStatusDto {
  @ApiProperty({
    example: 'Match postponed by the league',
  })
  @IsString()
  @MinLength(3, {
    message: 'reason must be at least 3 characters',
  })
  @MaxLength(500, {
    message: 'reason must be at most 500 characters',
  })
  reason!: string;
}
