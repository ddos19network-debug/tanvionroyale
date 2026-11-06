'use client';

import React from 'react';
import { SymbolView } from './SymbolView';
import type { SlotSymbolMeta } from '@tanvion-royale/types';

interface ReelGridProps {
  grid: string[][] | null;
  reels: number;
  rows: number;
  symbolsMeta?: SlotSymbolMeta[];
  isSpinning?: boolean;
  frameBorderColor?: string;
  frameGlowColor?: string;
}

export function ReelGrid({
  grid,
  reels,
  rows,
  symbolsMeta,
  isSpinning = false,
  frameBorderColor = 'border-amber-400/60',
  frameGlowColor = 'rgba(251,191,36,0.18)',
}: ReelGridProps) {
  // Compute cell size dynamically based on columns
  const cellSize = reels >= 7 ? 40 : reels >= 6 ? 48 : 56;

  return (
    <div
      className={`relative rounded-2xl border-4 ${frameBorderColor} bg-black/60 p-2 sm:p-3 shadow-2xl transition-all`}
      style={{ boxShadow: `0 0 50px ${frameGlowColor}` }}
    >
      <div
        className="grid gap-1.5 sm:gap-2.5"
        style={{
          gridTemplateColumns: `repeat(${reels}, minmax(0, 1fr))`,
        }}
      >
        {grid
          ? grid.map((row, r) =>
              row.map((sym, c) => (
                <div
                  key={`${r}-${c}`}
                  className={`flex items-center justify-center transition-all ${
                    isSpinning ? 'opacity-80 scale-95 blur-[0.3px]' : 'opacity-100 scale-100'
                  }`}
                >
                  <SymbolView
                    symbolId={sym}
                    symbolsMeta={symbolsMeta}
                    size={cellSize}
                  />
                </div>
              )),
            )
          : Array.from({ length: rows * reels }).map((_, i) => (
              <div
                key={i}
                className="h-12 w-12 sm:h-14 sm:w-14 rounded-xl bg-slate-900/60 animate-pulse"
              />
            ))}
      </div>
    </div>
  );
}
