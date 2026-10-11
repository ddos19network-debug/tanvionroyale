'use client';

import type { FreePlayResultView } from '@/lib/api/games';

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

/** Small shared inbox for a finished free-play round. */
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