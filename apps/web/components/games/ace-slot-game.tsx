"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@ui/button";

const COLS = 5; const ROWS = 4;
const SYMBOL_ASSETS: Record<string, { img: string; label: string; color: string; val: number; emoji: string }> = {
  ace: { img: "/assets/cards/ace.png", label: "Ace", color: "border-slate-700", val: 5, emoji: "🂡" },
  king: { img: "/assets/cards/king.png", label: "King", color: "border-amber-600", val: 4, emoji: "👑" },
  queen: { img: "/assets/cards/queen.png", label: "Queen", color: "border-purple-600", val: 3, emoji: "👸" },
  jack: { img: "/assets/cards/jack.png", label: "Jack", color: "border-blue-600", val: 2, emoji: "🤴" },
  joker: { img: "/assets/cards/joker.png", label: "Joker", color: "border-red-500", val: 15, emoji: "🃏" },
  crown: { img: "/assets/cards/crown.png", label: "Crown", color: "border-yellow-500", val: 25, emoji: "👑" },
};
const SYMBOL_KEYS = Object.keys(SYMBOL_ASSETS);
const MULTIPLIERS = [1, 2, 3] as const;
type Multiplier = (typeof MULTIPLIERS)[number];
interface HistoryItem { id: string; timestamp: string; bet: number; win: number; multiplier: number; }
interface ReelState { isSpinning: boolean; isStopping: boolean; blurIntensity: number; snapBounce: boolean; }
interface CelebrationParticle { id: number; left: number; delay: number; }
const createRandomMatrix = (): string[][] => Array.from({ length: COLS }, () => Array.from({ length: ROWS }, () => SYMBOL_KEYS[Math.floor(Math.random() * SYMBOL_KEYS.length)]));
const createIdleReels = (): ReelState[] => Array.from({ length: COLS }, () => ({ isSpinning: false, isStopping: false, blurIntensity: 0, snapBounce: false }));

