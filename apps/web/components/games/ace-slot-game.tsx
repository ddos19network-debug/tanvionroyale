'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeApiError } from '@/lib/api/client';
import {
  aceSpin,
  getAceConfig,
  getAceHistory,
  submitAceAutoplayLimits,
  verifyAce,
  type AceCell,
  type AceConfigView,
  type AceRoundResult,
  type AceRoundView,
  type AceSymbol,
} from '@/lib/api/ace';

/**
 * TANVION ROYALE — "Royale Ace" (royale-ace): original 5×4 / 1024-ways
 * cascading card slot (royal casino night: gold + navy).
 *
 * The client is a DUMB REPLAYER. One POST /spin returns the ENTIRE pre-derived
 * round — initial grid, every cascade step, golden→wild placements, the
 * multiplier ladder, the scatter trigger and the full free-spin sequence — all
 * settled server-side. This component only ANIMATES that outcome: it never
 * invents a symbol, never predicts a cascade, never changes a payout, and uses
 * no near-miss or "almost won" effects. Skipping the animation yields the same
 * result. All odds (paytable, ways, ladder, RTP, max win, volatility) are shown
 * in the info panel; nothing is hidden.
 */

// --- Royal casino-night art (ORIGINAL TANVION symbols; no third-party assets) ---

const SUIT_LABEL: Record<AceSymbol, string> = {
  SPADE: '♠',
  HEART: '♥',
  DIAMOND: '♦',
  CLUB: '♣',
  J: 'J',
  Q: 'Q',
  K: 'K',
  A: 'A',
  WILD: '★',
  SCATTER: '✦',
};

const SUIT_NAME: Record<AceSymbol, string> = {
  SPADE: 'Spade',
  HEART: 'Heart',
  DIAMOND: 'Diamond',
  CLUB: 'Club',
  J: 'Jack',
  Q: 'Queen',
  K: 'King',
  A: 'Ace',
  WILD: 'Wild',
  SCATTER: 'Scatter (Free Spins)',
};

/** Red suits are diamonds + hearts (royal card convention). */
const RED_SUITS = new Set<AceSymbol>(['HEART', 'DIAMOND']);

const REELS = 5;
const ROWS = 4;

function symbolClasses(symbol: AceSymbol, golden: boolean): string {
  const base = 'flex items-center justify-center rounded-lg font-black select-none ';
  if (symbol === 'WILD') {
    return base + 'bg-gradient-to-br from-amber-300 via-yellow-400 to-amber-600 text-[#1a1305] shadow-[0_0_18px_rgba(250,204,21,0.55)] ring-2 ring-amber-200';
  }
  if (symbol === 'SCATTER') {
    return base + 'bg-gradient-to-br from-fuchsia-500 via-purple-600 to-indigo-700 text-white shadow-[0_0_16px_rgba(217,70,239,0.5)] ring-2 ring-fuchsia-300';
  }
  const suit =
    SUIT_LABEL[symbol].length > 1
      ? 'bg-gradient-to-br from-slate-50 to-slate-200'
      : RED_SUITS.has(symbol)
        ? 'bg-gradient-to-br from-rose-100 to-rose-300'
        : 'bg-gradient-to-br from-slate-100 to-slate-300';
  const ink = RED_SUITS.has(symbol) || SUIT_LABEL[symbol].length > 1 ? 'text-[#0b1020]' : 'text-[#0b1020]';
  const gold = golden
    ? ' ring-2 ring-amber-300 shadow-[0_0_14px_rgba(252,211,77,0.65)] after:content-["GOLD"]'
    : ' ring-1 ring-white/60';
  return base + suit + ' ' + ink + gold;
}

