'use client';

import React from 'react';

interface HudProps {
  balance: number | null;
  stake: number;
  multiplier: number;
  lastWin: number;
  totalRoundWin: number;
  accentColor?: string;
}

export function Hud({
  balance,
  stake,
  multiplier,
  lastWin,
  totalRoundWin,
  accentColor = 'text-amber-400',
}: HudProps) {
  const displayWin = totalRoundWin > 0 ? totalRoundWin : lastWin;

  return (
    <div className="w-full flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/60 px-4 py-2.5 text-xs sm:text-sm text-slate-200 shadow-lg backdrop-blur">
      <div className="flex flex-wrap items-center gap-3 sm:gap-5">
        <div className="flex items-center gap-1.5">
          <span className="text-slate-400 font-medium">Balance</span>
          <span className={`font-black ${accentColor}`}>
            {balance !== null ? balance.toLocaleString() : '---'}
          </span>
          <span className="text-[10px] text-slate-400 uppercase tracking-wider">pts</span>
        </div>

        <div className="hidden sm:inline text-slate-600">|</div>

        <div className="flex items-center gap-1.5">
          <span className="text-slate-400 font-medium">Stake</span>
          <span className="font-bold text-white">{stake.toLocaleString()}</span>
        </div>

        {multiplier > 1 && (
          <>
            <div className="hidden sm:inline text-slate-600">|</div>
            <div className="flex items-center gap-1.5 animate-pulse">
              <span className="text-slate-400 font-medium">Mult</span>
              <span className="font-black text-emerald-400">×{multiplier}</span>
            </div>
          </>
        )}
      </div>

      <div
        className="flex items-center gap-2"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className="text-slate-400 font-medium">Win</span>
        <span
          className={`font-black transition-all ${
            displayWin > 0
              ? 'text-lg sm:text-xl text-yellow-300 drop-shadow-[0_0_8px_rgba(253,224,71,0.6)]'
              : 'text-slate-400'
          }`}
        >
          {displayWin > 0 ? displayWin.toLocaleString() : 0}
        </span>
      </div>
    </div>
  );
}
