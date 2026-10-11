#!/usr/bin/env node
/**
 * `pnpm sim:royale-ace` — the Royale Ace math verification CLI.
 *
 * Runs a SEEDED, deterministic Monte-Carlo simulation of the shipped config and
 * prints the RTP split, hit frequency, volatility, max win and free-spin
 * trigger rate with 95% confidence intervals. Exits non-zero when the CI gate
 * fails (RTP outside tolerance, or the max-win cap exceeded).
 *
 * Usage:
 *   pnpm sim:royale-ace                      # 50,000,000 spins (default)
 *   pnpm sim:royale-ace --spins 1000000      # quicker run
 *   pnpm sim:royale-ace --seed my-seed       # different stream
 *   pnpm sim:royale-ace --tune               # calibrate the paytable first
 *   pnpm sim:royale-ace --json               # machine-readable output
 */

import { DEFAULT_ACE_CONFIG, isAceConfigValid, validateAceConfig } from './ace-config';
import {
  formatAceReport,
  runAceSimGate,
  tuneAceConfig,
  type AceSimReport,
} from './ace-sim';

interface CliOptions {
  spins: number;
  seed: string;
  toleranceBp: number;
  maxWinCeiling: number;
  tune: boolean;
  json: boolean;
}

const DEFAULT_SPINS = 50_000_000;
const DEFAULT_TOLERANCE_BP = 150; // ±1.5% of stake around the target RTP

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    spins: DEFAULT_SPINS,
    seed: 'royale-ace-v1',
    toleranceBp: DEFAULT_TOLERANCE_BP,
    maxWinCeiling: DEFAULT_ACE_CONFIG.maxWinBp / 10_000,
    tune: false,
    json: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[i + 1];
      if (value === undefined) throw new Error(`missing value for ${arg}`);
      i += 1;
      return value;
    };
    switch (arg) {
      case '--spins':
        options.spins = Number.parseInt(next(), 10);
        break;
      case '--seed':
        options.seed = next();
        break;
      case '--tolerance':
        options.toleranceBp = Number.parseInt(next(), 10);
        break;
      case '--max-win':
        options.maxWinCeiling = Number.parseFloat(next());
        break;
      case '--tune':
        options.tune = true;
        break;
      case '--json':
        options.json = true;
        break;
      case '--help':
      case '-h':
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!Number.isInteger(options.spins) || options.spins <= 0) {
    throw new Error('--spins must be a positive integer');
  }
  return options;
}

function printUsage(): void {
  console.log('Usage: pnpm sim:royale-ace [--spins N] [--seed S] [--tolerance BP] [--max-win X] [--tune] [--json]');
}

function reportToJson(configName: string, report: AceSimReport): string {
  return JSON.stringify(
    {
      game: 'royale-ace',
      configName,
      spins: report.spins,
      stake: report.stake,
      rtp: {
        mean: report.rtp.mean,
        low: report.rtp.low,
        high: report.rtp.high,
      },
      rtpSplit: {
        base: report.baseRtp,
        cascade: report.cascadeRtp,
        freeSpins: report.freeSpinRtp,
      },
      hitFrequency: report.hitFrequency,
      volatility: report.volatility,
      maxWin: report.maxWin,
      capReached: report.capReached,
      freeSpinTriggerRate: report.freeSpinTriggerRate,
      retriggerRate: report.retriggerRate,
      averageCascadeDepth: report.averageCascadeDepth,
      averageFreeSpins: report.averageFreeSpins,
      maxMultiplierSeen: report.maxMultiplierSeen,
    },
    null,
    2,
  );
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));

  const issues = validateAceConfig(DEFAULT_ACE_CONFIG);
  if (issues.length > 0) {
    console.error('The shipped Royale Ace config is invalid:');
    for (const issue of issues) console.error(`  - ${issue.path}: ${issue.message}`);
    process.exit(1);
  }

  let config = DEFAULT_ACE_CONFIG;
  if (options.tune) {
    console.log(`Tuning paytable toward ${(config.targetRtpBp / 100).toFixed(2)}% RTP...`);
    const tuned = tuneAceConfig(config, {
      spins: Math.min(options.spins, 5_000_000),
      seed: options.seed,
      maxIterations: 10,
      toleranceBp: options.toleranceBp,
    });
    console.log(`  ${tuned.history.map((h) => `${(h * 100).toFixed(2)}%`).join(' -> ')}`);
    console.log(`  converged: ${tuned.converged}`);
    config = tuned.config;
  }

  console.log(
    `Simulating ${options.spins.toLocaleString('en-US')} seeded rounds of "${config.configName}"...`,
  );
  const startedAt = Date.now();
  const gate = runAceSimGate(
    config,
    { spins: options.spins, seed: options.seed, stake: 1_000 },
    { rtpToleranceBp: options.toleranceBp, maxWinCeiling: options.maxWinCeiling },
  );
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  const report = gate.report;

  if (options.json) {
    console.log(reportToJson(config.configName, report));
  } else {
    console.log('');
    console.log(formatAceReport(report));
    console.log(`simulated in ${seconds}s`);
  }

  if (!gate.passed) {
    console.error('');
    console.error('GATE FAILED:');
    for (const reason of gate.reasons) console.error(`  - ${reason}`);
    process.exit(1);
  }

  console.log('');
  console.log(
    `GATE PASSED (RTP within ±${(options.toleranceBp / 100).toFixed(2)}% of ${(config.targetRtpBp / 100).toFixed(2)}%, max win <= x${options.maxWinCeiling.toFixed(0)})`,
  );
  if (!isAceConfigValid(config)) process.exit(1);
}

main();