function formatMinor(n: number, currency: string, real: boolean): string {
  if (!real) return n.toLocaleString();
  const major = n / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${major.toFixed(2)} ${currency}`;
  }
}

function formatX(bp: number): string {
  return `${(bp / 10_000).toFixed(bp % 10_000 === 0 ? 0 : 2)}x`;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const handler = (e: MediaQueryListEvent): void => setReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return reduced;
}


// --- Sound: a tiny WebAudio blip generator. MUTED by default; never autoplays. ---

type Blip = 'spin' | 'cascade' | 'wild' | 'win' | 'feature';

function useSound(): { enabled: boolean; toggle: () => void; play: (b: Blip) => void } {
  const [enabled, setEnabled] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);

  const ensureCtx = useCallback((): AudioContext | null => {
    if (typeof window === 'undefined') return null;
    const w = window as unknown as { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return null;
    if (!ctxRef.current) ctxRef.current = new Ctor();
    void ctxRef.current.resume();
    return ctxRef.current;
  }, []);

  const play = useCallback(
    (b: Blip) => {
      if (!enabled) return;
      const ctx = ensureCtx();
      if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain).connect(ctx.destination);
      const now = ctx.currentTime;
      const spec: Record<Blip, { f: number; dur: number; type: OscillatorType }> = {
        spin: { f: 320, dur: 0.06, type: 'square' },
        cascade: { f: 520, dur: 0.05, type: 'triangle' },
        wild: { f: 720, dur: 0.14, type: 'sine' },
        win: { f: 880, dur: 0.18, type: 'sine' },
        feature: { f: 1040, dur: 0.3, type: 'triangle' },
      };
      const s = spec[b];
      osc.type = s.type;
      osc.frequency.setValueAtTime(s.f, now);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.08, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + s.dur);
      osc.start(now);
      osc.stop(now + s.dur + 0.02);
    },
    [enabled, ensureCtx],
  );

  return { enabled, toggle: () => setEnabled((v) => !v), play };
}

function emptyGrid(): AceCell[][] {
  return Array.from({ length: REELS }, () =>
    Array.from({ length: ROWS }, () => ({ symbol: 'SPADE' as AceSymbol, golden: false })),
  );
}


export function AceSlotGame() {
  const reduced = usePrefersReducedMotion();
  const sound = useSound();

  const [config, setConfig] = useState<AceConfigView | null>(null);
  const [history, setHistory] = useState<AceRoundView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [currency, setCurrency] = useState<string>('FP');
  const [stake, setStake] = useState<number>(1000);

  const [turbo, setTurbo] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const [round, setRound] = useState<AceRoundView | null>(null);

  // Replay cursor into the server-provided outcome.
  const [phase, setPhase] = useState<'IDLE' | 'BASE' | 'FREE_INTRO' | 'FREE'>('IDLE');
  const [baseGrid, setBaseGrid] = useState<AceCell[][]>(emptyGrid());
  const [stepIndex, setStepIndex] = useState(0);
  const [freeSpinIndex, setFreeSpinIndex] = useState(-1);
  const [displayedWin, setDisplayedWin] = useState(0);
  const [sessionStartedAt, setSessionStartedAt] = useState<number>(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  const [lastVerify, setLastVerify] = useState<Record<string, unknown> | null>(null);

  // Autoplay state (client loop over `spin`, self-enforcing its limits).
  const [autoplay, setAutoplay] = useState(false);
  const [autoSpinsLeft, setAutoSpinsLeft] = useState(0);
  const [autoNet, setAutoNet] = useState(0);
  const [autoLossLimit, setAutoLossLimit] = useState(0);
  const [autoWinLimit, setAutoWinLimit] = useState(0);

  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const runId = useRef(0);
  const doSpinRef = useRef<() => Promise<void>>(async () => {});

  const realMoney = config?.mode === 'REAL_MONEY';
  const betLevels =
    config?.betLevels[currency] ?? config?.freePlayBetLevels ?? { minStake: 1000, maxStake: 5_000_000, step: 1000 };

  // Initial load.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [cfg, hist] = await Promise.all([getAceConfig(), getAceHistory(15)]);
        if (!alive) return;
        setConfig(cfg);
        setHistory(hist);
        const firstCurrency = cfg.mode === 'REAL_MONEY' ? cfg.allowedCurrencies[0] : 'FP';
        setCurrency(firstCurrency ?? 'FP');
        const levels = cfg.betLevels[firstCurrency ?? ''] ?? cfg.freePlayBetLevels;
        setStake(levels.minStake);
      } catch (e) {
        if (alive) setError(describeApiError(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Reality-check session timer (ticks every 10s while mounted).
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - sessionStartedAt) / 1000)), 10_000);
    return () => clearInterval(id);
  }, [sessionStartedAt]);

  const clearTimers = useCallback(() => {
    for (const t of timers.current) clearTimeout(t);
    timers.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const currentSpin = useMemo(() => {
    if (phase === 'BASE') return round?.result.baseSpin ?? null;
    if (phase === 'FREE' && round && freeSpinIndex >= 0) return round.result.freeSpins[freeSpinIndex] ?? null;
    return null;
  }, [phase, round, freeSpinIndex]);

  const stopAutoplay = useCallback(() => {
    setAutoplay(false);
    setAutoSpinsLeft(0);
  }, []);

  /**
   * Replay ONE spin's cascade steps from the server outcome. Each step shows the
   * pre-computed grid, applies the golden→wild flips for the NEXT step, and
   * advances. Timings collapse to ~0 in turbo / reduced-motion. The outcome is
   * identical regardless of animation speed.
   */
  const replaySpin = useCallback(
    (spin: AceRoundResult['baseSpin'], onDone: () => void) => {
      clearTimers();
      runId.current += 1;
      const myRun = runId.current;
      const stepMs = reduced ? 0 : turbo ? 120 : 480;
      sound.play('spin');

      setBaseGrid(spin.steps[0].grid);
      setStepIndex(0);

      let elapsedMs = stepMs;
      spin.steps.forEach((step, i) => {
        const t = setTimeout(() => {
          if (runId.current !== myRun) return;
          setStepIndex(i);
          setBaseGrid(step.grid);
          if (step.removed.length > 0) sound.play('cascade');
          if (step.goldenToWild.length > 0) sound.play('wild');
        }, elapsedMs);
        timers.current.push(t);
        elapsedMs += stepMs;
      });

      const done = setTimeout(() => {
        if (runId.current !== myRun) return;
        if (spin.totalPayBp > 0) sound.play('win');
        onDone();
      }, elapsedMs + stepMs);
      timers.current.push(done);
    },
    [reduced, turbo, sound, clearTimers],
  );

  /**
   * Continue an autoplay session. Stops on: a feature trigger (base spin
   * awarded free spins), reaching the spin-count limit, or a user stop. Never
   * invents a spin — it simply re-invokes `doSpin` through a ref so there is no
   * dependency cycle between doSpin -> replayRound -> maybeAutoplayAgain.
   */
  const maybeAutoplayAgain = useCallback(
    (lastTotalPayBp: number) => {
      const triggered = (round?.result.baseSpin.freeSpinsAwarded ?? 0) > 0;
      // Loss/win limits: net is tracked in minor units across the session.
      const sessionNet = autoNet;
      if (!autoplay || triggered) {
        setAutoplay(false);
        setAutoSpinsLeft(0);
        return;
      }
      if (autoLossLimit > 0 && sessionNet <= -autoLossLimit) {
        stopAutoplay();
        return;
      }
      if (autoWinLimit > 0 && sessionNet >= autoWinLimit) {
        stopAutoplay();
        return;
      }
      const nextLeft = autoSpinsLeft - 1;
      if (nextLeft <= 0) {
        setAutoplay(false);
        setAutoSpinsLeft(0);
        return;
      }
      setAutoSpinsLeft(nextLeft);
      void lastTotalPayBp;
      const t = setTimeout(() => void doSpinRef.current(), turbo ? 150 : 600);
      timers.current.push(t);
    },
    [autoplay, autoSpinsLeft, autoNet, round, turbo, autoLossLimit, autoWinLimit, stopAutoplay],
  );

  /** Play a whole round: base spin -> (free-spin intro) -> each free spin. */
  const replayRound = useCallback(
    (r: AceRoundView) => {
      clearTimers();
      setDisplayedWin(0);
      const result = r.result;
      const playBase = (): void => {
        setPhase('BASE');
        setFreeSpinIndex(-1);
        replaySpin(result.baseSpin, () => {
          setDisplayedWin(result.baseSpin.totalPayBp);
          if (result.freeSpins.length === 0) {
            finishRound();
          } else {
            setPhase('FREE_INTRO');
            sound.play('feature');
            const intro = setTimeout(() => runFreeSpins(0), reduced ? 0 : 1600);
            timers.current.push(intro);
          }
        });
      };
      const runFreeSpins = (idx: number): void => {
        if (idx >= result.freeSpins.length) {
          finishRound();
          return;
        }
        setPhase('FREE');
        setFreeSpinIndex(idx);
        replaySpin(result.freeSpins[idx], () => {
          setDisplayedWin(
            result.freeSpins.slice(0, idx + 1).reduce((s, sp) => s + sp.totalPayBp, 0) +
              result.baseSpin.totalPayBp,
          );
          runFreeSpins(idx + 1);
        });
      };
      const finishRound = (): void => {
        setPhase('IDLE');
        setDisplayedWin(result.totalPayBp);
        setBusy(false);
        maybeAutoplayAgain(result.totalPayBp);
      };
      playBase();
    },
    [clearTimers, reduced, sound, replaySpin, maybeAutoplayAgain],
  );

  const doSpin = useCallback(async (): Promise<void> => {
    if (busy) return;
    setError(null);
    setBusy(true);
    clearTimers();
    try {
      const r = await aceSpin(stake, {
        currency: realMoney ? currency : undefined,
        turbo,
      });
      setRound(r);
      const net = (r.payout ?? 0) - r.stake;
      setAutoNet((prev) => prev + net);
      setHistory((h) => [r, ...h].slice(0, 15));
      replayRound(r);
    } catch (e) {
      setError(describeApiError(e));
      setBusy(false);
      setAutoplay(false);
      setAutoSpinsLeft(0);
    }
  }, [busy, stake, currency, realMoney, turbo, clearTimers, replayRound]);

  // Keep the ref current so autoplay can re-trigger without a dependency cycle.
  doSpinRef.current = doSpin;

  const onSpin = useCallback(() => {
    void doSpin();
  }, [doSpin]);

  const startAutoplay = useCallback(
    (spins: number, lossLimit: number, winLimit: number) => {
      // Self-enforced client limits (also submitted to the server for validation).
      void submitAceAutoplayLimits({ spinCount: spins, lossLimit, winLimit }).catch(() => {
        /* non-fatal: limits are advisory to the server */
      });
      setAutoNet(0);
      setAutoSpinsLeft(spins);
      setAutoLossLimit(lossLimit);
      setAutoWinLimit(winLimit);
      setAutoplay(true);
    },
    [],
  );

  const onVerify = useCallback(async () => {
    if (!round) return;
    try {
      setLastVerify(await verifyAce(round.id));
    } catch (e) {
      setError(describeApiError(e));
    }
  }, [round]);

  // Keyboard: Space/Enter spins when not typing in a control.
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        onSpin();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onSpin]);

  const winCells = useMemo(() => {
    const set = new Set<string>();
    if (!currentSpin) return set;
    const step = currentSpin.steps[stepIndex];
    if (!step) return set;
    for (const g of step.wins) for (const c of g.cells) set.add(`${c.reel}:${c.row}`);
    return set;
  }, [currentSpin, stepIndex]);

  const wildCells = useMemo(() => {
    const set = new Set<string>();
    if (!currentSpin) return set;
    const step = currentSpin.steps[stepIndex];
    if (!step) return set;
    for (const c of step.goldenToWild) set.add(`${c.reel}:${c.row}`);
    return set;
  }, [currentSpin, stepIndex]);

  const ladder = phase === 'FREE' ? (config?.freeSpinLadderBp ?? []) : (config?.baseLadderBp ?? []);
  const activeLadderBp = currentSpin?.steps[stepIndex]?.multiplierBp ?? 0;

  const cellSize = 'h-12 w-12 sm:h-14 sm:w-14 text-2xl sm:text-3xl';

  const renderCell = (cell: AceCell, reel: number, row: number) => {
    const key = `${reel}:${row}`;
    const isWin = winCells.has(key);
    const isWild = wildCells.has(key);
    const cls = `${symbolClasses(cell.symbol, cell.golden)} ${cellSize}`;
    return (
      <div
        key={key}
        role="img"
        aria-label={`${SUIT_NAME[cell.symbol]}${cell.golden ? ' (golden)' : ''}`}
        className={`${cls} ${isWin ? 'ring-2 ring-amber-300 scale-105' : ''} ${
          isWild ? 'animate-pulse' : ''
        } transition-transform`}
        data-testid={`ace-cell-${reel}-${row}`}
      >
        <span aria-hidden>{SUIT_LABEL[cell.symbol]}</span>
      </div>
    );
  };

  return (
    <div className="mx-auto flex min-h-[100dvh] w-full max-w-md flex-col gap-3 px-3 py-4 text-slate-100">
      {/* Header: title + REAL/FREE badge + sound + info */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-amber-300 to-amber-600 text-lg font-black text-[#1a1305]">
            A
          </div>
          <div>
            <h1 className="text-lg font-black tracking-wide text-amber-200">Royale Ace</h1>
            <p className="text-[11px] text-slate-400">5×4 · 1024 ways · Cascades</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-1 text-[11px] font-bold ${
              realMoney ? 'bg-emerald-500/20 text-emerald-300' : 'bg-sky-500/20 text-sky-300'
            }`}
            data-testid="ace-mode-badge"
          >
            {realMoney ? 'REAL' : 'FREE'}
          </span>
          <button
            type="button"
            onClick={sound.toggle}
            aria-pressed={sound.enabled}
            aria-label={sound.enabled ? 'Mute sound' : 'Unmute sound'}
            className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
          >
            {sound.enabled ? '🔊' : '🔇'}
          </button>
          <button
            type="button"
            onClick={() => setShowInfo(true)}
            className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
          >
            Info
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="rounded-lg bg-red-950/50 px-3 py-2 text-xs text-red-300">
          {error}
        </p>
      )}

      {/* Free-spin intro overlay */}
      {phase === 'FREE_INTRO' && (
        <div
          className="rounded-xl border border-fuchsia-400/40 bg-gradient-to-br from-fuchsia-600/30 to-indigo-700/30 px-4 py-6 text-center"
          data-testid="ace-free-intro"
        >
          <p className="text-2xl font-black text-fuchsia-200">Free Spins!</p>
          <p className="mt-1 text-xs text-fuchsia-100/80">
            {round?.result.freeSpinsPlayed ?? 0} spins · doubled multiplier ladder
          </p>
        </div>
      )}

      {/* Reel grid */}
      <section
        aria-label="Royale Ace reels"
        className="grid grid-cols-5 gap-1.5 rounded-2xl border border-amber-500/20 bg-gradient-to-b from-[#0b1430] to-[#070d1f] p-2 shadow-inner"
      >
        {Array.from({ length: REELS }, (_, reel) => (
          <div key={reel} className="flex flex-col gap-1.5">
            {Array.from({ length: ROWS }, (_, row) =>
              renderCell(baseGrid[reel]?.[row] ?? { symbol: 'SPADE', golden: false }, reel, row),
            )}
          </div>
        ))}
      </section>

      {/* Multiplier ladder + win readout */}
      <section className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-[#0b1430]/70 px-3 py-2">
        <div className="flex items-center gap-1" aria-label="Cascade multiplier ladder">
          {ladder.map((bp, i) => {
            const isActive = activeLadderBp >= bp && bp > 0;
            const reached = (stepIndex + 1) > i && (phase === 'BASE' || phase === 'FREE');
            return (
              <span
                key={i}
                className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${
                  reached ? 'bg-amber-400/30 text-amber-200' : 'bg-white/5 text-slate-500'
                } ${isActive ? 'ring-1 ring-amber-300' : ''}`}
              >
                {formatX(bp)}
              </span>
            );
          })}
          <span className="ml-1 text-[10px] uppercase tracking-wide text-slate-500">
            {phase === 'FREE' ? 'FS ladder' : 'ladder'}
          </span>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">
            {phase === 'FREE' ? `Free spin ${freeSpinIndex + 1}/${round?.result.freeSpinsPlayed ?? 0}` : 'Win'}
          </div>
          <div className="text-lg font-black text-amber-200" data-testid="ace-win-display">
            {formatMinor(displayedWin, realMoney ? currency : 'FP', realMoney)}
          </div>
        </div>
      </section>

      {/* Controls */}
      <section className="space-y-2">
        {/* Currency (real money only; limited to what the country allows) */}
        {realMoney && config && config.allowedCurrencies.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="ace-currency" className="text-xs text-slate-400">
              Currency
            </label>
            <select
              id="ace-currency"
              value={currency}
              onChange={(e) => {
                const c = e.target.value;
                setCurrency(c);
                const lv = config.betLevels[c] ?? config.freePlayBetLevels;
                setStake(lv.minStake);
              }}
              className="rounded-lg border border-white/10 bg-[#0b1430] px-2 py-1 text-sm text-slate-100"
            >
              {config.allowedCurrencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Stake selector (currency-limited) */}
        <div className="flex items-center justify-between gap-2">
          <label htmlFor="ace-stake" className="text-xs text-slate-400">
            Stake
          </label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label="Decrease stake"
              onClick={() => setStake((s) => Math.max(betLevels.minStake, s - betLevels.step))}
              className="h-8 w-8 rounded-lg border border-white/10 text-slate-200 hover:bg-white/10"
            >
              −
            </button>
            <input
              id="ace-stake"
              type="number"
              inputMode="numeric"
              value={stake}
              min={betLevels.minStake}
              max={betLevels.maxStake}
              step={betLevels.step}
              onChange={(e) => setStake(Number(e.target.value))}
              className="w-24 rounded-lg border border-white/10 bg-[#0b1430] px-2 py-1 text-center text-sm text-slate-100"
            />
            <button
              type="button"
              aria-label="Increase stake"
              onClick={() => setStake((s) => Math.min(betLevels.maxStake, s + betLevels.step))}
              className="h-8 w-8 rounded-lg border border-white/10 text-slate-200 hover:bg-white/10"
            >
              +
            </button>
          </div>
        </div>

        {/* Spin + turbo */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onSpin}
            disabled={busy || !config?.enabled}
            data-testid="ace-spin"
            className="flex-1 rounded-xl bg-gradient-to-br from-amber-300 to-amber-600 px-4 py-3 text-base font-black text-[#1a1305] shadow-lg transition hover:brightness-110 disabled:opacity-50"
          >
            {busy ? '…' : 'SPIN'}
          </button>
          <button
            type="button"
            onClick={() => setTurbo((v) => !v)}
            aria-pressed={turbo}
            className={`rounded-xl border px-3 py-3 text-sm font-bold ${
              turbo ? 'border-amber-300 bg-amber-400/20 text-amber-200' : 'border-white/10 text-slate-300'
            }`}
          >
            Turbo
          </button>
        </div>

        {/* Autoplay (self-enforcing limits; stops on feature trigger) */}
        <div className="flex items-center justify-between gap-2">
          {autoplay ? (
            <button
              type="button"
              onClick={stopAutoplay}
              data-testid="ace-autoplay-stop"
              className="flex-1 rounded-xl border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-sm font-bold text-rose-200"
            >
              Stop autoplay ({autoSpinsLeft} left)
            </button>
          ) : (
            <button
              type="button"
              onClick={() => startAutoplay(10, 0, 0)}
              disabled={busy || !config?.enabled}
              data-testid="ace-autoplay-start"
              className="flex-1 rounded-xl border border-white/10 px-3 py-2 text-sm font-bold text-slate-200 hover:bg-white/10 disabled:opacity-50"
            >
              Autoplay 10 (stops on feature)
            </button>
          )}
        </div>
        <p className="text-[10px] leading-relaxed text-slate-500">
          Session {Math.floor(elapsed / 60)}m {elapsed % 60}s · Autoplay stops automatically on a free-spin
          trigger or when a limit is reached. Play responsibly.
        </p>
      </section>

      {/* Info modal */}
      {showInfo && config && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Royale Ace information"
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowInfo(false);
          }}
        >
          <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-white/10 bg-[#0a1024] p-4 text-slate-200 sm:rounded-2xl">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-black text-amber-200">Royale Ace — rules &amp; fairness</h2>
              <button
                type="button"
                onClick={() => setShowInfo(false)}
                aria-label="Close info"
                className="rounded-lg border border-white/10 px-2 py-1 text-xs text-slate-300 hover:bg-white/10"
              >
                Close
              </button>
            </div>

            <div className="mt-3 space-y-3 text-xs leading-relaxed">
              <div>
                <p className="font-bold text-slate-100">How it works</p>
                <p className="text-slate-400">
                  {config.reels} reels × {config.rows} rows, {config.ways} ways to win. Wins pay left-to-right on
                  adjacent reels for the same symbol (Wild substitutes for all card symbols, never Scatter).
                  Winning symbols clear, survivors drop and new cards fall in — each consecutive cascade raises
                  the multiplier.
                </p>
              </div>

              <div>
                <p className="font-bold text-slate-100">Multiplier ladder</p>
                <p className="text-slate-400">
                  Base:{' '}
                  {config.baseLadderBp.map((bp) => formatX(bp)).join(' → ')} · Free spins (doubled):{' '}
                  {config.freeSpinLadderBp.map((bp) => formatX(bp)).join(' → ')}
                </p>
              </div>

              <div>
                <p className="font-bold text-slate-100">Scatter &amp; Free Spins</p>
                <p className="text-slate-400">
                  3+ Scatters anywhere trigger Free Spins (3 → {config.freeSpins.awardByScatterCount[3]}, +2 per
                  extra). Retriggers allowed. One stake is debited; all free-spin wins credit at the end of the
                  round.
                </p>
              </div>

              <div>
                <p className="font-bold text-slate-100">Paytable (per way, × stake)</p>
                <div className="mt-1 grid grid-cols-4 gap-1 text-[11px]">
                  <span className="text-slate-500">Symbol</span>
                  <span className="text-slate-500">3</span>
                  <span className="text-slate-500">4</span>
                  <span className="text-slate-500">5</span>
                  {Object.entries(config.paytableBp).map(([sym, row]) => (
                    <Fragment key={sym}>
                      <span className="font-semibold text-slate-200">{SUIT_NAME[sym as AceSymbol]}</span>
                      <span className="text-slate-400">{(row[2] / 10_000).toFixed(2)}×</span>
                      <span className="text-slate-400">{(row[3] / 10_000).toFixed(2)}×</span>
                      <span className="text-slate-400">{(row[4] / 10_000).toFixed(2)}×</span>
                    </Fragment>
                  ))}
                </div>
              </div>

              <div>
                <p className="font-bold text-slate-100">Math profile</p>
                <p className="text-slate-400">
                  Target RTP {(config.targetRtpBp / 100).toFixed(2)}% · Volatility {config.volatilityLabel} · Max
                  win {formatX(config.maxWinBp)} of stake. All values are configuration and shown for
                  transparency — no hidden odds, no near-miss effects.
                </p>
              </div>

              <div>
                <p className="font-bold text-slate-100">Provable fairness</p>
                <p className="text-slate-400">
                  Every round is committed to before play (SHA-256 of a server seed) and revealed at settlement.
                  You can re-derive the entire round from the revealed seeds + the config version.
                </p>
                {round && (
                  <button
                    type="button"
                    onClick={() => void onVerify()}
                    data-testid="ace-verify"
                    className="mt-2 rounded-lg border border-amber-300/40 bg-amber-400/10 px-3 py-1.5 text-xs font-bold text-amber-200"
                  >
                    Verify last spin
                  </button>
                )}
                {lastVerify && (
                  <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-black/40 p-2 text-[10px] text-emerald-200">
                    {JSON.stringify(lastVerify, null, 2)}
                  </pre>
                )}
              </div>

              <div>
                <p className="font-bold text-slate-100">Play responsibly</p>
                <p className="text-slate-400">
                  This is a game of chance. Set limits, take breaks, and never bet more than you can afford to
                  lose. Self-exclusion and deposit limits are available in your account.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

