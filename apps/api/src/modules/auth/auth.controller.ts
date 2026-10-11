import { Body, Controller, Get, HttpCode, HttpStatus, Logger, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { AuthService } from './auth.service';
import { OAuthService } from './oauth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { AdminLoginDto } from './dto/admin-login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import {
  PhoneSignupStartDto,
  PhoneVerifySignupDto,
  PhoneLoginDto,
  OAuthExchangeDto,
  PhoneRecoveryStartDto,
  PhoneRecoveryResetDto,
} from './dto/phone.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly oauthService: OAuthService,
  ) {}


  private context(req: Request): { ip?: string; userAgent?: string } {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  @Post('register')
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a new customer account' })
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    const { ip, userAgent } = this.context(req);
    return this.authService.register(dto, ip, userAgent);
  }

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Sign in with email OR phone number (identifier) + password',
  })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const { ip, userAgent } = this.context(req);
    return this.authService.login(dto, ip, userAgent);
  }

  /**
   * Staff-only login (Part A). Same credential check as /auth/login, but the
   * account must hold ADMIN or SUPER_ADMIN — otherwise 403 with a generic
   * staff-only message. Accepts username OR Gmail via AdminLoginDto.identifier.
   * Tighter throttle (5/min) against brute force.
   * TODO: enforce 2FA for staff once the OTP flow covers admin accounts.
   */
  @Post('admin-login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Staff-only sign in (ADMIN / SUPER_ADMIN)' })
  async adminLogin(@Body() dto: AdminLoginDto, @Req() req: Request) {
    const { ip, userAgent } = this.context(req);
    return this.authService.adminLogin(dto, ip, userAgent);
  }

  @Post('refresh')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Rotate refresh token and get a new access token' })
  async refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    const { ip, userAgent } = this.context(req);
    return this.authService.refresh(dto.refreshToken, ip, userAgent);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(@CurrentUser() auth: AuthenticatedUser): Promise<void> {
    await this.authService.logout(auth);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the authenticated user profile' })
  async me(@CurrentUser() auth: AuthenticatedUser) {
    return this.authService.getMe(auth);
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Request a password reset email' })
  async forgotPassword(@Body() dto: ForgotPasswordDto): Promise<{ message: string }> {
    await this.authService.requestPasswordReset(dto.email);
    return { message: 'If the email exists, a reset link has been sent.' };
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({ summary: 'Reset the password using a reset token' })
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request): Promise<void> {
    const { ip, userAgent } = this.context(req);
    await this.authService.resetPassword(dto.token, dto.password, ip, userAgent);
  }

  @Post('verify-email')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Verify email address using the emailed token' })
  async verifyEmail(@Body('token') token: string) {
    return this.authService.verifyEmail(token);
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async resendVerification(@CurrentUser() auth: AuthenticatedUser): Promise<void> {
    await this.authService.resendVerificationEmail(auth.id);
  }

  // --------------------------------------------------------------------------
  // Phase 11 — phone + password + OTP authentication
  // --------------------------------------------------------------------------

  @Post('phone/send-otp')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Start phone signup: validate credentials and send an OTP',
    description:
      'Accepts a Bangladesh mobile number (01712345678) or any international ' +
      'E.164 number. The response echoes the canonical `phone` — always verify ' +
      'the OTP against that exact value.',
  })
  async phoneSendOtp(@Body() dto: PhoneSignupStartDto, @Req() req: Request) {
    const { ip, userAgent } = this.context(req);
    return this.authService.sendPhoneSignupOtp(dto, ip, userAgent);
  }

  @Post('phone/verify-otp')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Verify the signup OTP — activates the account (phone auto-verified) and signs in',
  })
  async phoneVerifyOtp(@Body() dto: PhoneVerifySignupDto, @Req() req: Request) {
    const { ip, userAgent } = this.context(req);
    return this.authService.verifyPhoneSignup(dto, ip, userAgent);
  }

  @Post('phone/login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Sign in with phone number + password' })
  async phoneLogin(@Body() dto: PhoneLoginDto, @Req() req: Request) {
    const { ip, userAgent } = this.context(req);
    return this.authService.loginWithPhone(dto, ip, userAgent);
  }

  // --------------------------------------------------------------------------
  // Phase 12 — phone-based password recovery
  // --------------------------------------------------------------------------

  @Post('phone/recovery/send-otp')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send a password-recovery OTP to a registered phone' })
  async phoneRecoverySendOtp(
    @Body() dto: PhoneRecoveryStartDto,
  ): Promise<{ message: string }> {
    return this.authService.startPhoneRecovery(dto.phone);
  }

  @Post('phone/recovery/reset-password')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Verify the recovery OTP, set a new password and revoke all sessions',
  })
  async phoneRecoveryReset(
    @Body() dto: PhoneRecoveryResetDto,
    @Req() req: Request,
  ): Promise<void> {
    const { ip, userAgent } = this.context(req);
    await this.authService.completePhoneRecovery(dto.phone, dto.code, dto.password, ip, userAgent);
  }

  // --------------------------------------------------------------------------
  // Phase 11 — Google / Facebook server-side OAuth
  // --------------------------------------------------------------------------

  @Get('google')
  @Public()
  @ApiOperation({
    summary: 'Start Google OAuth (login/signup)',
    description:
      'Optional `ref` referral code. It is carried in the SIGNED state token ' +
      'and resolved server-side after the callback, so an OAuth signup is ' +
      'attributed exactly like a phone or email signup.',
  })
  async googleStart(@Query('ref') ref?: string) {
    return { redirectUrl: await this.oauthService.start('GOOGLE', 'login', undefined, ref) };
  }

  @Get('google/callback')
  @Public()
  @ApiOperation({ summary: 'Google OAuth callback' })
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { ip, userAgent } = this.context(req);
    const redirectUrl = await this.oauthService.handleCallback('GOOGLE', code, state, ip, userAgent);
    res.redirect(redirectUrl);
  }

  @Get('facebook')
  @Public()
  @ApiOperation({
    summary: 'Start Facebook OAuth (login/signup)',
    description: 'Accepts the same optional `ref` referral code as the Google route.',
  })
  async facebookStart(@Query('ref') ref?: string) {
    return { redirectUrl: await this.oauthService.start('FACEBOOK', 'login', undefined, ref) };
  }

  @Get('facebook/callback')
  @Public()
  @ApiOperation({ summary: 'Facebook OAuth callback' })
  async facebookCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const { ip, userAgent } = this.context(req);
    const redirectUrl = await this.oauthService.handleCallback(
      'FACEBOOK',
      code,
      state,
      ip,
      userAgent,
    );
    res.redirect(redirectUrl);
  }

  /** Authenticated variants for linking a provider to the signed-in account. */
  @Get('google/link')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start Google OAuth in account-linking mode' })
  async googleLink(@CurrentUser() auth: AuthenticatedUser) {
    return { redirectUrl: await this.oauthService.start('GOOGLE', 'link', auth.id) };
  }

  @Get('facebook/link')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start Facebook OAuth in account-linking mode' })
  async facebookLink(@CurrentUser() auth: AuthenticatedUser) {
    return { redirectUrl: await this.oauthService.start('FACEBOOK', 'link', auth.id) };
  }

  @Post('oauth/exchange')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Exchange a one-time OAuth code for the token pair' })
  async oauthExchange(@Body() dto: OAuthExchangeDto, @Req() req: Request) {
    // Safe operational logging only — never log the code itself or tokens.
    const origin = req.headers.origin;
    this.logger.log(
      `POST /auth/oauth/exchange (origin=${origin ?? 'none'}, codePresent=${Boolean(dto?.code)})`,
    );
    const { ip, userAgent } = this.context(req);
    return this.oauthService.exchange(dto.code, ip, userAgent);
  }
}

