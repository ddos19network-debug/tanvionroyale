'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card, CardContent } from '@tanvion-royale/ui';
import { listActivity, type ActivityItem } from '@/lib/api/profile';
import { ApiClientError } from '@/lib/api/client';
import { formatMoney } from '@/lib/betting';
import { PAGE_SIZE, StatusBadge, shortId } from './profile-helpers';
import { EmptyState, ErrorBox, LoadMore, LoadingRows, SearchBar } from './profile-ui';

const TYPES = ['ALL', 'SPORTS', 'GAMES', 'CRASH', 'DEPOSIT', 'WITHDRAWAL', 'WALLET', 'PROFILE'] as const;

export function ActivityTab() {
  const [atype, setAtype] = useState('ALL');
  const [status, setStatus] = useState('ALL');
  const [range, setRange] = useState('ALL');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [items, setItems] = useState<ActivityItem[]>([]);
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
      const res = await listActivity({ type: atype, status, range, limit: PAGE_SIZE, page: p, search: applied || undefined });
      setItems((prev) => (append ? [...prev, ...res.items] : res.items));
      setHasMore(res.items.length === PAGE_SIZE);
      setPage(p);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to load activity.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [atype, status, range, applied]);
  useEffect(() => { void load(1, false); }, [load]);
  const groups = useMemo(() => {
    const map = new Map<string, ActivityItem[]>();
    for (const item of items) {
      const d = new Date(item.createdAt);
      const today = new Date();
      const yd = new Date();
      yd.setDate(today.getDate() - 1);
      const label = d.toDateString() === today.toDateString() ? 'Today' : d.toDateString() === yd.toDateString() ? 'Yesterday' : d.toLocaleDateString();
      const list = map.get(label) ?? [];
      list.push(item);
      map.set(label, list);
    }
    return [...map.entries()];
  }, [items]);
  return (
    <div>
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1" role="group" aria-label="Activity type filter">
        {TYPES.map((t) => (
          <button key={t} onClick={() => setAtype(t)} aria-pressed={atype === t} className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium ${atype === t ? 'bg-ink-900 text-white' : 'bg-ink-700 text-slate-300'}`}>
            {t === 'ALL' ? 'All' : t.charAt(0) + t.slice(1).toLowerCase()}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        <select aria-label="Status filter" value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-md border border-ink-600 px-2 py-1.5 text-xs">
          {['ALL', 'PENDING', 'WON', 'LOST', 'COMPLETED', 'FAILED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select aria-label="Date filter" value={range} onChange={(e) => setRange(e.target.value)} className="rounded-md border border-ink-600 px-2 py-1.5 text-xs">
          {['ALL', 'TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_30_DAYS'].map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>
      <SearchBar search={search} onSearch={setSearch} onApply={() => setApplied(search.trim())} label="Search activity" placeholder="Search ID, game, match" />
      {loading ? <LoadingRows />
        : error ? <div className="mt-4"><ErrorBox message={error} onRetry={() => load(1, false)} /></div>
        : items.length === 0 ? <div className="mt-4"><EmptyState title="No activity found." hint="Deposits, bets, games and wallet events will appear here." /></div>
        : (
          <div className="mt-4 space-y-4">
            {groups.map(([label, list]) => (
              <div key={label}>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
                <div className="mt-2 space-y-2">
                  {list.map((item) => (
                    <Card key={item.id}>
                      <CardContent className="flex flex-col gap-1 p-4 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{item.title}</p>
                          <p className="text-xs text-slate-500">{shortId(item.refId)}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatusBadge value={item.status} />
                          {item.amount !== null ? (
                            <span className="text-sm font-semibold">{formatMoney(item.amount, item.currency ?? 'BDT')}</span>
                          ) : null}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
            <LoadMore visible={hasMore} loading={loadingMore} onLoad={() => load(page + 1, true)} />
          </div>
        )}
    </div>
  );
}
