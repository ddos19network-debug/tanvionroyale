import { MockOperatorAdapter } from '@tanvion-royale/integrations';
import { OperatorError } from '@tanvion-royale/integrations';

describe('MockProvider â€” bet placement boundary', () => {
  const baseBet = {
    accountRef: 'user-1',
    type: 'SINGLE' as const,
    stake: 1000,
    currency: 'BDT',
    selections: [{ externalSelectionId: 'evt-1001-sel-home', requestedDecimal: '1.85' }],
    idempotencyKey: 'test-key-1',
  };

  it('simulates success and returns an idempotency-backed reference', async () => {
    const adapter = new MockOperatorAdapter();
    await adapter.authenticate();
    adapter.setSimulation({ mode: 'success' });

    const result = await adapter.placeBet(baseBet);
    expect(result.status).toBe('ACCEPTED');
    expect(result.externalBetId).toMatch(/^MOCK-BET-\d+$/);
  });

  it('simulates rejection with BET_REJECTED', async () => {
    const adapter = new MockOperatorAdapter();
    await adapter.authenticate();
    adapter.setSimulation({ mode: 'rejected' });

    await expect(adapter.placeBet(baseBet)).rejects.toThrow(
      expect.objectContaining({ name: 'OperatorError', code: 'BET_REJECTED' }),
    );
  });

  it('simulates unavailability with PROVIDER_UNAVAILABLE', async () => {
    const adapter = new MockOperatorAdapter();
    await adapter.authenticate();
    adapter.setSimulation({ mode: 'unavailable' });

    await expect(adapter.placeBet(baseBet)).rejects.toThrow(
      expect.objectContaining({ name: 'OperatorError', code: 'PROVIDER_UNAVAILABLE' }),
    );
  });

  it('simulates odds changed with ODDS_CHANGED', async () => {
    const adapter = new MockOperatorAdapter();
    await adapter.authenticate();
    adapter.setSimulation({ mode: 'odds_changed' });

    const err = await adapter.placeBet(baseBet).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(OperatorError);
    expect((err as OperatorError).code).toBe('ODDS_CHANGED');
  });

  it('clearing the simulation restores normal acceptance', async () => {
    const adapter = new MockOperatorAdapter();
    await adapter.authenticate();
    adapter.setSimulation({ mode: 'rejected' });
    await expect(adapter.placeBet(baseBet)).rejects.toThrow(OperatorError);

    adapter.clearSimulation();
    const result = await adapter.placeBet(baseBet);
    expect(result.status).toBe('ACCEPTED');
  });
});