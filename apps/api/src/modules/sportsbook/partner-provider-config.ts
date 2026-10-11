import { isIP } from 'node:net';
import type { Prisma } from '../../generated/prisma';


/** Exact provider-dashboard fields that are safe to return to the Admin UI. */
export interface EmbeddedProviderPublicConfig {
  /** Exact frontend origin registered in the provider portal (no path/wildcard). */
  domain: string | null;
  /** Exact seamless-wallet base URL; WinHouse appends /user-data and /balance-change. */
  walletBaseUrl: string | null;
  /** Optional exact outbound address for the provider's POST /tenant/session check. */
  serverIp: string | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** An exact HTTPS origin such as https://example.com, with no path/query/fragment. */
export function normalizeProviderDomain(raw: string | null | undefined): string | null {
  const candidate = (raw ?? '').trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.hostname.includes('*') ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname !== '' && parsed.pathname !== '/')
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

/** The verified TANVION callback base; WinHouse appends the two documented paths. */
export function normalizeWinHouseWalletBaseUrl(
  raw: string | null | undefined,
): string | null {
  const candidate = (raw ?? '').trim();
  if (!candidate) return null;
  try {
    const parsed = new URL(candidate);
    const path = parsed.pathname.replace(/\/+$/, '');
    if (
      parsed.protocol !== 'https:' ||
      parsed.username ||
      parsed.password ||
      parsed.hostname.includes('*') ||
      parsed.search ||
      parsed.hash ||
      path !== '/api/v1/winhouse'
    ) {
      return null;
    }
    return `${parsed.origin}/api/v1/winhouse`;
  } catch {
    return null;
  }
}

/** A single exact public outbound IP; CIDR and multiple values are not verified by the provider contract. */
export function normalizeProviderServerIp(raw: string | null | undefined): string | null {
  const candidate = (raw ?? '').trim();
  return candidate && isIP(candidate) !== 0 && !isLocalOrSharedIp(candidate) ? candidate : null;
}

function isLocalOrSharedIp(value: string): boolean {
  const address = value.split('/', 1)[0] ?? '';
  if (address.includes(':')) {
    const normalized = address.toLowerCase();
    return (
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith('2001:db8') ||
      normalized.startsWith('ff')
    );
  }

  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet))) return true;
  const [a, b] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 2 || b === 88 || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || b === 51)) ||
    (a === 203 && b === 0) ||
    a >= 224
  );
}

/** Reads only the allowlisted public keys from existing JSON config. */
export function readEmbeddedProviderPublicConfig(value: unknown): EmbeddedProviderPublicConfig {
  const config = record(value);
  return {
    domain: normalizeProviderDomain(
      typeof config?.['domain'] === 'string' ? config['domain'] : null,
    ),
    walletBaseUrl: normalizeWinHouseWalletBaseUrl(
      typeof config?.['walletBaseUrl'] === 'string' ? config['walletBaseUrl'] : null,
    ),
    serverIp: normalizeProviderServerIp(
      typeof config?.['serverIp'] === 'string' ? config['serverIp'] : null,
    ),
  };
}

/** Builds a clean JSON object; unknown or credential-like keys are never copied. */
export function makeEmbeddedProviderPublicConfig(input: {
  domain?: string | null;
  walletBaseUrl?: string | null;
  serverIp?: string | null;
}): Prisma.InputJsonObject {
  const domain = normalizeProviderDomain(input.domain);
  const walletBaseUrl = normalizeWinHouseWalletBaseUrl(input.walletBaseUrl);
  const serverIp = normalizeProviderServerIp(input.serverIp);
  return {
    domain,
    walletBaseUrl,
    ...(serverIp ? { serverIp } : {}),
  } as Prisma.InputJsonObject;
}
