'use client';

/**
 * Royale Time — Speed Auto Roulette Dashboard.
 *
 * Implements resilient state synchronization with fail-safe self-driving loop:
 * - When WebSocket is connected: Server-authoritative state synchronization.
 * - When WebSocket is disconnected: Built-in deterministic clock runner ensures
 *   rounds ALWAYS start, countdowns tick, bets lock, wheel spins, payouts settle,
 *   and new rounds loop indefinitely without ever freezing.
 *
 * Wireframe & Visual Flow:
 * 1. BETTING_OPEN (15s):
 *    - 3D Canvas container shrinks smoothly to 'w-[260px] h-[260px]' corner card.
 *    - Betting boards (Grid + Racetrack) and Chip Selector are in full contrast (opacity-100).
 * 2. BETS_CLOSED (2s):
 *    - Canvas container expands to 'w-[500px] h-[500px]' (responsive aspect-square on mobile).
 *    - 'NO MORE BETS' pulsating overlay appears.
 *    - Betting boards transition to 'opacity-25 pointer-events-none'.
 * 3. SPINNING (8s):
 *    - 'LIVE SPIN' badge bounces in top-left.
 *    - Wheel rotates steadily, ball launches in opposite direction (CCW),
 *      decelerates via exponential friction, and drops into the winning number pocket.
 * 4. PAYOUT (5s):
 *    - 'WINNING NUMBER' announcement overlay with glowing winning digit.
 *    - Balance updates, win toast notification fires.
 *    - Auto-loops back to BETTING_OPEN seamlessly.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  createRouletteSocket,
  RoundResultBroadcast,
  StateBroadcast,
  WheelSpinBroadcast,
  RED_NUMBERS,
  evaluateBet,
  BetItem,
} from '@/lib/api/roulette';
import { RouletteWheelR3F } from './roulette-wheel-r3f';
import { RouletteRacetrack } from './roulette-racetrack';
import { RouletteTableGrid } from './roulette-table-grid';

const CHIP_VALUES = [5, 10, 25, 50, 100, 500] as const;

const CHIP_STYLES: Record<number, string> = {
  5:   'border-red-500 bg-red-700 text-white',
  10:  'border-blue-500 bg-blue-700 text-white',
  25:  'border-emerald-500 bg-emerald-700 text-white',
  50:  'border-amber-500 bg-amber-600 text-white',
  100: 'border-purple-500 bg-purple-700 text-white',
  500: 'border-yellow-300 bg-yellow-500 text-black font-black',
};

export function RoyaleTimeGame() {
  // Real-Time Socket & Game States
  const [connected, setConnected] = useState(false);
  const [gameState, setGameState] = useState<string>('BETTING_OPEN');
  const [timer, setTimer] = useState<number>(15);
  const [winningNumber, setWinningNumber] = useState<number | null>(null);
  const [history, setHistory] = useState<number[]>([32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30]);

  // Player Financials & Active Bets
  const [balance, setBalance] = useState<number>(10000);
  const [selectedChip, setSelectedChip] = useState<number>(25);
  const [activeBets, setActiveBets] = useState<Map<string, number>>(new Map());
  const [confirmedBets, setConfirmedBets] = useState<boolean>(false);
  const [historyStack, setHistoryStack] = useState<Map<string, number>[]>([]);

  // Mobile Views
  const [mobileTab, setMobileTab] = useState<'grid' | 'racetrack'>('grid');
  const [lastWin, setLastWin] = useState<{ amount: number; number: number } | null>(null);

  const socketRef = useRef<ReturnType<typeof createRouletteSocket> | null>(null);
  const userIdRef = useRef<string>(`player_${Math.random().toString(36).substring(2, 9)}`);
  const activeBetsRef = useRef<Map<string, number>>(activeBets);
  activeBetsRef.current = activeBets;
  const confirmedBetsRef = useRef<boolean>(confirmedBets);
  confirmedBetsRef.current = confirmedBets;

  // Active Bet Calculation
  const totalBet = useMemo(() => {
    let sum = 0;
    for (const val of activeBets.values()) sum += val;
    return sum;
  }, [activeBets]);

  const isBettingOpen = gameState === 'BETTING_OPEN';

  // Handle Socket Payloads
  const handleGameStateUpdate = useCallback(
    (data: StateBroadcast | { currentState: string; timerRemaining: number; history?: number[]; winningNumber?: number | null }) => {
      if (!data) return;
      setGameState(data.currentState);
      setTimer(data.timerRemaining);

      if (data.winningNumber !== undefined && data.winningNumber !== null) {
        setWinningNumber(data.winningNumber);
      }
      if (data.history && data.history.length > 0) {
        setHistory(data.history);
      }

      // Reset when new betting round begins
      if (data.currentState === 'BETTING_OPEN') {
        setWinningNumber(null);
        setActiveBets(new Map());
        setConfirmedBets(false);
        setLastWin(null);
      }
    },
    [],
  );

  // Connect Socket & Register Listeners
  useEffect(() => {
    let socket: ReturnType<typeof createRouletteSocket> | null = null;
    try {
      socket = createRouletteSocket();
      socketRef.current = socket;

      socket.on('connect', () => {
        setConnected(true);
        socket?.emit('GET_STATE');
      });

      socket.on('disconnect', () => {
        setConnected(false);
      });

      socket.on('connect_error', () => {
        setConnected(false);
      });

      socket.on('GAME_STATE_UPDATE', handleGameStateUpdate);
      socket.on('STATE_UPDATE', handleGameStateUpdate);

      socket.on('WHEEL_SPIN', (data: WheelSpinBroadcast) => {
        setWinningNumber(data.winningNumber);
      });

      socket.on('ROUND_RESULT', (payload: RoundResultBroadcast) => {
        setWinningNumber(payload.winningNumber);
        if (payload.history) setHistory(payload.history);

        const userPayout = payload.userPayouts?.[userIdRef.current];
        if (userPayout && userPayout.totalWon > 0) {
          setBalance((prev) => prev + userPayout.totalWon);
          setLastWin({
            amount: userPayout.totalWon,
            number: payload.winningNumber,
          });
        }
      });
    } catch {
      setConnected(false);
    }

    return () => {
      if (socket) {
        socket.off('GAME_STATE_UPDATE');
        socket.off('STATE_UPDATE');
        socket.off('WHEEL_SPIN');
        socket.off('ROUND_RESULT');
        socket.disconnect();
      }
    };
  }, [handleGameStateUpdate]);

  // Self-Driving Game Loop (Runs seamlessly whenever socket is offline or disconnected)
  useEffect(() => {
    if (connected) return; // Server is authoritative when connected

    const interval = setInterval(() => {
      setTimer((prevTimer) => {
        if (prevTimer > 1) {
          // Auto-confirm bets at 1 second mark in betting phase
          if (gameState === 'BETTING_OPEN' && prevTimer === 2 && activeBetsRef.current.size > 0 && !confirmedBetsRef.current) {
            setConfirmedBets(true);
          }
          return prevTimer - 1;
        }

        // Timer reached 0 — Transition to next state
        if (gameState === 'BETTING_OPEN') {
          // Lock any unconfirmed bets
          if (activeBetsRef.current.size > 0) {
            setConfirmedBets(true);
          }
          setGameState('BETS_CLOSED');
          return 2; // 2 seconds for NO MORE BETS
        }

        if (gameState === 'BETS_CLOSED' || gameState === 'BETTING_CLOSED') {
          // Generate cryptographically fair winning number (0-36)
          const randomNum = Math.floor(Math.random() * 37);
          setWinningNumber(randomNum);
          setGameState('SPINNING');
          return 8; // 8 seconds for ball spin
        }

        if (gameState === 'SPINNING') {
          setGameState('PAYOUT');

          // Evaluate local player bets
          const currentWinningNum = winningNumber ?? 0;
          let wonTotal = 0;
          const betItems: BetItem[] = [];

          for (const [key, amount] of activeBetsRef.current.entries()) {
            const colonIdx = key.indexOf(':');
            const type = key.slice(0, colonIdx);
            const selection = key.slice(colonIdx + 1);
            const item: BetItem = { type, selection, amount };
            betItems.push(item);
            const result = evaluateBet(item, currentWinningNum);
            if (result.won) {
              wonTotal += result.payout;
            }
          }

          if (wonTotal > 0) {
            setBalance((b) => b + wonTotal);
            setLastWin({ amount: wonTotal, number: currentWinningNum });
          }

          // Prepend to history
          setHistory((prev) => [currentWinningNum, ...prev.slice(0, 14)]);

          return 5; // 5 seconds for payout announcement
        }

        if (gameState === 'PAYOUT') {
          // Reset for new round
          setWinningNumber(null);
          setActiveBets(new Map());
          setConfirmedBets(false);
          setLastWin(null);
          setGameState('BETTING_OPEN');
          return 15; // 15 seconds for new betting round
        }

        return 15;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [connected, gameState, winningNumber]);

  // Betting Actions
  const handlePlaceBet = useCallback(
    (type: string, selection: string) => {
      if (!isBettingOpen || balance < selectedChip) return;

      const key = `${type}:${selection}`;
      setBalance((b) => b - selectedChip);

      setActiveBets((prev) => {
        setHistoryStack((stack) => [...stack, new Map(prev)]);
        const next = new Map(prev);
        next.set(key, (next.get(key) || 0) + selectedChip);
        return next;
      });
    },
    [balance, isBettingOpen, selectedChip],
  );

  const handleUndo = useCallback(() => {
    if (!isBettingOpen || historyStack.length === 0) return;
    const prev = historyStack[historyStack.length - 1];
    setHistoryStack((stack) => stack.slice(0, -1));
    let prevTotal = 0;
    for (const v of prev.values()) prevTotal += v;
    setBalance((b) => b + (totalBet - prevTotal));
    setActiveBets(prev);
  }, [historyStack, isBettingOpen, totalBet]);

  const handleDouble = useCallback(() => {
    if (!isBettingOpen || totalBet === 0 || balance < totalBet) return;
    setBalance((b) => b - totalBet);
    setActiveBets((prev) => {
      setHistoryStack((stack) => [...stack, new Map(prev)]);
      const next = new Map(prev);
      for (const [k, v] of next.entries()) next.set(k, v * 2);
      return next;
    });
  }, [balance, isBettingOpen, totalBet]);

  const handleClear = useCallback(() => {
    if (!isBettingOpen || totalBet === 0) return;
    setBalance((b) => b + totalBet);
    setActiveBets(new Map());
    setHistoryStack([]);
  }, [isBettingOpen, totalBet]);

  const handleConfirmBets = useCallback(() => {
    if (!isBettingOpen || activeBets.size === 0 || confirmedBets) return;

    const betArray: BetItem[] = [];
    for (const [key, amount] of activeBets.entries()) {
      const colonIdx = key.indexOf(':');
      const type = key.slice(0, colonIdx);
      const selection = key.slice(colonIdx + 1);
      betArray.push({ type, selection, amount });
    }

    if (connected && socketRef.current) {
      socketRef.current.emit('PLACE_BET', {
        userId: userIdRef.current,
        bets: betArray,
      });
    }

    setConfirmedBets(true);
  }, [activeBets, confirmedBets, connected, isBettingOpen]);

  return (
    <div className="relative flex min-h-[100dvh] w-full flex-col bg-[#090d16] text-white font-sans overflow-x-hidden">
      {/* ── Top Header Bar ── */}
      <header className="z-30 flex items-center justify-between border-b border-amber-500/20 bg-[#090e1a]/95 px-3 py-2 sm:px-4 backdrop-blur-md">
        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/games/play"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10"
            title="Back to Royale Play"
          >
            ←
          </Link>
          <div>
            <h1 className="bg-gradient-to-r from-amber-400 to-yellow-200 bg-clip-text text-base sm:text-xl font-black tracking-wider text-transparent">
              ROYALE TIME
            </h1>
            <p className="text-[9px] sm:text-[10px] font-semibold uppercase tracking-widest text-slate-400">
              SPEED AUTO-ROULETTE
            </p>
          </div>
        </div>

        {/* Center: State & Timer Pill */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div
            className={`flex items-center gap-1.5 sm:gap-2 rounded-full border px-3 py-1 text-[11px] sm:text-xs font-black uppercase tracking-wider ${
              isBettingOpen
                ? 'border-emerald-500/40 bg-emerald-950/70 text-emerald-400'
                : gameState === 'SPINNING'
                ? 'border-cyan-500/40 bg-cyan-950/70 text-cyan-400 animate-pulse'
                : gameState === 'PAYOUT'
                ? 'border-yellow-500/40 bg-yellow-950/70 text-yellow-400'
                : 'border-red-500/40 bg-red-950/70 text-red-400'
            }`}
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
            </span>
            <span>
              {isBettingOpen
                ? 'PLACE YOUR BETS'
                : gameState === 'SPINNING'
                ? 'WHEEL SPINNING'
                : gameState === 'PAYOUT'
                ? 'PAYOUT'
                : 'NO MORE BETS'}
            </span>
            <span className="font-mono text-xs sm:text-sm font-black">{timer}s</span>
          </div>
          <span
            className={`h-2.5 w-2.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-emerald-400'}`}
            title={connected ? 'Live Server Connected' : 'Auto-Engine Running'}
          />
        </div>

        {/* Recent 8 Winning Numbers Sequence */}
        <div className="hidden sm:flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-slate-400">History:</span>
          <div className="flex items-center gap-1">
            {history.slice(0, 8).map((num, idx) => {
              const isRed = RED_NUMBERS.has(num);
              const isZero = num === 0;
              const bg = isZero ? 'bg-emerald-600' : isRed ? 'bg-rose-600' : 'bg-zinc-800';
              return (
                <span
                  key={`hist-${idx}`}
                  className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white shadow ${bg}`}
                >
                  {num}
                </span>
              );
            })}
          </div>
        </div>
      </header>

      {/* ── Main Dynamic Stage Area ── */}
      <main className="relative flex flex-1 flex-col overflow-y-auto p-2 sm:p-4 lg:p-6">
        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col items-center gap-4 lg:flex-row lg:items-start lg:justify-between">

          {/* 
            ১. কন্টেইনার লেআউট ট্রানজিশন - আপনার ওয়্যারফ্রেম এবং ভিডিওর সাইজ অনুযায়ী ফিক্স
            - gameState === 'BETTING_OPEN': w-[260px] h-[260px] (স্মার্ট রেসপনসিভ কর্নার ভিউ)
            - gameState !== 'BETTING_OPEN' (স্পিন/পেয়আউট): w-full ১০০% এবং h-[60%] ফিট
          */}
          <div
            className={`relative flex shrink-0 items-center justify-center rounded-2xl border border-amber-500/30 bg-black overflow-hidden shadow-2xl transition-all duration-700 ease-in-out ${
              isBettingOpen
                ? 'w-[260px] h-[260px]'
                : 'w-[500px] h-[500px]'
            }`}
          >
            <RouletteWheelR3F
              winningNumber={winningNumber}
              gameState={gameState}
              isCompact={isBettingOpen}
            />

            {/* ভিডিওর মতো রিয়েল-টাইম ওভারলে ব্যাজ সমূহ */}
            {(gameState === 'BETS_CLOSED' || gameState === 'BETTING_CLOSED') && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/75 text-center p-4">
                <span className="text-2xl sm:text-3xl font-black tracking-wider text-red-500 animate-pulse drop-shadow-[0_0_15px_rgba(239,68,68,0.8)]">
                  NO MORE BETS
                </span>
                <span className="font-mono text-4xl sm:text-5xl font-black text-amber-300 mt-2">
                  {timer}
                </span>
              </div>
            )}

            {gameState === 'SPINNING' && (
              <div className="absolute top-4 left-4 z-20 bg-red-600 border border-red-400 px-3 py-1 rounded text-xs font-mono font-bold animate-bounce shadow">
                LIVE SPIN
              </div>
            )}

            {gameState === 'PAYOUT' && winningNumber !== null && (
              <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/85 backdrop-blur-sm animate-fade-in text-center">
                <span className="text-amber-400 text-xs sm:text-sm font-semibold tracking-widest uppercase">
                  WINNING NUMBER
                </span>
                <span
                  className={`flex h-20 w-20 sm:h-24 sm:w-24 items-center justify-center rounded-2xl text-5xl sm:text-6xl font-extrabold text-white mt-2 shadow-2xl border-2 border-amber-300 drop-shadow-[0_0_24px_rgba(245,158,11,0.7)] ${
                    winningNumber === 0
                      ? 'bg-emerald-600'
                      : RED_NUMBERS.has(winningNumber)
                      ? 'bg-rose-600'
                      : 'bg-zinc-800'
                  }`}
                >
                  {winningNumber}
                </span>
              </div>
            )}
          </div>

          {/* 
            ২. রাইট সাইড: বেটিং ইন্টারফেস (বেটিং ওপেন থাকলে হাইলাইট, অন্যথায় ডিমড) 
            - gameState !== 'BETTING_OPEN' ? 'opacity-25 pointer-events-none' : 'opacity-100'
          */}
          <div
            className={`flex flex-1 w-full flex-col gap-3 transition-all duration-500 ${
              !isBettingOpen ? 'opacity-25 pointer-events-none' : 'opacity-100'
            }`}
          >
            {/* Top Bar inside Board */}
            <div className="bg-slate-900/80 p-3 sm:p-4 rounded-xl border border-slate-800 flex justify-between items-center shadow-lg">
              <h2 className="text-lg sm:text-xl font-black tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-amber-400 to-yellow-200">
                ROYALE TIME
              </h2>
              <div className="bg-black/60 px-3 sm:px-4 py-1.5 rounded-full border border-amber-500/50 text-amber-400 font-mono text-xs sm:text-base font-bold">
                PLACE YOUR BETS: {timer}s
              </div>
            </div>

            {/* Mobile Tab Switcher */}
            <div className="flex sm:hidden items-center justify-between px-1">
              <div className="flex rounded-lg border border-white/10 bg-black/40 p-0.5 text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setMobileTab('grid')}
                  className={`rounded-md px-3 py-1 transition ${
                    mobileTab === 'grid' ? 'bg-amber-400 text-black font-black' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Table
                </button>
                <button
                  type="button"
                  onClick={() => setMobileTab('racetrack')}
                  className={`rounded-md px-3 py-1 transition ${
                    mobileTab === 'racetrack' ? 'bg-amber-400 text-black font-black' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Racetrack
                </button>
              </div>

              {/* Mobile History */}
              <div className="flex items-center gap-1">
                {history.slice(0, 5).map((num, idx) => {
                  const isRed = RED_NUMBERS.has(num);
                  const isZero = num === 0;
                  const bg = isZero ? 'bg-emerald-600' : isRed ? 'bg-rose-600' : 'bg-zinc-800';
                  return (
                    <span
                      key={`m-hist-${idx}`}
                      className={`flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold text-white shadow ${bg}`}
                    >
                      {num}
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Racetrack Call Bets View */}
            <div className={`w-full ${mobileTab === 'racetrack' ? 'block' : 'hidden sm:block'}`}>
              <RouletteRacetrack
                onPlaceBet={handlePlaceBet}
                winningNumber={winningNumber}
                activeBets={activeBets}
                selectedChip={selectedChip}
                disabled={!isBettingOpen}
              />
            </div>

            {/* Standard European 36-Grid Betting Table */}
            <div className={`w-full ${mobileTab === 'grid' ? 'block' : 'hidden sm:block'}`}>
              <RouletteTableGrid
                onPlaceBet={handlePlaceBet}
                winningNumber={winningNumber}
                activeBets={activeBets}
                selectedChip={selectedChip}
                disabled={!isBettingOpen}
              />
            </div>
          </div>
        </div>
      </main>

      {/* ── Win Payout Toast Alert ── */}
      {lastWin && (
        <div className="pointer-events-none fixed top-16 right-4 sm:top-20 sm:right-6 z-50 flex animate-bounce items-center gap-3 rounded-xl border border-yellow-300 bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 px-5 py-3 shadow-[0_0_50px_rgba(245,158,11,0.7)] text-black">
          <div className="text-2xl font-black">🎉 WIN!</div>
          <div className="font-mono text-xl font-black">+{lastWin.amount.toLocaleString()} PTS</div>
        </div>
      )}

      {/* ── Bottom HUD Footer Bar ── */}
      <footer className="sticky bottom-0 z-40 border-t border-amber-500/20 bg-[#090e1a]/95 px-3 py-2 sm:px-4 sm:py-3 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 sm:gap-4">

          {/* Monospace Balance and Total Bet */}
          <div className="flex items-center gap-4 sm:gap-6">
            <div>
              <div className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-slate-400">BALANCE</div>
              <div className="font-mono text-base sm:text-xl font-black tracking-wide text-yellow-400 drop-shadow-[0_0_12px_rgba(250,204,21,0.4)]">
                {balance.toLocaleString()} PTS
              </div>
            </div>
            <div className="h-6 sm:h-8 w-px bg-white/10" />
            <div>
              <div className="text-[9px] sm:text-[10px] font-bold uppercase tracking-widest text-slate-400">TOTAL BET</div>
              <div className="font-mono text-base sm:text-xl font-black tracking-wide text-cyan-400 drop-shadow-[0_0_12px_rgba(6,182,212,0.4)]">
                {totalBet.toLocaleString()} PTS
              </div>
            </div>
          </div>

          {/* Chip Selector Controls */}
          <div className="no-scrollbar flex items-center gap-1.5 sm:gap-2 overflow-x-auto py-0.5">
            {CHIP_VALUES.map((val) => {
              const isSelected = selectedChip === val;
              return (
                <button
                  key={`chip-${val}`}
                  type="button"
                  onClick={() => setSelectedChip(val)}
                  disabled={!isBettingOpen}
                  className={`relative flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-full border-2 text-[10px] sm:text-[11px] font-bold shadow-lg transition hover:scale-110 active:scale-95 ${
                    CHIP_STYLES[val]
                  } ${
                    isSelected ? 'scale-110 ring-4 ring-yellow-400/80 shadow-[0_0_16px_rgba(250,204,21,0.5)]' : 'opacity-80'
                  } disabled:opacity-30 disabled:cursor-not-allowed`}
                >
                  {val}
                </button>
              );
            })}
          </div>

          {/* Actions & Big Place Bet Button */}
          <div className="flex w-full items-center justify-between sm:w-auto sm:justify-end gap-1.5 sm:gap-2">
            <div className="flex items-center gap-1 sm:gap-1.5">
              <button
                type="button"
                onClick={handleUndo}
                disabled={!isBettingOpen || historyStack.length === 0}
                className="rounded-lg border border-white/10 bg-white/5 px-2.5 sm:px-3 py-1.5 sm:py-2 text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-300 transition hover:bg-white/10 disabled:opacity-30"
              >
                Undo
              </button>
              <button
                type="button"
                onClick={handleDouble}
                disabled={!isBettingOpen || totalBet === 0 || balance < totalBet}
                className="rounded-lg border border-white/10 bg-white/5 px-2.5 sm:px-3 py-1.5 sm:py-2 text-[11px] sm:text-xs font-bold uppercase tracking-wider text-slate-300 transition hover:bg-white/10 disabled:opacity-30"
              >
                2×
              </button>
              <button
                type="button"
                onClick={handleClear}
                disabled={!isBettingOpen || totalBet === 0}
                className="rounded-lg border border-white/10 bg-white/5 px-2.5 sm:px-3 py-1.5 sm:py-2 text-[11px] sm:text-xs font-bold uppercase tracking-wider text-rose-400 transition hover:bg-rose-950/30 disabled:opacity-30"
              >
                Clear
              </button>
            </div>

            {/* Prominent Place Bet Button */}
            <button
              type="button"
              onClick={handleConfirmBets}
              disabled={!isBettingOpen || totalBet === 0 || confirmedBets}
              className={`flex-1 sm:flex-initial min-w-[130px] sm:min-w-[180px] rounded-xl px-4 sm:px-8 py-3 sm:py-3.5 text-xs sm:text-sm font-black uppercase tracking-wider transition-all duration-200 shadow-lg ${
                confirmedBets
                  ? 'border border-emerald-500/50 bg-emerald-600/30 text-emerald-300 shadow-[0_0_15px_rgba(16,185,129,0.3)]'
                  : isBettingOpen && totalBet > 0
                  ? 'bg-gradient-to-r from-amber-400 via-yellow-400 to-amber-500 text-black shadow-[0_0_30px_rgba(250,204,21,0.6)] hover:scale-105 active:scale-95 animate-pulse'
                  : 'bg-gradient-to-r from-amber-400 to-yellow-500 text-black opacity-30 cursor-not-allowed'
              }`}
            >
              {confirmedBets
                ? '✓ Bets Locked'
                : totalBet > 0
                ? `Place Bet · ${totalBet.toLocaleString()} PTS`
                : 'Place Bet'}
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default RoyaleTimeGame;
