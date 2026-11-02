'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@tanvion-royale/ui';
import { describeApiError } from '@/lib/api/client';
import { getFreePlayPoints, type FreePlayPointsView } from '@/lib/api/games';
import {
  dropPlinko,
  formatBp,
  getPlinkoHistory,
  getPlinkoPayoutTable,
  getRoyaleConfig,
  type PlinkoPayoutTableView,
  type PlinkoRisk,
  type RoyaleConfigView,
  type RoyalePlinkoRoundView,
} from '@/lib/api/royale';

/**
 * TANVION ROYALE — original Plinko (Royale Play).
 *
 * The outcome is ALWAYS server-authoritative: one POST /plinko/drop returns the
 * full, already-settled round (path, bin, multiplier, payout, seeds). The ball
 * animation here simply REPLAYS the server path the server already committed —
 * it never invents a result, never predicts a bin, and never changes the
 * payout. If the animation is skipped the outcome is identical.
 */

const RISK_OPTIONS: PlinkoRisk[] = ['LOW', 'MEDIUM', 'HIGH'];

/** Peg row geometry: n rows → n+1 bins; row i has i+1 pegs. */
function binCount(rows: number): number {
  return rows + 1;
}

/** Color intensity for a bin from its payout multiplier. */
function binHeat(multBp: number, maxBp: number): string {
  const t = maxBp > 0 ? multBp / maxBp : 0;
  if (t >= 0.75) return 'from-amber-400 to-orange-500 text-slate-900';
  if (t >= 0.45) return 'from-violet-500 to-fuchsia-500 text-white';
  if (t >= 0.2) return 'from-sky-500 to-indigo-500 text-white';
  return 'from-slate-600 to-slate-700 text-slate-200';
}

