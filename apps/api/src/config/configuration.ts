import type { NodeEnv } from '@tanvion-royale/config';
import { isProduction, parsePort, readNodeEnv } from '@tanvion-royale/config';

/**
 * Centralised, validated runtime configuration for the API.
 * Secrets are injected via env; they are never committed or logged.
 */
export interface AppConfig {
  env: NodeEnv;
  isProduction: boolean;
  port: number;
  corsOrigins: string[];
  databaseUrl: string | undefined;
  operator: {
    provider: string;
    apiUrl: string | undefined;
    hasCredentials: boolean;
  };
}

export function loadAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = readNodeEnv(env);
  const corsOrigins =
    env.CORS_ORIGIN?.split(',')
      .map((o) => o.trim())
      .filter(Boolean) ?? [];

  return {
    env: nodeEnv,
    isProduction: isProduction(env),
    port: parsePort('API_PORT', 3000, env),
    corsOrigins,
    databaseUrl: env.DATABASE_URL,
    operator: {
      provider: env.OPERATOR_PROVIDER ?? 'mock',
      apiUrl: env.OPERATOR_API_URL,
      hasCredentials: Boolean(env.OPERATOR_API_KEY && env.OPERATOR_API_SECRET),
    },
  };
}