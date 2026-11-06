#!/usr/bin/env node
/**
 * Slot simulation CLI — Monte Carlo RTP simulator for Royale Play games #4 to #13.
 *
 * Usage:
 *   npx ts-node -r tsconfig-paths/register src/modules/games/slots/slot-sim.cli.ts --game=royale-pharaoh --spins=2000000
 */

import { SeededRng } from './core/rng';
import { deriveRound } from './core/round';
import { getSlot, listSlotSlugs } from './slot.registry';

export interface SimReport {
  game: string;
  spins: number;
  stake: number;
  totalWon: number;
  rtpTotal: number;
  rtpBase: number;
  rtpFreeSpins: number;
  hitFrequency: number;
  fsTriggerFrequency: number; // 1 in N
  avgFsRoundValue: number;
  maxWinStakeMult: number;
  roundsCappedCount: number;
  volatilityStdDev: number;
  buckets: {
    zero: number;
    under1x: number;
    oneTo2x: number;
    twoTo5x: number;
    fiveTo20x: number;
    twentyTo100x: number;
    over100x: number;
  };
}

export function runSimulation(slug: string, spins: number, stake = 100, seed = 'slot-sim-seed'): SimReport {
  const registered = getSlot(slug);
  if (!registered) throw new Error(`Game "${slug}" not found in slot registry`);
  const { config, hooks } = registered;

  const rng = new SeededRng(seed);

  let totalWon = 0;
  let baseWon = 0;
  let fsWon = 0;
  let winningRounds = 0;
  let fsTriggerCount = 0;
  let maxWinStakeMult = 0;
  let roundsCappedCount = 0;

  // For std dev
  let sumX = 0;
  let sumX2 = 0;

  const buckets = {
    zero: 0,
    under1x: 0,
    oneTo2x: 0,
    twoTo5x: 0,
    fiveTo20x: 0,
    twentyTo100x: 0,
    over100x: 0,
  };

  for (let i = 0; i < spins; i++) {
    const round = deriveRound(rng, config, stake, hooks);

    const won = round.payout;
    totalWon += won;
    const baseWin = Math.floor((stake * round.baseSteps.reduce((s, st) => s + st.stepPayBp, 0)) / 10000);
    baseWon += baseWin;
    fsWon += won - baseWin;

    const mult = won / stake;
    if (won > 0) winningRounds++;
    if (round.freeSpins.triggered) fsTriggerCount++;
    if (mult > maxWinStakeMult) maxWinStakeMult = mult;
    if (round.capped) roundsCappedCount++;

    sumX += mult;
    sumX2 += mult * mult;

    if (won === 0) buckets.zero++;
    else if (mult < 1) buckets.under1x++;
    else if (mult <= 2) buckets.oneTo2x++;
    else if (mult <= 5) buckets.twoTo5x++;
    else if (mult <= 20) buckets.fiveTo20x++;
    else if (mult <= 100) buckets.twentyTo100x++;
    else buckets.over100x++;
  }

  const totalBet = spins * stake;
  const rtpTotal = (totalWon / totalBet) * 100;
  const rtpBase = (baseWon / totalBet) * 100;
  const rtpFreeSpins = (fsWon / totalBet) * 100;
  const hitFrequency = (winningRounds / spins) * 100;
  const fsTriggerFrequency = fsTriggerCount > 0 ? spins / fsTriggerCount : 0;
  const avgFsRoundValue = fsTriggerCount > 0 ? (fsWon / fsTriggerCount) / stake : 0;

  const mean = sumX / spins;
  const variance = Math.max(0, sumX2 / spins - mean * mean);
  const volatilityStdDev = Math.sqrt(variance);

  return {
    game: slug,
    spins,
    stake,
    totalWon,
    rtpTotal,
    rtpBase,
    rtpFreeSpins,
    hitFrequency,
    fsTriggerFrequency,
    avgFsRoundValue,
    maxWinStakeMult,
    roundsCappedCount,
    volatilityStdDev,
    buckets,
  };
}

export function formatSimReport(rep: SimReport): string {
  return `
============================================================
ROYALE PLAY SIMULATION REPORT — ${rep.game.toUpperCase()}
============================================================
Total Spins:           ${rep.spins.toLocaleString()}
Total Stake:           ${(rep.spins * rep.stake).toLocaleString()} points
Total Won:             ${rep.totalWon.toLocaleString()} points

RTP (Total):           ${rep.rtpTotal.toFixed(2)}%
  - Base Game:         ${rep.rtpBase.toFixed(2)}%
  - Free Spins:        ${rep.rtpFreeSpins.toFixed(2)}%

Hit Frequency:         ${rep.hitFrequency.toFixed(2)}%
Free Spins Trigger:    1 in ${rep.fsTriggerFrequency.toFixed(1)} spins
Avg Free Spin Value:   ${rep.avgFsRoundValue.toFixed(1)}× stake
Max Win Observed:      ${rep.maxWinStakeMult.toFixed(1)}× stake
Rounds Capped:         ${rep.roundsCappedCount} (${((rep.roundsCappedCount / rep.spins) * 100).toFixed(4)}%)
Volatility (StdDev):   ${rep.volatilityStdDev.toFixed(2)}

Payout Distribution:
  0× (Loss):           ${((rep.buckets.zero / rep.spins) * 100).toFixed(2)}%
  < 1× stake:          ${((rep.buckets.under1x / rep.spins) * 100).toFixed(2)}%
  1× – 2× stake:       ${((rep.buckets.oneTo2x / rep.spins) * 100).toFixed(2)}%
  2× – 5× stake:       ${((rep.buckets.twoTo5x / rep.spins) * 100).toFixed(2)}%
  5× – 20× stake:      ${((rep.buckets.fiveTo20x / rep.spins) * 100).toFixed(2)}%
  20× – 100× stake:    ${((rep.buckets.twentyTo100x / rep.spins) * 100).toFixed(2)}%
  100×+ stake:         ${((rep.buckets.over100x / rep.spins) * 100).toFixed(2)}%
============================================================
`;
}

// Standalone CLI execution
if (require.main === module) {
  const args = process.argv.slice(2);
  let game = 'royale-pharaoh';
  let spins = 200_000;
  let stake = 100;
  let seed = 'slot-sim-seed';

  for (const a of args) {
    if (a.startsWith('--game=')) game = a.split('=')[1];
    if (a.startsWith('--spins=')) spins = parseInt(a.split('=')[1], 10);
    if (a.startsWith('--stake=')) stake = parseInt(a.split('=')[1], 10);
    if (a.startsWith('--seed=')) seed = a.split('=')[1];
  }

  console.log(`Starting simulation for ${game} (${spins.toLocaleString()} spins)...`);
  const rep = runSimulation(game, spins, stake, seed);
  console.log(formatSimReport(rep));
}
