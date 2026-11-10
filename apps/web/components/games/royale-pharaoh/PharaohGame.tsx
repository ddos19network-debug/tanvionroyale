'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import {
  PHARAOH_SYMBOLS,
  PAYLINES,
  BET_OPTIONS,
  MULTIPLIERS,
  REEL_STRIPS,
  evaluateSpin,
  normalizeSymbolKey,
} from './pharaoh-config';
import { GameState, SpinHistoryItem } from './pharaoh-types';
import { TempleBackground } from './pharaoh-decoration';
import { SymbolTile, PHARAOH_LOGO_IMAGE } from './pharaoh-images';
import { PharaohSettingsModal, PaytablePanel, GameRulesPanel } from './pharaoh-panels';

/**
 * Premium Web Audio Synthesizer for High-End Electronic Casino Slots
 * Smooth, warm, refined tones - zero harshness
 */
class PharaohSoundFX {
  private spinAudio: HTMLAudioElement | null = null;
  private ctx: AudioContext | null = null;

  private playSound(src: string, volume = 0.5, loop = false): HTMLAudioElement | null {
    if (typeof window === 'undefined') return null;
    try {
      const audio = new Audio(src);
      audio.volume = volume;
      audio.loop = loop;
      audio.play().catch(() => {});
      return audio;
    } catch {
      return null;
    }
  }

  startSpinTicks(isTurbo: boolean) {
    this.stopSpinTicks();
    try {
      this.spinAudio = this.playSound(
        '/assets/sound/spinning-reel-sound-in-sl-26jlqo6t.wav',
        0.5,
        true
      );
    } catch {
      // fallback
    }
  }

  stopSpinTicks() {
    if (this.spinAudio) {
      try {
        this.spinAudio.pause();
        this.spinAudio.currentTime = 0;
      } catch {}
      this.spinAudio = null;
    }
  }

  playReelStop(reelIdx: number) {
    this.playSound('/assets/sound/spin-reel-stop-vjal3u5g.wav', 0.65);
  }

  playWinChime(isBig = false) {
    if (isBig) {
      this.playSound('/assets/sound/now-create-a-big-win-xopljypy.wav', 0.75);
    } else {
      this.playSound('/assets/sound/slot-win-sound-effect-xagy52ul.wav', 0.7);
    }
  }

  playScatterBonus() {
    this.playSound('/assets/sound/now-create-a-bonus-scatte-kvnlbo2a.wav', 0.85);
  }

  playClick() {
    this.playSound('/assets/sound/button-clicking-sound-eff-t2cl223c.wav', 0.35);
  }
}

const soundFX = new PharaohSoundFX();

/**
 * Individual Reel Column
 * Spins DOWNWARD from top to bottom through multiple full cycles:
 * - Starts at very high speed (linear 0% to 52%)
 * - Then smoothly, gradually decelerates into place (52% to 100%) with ZERO shaking/jolt
 */
interface ReelColumnProps {
  colIndex: number;
  displaySymbols: string[];
  isSpinning: boolean;
  spinStrip: string[];
  spinDuration: number;
  winningCells: { col: number; row: number }[];
  onLand: (colIdx: number) => void;
}

