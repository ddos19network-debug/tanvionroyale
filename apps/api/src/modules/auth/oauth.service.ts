import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  Optional,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../database/prisma.service';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { ReferralService } from '../referral/referral.service';
import { normalizeReferralCode } from '../referral/referral-code';
import { randomBytes } from 'crypto';

export type OAuthProvider = 'GOOGLE' | 'FACEBOOK';

interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

interface OAuthProfile {
  providerAccountId: string;
  email: string | null;
  /** True only when the provider's validated response explicitly asserts it. */
  emailVerified: boolean;
  displayName?: string;
}

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const FACEBOOK_AUTH_URL = 'https://www.facebook.com/v21.0/dialog/oauth';
const FACEBOOK_TOKEN_URL = 'https://graph.facebook.com/v21.0/oauth/access_token';
const FACEBOOK_PROFILE_URL = 'https://graph.facebook.com/me';

/**
 * Phase 11 — Google & Facebook OAuth (secure server-side code flow).
 *
 * - The authorization code is exchanged SERVER-SIDE with the client secret;
 *   the client never sees access tokens.
 * - Profiles are fetched from the provider's validated endpoint — no
 *   client-submitted facebookId/email/verified flag is ever trusted.
 * - Only Google's explicit `email_verified: true` OIDC claim marks an email
 *   verified. Facebook does not expose a reliable verified-email flag, so
 *   Facebook emails are NEVER auto-verified.
 * - Auto-linking by email happens only when the email is provider-verified.
 * - Login/registration completes with a short-lived one-time exchange code
 *   (never tokens in the URL).
 */
