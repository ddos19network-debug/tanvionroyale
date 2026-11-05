'use client';

import React from 'react';
import { WHEEL_NUMBERS, RED_NUMBERS } from '@/lib/api/roulette';

interface RacetrackProps {
  onPlaceBet: (type: string, selection: string) => void;
  winningNumber: number | null;
  activeBets: Map<string, number>;
  selectedChip: number;
  disabled?: boolean;
}

export function RouletteRacetrack({
  onPlaceBet,
  winningNumber,
  activeBets,
  disabled = false,
}: RacetrackProps) {
  const getZoneChipAmount = (zone: string) => {
    return activeBets.get(`racetrack:${zone}`) || 0;
  };

  const getNumberChipAmount = (num: number) => {
    return activeBets.get(`straight_up:${num}`) || 0;
  };

  return (
    <div className="relative flex flex-col items-center justify-center rounded-xl border border-amber-500/20 bg-gradient-to-b from-[#141822]/90 to-[#0e111a]/95 p-1.5 sm:p-2.5 shadow-2xl backdrop-blur-md">
      {/* Zone quick-bet buttons */}
      <div className="mb-1.5 flex w-full max-w-xl items-center justify-between gap-1 px-1 text-[10px] sm:text-[11px] font-bold uppercase tracking-wider">
        <button
          type="button"
          disabled={disabled}
          onClick={() => onPlaceBet('racetrack', 'tiers')}
          className="relative flex-1 rounded-md border border-cyan-500/30 bg-cyan-950/40 px-1.5 py-1 text-cyan-300 transition hover:bg-cyan-900/60 disabled:opacity-50"
        >
          <span>Tiers</span>
          <span className="block text-[8px] sm:text-[9px] text-cyan-400/80">6 Chips</span>
          {getZoneChipAmount('tiers') > 0 && (
            <span className="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-cyan-400 px-1 text-[8px] font-black text-black">
              {getZoneChipAmount('tiers')}
            </span>
          )}
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => onPlaceBet('racetrack', 'orphelins')}
          className="relative flex-1 rounded-md border border-purple-500/30 bg-purple-950/40 px-1.5 py-1 text-purple-300 transition hover:bg-purple-900/60 disabled:opacity-50"
        >
          <span>Orphelins</span>
          <span className="block text-[8px] sm:text-[9px] text-purple-400/80">5 Chips</span>
          {getZoneChipAmount('orphelins') > 0 && (
            <span className="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-purple-400 px-1 text-[8px] font-black text-black">
              {getZoneChipAmount('orphelins')}
            </span>
          )}
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => onPlaceBet('racetrack', 'voisins')}
          className="relative flex-1 rounded-md border border-emerald-500/30 bg-emerald-950/40 px-1.5 py-1 text-emerald-300 transition hover:bg-emerald-900/60 disabled:opacity-50"
        >
          <span>Voisins</span>
          <span className="block text-[8px] sm:text-[9px] text-emerald-400/80">9 Chips</span>
          {getZoneChipAmount('voisins') > 0 && (
            <span className="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-emerald-400 px-1 text-[8px] font-black text-black">
              {getZoneChipAmount('voisins')}
            </span>
          )}
        </button>

        <button
          type="button"
          disabled={disabled}
          onClick={() => onPlaceBet('racetrack', 'zero')}
          className="relative flex-1 rounded-md border border-amber-500/30 bg-amber-950/40 px-1.5 py-1 text-amber-300 transition hover:bg-amber-900/60 disabled:opacity-50"
        >
          <span>Zero</span>
          <span className="block text-[8px] sm:text-[9px] text-amber-400/80">4 Chips</span>
          {getZoneChipAmount('zero') > 0 && (
            <span className="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-amber-400 px-1 text-[8px] font-black text-black">
              {getZoneChipAmount('zero')}
            </span>
          )}
        </button>
      </div>

      {/* Racetrack horizontal oval sequence with horizontal scroll on small devices */}
      <div className="w-full max-w-2xl overflow-x-auto rounded-lg border border-white/10 bg-black/60 p-1">
        <div className="flex min-w-[580px] items-center justify-between gap-0.5">
          {WHEEL_NUMBERS.map((num) => {
            const isRed = RED_NUMBERS.has(num);
            const isZero = num === 0;
            const isWinner = winningNumber === num;
            const chipAmount = getNumberChipAmount(num);

            let bgClass = isZero
              ? 'bg-emerald-700 hover:bg-emerald-600 text-white'
              : isRed
              ? 'bg-rose-700 hover:bg-rose-600 text-white'
              : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100';

            if (isWinner) {
              bgClass = 'bg-amber-400 text-black font-black animate-pulse ring-2 ring-yellow-300';
            }

            return (
              <button
                key={`race-${num}`}
                type="button"
                disabled={disabled}
                onClick={() => onPlaceBet('straight_up', String(num))}
                className={`relative flex h-6 w-6 sm:h-7 sm:w-7 shrink-0 items-center justify-center rounded text-[10px] sm:text-[11px] font-bold shadow transition disabled:opacity-60 ${bgClass}`}
                title={`Number ${num}`}
              >
                <span>{num}</span>
                {chipAmount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-3 min-w-3 items-center justify-center rounded-full bg-yellow-400 px-0.5 text-[7px] font-black text-black">
                    {chipAmount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
