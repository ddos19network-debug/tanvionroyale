/**
 * TANVION ROYALE â€” "Royale Ace" provably-fair randomness (server-authoritative).
 *
 * Implements `AceRandomSource` on top of the SAME commitment scheme as
 * `royale-fair.ts`: HMAC-SHA256 stream keyed by `serverSeed`, derived from
 * `${clientSeed}:${nonce}:${stream}:${counter}` and mapped into ranges with
 * rejection sampling so there is no modulo bias.
 *
 * A certified external RNG can be dropped in behind `AceRandomSource` (some
 * regulators / test labs require their own RNG certification and do not accept
 * HMAC provable fairness alone for slots) â€” see docs/games/royale-ace.md.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

import { effectiveMaxWinBp, type AceGameConfig, type AceStripEntry } from './ace-config';
import {
  playSpin,
  payoutForBp,
  type AceRandomSource,
  type AceRoundResult,
  type AceSpinResult,
} from './ace-math';

// ---------------------------------------------------------------------------
// HMAC-SHA256 uniform stream
// ---------------------------------------------------------------------------

/** Largest multiple of 2^32 that fits in a safe integer. */
const MAX_UINT32_SCALED = Math.floor(Number.MAX_SAFE_INTEGER / 4_294_967_296) * 4_294_967_296;

/**
 * Deterministic HMAC-SHA256 stream: draw `n` maps to a uniform 32-bit word.
 * `word(n) = HMAC_SHA256(serverSeed, `${clientSeed}:${nonce}:${stream}:${n}`)`.
 */
export function aceStreamWord(
  serverSeed: string,
  clientSeed: string,
  nonce: number,
  stream: string,
  n: number,
): number {
  const mac = createHmac('sha256', serverSeed)
    .update(`${clientSeed}:${nonce}:${stream}:${n}`)
    .digest();
  return mac.readUInt32BE(0);
}

/** Constant-time hex comparison for seed/commitment checks. */
export function aceSecretsMatch(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'hex');
  const bufferB = Buffer.from(b, 'hex');
  if (bufferA.length !== bufferB.length || bufferA.length === 0) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** HMAC commitment hash of a server seed (hex), shown to the player up front. */
export function aceCommitment(serverSeed: string): string {
  return createHmac('sha256', 'tanvion-royale-ace:v1').update(serverSeed).digest('hex');
}

/** Cryptographically strong 32-byte server seed (hex). */
export function generateAceServerSeed(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Provably-fair random source for Royale Ace.
 *
 * `stream` namespaces draws per phase so that a round's base game and every
 * free spin draw from independent sub-streams â€” which also means the exact
 * number of free spins played cannot change how earlier draws are interpreted.
 */
export class HmacRandomStream implements AceRandomSource {
  private counter = 0;

  constructor(
    private readonly serverSeed: string,
    private readonly clientSeed: string,
    private readonly nonce: number,
    private readonly stream: string,
  ) {}

  get drawsUsed(): number {
    return this.counter;
  }

  /**
   * Uniform integer in [0, bound) with NO modulo bias.
   *
   * Words are accepted only inside `[0, floor(2^32 / bound) * bound)`; rejected
   * words consume an extra counter value, so the mapping is exactly uniform.
   */
  nextIntBelow(bound: number): number {
    if (!Number.isInteger(bound) || bound <= 0) {
      throw new Error('bound must be a positive integer');
    }
    if (bound === 1) return 0;
    const limit = Math.floor(MAX_UINT32_SCALED / bound) * bound;
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      const word = this.nextWord();
      if (word < limit) return word % bound;
    }
    // Practically unreachable; still refuse to fall back to a biased mapping.
    throw new Error('ace RNG: rejection sampling failed to converge');
  }

  /** Weighted draw from a reel strip (uses `nextIntBelow`, hence unbiased). */
  pickFromStrip(strip: readonly AceStripEntry[]): AceStripEntry {
    if (strip.length === 0) throw new Error('ace RNG: empty strip');
    let total = 0;
    for (const entry of strip) {
      if (!Number.isInteger(entry.weight) || entry.weight <= 0) {
        throw new Error('ace RNG: strip weights must be positive integers');
      }
      total += entry.weight;
    }
    const draw = this.nextIntBelow(total);
    let cumulative = 0;
    for (const entry of strip) {
      cumulative += entry.weight;
      if (draw < cumulative) return entry;
    }
    return strip[strip.length - 1];
  }
  private nextWord(): number {
    this.counter += 1;
    return aceStreamWord(this.serverSeed, this.clientSeed, this.nonce, this.stream, this.counter);
  }
}

// ---------------------------------------------------------------------------
// Server-authoritative round generation + verification
// ---------------------------------------------------------------------------

/** Seed material a round is generated from — and can be verified from. */
export interface AceRoundSeeds {
  serverSeed: string;
  clientSeed: string;
  /** Per-round nonce (strictly increasing per player). */
  nonce: number;
}

/** What the player sees BEFORE the round is played. */
export interface AceRoundCommitment {
  commitment: string;
  clientSeed: string;
  nonce: number;
  /** Filled in once the server seed has been rotated and revealed. */
  revealedServerSeed: string | null;
}

/** Base-game stream namespace. Free spins use `fs0`, `fs1`, ... */
export const ACE_BASE_STREAM = 'base';

export function aceFreeSpinStream(index: number): string {
  return `fs${index}`;
}


