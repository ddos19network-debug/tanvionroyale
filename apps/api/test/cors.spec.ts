/* eslint-disable @typescript-eslint/no-explicit-any */
import { resolveCorsOrigins, DEFAULT_PRODUCTION_CORS_ORIGINS } from '../src/config/cors';

const PROD_ORIGIN = 'https://tanvionroyale.vercel.app';

function envWith(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { NODE_ENV: 'production', ...overrides } as unknown as NodeJS.ProcessEnv;
}

describe('CORS origin resolution (production safety)', () => {
  it('uses the CORS_ORIGIN allow-list exactly when configured', () => {
    const origin = resolveCorsOrigins(envWith({ CORS_ORIGIN: PROD_ORIGIN }));
    expect(origin).toEqual([PROD_ORIGIN]);
  });

  it('supports multiple comma-separated origins and trims whitespace/trailing slashes', () => {
    const origin = resolveCorsOrigins(
      envWith({ CORS_ORIGIN: ` ${PROD_ORIGIN}/ ,  https://staging.example.com ` }),
    );
    expect(origin).toEqual([PROD_ORIGIN, 'https://staging.example.com']);
  });

  it('falls back to the built-in production origin when CORS_ORIGIN is missing', () => {
    const origin = resolveCorsOrigins(envWith({ CORS_ORIGIN: undefined }));
    expect(origin).toEqual([...DEFAULT_PRODUCTION_CORS_ORIGINS]);
    expect(origin).toContain(PROD_ORIGIN);
  });

  it('falls back safely when CORS_ORIGIN is blank', () => {
    const origin = resolveCorsOrigins(envWith({ CORS_ORIGIN: '   ' }));
    expect(origin).toEqual([PROD_ORIGIN]);
  });

  it('NEVER honours a wildcard origin together with credentials', () => {
    const origin = resolveCorsOrigins(envWith({ CORS_ORIGIN: '*' }));
    expect(origin).not.toBe('*');
    expect(origin).not.toContain('*');
    expect(origin).toEqual([PROD_ORIGIN]);
  });

  it('keeps reflecting any origin in development when CORS_ORIGIN is unset (local dev)', () => {
    const origin = resolveCorsOrigins({
      NODE_ENV: 'development',
    } as unknown as NodeJS.ProcessEnv);
    expect(origin).toBe(true);
  });

  it('stays restricted in development when an explicit list is set', () => {
    const origin = resolveCorsOrigins({
      NODE_ENV: 'development',
      CORS_ORIGIN: 'http://localhost:3100',
    } as unknown as NodeJS.ProcessEnv);
    expect(origin).toEqual(['http://localhost:3100']);
  });
});