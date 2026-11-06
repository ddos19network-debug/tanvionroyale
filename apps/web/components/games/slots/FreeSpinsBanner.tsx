'use client';

import React from 'react';

interface FreeSpinsBannerProps {
  remaining: number;
  totalRoundWin: number;
  inFreeSpins: boolean;
}

export function FreeSpinsBanner({
  remaining,
  totalRoundWin,
  inFreeSpins,
}: FreeSpinsBannerProps) {
  if (!inFreeSpins && remaining <= 0) return null;

  return (
    <div className="w-full flex items-center justify-between rounded-xl border border-yellow-400/50 bg-gradient-to-r from-yellow-950/80 via-amber-900/60 to-yellow-950/80 px-4 py-2 text-sm text-yellow-200 shadow-lg shadow-yellow-900/30 animate-pulse">
      <div className="flex items-center gap-2 font-black tracking-wider uppercase">
        <span className="text-xl">🌟</span>
        <span>Free Spins Remaining:</span>
        <span className="text-xl text-yellow-300 font-extrabold">{remaining}</span>
      </div>
      <div className="flex items-center gap-1.5 font-bold">
        <span className="text-slate-300 text-xs">Round Win:</span>
        <span className="text-yellow-300">{totalRoundWin.toLocaleString()}</span>
      </div>
    </div>
  );
}