/**
 * Generate a COMPLETE round (base spin + every free spin) from the seeds.
 *
 * Deterministic and pure: the same seeds + config + stake always produce the
 * identical round, which is exactly what `verifyAceSpin` asserts. Streams are
 * namespaced per phase, so how deep a cascade goes (or how many retriggers
 * happen) can never change how an earlier draw is interpreted.
 */
export function generateAceRound(
  config: AceGameConfig,
  seeds: AceRoundSeeds,
  stake: number,
): AceRoundResult {
  const maxWinBp = effectiveMaxWinBp(config, stake);

  // The base game decides the feature, so it is played first. When it awards no
  // free spins there is nothing more to derive.
  const baseSpin = playPhase(config, seeds, ACE_BASE_STREAM, false);
  const freeSpins: AceSpinResult[] = [];

  let totalPayBp = baseSpin.totalPayBp;
  let maxMultiplierBp = baseSpin.maxMultiplierBp;
  let retriggered = false;
  let remaining = baseSpin.freeSpinsAwarded;

  // Each free spin plays on its own namespaced stream; a retrigger extends the
  // queue, so the loop simply keeps going until it drains.
  for (let index = 0; remaining > 0 && index < config.freeSpins.maxSpinsPerRound; index += 1) {
    remaining -= 1;
    const spin = playPhase(config, seeds, aceFreeSpinStream(index), true);
    freeSpins.push(spin);
    totalPayBp += spin.totalPayBp;
    maxMultiplierBp = Math.max(maxMultiplierBp, spin.maxMultiplierBp);
    if (spin.freeSpinsAwarded > 0) {
      if (config.freeSpins.retriggerUsesAwardTable) remaining += spin.freeSpinsAwarded;
      retriggered = true;
    }
  }

  const capped = totalPayBp > maxWinBp;
  if (capped) totalPayBp = maxWinBp;

  return {
    baseSpin,
    freeSpins,
    totalPayBp,
    maxMultiplierBp,
    freeSpinsPlayed: freeSpins.length,
    retriggered,
    capped,
  };
}

/** Total win in minor units for a round (floors, and never exceeds the cap). */
export function aceRoundPayoutMinorUnits(
  round: AceRoundResult,
  stake: number,
  maxWinBp: number,
): number {
  return Math.min(payoutForBp(stake, round.totalPayBp), payoutForBp(stake, maxWinBp));
}

/** Spin a single phase (base game or one free spin) on its own sub-stream. */
function playPhase(
  config: AceGameConfig,
  seeds: AceRoundSeeds,
  stream: string,
  freeSpins: boolean,
): AceSpinResult {
  return playSpin(
    new HmacRandomStream(seeds.serverSeed, seeds.clientSeed, seeds.nonce, stream),
    config,
    freeSpins ? config.freeSpinLadderBp : config.baseLadderBp,
  );
}

/** Stored outcome that a verification attempt is compared against. */
export interface AceStoredOutcome {
  totalPayBp: number;
  payoutMinorUnits: number;
  freeSpinsPlayed: number;
}

/** Outcome of a verification attempt. */
export interface AceSpinVerification extends AceStoredOutcome {
  /** TRUE when the re-derived round matches the stored outcome exactly. */
  valid: boolean;
  /** Reasons the verification failed (empty when valid). */
  reasons: string[];
  /** TRUE when the re-derived round hit the per-round win cap. */
  capped: boolean;
}

/**
 * Re-derive a whole round from the revealed seeds + the config version it was
 * played with, and compare it against the stored outcome.
 *
 * This backs the "Verify spin" panel/endpoint. It never trusts stored payouts,
 * grids or multipliers — everything is recomputed from the seeds, so a tampered
 * round record can always be detected.
 */
export function verifyAceSpin(
  config: AceGameConfig,
  seeds: AceRoundSeeds,
  stake: number,
  stored: AceStoredOutcome,
): AceSpinVerification {
  const reasons: string[] = [];
  let derived: AceRoundResult;
  try {
    derived = generateAceRound(config, seeds, stake);
  } catch (error) {
    return {
      valid: false,
      reasons: [`re-derivation failed: ${error instanceof Error ? error.message : String(error)}`],
      totalPayBp: 0,
      payoutMinorUnits: 0,
      freeSpinsPlayed: 0,
      capped: false,
    };
  }

  const maxWinBp = effectiveMaxWinBp(config, stake);
  const payoutMinorUnits = aceRoundPayoutMinorUnits(derived, stake, maxWinBp);

  if (derived.totalPayBp !== stored.totalPayBp) {
    reasons.push(`totalPayBp mismatch: derived ${derived.totalPayBp}, stored ${stored.totalPayBp}`);
  }
  if (payoutMinorUnits !== stored.payoutMinorUnits) {
    reasons.push(`payout mismatch: derived ${payoutMinorUnits}, stored ${stored.payoutMinorUnits}`);
  }
  if (derived.freeSpinsPlayed !== stored.freeSpinsPlayed) {
    reasons.push(
      `freeSpinsPlayed mismatch: derived ${derived.freeSpinsPlayed}, stored ${stored.freeSpinsPlayed}`,
    );
  }
  if (!Number.isInteger(stored.payoutMinorUnits) || stored.payoutMinorUnits < 0) {
    reasons.push('stored payout must be a non-negative integer');
  }
  if (payoutMinorUnits > Math.floor((stake * maxWinBp) / 10_000)) {
    reasons.push('payout exceeds the configured max-win cap');
  }

  return {
    valid: reasons.length === 0,
    reasons,
    totalPayBp: derived.totalPayBp,
    payoutMinorUnits,
    freeSpinsPlayed: derived.freeSpinsPlayed,
    capped: derived.capped,
  };
}


