import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../database/prisma.service';
import { AuthService } from './auth.service';
import { OtpService } from './otp.service';
import { randomToken } from '../../common/utils/crypto';
import type { PublicUser } from '@tanvion-royale/types';
import type { TokenPair } from './auth.service';

/** OAuth providers supported by Phase 11. */
export type OAuthProvider = 'GOOGLE' | 'FACEBOOK';

/** OAuth intent: signing in, or linking a provider to an existing account. */
export type OAuthIntent = 'login' | 'link';

interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
  authorizeUrl: string;
  tokenUrl: string;
  profileUrl: string;
  scope: string;
}

/** Shape of the signed, single-use state token issued by start(). */
interface OAuthState {
  /** Provider that issued the authorization code — bound to prevent CSRF. */
  p: OAuthProvider;
  /** login | link — bound to prevent intent confusion. */
  mode: OAuthIntent;
  /** Local account id to link to (link intent only). */
  userId?: string;
  /** Optional referral code carried from the start() call (signup attribution). */
  ref?: string;
}

interface ProviderProfile {
  providerAccountId: string;
  email: string | null;
  emailVerified: boolean;
}

@Injectable()
export class OAuthService {
  private readonly logger = new Logger(OAuthService.name);

  // --------------------------------------------------------------------------
  // Provider configuration (read from the environment at construction time).
  // --------------------------------------------------------------------------

