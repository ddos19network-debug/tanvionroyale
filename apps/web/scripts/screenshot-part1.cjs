#!/usr/bin/env node
/** One-off PART 1 screenshot helper: board at 390x844 and 1366x768. */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'out');
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [w, h] of [[390, 844], [1366, 768]]) {
      const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
      await page.goto('http://localhost:3100/games/play/royale-ace', {
        waitUntil: 'networkidle',
        timeout: 90000,
      });
      await page.waitForSelector('section[aria-label="Royale Ace reels"]', { timeout: 90000 });
      await page.waitForTimeout(1500);
      const file = path.join(OUT, `ace-part1-${w}x${h}.png`);
      await page.screenshot({ path: file, fullPage: true });
      console.log(`saved ${file}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
})();
