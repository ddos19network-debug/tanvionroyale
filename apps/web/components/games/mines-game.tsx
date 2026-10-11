'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@tanvion-royale/ui';
import { describeApiError } from '@/lib/api/client';
import { formatBp } from '@/lib/api/royale';
import {
  cashoutMines,
  forfeitMines,
  getActiveMinesRound,
  getMinesHistory,
  getRoyaleConfig,
  revealMinesTile,
  startMinesRound,
  type RoyaleConfigView,
  type RoyaleMinesRoundView,
} from '@/lib/api/royale';

/**
 * TANVION ROYALE — original Mines (Royale Play).
 *
 * The mine positions live ONLY on the server (AES-256-GCM encrypted at rest).
 * This UI reveals tiles one at a time, replays the authoritative safe tiles the
 * server returned, and NEVER guesses or shows a hidden mine while the round is
 * ACTIVE. Mine positions are drawn only after the server publishes them at
 * settlement (CASHED_OUT / BUSTED). On reconnect it re-fetches /mines/active.
 */

const GRID_COLUMNS = 5;

type TileState = 'hidden' | 'safe' | 'mine' | 'missed';

function tileState(
  round: RoyaleMinesRoundView | null,
  index: number,
): TileState {
  if (!round) return 'hidden';
  if (round.revealed.includes(index)) return 'safe';
  if (round.minesRevealed?.includes(index)) {
    // Settled and NOT a safe pick → it was a mine (bust) or an unmined tile.
    return round.status === 'BUSTED' ? 'mine' : 'missed';
  }
  return 'hidden';
}

