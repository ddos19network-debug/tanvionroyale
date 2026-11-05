'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ApiClientError } from '@/lib/api/client';
import type { AnonymizedLiveBet, CrashBetView, CrashHistoryEntry, CrashPlayerHistoryEntry } from '@/lib/api/crash';
import type { CrashSnapshotView, MultiplierUpdateEvent, RoundCrashedEvent } from '@/lib/api/crash';
import { applyRunningUpdate, isOlderSnapshot } from '@/lib/crash-presentation';
import { CrashRocket, CrashRocketScene, type RocketPhase } from '@/components/games/crash-rocket';
import {
  cashOutCrashBet,
  createCrashSocket,
  getCrashHistory,
  getCrashLiveBets,
  getCrashMyHistory,
  getCrashSnapshot,
  newRequestId,
  placeCrashBet,
} from '@/lib/api/crash';

interface BettingPanelState {
  betAmount: number;
  isAuto: boolean;
  isAutoCashout: boolean;
  autoCashoutMultiplier: number;
  hasPlacedBet: boolean;
  isSettled: boolean;
  activeBet: CrashBetView | null;
  busyBet: boolean;
  busyCashout: boolean;
  cashoutWin: number | null;
}

export function RoyaleFlyGame() {
  const [snapshot, setSnapshot] = useState<CrashSnapshotView | null>(null);
  const [displayMultiplier, setDisplayMultiplier] = useState(1);
  const [history, setHistory] = useState<CrashHistoryEntry[]>([]);
  const [liveBets, setLiveBets] = useState<AnonymizedLiveBet[]>([]);
  const [myHistory, setMyHistory] = useState<CrashPlayerHistoryEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'previous' | 'top'>('all');

  // TWO INDEPENDENT BETTING PANELS
  const [panel1, setPanel1] = useState<BettingPanelState>({
    betAmount: 5,
    isAuto: false,
    isAutoCashout: false,
    autoCashoutMultiplier: 2.0,
    hasPlacedBet: false,
    isSettled: false,
    activeBet: null,
    busyBet: false,
    busyCashout: false,
    cashoutWin: null,
  });

  const [panel2, setPanel2] = useState<BettingPanelState>({
    betAmount: 5,
    isAuto: false,
    isAutoCashout: false,
    autoCashoutMultiplier: 2.0,
    hasPlacedBet: false,
    isSettled: false,
    activeBet: null,
    busyBet: false,
    busyCashout: false,
    cashoutWin: null,
  });

  const roundIdRef = useRef<string | null>(null);
  const snapshotRef = useRef<CrashSnapshotView | null>(null);
  const syncedRoundRef = useRef<string | null>(null);
  const socketRef = useRef<ReturnType<typeof createCrashSocket> | null>(null);

  // Sync snapshot
  const refreshSnapshot = useCallback(async () => {
    try {
      const snap = await getCrashSnapshot();
      if (isOlderSnapshot(snapshotRef.current, snap)) return;
      setSnapshot(snap);
      snapshotRef.current = snap;
      setAuthed(true);
      setError(null);

      if (snap.round) {
        const newRound = roundIdRef.current !== snap.round.id;
        roundIdRef.current = snap.round.id;

        if (newRound || snap.round.status === 'CREATED' || snap.round.status === 'BETTING_OPEN') {
          syncedRoundRef.current = null;
          setDisplayMultiplier(1);
        }
        if (snap.round.status === 'RUNNING' && snap.round.currentMultiplier) {
          if (syncedRoundRef.current !== snap.round.id) {
            syncedRoundRef.current = snap.round.id;
            setDisplayMultiplier(snap.round.currentMultiplier);
          }
        }
        if (
          snap.round.crashMultiplier != null &&
          ['CRASHED', 'SETTLED', 'COMPLETED'].includes(snap.round.status)
        ) {
          setDisplayMultiplier(snap.round.crashMultiplier);
        }

        // Sync panel bets from snapshot (myBets or myBet)
        const myBets = snap.myBets ?? (snap.myBet ? [snap.myBet] : []);
        if (myBets.length > 0) {
          setPanel1((prev) => {
            const b = myBets[0];
            return b
              ? {
                  ...prev,
                  activeBet: b,
                  hasPlacedBet: true,
                  isSettled: b.status === 'CASHED_OUT' || b.status === 'LOST',
                  cashoutWin: b.payout ?? null,
                }
              : prev;
          });
        }
        if (myBets.length > 1) {
          setPanel2((prev) => {
            const b = myBets[1];
            return b
              ? {
                  ...prev,
                  activeBet: b,
                  hasPlacedBet: true,
                  isSettled: b.status === 'CASHED_OUT' || b.status === 'LOST',
                  cashoutWin: b.payout ?? null,
                }
              : prev;
          });
        }
      }
    } catch (err) {
      setAuthed(false);
      setError(
        err instanceof ApiClientError && err.status === 401
          ? 'Please sign in to play Royale Fly.'
          : 'Could not reach the game server.',
      );
    }
  }, []);

  const refreshHistory = useCallback(async () => {
    try {
      const h = await getCrashHistory(20);
      setHistory(h.history);
    } catch {
      /* ignore */
    }
    try {
      const m = await getCrashMyHistory(15);
      setMyHistory(m.history);
    } catch {
      /* ignore */
    }
  }, []);

  const refreshLiveBets = useCallback(async () => {
    const id = roundIdRef.current;
    if (!id) {
      setLiveBets([]);
      return;
    }
    try {
      const live = await getCrashLiveBets(id);
      setLiveBets(live.bets);
    } catch {
      /* ignore */
    }
  }, []);

  // Initial load
  useEffect(() => {
    void refreshSnapshot();
    void refreshHistory();
  }, [refreshSnapshot, refreshHistory]);

  // WebSocket Live Connection
  useEffect(() => {
    if (authed === false) return;
    const socket = createCrashSocket();
    socketRef.current = socket;

    socket.on('connect', () => {
      syncedRoundRef.current = null;
      void refreshSnapshot();
      void refreshLiveBets();
    });

    socket.on('MULTIPLIER_UPDATE', (event: MultiplierUpdateEvent) => {
      const current = snapshotRef.current;
      const next = applyRunningUpdate(current, event);
      if (next === current || !next?.round) return;
      snapshotRef.current = next;
      setSnapshot(next);
      if (next.round.currentMultiplier) {
        setDisplayMultiplier(next.round.currentMultiplier);
      }
    });

    socket.on('ROUND_STARTED', () => {
      setDisplayMultiplier(1);
      void refreshSnapshot();
      void refreshLiveBets();
    });

    socket.on('BETTING_OPEN', () => {
      setDisplayMultiplier(1);
      // Reset panel states for the new round
      setPanel1((prev) => ({
        ...prev,
        hasPlacedBet: false,
        isSettled: false,
        activeBet: null,
        cashoutWin: null,
      }));
      setPanel2((prev) => ({
        ...prev,
        hasPlacedBet: false,
        isSettled: false,
        activeBet: null,
        cashoutWin: null,
      }));
      void refreshSnapshot();
      void refreshHistory();
    });

    socket.on('ROUND_CRASHED', (event: RoundCrashedEvent) => {
      const current = snapshotRef.current;
      if (current?.round) {
        setSnapshot({
          ...current,
          round: {
            ...current.round,
            status: 'CRASHED',
            crashMultiplier: event.crashMultiplier,
            currentMultiplier: event.crashMultiplier,
          },
        });
      }
      setDisplayMultiplier(event.crashMultiplier ?? 1);
      void refreshHistory();
    });

    socket.on('PLAYER_BET_UPDATE', () => {
      void refreshLiveBets();
    });

    socket.on('PLAYER_CASHOUT', () => {
      void refreshLiveBets();
    });

    // Unified crash:* event handlers (Twin Aviator panels)
    socket.on('crash:state', (data: { state: string; multiplier?: number }) => {
      if (data?.multiplier != null) {
        setDisplayMultiplier(data.multiplier);
      }
    });

    socket.on('crash:tick', (data: { multiplier: number }) => {
      if (data?.multiplier != null) {
        setDisplayMultiplier(data.multiplier);
      }
    });

    socket.on('crash:crashed', (data: { crashPoint: number }) => {
      if (data?.crashPoint != null) {
        setDisplayMultiplier(data.crashPoint);
      }
      void refreshHistory();
    });

    socket.on(
      'crash:cashout-success',
      (data: {
        userId?: string;
        panelId?: number | string;
        payout?: number;
        cashoutMultiplier?: number;
      }) => {
        const pId = String(data?.panelId);
        if (pId === '1' || pId === 'panel_1') {
          setPanel1((p) => ({
            ...p,
            isSettled: true,
            cashoutWin: data.payout ?? null,
            busyCashout: false,
          }));
        } else if (pId === '2' || pId === 'panel_2') {
          setPanel2((p) => ({
            ...p,
            isSettled: true,
            cashoutWin: data.payout ?? null,
            busyCashout: false,
          }));
        }
        void refreshLiveBets();
      },
    );

    return () => {
      socket.disconnect();
    };
  }, [authed, refreshSnapshot, refreshHistory, refreshLiveBets]);

  const currentPhase: RocketPhase = (() => {
    const s = snapshot?.round?.status;
    if (!s) return 'IDLE';
    if (s === 'BETTING_OPEN' || s === 'CREATED') return 'BETTING';
    if (s === 'RUNNING') return 'RUNNING';
    if (s === 'CRASHED' || s === 'SETTLED' || s === 'COMPLETED') return 'CRASHED';
    return 'IDLE';
  })();

  // Place Bet Handler for a specific panel
  const handlePlaceBet = async (panelNum: 1 | 2) => {
    const panel = panelNum === 1 ? panel1 : panel2;
    const setPanel = panelNum === 1 ? setPanel1 : setPanel2;

    if (panel.busyBet || panel.hasPlacedBet) return;
    setPanel((p) => ({ ...p, busyBet: true }));

    const reqId = `${roundIdRef.current ?? 'round'}:${newRequestId()}:p${panelNum}`;

    try {
      const socket = socketRef.current;
      if (socket && socket.connected) {
        // Use fast WebSocket place-bet (supports both crash:place-bet & place-bet)
        socket.emit(
          'crash:place-bet',
          {
            amount: panel.betAmount,
            stake: panel.betAmount,
            betId: reqId,
            clientRequestId: reqId,
            panelId: panelNum,
            autoCashout: panel.isAutoCashout ? panel.autoCashoutMultiplier : undefined,
          },
          (res: { status: string; code?: string; bet?: CrashBetView; message?: string }) => {
            const isOk =
              res?.status === 'success' ||
              res?.status === 'OK' ||
              res?.code === 'OK';
            if (isOk && res.bet) {
              setPanel((p) => ({
                ...p,
                activeBet: res.bet!,
                hasPlacedBet: true,
                busyBet: false,
                isSettled: false,
              }));
              void refreshLiveBets();
            } else {
              setPanel((p) => ({ ...p, busyBet: false }));
              setError(res?.message || 'Could not place bet');
            }
          },
        );
      } else {
        // Fallback to REST API
        const res = await placeCrashBet(panel.betAmount, reqId);
        setPanel((p) => ({
          ...p,
          activeBet: res.bet,
          hasPlacedBet: true,
          busyBet: false,
          isSettled: false,
        }));
        void refreshLiveBets();
      }
    } catch (err: unknown) {
      setPanel((p) => ({ ...p, busyBet: false }));
      setError(err instanceof Error ? err.message : 'Failed to place bet');
    }
  };

  // Cash Out Handler for a specific panel
  const handleCashout = useCallback(
    async (panelNum: 1 | 2) => {
      const panel = panelNum === 1 ? panel1 : panel2;
      const setPanel = panelNum === 1 ? setPanel1 : setPanel2;

      const betId = panel.activeBet?.id;
      if (!betId || panel.busyCashout || panel.isSettled) return;

      setPanel((p) => ({ ...p, busyCashout: true }));
      const reqId = newRequestId();

      try {
        const socket = socketRef.current;
        if (socket && socket.connected) {
          socket.emit(
            'crash:cashout',
            { betId, panelId: panelNum, clientRequestId: reqId },
            (res: { status: string; code?: string; bet?: CrashBetView; payout?: number; message?: string }) => {
              const isOk =
                res?.status === 'success' ||
                res?.status === 'OK' ||
                res?.code === 'OK';
              if (isOk) {
                const payout = res.bet?.payout ?? res.payout ?? null;
                setPanel((p) => ({
                  ...p,
                  activeBet: res.bet ?? p.activeBet,
                  isSettled: true,
                  cashoutWin: payout,
                  busyCashout: false,
                }));
                void refreshLiveBets();
              } else {
                setPanel((p) => ({ ...p, busyCashout: false }));
              }
            },
          );
        } else {
          const res = await cashOutCrashBet(betId);
          setPanel((p) => ({
            ...p,
            activeBet: res.bet,
            isSettled: true,
            cashoutWin: res.bet.payout ?? null,
            busyCashout: false,
          }));
          void refreshLiveBets();
        }
      } catch (err: unknown) {
        setPanel((p) => ({ ...p, busyCashout: false }));
      }
    },
    [panel1, panel2, refreshLiveBets],
  );

  // Auto-Cashout trigger for Panel 1
  useEffect(() => {
    if (
      panel1.isAutoCashout &&
      currentPhase === 'RUNNING' &&
      panel1.activeBet &&
      !panel1.isSettled &&
      displayMultiplier >= panel1.autoCashoutMultiplier
    ) {
      void handleCashout(1);
    }
  }, [displayMultiplier, currentPhase, panel1, handleCashout]);

  // Auto-Cashout trigger for Panel 2
  useEffect(() => {
    if (
      panel2.isAutoCashout &&
      currentPhase === 'RUNNING' &&
      panel2.activeBet &&
      !panel2.isSettled &&
      displayMultiplier >= panel2.autoCashoutMultiplier
    ) {
      void handleCashout(2);
    }
  }, [displayMultiplier, currentPhase, panel2, handleCashout]);

  // Auto-Bet trigger when entering BETTING phase
  useEffect(() => {
    if (currentPhase === 'BETTING') {
      if (panel1.isAuto && !panel1.hasPlacedBet && !panel1.busyBet) {
        void handlePlaceBet(1);
      }
      if (panel2.isAuto && !panel2.hasPlacedBet && !panel2.busyBet) {
        void handlePlaceBet(2);
      }
    }
  }, [currentPhase, panel1.isAuto, panel1.hasPlacedBet, panel2.isAuto, panel2.hasPlacedBet]);

  // Multiplier chip color categorizer
  const getMultiplierBadge = (mult: number) => {
    if (mult < 2.0) {
      return 'bg-[#1e3a8a]/60 text-[#38bdf8] border-blue-500/30';
    }
    if (mult < 10.0) {
      return 'bg-[#581c87]/60 text-[#c084fc] border-purple-500/30';
    }
    return 'bg-[#831843]/60 text-[#f472b6] border-pink-500/30';
  };

  const renderBettingPanel = (
    panelNum: 1 | 2,
    panel: BettingPanelState,
    setPanel: React.Dispatch<React.SetStateAction<BettingPanelState>>,
  ) => {
    const isBettingWindow = currentPhase === 'BETTING';
    const isRunning = currentPhase === 'RUNNING';
    const isBetActive = panel.hasPlacedBet && panel.activeBet && !panel.isSettled;
    const canCashOut = isRunning && isBetActive;
    const liveWin = (panel.betAmount * displayMultiplier).toFixed(2);

    return (
      <div className="flex-1 bg-[#151922] border border-slate-800 rounded-2xl p-2 sm:p-2.5 flex flex-col justify-between shadow-lg">
        {/* Panel Tab Switcher: Bet vs Auto */}
        <div className="flex justify-center mb-1.5">
          <div className="inline-flex bg-[#0c0e14] p-0.5 rounded-full border border-slate-800">
            <button
              type="button"
              onClick={() => setPanel((p) => ({ ...p, isAuto: false }))}
              className={`px-3 py-0.5 text-[11px] font-bold rounded-full transition-all ${
                !panel.isAuto
                  ? 'bg-slate-700 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Bet
            </button>
            <button
              type="button"
              onClick={() => setPanel((p) => ({ ...p, isAuto: true }))}
              className={`px-3 py-0.5 text-[11px] font-bold rounded-full transition-all ${
                panel.isAuto
                  ? 'bg-slate-700 text-white shadow'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              Auto
            </button>
          </div>
        </div>

        {/* Amount Stepper & Controls */}
        <div className="grid grid-cols-12 gap-2 items-center">
          {/* Left: Input & Stepper & Chips */}
          <div className="col-span-7 flex flex-col gap-1">
            <div className="flex items-center bg-[#0c0e14] border border-slate-800 rounded-xl px-1.5 py-0.5">
              <button
                type="button"
                disabled={panel.hasPlacedBet}
                onClick={() =>
                  setPanel((p) => ({
                    ...p,
                    betAmount: Math.max(5, p.betAmount - (p.betAmount > 10 ? 10 : 5)),
                  }))
                }
                className="h-6 w-6 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-black text-xs flex items-center justify-center transition disabled:opacity-30"
              >
                -
              </button>
              <input
                type="number"
                min={5}
                disabled={panel.hasPlacedBet}
                value={panel.betAmount}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  if (!Number.isNaN(val)) setPanel((p) => ({ ...p, betAmount: Math.max(5, val) }));
                }}
                className="w-full bg-transparent text-center font-mono font-black text-white text-sm sm:text-base focus:outline-none"
              />
              <button
                type="button"
                disabled={panel.hasPlacedBet}
                onClick={() => setPanel((p) => ({ ...p, betAmount: p.betAmount + 10 }))}
                className="h-6 w-6 rounded-lg bg-slate-800 hover:bg-slate-700 text-white font-black text-xs flex items-center justify-center transition disabled:opacity-30"
              >
                +
              </button>
            </div>

            {/* Quick Chips */}
            <div className="grid grid-cols-4 gap-1">
              {[5, 10, 50, 100].map((chip) => (
                <button
                  key={chip}
                  type="button"
                  disabled={panel.hasPlacedBet}
                  onClick={() => setPanel((p) => ({ ...p, betAmount: chip }))}
                  className="bg-[#0c0e14] hover:bg-slate-800 border border-slate-800/80 rounded-md py-0.5 text-[10px] font-mono font-bold text-slate-300 transition disabled:opacity-30"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>

          {/* Right: Action Button */}
          <div className="col-span-5 h-full min-h-[58px] sm:min-h-[64px] flex">
            {canCashOut ? (
              <button
                type="button"
                onClick={() => void handleCashout(panelNum)}
                disabled={panel.busyCashout}
                className="w-full h-full bg-gradient-to-b from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 font-black rounded-xl flex flex-col items-center justify-center shadow-[0_0_20px_rgba(245,158,11,0.4)] active:scale-95 transition-all p-1"
              >
                <span className="text-[10px] sm:text-xs uppercase tracking-wider">CASH OUT</span>
                <span className="font-mono text-sm sm:text-base font-black">৳ {liveWin}</span>
              </button>
            ) : panel.hasPlacedBet ? (
              <div className="w-full h-full bg-gradient-to-b from-red-600 to-rose-700 text-white font-black rounded-xl flex flex-col items-center justify-center shadow p-1 text-center">
                {panel.isSettled ? (
                  <>
                    <span className="text-[10px] uppercase text-emerald-200">WON</span>
                    <span className="font-mono text-xs text-white">৳ {panel.cashoutWin ?? liveWin}</span>
                  </>
                ) : (
                  <>
                    <span className="text-[9px] uppercase tracking-wider text-rose-200">WAITING</span>
                    <span className="text-[11px] font-bold">ROUND START</span>
                  </>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void handlePlaceBet(panelNum)}
                disabled={panel.busyBet || (!isBettingWindow && !panel.isAuto)}
                className="w-full h-full bg-gradient-to-b from-[#22c55e] to-[#16a34a] hover:from-[#4ade80] hover:to-[#22c55e] text-slate-950 font-black rounded-xl flex flex-col items-center justify-center shadow-[0_0_20px_rgba(34,197,94,0.35)] active:scale-95 transition-all p-1 disabled:opacity-40"
              >
                <span className="text-[11px] sm:text-xs uppercase tracking-wider">BET</span>
                <span className="font-mono text-xs sm:text-sm font-black">৳ {panel.betAmount}</span>
              </button>
            )}
          </div>
        </div>

        {/* Auto Tab Options */}
        {panel.isAuto && (
          <div className="mt-1.5 pt-1.5 border-t border-slate-800 flex items-center justify-between text-[11px]">
            <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 font-bold">
              <input
                type="checkbox"
                checked={panel.isAutoCashout}
                onChange={(e) => setPanel((p) => ({ ...p, isAutoCashout: e.target.checked }))}
                className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-0"
              />
              Auto Cashout
            </label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.1"
                min="1.01"
                disabled={!panel.isAutoCashout}
                value={panel.autoCashoutMultiplier}
                onChange={(e) =>
                  setPanel((p) => ({ ...p, autoCashoutMultiplier: Math.max(1.01, Number(e.target.value)) }))
                }
                className="w-14 bg-[#0c0e14] border border-slate-800 rounded px-1 py-0.5 text-center font-mono font-bold text-white text-xs disabled:opacity-30"
              />
              <span className="text-slate-400 font-bold">x</span>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="w-full h-full max-w-7xl mx-auto p-2 sm:p-2.5 select-none flex flex-col overflow-x-hidden lg:h-screen lg:max-h-screen lg:overflow-hidden gap-1.5">
      {/* 1. AVIATOR HEADER BAR */}
      <header className="shrink-0 flex justify-between items-center bg-[#151922] border border-slate-800 rounded-2xl px-3 py-1.5 shadow-md">
        {/* Left: Royale Fly Brand Logo */}
        <div className="flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/assets/image/royale-fly-logo.png"
            alt="Royale Fly"
            className="h-6 sm:h-7 w-auto object-contain rounded drop-shadow"
          />
          <span className="text-[#e51b24] font-black italic text-lg sm:text-xl tracking-tighter drop-shadow-[0_0_12px_rgba(229,27,36,0.6)]">
            RoyaleFly
          </span>
          <Link
            href="/games/play"
            className="bg-[#e51b24] hover:bg-red-700 text-white font-bold text-[11px] px-3 py-0.5 rounded-full transition active:scale-95 shadow"
          >
            Lobby
          </Link>
        </div>

        {/* Right: Balance & Navigation */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 bg-[#0c0e14] border border-slate-800 rounded-full px-2.5 py-0.5">
            <span className="text-[10px] text-slate-400 font-bold uppercase">Balance:</span>
            <span className="font-mono font-black text-xs sm:text-sm text-[#22c55e]">
              ৳ {snapshot?.myBet ? fmt(snapshot.myBet.stake) : '100,000.00'}
            </span>
          </div>
        </div>
      </header>

      {/* 2. REAL-TIME MULTIPLIER TOP-HISTORY BAR */}
      <div className="shrink-0 flex items-center gap-1.5 overflow-x-auto py-0.5 px-1 scrollbar-none">
        {history.length > 0 ? (
          history.slice(0, 18).map((item, idx) => (
            <span
              key={idx}
              className={`px-2 py-0.5 rounded-full text-[11px] font-mono font-extrabold border shadow-sm transition hover:scale-105 whitespace-nowrap ${getMultiplierBadge(
                item.crashMultiplier,
              )}`}
            >
              {item.crashMultiplier.toFixed(2)}x
            </span>
          ))
        ) : (
          <span className="text-xs text-slate-500 font-mono">No previous rounds recorded</span>
        )}
      </div>

      {/* 3. MAIN GAME SCREEN & SIDEBAR LAYOUT */}
      <div className="flex-1 min-h-0 flex flex-col lg:grid lg:grid-cols-12 gap-2">
        {/* Left: Live Bets Panel — hidden on mobile, left sidebar on desktop */}
        <aside className="hidden lg:flex lg:col-span-4 bg-[#151922] border border-slate-800 rounded-2xl p-2.5 flex-col lg:h-full lg:min-h-0 shadow-lg overflow-hidden">
          {/* Tabs: All Bets / Previous / Top */}
          <div className="flex justify-between items-center bg-[#0c0e14] p-1 rounded-xl border border-slate-800 mb-2">
            {(['all', 'previous', 'top'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`flex-1 py-1 text-xs font-bold rounded-lg uppercase tracking-wider transition ${
                  activeTab === tab
                    ? 'bg-slate-700 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab === 'all' ? 'All Bets' : tab === 'previous' ? 'Previous' : 'Top'}
              </button>
            ))}
          </div>

          <div className="flex justify-between text-[11px] text-slate-400 font-bold px-1 py-1 border-b border-slate-800">
            <span>User</span>
            <span>Bet</span>
            <span>Mult</span>
            <span>Win</span>
          </div>

          {/* Scrollable Bets List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/40 text-xs">
            {activeTab === 'all' &&
              (liveBets.length > 0 ? (
                liveBets.map((b, i) => (
                  <div key={i} className="flex justify-between items-center py-1.5 px-1 font-mono">
                    <span className="text-slate-300 font-sans truncate max-w-[80px]">{b.player}</span>
                    <span className="text-slate-200">৳{b.stake}</span>
                    <span className="text-purple-400">{b.cashoutMultiplier ? `${b.cashoutMultiplier.toFixed(2)}x` : '-'}</span>
                    <span className={b.payout ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
                      {b.payout ? `+৳${b.payout}` : '-'}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-center text-slate-500 py-8 text-xs font-mono">
                  Waiting for bets in current round...
                </div>
              ))}

            {activeTab === 'previous' &&
              (myHistory.length > 0 ? (
                myHistory.map((m, i) => (
                  <div key={i} className="flex justify-between items-center py-1.5 px-1 font-mono">
                    <span className="text-slate-300">#{m.roundNumber}</span>
                    <span className="text-slate-200">৳{m.stake}</span>
                    <span className="text-purple-400">{m.cashoutMultiplier ? `${m.cashoutMultiplier.toFixed(2)}x` : '-'}</span>
                    <span className={m.payout ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
                      {m.payout ? `+৳${m.payout}` : 'Lost'}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-center text-slate-500 py-8 text-xs font-mono">No previous player history</div>
              ))}

            {activeTab === 'top' &&
              history
                .slice()
                .sort((a, b) => b.crashMultiplier - a.crashMultiplier)
                .slice(0, 10)
                .map((h, i) => (
                  <div key={i} className="flex justify-between items-center py-1.5 px-1 font-mono">
                    <span className="text-slate-300">Round #{h.roundNumber}</span>
                    <span className="text-pink-400 font-bold">{h.crashMultiplier.toFixed(2)}x</span>
                  </div>
                ))}
          </div>
        </aside>

        {/* Right column: Canvas + Bet Panels + Mobile Bets */}
        <section className="lg:col-span-8 flex flex-col gap-2 min-h-0">
          {/* AVIATOR FLIGHT CANVAS SCENE
              Uses the CrashRocket adapter (simple 3-state API) wired to live
              socket data. Maps:
                currentMultiplier  ← displayMultiplier (updated by MULTIPLIER_UPDATE)
                gameState          ← derived from currentPhase (BETTING→WAITING,
                                     RUNNING→FLYING, CRASHED→CRASHED)
                crashMultiplier    ← final crash value from ROUND_CRASHED event
                roundId            ← for fly-away animation reset per round
                bettingCloseAtMs   ← countdown timer in the WAITING card
          */}
          <div className="w-full h-[220px] sm:h-[260px] lg:flex-1 lg:min-h-0 relative shrink-0 lg:shrink">
            <CrashRocket
              currentMultiplier={displayMultiplier}
              gameState={
                currentPhase === 'RUNNING'
                  ? 'FLYING'
                  : currentPhase === 'CRASHED'
                    ? 'CRASHED'
                    : 'WAITING'
              }
              crashMultiplier={snapshot?.round?.crashMultiplier ?? null}
              roundId={snapshot?.round?.id}
              bettingCloseAtMs={
                snapshot?.round?.bettingCloseAt
                  ? new Date(snapshot.round.bettingCloseAt).getTime()
                  : null
              }
            />
          </div>

          {/* TWO INDEPENDENT BETTING PANELS — always side-by-side (grid-cols-2) */}
          <div className="shrink-0 grid grid-cols-2 gap-2">
            {renderBettingPanel(1, panel1, setPanel1)}
            {renderBettingPanel(2, panel2, setPanel2)}
          </div>

          {error && (
            <div className="p-2.5 rounded-xl bg-red-950/60 border border-red-500/40 text-red-200 text-xs font-bold text-center shrink-0">
              {error}
            </div>
          )}

          {/* ALL BETS section — mobile only, shown below bet panels */}
          <div className="lg:hidden shrink-0 bg-[#151922] border border-slate-800 rounded-2xl p-2.5 flex flex-col h-[200px] overflow-hidden shadow-lg">
            {/* Tabs */}
            <div className="flex justify-between items-center bg-[#0c0e14] p-1 rounded-xl border border-slate-800 mb-2">
              {(['all', 'previous', 'top'] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-1 text-xs font-bold rounded-lg uppercase tracking-wider transition ${
                    activeTab === tab
                      ? 'bg-slate-700 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {tab === 'all' ? 'All Bets' : tab === 'previous' ? 'Previous' : 'Top'}
                </button>
              ))}
            </div>

            <div className="flex justify-between text-[11px] text-slate-400 font-bold px-1 py-1 border-b border-slate-800">
              <span>User</span>
              <span>Bet</span>
              <span>Mult</span>
              <span>Win</span>
            </div>

            {/* Scrollable list */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-800/40 text-xs">
              {activeTab === 'all' &&
                (liveBets.length > 0 ? (
                  liveBets.map((b, i) => (
                    <div key={i} className="flex justify-between items-center py-1.5 px-1 font-mono">
                      <span className="text-slate-300 font-sans truncate max-w-[70px]">{b.player}</span>
                      <span className="text-slate-200">৳{b.stake}</span>
                      <span className="text-purple-400">{b.cashoutMultiplier ? `${b.cashoutMultiplier.toFixed(2)}x` : '-'}</span>
                      <span className={b.payout ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
                        {b.payout ? `+৳${b.payout}` : '-'}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-center text-slate-500 py-6 text-xs font-mono">
                    Waiting for bets in current round...
                  </div>
                ))}

              {activeTab === 'previous' &&
                (myHistory.length > 0 ? (
                  myHistory.map((m, i) => (
                    <div key={i} className="flex justify-between items-center py-1.5 px-1 font-mono">
                      <span className="text-slate-300">#{m.roundNumber}</span>
                      <span className="text-slate-200">৳{m.stake}</span>
                      <span className="text-purple-400">{m.cashoutMultiplier ? `${m.cashoutMultiplier.toFixed(2)}x` : '-'}</span>
                      <span className={m.payout ? 'text-emerald-400 font-bold' : 'text-slate-500'}>
                        {m.payout ? `+৳${m.payout}` : 'Lost'}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="text-center text-slate-500 py-6 text-xs font-mono">No previous player history</div>
                ))}

              {activeTab === 'top' &&
                history
                  .slice()
                  .sort((a, b) => b.crashMultiplier - a.crashMultiplier)
                  .slice(0, 10)
                  .map((h, i) => (
                    <div key={i} className="flex justify-between items-center py-1.5 px-1 font-mono">
                      <span className="text-slate-300">Round #{h.roundNumber}</span>
                      <span className="text-pink-400 font-bold">{h.crashMultiplier.toFixed(2)}x</span>
                    </div>
                  ))}
            </div>
          </div>
        </section>
      </div>

      {/* 4. FOOTER: PROVABLY FAIR & ROYALE FLY BRANDING (Replaces Spribe) */}
      <footer className="shrink-0 flex items-center justify-between px-2 pt-0.5 text-[10px] text-slate-400 font-medium border-t border-slate-800/40">
        <div className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="hover:text-white transition cursor-default">🛡️ Provably Fair Game</span>
        </div>
        <div className="flex items-center gap-1 opacity-80">
          <span>Powered by</span>
          <span className="font-black text-[#e11d48]">Royale Fly</span>
        </div>
      </footer>
    </div>
  );
}

function fmt(amount: number): string {
  return Math.round(amount).toLocaleString('en-US');
}

export { RoyaleFlyGame as CrashGame, RoyaleFlyGame as SkyRocketGame };
export default RoyaleFlyGame;
