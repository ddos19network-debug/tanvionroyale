import { createHash } from 'node:crypto';

/**
 * TANVION user ↔ partner player identity mapping.
 *
 * The partner receives a STABLE, non-identifying player id derived from the
 * internal TANVION user id:
 *
 *   casinoPlayerId(userId) = 'tr' + sha256(userId).hex.slice(0, 30)
 *
 * Properties (all required by the integration contract):
 *   - deterministic: the same user always maps to the same partner player id,
 *     so NO partner account is created again on every game launch;
 *   - one-way: email/phone/username can never be derived from it;
 *   - non-colliding in practice: 120 bits of SHA-256;
 *   - stable across catalog syncs/restarts — favorites and provider reports
 *     keep working.
 */
export function casinoPlayerId(userId: string): string {
  const digest = createHash('sha256').update(String(userId), 'utf8').digest('hex');
  return `tr${digest.slice(0, 30)}`;
}

/** True when the id looks like one of ours (used for defensive validation). */
export function isTanvionCasinoPlayerId(value: string): boolean {
  return /^tr[0-9a-f]{30}$/.test(value);
}
