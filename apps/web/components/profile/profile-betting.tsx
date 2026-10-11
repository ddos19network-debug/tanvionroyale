'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardContent } from '@tanvion-royale/ui';
import { listMyBets } from '@/lib/api/betting';
import { ApiClientError } from '@/lib/api/client';
import { formatMoney } from '@/lib/betting';
import type { BetView } from '@tanvion-royale/types';
import { PAGE_SIZE, StatusBadge, copyText, fmtDate, shortId } from './profile-helpers';
import { EmptyState, ErrorBox, LoadMore, LoadingRows, SearchBar } from './profile-ui';

const BET_STATUSES = ['ALL', 'PENDING', 'ACCEPTED', 'SETTLED', 'CANCELLED', 'REJECTED'] as const;

export function BettingTab() {
  const [status, setStatus] = useState<(typeof BET_STATUSES)[number]>('ALL');
  const [result, setResult] = useState<'ALL' | 'WIN' | 'LOSS' | 'VOID'>('ALL');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [items, setItems] = useState<BetView[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: number, append: boolean) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await listMyBets({ status, result, limit: PAGE_SIZE, page: p, search: applied || undefined });
      setItems((prev) => (append ? [...prev, ...res] : res));
      setHasMore(res.length === PAGE_SIZE);
      setPage(p);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to load betting history.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [status, result, applied]);

  useEffect(() => { void load(1, false); }, [load]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Bet status filter">
          {BET_STATUSES.map((s) => (
            <button key={s} onClick={() => setStatus(s)} aria-pressed={status === s} className={`rounded-full px-3 py-1.5 text-xs font-medium ${status === s ? 'bg-indigo-600 text-white' : 'bg-ink-700 text-slate-300 hover:bg-white/15'}`}>
              {s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <select aria-label="Result filter" value={result} onChange={(e) => setResult(e.target.value as typeof result)} className="rounded-full border border-ink-600 px-3 py-1.5 text-sm">
          {['ALL', 'WIN', 'LOSS', 'VOID'].map((r) => <option key={r} value={r}>{r === 'ALL' ? 'All results' : r}</option>)}
        </select>
      </div>
      <SearchBar search={search} onSearch={setSearch} onApply={() => setApplied(search.trim())} label="Search bets" placeholder="Search ID, event, selection…" />
      {loading ? <LoadingRows />
        : error ? <div className="mt-4"><ErrorBox message={error} onRetry={() => load(1, false)} /></div>
        : items.length === 0 ? <div className="mt-4"><EmptyState title="No betting activity yet." hint="Your placed sports bets will appear here." actionHref="/sports" actionLabel="Explore Sports" /></div>
        : (
          <div className="mt-4 space-y-2">
            {items.map((bet) => (
              <Link key={bet.id} href={`/my-bets/${bet.id}`} className="block">
                <Card className="transition hover:shadow-md">
                  <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {bet.selections.length > 1 ? `${bet.selections.length}-fold · ${bet.selections[0]?.selectionName}` : (bet.selections[0]?.selectionName ?? 'Bet')}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {bet.selections[0]?.eventName} · {bet.selections[0]?.marketName} · Odds {bet.selections[0]?.priceAtPlacement ?? '—'} · {fmtDate(bet.createdAt)}
                      </p>
                      <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
                        <span className="break-anywhere">Bet {shortId(bet.id)}</span>
                        <button type="button" aria-label={`Copy bet id ${bet.id}`} onClick={(e) => { e.preventDefault(); copyText(bet.id); }} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] hover:bg-white/10">
                          Copy
                        </button>
                      </p>
                    </div>
                    <div className="flex items-center gap-3 text-sm sm:flex-col sm:items-end sm:gap-1">
                      <StatusBadge value={bet.status === 'SETTLED' && bet.result ? bet.result : bet.status} />
                      <span className="font-semibold">
                        {bet.status === 'SETTLED' && bet.payout !== null
                          ? `${bet.result === 'LOSS' ? 'Lost' : 'Paid'} ${formatMoney(bet.payout, bet.currency)}`
                          : `${formatMoney(bet.stake, bet.currency)} → ${formatMoney(bet.potentialPayout, bet.currency)}`}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
            <LoadMore visible={hasMore} loading={loadingMore} onLoad={() => load(page + 1, true)} />
          </div>
        )}
    </div>
  );
}
