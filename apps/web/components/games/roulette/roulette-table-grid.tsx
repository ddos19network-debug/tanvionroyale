'use client';

import React from 'react';
import { RED_NUMBERS } from '@/lib/api/roulette';

interface TableGridProps {
  onPlaceBet: (type: string, selection: string) => void;
  winningNumber: number | null;
  activeBets: Map<string, number>;
  selectedChip: number;
  disabled?: boolean;
}

export function RouletteTableGrid({
  onPlaceBet,
  winningNumber,
  activeBets,
  disabled = false,
}: TableGridProps) {
  const getChip = (key: string) => activeBets.get(key) || 0;

  // Render chip badge
  const renderChipBadge = (amount: number) => {
    if (amount <= 0) return null;
    return (
      <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
        <div className="flex h-5 min-w-5 sm:h-6 sm:min-w-6 items-center justify-center rounded-full border border-white bg-gradient-to-r from-amber-400 to-yellow-500 px-0.5 text-[8px] sm:text-[10px] font-black text-black shadow-lg ring-1 ring-black/40">
          {amount >= 1000 ? `${(amount / 1000).toFixed(0)}k` : amount}
        </div>
      </div>
    );
  };

  // Rows of standard European roulette table
  const row3 = [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36];
  const row2 = [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35];
  const row1 = [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34];

  const renderNumberCell = (num: number) => {
    const isRed = RED_NUMBERS.has(num);
    const isWinner = winningNumber === num;
    const betKey = `straight_up:${num}`;
    const chipAmt = getChip(betKey);

    return (
      <button
        key={`num-${num}`}
        type="button"
        disabled={disabled}
        onClick={() => onPlaceBet('straight_up', String(num))}
        className={`relative flex h-8 sm:h-10 w-full items-center justify-center border border-white/10 font-bold transition hover:brightness-125 disabled:opacity-60 ${
          isRed
            ? 'bg-rose-700 text-white'
            : 'bg-zinc-900 text-zinc-100'
        } ${isWinner ? 'bg-amber-400 text-black font-black animate-pulse ring-2 ring-yellow-300 z-10' : ''}`}
      >
        <span className="text-xs sm:text-sm">{num}</span>
        {renderChipBadge(chipAmt)}
      </button>
    );
  };

  return (
    <div className="relative w-full max-w-4xl select-none overflow-x-auto rounded-xl border border-white/10 bg-[#0d131f]/95 p-1.5 sm:p-2.5 shadow-2xl backdrop-blur-md">
      <div className="min-w-[580px]">
        {/* Main Numbers Grid (0 on left + 3 rows x 12 cols + 2:1 column bets on right) */}
        <div className="flex">
          {/* Zero cell (covers all 3 row heights) */}
          <div className="w-12 sm:w-14 shrink-0 pr-1">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPlaceBet('straight_up', '0')}
              className={`relative flex h-full w-full items-center justify-center rounded-l-lg border border-white/10 bg-emerald-700 text-base sm:text-lg font-black text-white transition hover:bg-emerald-600 disabled:opacity-60 ${
                winningNumber === 0 ? 'bg-amber-400 text-black animate-pulse ring-2 ring-yellow-300' : ''
              }`}
            >
              <span>0</span>
              {renderChipBadge(getChip('straight_up:0'))}
            </button>
          </div>

          {/* 3 rows of numbers */}
          <div className="flex-1 space-y-1">
            <div className="grid grid-cols-12 gap-1">
              {row3.map(renderNumberCell)}
            </div>
            <div className="grid grid-cols-12 gap-1">
              {row2.map(renderNumberCell)}
            </div>
            <div className="grid grid-cols-12 gap-1">
              {row1.map(renderNumberCell)}
            </div>
          </div>

          {/* 2 to 1 Column Bets */}
          <div className="flex w-12 sm:w-14 shrink-0 flex-col gap-1 pl-1">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPlaceBet('column', 'col3')}
              className="relative flex h-8 sm:h-10 items-center justify-center rounded-r-lg border border-white/10 bg-slate-800 text-[10px] sm:text-[11px] font-bold text-slate-200 transition hover:bg-slate-700 disabled:opacity-60"
            >
              <span>2:1</span>
              {renderChipBadge(getChip('column:col3'))}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPlaceBet('column', 'col2')}
              className="relative flex h-8 sm:h-10 items-center justify-center rounded-r-lg border border-white/10 bg-slate-800 text-[10px] sm:text-[11px] font-bold text-slate-200 transition hover:bg-slate-700 disabled:opacity-60"
            >
              <span>2:1</span>
              {renderChipBadge(getChip('column:col2'))}
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPlaceBet('column', 'col1')}
              className="relative flex h-8 sm:h-10 items-center justify-center rounded-r-lg border border-white/10 bg-slate-800 text-[10px] sm:text-[11px] font-bold text-slate-200 transition hover:bg-slate-700 disabled:opacity-60"
            >
              <span>2:1</span>
              {renderChipBadge(getChip('column:col1'))}
            </button>
          </div>
        </div>

        {/* Outside Bets (Dozens) */}
        <div className="mt-1 flex">
          <div className="ml-12 sm:ml-14 flex-1 pr-12 sm:pr-14">
            <div className="grid grid-cols-3 gap-1">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPlaceBet('dozen', '1-12')}
                className="relative flex h-7 sm:h-8 items-center justify-center rounded border border-white/10 bg-slate-800/90 text-[11px] sm:text-xs font-bold text-slate-200 transition hover:bg-slate-700 disabled:opacity-60"
              >
                <span>1st 12</span>
                {renderChipBadge(getChip('dozen:1-12'))}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPlaceBet('dozen', '13-24')}
                className="relative flex h-7 sm:h-8 items-center justify-center rounded border border-white/10 bg-slate-800/90 text-[11px] sm:text-xs font-bold text-slate-200 transition hover:bg-slate-700 disabled:opacity-60"
              >
                <span>2nd 12</span>
                {renderChipBadge(getChip('dozen:13-24'))}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPlaceBet('dozen', '25-36')}
                className="relative flex h-7 sm:h-8 items-center justify-center rounded border border-white/10 bg-slate-800/90 text-[11px] sm:text-xs font-bold text-slate-200 transition hover:bg-slate-700 disabled:opacity-60"
              >
                <span>3rd 12</span>
                {renderChipBadge(getChip('dozen:25-36'))}
              </button>
            </div>
          </div>
        </div>

        {/* Outside Bets (Even Chance: 1-18, EVEN, RED, BLACK, ODD, 19-36) */}
        <div className="mt-1 flex">
          <div className="ml-12 sm:ml-14 flex-1 pr-12 sm:pr-14">
            <div className="grid grid-cols-6 gap-1">
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPlaceBet('range', '1-18')}
                className="relative flex h-7 sm:h-8 items-center justify-center rounded border border-white/10 bg-slate-800/90 text-[10px] sm:text-xs font-bold text-slate-200 transition hover:bg-slate-700 disabled:opacity-60"
              >
                <span>1-18</span>
                {renderChipBadge(getChip('range:1-18'))}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPlaceBet('parity', 'even')}
                className="relative flex h-7 sm:h-8 items-center justify-center rounded border border-white/10 bg-slate-800/90 text-[10px] sm:text-xs font-bold text-slate-200 transition hover:bg-slate-700 disabled:opacity-60"
              >
                <span>EVEN</span>
                {renderChipBadge(getChip('parity:even'))}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPlaceBet('color', 'red')}
                className="relative flex h-7 sm:h-8 items-center justify-center rounded border border-rose-500/40 bg-rose-700 text-[10px] sm:text-xs font-bold text-white transition hover:bg-rose-600 disabled:opacity-60"
              >
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rotate-45 bg-rose-400"></span>
                  RED
                </span>
                {renderChipBadge(getChip('color:red'))}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPlaceBet('color', 'black')}
                className="relative flex h-7 sm:h-8 items-center justify-center rounded border border-zinc-600/40 bg-zinc-900 text-[10px] sm:text-xs font-bold text-white transition hover:bg-zinc-800 disabled:opacity-60"
              >
                <span className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rotate-45 bg-zinc-400"></span>
                  BLACK
                </span>
                {renderChipBadge(getChip('color:black'))}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPlaceBet('parity', 'odd')}
                className="relative flex h-7 sm:h-8 items-center justify-center rounded border border-white/10 bg-slate-800/90 text-[10px] sm:text-xs font-bold text-slate-200 transition hover:bg-slate-700 disabled:opacity-60"
              >
                <span>ODD</span>
                {renderChipBadge(getChip('parity:odd'))}
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPlaceBet('range', '19-36')}
                className="relative flex h-7 sm:h-8 items-center justify-center rounded border border-white/10 bg-slate-800/90 text-[10px] sm:text-xs font-bold text-slate-200 transition hover:bg-slate-700 disabled:opacity-60"
              >
                <span>19-36</span>
                {renderChipBadge(getChip('range:19-36'))}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
