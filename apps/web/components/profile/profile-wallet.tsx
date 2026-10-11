'use client';
import { useCallback, useEffect, useState } from 'react';
import { Card, CardContent, Skeleton } from '@tanvion-royale/ui';
import { getWallet, listWalletTransactions } from '@/lib/api/wallet';
import { ApiClientError } from '@/lib/api/client';
import { formatMoney } from '@/lib/betting';
import type { WalletTransactionView, WalletView } from '@tanvion-royale/types';
import { EmptyState, ErrorBox } from './profile-ui';
import { TxCard } from './profile-money';
import { WalletCtas } from './profile-overview';

export function WalletTab() {
  const [wallet, setWallet] = useState<WalletView | null>(null);
  const [recent, setRecent] = useState<WalletTransactionView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [w, txs] = await Promise.all([getWallet(), listWalletTransactions({ limit: 10 })]);
      setWallet(w);
      setRecent(txs);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : 'Unable to load wallet.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (loading) return <div className="space-y-2"><Skeleton className="h-28" /><Skeleton className="h-32" /></div>;
  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!wallet) return <EmptyState title="Wallet unavailable." hint="Sign in to view your wallet." actionHref="/wallet" actionLabel="Open Wallet" />;
  return (
    <div>
      <Card>
        <CardContent className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-3">
          <div><p className="text-xs uppercase tracking-wide text-slate-500">Available</p><p className="mt-1 text-2xl font-bold">{formatMoney(wallet.availableBalance, wallet.currency)}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-slate-500">Locked</p><p className="mt-1 text-2xl font-bold">{formatMoney(wallet.lockedBalance, wallet.currency)}</p></div>
          <div><p className="text-xs uppercase tracking-wide text-slate-500">Currency</p><p className="mt-1 text-2xl font-bold">{wallet.currency}</p></div>
        </CardContent>
      </Card>
      <WalletCtas />
      <h3 className="mt-6 text-base font-semibold">Recent wallet activity</h3>
      {!recent || recent.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">No wallet activity yet.</p>
      ) : (
        <div className="mt-2 space-y-2">{recent.map((tx) => <TxCard key={tx.id} tx={tx} />)}</div>
      )}
    </div>
  );
}
