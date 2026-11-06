'use client';

import React, { useEffect } from 'react';
import Link from 'next/link';
import { useSlotGame } from './useSlotGame';
import { getSlotTheme } from './slot-themes';
import { ReelGrid } from './ReelGrid';
import { Hud } from './Hud';
import { StakeSelector } from './StakeSelector';
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

        {/* Controls Section */}
        <div className="w-full flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/60 p-3 shadow-xl backdrop-blur">
          {/* Left: Stake Selector */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400 font-medium hidden sm:inline">
              Stake:
            </span>
            <StakeSelector
              levels={config?.stakeLevels ?? [10, 20, 50, 100, 200, 500, 1000]}
              stake={stake}
              onSelect={setStake}
              disabled={isSpinning || autoPlayCount > 0}
              balance={balance}
              accentBg={theme.spinButtonBg}
            />
          </div>

          {/* Right: Actions (Turbo, Auto, Spin) */}
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

            <AutoPlay
              autoPlayCount={autoPlayCount}
              onStart={startAutoPlay}
              onStop={stopAutoPlay}
              disabled={isSpinning || balance === null || balance < stake}
            />

            <button
              type="button"
              onClick={spin}
              disabled={
                isSpinning ||
                autoPlayCount > 0 ||
                balance === null ||
                balance < stake
              }
              className={`px-6 sm:px-8 py-2.5 sm:py-3 rounded-xl font-black text-sm sm:text-base shadow-lg transition-all transform active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed ${theme.spinButtonBg}`}
            >
              {isSpinning ? 'Spinning...' : 'SPIN'}
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