const ReelColumn: React.FC<ReelColumnProps> = ({
  colIndex,
  displaySymbols,
  isSpinning,
  spinStrip,
  spinDuration,
  winningCells,
  onLand,
}) => {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const animRef = useRef<Animation | null>(null);
  const landedRef = useRef(false);

  useEffect(() => {
    if (isSpinning && spinStrip.length >= 6 && stripRef.current) {
      landedRef.current = false;
      const el = stripRef.current;
      const totalCount = spinStrip.length;
      const distPercent = ((totalCount - 3) / totalCount) * 100;

      if (animRef.current) {
        animRef.current.cancel();
      }

      // Single smooth, monotonic casino deceleration curve
      // Starts at high speed, smoothly decelerates into place with zero bounce, zero jerk, and no secondary spin
      const keyframes: Keyframe[] = [
        {
          transform: `translate3d(0, -${distPercent}%, 0)`,
        },
        {
          transform: 'translate3d(0, 0%, 0)',
        },
      ];

      try {
        const anim = el.animate(keyframes, {
          duration: spinDuration,
          easing: 'cubic-bezier(0.16, 0.95, 0.24, 1)',
          fill: 'forwards',
        });
        animRef.current = anim;

        anim.onfinish = () => {
          if (!landedRef.current) {
            landedRef.current = true;
            // Keep the forwards fill active so it doesn't snap before React renders settled state
            animRef.current = null;
            onLand(colIndex);
          }
        };
      } catch {
        // Fallback in case of environment limitation
        setTimeout(() => {
          if (!landedRef.current) {
            landedRef.current = true;
            onLand(colIndex);
          }
        }, spinDuration);
      }

      return () => {
        if (animRef.current && !landedRef.current) {
          try {
            animRef.current.cancel();
          } catch {
            // ignore
          }
          animRef.current = null;
        }
      };
    } else {
      if (animRef.current) {
        try {
          animRef.current.cancel();
        } catch {
          // ignore
        }
        animRef.current = null;
      }
    }
  }, [isSpinning, spinStrip, spinDuration, colIndex, onLand]);

  // Spinning State: Strip scrolls DOWNWARDS smoothly into place with 3:5 aspect ratio
  if (isSpinning && spinStrip.length >= 6) {
    const totalCount = spinStrip.length;
    return (
      <div className="relative w-full overflow-hidden rounded-xl bg-black/35 backdrop-blur-[1px] shadow-[inset_0_0_12px_rgba(0,0,0,0.6)] p-0.5 flex flex-col justify-between gap-1">
        {/* 3 Invisible phantom items ensuring column height exactly matches settled 3:5 state */}
        <div className="w-full flex-1 min-h-0 aspect-[3/5] opacity-0 pointer-events-none" />
        <div className="w-full flex-1 min-h-0 aspect-[3/5] opacity-0 pointer-events-none" />
        <div className="w-full flex-1 min-h-0 aspect-[3/5] opacity-0 pointer-events-none" />

        <div
          ref={stripRef}
          style={{
            height: `${(totalCount / 3) * 100}%`,
            willChange: 'transform',
          }}
          className="absolute top-0 left-0 w-full flex flex-col pointer-events-none"
        >
          {spinStrip.map((symKey, idx) => (
            <div
              key={idx}
              style={{ height: `${100 / totalCount}%` }}
              className="w-full flex items-center justify-center p-0.5 aspect-[3/5]"
            >
              <SymbolTile symId={symKey} isSpinning={true} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Idle Settled State: exactly 3 taller symbols (Ratio 3:5 for responsive mobile)
  return (
    <div className="relative w-full overflow-hidden rounded-xl bg-black/35 backdrop-blur-[1px] shadow-[inset_0_0_12px_rgba(0,0,0,0.6)] flex flex-col justify-between gap-1 p-0.5">
      {displaySymbols.map((symKey, rowIdx) => {
        const isWinningCell = winningCells.some((c) => c.col === colIndex && c.row === rowIdx);
        return (
          <div
            key={rowIdx}
            className="w-full flex-1 min-h-0 flex items-center justify-center aspect-[3/5]"
          >
            <SymbolTile symId={symKey} isWinning={isWinningCell} />
          </div>
        );
      })}
    </div>
  );
};

export default function PharaohGame() {
  const [state, setState] = useState<GameState>({
    reels: [
      ['cleopatra', 'anubis', 'mask'],
      ['horus', 'scarab', 'scatter'],
      ['ankh', 'coin', 'sarcophagus'],
      ['cleopatra', 'coin', 'mask'],
      ['horus', 'scarab', 'ankh'],
    ],
    isSpinning: false,
    reelSpinning: [false, false, false, false, false],
    bet: 1,
    balance: 10000,
    win: 0,
    totalWin: 0,
    multiplier: 1,
    freeSpins: 0,
    inFreeSpins: false,
    showBonusAnimation: false,
    winningLines: [],
    winningCells: [],
    activeWinResults: [],
    autoPlay: false,
    autoPlayCount: 0,
    turbo: false,
    soundEnabled: true,
    showPaytable: false,
    showRules: false,
    showSettings: false,
  });

  const [history, setHistory] = useState<SpinHistoryItem[]>([]);
  const [spinStrips, setSpinStrips] = useState<string[][]>([[], [], [], [], []]);
  const [reelDurations, setReelDurations] = useState<number[]>([1500, 1850, 2200, 2550, 2900]);

  const targetReelsRef = useRef<string[][]>(state.reels);
  const pendingLandsRef = useRef<Set<number>>(new Set());
  const stateRef = useRef(state);
  stateRef.current = state;

  // Load balance from local storage
  useEffect(() => {
    try {
      const savedBalance = localStorage.getItem('pharaoh_slot_balance');
      if (savedBalance) {
        const val = parseInt(savedBalance, 10);
        if (!isNaN(val) && val > 0) {
          setState((prev) => ({ ...prev, balance: val }));
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // Save balance on change
  useEffect(() => {
    try {
      localStorage.setItem('pharaoh_slot_balance', state.balance.toString());
    } catch {
      // ignore
    }
  }, [state.balance]);

  // RNG reel generation
  const generateNewReels = useCallback((): string[][] => {
    return Array.from({ length: 5 }, (_, colIdx) => {
      const strip = REEL_STRIPS[colIdx];
      const startIdx = Math.floor(Math.random() * strip.length);
      return [
        strip[startIdx % strip.length],
        strip[(startIdx + 1) % strip.length],
        strip[(startIdx + 2) % strip.length],
      ];
    });
  }, []);

  // Build physical spin strip for downward scroll
  // Top 3 = target symbols; Middle = 42 to 78 random symbols (multiple full rotations); Bottom 3 = current symbols
  const buildSpinStrips = useCallback((currentReels: string[][], targetReels: string[][], isTurbo: boolean) => {
    return Array.from({ length: 5 }, (_, colIdx) => {
      const pool = REEL_STRIPS[colIdx];
      const interCount = isTurbo ? 18 + colIdx * 4 : 42 + colIdx * 9;
      const intermediates: string[] = [];
      for (let i = 0; i < interCount; i++) {
        intermediates.push(pool[Math.floor(Math.random() * pool.length)]);
      }
      return [...targetReels[colIdx], ...intermediates, ...currentReels[colIdx]];
    });
  }, []);

  // Finalize spin when all reels have landed smoothly
  const finalizeSpin = useCallback(() => {
    const s = stateRef.current;
    const finalReels = targetReelsRef.current;
    soundFX.stopSpinTicks();

    const evalResult = evaluateSpin(finalReels, s.bet, s.multiplier);
    const isFreeSpinActive = s.inFreeSpins;
    const remainingFreeSpins = isFreeSpinActive ? Math.max(0, s.freeSpins - 1) : s.freeSpins;
    const newFreeSpins = evalResult.triggeredBonus ? remainingFreeSpins + 10 : remainingFreeSpins;
    const willBeInFreeSpins = newFreeSpins > 0;

    if (evalResult.totalWin > 0 && s.soundEnabled) {
      soundFX.playWinChime(evalResult.totalWin >= s.bet * 5);
    }
    if (evalResult.triggeredBonus && s.soundEnabled) {
      soundFX.playScatterBonus();
    }

    // Record to Session Spin History
    const historyItem: SpinHistoryItem = {
      id: `${Date.now()}-${Math.random()}`,
      time: new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      bet: s.bet,
      multiplier: s.multiplier,
      win: evalResult.totalWin,
      isBonus: evalResult.triggeredBonus,
    };
    setHistory((prev) => [historyItem, ...prev.slice(0, 24)]);

    setState((prev) => ({
      ...prev,
      reels: finalReels,
      isSpinning: false,
      reelSpinning: [false, false, false, false, false],
      win: evalResult.totalWin,
      totalWin: prev.totalWin + evalResult.totalWin,
      balance: prev.balance + evalResult.totalWin,
      winningLines: evalResult.winningLines,
      winningCells: evalResult.winningCells,
      activeWinResults: evalResult.lineResults,
      freeSpins: newFreeSpins,
      inFreeSpins: willBeInFreeSpins,
      showBonusAnimation: evalResult.triggeredBonus,
    }));

    // Auto Play loop
    if (s.autoPlay && s.autoPlayCount > 1) {
      setTimeout(() => {
        setState((prev) => ({ ...prev, autoPlayCount: prev.autoPlayCount - 1 }));
        handleSpin();
      }, s.turbo ? 400 : 800);
    } else if (s.autoPlay) {
      setState((prev) => ({ ...prev, autoPlay: false, autoPlayCount: 0 }));
    }
  }, []);

  // Handle individual reel landing
  const handleReelLand = useCallback((colIdx: number) => {
    const s = stateRef.current;
    if (s.soundEnabled) {
      soundFX.playReelStop(colIdx);
    }

    pendingLandsRef.current.delete(colIdx);

    setState((prev) => {
      const nextReels = [...prev.reels];
      nextReels[colIdx] = targetReelsRef.current[colIdx];
      const nextSpinning = [...prev.reelSpinning];
      nextSpinning[colIdx] = false;
      return {
        ...prev,
        reels: nextReels,
        reelSpinning: nextSpinning,
      };
    });

    if (pendingLandsRef.current.size === 0) {
      finalizeSpin();
    }
  }, [finalizeSpin]);

  // Instant Quick Stop
  const handleQuickStop = useCallback(() => {
    const s = stateRef.current;
    if (!s.isSpinning) return;

    soundFX.stopSpinTicks();
    if (s.soundEnabled) {
      soundFX.playReelStop(4);
    }

    pendingLandsRef.current.clear();
    setState((prev) => ({
      ...prev,
      reels: targetReelsRef.current,
      reelSpinning: [false, false, false, false, false],
    }));
    finalizeSpin();
  }, [finalizeSpin]);

  // Core Spin trigger — 1 full spin must complete, cannot be stopped mid-spin
  const handleSpin = useCallback(() => {
    const s = stateRef.current;
    if (s.isSpinning) {
      return; // Cannot stop early; 1 full spin is guaranteed
    }

    if (!s.inFreeSpins && s.balance < s.bet) {
      if (s.autoPlay) {
        setState((p) => ({ ...p, autoPlay: false, autoPlayCount: 0 }));
      }
      alert('অপর্যাপ্ত ব্যালেন্স! সর্বনিম্ন বেট ১ টাকা।');
      return;
    }

    const newTargetReels = generateNewReels();
    targetReelsRef.current = newTargetReels;

    const newBalance = s.inFreeSpins ? s.balance : s.balance - s.bet;
    const strips = buildSpinStrips(s.reels, newTargetReels, s.turbo);
    setSpinStrips(strips);

    // Staggered durations: Starts very fast, each column spins multiple times, decelerates smoothly
    const baseDuration = s.turbo ? 500 : 1500;
    const stagger = s.turbo ? 120 : 350;
    const durations = [
      baseDuration,
      baseDuration + stagger,
      baseDuration + stagger * 2,
      baseDuration + stagger * 3,
      baseDuration + stagger * 4,
    ];
    setReelDurations(durations);

    pendingLandsRef.current = new Set([0, 1, 2, 3, 4]);

    if (s.soundEnabled) {
      soundFX.startSpinTicks(s.turbo);
    }

    setState((prev) => ({
      ...prev,
      isSpinning: true,
      reelSpinning: [true, true, true, true, true],
      balance: newBalance,
      win: 0,
      winningLines: [],
      winningCells: [],
      activeWinResults: [],
    }));
  }, [generateNewReels, buildSpinStrips, handleQuickStop]);

  // Bet step helpers
  const handleBetMinus = () => {
    const currentIdx = BET_OPTIONS.indexOf(state.bet);
    if (currentIdx > 0) {
      setState((p) => ({ ...p, bet: BET_OPTIONS[currentIdx - 1] }));
    } else {
      setState((p) => ({ ...p, bet: Math.max(1, p.bet - 1) }));
    }
  };

  const handleBetPlus = () => {
    const currentIdx = BET_OPTIONS.indexOf(state.bet);
    if (currentIdx !== -1 && currentIdx < BET_OPTIONS.length - 1) {
      setState((p) => ({ ...p, bet: BET_OPTIONS[currentIdx + 1] }));
    } else {
      setState((p) => ({ ...p, bet: Math.min(500, p.bet + (p.bet < 10 ? 1 : 10)) }));
    }
  };

  const handleStartAutoPlay = useCallback((count: number) => {
    setState((p) => ({ ...p, autoPlay: true, autoPlayCount: count }));
    setTimeout(() => {
      handleSpin();
    }, 150);
  }, [handleSpin]);

  const handleStopAutoPlay = useCallback(() => {
    setState((p) => ({ ...p, autoPlay: false, autoPlayCount: 0 }));
  }, []);

  // Keyboard shortcut: Spacebar
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !state.showPaytable && !state.showRules) {
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'BUTTON') {
          e.preventDefault();
          handleSpin();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSpin, state.showPaytable, state.showRules]);

  return (
    <div className="relative h-[100dvh] max-h-[100dvh] w-full bg-transparent text-white flex flex-col justify-between overflow-hidden font-sans select-none">
      {/* High-definition Pharaoh Temple Background */}
      <TempleBackground />

      {/* HEADER PANEL — SLEEK, SLIMMER BUTTON HEIGHT, 1-LINE BALANCE */}
      <header className="w-full bg-black/40 backdrop-blur-md border-b border-[#F5C451]/30 px-2 sm:px-4 py-1 flex justify-between items-center z-30 shadow-[0_2px_15px_rgba(0,0,0,0.7)] min-h-[36px] max-h-[40px]">
        <Link
          href="/games"
          className="flex items-center space-x-1 text-[#19C6C2] font-black text-xs tracking-wider uppercase hover:text-white transition px-2 py-0.5 rounded-lg bg-black/40 border border-[#19C6C2]/40 shadow-[0_0_8px_rgba(25,198,194,0.3)] h-6 sm:h-7"
        >
          <span>&larr;</span> <span>Back</span>
        </Link>

        {/* Logo Image — transparent background, perfectly centered */}
        <div className="flex items-center justify-center">
          <img
            src={PHARAOH_LOGO_IMAGE}
            alt="Royale Pharaoh - Curse of the Golden Kingdom"
            className="h-6 sm:h-7 w-auto object-contain filter drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]"
          />
        </div>

        {/* Wallet Balance in BDT — Balance and Amount in ONE LINE */}
        <div className="bg-black/45 border border-[#F5C451]/50 rounded-lg px-2 sm:px-2.5 py-0.5 flex items-center space-x-1 shadow-[0_0_10px_rgba(245,196,81,0.25)] h-6 sm:h-7">
          <span className="text-[9px] sm:text-[10px] uppercase tracking-wider text-gray-400 font-bold">
            Balance:
          </span>
          <span className="text-[#19C6C2] font-mono font-black text-xs sm:text-sm">
            ৳{state.balance.toLocaleString()}
          </span>
        </div>
      </header>

      {/* FREE SPINS ACTIVE BANNER */}
      {state.inFreeSpins && (
        <div className="w-full bg-gradient-to-r from-[#A66B16] via-[#F5C451] to-[#A66B16] text-[#080E24] py-0.5 px-4 text-center font-black tracking-widest uppercase text-xs shadow-[0_0_15px_#F5C451] z-20 animate-pulse flex items-center justify-center space-x-2">
          <span>✨</span>
          <span>FREE SPINS ACTIVE: {state.freeSpins} REMAINING</span>
          <span>✨</span>
        </div>
      )}

      {/* MULTIPLIER TRACKER BAR — MATCHING BOARD WIDTH (407px) DIRECTLY OVER 5 REELS */}
      <div className="w-full max-w-[407px] mx-auto px-1 py-1 z-20">
        <div className="grid grid-cols-5 gap-1 sm:gap-1.5 w-full">
          {MULTIPLIERS.map((m) => {
            const isActive = state.multiplier === m;
            return (
              <button
                key={m}
                disabled={state.isSpinning}
                onClick={() => setState((p) => ({ ...p, multiplier: m }))}
                className={`text-center py-0.5 sm:py-1 rounded-md font-black transition-all duration-200 text-[10px] sm:text-xs ${
                  isActive
                    ? 'bg-gradient-to-b from-[#F5C451] via-[#D49A24] to-[#A66B16] text-[#080E24] border border-[#FFF2A3] shadow-[0_0_12px_#F5C451] scale-105'
                    : 'bg-black/40 text-gray-300 border border-[#F5C451]/20 hover:border-[#F5C451]/60 hover:text-white'
                }`}
              >
                {m}X
              </button>
            );
          })}
        </div>
      </div>

      {/* MAIN GAMEPLAY VIEWPORT (RESPONSIVE MOBILE 3:5 SYMBOLS, MAXIMUM BODY WIDTH FIT) */}
      <main className="flex-1 min-h-0 flex flex-col justify-center items-center px-1 py-0.5 w-full mx-auto z-10">
        {/* 5x3 SLOT REELS VIEWPORT — 3:5 SYMBOLS, SCALED SO IT NEVER GOES UNDER BUTTONS OR HEADER */}
        <div className="relative w-full max-w-[407px] max-h-[min(585px,calc(100dvh-165px))] grid grid-cols-5 gap-1 sm:gap-1.5 z-10 select-none mx-auto">
          {state.reels.map((colSymbols, colIdx) => (
            <ReelColumn
              key={colIdx}
              colIndex={colIdx}
              displaySymbols={colSymbols}
              isSpinning={state.reelSpinning[colIdx]}
              spinStrip={spinStrips[colIdx] || []}
              spinDuration={reelDurations[colIdx] || 1500}
              winningCells={state.winningCells}
              onLand={handleReelLand}
            />
          ))}

          {/* BONUS / FREE SPIN OVERLAY */}
          {state.showBonusAnimation && (
            <div className="absolute inset-0 bg-[#080E24]/90 backdrop-blur-md flex flex-col justify-center items-center z-40 p-4 text-center animate-fade-in rounded-2xl">
              <div className="text-3xl sm:text-5xl mb-1 sm:mb-2">👑</div>
              <h2 className="text-2xl sm:text-4xl font-black text-[#F5C451] tracking-widest animate-bounce mb-1 drop-shadow-[0_0_20px_#F5C451]">
                PHARAOH BONUS!
              </h2>
              <p className="text-[#19C6C2] text-sm sm:text-lg font-bold uppercase tracking-widest drop-shadow-[0_0_10px_#19C6C2]">
                10 Free Spins Triggered
              </p>
              <p className="text-gray-300 text-xs sm:text-sm mt-1 max-w-sm">
                The golden tomb of eternal gold unlocks multiplied royal payouts!
              </p>
              <button
                onClick={() => setState((p) => ({ ...p, showBonusAnimation: false }))}
                className="mt-4 sm:mt-6 px-6 sm:px-8 py-2 sm:py-3 bg-gradient-to-r from-[#F5C451] via-[#FFF2A3] to-[#F5C451] text-[#080E24] font-black uppercase text-xs sm:text-sm tracking-widest rounded-full border-2 border-white shadow-[0_0_20px_#F5C451] hover:scale-105 active:scale-95 transition"
              >
                Claim Free Spins
              </button>
            </div>
          )}
        </div>

        {/* WIN NOTIFICATION TOAST (5 RIL 3 ROW TEXT REMOVED COMPLETELY) */}
        {state.winningLines.length > 0 && !state.isSpinning && (
          <div className="w-full max-w-[407px] text-center pt-0.5 min-h-[16px]">
            <span className="text-[#19C6C2] font-black text-[11px] sm:text-xs animate-pulse tracking-wide drop-shadow-[0_0_8px_#19C6C2]">
              🎉 {state.winningLines.length}টি উইনিং লাইন হিট!
            </span>
          </div>
        )}
      </main>

      {/* DASHBOARD CONTROLS FOOTER: EXACT USER DESIGN SPECIFICATION */}
      <footer className="w-full bg-black/50 backdrop-blur-md border-t border-[#F5C451]/30 px-2 sm:px-4 py-1.5 sm:py-2 z-30 shadow-[0_-4px_25px_rgba(0,0,0,0.8)]">
        <div className="max-w-[407px] mx-auto">
          {/* Main Action Bar */}
          <div className="grid grid-cols-3 items-center gap-2 sm:gap-4">
            {/* LEFT: BET (AMOUNT ON SAME ROW IN ENGLISH) | SETTINGS GEAR ICON UNDERNEATH (NO TEXT, LARGER) */}
            <div className="flex flex-col items-center sm:items-start space-y-1.5">
              {/* BET & AMOUNT IN ONE ROW */}
              <div className="flex items-center space-x-1.5 bg-black/60 backdrop-blur-sm border border-[#F5C451]/40 rounded-xl px-2 sm:px-2.5 py-1.5 shadow-[0_0_12px_rgba(0,0,0,0.6)]">
                <button
                  disabled={state.isSpinning || state.bet <= 1}
                  onClick={handleBetMinus}
                  className="w-6 h-6 rounded-lg bg-black/60 text-[#F5C451] font-black text-xs border border-[#F5C451]/40 hover:bg-[#F5C451] hover:text-black transition disabled:opacity-20 active:scale-95 flex items-center justify-center"
                >
                  -
                </button>
                <div className="flex items-center space-x-1 font-mono px-1">
                  <span className="text-[10px] sm:text-xs font-black uppercase text-[#F5C451] tracking-wider">BET</span>
                  <span className="text-xs sm:text-sm font-black text-white">৳{state.bet}</span>
                </div>
                <button
                  disabled={state.isSpinning || state.bet >= 500}
                  onClick={handleBetPlus}
                  className="w-6 h-6 rounded-lg bg-black/60 text-[#F5C451] font-black text-xs border border-[#F5C451]/40 hover:bg-[#F5C451] hover:text-black transition disabled:opacity-20 active:scale-95 flex items-center justify-center"
                >
                  +
                </button>
              </div>

              {/* SETTINGS GEAR BUTTON — BIGGER, NO TEXT */}
              <button
                onClick={() => setState((p) => ({ ...p, showSettings: true }))}
                className="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-black/60 hover:bg-[#F5C451] hover:text-black text-[#F5C451] border border-[#F5C451]/40 shadow-md flex items-center justify-center transition-all active:scale-95 text-lg sm:text-xl"
                title="Settings"
                aria-label="Settings"
              >
                ⚙️
              </button>
            </div>

            {/* CENTER: BIGGER 3D GOLD CIRCULAR SPIN BUTTON (CANNOT BE STOPPED MID-SPIN) */}
            <div className="flex flex-col items-center justify-center">
              <button
                disabled={state.isSpinning}
                onClick={handleSpin}
                aria-label="Spin slot reels"
                className={`relative w-20 h-20 sm:w-22 sm:h-22 md:w-24 md:h-24 rounded-full font-black uppercase text-xs sm:text-sm tracking-widest transition-all duration-200 flex items-center justify-center select-none shadow-[0_0_30px_rgba(245,196,81,0.6)] ${
                  state.isSpinning
                    ? 'bg-gradient-to-b from-[#FFF2A3] via-[#F5C451] to-[#A66B16] text-[#080E24] border-4 border-[#FFF2A3] opacity-85 cursor-not-allowed shadow-[0_0_25px_#F5C451]'
                    : 'bg-gradient-to-b from-[#FFF2A3] via-[#F5C451] to-[#A66B16] text-[#080E24] border-4 border-[#FFF2A3] hover:scale-105 active:scale-95 hover:shadow-[0_0_40px_#F5C451]'
                }`}
              >
                {/* Outer Pulse / Rotating Glow Ring */}
                <div
                  className={`absolute -inset-1 rounded-full border-2 border-[#19C6C2]/50 ${
                    state.isSpinning ? 'animate-spin border-t-[#F5C451]' : 'animate-pulse'
                  } pointer-events-none`}
                />

                <div className="text-center">
                  <span className="block leading-none font-black drop-shadow-md">
                    SPIN
                  </span>
                  {state.autoPlay && (
                    <span className="text-[8px] sm:text-[9px] font-bold block text-blue-950 mt-1">
                      AUTO ({state.autoPlayCount})
                    </span>
                  )}
                </div>
              </button>
            </div>

            {/* RIGHT: WIN AMOUNT IN ONE ROW | TURBO BUTTON UNDERNEATH */}
            <div className="flex flex-col items-center sm:items-end space-y-1.5 ml-auto">
              {/* WIN & AMOUNT IN ONE ROW */}
              <div className="flex items-center space-x-1.5 bg-black/60 backdrop-blur-sm border border-[#19C6C2]/50 rounded-xl px-3 py-1.5 shadow-[0_0_12px_rgba(0,0,0,0.6)]">
                <span className="text-[10px] sm:text-xs font-black uppercase text-[#19C6C2] tracking-wider">
                  WIN
                </span>
                <span
                  className={`font-mono text-xs sm:text-sm font-black transition-all duration-300 ${
                    state.win > 0
                      ? 'text-[#19C6C2] scale-105 drop-shadow-[0_0_12px_#19C6C2]'
                      : 'text-gray-400'
                  }`}
                >
                  ৳{state.win.toLocaleString()}
                </span>
              </div>

              {/* TURBO BUTTON — ONLY TURBO TEXT, COLOR CHANGES ON ACTIVE/INACTIVE */}
              <button
                onClick={() => setState((p) => ({ ...p, turbo: !p.turbo }))}
                className={`px-4 sm:px-5 py-2 rounded-xl text-xs sm:text-sm font-black uppercase tracking-wider transition-all duration-200 active:scale-95 ${
                  state.turbo
                    ? 'bg-gradient-to-r from-[#F5C451] via-[#FFF2A3] to-[#D49A24] text-[#080E24] border-2 border-white shadow-[0_0_15px_#F5C451] scale-105'
                    : 'bg-black/60 text-gray-400 border border-white/20 hover:border-white/40 hover:text-white'
                }`}
              >
                TURBO
              </button>
            </div>
          </div>
        </div>
      </footer>

      {/* MODALS */}
      {state.showSettings && (
        <PharaohSettingsModal
          onClose={() => setState((p) => ({ ...p, showSettings: false }))}
          soundEnabled={state.soundEnabled}
          onToggleSound={() => setState((p) => ({ ...p, soundEnabled: !p.soundEnabled }))}
          autoPlay={state.autoPlay}
          autoPlayCount={state.autoPlayCount}
          onStartAutoPlay={handleStartAutoPlay}
          onStopAutoPlay={handleStopAutoPlay}
          history={history}
        />
      )}
      {state.showPaytable && (
        <PaytablePanel onClose={() => setState((p) => ({ ...p, showPaytable: false }))} />
      )}
      {state.showRules && (
        <GameRulesPanel onClose={() => setState((p) => ({ ...p, showRules: false }))} />
      )}
    </div>
  );
}
