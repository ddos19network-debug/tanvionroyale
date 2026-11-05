'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@tanvion-royale/ui';
import { listMyGameResults, type GameResultItem } from '@/lib/api/profile';
import { getCrashMyHistory } from '@/lib/api/crash';
import { ApiClientError } from '@/lib/api/client';
import { formatMoney } from '@/lib/betting';
import { PAGE_SIZE, StatusBadge, fmtDate, shortId } from './profile-helpers';
import { EmptyState, ErrorBox, LoadMore, LoadingRows, SearchBar } from './profile-ui';
import { Button } from '@tanvion-royale/ui';

interface CrashRow {
  roundNumber: number;
  createdAt: string;
  stake: number;
  currency: string;
  status: string;
  result: string | null;
  cashoutMultiplier: number | null;
  payout: number;
}

export function GamesTab() {
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [items, setItems] = useState<GameResultItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [crash, setCrash] = useState<CrashRow[] | null>(null);

  const load = useCallback(async (p: number, append: boolean) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await listMyGameResults({ limit: PAGE_SIZE, page: p, search: applied || undefined });
      setItems((prev) => (append ? [...prev, ...res.items] : res.items));
      setHasMore(res.items.length === PAGE_SIZE);
      setPage(p);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to load games history.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [applied]);

  useEffect(() => { void load(1, false); }, [load]);

  useEffect(() => {
    let cancelled = false;
    getCrashMyHistory(20)
      .then((r) => { if (!cancelled) setCrash((r.history ?? []) as unknown as CrashRow[]); })
      .catch(() => { if (!cancelled) setCrash([]); });
    return () => { cancelled = true; };
  }, []);

  // FREEPLAY rounds are points, never money — display them honestly as "pts".
  const money = (amount: number, currency: string): string =>
    currency === 'FREEPLAY' ? `${amount.toLocaleString('en-GB')} pts` : formatMoney(amount, currency);

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          aria-label="Search games"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') setApplied(search.trim()); }}
          placeholder="Search game, e.g. coin-flip"
          className="w-full rounded-md border border-ink-600 px-3 py-2 text-sm"
        />
        <Button size="sm" variant="outline" onClick={() => setApplied(search.trim())}>Search</Button>
      </div>
      {loading ? <LoadingRows />
        : error ? <div className="mt-4"><ErrorBox message={error} onRetry={() => load(1, false)} /></div>
        : items.length === 0 && (!crash || crash.length === 0) ? (
          <div className="mt-4"><EmptyState title="No games played yet." hint="Free-play results and Royale Fly rounds will appear here." actionHref="/games/play" actionLabel="Browse Games" /></div>
        ) : (
          <div className="mt-4 space-y-2">
            {crash?.map((c, i) => (
              <Card key={`crash-${c.roundNumber}-${c.createdAt}-${i}`}>
                <CardContent className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Royale Fly · Round {c.roundNumber}</p>
                    <p className="text-xs text-slate-500">
                      {fmtDate(c.createdAt)} · Stake {money(c.stake, c.currency)}{c.cashoutMultiplier != null ? ` · Cash out ${c.cashoutMultiplier}x` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge value={c.result ?? c.status} />
                    <span className="text-sm font-semibold">{c.payout > 0 ? money(c.payout, c.currency) : '—'}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
            {items.map((g) => (
              <Card key={g.id}>
                <CardContent className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{g.gameSlug}</p>
                    <p className="text-xs text-slate-500">{fmtDate(g.createdAt)} · Score {g.score}{g.message ? ` · ${g.message}` : ''}</p>
                    <p className="mt-1 text-xs text-slate-400"><span className="break-anywhere">Session {shortId(g.id)}</span></p>
                  </div>
                  <StatusBadge value={g.outcome} />
                </CardContent>
              </Card>
            ))}
            <LoadMore visible={hasMore} loading={loadingMore} onLoad={() => load(page + 1, true)} />
          </div>
        )}
    </div>
  );
}
