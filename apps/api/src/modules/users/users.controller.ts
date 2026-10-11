import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { SetPasswordDto } from './dto/set-password.dto';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  private context(req: Request): { ip?: string; userAgent?: string } {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  @Get('me')
  @ApiOperation({ summary: 'Get the authenticated user profile' })
  async me(@CurrentUser() auth: AuthenticatedUser) {
    return this.usersService.getMe(auth);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update editable profile fields' })
  async updateProfile(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() dto: UpdateProfileDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.usersService.updateProfile(auth, dto, ip, userAgent);
  }

  @Post('me/change-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Change password and revoke all other sessions' })
  async changePassword(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    const { ip, userAgent } = this.context(req);
    await this.usersService.changePassword(auth, dto, ip, userAgent);
  }

  @Post('me/set-password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Set a password for an OAuth-only account (authenticated)' })
  async setPassword(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() dto: SetPasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    const { ip, userAgent } = this.context(req);
    await this.usersService.setPassword(auth, dto.newPassword, ip, userAgent);
  }

  @Get('me/sessions')
  @ApiOperation({ summary: 'List active sessions for the current user' })
  async sessions(@CurrentUser() auth: AuthenticatedUser) {
    return this.usersService.listSessions(auth);
  }

  @Delete('me/sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke one of your other sessions' })
  async revokeSession(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('sessionId') sessionId: string,
    @Req() req: Request,
  ): Promise<void> {
    const { ip, userAgent } = this.context(req);
    await this.usersService.revokeSession(auth, sessionId, ip, userAgent);
  }
}
