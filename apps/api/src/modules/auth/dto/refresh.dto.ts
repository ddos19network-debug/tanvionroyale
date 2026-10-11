import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class RefreshDto {
  @ApiProperty({ description: 'Opaque refresh token issued at login' })
  @IsString()
  @MinLength(16)
  @MaxLength(256)
  refreshToken!: string;
}
