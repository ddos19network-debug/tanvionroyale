import { createHash, createHmac, randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret } from '../../common/utils/encryption';

/**
 * TANVION ROYALE — Royale Play provably-fair randomness (Plinko + Mines).
 *
 * `Math.random()` is NEVER used for authoritative results — only
 * crypto.randomBytes (CSPRNG) and HMAC-SHA256.
 *
 * COMMON SEED MATERIAL (generated server-side, per round):
 *   serverSeed := 32 CSPRNG bytes, hex (64 chars)
 *   clientSeed := 16 CSPRNG bytes, hex (32 chars)
 *   commitment  := SHA-256(serverSeed)          -> published BEFORE play
 *
 * PLINKO PATH (one bit per row):
 *   bit_i      := firstByte(HMAC-SHA256(key=serverSeed,
 *                    `${clientSeed}:${nonce}:row:${i}`)) & 1   (0=left, 1=right)
 *   path       := [bit_0 .. bit_{rows-1}],  binIndex = sum(path)
 * The round settles atomically at creation, so the revealed serverSeed is
 * stored on the row immediately — anyone re-derives the exact path.
 *
 * MINES POSITIONS (deterministic Fisher-Yates shuffle from HMAC stream):
 *   swap_i := HMAC-SHA256(key=serverSeed, `${clientSeed}:${nonce}:swap:${i}`)
 *             read as a big-endian 64-bit integer, then j = value % (i+1)
 *   shuffle 0..gridSize-1 from i=gridSize-1 down to 1 (swap[i], swap[j]);
 *   mines    := the FIRST minesCount entries of the shuffled array.
 * The serverSeed is kept AES-256-GCM encrypted at rest (serverSeedEnc) and
 * published ONLY at settlement. The modulo bias of the % reduction is
 * <= gridSize / 2^64 (negligible for gridSize <= 36) and is documented.
 *
 * VERIFICATION: `verifyPlinkoRound` / `verifyMinesRound` re-derive everything
 * from the revealed material and compare against what was stored — the
 * commitment also proves the seed could not change after betting began.
 */

/** CSPRNG server seed — 32 random bytes, hex encoded. */
export function generateServerSeed(): string {
  return randomBytes(32).toString('hex');
}

/** CSPRNG client seed — 16 random bytes, hex encoded. */
export function generateClientSeed(): string {
  return randomBytes(16).toString('hex');
}

/** SHA-256 commitment of the server seed (published before play). */
export function computeSeedHash(serverSeed: string): string {
  return createHash('sha256').update(serverSeed, 'utf8').digest('hex');
}

/** HMAC-SHA256 of `message` keyed by the server seed. */
export function deriveHmac(serverSeed: string, message: string): Buffer {
  return createHmac('sha256', serverSeed).update(message, 'utf8').digest();
}

/** Left(0)/right(1) decision for Plinko row `rowIndex` (documented formula). */
export function deriveRowBit(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  rowIndex: number,
): 0 | 1 {
  const digest = deriveHmac(serverSeed, `${clientSeed}:${nonce}:row:${rowIndex}`);
  return (digest[0] & 1) === 0 ? 0 : 1;
}

/** Full Plinko path: one decision per row, in drop order. */
export function derivePlinkoPath(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  rows: number,
): number[] {
  const path: number[] = [];
  for (let i = 0; i < rows; i += 1) {
    path.push(deriveRowBit(serverSeed, clientSeed, nonce, i));
  }
  return path;
}

/** Final bin of a Plinko path (count of right moves). */
export function plinkoBinFromPath(path: readonly number[]): number {
  return path.reduce((sum, bit) => sum + bit, 0);
}

/** 64-bit big-endian integer from an HMAC digest (first 8 bytes). */
function readUint64(digest: Buffer): bigint {
  return digest.readBigUInt64BE(0);
}

/**
 * Deterministic value in [0, bound) from the HMAC stream (see module docs).
 * Modulo bias <= bound / 2^64 — negligible for bound <= 36.
 */
export function hmacIntBelow(
  serverSeed: string,
  message: string,
  bound: number,
): number {
  const digest = deriveHmac(serverSeed, message);
  return Number(readUint64(digest) % BigInt(bound));
}

/**
 * Deterministic Fisher-Yates shuffle of [0, gridSize) driven by the HMAC
 * stream, then the first `minesCount` entries become the mine positions.
 */
export function deriveMinesPositions(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  gridSize: number,
  minesCount: number,
): number[] {
  if (minesCount < 1 || minesCount >= gridSize) {
    throw new Error('minesCount must be in [1, gridSize)');
  }
  const tiles = Array.from({ length: gridSize }, (_, i) => i);
  for (let i = gridSize - 1; i >= 1; i -= 1) {
    const j = hmacIntBelow(serverSeed, `${clientSeed}:${nonce}:swap:${i}`, i + 1);
    const tmp = tiles[i];
    tiles[i] = tiles[j];
    tiles[j] = tmp;
  }
  return tiles.slice(0, minesCount).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// Secret handling (AES-256-GCM at rest via the existing encryptSecret utility)
// ---------------------------------------------------------------------------

/** Encrypt the plaintext server seed for at-rest storage (mines rounds). */
export function encryptRoundSeed(serverSeed: string): string {
  return encryptSecret(serverSeed);
}

/** Decrypt a stored server seed; null when it cannot be recovered. */
export function decryptRoundSeed(stored: string | null | undefined): string | null {
  if (!stored) return null;
  try {
    const plain = decryptSecret(stored);
    return plain && plain.length > 0 ? plain : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Independent re-verification (what players can reproduce)
// ---------------------------------------------------------------------------

export interface PlinkoVerificationResult {
  /** SHA-256 commitment of the revealed seed — must equal serverSeedHash. */
  commitmentHash: string;
  path: number[];
  binIndex: number;
  verified: boolean;
}

export function verifyPlinkoRound(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  rows: number,
  storedHash: string,
  storedPath: readonly number[],
  storedBinIndex: number,
): PlinkoVerificationResult {
  const commitmentHash = computeSeedHash(serverSeed);
  const path = derivePlinkoPath(serverSeed, clientSeed, nonce, rows);
  const binIndex = plinkoBinFromPath(path);
  return {
    commitmentHash,
    path,
    binIndex,
    verified:
      commitmentHash === storedHash &&
      path.length === storedPath.length &&
      path.every((bit, i) => bit === storedPath[i]) &&
      binIndex === storedBinIndex,
  };
}

export interface MinesVerificationResult {
  commitmentHash: string;
  positions: number[];
  verified: boolean;
}

export function verifyMinesRound(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  gridSize: number,
  minesCount: number,
  storedHash: string,
  storedRevealed: readonly number[] | null,
): MinesVerificationResult {
  const commitmentHash = computeSeedHash(serverSeed);
  const positions = deriveMinesPositions(serverSeed, clientSeed, nonce, gridSize, minesCount);
  const verified =
    commitmentHash === storedHash &&
    (storedRevealed === null ||
      (positions.length === storedRevealed.length &&
        positions.every((tile, i) => tile === storedRevealed[i])));
  return { commitmentHash, positions, verified };
}
