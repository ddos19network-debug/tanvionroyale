import { createHash } from 'node:crypto';

/**
 * TANVION user ↔ embedded-sportsbook (WinHouse) player identity.
 *
 * The provider receives a STABLE, non-identifying player id derived from the
 * internal TANVION user id:
 *
 *   winhousePlayerId(userId) = 'trwh' + sha256(userId).hex.slice(0, 28)
 *
 * Why this exact shape:
 *   - DETERMINISTIC: the same TANVION user always maps to the same provider
 *     player id, so the book never provisions a second account per page load
 *     (the launch token is minted per page load — the identity is not);
 *   - ONE-WAY: email/phone/username/password can never be derived from it, so
 *     no PII is handed to the provider beyond what its contract requires;
 *   - SAFE CHARSET: lowercase hex only, so the id is valid in the launch token,
 *     in a query string (`username=`) and as the provider's
 *     `<slug>_<player_id>` shell-player name;
 *   - STABLE ACROSS RESTARTS: 112 bits of SHA-256, no rotation.
 *
 * The same value is what the provider quotes back as `username` on every
 * wallet callback, so it is also the join key back to the TANVION user
 * (see WinHouseSession).
 */
export function winhousePlayerId(userId: string): string {
  const digest = createHash('sha256').update(String(userId), 'utf8').digest('hex');
  return `trwh${digest.slice(0, 28)}`;
}

/** True when the id looks like one of ours (defensive validation). */
export function isTanvionWinHousePlayerId(value: string): boolean {
  return /^trwh[0-9a-f]{28}$/.test(value);
}

/** True when the id looks like a TANVION ids for ANY embedded book. */
export function isTanvionProviderPlayerId(value: string): boolean {
  return /^tr[a-z0-9]{2,8}[0-9a-f]{20,60}$/.test(value);
}