export default function RoyaleAceSlot() {
  const [balance, setBalance] = useState(100000);
  const [betAmount, setBetAmount] = useState(10);
  const [winAmount, setWinAmount] = useState(0);
  const [currentMultiplier, setCurrentMultiplier] = useState<Multiplier>(1);
  const [matrix, setMatrix] = useState<string[][]>(createRandomMatrix);
  const [isTurbo, setIsTurbo] = useState(false);
  const [statusText, setStatusText] = useState("শুভকামনা!");
  const [isMuted, setIsMuted] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [gameHistory, setGameHistory] = useState<HistoryItem[]>([]);
  const [triggerWinCelebration, setTriggerWinCelebration] = useState(false);
  const [celebrationParticles, setCelebrationParticles] = useState<CelebrationParticle[]>([]);
  const [reelStates, setReelStates] = useState<ReelState[]>(createIdleReels);
  const spinLock = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const isSpinning = reelStates.some((reel) => reel.isSpinning);
  const addTimer = useCallback((callback: () => void, delay: number) => { const timer = setTimeout(callback, delay); timers.current.push(timer); return timer; }, []);
  useEffect(() => { return () => { timers.current.forEach(clearTimeout); timers.current = []; }; }, []);

  const playSynthesizedSound = useCallback((type: "spin" | "stop" | "win" | "click") => {
    if (isMuted || typeof window === "undefined") return;
    try {
      const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      const ctx = new AudioContextClass();
      const oscillator = ctx.createOscillator();
      const gain = ctx.createGain();
      oscillator.connect(gain); gain.connect(ctx.destination);
      const now = ctx.currentTime;
      if (type === "spin") { oscillator.type = "sawtooth"; oscillator.frequency.setValueAtTime(150, now); oscillator.frequency.exponentialRampToValueAtTime(80, now + 0.3); gain.gain.setValueAtTime(0.05, now); gain.gain.linearRampToValueAtTime(0, now + 0.3); oscillator.start(now); oscillator.stop(now + 0.3); }
      else if (type === "stop") { oscillator.type = "sine"; oscillator.frequency.setValueAtTime(220, now); gain.gain.setValueAtTime(0.1, now); gain.gain.linearRampToValueAtTime(0, now + 0.1); oscillator.start(now); oscillator.stop(now + 0.1); }
      else if (type === "win") { oscillator.type = "triangle"; oscillator.frequency.setValueAtTime(587.33, now); oscillator.frequency.setValueAtTime(880, now + 0.1); oscillator.frequency.setValueAtTime(1174.66, now + 0.2); gain.gain.setValueAtTime(0.15, now); gain.gain.linearRampToValueAtTime(0, now + 0.4); oscillator.start(now); oscillator.stop(now + 0.4); }
      else { oscillator.type = "sine"; oscillator.frequency.setValueAtTime(440, now); gain.gain.setValueAtTime(0.05, now); gain.gain.linearRampToValueAtTime(0, now + 0.05); oscillator.start(now); oscillator.stop(now + 0.05); }
      oscillator.onended = () => { void ctx.close(); };
    } catch (error) { console.warn("Audio unavailable:", error); }
  }, [isMuted]);

  const handleBetChange = (action: "inc" | "dec") => {
    if (spinLock.current) return;
    playSynthesizedSound("click");
    setBetAmount((previous) => {
      if (action === "dec") { if (previous <= 10) return Math.max(1, previous - 1); if (previous <= 100) return previous - 10; return Math.max(100, previous - 1000); }
      if (previous < 10) return previous + 1;
      if (previous < 100) return previous + 10;
      return previous + 1000;
    });
  };

  const resetReels = () => { setReelStates(createIdleReels()); spinLock.current = false; };

  const triggerAdvancedSpin = async () => {
    if (spinLock.current) return;
    if (betAmount <= 0 || !Number.isFinite(betAmount)) { setStatusText("❌ সঠিক বাজির পরিমাণ দিন!"); return; }
    if (balance < betAmount) { setStatusText("❌ পর্যাপ্ত ব্যালেন্স নেই!"); playSynthesizedSound("click"); return; }
    spinLock.current = true;
    const spinBet = betAmount; const multiplier = currentMultiplier; const turbo = isTurbo;
    setBalance((previous) => previous - spinBet); setWinAmount(0); setTriggerWinCelebration(false); setCelebrationParticles([]); setStatusText("ভাগ্য পরীক্ষা হচ্ছে..."); playSynthesizedSound("spin");
    setReelStates(Array.from({ length: COLS }, () => ({ isSpinning: true, isStopping: false, blurIntensity: turbo ? 9 : 5, snapBounce: false })));
    try {
      const response = await fetch("/api/games/royale-ace/spin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ betAmount: spinBet, multiplier }) });
      if (!response.ok) throw new Error(`Spin API failed: ${response.status}`);
      const serverData = await response.json();
      const validMatrix = Array.isArray(serverData.matrix) && serverData.matrix.length === COLS && serverData.matrix.every((column: unknown) => Array.isArray(column) && column.length === ROWS && column.every((symbol: unknown) => typeof symbol === "string" && Object.prototype.hasOwnProperty.call(SYMBOL_ASSETS, symbol)));
      const validWin = typeof serverData.winAmount === "number" && Number.isFinite(serverData.winAmount) && serverData.winAmount >= 0;
      if (!validMatrix || !validWin) throw new Error("Invalid spin response from server");
      setMatrix(serverData.matrix);
      setBalance((previous) => previous + (serverData.winAmount || 0));
      setWinAmount(serverData.winAmount || 0);
      if ((serverData.winAmount || 0) > 0) { setStatusText(`🎉 জয়! ৳${serverData.winAmount}`); playSynthesizedSound("win"); }
      else { setStatusText("আবার চেষ্টা করুন!"); }
    } catch (error) {
      console.error("Spin error:", error); setBalance((previous) => previous + spinBet); setStatusText("❌ Spin সম্পন্ন হয়নি। আবার চেষ্টা করুন।"); setWinAmount(0);
    } finally { setReelStates(createIdleReels()); spinLock.current = false; }
  };

  return (
    <div className="relative flex min-h-screen w-full select-none flex-col items-center justify-center overflow-x-hidden bg-[#060a14] p-2 font-sans text-white">
      <div className="text-center text-white text-2xl font-black">ROYALE ACE</div>
      <Button onClick={triggerAdvancedSpin} disabled={isSpinning} className="mt-4 h-14 px-8 rounded-2xl bg-gradient-to-r from-amber-500 via-yellow-400 to-amber-600 text-slate-950 font-black tracking-widest">
        {isSpinning ? "স্পিন..." : "🎰 SPIN"}
      </Button>
      <div className="mt-4 text-amber-400">{statusText}</div>
      <div className="mt-2 text-white">৳{balance.toLocaleString()}</div>
    </div>
  );
}

