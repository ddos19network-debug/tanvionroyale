'use client';

import { useCallback, useEffect, useState } from 'react';
import { describeApiError } from '@/lib/api/client';
import {
  getFreePlayPoints,
  type FreePlayPointsView,
  type FreePlayResultView,
} from '@/lib/api/games';

/** Clearly labelled free-play disclaimer. Never shown as real-money gambling. */
export function FreePlayBanner() {
  return (
    <div
      className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300"
      role="note"
    >
      <span className="font-bold uppercase tracking-wide">Free play only</span> — no real
      money, no wallet movement, no odds. Points earned here are practice points
      only and can never be withdrawn or exchanged.
    </div>
  );
}

/**
 * Shared free-play points hook — the ONE read path for demo points.
 *
 * Points live in the server `CrashFreePlayWallet` ledger (FREEPLAY currency,
 * no cash value) and are only ever set from GET /games/crash/free-play/points.
 * Never mutated client-side; failures surface as an explicit error, never zero.
 */
export function useFreePlayPoints(enabled: boolean): {
  points: FreePlayPointsView | null;
  pointsError: string | null;
  pointsLoading: boolean;
  refreshPoints: () => Promise<void>;
} {
  const [points, setPoints] = useState<FreePlayPointsView | null>(null);
  const [pointsError, setPointsError] = useState<string | null>(null);
  const [pointsLoading, setPointsLoading] = useState(false);

  const refreshPoints = useCallback(async (): Promise<void> => {
    setPointsLoading(true);
    try {
      const view = await getFreePlayPoints();
      setPoints(view);
      setPointsError(null);
    } catch (e) {
      setPoints(null);
      setPointsError(describeApiError(e));
    } finally {
      setPointsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void (async () => {
      setPointsLoading(true);
      try {
        const view = await getFreePlayPoints();
        if (alive) {
          setPoints(view);
          setPointsError(null);
        }
      } catch (e) {
        if (alive) {
          setPoints(null);
          setPointsError(describeApiError(e));
        }
      } finally {
        if (alive) setPointsLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled]);

  return { points, pointsError, pointsLoading, refreshPoints };
}

/** Compact points chip used by every free-play game header (never money). */
export function FreePlayPointsChip({
  points,
  pointsError,
  pointsLoading,
  testId = 'freeplay-points-chip',
}: {
  points: FreePlayPointsView | null;
  pointsError: string | null;
  pointsLoading: boolean;
  testId?: string;
}): JSX.Element {
  return (
    <span
      className="flex items-center gap-1 rounded-full bg-ink-900 px-2 py-1 text-[10px] font-bold text-emerald-300"
      data-testid={testId}
      title="Free-play points (practice only — no cash value)"
    >
      <span className="uppercase tracking-wide text-slate-400">Pts</span>
      {pointsLoading ? '…' : pointsError || !points ? '—' : points.points.toLocaleString()}
    </span>
  );
}

export function FreePlayInbox({
  message,
  score,
}: {
  message: string | null;
  score: number;
}) {
  if (!message) return null;
  const win = score > 0;
  return (
    <div
      className={`rounded-lg border px-4 py-3 text-sm ${
        win
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
          : 'border-red-500/30 bg-red-500/10 text-red-300'
      }`}
      role="status"
    >
      {message}
      <span className="ml-2 font-bold">{win ? `+${score} pts` : '0 pts'}</span>
    </div>
  );
}

/** Recent free-play results for this game (server-persisted). */
export function FreePlayResults({ results }: { results: FreePlayResultView[] | null }) {
  if (!results) return null;
  if (results.length === 0) {
    return <p className="text-sm text-slate-400">No rounds played yet — start a round above.</p>;
  }
  return (
    <ul className="divide-y divide-white/5">
      {results.slice(0, 8).map((r) => (
        <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
          <div className="min-w-0">
            <p className={`truncate ${r.score > 0 ? 'text-emerald-300' : 'text-slate-300'}`}>
              {r.outcome === 'WIN' ? 'Win' : 'Loss'}
            </p>
            {r.message ? (
              <p className="truncate text-xs text-slate-500">{r.message}</p>
            ) : null}
          </div>
          <span className="shrink-0 font-mono text-xs text-slate-400">
            {new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span className="shrink-0 font-bold text-slate-200">{r.score} pts</span>
        </li>
      ))}
    </ul>
  );
}