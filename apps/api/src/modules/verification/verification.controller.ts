import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { VerificationService } from './verification.service';
import { SetEmailDto, RemoveIdentifierDto } from './dto/verification-management.dto';

@ApiTags('verification')
@Controller('verification')
export class VerificationController {
  constructor(private readonly verificationService: VerificationService) {}

  private context(req: Request): { ip?: string; userAgent?: string } {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the phone / email / face verification status' })
  async status(@CurrentUser() auth: AuthenticatedUser) {
    return this.verificationService.getStatus(auth.id);
  }

  @Get('methods')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List the login methods linked to the account' })
  async methods(@CurrentUser() auth: AuthenticatedUser) {
    return this.verificationService.getLoginMethods(auth.id);
  }

  @Post('phone/send')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send a phone verification OTP' })
  async sendPhone(@CurrentUser() auth: AuthenticatedUser, @Body('phone') phone?: string) {
    return this.verificationService.sendPhoneVerification(auth.id, phone);
  }

  @Post('phone/verify')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify the phone with the OTP' })
  async verifyPhone(@CurrentUser() auth: AuthenticatedUser, @Body('code') code: string) {
    return this.verificationService.verifyPhone(auth.id, code);
  }

  /**
   * Settings — add/change the account email (Parts 5/6). Stores the address
   * UNVERIFIED; the existing emailed-link/OTP flows are the only way it ever
   * becomes VERIFIED. Password-confirmed, throttled.
   */
  @Post('email/set')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Add or change the account email (never auto-verifies)' })
  async setEmail(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() dto: SetEmailDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.verificationService.setEmail(auth.id, dto.email, dto.currentPassword, ip, userAgent);
  }

  /** Settings — remove the email (refused server-side when it is the last login/recovery path). */
  @Delete('email')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Remove the account email (safety-checked, password-confirmed)' })
  async removeEmail(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() dto: RemoveIdentifierDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.verificationService.removeEmail(auth.id, dto.currentPassword, ip, userAgent);
  }

  /** Settings — remove the phone (refused server-side when it is the last login/recovery path). */
  @Delete('phone')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Remove the phone number (safety-checked, password-confirmed)' })
  async removePhone(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() dto: RemoveIdentifierDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.verificationService.removePhone(auth.id, dto.currentPassword, ip, userAgent);
  }

  @Post('email/send')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send an email verification token' })
  async sendEmail(@CurrentUser() auth: AuthenticatedUser) {
    return this.verificationService.sendEmailVerification(auth.id);
  }

  @Post('email/verify')
  @HttpCode(HttpStatus.OK)
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify the email with the one-time emailed token' })
  async verifyEmail(@Body('token') token: string) {
    return this.verificationService.verifyEmail(token);
  }

  @Post('email/send-otp')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send an email verification OTP (6-digit code)' })
  async sendEmailOtp(@CurrentUser() auth: AuthenticatedUser) {
    return this.verificationService.sendEmailOtp(auth.id);
  }

  @Post('email/verify-otp')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify the email with the 6-digit OTP' })
  async verifyEmailOtp(@CurrentUser() auth: AuthenticatedUser, @Body('code') code: string) {
    return this.verificationService.verifyEmailOtp(auth.id, code);
  }

  @Post('face/start')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Start an independent face verification case' })
  async startFace(@CurrentUser() auth: AuthenticatedUser) {
    return this.verificationService.startFaceVerification(auth.id);
  }

  @Post('methods/disconnect')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Disconnect a linked login method (lockout-protected)' })
  async disconnect(
    @CurrentUser() auth: AuthenticatedUser,
    @Body('provider') provider: 'PHONE' | 'GOOGLE' | 'FACEBOOK',
  ) {
    return this.verificationService.disconnectMethod(auth.id, provider);
  }

  /** Provider link-mode callbacks redirect here via the shared handler. */
  @Get('link/callback')
  @Public()
  @ApiOperation({ summary: 'OAuth link callback landing (informational)' })
  async linkInfo(@Query('linked') linked?: string) {
    return { linked: linked ?? null };
  }
}
