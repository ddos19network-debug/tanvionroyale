"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@ui/button";

const COLS = 5;
const ROWS = 4;
const MULTIPLIERS = [1, 2, 3, 5] as const;

export type CardSymbolId =
  | "club"
  | "diamond"
  | "heart"
  | "spade"
  | "jack"
  | "queen"
  | "king"
  | "ace"
  | "joker";

interface CardSymbolDef {
  id: CardSymbolId;
  label: string;
  rank: string;
  suit: string;
  color: string;
  textColor: string;
  val: number;
}

const SYMBOL_DEFS: Record<CardSymbolId, CardSymbolDef> = {
  club: {
    id: "club",
    label: "Club",
    rank: "♣",
    suit: "♣",
    color: "#2563eb",
    textColor: "text-blue-600",
    val: 2,
  },
  diamond: {
    id: "diamond",
    label: "Diamond",
    rank: "♦",
    suit: "♦",
    color: "#ea580c",
    textColor: "text-amber-600",
    val: 3,
  },
  heart: {
    id: "heart",
    label: "Heart",
    rank: "♥",
    suit: "♥",
    color: "#dc2626",
    textColor: "text-red-600",
    val: 4,
  },
  spade: {
    id: "spade",
    label: "Spade",
    rank: "♠",
    suit: "♠",
    color: "#0f172a",
    textColor: "text-slate-900",
    val: 5,
  },
  jack: {
    id: "jack",
    label: "Jack",
    rank: "J",
    suit: "♠",
    color: "#4f46e5",
    textColor: "text-indigo-600",
    val: 8,
  },
  queen: {
    id: "queen",
    label: "Queen",
    rank: "Q",
    suit: "♥",
    color: "#c026d3",
    textColor: "text-fuchsia-600",
    val: 10,
  },
  king: {
    id: "king",
    label: "King",
    rank: "K",
    suit: "♠",
    color: "#b45309",
    textColor: "text-amber-700",
    val: 12,
  },
  ace: {
    id: "ace",
    label: "Ace",
    rank: "A",
    suit: "♠",
    color: "#0f172a",
    textColor: "text-slate-900",
    val: 15,
  },
  joker: {
    id: "joker",
    label: "Wild",
    rank: "★",
    suit: "★",
    color: "#e11d48",
    textColor: "text-rose-600",
    val: 25,
  },
};

interface CardCell {
  symbolId: CardSymbolId;
  isGolden: boolean;
}

interface HistoryItem {
  id: string;
  timestamp: string;
  bet: number;
  win: number;
  multiplier: number;
}

const COMMON_SYMBOLS: CardSymbolId[] = [
  "club",
  "diamond",
  "heart",
  "spade",
  "jack",
  "queen",
  "king",
  "ace",
];

function getRandomCard(allowGolden = false): CardCell {
  const sym = COMMON_SYMBOLS[Math.floor(Math.random() * COMMON_SYMBOLS.length)];
  const isGolden = allowGolden && Math.random() < 0.18;
  return { symbolId: sym, isGolden };
}

