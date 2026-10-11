'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent } from '@tanvion-royale/ui';
import { listWalletTransactions } from '@/lib/api/wallet';
import { ApiClientError } from '@/lib/api/client';
import { formatMoney } from '@/lib/betting';
import type { WalletTransactionView } from '@tanvion-royale/types';
import { PAGE_SIZE, StatusBadge, copyText, fmtDate, shortId } from './profile-helpers';
import { EmptyState, ErrorBox, LoadMore, LoadingRows, SearchBar } from './profile-ui';

export function TxCard({ tx }: { tx: WalletTransactionView }) {
  const amountLabel = `${tx.amount >= 0 ? '+' : ''}${formatMoney(tx.amount, tx.currency)}`;
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium">{tx.type === 'DEPOSIT' ? 'Deposit' : tx.type === 'WITHDRAWAL' ? 'Withdrawal' : tx.type.replace(/_/g, ' ')}</p>
          <p className="text-xs text-slate-500">{fmtDate(tx.createdAt)}{tx.reference ? ` · Ref ${shortId(tx.reference)}` : ''}</p>
          <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-slate-400">
            <span className="break-anywhere">TXN {shortId(tx.id)}</span>
            <button type="button" aria-label={`Copy transaction id ${tx.id}`} onClick={() => copyText(tx.id)} className="rounded border border-white/10 px-1.5 py-0.5 text-[10px] hover:bg-white/10">
              Copy
            </button>
          </p>
          {tx.failureReason ? <p className="mt-1 text-xs text-red-400">{tx.failureReason}</p> : null}
        </div>
        <div className="flex items-center gap-3 text-sm sm:flex-col sm:items-end sm:gap-1">
          <StatusBadge value={tx.status} />
          <span className={`font-semibold ${tx.amount >= 0 ? 'text-emerald-400' : 'text-slate-300'}`}>{amountLabel}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function useTxList(txType: 'DEPOSIT' | 'WITHDRAWAL', emptyTitle: string, emptyHint: string, emptyAction: string, emptyLabel: string) {
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [items, setItems] = useState<WalletTransactionView[]>([]);
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
      const res = await listWalletTransactions({ type: txType, limit: PAGE_SIZE, page: p, search: applied || undefined });
      setItems((prev) => (append ? [...prev, ...res] : res));
      setHasMore(res.length === PAGE_SIZE);
      setPage(p);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to load history.');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [txType, applied]);

  useEffect(() => { void load(1, false); }, [load]);

  const view = (
    <div>
      <SearchBar search={search} onSearch={setSearch} onApply={() => setApplied(search.trim())} label={`Search ${txType.toLowerCase()}s`} placeholder="Search transaction ID or reference" />
      {loading ? <LoadingRows />
        : error ? <div className="mt-4"><ErrorBox message={error} onRetry={() => load(1, false)} /></div>
        : items.length === 0 ? <div className="mt-4"><EmptyState title={emptyTitle} hint={emptyHint} actionHref={emptyAction} actionLabel={emptyLabel} /></div>
        : <div className="mt-4 space-y-2">{items.map((tx) => <TxCard key={tx.id} tx={tx} />)}<LoadMore visible={hasMore} loading={loadingMore} onLoad={() => load(page + 1, true)} /></div>}
    </div>
  );
  return { view };
}

export function DepositsTab() {
  const { view } = useTxList('DEPOSIT', 'No deposits found.', 'Deposits confirmed by the backend will appear here.', '/wallet/deposit', 'Make Deposit');
  return view;
}

export function WithdrawalsTab() {
  const { view } = useTxList('WITHDRAWAL', 'No withdrawals found.', 'Withdrawal requests will appear here with their live status.', '/wallet/withdraw', 'Withdraw');
  return view;
}
