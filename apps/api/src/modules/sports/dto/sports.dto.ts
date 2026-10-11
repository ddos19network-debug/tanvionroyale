import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateSportDto {
  @ApiProperty({ example: 'Football' })
  @IsString()
  @Length(1, 64)
  name!: string;

  @ApiProperty({ example: 'football' })
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug may only contain lowercase letters, numbers and hyphens',
  })
  @Length(2, 64)
  slug!: string;

  @ApiPropertyOptional({ example: 'The world game' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ example: 'football.svg' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  icon?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class UpdateSportDto {
  @ApiPropertyOptional({ example: 'Football' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  name?: string;

  @ApiPropertyOptional({ example: 'football' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug may only contain lowercase letters, numbers and hyphens',
  })
  @Length(2, 64)
  slug?: string;

  @ApiPropertyOptional({ example: 'The world game' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ example: 'football.svg' })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  icon?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class CreateGameDto {
  @ApiProperty({ format: 'uuid', description: 'Parent sport id' })
  @IsUUID('4', { message: 'sportId must be a valid UUID' })
  sportId!: string;

  @ApiProperty({ example: 'Premier League Match Winner' })
  @IsString()
  @Length(1, 64)
  name!: string;

  @ApiProperty({ example: 'premier-league-match-winner' })
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug may only contain lowercase letters, numbers and hyphens',
  })
  @Length(2, 64)
  slug!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class UpdateGameDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('4', { message: 'sportId must be a valid UUID' })
  sportId?: string;

  @ApiPropertyOptional({ example: 'Premier League Match Winner' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  name?: string;

  @ApiPropertyOptional({ example: 'premier-league-match-winner' })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug may only contain lowercase letters, numbers and hyphens',
  })
  @Length(2, 64)
  slug?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  sortOrder?: number;
}

export class UpdateGameAvailabilityDto {
  @ApiProperty({ example: false, description: 'Enable gambling for this game' })
  @IsIn([true, false])
  gamblingEnabled!: boolean;
}

export class UpsertProviderMappingDto {
  @ApiProperty({ example: 'mock-operator', description: 'Provider name (OperatorProviderInterface.name)' })
  @IsString()
  @Length(1, 64)
  providerName!: string;

  @ApiProperty({ example: 'sport-football', description: 'Provider game/event identifier' })
  @IsString()
  @Length(1, 128)
  externalGameId!: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'INACTIVE'])
  status?: 'ACTIVE' | 'INACTIVE';
}