  private readonly providers: Record<OAuthProvider, OAuthProviderConfig> = {
    GOOGLE: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      callbackUrl: process.env.GOOGLE_CALLBACK_URL ?? '',
      authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      profileUrl: 'https://www.googleapis.com/oauth2/v3/userinfo',
      scope: 'openid email profile',
    },
    FACEBOOK: {
      clientId: process.env.FACEBOOK_CLIENT_ID ?? '',
      clientSecret: process.env.FACEBOOK_CLIENT_SECRET ?? '',
      callbackUrl: process.env.FACEBOOK_CALLBACK_URL ?? '',
      authorizeUrl: 'https://www.facebook.com/dialog/oauth',
      tokenUrl: 'https://graph.facebook.com/v18.0/oauth/access_token',
      profileUrl: 'https://graph.facebook.com/me',
      scope: 'email,public_profile',
    },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly authService: AuthService,
    public readonly otpService: OtpService,
  ) {}

  private providerConfig(provider: OAuthProvider): OAuthProviderConfig {
    const cfg = this.providers[provider];
    if (!cfg || !cfg.clientId || !cfg.clientSecret || !cfg.callbackUrl) {
      throw new ServiceUnavailableException(`${provider} OAuth is not configured`);
    }
    return cfg;
  }

  // --------------------------------------------------------------------------
  // Phase 11 — OAuth start (authorization request)
  // --------------------------------------------------------------------------

  /**
   * Builds the provider consent URL. The state is a signed JWT binding the
   * provider, the intent (login/link), an optional account id to link, and an
   * optional referral code — so neither the provider nor the callback can be
   * replayed across providers or intents.
   */
  async start(
    provider: OAuthProvider,
    intent: OAuthIntent,
    userId?: string,
    ref?: string,
  ): Promise<string> {
    if (intent !== 'login' && intent !== 'link') {
      throw new BadRequestException('Invalid OAuth intent');
    }
    const cfg = this.providerConfig(provider);

    const state: OAuthState = { p: provider, mode: intent };
    if (userId) state.userId = userId;
    if (ref) state.ref = ref;

    const signed = await this.jwt.signAsync(state);

    const params = new URLSearchParams({
      client_id: cfg.clientId,
      // The redirect_uri is the API callback URL — never the frontend origin.
      redirect_uri: cfg.callbackUrl,
      response_type: 'code',
      scope: cfg.scope,
      state: signed,
      ...(provider === 'GOOGLE' ? { prompt: 'select_account' } : {}),
    });

    this.logger.log(`${provider} OAuth start (intent=${intent})`);
    return `${cfg.authorizeUrl}?${params}`;
  }

  // --------------------------------------------------------------------------
  // Phase 11 — OAuth callback (provider redirects back here)
  // --------------------------------------------------------------------------

  /**
   * Validates the signed state, exchanges the provider code for a profile,
   * resolves/creates/links the local account, and returns a frontend callback
   * URL carrying ONLY a short-lived, single-use exchange code.
   */
  async handleCallback(
    provider: OAuthProvider,
    code: string,
    state: string,
    ip?: string,
    userAgent?: string,
  ): Promise<string> {
    if (!code || !code.trim()) {
      throw new BadRequestException('Missing authorization code');
    }
    if (!state || !state.trim()) {
      throw new UnauthorizedException('Missing OAuth state');
    }

    // Validate the signed state token BEFORE calling the provider: this is the
    // CSRF/replay check and it also disambiguates login vs link.
    let decoded: OAuthState;
    try {
      decoded = (await this.jwt.verifyAsync(state)) as OAuthState;
    } catch {
      throw new UnauthorizedException('Invalid OAuth state');
    }
    if (decoded.p !== provider) {
      throw new UnauthorizedException('OAuth provider mismatch');
    }
    if (decoded.mode !== 'login' && decoded.mode !== 'link') {
      throw new UnauthorizedException('Invalid OAuth intent');
    }

    const cfg = this.providerConfig(provider);

    // 1. Exchange the authorization code for a provider access token.
    let tokenRes: Response;
    try {
      tokenRes = await fetch(cfg.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          code,
          redirect_uri: cfg.callbackUrl,
          grant_type: 'authorization_code',
        }),
      });
    } catch (error) {
      this.logger.error(
        `${provider} OAuth token exchange failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new UnauthorizedException(`${provider} authentication failed`);
    }

    if (!tokenRes.ok) {
      // Read the provider's error body for diagnostics, but never surface it
      // to the client (and never in a redirect URL).
      let errorBody: string | undefined;
      try {
        errorBody = await tokenRes.text();
      } catch {}
      this.logger.error(
        `[${provider} OAuth] token exchange failed: ${tokenRes.status} ${errorBody ?? ''}`,
      );
      throw new UnauthorizedException(`${provider} authentication failed`);
    }

    let tokenPayload: { access_token?: string };
    try {
      tokenPayload = (await tokenRes.json()) as { access_token?: string };
    } catch {
      throw new UnauthorizedException(`${provider} authentication failed`);
    }
    const accessToken = tokenPayload.access_token;
    if (!accessToken) {
      throw new UnauthorizedException(`${provider} authentication failed`);
    }

    // 2. Fetch and validate the provider profile.
    const profile = await this.fetchProfile(provider, cfg, accessToken);
    const { providerAccountId, email, emailVerified } = this.extractProfile(
      provider,
      profile,
    );
    if (!providerAccountId) {
      throw new UnauthorizedException(`${provider} authentication failed`);
    }

    const normalizedEmail = email ? email.toLowerCase() : null;

    // 3. Resolve or create the local account bound to this provider account.
    const existingIdentity = await this.prisma.authIdentity.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId } },
    });

    let userId: string;

    if (existingIdentity) {
      // This provider account is already bound to a local account.
      if (decoded.mode === 'link' && existingIdentity.userId !== decoded.userId) {
        throw new ConflictException(
          'This provider account is already linked to a different account.',
        );
      }
      userId = existingIdentity.userId;
    } else if (decoded.mode === 'link') {
      // Link the provider account to the signed-in account.
      if (!decoded.userId) {
        throw new UnauthorizedException(
          'OAuth link state is missing the account id',
        );
      }
      await this.linkIdentity(provider, decoded.userId, {
        providerAccountId,
        email: normalizedEmail,
        emailVerified,
      });
      userId = decoded.userId;
    } else {
      // Login intent: bind by verified provider email, or register a new account.
      userId = await this.resolveOrCreateLoginUser(
        provider,
        normalizedEmail,
        emailVerified,
        providerAccountId,
        decoded.ref,
      );
    }

    // 4. Issue a short-lived, single-use exchange code and redirect to the
    //    frontend callback with NOTHING but that code in the URL — tokens are
    //    issued exclusively by the authenticated POST /auth/oauth/exchange step.
    const exchangeCode = await this.otpService.createExchangeCode({ userId });
    const redirectUrl = this.buildCallbackRedirectUrl(exchangeCode);

    this.logger.log(
      `${provider} OAuth callback validated (mode=${decoded.mode}); redirecting with a one-time exchange code`,
    );
    return redirectUrl;
  }

  /**
   * Links a provider account to an existing local account. Refuses to bind a
   * provider account that already belongs to a different user.
   */
  async linkIdentity(
    provider: OAuthProvider,
    userId: string,
    identity: { providerAccountId: string; email: string | null; emailVerified: boolean },
  ): Promise<void> {
    const existing = await this.prisma.authIdentity.findUnique({
      where: {
        provider_providerAccountId: { provider, providerAccountId: identity.providerAccountId },
      },
    });
    if (existing && existing.userId !== userId) {
      throw new ConflictException(
        'This provider account is already linked to a different account.',
      );
    }
    if (!existing) {
      await this.prisma.authIdentity.create({
        data: { provider, providerAccountId: identity.providerAccountId, userId },
      });
    }
  }

  private async resolveOrCreateLoginUser(
    provider: OAuthProvider,
    email: string | null,
    emailVerified: boolean,
    providerAccountId: string,
    ref?: string,
  ): Promise<string> {
    if (email) {
      const existing = await this.prisma.user.findUnique({ where: { email } });
      if (existing) {
        // Auto-link only when the provider vouches for the email (Google's
        // verified-email claim). Facebook has no reliable verified-email flag,
        // so a Facebook email never auto-merges into an existing account.
        if (provider === 'GOOGLE' && emailVerified) {
          await this.prisma.authIdentity.create({
            data: { provider, providerAccountId, userId: existing.id },
          });
          return existing.id;
        }
        throw new ConflictException(
          'An account with this email already exists. Sign in with that account instead.',
        );
      }
      // No existing account: create one. Google requires a verified email so an
      // attacker cannot claim an address they do not own.
      if (provider === 'GOOGLE' && !emailVerified) {
        throw new ConflictException("This Google account's email is not verified");
      }
      return this.createOAuthUser(provider, email, emailVerified, providerAccountId, ref);
    }

    // Provider returned no email: create an account without one.
    return this.createOAuthUser(provider, null, false, providerAccountId, ref);
  }

  private async createOAuthUser(
    provider: OAuthProvider,
    email: string | null,
    emailVerified: boolean,
    providerAccountId: string,
    ref?: string,
  ): Promise<string> {
    // Google's verified-email claim is authoritative; Facebook's is not.
    const emailIsVerified = provider === 'GOOGLE' && emailVerified;

    const username = await this.uniqueUsername(
      this.suggestUsername(email, providerAccountId),
    );

    const user = await this.prisma.user.create({
      data: {
        email,
        username,
        // Unusable random secret: OAuth-only accounts gain a real password only
        // through the authenticated set-password flow.
        passwordHash: randomToken(32),
        passwordSetAt: null,
        status: 'PENDING',
        accountType: 'CUSTOMER',
        emailVerified: emailIsVerified,
        emailVerifiedAt: emailIsVerified ? new Date() : null,
        timezone: 'UTC',
        authIdentities: { create: { provider, providerAccountId } },
      },
    });

    if (emailIsVerified && email) {
      await this.prisma.verification.upsert({
        where: { userId_type: { userId: user.id, type: 'EMAIL' } },
        update: { status: 'VERIFIED', verifiedAt: new Date() },
        create: {
          userId: user.id,
          type: 'EMAIL',
          status: 'VERIFIED',
          verifiedAt: new Date(),
        },
      });
    }

    // Referral attribution for the OAuth signup — best-effort, never fatal.
    if (ref) {
      await this.authService.attributeReferral(user.id, ref).catch(() => undefined);
    }

    return user.id;
  }

  private suggestUsername(email: string | null, providerAccountId: string): string {
    const base = email
      ? email.toLowerCase().split('@')[0].replace(/[^a-z0-9]/g, '')
      : `user-${providerAccountId}`;
    return (base || 'user').slice(0, 32);
  }

  private async uniqueUsername(base: string): Promise<string> {
    let username = base;
    for (let attempt = 0; attempt < 5; attempt++) {
      const exists = await this.prisma.user.findUnique({
        where: { username },
        select: { id: true },
      });
      if (!exists) return username;
      username = `${base.slice(0, 24)}_${randomToken(8)}`;
    }
    throw new ConflictException('Unable to create an available username');
  }

  // --------------------------------------------------------------------------
  // Provider token exchange + profile fetch
  // --------------------------------------------------------------------------

  private async fetchProfile(
    provider: OAuthProvider,
    cfg: OAuthProviderConfig,
    accessToken: string,
  ): Promise<unknown> {
    const url =
      provider === 'GOOGLE'
        ? cfg.profileUrl
        : `${cfg.profileUrl}?fields=id,email,name`;
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    } catch (error) {
      this.logger.error(
        `${provider} OAuth profile fetch failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      throw new UnauthorizedException(`${provider} authentication failed`);
    }
    if (!res.ok) {
      this.logger.error(`${provider} OAuth profile fetch failed: ${res.status}`);
      throw new UnauthorizedException(`${provider} authentication failed`);
    }
    try {
      return await res.json();
    } catch {
      throw new UnauthorizedException(`${provider} authentication failed`);
    }
  }

  private extractProfile(
    provider: OAuthProvider,
    profile: unknown,
  ): ProviderProfile {
    const p = profile as Record<string, unknown> | null;
    if (!p) {
      throw new UnauthorizedException(`${provider} authentication failed`);
    }
    if (provider === 'GOOGLE') {
      return {
        providerAccountId: String(p['sub'] ?? ''),
        email: typeof p['email'] === 'string' ? p['email'] : null,
        emailVerified: p['email_verified'] === true,
      };
    }
    return {
      providerAccountId: String(p['id'] ?? ''),
      email: typeof p['email'] === 'string' ? p['email'] : null,
      emailVerified: false,
    };
  }

  // --------------------------------------------------------------------------
  // Frontend callback URL — allowlist-validated, code-only query string.
  // --------------------------------------------------------------------------

  private buildCallbackRedirectUrl(exchangeCode: string): string {
    const allowed = (process.env.OAUTH_ALLOWED_REDIRECTS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      // Normalize trailing slashes so the callback path is never doubled.
      .map((s) => (s.endsWith("/") ? s.slice(0, -1) : s));
    if (allowed.length === 0) {
      throw new ServiceUnavailableException(
        'OAuth callback redirect targets are not configured',
      );
    }
    return `${allowed[0]}/oauth/callback?code=${encodeURIComponent(exchangeCode)}`;
  }

  // --------------------------------------------------------------------------
  // Phase 13 — exchange the one-time code for the application session
  // --------------------------------------------------------------------------

  /**
   * Consumes a one-time OAuth exchange code and issues the real token pair.
   * Codes are short-lived, single-use, and carry only the local user id.
   */
  async exchange(
    code: string,
    ip?: string,
    userAgent?: string,
  ): Promise<TokenPair & { user: PublicUser }> {
    const payload = await this.otpService.consumeExchangeCode<{
      userId: unknown;
    }>(code);

    const userId = payload?.userId;
    if (typeof userId !== 'string' || !userId) {
      throw new UnauthorizedException('Invalid OAuth exchange code');
    }

    return this.authService.issueSession(userId, ip, userAgent);
  }
}
