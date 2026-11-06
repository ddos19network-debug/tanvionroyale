'use client';

import React from 'react';

interface StakeSelectorProps {
  levels: number[];
  stake: number;
  onSelect: (stake: number) => void;
  disabled?: boolean;
  balance?: number | null;
  accentBg?: string;
}

export function StakeSelector({
  levels,
  stake,
  onSelect,
  disabled = false,
  balance = null,
  accentBg = 'bg-amber-400 text-slate-950',
}: StakeSelectorProps) {
  const currentIndex = levels.indexOf(stake);

  const prev = () => {
    if (currentIndex > 0) onSelect(levels[currentIndex - 1]);
  };

  const next = () => {
    if (currentIndex < levels.length - 1) onSelect(levels[currentIndex + 1]);
  };

  return (
    <div className="flex items-center gap-1.5 sm:gap-2">
      <button
        type="button"
        onClick={prev}
        disabled={disabled || currentIndex <= 0}
        className="h-8 w-8 rounded-lg border border-white/20 bg-white/5 font-bold text-white transition hover:bg-white/10 disabled:opacity-40"
        title="Decrease stake"
      >
        −
      </button>

      <div className="flex items-center gap-1">
        {levels.map((lvl) => {
          const isSelected = lvl === stake;
          const cannotAfford = balance !== null && balance < lvl;
          return (
            <button
              key={lvl}
              type="button"
              onClick={() => onSelect(lvl)}
              disabled={disabled || cannotAfford}
              className={`rounded-lg px-2 sm:px-2.5 py-1 text-xs font-bold transition ${
                isSelected
                  ? `${accentBg} shadow-md`
                  : 'border border-white/10 bg-white/5 text-slate-300 hover:bg-white/10'
              } disabled:opacity-40 disabled:cursor-not-allowed`}
            >
              {lvl}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={next}
        disabled={disabled || currentIndex >= levels.length - 1}
        className="h-8 w-8 rounded-lg border border-white/20 bg-white/5 font-bold text-white transition hover:bg-white/10 disabled:opacity-40"
        title="Increase stake"
      >
        +
      </button>
    </div>
  );
}
