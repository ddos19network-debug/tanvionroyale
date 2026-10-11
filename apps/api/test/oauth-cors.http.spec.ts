/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * HTTP-level regression tests for the production Google OAuth failure.
 *
 * The browser's preflight (OPTIONS) for POST /api/v1/auth/oauth/exchange MUST
 * succeed for the production frontend origin, unauthorized origins MUST be
 * rejected, and the exchange endpoint MUST issue the token pair over HTTP
 * exactly once per one-time code.
 *
 * Boots a REAL Nest application (AuthController + the real Auth/OAuth/Otp
 * services over the in-memory Prisma fake) with the same CORS, global prefix,
 * URI versioning, validation and response-envelope wiring as
 * apps/api/src/main.ts, then exercises it with supertest.
 */
import { INestApplication, ValidationPipe, VersioningType } from '@nestjs/common';
import { APP_INTERCEPTOR, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service';
import { TransformInterceptor } from '../src/common/interceptors/transform.interceptor';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { OAuthService } from '../src/modules/auth/oauth.service';
import { OtpService } from '../src/modules/auth/otp.service';
import { makeJwtFake, makePrismaFake, makeUser } from './helpers-phase11';

const PROD_ORIGIN = 'https://tanvionroyale.vercel.app';
const EVIL_ORIGIN = 'https://evil.example';
const PROD_GOOGLE_CALLBACK = 'https://tanvionroyale.onrender.com/api/v1/auth/google/callback';
const OAUTH_ENV_KEYS = [
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_CALLBACK_URL',
  'OAUTH_ALLOWED_REDIRECTS',
] as const;

describe('Auth HTTP surface — production CORS preflight & OAuth exchange', () => {
  let app: INestApplication;
  let otp: OtpService;
  let state: ReturnType<typeof makePrismaFake>['state'];
  const prevEnv: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of OAUTH_ENV_KEYS) prevEnv[key] = process.env[key];
    Object.assign(process.env, {
      GOOGLE_CLIENT_ID: 'test-client-id',
      GOOGLE_CLIENT_SECRET: 'test-client-secret',
      GOOGLE_CALLBACK_URL: PROD_GOOGLE_CALLBACK,
      OAUTH_ALLOWED_REDIRECTS: PROD_ORIGIN,
    });

    const { prisma, state: s } = makePrismaFake();
    state = s;
    const jwt = makeJwtFake();
    otp = new OtpService(prisma);
    const authService = new AuthService(prisma, jwt as any, otp);
    const oauthService = new OAuthService(prisma, jwt as any, authService, otp);

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: authService },
        { provide: OAuthService, useValue: oauthService },
        // Dependencies of the route guards declared on the controller
        // (JwtAuthGuard injects JwtService + Reflector + PrismaService).
        { provide: JwtService, useValue: jwt },
        { provide: Reflector, useValue: new Reflector() },
        { provide: PrismaService, useValue: prisma },
        { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    // Mirror apps/api/src/main.ts production wiring:
    app.setGlobalPrefix('api');
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.enableCors({
      origin: [PROD_ORIGIN],
      credentials: true,
      allowedHeaders: ['Content-Type', 'Authorization'],
    });
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    for (const key of OAUTH_ENV_KEYS) {
      if (prevEnv[key] === undefined) delete process.env[key];
      else process.env[key] = prevEnv[key];
    }
  });

  it('OPTIONS preflight for POST /api/v1/auth/oauth/exchange succeeds for the production origin', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/v1/auth/oauth/exchange')
      .set('Origin', PROD_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')
      .expect(204);

    expect(res.headers['access-control-allow-origin']).toBe(PROD_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
    expect(String(res.headers['access-control-allow-headers'])).toMatch(/content-type/i);
  });

  it('preflight from an UNAUTHORIZED origin gets NO access-control-allow-origin header', async () => {
    const res = await request(app.getHttpServer())
      .options('/api/v1/auth/oauth/exchange')
      .set('Origin', EVIL_ORIGIN)
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')
      .expect(204);

    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('POST /api/v1/auth/oauth/exchange returns accessToken + refreshToken + user over HTTP', async () => {
    state.users.push(makeUser({ id: 'u-e2e-1' }));
    const code = await otp.createExchangeCode({ userId: 'u-e2e-1' });

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/oauth/exchange')
      .set('Origin', PROD_ORIGIN)
      .send({ code })
      .expect(200);

    expect(res.headers['access-control-allow-origin']).toBe(PROD_ORIGIN);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.user.id).toBe('u-e2e-1');
  });

  it('a one-time code CANNOT be reused over HTTP (400) even with the allowed origin', async () => {
    state.users.push(makeUser({ id: 'u-e2e-2' }));
    const code = await otp.createExchangeCode({ userId: 'u-e2e-2' });

    await request(app.getHttpServer())
      .post('/api/v1/auth/oauth/exchange')
      .set('Origin', PROD_ORIGIN)
      .send({ code })
      .expect(200);

    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/oauth/exchange')
      .set('Origin', PROD_ORIGIN)
      .send({ code })
      .expect(400);
    expect(String(res.body.message)).toMatch(/invalid or expired/i);
  });

  it('GET /api/v1/auth/google advertises the PRODUCTION backend redirect_uri (never the frontend)', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/auth/google')
      .set('Origin', PROD_ORIGIN)
      .expect(200);

    expect(res.headers['access-control-allow-origin']).toBe(PROD_ORIGIN);
    const url = new URL(res.body.data.redirectUrl);
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('redirect_uri')).toBe(PROD_GOOGLE_CALLBACK);
    expect(url.searchParams.get('redirect_uri')).not.toContain('vercel.app');
    expect(url.searchParams.get('state')).toBeTruthy();
  });
});