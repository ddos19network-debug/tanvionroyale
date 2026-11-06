#!/usr/bin/env node
/**
 * Slot tuning CLI — automatically tunes paytable multiplier / weights to hit 96.0% ± 0.3% RTP,
 * writes the tuned values back into the game's config file, and writes the report to docs/games/rtp/<slug>.md.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/modules/games/slots/slot-tune.cli.ts --game=royale-pharaoh
 */

import * as fs from 'fs';
import * as path from 'path';
import { runSimulation, formatSimReport, type SimReport } from './slot-sim.cli';
import { getSlot, listSlotSlugs } from './slot.registry';

const TARGET_RTP = 96.0;
const TOLERANCE = 0.7; // 95.3% – 96.7% per Part 3 spec

const CONFIG_FILE_MAP: Record<string, string> = {
  'royale-pharaoh': 'pharaoh.config.ts',
  'royale-atlantis': 'atlantis.config.ts',
  'neon-cyber-rush': 'neon-cyber-rush.config.ts',
  'mystic-forest': 'mystic-forest.config.ts',
  'samurai-fortune': 'samurai-fortune.config.ts',
  'cosmic-odyssey': 'cosmic-odyssey.config.ts',
  'dragons-kingdom': 'dragons-kingdom.config.ts',
  'tropical-paradise': 'tropical-paradise.config.ts',
  'steampunk-revolution': 'steampunk-revolution.config.ts',
  'frozen-empire': 'frozen-empire.config.ts',
};

export function tuneSlot(slug: string, targetRtp = TARGET_RTP, tolerance = TOLERANCE): SimReport {
  const registered = getSlot(slug);
  if (!registered) throw new Error(`Game "${slug}" not found`);
  const { config } = registered;

  console.log(`\n=== AUTO-TUNING ${slug.toUpperCase()} TOWARDS ${targetRtp}% RTP ===`);

  let report = runSimulation(slug, 30_000, 100, `tune-${slug}-initial`);
  console.log(`Initial RTP: ${report.rtpTotal.toFixed(2)}%`);

  for (let iter = 1; iter <= 7; iter++) {
    if (Math.abs(report.rtpTotal - targetRtp) <= tolerance) {
      console.log(`Target reached in iteration ${iter - 1}! Current: ${report.rtpTotal.toFixed(2)}%`);
      break;
    }

    const currentRtp = Math.max(report.rtpTotal, 0.5);
    const stepFactor = targetRtp / currentRtp;

    for (const sym of Object.keys(config.paytableBp)) {
      const arr = config.paytableBp[sym];
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] > 0) {
          arr[i] = Math.max(1, Math.round(arr[i] * stepFactor));
        }
      }
    }

    report = runSimulation(slug, 40_000 + iter * 10_000, 100, `tune-${slug}-iter-${iter}`);
    console.log(`Iteration ${iter}: RTP = ${report.rtpTotal.toFixed(2)}% (target: ${targetRtp}%)`);
  }

  // Final verification run with 200,000 spins
  console.log(`Running 200,000-spin verification...`);
  const finalReport = runSimulation(slug, 200_000, 100, `tune-${slug}-final`);
  console.log(formatSimReport(finalReport));

  // Write tuned numbers back to config file
  const configFileName = CONFIG_FILE_MAP[slug];
  if (configFileName) {
    const configPath = path.resolve(__dirname, 'games', configFileName);
    if (fs.existsSync(configPath)) {
      let content = fs.readFileSync(configPath, 'utf8');
      const ptLines = Object.entries(config.paytableBp)
        .map(([sym, vals]) => `  '${sym}': [${vals.join(', ')}],`)
        .join('\n');
      const ptVarRegex = /(const PT(?::\s*Record<string,\s*number\[\]>)?\s*=\s*\{)[\s\S]*?(\n\};)/;

      if (ptVarRegex.test(content)) {
        content = content.replace(ptVarRegex, `$1\n${ptLines}$2`);
        fs.writeFileSync(configPath, content, 'utf8');
        console.log(`Updated paytable written to ${configFileName}`);
      }
    }
  }

  // Save markdown report under docs/games/rtp/<slug>.md
  const docsDir = path.resolve(__dirname, '../../../../../../docs/games/rtp');
  if (!fs.existsSync(docsDir)) fs.mkdirSync(docsDir, { recursive: true });
  const reportPath = path.join(docsDir, `${slug}.md`);
  const mdContent = `# RTP Simulation Report — ${config.title}

- **Game slug**: \`${slug}\`
- **Win Model**: ${config.winModel} (${config.reels}×${config.rows})
- **Spins Simulated**: ${finalReport.spins.toLocaleString()}
- **Measured RTP**: **${finalReport.rtpTotal.toFixed(2)}%** (Target: 96.0% ± 0.7%)
  - Base Game RTP: ${finalReport.rtpBase.toFixed(2)}%
  - Free Spins RTP: ${finalReport.rtpFreeSpins.toFixed(2)}%
- **Hit Frequency**: ${finalReport.hitFrequency.toFixed(2)}%
- **Free Spins Trigger Frequency**: 1 in ${finalReport.fsTriggerFrequency.toFixed(1)} spins
- **Average Free Spin Round Value**: ${finalReport.avgFsRoundValue.toFixed(1)}× stake
- **Max Win Observed**: ${finalReport.maxWinStakeMult.toFixed(1)}× stake (Cap: ${(config.maxWinBp / 10000).toLocaleString()}×)
- **Rounds Capped**: ${finalReport.roundsCappedCount} (${((finalReport.roundsCappedCount / finalReport.spins) * 100).toFixed(4)}%)
- **Volatility (StdDev)**: ${finalReport.volatilityStdDev.toFixed(2)}

## Payout Distribution
- **0× (Loss)**: ${((finalReport.buckets.zero / finalReport.spins) * 100).toFixed(2)}%
- **< 1× stake**: ${((finalReport.buckets.under1x / finalReport.spins) * 100).toFixed(2)}%
- **1× – 2× stake**: ${((finalReport.buckets.oneTo2x / finalReport.spins) * 100).toFixed(2)}%
- **2× – 5× stake**: ${((finalReport.buckets.twoTo5x / finalReport.spins) * 100).toFixed(2)}%
- **5× – 20× stake**: ${((finalReport.buckets.fiveTo20x / finalReport.spins) * 100).toFixed(2)}%
- **20× – 100× stake**: ${((finalReport.buckets.twentyTo100x / finalReport.spins) * 100).toFixed(2)}%
- **100×+ stake**: ${((finalReport.buckets.over100x / finalReport.spins) * 100).toFixed(2)}%
`;
  fs.writeFileSync(reportPath, mdContent, 'utf8');
  console.log(`Saved RTP report to ${reportPath}`);

  return finalReport;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let game = '';
  for (const a of args) {
    if (a.startsWith('--game=')) game = a.split('=')[1];
  }
  if (game) {
    tuneSlot(game);
  } else {
    const slugs = listSlotSlugs();
    console.log(`Tuning all ${slugs.length} games sequentially...`);
    for (const slug of slugs) {
      tuneSlot(slug);
    }
  }
}
