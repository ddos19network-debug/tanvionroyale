"use client";

import React, { useState } from "react";
import { startFreePlaySession, sendFreePlayAction } from "@/lib/api/games";
import { symbolMetaById } from "./atlantis-defs";

const ATLANTIS_SLUG = "royale-atlantis";
const SIZE = 30;
const RULES = [
  ["Board", "7 columns × 7 rows."],
  ["Match", "3+ same symbols horizontally or vertically. Wilds substitute."],
  ["Special", "Atlantis Gate triggers free spins. Treasure and Kraken mark bonus events."],
];

function Tile({ sym }: { sym: string }) {
  const m = symbolMetaById(sym as any);
  const src = m?.asset ?? "";
  return (
    <div className="rounded-xl bg-black/50 shadow-inner" style={{ width: SIZE, height: SIZE }} title={m?.name ?? sym}>
      {src ? (
        <img src={src} alt={m?.name ?? sym} className="max-w-full max-h-full object-contain" draggable={false} onError={(e) => ((e.target as HTMLImageElement).style.display = "none")} />
      ) : (
        <span className={`text-xs font-black uppercase ${m?.color ?? "text-white"}`}>{m?.name?.slice(0, 2)}</span>
      )}
    </div>
  );
}

export function AtlantisGame() {
  const [grid, setGrid] = useState<string[][] | null>(null);
  const [steps, setSteps] = useState<{ resultingGrid: string[][] }[]>([]);
  const [phase, setPhase] = useState("idle");
  const [points, setPoints] = useState(6000);
  const [bet, setBet] = useState(50);
  const [win, setWin] = useState(0);
  const [show, setShow] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);

  const ensureSession = async () => {
    if (sessionId) return sessionId;
    const s = await startFreePlaySession(ATLANTIS_SLUG);
    setSessionId(s.id);
    return s.id;
  };

  const spin = async () => {
    if (phase === "spinning" || !grid) return;
    if (points < bet) {
      return;
    }
    setPhase("spinning");
    setPoints((p) => p - bet);
    setWin(0);
    try {
      const sid = await ensureSession();
      const res = await sendFreePlayAction(ATLANTIS_SLUG, sid, { type: "SPIN" });
      const st = (res.session.state ?? {}) as Record<string, unknown>;
      setGrid(st.grid as string[][] ?? null);
      setSteps((st.cascadeSteps as { resultingGrid: string[][] }[]) ?? []);
      setWin(typeof st.totalWin === "number" ? st.totalWin : 0);
      setPhase("idle");
      // msg not used in compact variant
    } catch (e: any) {
      setPoints((p) => p + bet);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 p-4 text-amber-200 sm:p-6">
      <div className="relative z-10 flex flex-col items-center">
        <header className="mb-2 text-center">
          <h1 className="drop-shadow-[0_2px_14px_rgba(34,211,238,0.35)] text-3xl font-black tracking-[0.25em] text-cyan-300 sm:text-4xl">ROYALE ATLANTIS</h1>
          <p className="mt-1 text-sm font-medium uppercase tracking-[0.3em] text-amber-300/80">THE LOST OCEAN KINGDOM</p>
        </header>

        <main className="mt-4 w-full max-w-4xl">
          <div className="rounded-2xl border-4 border-cyan-400/60 bg-black/50 p-2 shadow-[0_0_70px_rgba(34,211,238,0.18)]">
            <div className="rounded-xl bg-black/60 p-2 sm:p-3">
              <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                {grid?.map((row, r) => row.map((sym, c) => <Tile key={`${r}-${c}`} sym={sym} />))}
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-amber-400/40 bg-amber-950/40 px-4 py-3 text-sm">
            <div className="flex flex-wrap items-center gap-4 text-amber-100">
              <span className="font-semibold text-cyan-400">Points<span className="font-bold text-amber-200">{points}</span></span>
              <span className="hidden text-slate-500 sm:inline">|</span>
              <span className="font-semibold text-cyan-400">Bet<span className="font-bold text-amber-200">{bet}</span></span>
              <span className="hidden text-slate-500 sm:inline">|</span>
              <span className="font-semibold text-cyan-400">Win<span className="font-bold text-amber-200">{win}</span></span>
              {steps.length > 0 && <span className="text-xs text-cyan-400/80">Cascades: {steps.length}</span>}
            </div>
            <button onClick={() => setPhase((p) => (p === "spinning" ? "idle" : "spinning"))} className="rounded-lg bg-cyan-400 px-5 py-2.5 font-black text-slate-950 shadow hover:bg-cyan-300 disabled:opacity-50" disabled={phase === "spinning"}>
              {phase === "spinning" ? "Spinning..." : "Spin"}
            </button>
          </div>
        </main>
      </div>

      <details className="mt-3 text-center text-sm text-slate-400" open>
        <summary className="cursor-pointer font-semibold text-cyan-400 underline">Rules</summary>
        <div className="mt-2 grid grid-cols-1 gap-2 text-slate-300">
          {RULES.map(([k, v]) => (
            <div key={k} className="flex"><span className="w-20 font-semibold text-cyan-400">{k}</span><span className="ml-2">{v}</span></div>
          ))}
        </div>
      </details>
    </div>
  );
}

export default AtlantisGame;