export default function RoyaleAceSlot() {
  const [balance, setBalance] = useState(100000);
  const [betAmount, setBetAmount] = useState(10);
  const [winAmount, setWinAmount] = useState(0);
  const [matrix, setMatrix] = useState<CardCell[][]>([]);
  const [isTurbo, setIsTurbo] = useState(false);
  const [isAuto, setIsAuto] = useState(false);
  const [statusText, setStatusText] = useState("শুভকামনা!");

  // Combo step: 0 = x1, 1 = x2, 2 = x3, 3 = x5
  const [comboStep, setComboStep] = useState<0 | 1 | 2 | 3>(0);

  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(80); // 0 to 100
  const [showSettings, setShowSettings] = useState(false);
  const [gameHistory, setGameHistory] = useState<HistoryItem[]>([]);
  const [triggerWinCelebration, setTriggerWinCelebration] = useState(false);
  const [celebrationParticles, setCelebrationParticles] = useState<
    { id: number; left: number; delay: number }[]
  >([]);

  // Track winning cell coordinates during combo explosion
  const [winningCoords, setWinningCoords] = useState<{ c: number; r: number }[]>([]);
  const [isExplodingState, setIsExplodingState] = useState(false);
  const [isExitingDown, setIsExitingDown] = useState(false);
  const [isSpinActive, setIsSpinActive] = useState(false);

  // Column drop state: 'idle' | 'waiting' | 'dropping'
  const [colDropStates, setColDropStates] = useState<
    ("idle" | "waiting" | "dropping")[]
  >(Array(COLS).fill("idle"));

  const isAutoRef = useRef(isAuto);
  useEffect(() => {
    isAutoRef.current = isAuto;
  }, [isAuto]);

  const isSpinningRef = useRef(false);

  // Initialize 5x4 Grid Matrix
  useEffect(() => {
    const initialGrid = Array.from({ length: COLS }, (_, colIdx) =>
      Array.from({ length: ROWS }, () => getRandomCard(colIdx >= 1 && colIdx <= 3))
    );
    setMatrix(initialGrid);
  }, []);

  // Web Audio Context Synthesizer Engine
  const playSynthesizedSound = useCallback(
    (type: "spin" | "stop" | "win" | "click" | "explode") => {
      if (isMuted || typeof window === "undefined") return;
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        if (ctx.state === "suspended") {
          void ctx.resume();
        }
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        const masterGain = ctx.createGain();

        // Apply dynamic volume scaling (0 to 1)
        const volScalar = Math.max(0, Math.min(1, volume / 100));
        masterGain.gain.setValueAtTime(volScalar, ctx.currentTime);

        osc.connect(gain);
        gain.connect(masterGain);
        masterGain.connect(ctx.destination);

        if (type === "spin") {
          osc.type = "sawtooth";
          osc.frequency.setValueAtTime(160, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(70, ctx.currentTime + 0.35);
          gain.gain.setValueAtTime(0.04, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.35);
          osc.start();
          osc.stop(ctx.currentTime + 0.35);
        } else if (type === "stop") {
          osc.type = "sine";
          osc.frequency.setValueAtTime(180, ctx.currentTime);
          gain.gain.setValueAtTime(0.08, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.08);
          osc.start();
          osc.stop(ctx.currentTime + 0.08);
        } else if (type === "explode") {
          osc.type = "triangle";
          osc.frequency.setValueAtTime(100, ctx.currentTime);
          osc.frequency.exponentialRampToValueAtTime(30, ctx.currentTime + 0.25);
          gain.gain.setValueAtTime(0.12, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);
          osc.start();
          osc.stop(ctx.currentTime + 0.25);
        } else if (type === "win") {
          osc.type = "sine";
          osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
          osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.08); // E5
          osc.frequency.setValueAtTime(783.99, ctx.currentTime + 0.16); // G5
          osc.frequency.setValueAtTime(1046.5, ctx.currentTime + 0.24); // C6
          gain.gain.setValueAtTime(0.12, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.45);
          osc.start();
          osc.stop(ctx.currentTime + 0.45);
        } else if (type === "click") {
          osc.type = "sine";
          osc.frequency.setValueAtTime(420, ctx.currentTime);
          gain.gain.setValueAtTime(0.04, ctx.currentTime);
          gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.04);
          osc.start();
          osc.stop(ctx.currentTime + 0.04);
        }
      } catch (e) {
        console.warn("Audio Context blocked", e);
      }
    },
    [isMuted, volume]
  );

  const handleBetChange = (action: "inc" | "dec") => {
    playSynthesizedSound("click");
    if (action === "dec") {
      setBetAmount((b) => {
        if (b <= 10) return Math.max(1, b - 1);
        if (b <= 100) return b - 10;
        return Math.max(100, b - 100);
      });
    } else {
      setBetAmount((b) => {
        if (b < 10) return b + 1;
        if (b < 100) return b + 10;
        return b + 100;
      });
    }
  };

  // Combo Elimination & Cascading Gravity Logic
  const processComboSequence = useCallback(
    (
      currentGrid: CardCell[][],
      currentStep: 0 | 1 | 2 | 3,
      accumulatedWin: number
    ) => {
      // Find winning lines across rows (minimum 3 identical or wild symbols from left)
      const winningCells: { c: number; r: number }[] = [];
      let stepPay = 0;

      for (let r = 0; r < ROWS; r++) {
        const first = currentGrid[0][r].symbolId;
        let matchCount = 1;

        for (let c = 1; c < COLS; c++) {
          const sym = currentGrid[c][r].symbolId;
          if (sym === first || sym === "joker" || first === "joker") {
            matchCount++;
          } else {
            break;
          }
        }

        if (matchCount >= 3) {
          const baseSym = first === "joker" ? "ace" : first;
          const def = SYMBOL_DEFS[baseSym] || SYMBOL_DEFS.ace;
          stepPay += (def.val || 2) * matchCount * 0.4;

          for (let c = 0; c < matchCount; c++) {
            winningCells.push({ c, r });
          }
        }
      }

      if (winningCells.length > 0) {
        // Match hit! Calculate combo win with current multiplier
        const activeMult = MULTIPLIERS[currentStep];
        const stepWin = Math.round(betAmount * stepPay * activeMult);
        const nextTotalWin = accumulatedWin + stepWin;

        setWinningCoords(winningCells);
        setIsExplodingState(true);
        playSynthesizedSound("explode");
        setStatusText(`🔥 COMBO ×${activeMult}! +৳${stepWin}`);
        setWinAmount(nextTotalWin);
        setBalance((prev) => prev + stepWin);

        // Advance multiplier for next combo drop
        const nextStep = Math.min(currentStep + 1, 3) as 0 | 1 | 2 | 3;
        setComboStep(nextStep);

        // Explosion animation delay -> Drop new cards from top
        setTimeout(() => {
          setIsExplodingState(false);
          setMatrix((prevGrid) => {
            const newGrid: CardCell[][] = [];

            for (let c = 0; c < COLS; c++) {
              const col = [...prevGrid[c]];
              const winningRowsInCol = winningCells
                .filter((coord) => coord.c === c)
                .map((coord) => coord.r);

              // Remove winning cards and convert golden cards to Wilds
              const surviving: CardCell[] = [];
              for (let r = 0; r < ROWS; r++) {
                if (winningRowsInCol.includes(r)) {
                  if (col[r].isGolden) {
                    surviving.push({ symbolId: "joker", isGolden: false });
                  }
                } else {
                  surviving.push(col[r]);
                }
              }

              // Gravity drop: surviving cards drop to the bottom, new cards drop from top
              while (surviving.length < ROWS) {
                surviving.unshift(getRandomCard(c >= 1 && c <= 3));
              }

              newGrid.push(surviving);
            }

            return newGrid;
          });

          setWinningCoords([]);

          // Next combo evaluation cycle
          setTimeout(() => {
            setMatrix((latestGrid) => {
              processComboSequence(latestGrid, nextStep, nextTotalWin);
              return latestGrid;
            });
          }, isTurbo ? 220 : 400);
        }, isTurbo ? 260 : 440);
      } else {
        // Combo sequence finished
        isSpinningRef.current = false;
        setIsSpinActive(false);
        const finalMult = MULTIPLIERS[currentStep];

        const timestamp = new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        setGameHistory((prev) => [
          {
            id: Math.random().toString(36).substring(2, 9),
            timestamp,
            bet: betAmount,
            win: accumulatedWin,
            multiplier: finalMult,
          },
          ...prev,
        ]);

        if (accumulatedWin > 0) {
          playSynthesizedSound("win");
          setStatusText(`🎉 মোট জয়! ৳${accumulatedWin}`);
          setCelebrationParticles(
            Array.from({ length: 28 }, (_, i) => ({
              id: i,
              left: Math.random() * 90 + 5,
              delay: Math.random() * 1.5,
            }))
          );
          setTriggerWinCelebration(true);
        } else {
          setStatusText("আবার চেষ্টা করুন!");
        }

        // Auto spin loop continuation
        if (isAutoRef.current) {
          setTimeout(() => {
            if (isAutoRef.current) {
              triggerAdvancedSpin();
            }
          }, isTurbo ? 800 : 1800);
        }
      }
    },
    [betAmount, isTurbo, playSynthesizedSound]
  );

  const triggerAdvancedSpin = async () => {
    if (isSpinningRef.current) return;

    if (balance < betAmount) {
      setStatusText("❌ পর্যাপ্ত ব্যালেন্স নেই!");
      setIsAuto(false);
      playSynthesizedSound("click");
      return;
    }

    isSpinningRef.current = true;
    setIsSpinActive(true);
    setBalance((prev) => prev - betAmount);
    setWinAmount(0);
    setTriggerWinCelebration(false);
    setWinningCoords([]);
    setComboStep(0);
    setStatusText("ভাগ্য পরীক্ষা হচ্ছে...");
    playSynthesizedSound("spin");

    // Phase 1: Old cards smoothly slide down and disappear
    setIsExitingDown(true);

    // Fetch next round matrix in parallel
    let serverMatrix: string[][] | null = null;
    try {
      const response = await fetch("/api/v1/games/royale-ace/spin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ betAmount }),
      });
      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data.matrix)) {
          serverMatrix = data.matrix;
        }
      }
    } catch {
      /* fallback */
    }

    const finalGrid: CardCell[][] = [];
    for (let c = 0; c < COLS; c++) {
      const col: CardCell[] = [];
      for (let r = 0; r < ROWS; r++) {
        if (serverMatrix && serverMatrix[c] && serverMatrix[c][r]) {
          const rawId = serverMatrix[c][r] as CardSymbolId;
          const validId = SYMBOL_DEFS[rawId] ? rawId : "ace";
          col.push({
            symbolId: validId,
            isGolden: c >= 1 && c <= 3 && Math.random() < 0.18,
          });
        } else {
          col.push(getRandomCard(c >= 1 && c <= 3));
        }
      }
      finalGrid.push(col);
    }

    const exitMs = isTurbo ? 100 : 200;
    const dropDuration = isTurbo ? 220 : 420;
    // Exactly 1 row of distance: when col reaches row 2, next col begins row 1!
    const staggerDelay = Math.round(dropDuration / 4);

    // Phase 2: After cards exit downward, start diagonal waterfall drop
    setTimeout(() => {
      setIsExitingDown(false);
      setMatrix(finalGrid);

      // Col 0 drops immediately; Cols 1-4 wait until preceding col reaches Row 2
      setColDropStates(["dropping", "waiting", "waiting", "waiting", "waiting"]);

      for (let c = 0; c < COLS; c++) {
        const startDelay = c * staggerDelay;
        const landDelay = startDelay + dropDuration;

        // When Col c's turn arrives (when prev column has dropped to Row 2)
        if (c > 0) {
          setTimeout(() => {
            setColDropStates((prev) => {
              const next = [...prev];
              next[c] = "dropping";
              return next;
            });
          }, startDelay);
        }

        // When Col c finishes its 1-time drop from top to row 4 and lands
        setTimeout(() => {
          playSynthesizedSound("stop");
          setColDropStates((prev) => {
            const next = [...prev];
            next[c] = "idle";
            return next;
          });

          // When final Col 4 lands: evaluate combo matches!
          if (c === COLS - 1) {
            setTimeout(() => {
              setColDropStates(Array(COLS).fill("idle"));
              processComboSequence(finalGrid, 0, 0);
            }, 60);
          }
        }, landDelay);
      }
    }, exitMs);
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen w-full bg-transparent text-white p-1 sm:p-2 font-sans select-none overflow-x-hidden relative">
      {/* FULL DISPLAY ROYAL PLAY BACKDROP IMAGE */}
      <div className="fixed inset-0 w-full h-full pointer-events-none select-none z-0 overflow-hidden">
        {/* Full display fit cover image */}
        <div
          className="absolute inset-0 w-full h-full bg-cover bg-center bg-no-repeat transition-all duration-700"
          style={{
            backgroundImage: `url('/assets/image/royaleplay2.png')`,
          }}
        />
        {/* Balanced Casino Ambient Color Correction (Vibrant on both Desktop & Mobile) */}
        <div className="absolute inset-0 bg-gradient-to-b from-[#050914]/45 via-transparent to-[#040711]/60" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_35%,rgba(4,7,17,0.65)_100%)]" />
      </div>

      {/* WIN CELEBRATION GOLD PARTICLE RAIN */}
      {triggerWinCelebration && (
        <div className="absolute inset-0 pointer-events-none z-50 overflow-hidden">
          <div className="absolute inset-0 bg-amber-500/15 animate-pulse duration-300" />
          {celebrationParticles.map((p) => (
            <div
              key={p.id}
              style={{ left: `${p.left}%`, animationDelay: `${p.delay}s` }}
              className="absolute -top-10 w-3.5 h-3.5 bg-gradient-to-r from-amber-400 to-yellow-200 rounded-full shadow-[0_0_10px_#f59e0b] animate-gold-rain"
            />
          ))}
        </div>
      )}

      {/* MAIN CONTAINER DEVICE FRAME (Desktop >430x580, Responsive Aspect Ratio: Height = 134.88% of Width) */}
      <div
        style={{ aspectRatio: "430 / 580" }}
        className="w-full max-w-[430px] md:max-w-[490px] lg:max-w-[550px] max-h-[96vh] flex flex-col justify-between bg-[#080f1e]/75 backdrop-blur-[6px] rounded-[2rem] p-2 sm:p-2.5 shadow-[0_0_50px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(255,255,255,0.06)] border border-slate-700/30 overflow-hidden relative z-10"
      >
        {/* COMPACT TOP BAR: Back button, Title & Balance in one ultra-slim line */}
        <div className="flex justify-between items-center w-full z-20 px-1 pt-0.5 pb-0.5">
          <Button
            variant="outline"
            className="flex items-center gap-1 bg-[#14203a]/80 border-slate-800 text-slate-300 hover:text-white rounded-full px-2.5 h-6 text-[10px] font-bold active:scale-95 transition-all"
            onClick={() => {
              playSynthesizedSound("click");
              setIsAuto(false);
              window.history.back();
            }}
          >
            ← Games
          </Button>

          {/* Title Banner */}
          <div className="text-center">
            <span className="font-black text-xs sm:text-sm tracking-widest bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-500 bg-clip-text text-transparent drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
              ROYALE ACE
            </span>
          </div>

          {/* Compact Single-Line Balance */}
          <div className="flex items-center gap-1 bg-[#14203a]/80 border border-slate-800/80 rounded-full px-2.5 h-6">
            <span className="text-[10px] text-slate-400 font-semibold">ব্যালেন্স:</span>
            <span className="text-[11px] sm:text-xs font-black text-emerald-400 font-mono">
              ৳{balance.toLocaleString()}
            </span>
          </div>
        </div>

        {/* ULTRA-SLIM JILI MULTIPLIER CAPSULE BAR (×1, ×2, ×3, ×5) */}
        <div className="w-full max-w-sm sm:max-w-md mx-auto my-0.5 px-1 z-20">
          <div className="flex items-center justify-between bg-gradient-to-r from-[#7c4d0a] via-[#eab308] to-[#7c4d0a] p-0.5 rounded-full shadow-[0_0_12px_rgba(234,179,8,0.4)] border border-amber-200/50 h-6 sm:h-7">
            {MULTIPLIERS.map((mult, idx) => {
              const isActive = comboStep === idx;
              return (
                <div
                  key={idx}
                  className={`flex-1 text-center font-black rounded-full py-0.5 transition-all duration-300 ${
                    isActive
                      ? "bg-gradient-to-b from-yellow-100 via-amber-300 to-yellow-500 text-slate-950 shadow-[0_0_10px_#fde047] scale-105 font-mono text-xs sm:text-sm border border-amber-100"
                      : "text-amber-950 font-mono text-[11px] sm:text-xs font-black drop-shadow-[0_1px_1px_rgba(255,255,255,0.25)] hover:text-slate-950"
                  }`}
                >
                  ×{mult}
                </div>
              );
            })}
          </div>
        </div>

        {/* METALLIC CARD DISPENSER TABS */}
        <div className="grid grid-cols-5 gap-1 sm:gap-1.5 px-1 z-10">
          {Array.from({ length: COLS }).map((_, i) => (
            <div
              key={i}
              className="h-2 bg-gradient-to-b from-slate-400 via-slate-600 to-slate-800 rounded-t-sm border-t border-slate-300/50 shadow-inner flex items-center justify-center"
            >
              <div className="w-3 sm:w-5 h-0.5 bg-slate-900/90 rounded-full" />
            </div>
          ))}
        </div>

        {/* JUMBO CARD GRID (Maximum Height Utilization) */}
        <div className="flex-1 min-h-0 w-full flex flex-col justify-center px-0.5 my-0.5 relative">
          <div className="grid grid-cols-5 gap-1 sm:gap-1.5 h-full p-1 sm:p-1.5 bg-[#040814]/30 backdrop-blur-[3px] rounded-2xl border border-amber-500/20 shadow-[inset_0_0_20px_rgba(0,0,0,0.4)] relative overflow-hidden">
            {/* Background Watermark Branding (Vibrant during spins & drops, transparent with backdrop image) */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none select-none z-0">
              <span
                className={`text-2xl sm:text-4xl md:text-5xl font-black tracking-[0.28em] uppercase font-mono transition-all duration-300 text-center ${
                  isSpinActive || isExitingDown
                    ? "bg-gradient-to-r from-amber-200 via-yellow-300 to-amber-400 bg-clip-text text-transparent drop-shadow-[0_0_25px_rgba(245,158,11,0.85)] scale-105 opacity-90"
                    : "text-amber-400/20 drop-shadow-[0_0_10px_rgba(245,158,11,0.2)] scale-100 opacity-60"
                }`}
              >
                ROYALE PLAY
              </span>
              {(isSpinActive || isExitingDown) && (
                <div className="w-24 sm:w-36 h-0.5 bg-gradient-to-r from-transparent via-amber-400/70 to-transparent mt-1 animate-pulse" />
              )}
            </div>

            {matrix.length > 0 &&
              matrix.map((column, colIdx) => {
                const colDropState = colDropStates[colIdx];
                return (
                  <div
                    key={colIdx}
                    className="relative h-full bg-[#0a1224]/20 rounded-xl overflow-hidden flex flex-col justify-between z-10 border border-white/[0.04]"
                  >
                    <div
                      style={{
                        willChange: "transform, opacity",
                        opacity: colDropState === "waiting" ? 0 : 1,
                      }}
                      className={`flex flex-col h-full justify-between p-0.5 gap-1 ${
                        isExitingDown
                          ? "animate-card-exit-down"
                          : colDropState === "dropping"
                          ? isTurbo
                            ? "animate-single-drop-turbo"
                            : "animate-single-drop"
                          : ""
                      }`}
                    >
                      {column.map((cell, rowIdx) => {
                        const def =
                          SYMBOL_DEFS[cell.symbolId] || SYMBOL_DEFS.ace;
                        const isWinning = winningCoords.some(
                          (coord) => coord.c === colIdx && coord.r === rowIdx
                        );

                        return (
                          <div
                            key={rowIdx}
                            className={`relative flex-1 min-h-0 w-full rounded-md sm:rounded-lg overflow-hidden flex flex-col items-center justify-between p-1 transition-all duration-200 select-none ${
                              isWinning && isExplodingState
                                ? "scale-90 opacity-10 bg-amber-400 shadow-[0_0_20px_#f59e0b]"
                                : isWinning
                                ? "ring-2 ring-amber-400 shadow-[0_0_16px_rgba(245,158,11,0.95)] scale-[1.03] z-10 animate-pulse bg-amber-50"
                                : cell.isGolden
                                ? "bg-gradient-to-b from-amber-100 via-yellow-100 to-amber-200 ring-2 ring-amber-400 shadow-[0_0_12px_rgba(245,158,11,0.6)]"
                                : "bg-white shadow-md"
                            }`}
                          >
                            {/* Card Top Left Rank */}
                            <div className="w-full flex justify-between items-start leading-none px-0.5">
                              <span
                                className={`text-xs sm:text-sm font-black font-serif ${def.textColor}`}
                              >
                                {def.rank}
                              </span>
                              {cell.isGolden && (
                                <span className="text-[7px] sm:text-[8px] font-black text-amber-900 bg-amber-300/90 px-1 rounded-sm leading-tight shadow-sm">
                                  GOLD
                                </span>
                              )}
                            </div>

                            {/* Card Center Symbol Illustration (Bigger & High Visuality) */}
                            <div className="flex-1 flex items-center justify-center w-full my-0.5">
                              {cell.symbolId === "club" && (
                                <span className="text-3xl sm:text-4xl text-blue-600 drop-shadow">
                                  ♣
                                </span>
                              )}
                              {cell.symbolId === "diamond" && (
                                <span className="text-3xl sm:text-4xl text-amber-600 drop-shadow">
                                  ♦
                                </span>
                              )}
                              {cell.symbolId === "heart" && (
                                <span className="text-3xl sm:text-4xl text-red-600 drop-shadow">
                                  ♥
                                </span>
                              )}
                              {cell.symbolId === "spade" && (
                                <span className="text-3xl sm:text-4xl text-slate-900 drop-shadow">
                                  ♠
                                </span>
                              )}
                              {cell.symbolId === "jack" && (
                                <div className="flex flex-col items-center">
                                  <span className="text-2xl sm:text-3xl font-black font-serif text-indigo-700">
                                    ⚔️ J
                                  </span>
                                </div>
                              )}
                              {cell.symbolId === "queen" && (
                                <div className="flex flex-col items-center">
                                  <span className="text-2xl sm:text-3xl font-black font-serif text-fuchsia-700">
                                    👑 Q
                                  </span>
                                </div>
                              )}
                              {cell.symbolId === "king" && (
                                <div className="flex flex-col items-center">
                                  <span className="text-2xl sm:text-3xl font-black font-serif text-amber-800">
                                    👑 K
                                  </span>
                                </div>
                              )}
                              {cell.symbolId === "ace" && (
                                <div className="flex flex-col items-center">
                                  <span className="text-3xl sm:text-4xl text-slate-950 font-black">
                                    ♠
                                  </span>
                                  <span className="text-[8px] sm:text-[9px] font-black tracking-widest text-slate-800 bg-amber-300 px-1 rounded shadow-sm">
                                    ACE
                                  </span>
                                </div>
                              )}
                              {cell.symbolId === "joker" && (
                                <div className="flex flex-col items-center">
                                  <span className="text-3xl sm:text-4xl animate-bounce">
                                    🃏
                                  </span>
                                  <span className="text-[8px] font-black text-rose-600 uppercase tracking-widest">
                                    WILD
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Card Bottom Inverted Rank */}
                            <div className="w-full flex justify-end items-end leading-none px-1 pb-0.5">
                              <span
                                className={`text-[11px] sm:text-xs font-black font-serif rotate-180 ${def.textColor}`}
                              >
                                {def.rank}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>

        {/* STATUS PILL — zero layout height, transparent glass overlay above bet bar */}
        <div className="relative h-0 overflow-visible flex justify-center pointer-events-none z-30">
          {statusText && (() => {
            const isWin = statusText.includes("জয়") || statusText.includes("COMBO");
            return (
              <div
                className={`absolute bottom-1 px-3.5 py-0.5 rounded-full transition-all duration-300 animate-fade-in whitespace-nowrap flex items-center justify-center ${
                  isWin
                    ? "bg-slate-950/60 backdrop-blur-md border border-amber-400/40 shadow-[0_4px_14px_rgba(0,0,0,0.5),0_0_12px_rgba(245,158,11,0.3)]"
                    : "bg-transparent border border-transparent shadow-none"
                }`}
              >
                <span
                  className={`transition-all ${
                    isWin
                      ? "font-black text-[11px] sm:text-xs tracking-wide bg-gradient-to-r from-yellow-200 via-amber-300 to-yellow-100 bg-clip-text text-transparent drop-shadow-[0_2px_3px_rgba(0,0,0,0.95)]"
                      : "font-medium text-[10px] sm:text-[11px] text-amber-200/45 drop-shadow-[0_1px_2px_rgba(0,0,0,0.7)]"
                  }`}
                  style={
                    isWin
                      ? {
                          textShadow:
                            "0 0 10px rgba(245, 158, 11, 0.55), 0 1px 2px rgba(0, 0, 0, 0.9)",
                        }
                      : undefined
                  }
                >
                  {statusText}
                </span>
              </div>
            );
          })()}
        </div>

        {/* COMPACT SINGLE-LINE BET & WIN ROW */}
        <div className="flex justify-between items-center bg-[#0d162a]/65 border border-slate-700/50 rounded-xl px-3 py-1 my-0.5 z-20 backdrop-blur-sm">
          {/* Left: Bet Label, Buttons and Amount on SAME line */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-400 font-bold">বেট:</span>
            <button
              onClick={() => handleBetChange("dec")}
              disabled={isSpinActive}
              className="h-6 w-6 rounded-md bg-[#18233c] text-amber-400 font-black text-xs flex items-center justify-center hover:bg-[#20315c] active:scale-90 transition-transform disabled:opacity-30"
            >
              -
            </button>
            <span className="font-mono text-xs sm:text-sm font-black text-amber-300 min-w-[3rem] text-center">
              ৳{betAmount}
            </span>
            <button
              onClick={() => handleBetChange("inc")}
              disabled={isSpinActive}
              className="h-6 w-6 rounded-md bg-[#18233c] text-amber-400 font-black text-xs flex items-center justify-center hover:bg-[#20315c] active:scale-90 transition-transform disabled:opacity-30"
            >
              +
            </button>
          </div>

          {/* Right: Win Label and Amount on SAME line */}
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-slate-400 font-bold">জয়:</span>
            <span className="font-mono text-xs sm:text-sm font-black text-amber-400 drop-shadow-[0_0_6px_rgba(245,158,11,0.5)]">
              ৳{winAmount}
            </span>
          </div>
        </div>

        {/* FOOTER TERMINAL ACTION CONTROLS */}
        <div className="flex items-center gap-2 sm:gap-2.5 pt-0.5 px-1 z-20">
          {/* Settings & History Button */}
          <button
            className={`h-11 sm:h-12 w-11 sm:w-12 rounded-2xl border flex items-center justify-center transition-all active:scale-90 ${
              showSettings
                ? "bg-amber-500/20 border-amber-500/50 text-amber-400"
                : "bg-[#101729] border-slate-900 text-slate-400 hover:text-white"
            }`}
            onClick={() => {
              playSynthesizedSound("click");
              setShowSettings(!showSettings);
            }}
            title="সেটিংস ও হিস্টোরি"
            aria-label="সেটিংস ও হিস্টোরি"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>

          {/* Auto Spin Switcher Button */}
          <button
            onClick={() => {
              playSynthesizedSound("click");
              setIsAuto(!isAuto);
            }}
            className={`h-11 sm:h-12 px-3 rounded-2xl font-black text-[11px] tracking-wider border transition-all active:scale-90 ${
              isAuto
                ? "bg-gradient-to-r from-emerald-500 to-teal-600 text-slate-950 border-transparent shadow-[0_0_12px_rgba(16,185,129,0.5)]"
                : "bg-[#101729] text-slate-400 border-slate-900 hover:text-white"
            }`}
          >
            AUTO
          </button>

          {/* Core Master Spin Button */}
          <Button
            onClick={triggerAdvancedSpin}
            disabled={isSpinActive || showSettings}
            className="flex-1 h-11 sm:h-12 bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600 text-slate-950 font-black text-sm sm:text-base tracking-widest rounded-2xl shadow-[0_0_22px_rgba(245,158,11,0.3)] active:scale-95 transition-transform disabled:opacity-40"
          >
            {isSpinActive ? "স্পিন..." : "🎰 SPIN"}
          </Button>

          {/* Turbo Speed Switcher Button */}
          <button
            onClick={() => {
              playSynthesizedSound("click");
              setIsTurbo(!isTurbo);
            }}
            className={`h-11 sm:h-12 px-3 rounded-2xl font-black text-xs tracking-wider transition-all active:scale-90 border ${
              isTurbo
                ? "bg-gradient-to-r from-red-500 to-orange-500 text-white border-transparent shadow-[0_0_15px_rgba(239,68,68,0.4)]"
                : "bg-[#101729] text-slate-500 border-slate-900 hover:text-slate-300"
            }`}
          >
            TURBO
          </button>
        </div>

        {/* SETTINGS & HISTORY MODAL DRAWER OVERLAY */}
        {showSettings && (
          <div className="absolute inset-0 z-40 bg-[#070c18]/95 backdrop-blur-md flex flex-col p-4 rounded-[2rem] animate-fade-in overflow-hidden">
            {/* Header */}
            <div className="flex justify-between items-center border-b border-slate-800 pb-3 mb-3">
              <span className="text-amber-400 font-bold text-sm flex items-center gap-1.5">
                ⚙️ সেটিংস ও হিস্টোরি
              </span>
              <button
                onClick={() => {
                  playSynthesizedSound("click");
                  setShowSettings(false);
                }}
                className="h-8 w-8 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white flex items-center justify-center text-sm font-bold transition-colors"
              >
                ✕
              </button>
            </div>

            {/* Quick Settings Controls */}
            <div className="flex flex-col gap-2.5 mb-3">
              {/* Sound & Volume Control */}
              <div className="bg-[#121c33]/80 border border-slate-800 rounded-2xl p-3 flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="text-lg">{isMuted ? "🔇" : "🔊"}</span>
                    <div>
                      <span className="text-xs font-bold text-slate-200 block">
                        গেম সাউন্ড (Sound)
                      </span>
                      <span className="text-[10px] text-slate-400">
                        {isMuted ? "সাউন্ড বন্ধ (Muted)" : `সাউন্ড চালু (${volume}%)`}
                      </span>
                    </div>
                  </div>

                  {/* Modern Toggle Switch */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!isMuted}
                    onClick={() => {
                      playSynthesizedSound("click");
                      setIsMuted(!isMuted);
                    }}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      !isMuted
                        ? "bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]"
                        : "bg-slate-700"
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                        !isMuted ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {/* Volume Slider (কম-বেশি করার সেটিং) */}
                <div className="flex items-center gap-2.5 pt-1.5 border-t border-slate-800/60">
                  <span className="text-[11px] text-slate-400">🔉</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={isMuted ? 0 : volume}
                    disabled={isMuted}
                    onChange={(e) => {
                      const newVol = Number(e.target.value);
                      setVolume(newVol);
                      if (isMuted && newVol > 0) setIsMuted(false);
                    }}
                    className="flex-1 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-amber-400 disabled:opacity-30"
                  />
                  <span className="text-[11px] text-slate-400">🔊</span>
                  <span className="font-mono text-xs font-bold text-amber-400 min-w-[2.5rem] text-right">
                    {isMuted ? "0%" : `${volume}%`}
                  </span>
                </div>
              </div>

              {/* Turbo Mode Toggle */}
              <div className="bg-[#121c33]/80 border border-slate-800 rounded-2xl p-3 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="text-lg">⚡</span>
                  <div>
                    <span className="text-xs font-bold text-slate-200 block">
                      টার্বো মোড (Turbo Mode)
                    </span>
                    <span className="text-[10px] text-slate-400">
                      {isTurbo ? "দ্রুত স্পিন (Fast)" : "স্বাভাবিক গতি (Normal)"}
                    </span>
                  </div>
                </div>

                {/* Modern Toggle Switch */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={isTurbo}
                  onClick={() => {
                    playSynthesizedSound("click");
                    setIsTurbo(!isTurbo);
                  }}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    isTurbo
                      ? "bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]"
                      : "bg-slate-700"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                      isTurbo ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* History Section */}
            <div className="flex-1 min-h-0 flex flex-col bg-[#0b1324] border border-slate-800/80 rounded-2xl p-3 overflow-hidden">
              <div className="flex justify-between items-center mb-2 pb-1.5 border-b border-slate-800/60">
                <span className="text-xs font-bold text-amber-400">
                  📜 স্পিন হিস্টোরি
                </span>
                <span className="text-[10px] text-slate-500 font-mono">
                  মোট {gameHistory.length} রাউন্ড
                </span>
              </div>

              <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                {gameHistory.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center py-10 text-slate-500">
                    <span className="text-2xl mb-1">🎰</span>
                    <span className="text-xs">এখনও কোনো স্পিন হিস্টোরি রেকর্ড নেই</span>
                  </div>
                ) : (
                  gameHistory.map((item) => (
                    <div
                      key={item.id}
                      className="flex justify-between items-center bg-[#14203a]/40 border border-slate-800/70 rounded-xl p-2.5 text-xs"
                    >
                      <div>
                        <span className="text-slate-400 text-[10px] block">
                          {item.timestamp}
                        </span>
                        <span className="text-slate-200 font-mono">
                          বেট: ৳{item.bet}
                        </span>
                      </div>
                      <div className="text-right">
                        <span
                          className={`font-mono font-bold block ${
                            item.win > 0 ? "text-emerald-400" : "text-slate-500"
                          }`}
                        >
                          {item.win > 0 ? `+৳${item.win}` : "৳০"}
                        </span>
                        <span className="text-[10px] text-amber-400/80 font-mono">
                          {item.multiplier}X মাল্টিপ্লায়ার
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
