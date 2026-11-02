#!/usr/bin/env node
/** PART 1 sanity check: card faces rendered inside reel section at given viewports. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const VIEWPORTS = [
  { w: 390, h: 844 },
  { w: 1366, h: 768 },
];
const OUT = path.join(__dirname, '..', 'out');
fs.mkdirSync(OUT, { recursive: true });

let allOk = true;

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const vp of VIEWPORTS) {
      const page = await browser.newPage({
        viewport: { width: vp.w, height: vp.h },
        deviceScaleFactor: 1,
      });
      const tag = `${vp.w}x${vp.h}`;
      const fails = [];

      try {
        await page.goto('http://localhost:3100/games/play/royale-ace', {
          waitUntil: 'networkidle',
          timeout: 90000,
        });

        // 1. Wait until loading screen gone: reel section must exist.
        const reelSection = await page.waitForSelector(
          'section[aria-label="Royale Ace reels"]',
          { timeout: 90000 },
        );
        const reelBox = await reelSection.boundingBox();
        if (!reelBox) fails.push('reel section has no bounding box');

        // 2. Confirm real board, not loading screen: count ace-card- testids.
        const cards = page.locator('[data-testid^="ace-card-"]');
        const cardCount = await cards.count();
        if (cardCount !== 20) {
          fails.push(`expected 20 ace-card-* elements, got ${cardCount}`);
        }

        // 3. No card clipped: each bbox fully inside reel section.
        const n = cardCount;
        for (let i = 0; i < n; i++) {
          const el = cards.nth(i);
          const cb = await el.boundingBox();
          if (!cb) {
            fails.push(`card ${i} has no bounding box`);
            continue;
          }
          if (
            reelBox &&
            (cb.x < reelBox.x - 1 ||
              cb.y < reelBox.y - 1 ||
              cb.x + cb.width > reelBox.x + reelBox.width + 1 ||
              cb.y + cb.height > reelBox.y + reelBox.height + 1)
          ) {
            fails.push(`card ${i} clipped outside reel section`);
          }
        }

        await page.screenshot({
          path: path.join(OUT, `ace-part1-check-${tag}.png`),
          fullPage: true,
        });
      } catch (err) {
        fails.push(`exception: ${err.message}`);
      }

      allOk = allOk && fails.length === 0;
      console.log(`${tag}: ${fails.length === 0 ? 'PASS' : 'FAIL'}`);
      for (const f of fails) console.log(`  - ${f}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(`\nPART 1 check ${allOk ? 'PASSED' : 'FAILED'}.`);
  process.exit(allOk ? 0 : 1);
})();
