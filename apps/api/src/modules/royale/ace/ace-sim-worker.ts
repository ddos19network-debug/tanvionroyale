/**
 * Worker body for `pnpm sim:royale-ace` (see ace-sim-cli.ts).
 *
 * Each worker simulates a disjoint, SEEDED slice of rounds and returns the raw
 * accumulators. Merging accumulators (rather than reports) keeps the merged
 * confidence intervals statistically correct: the CI needs the global mean and
 * variance, which cannot be recovered from per-worker means alone.
 */

import { parentPort, workerData } from 'node:worker_threads';

import { type AceGameConfig, DEFAULT_ACE_CONFIG } from './ace-config';
import { BASIS_POINTS, playSpin, type AceRandomSource } from './ace-math';
import { SeededRandomStream } from './ace-sim';

interface WorkerInput {
  spins: number;
  /** Unique per worker so slices never overlap or repeat. */
  seed: string;
  config: AceGameConfig;
  maxWinBp: number;
}

interface WorkerOutput {
  spins: number;
  winSum: number;
  winSumSquares: number;
  baseWinSum: number;
  cascadeExtraSum: number;
  freeSpinWinSum: number;
  cappedRounds: number;
  hitRounds: number;
  triggerCount: number;
  retriggerCount: number;
  featureCount: number;
  freeSpinAwardedSum: number;
  cascadeDepthSum: number;
  maxWin: number;
  maxMultiplier: number;
}

function run(input: WorkerInput): WorkerOutput {
  const random: AceRandomSource = new SeededRandomStream(input.seed);
  const config = input.config;
  const maxWinBp = input.maxWinBp;

  const out: WorkerOutput = {
    spins: 0,
    winSum: 0,
    winSumSquares: 0,
    baseWinSum: 0,
    cascadeExtraSum: 0,
    freeSpinWinSum: 0,
    cappedRounds: 0,
    hitRounds: 0,
    triggerCount: 0,
    retriggerCount: 0,
    featureCount: 0,
    freeSpinAwardedSum: 0,
    cascadeDepthSum: 0,
    maxWin: 0,
    maxMultiplier: 0,
  };

  for (let i = 0; i < input.spins; i += 1) {
    const base = playSpin(random, config, config.baseLadderBp);
    const baseDropPayBp = base.steps[0]?.payBp ?? 0;
    let totalPayBp = base.totalPayBp;
    out.cascadeDepthSum += base.cascadeDepth;

    if (base.scatterCount >= 3) {
      out.triggerCount += 1;
      out.featureCount += 1;
      out.freeSpinAwardedSum += base.freeSpinsAwarded;
      let remaining = base.freeSpinsAwarded;
      let retriggered = false;
      for (
        let played = 0;
        remaining > 0 && played < config.freeSpins.maxSpinsPerRound;
        played += 1
      ) {
        remaining -= 1;
        const spin = playSpin(random, config, config.freeSpinLadderBp);
        out.freeSpinWinSum += spin.totalPayBp;
        totalPayBp += spin.totalPayBp;
        if (spin.freeSpinsAwarded > 0) {
          if (config.freeSpins.retriggerUsesAwardTable) remaining += spin.freeSpinsAwarded;
          retriggered = true;
        }
      }
      if (retriggered) out.retriggerCount += 1;
    }

    if (totalPayBp > maxWinBp) {
      out.cappedRounds += 1;
      if (base.scatterCount >= 3) out.freeSpinWinSum -= totalPayBp - maxWinBp;
      totalPayBp = maxWinBp;
    }

    out.baseWinSum += baseDropPayBp;
    out.cascadeExtraSum += base.totalPayBp - baseDropPayBp;
    if (totalPayBp > 0) out.hitRounds += 1;
    if (totalPayBp > out.maxWin) out.maxWin = totalPayBp;
    for (const step of base.steps) {
      if (step.multiplierBp > out.maxMultiplier) out.maxMultiplier = step.multiplierBp;
    }

    out.winSum += totalPayBp;
    out.winSumSquares += totalPayBp * totalPayBp;
    out.spins += 1;
  }

  return out;
}

const port = parentPort;
if (port) {
  const input = workerData as WorkerInput;
  port.postMessage(run(input));
}

export { DEFAULT_ACE_CONFIG, BASIS_POINTS };
