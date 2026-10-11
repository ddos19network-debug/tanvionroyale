import { isProduction, readNodeEnv } from './env';

/**
 * Detects whether code is running in a browser context (client-side).
 * Useful for guarding server-only config reads.
 */
export function isClientRuntime(): boolean {
  return typeof window !== 'undefined';
}

export const NODE_ENV = readNodeEnv();
export const IS_PRODUCTION = isProduction();
export const IS_DEVELOPMENT = !IS_PRODUCTION;