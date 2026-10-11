import { casinoPlayerId, isTanvionCasinoPlayerId } from '../src/modules/casino/casino-player-identity';

/**
 * TANVION user ↔ partner player identity tests.
 *
 * The mapping must be deterministic (no partner account per launch), one-way
 * (no PII derivable) and stable (favourites/reports survive syncs).
 */
describe('casino-player-identity', () => {
  it('is deterministic for the same user', () => {
    expect(casinoPlayerId('user-1')).toBe(casinoPlayerId('user-1'));
  });

  it('differs between users', () => {
    expect(casinoPlayerId('user-1')).not.toBe(casinoPlayerId('user-2'));
  });

  it('never contains the raw internal id', () => {
    const id = casinoPlayerId('user-with-email@example.com');
    expect(id).not.toContain('user-with-email');
    expect(id).not.toContain('@');
  });

  it('uses the tr + 30 hex character format', () => {
    expect(casinoPlayerId('user-1')).toMatch(/^tr[0-9a-f]{30}$/);
    expect(isTanvionCasinoPlayerId(casinoPlayerId('user-1'))).toBe(true);
  });

  it('rejects ids that are not ours', () => {
    expect(isTanvionCasinoPlayerId('player-1')).toBe(false);
    expect(isTanvionCasinoPlayerId('trXYZ')).toBe(false);
    expect(isTanvionCasinoPlayerId('')).toBe(false);
  });
});