export function PlinkoGame() {
  const [config, setConfig] = useState<RoyaleConfigView | null>(null);
  const [rows, setRows] = useState(12);
  const [risk, setRisk] = useState<PlinkoRisk>('MEDIUM');
  const [stake, setStake] = useState(1000);
  const [table, setTable] = useState<PlinkoPayoutTableView | null>(null);
  const [history, setHistory] = useState<RoyalePlinkoRoundView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* Free-play points: server ledger only, refreshed after each settled drop. */
  const [freePlay, setFreePlay] = useState<FreePlayPointsView | null>(null);
  const [pointsError, setPointsError] = useState<string | null>(null);
  const refreshPoints = useCallback(async (): Promise<void> => {
    try {
      const view = await getFreePlayPoints();
      setFreePlay(view);
      setPointsError(null);
    } catch (e) {
      setFreePlay(null);
      setPointsError(describeApiError(e));
    }
  }, []);

  // The authoritative last round + its live replay position.
  const [lastRound, setLastRound] = useState<RoyalePlinkoRoundView | null>(null);
  const [animRow, setAnimRow] = useState(0);
  const [animBin, setAnimBin] = useState(0);
  const [animating, setAnimating] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [cfg, hist] = await Promise.all([getRoyaleConfig(), getPlinkoHistory(15)]);
        if (!alive) return;
        setConfig(cfg);
        setStake(cfg.minStake);
        setRows(Math.min(16, Math.max(8, cfg.plinko.maxRows)));
        setHistory(hist);
        if (cfg.mode !== 'REAL_MONEY') void refreshPoints();
      } catch (e) {
        if (alive) setError(describeApiError(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [refreshPoints]);

  // Load the validated payout table whenever the board changes.
  useEffect(() => {
    if (!config) return;
    let alive = true;
    (async () => {
      try {
        const t = await getPlinkoPayoutTable(rows, risk);
        if (alive) setTable(t);
      } catch (e) {
        if (alive) setError(describeApiError(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [rows, risk, config]);

  const clearTimers = useCallback(() => {
    for (const t of timersRef.current) clearTimeout(t);
    timersRef.current = [];
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const realMoneyEarly = config?.mode === 'REAL_MONEY';

  const maxBp = useMemo(
    () => (table?.multipliersBp ?? []).reduce((m, v) => Math.max(m, v), 0),
    [table?.multipliersBp],
  );

  /** Replay the SERVER path one step per row (presentation only). */
  const playAnimation = useCallback(
    (round: RoyalePlinkoRoundView) => {
      clearTimers();
      setAnimating(true);
      setAnimRow(0);
      setAnimBin(round.rows > 0 ? 0 : 0);
      let bin = 0;
      round.path.forEach((bit, i) => {
        const step = setTimeout(
          () => {
            bin += bit;
            setAnimRow(i + 1);
            setAnimBin(bin);
            if (i === round.path.length - 1) {
              setTimeout(() => setAnimating(false), 350);
            }
          },
          90 * (i + 1),
        );
        timersRef.current.push(step);
      });
      if (round.path.length === 0) {
        setAnimating(false);
      }
    },
    [clearTimers],
  );

  const onDrop = useCallback(async () => {
    if (!config || busy) return;
    setError(null);
    setBusy(true);
    try {
      const round = await dropPlinko(stake, rows, risk);
      setLastRound(round);
      playAnimation(round);
      setHistory((h) => [round, ...h].slice(0, 15));
      if (!realMoneyEarly) void refreshPoints();
      else window.dispatchEvent(new CustomEvent('app:wallet-changed'));
    } catch (e) {
      setError(describeApiError(e));
    } finally {
      setBusy(false);
    }
  }, [config, busy, stake, rows, risk, playAnimation, realMoneyEarly, refreshPoints]);

  /** Ball position (0..1 horizontally) for the CURRENT replay step. */
  const ballX = useMemo(() => {
    const row = Math.max(1, animRow);
    return (animBin + 0.5) / (row + 1);
  }, [animRow, animBin]);

  const activeBins = table?.multipliersBp ?? new Array(binCount(rows)).fill(10_000);
  const maxActiveBp = activeBins.reduce((m, v) => Math.max(m, v), 0);
  const landedBin = lastRound && !animating ? lastRound.binIndex : null;
  const realMoney = config?.mode === 'REAL_MONEY';
  const isFreePlay = !realMoney;

  const formatMinor = (n: number) => (realMoney ? (n / 100).toFixed(2) : n.toLocaleString());
  const unit = realMoney ? (config?.currency ?? '') : 'pts';

  return (
    <div className="space-y-4">
      {config ? (
        realMoney ? (
          <div
            className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300"
            role="note"
          >
            <span className="font-bold uppercase tracking-wide">Real money</span> — stakes and
            payouts settle through your TANVION ROYALE wallet. Provably fair:{' '}
            <span className="font-mono">{config.algorithmVersion}</span>.
          </div>
        ) : (
          <div
            className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"
            role="note"
          >
            <span className="font-bold uppercase tracking-wide">Fun mode</span> — free-play points
            only. No real money and no wallet movement.
          </div>
        )
      ) : null}

      {config && isFreePlay ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
          <p className="text-xs font-bold uppercase tracking-wide text-emerald-300">
            Free Play · {freePlay && !pointsError ? `${freePlay.points.toLocaleString()} pts` : pointsError ? 'Unavailable' : '…'}
          </p>
          <span className="text-[10px] text-emerald-300/80">practice only — no cash value</span>
        </div>
      ) : null}
      {pointsError && isFreePlay ? (
        <p
          role="alert"
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-xs text-red-300"
        >
          Could not load free-play points: {pointsError}
        </p>
      ) : null}
      {error ? (
        <p
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-white">Plinko</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Board */}
          <div className="relative overflow-hidden rounded-xl border border-white/10 bg-[#0a1626] p-3">
            <div className="relative mx-auto aspect-[3/4] w-full max-w-sm">
              {Array.from({ length: rows }, (_, rowIdx) => (
                <div key={rowIdx} className="absolute inset-x-0" style={{ top: `${(rowIdx / rows) * 84}%` }}>
                  {Array.from({ length: rowIdx + 1 }, (_, pegIdx) => {
                    const x = (pegIdx + 0.5) / (rowIdx + 1);
                    return (
                      <span
                        key={pegIdx}
                        className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-500/70"
                        style={{ left: `${x * 100}%` }}
                      />
                    );
                  })}
                </div>
              ))}

              {lastRound ? (
                <span
                  className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-to-b from-amber-300 to-orange-500 shadow-[0_0_12px_rgba(251,191,36,0.8)] transition-all duration-100 ease-out"
                  style={{
                    left: `${(animating ? ballX : (lastRound.binIndex + 0.5) / binCount(rows)) * 100}%`,
                    top: `${animating ? (animRow / rows) * 84 : 84}%`,
                  }}
                  aria-hidden
                />
              ) : null}

              <div className="absolute inset-x-0 flex items-end gap-[2px]" style={{ top: '86%' }}>
                {activeBins.map((bp, bin) => (
                  <div key={bin} className="flex flex-1 flex-col items-center gap-1">
                    <span
                      className={`w-full rounded-md bg-gradient-to-b py-1 text-center text-[10px] font-bold tabular-nums ${binHeat(bp, maxActiveBp)} ${
                        landedBin === bin ? 'ring-2 ring-white' : ''
                      }`}
                    >
                      {(bp / 10_000).toFixed(1)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {/* Controls */}
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm text-slate-300">
              <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Rows</span>
              <input
                type="range"
                min={config?.plinko.minRows ?? 8}
                max={config?.plinko.maxRows ?? 16}
                value={rows}
                onChange={(e) => setRows(Number(e.target.value))}
                className="w-full accent-brand"
              />
              <span className="text-xs text-slate-400">{rows}</span>
            </label>
            <div className="text-sm text-slate-300">
              <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Risk</span>
              <div className="flex gap-1">
                {RISK_OPTIONS.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRisk(r)}
                    aria-pressed={risk === r}
                    className={`flex-1 rounded-md px-2 py-1.5 text-xs font-semibold transition ${
                      risk === r
                        ? 'bg-brand text-ink-950'
                        : 'border border-white/10 bg-ink-800 text-slate-300 hover:bg-white/5'
                    }`}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
            <label className="text-sm text-slate-300">
              <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">
                Stake ({unit})
              </span>
              <input
                type="number"
                value={stake}
                min={config?.minStake ?? 1}
                max={config?.maxStake ?? 1_000_000}
                onChange={(e) => setStake(Number(e.target.value))}
                className="w-full rounded-md border border-white/10 bg-ink-900 px-2 py-1.5 text-sm text-white tabular-nums"
              />
            </label>
          </div>

          <div className="flex justify-center">
            <Button loading={busy} onClick={onDrop} className="min-w-48">
              Drop ball
            </Button>
          </div>

          {lastRound ? (
            <div
              className={`rounded-lg border px-4 py-3 text-sm ${
                lastRound.payout > lastRound.stake
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : lastRound.payout > 0
                    ? 'border-sky-500/30 bg-sky-500/10 text-sky-300'
                    : 'border-red-500/30 bg-red-500/10 text-red-300'
              }`}
              role="status"
            >
              Landed in bin <span className="font-bold">{lastRound.binIndex}</span> at{' '}
              <span className="font-bold">{formatBp(lastRound.multiplierBp)}</span> — payout{' '}
              <span className="font-bold">
                {formatMinor(lastRound.payout)} {unit}
              </span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-white">Recent drops</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-slate-400">No drops yet — drop the ball above.</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {history.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-slate-300">
                    {r.rows} rows · {r.risk} · bin {r.binIndex}
                  </span>
                  <span className="font-mono text-xs text-slate-500">{formatBp(r.multiplierBp)}</span>
                  <span
                    className={`font-bold ${r.payout >= r.stake ? 'text-emerald-300' : 'text-red-300'}`}
                  >
                    {formatMinor(r.payout)} {unit}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

