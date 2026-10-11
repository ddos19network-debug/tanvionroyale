/**
 * Calibrate the shipped Royale Ace paytable toward the target RTP.
 * Run with: pnpm sim:tune:royale-ace
 * Prints the tuned paytable so it can be pasted into ace-config.ts.
 */

import { DEFAULT_ACE_CONFIG } from './ace-config';
import { formatAceReport, tuneAceConfig } from './ace-sim';

const TUNE_SPINS = Number.parseInt(process.env.ACE_TUNE_SPINS ?? '2_000_000', 10);
const SEED = process.env.ACE_TUNE_SEED ?? 'royale-ace-tune-v1';

const result = tuneAceConfig(DEFAULT_ACE_CONFIG, { spins: TUNE_SPINS, seed: SEED });

console.log(`target RTP : ${(DEFAULT_ACE_CONFIG.targetRtpBp / 100).toFixed(2)}%`);
console.log(
  `iterations : ${result.history.map((r) => `${(r * 100).toFixed(2)}%`).join(' -> ')}`,
);
console.log(`converged  : ${result.converged}`);
console.log('');
console.log(`report     : ${formatAceReport(result.report)}`);
console.log('');
console.log('ACE_DEFAULT_PAYTABLE_BP = {');
for (const [symbol, row] of Object.entries(result.config.paytableBp)) {
  console.log(`  ${symbol}: [${row.join(', ')}],`);
}
console.log('};');

process.exit(result.converged ? 0 : 1);