@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
    private readonly otpService: OtpService,
    // Optional so a unit test that news this service with four arguments still
    // compiles; runtime always injects it. A referral failure never fails an
    // OAuth login, exactly as in AuthService.
    @Optional() private readonly referrals?: ReferralService,
  ) {}

  private config(provider: OAuthProvider): OAuthConfig {
    const prefix = provider === 'GOOGLE' ? 'GOOGLE' : 'FACEBOOK';
    const clientId = process.env[`${prefix}_CLIENT_ID`];
    const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
    const callbackUrl = process.env[`${prefix}_CALLBACK_URL`];
    if (!clientId || !clientSecret || !callbackUrl) {
      throw new ServiceUnavailableException(
        `${provider.toLowerCase()} sign-in is not configured yet`,
      );
    }
    return { clientId, clientSecret, callbackUrl };
  }

  /**
   * Resolves the frontend base URL that receives the one-time OAuth exchange
   * redirect. ONLY OAUTH_ALLOWED_REDIRECTS (or the APP_URL fallback) is used
   * here — the provider callback URL (${provider}_CALLBACK_URL) is NEVER
   * reused as a frontend destination.
   *
   * - Entries are validated as http(s) URLs and trailing slashes are
   *   normalized so the redirect never becomes `https://host//oauth/callback`.
   * - In production a missing/empty configuration fails safely instead of
   *   silently redirecting users to a localhost fallback.
   */
  private frontendBase(): string {
    const candidates = (process.env.OAUTH_ALLOWED_REDIRECTS ?? process.env.APP_URL ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => {
        try {
          const u = new URL(s);
          return u.protocol === 'http:' || u.protocol === 'https:';
        } catch {
          return false;
        }
      });
    const base = candidates[0];
    if (base) return base.replace(/\/+$/, '');
    if (process.env.NODE_ENV === 'production') {
      throw new ServiceUnavailableException(
        'OAuth sign-in is not configured for this environment yet (missing OAUTH_ALLOWED_REDIRECTS)',
      );
    }
    return 'http://localhost:3100';
  }

  /**
   * Builds the provider consent URL with a signed, short-lived state.
   *
   * REFERRAL ATTRIBUTION (`ref`)
   *   A visitor who arrives at `/signup?ref=CODE` and then chooses Google
   *   would otherwise lose the code entirely: the browser bounces out to the
   *   provider and back, and only the one-time exchange code survives. The
   *   code is therefore carried inside the SIGNED state JWT (`ref` claim).
   *
   *   Why that is safe:
   *    - the state is signed with the server's JWT secret, so the client cannot
   *      forge or alter it;
   *    - the value is only a referral CODE, never a user id — the owner is
   *      resolved server-side afterwards, exactly as for every other signup
   *      path, so a tampered code can at worst attribute to a different real
   *      code, never to a chosen user;
   *    - it is NOT put in the OAuth provider's URL, so it never leaks to a
   *      third party;
   *    - it is only accepted when it matches the code shape this service
   *      issues, and `attributeRegistration` still applies every eligibility
   *      and self-referral guard.
   */
  async start(
    provider: OAuthProvider,
    mode: 'login' | 'link',
    userId?: string,
    ref?: string,
  ): Promise<string> {
    const cfg = this.config(provider);
    const state = await this.jwtService.signAsync(
      {
        p: provider,
        mode,
        uid: mode === 'link' ? userId : undefined,
        // Normalised + shape-validated; anything else is dropped so a junk
        // query string can never bloat the state JWT.
        ref: mode === 'login' ? normalizeReferralCode(ref) ?? undefined : undefined,
        n: randomBytes(12).toString('hex'),
      },
      // 15 minutes (not 10): Google's "unverified app" consent interstitial +
      // account chooser + 2FA can exceed 10 minutes between start() and the
      // callback, producing a TokenExpiredError -> 401 "Invalid OAuth state".
      // 15m tolerates slow consent screens while keeping the CSRF window tight.
      { expiresIn: '15m' },
    );
    if (provider === 'GOOGLE') {
      const url = new URL(GOOGLE_AUTH_URL);
      url.searchParams.set('client_id', cfg.clientId);
      url.searchParams.set('redirect_uri', cfg.callbackUrl);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', 'openid email profile');
      url.searchParams.set('state', state);
      url.searchParams.set('prompt', 'select_account');
      return url.toString();
    }
    const url = new URL(FACEBOOK_AUTH_URL);
    url.searchParams.set('client_id', cfg.clientId);
    url.searchParams.set('redirect_uri', cfg.callbackUrl);
    url.searchParams.set('state', state);
    url.searchParams.set('scope', 'email,public_profile');
    return url.toString();
  }

  /** Handles the provider callback: validates, links/creates, redirects. */
  async handleCallback(
    provider: OAuthProvider,
    code: string,
    state: string,
    _ip?: string,
    _userAgent?: string,
  ): Promise<string> {
    if (!state) throw new UnauthorizedException('Invalid OAuth state');
    if (!code) throw new BadRequestException('Missing authorization code');
    let decoded: { p?: string; mode?: string; uid?: string; ref?: string };
    try {
      decoded = await this.jwtService.verifyAsync(state);
    } catch (err) {
      // Log ONLY the failure reason (error name/message — e.g.
      // "TokenExpiredError: jwt expired"). Never log the raw state JWT, the
      // authorization code, or any token value (no secrets in logs).
      const reason = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      this.logger.warn(`OAuth state verification failed (${provider}): ${reason}`);
      throw new UnauthorizedException('Invalid OAuth state');
    }
    if (decoded.p !== provider || (decoded.mode !== 'login' && decoded.mode !== 'link')) {
      throw new UnauthorizedException('Invalid OAuth state');
    }

    const profile = await this.fetchProfile(provider, code);

    if (decoded.mode === 'link') {
      if (!decoded.uid) throw new UnauthorizedException('Invalid OAuth state');
      return this.linkIdentity(provider, decoded.uid, profile);
    }

    const userId = await this.resolveOrCreateUser(provider, profile);

    // REFERRAL ATTRIBUTION — recorded ONCE, on the same terms as every other
    // signup path. `attributeRegistration` resolves the CODE to its owner
    // server-side and applies the self-referral / duplicate / disabled-program
    // guards, so passing a code here can never assign a chosen referrer.
    // Best-effort: a referral problem must never fail an OAuth login.
    if (decoded.ref) {
      await this.referrals
        ?.attributeRegistration(userId, decoded.ref)
        .catch(() => undefined);
    }

    // The frontend exchanges this short-lived one-time code for its tokens
    // (the session itself is issued in exchange(), so no orphan sessions).
    const exchangeCode = await this.otpService.createExchangeCode({ userId });
    // Safe operational log — never includes the one-time code itself.
    this.logger.log(
      `${provider} OAuth callback validated; redirecting with a one-time exchange code`,
    );
    return `${this.frontendBase()}/oauth/callback?code=${encodeURIComponent(exchangeCode)}`;
  }

  /** Exchanges a one-time OAuth exchange code for the application tokens. */
  async exchange(code: string, ip?: string, userAgent?: string) {
    try {
      const payload = await this.otpService.consumeExchangeCode<{ userId?: unknown }>(code);
      const userId = payload && typeof payload === 'object' ? payload.userId : undefined;
      if (typeof userId !== 'string' || userId.length === 0) {
        // A consumed code MUST carry the user id it was minted for. A row
        // without one (corrupt/metadata-less row) is a safe 4xx — never an
        // unexpected 500 from destructuring a null/partial payload.
        throw new UnauthorizedException('Invalid or expired authorization code');
      }
      const session = await this.authService.issueSession(userId, ip, userAgent);
      // Safe operational log — never the code, tokens or user identifiers.
      this.logger.log('OAuth exchange succeeded (one-time code consumed, session issued)');
      return session;
    } catch (error) {
      this.logger.warn(
        `OAuth exchange rejected: ${
          error instanceof HttpException ? error.message : 'unexpected error'
        }`,
      );
      throw error;
    }
  }

  /** Links a validated provider identity to an existing signed-in user. */
  private async linkIdentity(
    provider: OAuthProvider,
    userId: string,
    profile: OAuthProfile,
  ): Promise<string> {
    const existing = await this.prisma.authIdentity.findUnique({
      where: {
        provider_providerAccountId: { provider, providerAccountId: profile.providerAccountId },
      },
    });
    if (existing && existing.userId !== userId) {
      throw new ConflictException(
        `This ${provider.toLowerCase()} account is already linked to another user`,
      );
    }
    if (!existing) {
      await this.prisma.authIdentity.create({
        data: { provider, providerAccountId: profile.providerAccountId, userId },
      });
    }
    // Google explicitly verified the email — record it once.
    if (provider === 'GOOGLE' && profile.emailVerified && profile.email) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user && user.email === profile.email && !user.emailVerified) {
        await this.prisma.user.update({
          where: { id: userId },
          data: { emailVerified: true, emailVerifiedAt: new Date() },
        });
      }
      // Keep the EMAIL verification record consistent with the user flag.
      await this.prisma.verification.upsert({
        where: { userId_type: { userId, type: 'EMAIL' } },
        update: { status: 'VERIFIED', verifiedAt: new Date() },
        create: { userId, type: 'EMAIL', status: 'VERIFIED', verifiedAt: new Date() },
      });
    }
    return `${this.frontendBase()}/verification?linked=${provider.toLowerCase()}`;
  }

  /**
   * Finds the user for a validated provider profile, or safely creates/links
   * one. Never merges accounts on unverified emails.
   */
  private async resolveOrCreateUser(
    provider: OAuthProvider,
    profile: OAuthProfile,
  ): Promise<string> {
    const identity = await this.prisma.authIdentity.findUnique({
      where: {
        provider_providerAccountId: { provider, providerAccountId: profile.providerAccountId },
      },
    });
    if (identity) return identity.userId;

    if (profile.email) {
      const byEmail = await this.prisma.user.findUnique({ where: { email: profile.email } });
      if (byEmail) {
        // Auto-link only on a provider-VERIFIED email claim (Google).
        if (profile.emailVerified) {
          await this.prisma.authIdentity.create({
            data: { provider, providerAccountId: profile.providerAccountId, userId: byEmail.id },
          });
          return byEmail.id;
        }
        throw new ConflictException(
          'An account with this email already exists. Sign in with your existing method and connect this provider from your profile.',
        );
      }
    }

    const username = `user_${randomBytes(5).toString('hex')}`;
    const userRole = await this.prisma.role.upsert({
      where: { name: 'USER' },
      update: {},
      create: { name: 'USER', description: 'Standard customer account' },
    });
    const user = await this.prisma.user.create({
      data: {
        email: profile.email,
        username,
        // Unusable random secret — OAuth-only accounts have no known password
        // unless the user explicitly sets one through the secure change flow.
        passwordHash: randomBytes(32).toString('base64url'),
        status: 'ACTIVE',
        // OAuth sign-in ALWAYS creates a customer account — never staff.
        accountType: 'CUSTOMER',
        ...(profile.emailVerified ? { emailVerified: true, emailVerifiedAt: new Date() } : {}),
        userRoles: { create: [{ roleId: userRole.id }] },
        authIdentities: { create: { provider, providerAccountId: profile.providerAccountId } },
      },
    });
    // Google's explicit `email_verified: true` claim is the only way an OAuth
    // email becomes a VERIFIED EMAIL verification record. Facebook never does.
    if (profile.emailVerified && profile.email) {
      await this.prisma.verification.upsert({
        where: { userId_type: { userId: user.id, type: 'EMAIL' } },
        update: { status: 'VERIFIED', verifiedAt: new Date() },
        create: { userId: user.id, type: 'EMAIL', status: 'VERIFIED', verifiedAt: new Date() },
      });
    }
    return user.id;
  }

  /** Exchanges the authorization code server-side and fetches the profile. */
  private async fetchProfile(provider: OAuthProvider, code: string): Promise<OAuthProfile> {
    const cfg = this.config(provider);
    if (provider === 'GOOGLE') {
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          redirect_uri: cfg.callbackUrl,
          grant_type: 'authorization_code',
        }),
      });
      if (!tokenRes.ok) {
        const errorBody = await tokenRes.text();
        console.error('[Google OAuth] token exchange failed:', tokenRes.status, errorBody);
        throw new UnauthorizedException('Google authentication failed');
      }
      const token = (await tokenRes.json()) as { access_token?: string };
      if (!token.access_token) throw new UnauthorizedException('Google authentication failed');
      const infoRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { Authorization: `Bearer ${token.access_token}` },
      });
      if (!infoRes.ok) throw new UnauthorizedException('Google authentication failed');
      const info = (await infoRes.json()) as {
        sub: string;
        email?: string;
        email_verified?: boolean;
        name?: string;
      };
      return {
        providerAccountId: info.sub,
        email: info.email?.toLowerCase() ?? null,
        emailVerified: info.email_verified === true,
        displayName: info.name,
      };
    }

    const tokenUrl = new URL(FACEBOOK_TOKEN_URL);
    tokenUrl.searchParams.set('client_id', cfg.clientId);
    tokenUrl.searchParams.set('client_secret', cfg.clientSecret);
    tokenUrl.searchParams.set('redirect_uri', cfg.callbackUrl);
    tokenUrl.searchParams.set('code', code);
    const tokenRes = await fetch(tokenUrl.toString());
    if (!tokenRes.ok) throw new UnauthorizedException('Facebook authentication failed');
    const token = (await tokenRes.json()) as { access_token?: string };
    if (!token.access_token) throw new UnauthorizedException('Facebook authentication failed');

    const profileUrl = new URL(FACEBOOK_PROFILE_URL);
    profileUrl.searchParams.set('fields', 'id,name,email');
    profileUrl.searchParams.set('access_token', token.access_token);
    const profileRes = await fetch(profileUrl.toString());
    if (!profileRes.ok) throw new UnauthorizedException('Facebook authentication failed');
    const info = (await profileRes.json()) as { id: string; name?: string; email?: string };
    // Facebook exposes no reliable "email verified" flag in this response —
    // the email is stored but NEVER auto-marked verified.
    return {
      providerAccountId: info.id,
      email: info.email?.toLowerCase() ?? null,
      emailVerified: false,
      displayName: info.name,
    };
  }
}
