import { z } from 'zod';

/**
 * Open-redirect protection for post-login "return to" targets.
 *
 * Only SAME-ORIGIN, relative, absolute paths are accepted:
 *  - must start with a single "/" (no protocol-relative "//", no scheme)
 *  - must not contain a backslash or control characters
 *  - must not embed a scheme like "javascript:" or "data:" after the slash
 * Anything else falls back to the provided default.
 */
export function sanitizeNextPath(raw: string | null | undefined, fallback = '/dashboard'): string {
  if (!raw) return fallback;
  const value = raw.trim();
  if (value.length === 0 || value.length > 512) return fallback;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(value)) return fallback;
  // Reject any "<scheme>:" sequence anywhere in the path (e.g. "javascript:").
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value.slice(1))) return fallback;
  return value;
}

export const nextPathSchema = z.string().max(512).optional().nullable();
