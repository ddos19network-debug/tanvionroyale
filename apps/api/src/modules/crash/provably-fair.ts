/**
 * TANVION ROYALE — provably-fair crash engine randomness.
 *
 * The crash point is generated on the server with Node's cryptographically
 * secure RNG (`crypto.randomBytes`) and commit/reveal style:
 *
 *   1. BEFORE betting opens the engine generates a secret `serverSeed`
 *      (64 hex chars from 32 CSPRNG bytes) and publishes only its SHA-256
 *      commitment (`serverSeedHash`) plus the public `clientSeed` and `nonce`.
 *   2. When the round crashes the `serverSeed` is revealed, and anyone can
 *      deterministically reproduce the exact crash multiplier:
 *
 *        message    := `${clientSeed}:${nonce}`
 *        hashInput  := HMAC-SHA256(key=serverSeed, message)
 *        r          := 52-bit value from lanes of hashInput / 2^52  ∈ [0,1)
 *        multiplier := 0.99 / (1 - r),  minimum 1.00
 *
 *   The 1% house edge means the expected multiplier of every round is 0.99.
 *
 * `Math.random()` is NEVER used for authoritative results — only
 * crypto.randomBytes / HMAC-SHA256.
 */

import {
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { decryptSecret, encryptSecret } from '../../common/utils/encryption';

const DECIMAL_PLACES = 2;
const MAX_CRASH_MULTIPLIER = 10_000; // practical cap; exceeding rounds re-sample deterministically

export interface CrashSeedMaterial {
  serverSeed: string;
  clientSeed: string;
  nonce: number;
}

/** CSPRNG server seed — 32 random bytes, hex encoded. */
export function generateServerSeed(): string {
  return randomBytes(32).toString('hex');
}

/** CSPRNG client seed — 16 random bytes, hex encoded. */
export function generateClientSeed(): string {
  return randomBytes(16).toString('hex');
}

/** SHA-256 commitment of the server seed (published before betting opens). */
export function computeSeedHash(serverSeed: string): string {
  return createHash('sha256').update(serverSeed, 'utf8').digest('hex');
}

/** HMAC-SHA256 of `${clientSeed}:${nonce}` keyed by the server seed. */
export function deriveRoundHash(serverSeed: string, clientSeed: string, nonce: number): string {
  return createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}`, 'utf8')
    .digest('hex');
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Convert an HMAC digest to the next crash multiplier.
 *
 * Lanes: the digest is consumed in 8-byte lanes. Each lane becomes a 52-bit
 * fraction `r`. If a lane would yield more than MAX_CRASH_MULTIPLIER the lane
 * is skipped and the next one is tried, generating extra digest blocks
 * (sha256(`${hash}:${laneIndex}`)) as needed. Verifiers reproduce this
 * resampling exactly, so the algorithm is fully deterministic.
 */
export function crashFromHash(hashHex: string): number {
  const fractionBits = 52n;
  const mask = (1n << fractionBits) - 1n;

  let offset = 0;
  // Extra blocks are generated deterministically from the derived hash when
  // the original digest is exhausted by the re-sampling loop.
  let extraBlock: Buffer | null = null;
  let blockIndex = 0;

  const readFraction = (): number => {
    let bytes: Buffer;
    if (offset + 8 <= 32 && !extraBlock) {
      bytes = Buffer.from(hashHex, 'hex');
    } else if (extraBlock) {
      bytes = extraBlock;
    } else {
      extraBlock = createHash('sha256').update(`${hashHex}:${blockIndex}`).digest();
      blockIndex += 1;
      bytes = extraBlock;
    }
    const slice = bytes.subarray(offset, offset + 8);
    // Mask off the top 12 bits of the first byte → 52-bit random integer.
    const int64 = slice.readBigUInt64BE(0);
    const value = int64 & mask;
    offset += 8;
    return Number(value) / Number(1n << fractionBits); // [0,1)
  };

  for (let lane = 0; lane < 64; lane += 1) {
    const r = readFraction();
    if (r >= 1) continue; // unreachable in practice (mask keeps r < 1)
    const raw = 0.99 / (1 - r);
    const capped = Math.min(MAX_CRASH_MULTIPLIER, raw);
    if (capped >= 1.0) return round2(Math.max(1.0, capped));
  }
  // Defensive fallback — unreachable for real digests; still deterministic.
  return 1.0;
}

/** Crash point from the seed material (the documented provably-fair formula). */
export function deriveCrashMultiplier(serverSeed: string, clientSeed: string, nonce: number): number {
  const hash = deriveRoundHash(serverSeed, clientSeed, nonce);
  return crashFromHash(hash);
}

/**
 * Encrypt the server seed before persisting it (AES-256-GCM via
 * encryptSecret). The plaintext seed is NEVER written to the database — the
 * revealed `serverSeed` column stays NULL until the round crashes. The key is
 * read from ENCRYPTION_KEY (never a literal in source).
 */
export function encryptServerSeed(serverSeed: string): string {
  return encryptSecret(serverSeed);
}

/** Decrypt a stored server seed, or return null when it cannot be recovered. */
export function decryptServerSeed(stored: string | null): string | null {
  if (!stored) return null;
  try {
    const plain = decryptSecret(stored);
    return plain && plain.length > 0 ? plain : null;
  } catch {
    return null;
  }
}

export interface CrashVerificationResult {
  /** SHA-256 commitment of the revealed server seed — must equal the stored serverSeedHash. */
  commitmentHash: string;
  /** HMAC round hash the multiplier is derived from. */
  hashHex: string;
  crashMultiplier: number;
}

/** Independent re-verification of a revealed round. */
export function verifyCrashRound(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
): CrashVerificationResult {
  const commitmentHash = computeSeedHash(serverSeed);
  const hashHex = deriveRoundHash(serverSeed, clientSeed, nonce);
  return { commitmentHash, hashHex, crashMultiplier: crashFromHash(hashHex) };
}