"use client";

import React, { useEffect, useState, useCallback } from "react";
import { startFreePlaySession, sendFreePlayAction, getFreePlayPoints } from "@/lib/api/games";
import { symbolMetaById } from "./atlantis-defs";

const ATLANTIS_SLUG = "royale-atlantis";
const RULES = [
  ["Board", "7 columns × 7 rows."],
  ["Match", "5+ same symbols horizontally or vertically. Wilds substitute."],
  ["Special", "Atlantis Gate triggers Free Spins. Treasure and Kraken mark bonus events."],
  ["Cascade", "Winning clusters vanish and new symbols tumble in with multiplier ladder."],
];

function Tile({ sym, isWinning = false }: { sym: string; isWinning?: boolean }) {
  const m = symbolMetaById(sym as any);
  const src = m?.asset ?? "";
  return (
    <div
      className={`relative flex items-center justify-center rounded-xl bg-black/60 p-1 shadow-inner transition-all duration-200 select-none ${
        isWinning ? "ring-2 ring-yellow-400 bg-yellow-400/20 scale-105 z-10 animate-pulse" : "hover:scale-105"
      }`}
      style={{ width: "100%", aspectRatio: "1 / 1" }}
      title={m?.name ?? sym}
    >
      {src ? (
        <img
          src={src}
          alt={m?.name ?? sym}
          className="max-w-full max-h-full object-contain pointer-events-none drop-shadow"
          draggable={false}
          onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
        />
      ) : (
        <span className={`text-xs font-black uppercase ${m?.color ?? "text-white"}`}>{m?.name?.slice(0, 2) ?? sym.slice(0, 2)}</span>
      )}
    </div>
  );
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function AtlantisGame() {
  const [grid, setGrid] = useState<string[][] | null>(null);
  const [winningCells, setWinningCells] = useState<Array<{ row: number; col: number }>>([]);
  const [phase, setPhase] = useState<"idle" | "spinning">("idle");
  const [points, setPoints] = useState<number | null>(null);
  const [bet, setBet] = useState(50);
  const [win, setWin] = useState(0);
  const [multiplier, setMultiplier] = useState(1);
  const [freeSpinsRemaining, setFreeSpinsRemaining] = useState(0);
  const [cascadeCount, setCascadeCount] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  // Load points & start initial session
  useEffect(() => {
    let mounted = true;
    async function init() {
      try {
        const [fp, s] = await Promise.all([
          getFreePlayPoints().catch(() => null),
          startFreePlaySession(ATLANTIS_SLUG).catch(() => null),
        ]);
        if (!mounted) return;
        if (fp && typeof fp.points === "number") {
          setPoints(fp.points);
        }
        if (s) {
          setSessionId(s.id);
          const st = (s.state ?? {}) as Record<string, unknown>;
          if (Array.isArray(st.grid)) {
            setGrid(st.grid as string[][]);
          }
        }
      } catch (err: any) {
        if (mounted) setError(err?.message ?? "Session init error");
      }
    }
    init();
    return () => {
      mounted = false;
    };
  }, []);

  const ensureSession = async () => {
    if (sessionId) return sessionId;
    const s = await startFreePlaySession(ATLANTIS_SLUG);
    setSessionId(s.id);
    return s.id;
  };

  const spin = useCallback(async () => {
    if (phase === "spinning") return;
    if (points !== null && points < bet) {
      setError("Insufficient points for this bet");
      return;
    }

    setPhase("spinning");
    setError(null);
    setMessage(null);
    setWin(0);
    setMultiplier(1);
    setCascadeCount(0);
    setWinningCells([]);

    try {
      const sid = await ensureSession();
      const res = await sendFreePlayAction(ATLANTIS_SLUG, sid, {
        type: "SPIN",
        payload: { bet },
      });

      const st = (res.session.state ?? {}) as Record<string, unknown>;
      const initialGrid = st.grid as string[][];
      const steps = (st.cascadeSteps as any[]) ?? [];

      if (initialGrid) {
        setGrid(initialGrid);
      }

      // Step-by-step cascade playback
      if (steps.length > 0) {
        setCascadeCount(steps.length);
        for (let i = 0; i < steps.length; i++) {
          const step = steps[i];
          if (step.winningClusters?.length > 0) {
            const cells = step.winningClusters.flatMap((c: any) => c.positions ?? []);
            setWinningCells(cells);
            await sleep(250);
          }
          if (step.resultingGrid) {
            setGrid(step.resultingGrid);
            setWinningCells([]);
          }
          if (typeof step.totalWin === "number") {
            setWin(step.totalWin);
          }
          await sleep(250);
        }
      }

      const totalWin = typeof st.totalWin === "number" ? st.totalWin : 0;
      setWin(totalWin);
      if (typeof st.remainingFreeSpins === "number") {
        setFreeSpinsRemaining(st.remainingFreeSpins);
      }
      if (res.result?.message) {
        setMessage(res.result.message);
      }

      // Refresh authoritative balance
      const updatedFp = await getFreePlayPoints().catch(() => null);
      if (updatedFp && typeof updatedFp.points === "number") {
        setPoints(updatedFp.points);
      }
    } catch (e: any) {
      setError(e?.message ?? "Spin failed. Please try again.");
    } finally {
      setPhase("idle");
    }
  }, [phase, points, bet, sessionId]);

  const isCellWinning = (r: number, c: number) => {
    return winningCells.some((p) => p.row === r && p.col === c);
  };

  return (
    <div className="relative min-h-[100dvh] overflow-x-hidden bg-slate-950 p-3 sm:p-6 text-amber-200 flex flex-col items-center justify-between pb-[env(safe-area-inset-bottom)]">
      <div className="relative z-10 flex flex-col items-center w-full max-w-2xl">
        <header className="mb-3 text-center">
          <h1 className="drop-shadow-[0_2px_14px_rgba(34,211,238,0.35)] text-2xl sm:text-3xl font-black tracking-[0.25em] text-cyan-300">
            ROYALE ATLANTIS
          </h1>
          <p className="mt-0.5 text-xs font-semibold uppercase tracking-[0.3em] text-amber-300/80">
            THE LOST OCEAN KINGDOM
          </p>
        </header>

        {freeSpinsRemaining > 0 && (
          <div className="mb-3 w-full rounded-xl border border-cyan-400/60 bg-cyan-950/80 px-4 py-2 text-center text-xs sm:text-sm font-bold text-cyan-200 shadow-[0_0_20px_rgba(34,211,238,0.3)] animate-pulse">
            🏛 Atlantis Gate Free Spins Remaining: <span className="text-amber-300 font-black">{freeSpinsRemaining}</span>
          </div>
        )}

        {/* 7x7 Cascading Grid */}
        <main className="w-full">
          <div className="rounded-2xl border-4 border-cyan-400/60 bg-black/60 p-2 sm:p-3 shadow-[0_0_60px_rgba(34,211,238,0.2)] backdrop-blur">
            <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
              {grid
                ? grid.map((row, r) =>
                    row.map((sym, c) => (
                      <Tile
                        key={`${r}-${c}`}
                        sym={sym}
                        isWinning={isCellWinning(r, c)}
                      />
                    )),
                  )
                : Array.from({ length: 49 }).map((_, i) => (
                    <div
                      key={i}
                      className="rounded-xl bg-slate-900/60 animate-pulse"
                      style={{ width: "100%", aspectRatio: "1 / 1" }}
                    />
                  ))}
            </div>
          </div>

          {/* HUD Status Bar */}
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-400/30 bg-black/70 px-4 py-3 text-xs sm:text-sm backdrop-blur shadow-lg">
            <div className="flex flex-wrap items-center gap-3 sm:gap-4 text-slate-200">
              <span className="font-semibold text-cyan-400">
                Points: <span className="font-black text-amber-300">{points !== null ? points.toLocaleString() : "---"}</span>
              </span>
              <span className="hidden sm:inline text-slate-600">|</span>
              <div className="flex items-center gap-1.5">
                <span className="font-semibold text-cyan-400">Bet:</span>
                <button
                  type="button"
                  onClick={() => setBet((b) => Math.max(10, b - 10))}
                  disabled={phase === "spinning" || bet <= 10}
                  className="h-5 w-5 rounded bg-cyan-950 border border-cyan-400/50 text-cyan-200 font-bold hover:bg-cyan-800 disabled:opacity-30"
                >
                  -
                </button>
                <span className="font-bold text-white min-w-[28px] text-center">{bet}</span>
                <button
                  type="button"
                  onClick={() => setBet((b) => Math.min(500, b + 10))}
                  disabled={phase === "spinning" || bet >= 500}
                  className="h-5 w-5 rounded bg-cyan-950 border border-cyan-400/50 text-cyan-200 font-bold hover:bg-cyan-800 disabled:opacity-30"
                >
                  +
                </button>
              </div>
              <span className="hidden sm:inline text-slate-600">|</span>
              <span className="font-semibold text-cyan-400">
                Win: <span className="font-black text-yellow-300">{win > 0 ? win.toLocaleString() : 0}</span>
              </span>
              {cascadeCount > 0 && (
                <span className="text-[11px] font-bold text-emerald-400">
                  Cascades: {cascadeCount}
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={spin}
              disabled={phase === "spinning"}
              className="rounded-xl bg-gradient-to-r from-cyan-400 to-teal-400 px-6 py-2.5 font-black text-slate-950 shadow-[0_0_20px_rgba(34,211,238,0.4)] hover:brightness-110 active:scale-95 disabled:opacity-50 transition uppercase tracking-wider text-xs sm:text-sm"
            >
              {phase === "spinning" ? "Tumbling..." : "Spin"}
            </button>
          </div>

          {error && (
            <div className="mt-2 text-center text-xs font-semibold text-rose-400">
              {error}
            </div>
          )}
          {message && !error && (
            <div className="mt-2 text-center text-xs font-semibold text-cyan-300">
              {message}
            </div>
          )}
        </main>
      </div>

      <details className="mt-4 text-center text-xs text-slate-400 max-w-xl w-full">
        <summary className="cursor-pointer font-semibold text-cyan-400 hover:underline">
          Game Rules & Paytable
        </summary>
        <div className="mt-2 space-y-1.5 rounded-xl border border-white/10 bg-black/50 p-3 text-left text-slate-300">
          {RULES.map(([k, v]) => (
            <div key={k} className="flex">
              <span className="w-20 font-bold text-cyan-300 shrink-0">{k}:</span>
              <span>{v}</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

export default AtlantisGame;
