import { listSlotSlugs, getSlot } from '../../src/modules/games/slots/slot.registry';

describe('Slot Configs Validation (all 10 games)', () => {
  const slugs = listSlotSlugs();

  it('contains all 10 target games (#4 to #13)', () => {
    expect(slugs).toHaveLength(10);
    expect(slugs).toEqual([
      'royale-pharaoh',
      'royale-atlantis',
      'neon-cyber-rush',
      'mystic-forest',
      'samurai-fortune',
      'cosmic-odyssey',
      'dragons-kingdom',
      'tropical-paradise',
      'steampunk-revolution',
      'frozen-empire',
    ]);
  });

  for (const slug of slugs) {
    describe(`Config for ${slug}`, () => {
      const entry = getSlot(slug)!;
      const cfg = entry.config;

      it('has valid dimensions', () => {
        expect(cfg.reels).toBeGreaterThanOrEqual(5);
        expect(cfg.rows).toBeGreaterThanOrEqual(4);
      });

      it('has positive weights across all reel strips', () => {
        expect(cfg.strips.length).toBe(cfg.reels);
        for (let c = 0; c < cfg.reels; c++) {
          const totalWeight = cfg.strips[c].reduce((s, e) => s + e.weight, 0);
          expect(totalWeight).toBeGreaterThan(0);
          for (const e of cfg.strips[c]) {
            expect(e.weight).toBeGreaterThanOrEqual(0);
            expect(typeof e.symbolId).toBe('string');
          }
        }
      });

      it('paylines (if paylines mode) are valid, in range, and non-duplicate', () => {
        if (cfg.winModel === 'paylines') {
          expect(cfg.paylines).toBeDefined();
          expect(cfg.paylines!.length).toBeGreaterThan(0);
          const seen = new Set<string>();
          for (const line of cfg.paylines!) {
            expect(line.rows).toHaveLength(cfg.reels);
            for (const r of line.rows) {
              expect(r).toBeGreaterThanOrEqual(0);
              expect(r).toBeLessThan(cfg.rows);
            }
            const key = line.rows.join(',');
            expect(seen.has(key)).toBe(false);
            seen.add(key);
          }
        }
      });

      it('paytable values are non-negative and monotonic', () => {
        for (const [sym, pays] of Object.entries(cfg.paytableBp)) {
          expect(Array.isArray(pays)).toBe(true);
          for (let i = 1; i < pays.length; i++) {
            expect(pays[i]).toBeGreaterThanOrEqual(0);
            if (i >= 4) {
              // 4-of-a-kind pays >= 3-of-a-kind
              expect(pays[i]).toBeGreaterThanOrEqual(pays[i - 1]);
            }
          }
        }
      });

      it('has defined wild and scatter symbol ids', () => {
        expect(cfg.wildId).toBeDefined();
        expect(cfg.scatterId).toBeDefined();
        const symIds = new Set(cfg.symbols.map((s) => s.id));
        expect(symIds.has(cfg.wildId)).toBe(true);
        expect(symIds.has(cfg.scatterId)).toBe(true);
      });

      it('has reasonable maxWinBp (>= 2000x stake)', () => {
        expect(cfg.maxWinBp).toBeGreaterThanOrEqual(20_000_000);
      });
    });
  }
});
