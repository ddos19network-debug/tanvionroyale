'use client';

import { useEffect, useMemo, useState, Fragment } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@tanvion-royale/ui';
import {
  getWallet,
  currencySymbol,
  formatWalletAmount,
  type WalletCurrencyCode,
} from '@/lib/api/wallet';
import {
  listTradingPositions,
  listTradingInstruments,
  type TradingPositionView,
  type TradingInstrumentView,
} from '@/lib/api/trading';
import { ApiClientError } from '@/lib/api/client';

type AssetType = 'STOCK' | 'CRYPTO' | 'FOREX' | 'COMMODITY';

const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  STOCK: 'Stocks',
  CRYPTO: 'Crypto',
  FOREX: 'Forex',
  COMMODITY: 'Commodities',
};

const ASSET_TYPE_COLORS: Record<AssetType, string> = {
  STOCK: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  CRYPTO: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  FOREX: 'bg-teal-500/10 text-teal-400 border-teal-500/20',
  COMMODITY: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
};

export default function AssetsPage() {
  const router = useRouter();

  const [wallet, setWallet] = useState<{
    id: string;
    currency: string;
    availableBalance: number;
    lockedBalance: number;
    status: string;
  } | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [walletError, setWalletError] = useState<string | null>(null);

  const [positions, setPositions] = useState<TradingPositionView[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(true);
  const [positionsError, setPositionsError] = useState<string | null>(null);

  const [instruments, setInstruments] = useState<TradingInstrumentView[]>([]);
  const [instrumentsLoading, setInstrumentsLoading] = useState(true);
  const [instrumentsError, setInstrumentsError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAssetType, setSelectedAssetType] = useState<AssetType | 'ALL'>('ALL');
  const [hideBalances, setHideBalances] = useState(false);

  const CURRENCIES: WalletCurrencyCode[] = ['BDT', 'USD', 'EUR'];

  async function loadWallet() {
    setWalletLoading(true);
    setWalletError(null);
    try {
      const w = await getWallet();
      setWallet(w);
    } catch (err) {
      if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
        router.replace('/login');
        return;
      }
      setWalletError(err instanceof Error ? err.message : 'Unable to load wallet.');
    } finally {
      setWalletLoading(false);
    }
  }

  async function loadPositions() {
    setPositionsLoading(true);
    setPositionsError(null);
    try {
      const pos = await listTradingPositions();
      setPositions(pos);
    } catch (err) {
      if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
        router.replace('/login');
        return;
      }
      setPositionsError(err instanceof Error ? err.message : 'Unable to load positions.');
    } finally {
      setPositionsLoading(false);
    }
  }

  async function loadInstruments() {
    setInstrumentsLoading(true);
    setInstrumentsError(null);
    try {
      const inst = await listTradingInstruments();
      setInstruments(inst);
    } catch (err) {
      setInstrumentsError(err instanceof Error ? err.message : 'Unable to load instruments.');
    } finally {
      setInstrumentsLoading(false);
    }
  }

  useEffect(() => {
    void loadWallet();
    void loadPositions();
    void loadInstruments();
  }, []);

  const totalAvailable = useMemo(() => {
    if (!wallet) return 0;
    return wallet.availableBalance;
  }, [wallet]);

  const totalLocked = useMemo(() => {
    if (!wallet) return 0;
    return wallet.lockedBalance;
  }, [wallet]);

  const totalAssets = useMemo(() => {
    if (!wallet) return 0;
    return wallet.availableBalance + wallet.lockedBalance;
  }, [wallet]);

  const currency = useMemo(() => wallet?.currency || 'BDT', [wallet]);

  const filteredHoldings = useMemo(() => {
    return positions.filter((pos) => {
      const matchesSearch =
        searchQuery === '' ||
        pos.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pos.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesType =
        selectedAssetType === 'ALL' ||
        (pos.symbol.includes('USD') || pos.symbol.includes('BTC') || pos.symbol.includes('ETH')
          ? selectedAssetType === 'CRYPTO'
          : selectedAssetType === 'STOCK');
      return matchesSearch && matchesType;
    });
  }, [positions, searchQuery, selectedAssetType]);

  const filteredInstruments = useMemo(() => {
    return instruments.filter((inst) => {
      const matchesSearch =
        searchQuery === '' ||
        inst.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        inst.name.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesType =
        selectedAssetType === 'ALL' || inst.type === selectedAssetType;
      return matchesSearch && matchesType;
    });
  }, [instruments, searchQuery, selectedAssetType]);

  const loading = walletLoading || positionsLoading || instrumentsLoading;
  const error = walletError || positionsError || instrumentsError;

  if (error && !wallet && !positions.length && !instruments.length) {
    return (
      <main className="min-h-screen w-full bg-ink-950 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="mx-auto w-full max-w-6xl">
          <div className="mb-5 rounded-2xl border border-red-500/40 bg-red-950/50 px-4 py-3">
            <p className="text-sm font-medium text-red-300">{error}</p>
            <button
              onClick={() => {
                setWalletError(null);
                setPositionsError(null);
                setInstrumentsError(null);
                void loadWallet();
                void loadPositions();
                void loadInstruments();
              }}
              className="mt-3 text-sm text-teal-400 underline underline-offset-4 hover:text-teal-300"
            >
              Try again
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="min-h-screen w-full bg-ink-950 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="mx-auto w-full max-w-6xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">My Assets</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-100 sm:text-3xl">Assets Overview</h1>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Card key={i} className="p-6">
                <Skeleton className="h-8 w-32 mb-4" />
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-4 w-3/4" />
              </Card>
            ))}
          </div>
          <div className="mt-6 space-y-4">
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen w-full bg-ink-950 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto w-full max-w-7xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">My Assets</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-100 sm:text-3xl">Assets Overview</h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setHideBalances((prev) => !prev)}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/5 transition"
            >
              {hideBalances ? 'Show balances' : 'Hide balances'}
            </button>
          </div>
        </div>

        {error && (
          <div role="alert" className="mb-5 rounded-xl border border-red-500/40 bg-red-950/50 px-4 py-3 text-sm font-medium leading-5 text-red-300">
            {error}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4 mb-8">
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Assets</p>
                <p className="mt-1 text-2xl font-bold text-slate-100 font-mono">
                  {hideBalances ? '••••••' : currencySymbol(currency) + formatWalletAmount(totalAssets, currency)}
                </p>
              </div>
              <div className="h-12 w-12 shrink-0 rounded-xl bg-indigo-500/10 flex items-center justify-center text-indigo-400">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Available Balance</p>
                <p className="mt-1 text-2xl font-bold text-emerald-400 font-mono">
                  {hideBalances ? '••••••' : currencySymbol(currency) + formatWalletAmount(totalAvailable, currency)}
                </p>
              </div>
              <div className="h-12 w-12 shrink-0 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="12 2 12 22" />
                  <polyline points="2 12 22 12" />
                </svg>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Locked Balance</p>
                <p className="mt-1 text-2xl font-bold text-amber-400 font-mono">
                  {hideBalances ? '••••••' : currencySymbol(currency) + formatWalletAmount(totalLocked, currency)}
                </p>
              </div>
              <div className="h-12 w-12 shrink-0 rounded-xl bg-amber-500/10 flex items-center justify-center text-amber-400">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0110 0v4" />
                </svg>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Active Holdings</p>
                <p className="mt-1 text-2xl font-bold text-slate-100 font-mono">
                  {positions.length}
                </p>
              </div>
              <div className="h-12 w-12 shrink-0 rounded-xl bg-purple-500/10 flex items-center justify-center text-purple-400">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </div>
            </div>
          </Card>
        </div>

        <div className="mb-6 flex flex-col sm:flex-row sm:items-end gap-4">
          <div className="flex-1 relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="M21 21l-4.3-4.3" />
            </svg>
            <input
              type="text"
              placeholder="Search assets..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-white/10 bg-ink-800 text-slate-200 text-sm focus:outline-none focus:border-brand/50 focus:ring-1 focus:ring-brand/50"
            />
          </div>
          <div className="flex gap-2 sm:w-64 overflow-x-auto">
            <button
              onClick={() => setSelectedAssetType('ALL')}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition ${
                selectedAssetType === 'ALL'
                  ? 'bg-white/10 text-white'
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              All Types
            </button>
            {(['STOCK', 'CRYPTO', 'FOREX', 'COMMODITY'] as AssetType[]).map((type) => (
              <button
                key={type}
                onClick={() => setSelectedAssetType(type)}
                className={`whitespace-nowrap px-4 py-2 rounded-lg text-xs font-medium transition border ${
                  selectedAssetType === type
                    ? `${ASSET_TYPE_COLORS[type]} text-white`
                    : 'border-white/10 text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                {ASSET_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
        </div>

        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-white">Asset Holdings</h2>
              <p className="text-xs text-slate-400 mt-1">
                Your actual trading positions from live market data.
              </p>
            </div>
            <Link href="/wallet" className="text-xs text-teal-400 underline underline-offset-2 hover:text-teal-300">
              Manage Wallet &amp;rarr;
            </Link>
          </div>

          {positions.length === 0 ? (
            <Card className="p-8 text-center">
              <div className="h-16 w-16 shrink-0 rounded-full bg-white/[0.05] flex items-center justify-center mx-auto mb-4 text-slate-500">
                <svg className="h-8 w-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                  <line x1="8" y1="21" x2="16" y2="21" />
                  <line x1="12" y1="17" x2="12" y2="21" />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-300">No active positions</p>
              <p className="text-xs text-slate-500 mt-1">
                Open the trading terminal to start building your portfolio.
              </p>
              <div className="mt-6">
                <Link href="/trading" className="inline-flex items-center gap-2 text-xs text-indigo-400 font-medium hover:text-indigo-300">
                  Go to Trading &amp;rarr;
                </Link>
              </div>
            </Card>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-white/5">
                    <th className="pb-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider">Asset</th>
                    <th className="pb-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider text-right">Quantity</th>
                    <th className="pb-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider text-right">Entry Price</th>
                    <th className="pb-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider text-right">Current Price</th>
                    <th className="pb-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider text-right">Market Value</th>
                    <th className="pb-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider text-right">Unrealized P&L</th>
                    <th className="pb-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider text-right hidden sm:table-cell">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredHoldings.map((pos) => {
                    const pnlColor = pos.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400';
                    const pnlSign = pos.unrealizedPnl >= 0 ? '+' : '';
                    const marketValue = (Number(pos.quantity) || 0) * (Number(pos.currentPrice) || 0);
                    return (
                      <tr key={pos.id} className="hover:bg-white/3 transition">
                        <td className="py-3 text-slate-200 font-medium">
                          <div className="flex items-center gap-3">
                            <div className="h-8 w-8 shrink-0 rounded-lg bg-white/10 flex items-center justify-center text-slate-300 font-bold text-xs">
                              {pos.symbol.slice(0, 2)}
                            </div>
                            <div>
                              <div className="text-slate-200 font-medium">{pos.symbol}</div>
                              <div className="text-[10px] text-slate-500">{pos.name}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 text-right text-slate-300 font-mono">
                          {Number(pos.quantity).toFixed(4)}
                        </td>
                        <td className="py-3 text-right text-slate-300 font-mono">
                          {currencySymbol(currency) + formatWalletAmount(Math.round(Number(pos.avgEntryPrice) || 0), currency)}
                        </td>
                        <td className="py-3 text-right text-slate-300 font-mono">
                          {currencySymbol(currency) + formatWalletAmount(Math.round(Number(pos.currentPrice) || 0), currency)}
                        </td>
                        <td className="py-3 text-right text-slate-200 font-mono">
                          {currencySymbol(currency) + formatWalletAmount(Math.round(marketValue || 0), currency)}
                        </td>
                        <td className={`py-3 text-right font-mono font-medium ${pnlColor}`}>
                          {pnlSign}{formatWalletAmount(Math.round(Number(pos.unrealizedPnl) || 0), currency)} ({pnlSign}{(Number(pos.unrealizedPnl) / Math.max(Number(pos.avgEntryPrice) || 1, 1) * 100).toFixed(2)}%)
                        </td>
                        <td className="py-3 text-right hidden sm:table-cell">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${pos.status === 'OPEN' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-slate-500/10 text-slate-400'}`}>
                            {pos.status === 'OPEN' ? 'Open' : 'Closed'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-white">Quick Actions</h2>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-5 text-center cursor-pointer hover:border-brand/50 transition border border-transparent">
              <div className="h-12 w-12 shrink-0 rounded-xl bg-indigo-500/10 flex items-center justify-center mx-auto mb-3 text-indigo-400">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v20m0-20h20" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-slate-200 mb-1">Deposit</h3>
              <p className="text-xs text-slate-500">Add funds to your wallet</p>
              <Link href="/trading/deposit" className="mt-3 inline-block text-xs text-teal-400 font-medium hover:text-teal-300">
                Deposit Funds &amp;rarr;
              </Link>
            </Card>
            <Card className="p-5 text-center cursor-pointer hover:border-brand/50 transition border border-transparent">
              <div className="h-12 w-12 shrink-0 rounded-xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-3 text-emerald-400">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="12 22 8 10 4 16" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-slate-200 mb-1">Withdraw</h3>
              <p className="text-xs text-slate-500">Request a payout</p>
              <Link href="/wallet" className="mt-3 inline-block text-xs text-teal-400 font-medium hover:text-teal-300">
                Withdraw Funds &amp;rarr;
              </Link>
            </Card>
            <Card className="p-5 text-center cursor-pointer hover:border-brand/50 transition border border-transparent">
              <div className="h-12 w-12 shrink-0 rounded-xl bg-amber-500/10 flex items-center justify-center mx-auto mb-3 text-amber-400">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2L2 7l10 5 10-5-10-5z" />
                  <path d="M2 17l10 5 10-5" />
                  <path d="M2 12l10 5 10-5" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-slate-200 mb-1">Trading</h3>
              <p className="text-xs text-slate-500">Open trading terminal</p>
              <Link href="/trading" className="mt-3 inline-block text-xs text-teal-400 font-medium hover:text-teal-300">
                Start Trading &amp;rarr;
              </Link>
            </Card>
            <Card className="p-5 text-center cursor-pointer hover:border-brand/50 transition border border-transparent">
              <div className="h-12 w-12 shrink-0 rounded-xl bg-purple-500/10 flex items-center justify-center mx-auto mb-3 text-purple-400">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="7" width="20" height="10" rx="2" ry="2" />
                  <path d="M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16" />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-slate-200 mb-1">Wallet</h3>
              <p className="text-xs text-slate-500">Manage wallet settings</p>
              <Link href="/wallet" className="mt-3 inline-block text-xs text-teal-400 font-medium hover:text-teal-300">
                Manage Wallet &amp;rarr;
              </Link>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}