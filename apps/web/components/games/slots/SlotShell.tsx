'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSlotGame } from './useSlotGame';
import { getSlotTheme } from './slot-themes';
import { ReelGrid } from './ReelGrid';
import { Hud } from './Hud';

import { AutoPlay } from './AutoPlay';
import { FreeSpinsBanner } from './FreeSpinsBanner';
import { PaytablePanel } from './PaytablePanel';
import { RulesPanel } from './RulesPanel';

interface SlotShellProps {
  slug: string;
}

export function SlotShell({ slug }: SlotShellProps) {
  const theme = getSlotTheme(slug);
  const {
    config,
    balance,
    stake,
    setStake,
    grid,
    isSpinning,
    activeMultiplier,
    lastWin,
    totalRoundWin,
    freeSpinsRemaining,
    inFreeSpins,
    message,
    error,
    turbo,
    setTurbo,
    spin,
    autoPlayCount,
    startAutoPlay,
    stopAutoPlay,
    showPaytable,
    setShowPaytable,
    showRules,
    setShowRules,
  } = useSlotGame(slug);

  const [isMuted, setIsMuted] = useState(false);

  // Keyboard shortcut: Space = spin (when not modal open)
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.code === 'Space' && !showPaytable && !showRules) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'BUTTON' && target.tagName !== 'INPUT') {
          e.preventDefault();
          spin();
        }
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [spin, showPaytable, showRules]);

  return (
    <div
      className={`relative min-h-[100dvh] w-full ${theme.bgGradient} p-3 sm:p-6 text-white overflow-x-hidden flex flex-col items-center justify-between pb-[env(safe-area-inset-bottom)]`}
    >
      {/* Top Header */}
      <header className="w-full max-w-4xl flex items-center justify-between gap-2 border-b border-white/10 pb-3">
        <div>
          <Link
            href="/games/play"
            className="text-xs font-semibold text-slate-400 hover:text-white transition flex items-center gap-1 mb-1"
          >
            ← Royale Play Lobby
          </Link>
          <h1
            className={`text-2xl sm:text-3xl font-black tracking-wider uppercase ${theme.accentColor} drop-shadow`}
          >
            {config?.title ?? theme.title}
          </h1>
          <p className="text-xs text-slate-400">{theme.tagline}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowPaytable(true)}
            className="rounded-lg border border-white/20 bg-white/5 px-2.5 sm:px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-white/10 transition"
          >
            Paytable
          </button>
          <button
            type="button"
            onClick={() => setShowRules(true)}
            className="rounded-lg border border-white/20 bg-white/5 px-2.5 sm:px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-white/10 transition"
          >
            Rules
          </button>
        </div>
      </header>

      {/* Top Info Row: Bet Amount + Win Amount */}
      <div className="w-full flex items-center justify-between gap-2 mb-3 rounded-xl border border-white/10 bg-black/60 p-3 sm:p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs sm:text-sm font-medium text-slate-300">
            BET AMOUNT
          </span>
          <span className="text-sm sm:text-base font-bold text-white">{stake}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs sm:text-sm font-medium text-slate-300">
            WIN AMOUNT
          </span>
          <span className="text-sm sm:text-base font-bold text-amber-300">{totalRoundWin}</span>
        </div>
      </div>

      {/* Main Game Stage */}
      <main className="w-full max-w-4xl my-auto py-4 flex flex-col items-center gap-3">
        {/* Free-play disclaimer pill */}
        <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/40 px-3 py-1 text-[11px] text-slate-300">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>Free-play · points only · no real money</span>
        </div>

        {/* Free Spins Banner (shown when active) */}
        <FreeSpinsBanner
          remaining={freeSpinsRemaining}
          totalRoundWin={totalRoundWin}
          inFreeSpins={inFreeSpins}
        />

        {/* HUD bar */}
        <Hud
          balance={balance}
          stake={stake}
          multiplier={activeMultiplier}
          lastWin={lastWin}
          totalRoundWin={totalRoundWin}
          accentColor={theme.accentColor}
        />

        {/* Reel Grid Stage */}
        <ReelGrid
          grid={grid}
          reels={config?.reels ?? 5}
          rows={config?.rows ?? 4}
          symbolsMeta={config?.symbols}
          isSpinning={isSpinning}
          frameBorderColor={theme.frameBorderColor}
          frameGlowColor={theme.frameGlowColor}
        />

        {/* Error / Status Toast */}
        {error ? (
          <div className="w-full rounded-xl border border-rose-500/50 bg-rose-950/80 p-2 text-center text-xs font-bold text-rose-200">
            {error}
          </div>
        ) : message ? (
          <div className="w-full text-center text-xs font-semibold text-slate-300">
            {message}
          </div>
        ) : null}

        {/* Controls Section per prompt spec */}
        <div className="w-full flex flex-col sm:flex-row items-center justify-between gap-3">
          {/* Top Info Row: BET AMOUNT left, WIN AMOUNT right */}
          <div className="w-full flex items-center justify-between gap-2 mb-3 rounded-xl border border-white/10 bg-black/60 p-3 sm:p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="text-xs sm:text-sm font-medium text-slate-300">
                BET AMOUNT
              </span>
              <span className="text-sm sm:text-base font-bold text-white">{stake}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs sm:text-sm font-medium text-slate-300">
                WIN AMOUNT
              </span>
              <span className="text-sm sm:text-base font-bold text-amber-300">{totalRoundWin}</span>
            </div>
          </div>

          {/* Center Spin Row: Minus | Spin | Plus */}
          <div className="w-full flex flex-col sm:flex-row items-center justify-center gap-2 mb-3">
            <button
              type="button"
              onClick={() => setStake(Math.max(1, stake - 10))}
              disabled={isSpinning || autoPlayCount > 0 || balance === null || balance < stake}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs sm:text-sm font-semibold text-slate-300 transition hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed">
              −
            </button>

            <button
              type="button"
              onClick={spin}
              disabled={isSpinning || autoPlayCount > 0 || balance === null || balance < stake}
              className={`rounded-xl px-6 sm:px-8 py-2.5 sm:py-3 font-black text-sm sm:text-base shadow-lg transition-all transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${theme.spinButtonBg}`}
            >
              {isSpinning ? 'Spinning...' : 'SPIN'}
            </button>

            <button
              type="button"
              onClick={() => setStake(stake + 10)}
              disabled={isSpinning || autoPlayCount > 0 || balance === null || balance < stake}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs sm:text-sm font-semibold text-slate-300 transition hover:bg-white/10 disabled:opacity-50 disabled:cursor-not-allowed">
              +
            </button>
          </div>

          {/* Bottom Action Row: Settings + Auto Spin left | Turbo + Sound right */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setTurbo((t) => !t)}
              className={`rounded-lg px-2.5 py-2 text-xs font-bold transition border ${
                turbo
                  ? 'border-yellow-400 bg-yellow-400/20 text-yellow-300'
                  : 'border-white/20 bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
              title="Turbo mode (faster animation)"
            >
              ⚡ Turbo
            </button>

            <button
              type="button"
              onClick={() => setShowPaytable(true)}
              className="rounded-lg border border-white/20 bg-white/5 px-2.5 sm:px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-white/10 transition"
              aria-label="Paytable"
            >
              Paytable
            </button>
            <button
              type="button"
              onClick={() => setShowRules(true)}
              className="rounded-lg border border-white/20 bg-white/5 px-2.5 sm:px-3 py-1.5 text-xs font-bold text-slate-200 hover:bg-white/10 transition"
              aria-label="Rules"
            >
              Rules
            </button>
            <AutoPlay
              autoPlayCount={autoPlayCount}
              onStart={startAutoPlay}
              onStop={stopAutoPlay}
              disabled={isSpinning || balance === null || balance < stake}
            />

            <button
              type="button"
              onClick={() => setIsMuted((prev) => !prev)}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${isMuted ? 'bg-slate-700' : 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]'}`}
              aria-checked={!isMuted}
            >
              <span aria-hidden="true" className={`inline-block h-5 w-5 rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${isMuted ? 'translate-x-0' : 'translate-x-5'}`}></span>
            </button>
          </div>
        </div>
      </main>

      {/* Panels */}
      {config && (
        <>
          <PaytablePanel
            config={config}
            isOpen={showPaytable}
            onClose={() => setShowPaytable(false)}
          />
          <RulesPanel
            config={config}
            isOpen={showRules}
            onClose={() => setShowRules(false)}
          />
        </>
      )}

      {/* Footer hint */}
      <footer className="text-center text-[11px] text-slate-500 mt-2">
        Press <kbd className="rounded bg-white/10 px-1 py-0.5 text-slate-300">Space</kbd> to spin · Free-play points only
      </footer>
    </div>
  );
}