export function MinesGame() {
  const [config, setConfig] = useState<RoyaleConfigView | null>(null);
  const [round, setRound] = useState<RoyaleMinesRoundView | null>(null);
  const [gridSize, setGridSize] = useState(25);
  const [minesCount, setMinesCount] = useState(3);
  const [stake, setStake] = useState(1000);
  const [history, setHistory] = useState<RoyaleMinesRoundView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Initial load: config + history + recover any ACTIVE round (reconnect/restart).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [cfg, hist, active] = await Promise.all([
          getRoyaleConfig(),
          getMinesHistory(15),
          getActiveMinesRound(),
        ]);
        if (!alive) return;
        setConfig(cfg);
        setStake(cfg.minStake);
        setHistory(hist);
        if (active) setRound(active);
      } catch (e) {
        if (alive) setError(describeApiError(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const realMoney = config?.mode === 'REAL_MONEY';
  const unit = realMoney ? (config?.currency ?? '') : 'pts';
  const formatMinor = (n: number) =>
    realMoney ? (n / 100).toFixed(2) : n.toLocaleString();

  const gridOptions = config?.mines.grids ?? [25];
  const effectiveMaxMines = Math.min(config?.mines.maxMines ?? 24, gridSize - 1);

  const onStart = useCallback(async () => {
    if (!config || busy) return;
    setError(null);
    setStatus(null);
    setBusy(true);
    try {
      const next = await startMinesRound(stake, gridSize, minesCount);
      setRound(next);
    } catch (e) {
      setError(describeApiError(e));
    } finally {
      setBusy(false);
    }
  }, [config, busy, stake, gridSize, minesCount]);

  const onReveal = useCallback(
    async (tile: number) => {
      if (!round || busy || round.status !== 'ACTIVE') return;
      if (round.revealed.includes(tile)) return;
      setError(null);
      setBusy(true);
      try {
        const result = await revealMinesTile(round.id, tile);
        setRound(result.round);
        if (result.round.status === 'BUSTED') {
          setStatus('Boom — you hit a mine. Round over.');
        } else if (result.round.status === 'VOIDED') {
          setStatus('This round was voided and your stake was returned.');
        }
      } catch (e) {
        setError(describeApiError(e));
      } finally {
        setBusy(false);
      }
    },
    [round, busy],
  );

  const onCashout = useCallback(async () => {
    if (!round || busy || round.status !== 'ACTIVE') return;
    setError(null);
    setBusy(true);
    try {
      const result = await cashoutMines(round.id);
      setRound(result.round);
      setStatus(
        `Cashed out at ${formatBp(result.round.currentMultiplierBp)} — ${formatMinor(
          result.round.payout,
        )} ${unit}`,
      );
      setHistory((h) => [result.round, ...h].slice(0, 15));
    } catch (e) {
      setError(describeApiError(e));
    } finally {
      setBusy(false);
    }
  }, [round, busy, unit]);

  const onForfeit = useCallback(async () => {
    if (!round || busy || round.status !== 'ACTIVE') return;
    setError(null);
    setBusy(true);
    try {
      const result = await forfeitMines(round.id);
      setRound(result.round);
      setStatus('Round forfeited.');
      setHistory((h) => [result.round, ...h].slice(0, 15));
    } catch (e) {
      setError(describeApiError(e));
    } finally {
      setBusy(false);
    }
  }, [round, busy]);

  const active = round?.status === 'ACTIVE';
  const settled = round && !active;
  const gridColumns = Math.round(Math.sqrt(gridSize));

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

      {error ? (
        <p
          className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {status ? (
        <p
          className="rounded-lg border border-sky-500/30 bg-sky-500/10 px-4 py-3 text-sm text-sky-300"
          role="status"
        >
          {status}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-white">Mines</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Board — safe tiles are the server-authoritative reveals; mines appear
              ONLY after the server publishes them at settlement. */}
          <div
            className="mx-auto grid w-full max-w-sm gap-2"
            style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}
          >
            {Array.from({ length: gridSize }, (_, index) => {
              const state = tileState(round, index);
              const revealed = round?.revealed.includes(index) ?? false;
              const canReveal = active && !revealed && !busy;
              return (
                <button
                  key={index}
                  type="button"
                  disabled={!canReveal}
                  onClick={() => onReveal(index)}
                  aria-label={`Tile ${index + 1}`}
                  className={`flex aspect-square items-center justify-center rounded-lg text-lg font-bold transition ${
                    state === 'safe'
                      ? 'bg-gradient-to-b from-emerald-500 to-emerald-600 text-white shadow-[0_0_10px_rgba(16,185,129,0.5)]'
                      : state === 'mine'
                        ? 'bg-gradient-to-b from-red-500 to-red-600 text-white'
                        : state === 'missed'
                          ? 'border border-white/10 bg-ink-900 text-slate-600'
                          : canReveal
                            ? 'border border-white/10 bg-ink-800 text-slate-400 hover:bg-white/5'
                            : 'border border-white/10 bg-ink-900 text-slate-600'
                  }`}
                >
                  {state === 'safe'
                    ? '💎'
                    : state === 'mine'
                      ? '💥'
                      : state === 'missed'
                        ? '·'
                        : ''}
                </button>
              );
            })}
          </div>
          {/* Live progression — all values are server-authoritative. */}
          {round ? (
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 rounded-lg border border-white/10 bg-ink-900 px-4 py-3 text-sm">
              <span className="text-slate-400">
                Safe picks: <span className="font-bold text-white">{round.safeCount}</span>
              </span>
              <span className="text-slate-400">
                Multiplier:{' '}
                <span className="font-bold text-white">{formatBp(round.currentMultiplierBp)}</span>
              </span>
              <span className="text-slate-400">
                Potential payout:{' '}
                <span className="font-bold text-emerald-300">
                  {formatMinor(round.potentialPayout)} {unit}
                </span>
              </span>
            </div>
          ) : null}

          {/* Controls — only offered when there is no ACTIVE round. */}
          {!active ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="text-sm text-slate-300">
                <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Grid</span>
                <select
                  value={gridSize}
                  onChange={(e) => setGridSize(Number(e.target.value))}
                  className="w-full rounded-md border border-white/10 bg-ink-900 px-2 py-1.5 text-sm text-white"
                >
                  {gridOptions.map((g) => (
                    <option key={g} value={g}>
                      {g} tiles
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm text-slate-300">
                <span className="mb-1 block text-xs uppercase tracking-wide text-slate-500">Mines</span>
                <input
                  type="number"
                  value={minesCount}
                  min={config?.mines.minMines ?? 1}
                  max={effectiveMaxMines}
                  onChange={(e) => setMinesCount(Number(e.target.value))}
                  className="w-full rounded-md border border-white/10 bg-ink-900 px-2 py-1.5 text-sm text-white tabular-nums"
                />
              </label>
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
          ) : null}

          {/* Action buttons */}
          <div className="flex flex-wrap justify-center gap-2">
            {active ? (
              <>
                <Button loading={busy} onClick={onCashout} disabled={round?.safeCount === 0}>
                  Cash out {formatMinor(round?.potentialPayout ?? 0)} {unit}
                </Button>
                <Button variant="ghost" loading={busy} onClick={onForfeit}>
                  Forfeit
                </Button>
              </>
            ) : (
              <Button loading={busy} onClick={onStart} className="min-w-48">
                {settled ? 'Play again' : 'Start game'}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-white">Recent rounds</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <p className="text-sm text-slate-400">No rounds yet — start a game above.</p>
          ) : (
            <ul className="divide-y divide-white/5">
              {history.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-slate-300">
                    {r.gridSize} tiles · {r.minesCount} mines ·{' '}
                    {r.status === 'BUSTED' ? 'bust' : r.status === 'VOIDED' ? 'void' : 'cash out'}
                  </span>
                  <span className="font-mono text-xs text-slate-500">
                    {formatBp(r.currentMultiplierBp)}
                  </span>
                  <span
                    className={`font-bold ${
                      r.status === 'BUSTED'
                        ? 'text-red-300'
                        : r.payout >= r.stake
                          ? 'text-emerald-300'
                          : 'text-slate-300'
                    }`}
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

