import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, MaxLength, Min } from 'class-validator';

export class ListGamesQueryDto {
  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ description: 'Search game slug' })
  @IsOptional()
  @MaxLength(128)
  @Matches(/^[a-zA-Z0-9 _\-:./+@#]*$/, { message: 'search contains invalid characters' })
  search?: string;
}
