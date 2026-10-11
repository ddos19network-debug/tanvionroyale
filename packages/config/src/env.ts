/**
 * Lightweight environment access helpers.
 *
 * These intentionally avoid framework-specific loading so they can be
 * reused by both the web app and the API. They never read secrets directly
 * on the client; they are safe to call on the server/Node side.
 */

export type NodeEnv = 'development' | 'test' | 'production';

export function readNodeEnv(source: NodeJS.ProcessEnv = process.env): NodeEnv {
  switch (source.NODE_ENV) {
    case 'production':
      return 'production';
    case 'test':
      return 'test';
    default:
      return 'development';
  }
}

export function isProduction(source: NodeJS.ProcessEnv = process.env): boolean {
  return readNodeEnv(source) === 'production';
}

export function isTest(source: NodeJS.ProcessEnv = process.env): boolean {
  return readNodeEnv(source) === 'test';
}

/**
 * Read a required env var, throwing an actionable error if absent.
 * Used only by process/Edge-incompatible server code.
 */
export function requireEnv(name: string, source: NodeJS.ProcessEnv = process.env): string {
  const value = source[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/**
 * Read an optional env var with a fallback.
 */
export function optionalEnv(name: string, fallback: string, source: NodeJS.ProcessEnv = process.env): string {
  return source[name] ?? fallback;
}

/**
 * Parse an integer port from the environment with validation.
 */
export function parsePort(name: string, fallback: number, source: NodeJS.ProcessEnv = process.env): number {
  const raw = source[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid port for ${name}: ${raw}`);
  }
  return parsed;
}

/**
 * Parse a boolean-ish value from env ("true"/"1"/"yes" -> true).
 */
export function parseBoolean(name: string, fallback: boolean, source: NodeJS.ProcessEnv = process.env): boolean {
  const raw = source[name];
  if (raw === undefined) return fallback;
  return ['true', '1', 'yes', 'on'].includes(raw.toLowerCase());
}