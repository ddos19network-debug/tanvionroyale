/**
 * VERIFY: Royale Ace responsive layout across viewports.
 * Runs against http://localhost:3100/games/play/royale-ace (dev server on port 3100).
 * Usage:  node apps/web/scripts/verify-ace-responsive.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const VIEWPORTS = [
  { w: 320, h: 568 }, { w: 375, h: 667 }, { w: 390, h: 844 }, { w: 430, h: 932 },
  { w: 667, h: 375 }, { w: 768, h: 1024 }, { w: 1024, h: 768 }, { w: 1366, h: 768 }, { w: 1920, h: 1080 },
];
const URL = 'http://localhost:3100/games/play/royale-ace';
const OUT_DIR = path.join(__dirname, '..', 'out');

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const results = [];

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage({
      viewport: { width: vp.w, height: vp.h },
      deviceScaleFactor: 1,
    });
    const failReasons = [];
    const tag = `${vp.w}x${vp.h}`;
    const screenshotPath = path.join(OUT_DIR, `ace-responsive-${tag}.png`);

    try {
      await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      // Check 1: no horizontal scroll
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const innerWidth = await page.evaluate(() => window.innerWidth);
      if (scrollWidth > innerWidth) {
        failReasons.push(`horizontal scroll: scrollWidth=${scrollWidth} > innerWidth=${innerWidth}`);
      }

      // Check 2: reel cells inside reel section
      const reelSection = await page.$('section[aria-label="Royale Ace reels"]');
      if (!reelSection) {
        failReasons.push('reel section not found');
      } else {
        const reelBox = await reelSection.boundingBox();
        if (!reelBox) {
          failReasons.push('reel section has no bounding box');
        } else {
          for (let r = 0; r < 5; r++) {
            const reel = await page.$(`[data-testid="ace-reel-${r}"]`);
            if (reel) {
              const rb = await reel.boundingBox();
              if (rb && (rb.x < reelBox.x - 1 || rb.y < reelBox.y - 1 ||
                rb.x + rb.width > reelBox.x + reelBox.width + 1 ||
                rb.y + rb.height > reelBox.y + reelBox.height + 1)) {
                failReasons.push(`reel ${r} outside reel section`);
              }
            }
            for (let c = 0; c < 4; c++) {
              const cell = await page.$(`[data-testid="ace-cell-${r}-${c}"]`);
              if (cell) {
                const cb = await cell.boundingBox();
                if (cb) {
                  if (cb.x < reelBox.x - 1 || cb.y < reelBox.y - 1 ||
                    cb.x + cb.width > reelBox.x + reelBox.width + 1 ||
                    cb.y + cb.height > reelBox.y + reelBox.height + 1) {
                    failReasons.push(`cell ${r}-${c} outside reel section`);
                  }
                  const ratio = cb.width / cb.height;
                  if (ratio < 0.85 || ratio > 1.15) {
                    failReasons.push(`cell ${r}-${c} aspect ratio ${ratio.toFixed(3)} not in [0.85, 1.15]`);
                  }
                }
              }
            }
          }
        }
      }
    } catch (err) {
      failReasons.push(`exception: ${err.message}`);
    }

    results.push({ w: vp.w, h: vp.h, pass: failReasons.length === 0, fails: failReasons, screenshot: screenshotPath });
    await page.close();
  }

  await browser.close();

  console.log('\n=== Royale Ace Responsive Layout Verification ===\n');
  console.log('+----------+----------+--------+------------------------------------------+');
  console.log('| Width    | Height   | Result | Reason                                   |');
  console.log('+----------+----------+--------+------------------------------------------+');
  let allPass = true;
  for (const r of results) {
    const status = r.pass ? 'PASS  ' : 'FAIL  ';
    const reason = r.fails.length > 0 ? r.fails.slice(0, 2).join('; ') : '-';
    console.log(`| ${String(r.w).padEnd(8)} | ${String(r.h).padEnd(8)} | ${status} | ${reason.padEnd(40)} |`);
    if (!r.pass) allPass = false;
  }
  console.log('+----------+----------+--------+------------------------------------------+\n');

  if (!allPass) {
    console.log('DETAILED FAILURES:');
    for (const r of results) {
      if (!r.pass) {
        console.log(`\n${r.w}x${r.h}:`);
        for (const f of r.fails) console.log(`  - ${f}`);
      }
    }
    console.log(`\nScreenshots saved to: ${OUT_DIR}/`);
    process.exit(1);
  } else {
    console.log('All viewports PASS.\n');
    console.log('Screenshots:');
    for (const r of results) console.log(`  ${r.screenshot}`);
  }
}

main().catch((err) => { console.error('FATAL:', err); process.exit(1); });
