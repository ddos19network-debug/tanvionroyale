"use client";

import React, { useState } from "react";
import { startFreePlaySession, sendFreePlayAction } from "@/lib/api/games";
import { SymbolCell } from "./pharaoh-images";
import { EgyptianDecor } from "./pharaoh-decoration";
import { GameRulesPanel, PaytablePanel } from "./pharaoh-panels";

export function PharaohGame() {
  const [grid, setGrid] = useState<string[][]>(
    Array.from({ length: 4 }, () => Array.from({ length: 5 }, () => "papyrus"))
  );
  const [isSpinning, setIsSpinning] = useState(false);
  const [balance, setBalance] = useState(1000);
  const [bet, setBet] = useState(10);
  const [win, setWin] = useState(0);
  const [msg, setMsg] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showPaytable, setShowPaytable] = useState(false);
  const [showRules, setShowRules] = useState(false);

  const ensureSession = async () => {
    if (sessionId) return sessionId;
    const s = await startFreePlaySession("royale-pharaoh");
    setSessionId(s.id);
    return s.id;
  };

  const spin = async () => {
    if (isSpinning) return;
    if (balance < bet) {
      setMsg("Insufficient balance.");
      return;
    }
    setIsSpinning(true);
    setBalance((b) => b - bet);
    setWin(0);
    setMsg("");

    try {
      const sid = await ensureSession();
      const r = await sendFreePlayAction("royale-pharaoh", sid, { type: "SPIN" });
      const st = (r.session.state ?? {}) as Record<string, unknown>;
      setGrid(st.grid as string[][]);
      setMsg(r.result?.message ?? "");
      setWin(typeof st.win === "number" ? st.win : 0);
      if (r.finished) setSessionId(null);
    } catch (e: any) {
      setMsg(e?.message ?? "Spin failed.");
      setBalance((b) => b + bet);
      setWin(0);
    } finally {
      setIsSpinning(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 p-4 text-amber-200 sm:p-6">
      <EgyptianDecor />
      <div className="relative z-10 flex flex-col items-center">
        <header className="mb-2 text-center">
          <h1 className="drop-shadow-[0_2px_14px_rgba(251,191,36,0.35)] text-3xl font-black tracking-[0.25em] text-amber-300 sm:text-4xl">ROYALE PHARAOH</h1>
          <p className="mt-1 text-sm font-medium uppercase tracking-[0.3em] text-cyan-300/80">CURSE OF THE GOLDEN KINGDOM</p>
        </header>

        <div className="mb-3 flex items-center gap-3 rounded-xl border border-amber-400/40 bg-amber-950/50 px-4 py-2 text-xs text-amber-200/80 shadow-lg shadow-amber-950/30">
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
          <span>Free-play · Ancient Egyptian treasury · No real money</span>
        </div>

        <main className="mt-4 w-full max-w-4xl">
          <div className="rounded-2xl border-4 border-amber-400/60 bg-black/50 p-2 shadow-[0_0_70px_rgba(251,191,36,0.18)]">
            <div className="rounded-xl bg-black/60 p-2 sm:p-3">
              <div className="grid grid-cols-5 gap-1.5 sm:gap-3">
                {grid.map((row, r) =>
                  row.map((sym, c) => <SymbolCell key={`${r}-${c}`} symId={sym as any} />)
                )}
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-400/40 bg-amber-950/40 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-4 text-amber-100">
              <span className="flex items-center gap-1.5 font-semibold text-amber-400">Balance<span className="font-bold text-amber-200">{balance}</span></span>
              <span className="hidden text-slate-500 sm:inline">|</span>
              <span className="flex items-center gap-1.5 font-semibold text-amber-400">Bet<span className="font-bold text-amber-200">{bet}</span></span>
              <span className="hidden text-slate-500 sm:inline">|</span>
              <span className="flex items-center gap-1.5 font-semibold text-amber-400">Win<span className="font-bold text-amber-200">{win}</span></span>
            </div>

            <button onClick={spin} disabled={isSpinning} className="inline-flex items-center gap-2 rounded-lg bg-amber-400 px-5 py-2.5 font-black text-slate-950 shadow-lg transition hover:bg-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-300 disabled:cursor-not-allowed disabled:opacity-60">
              {isSpinning ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-950 border-t-transparent" /> : "Spin"}
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <button onClick={() => setBet((b) => Math.max(1, b - 1))} className="rounded-lg border border-amber-400/40 px-2.5 py-1 hover:bg-amber-950/40">- Bet</button>
            <span>Bet: {bet}</span>
            <button onClick={() => setBet((b) => b + 1)} className="rounded-lg border border-amber-400/40 px-2.5 py-1 hover:bg-amber-950/40">+ Bet</button>
            <span className="text-slate-500">|</span>
            <button onClick={() => setShowPaytable(true)} className="rounded-lg border border-amber-400/40 px-2.5 py-1 hover:bg-amber-950/40">Paytable</button>
            <button onClick={() => setShowRules(true)} className="rounded-lg border border-amber-400/40 px-2.5 py-1 hover:bg-amber-950/40">Rules</button>
          </div>
        </main>
      </div>

      {showPaytable && <PaytablePanel onClose={() => setShowPaytable(false)} />}
      {showRules && <GameRulesPanel onClose={() => setShowRules(false)} />}
    </div>
  );
}

export default PharaohGame;
