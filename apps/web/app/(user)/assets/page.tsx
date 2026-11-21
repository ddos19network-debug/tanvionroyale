'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, Skeleton } from '@tanvion-royale/ui';
import {
  getWallet,
  getWalletBalance,
  currencySymbol,
  formatWalletAmount,
  type WalletCurrencyCode,
  WALLET_CURRENCIES,
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

const CURRENCY_NAMES: Record<WalletCurrencyCode, string> = {
  BDT: 'Bangladeshi Taka',
  USD: 'US Dollar',
  EUR: 'Euro',
};

export interface CurrencyAssetRow {
  symbol: WalletCurrencyCode;
  name: string;
  available: number;
  locked: number;
  total: number;
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  status: string;
}

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

  const [currencyAssets, setCurrencyAssets] = useState<CurrencyAssetRow[]>([]);
  const [currencyAssetsLoading, setCurrencyAssetsLoading] = useState(true);

  const [positions, setPositions] = useState<TradingPositionView[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(true);
  const [positionsError, setPositionsError] = useState<string | null>(null);

  const [instruments, setInstruments] = useState<TradingInstrumentView[]>([]);
  const [instrumentsLoading, setInstrumentsLoading] = useState(true);
  const [instrumentsError, setInstrumentsError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAssetType, setSelectedAssetType] = useState<AssetType | 'ALL'>('ALL');
  const [hideBalances, setHideBalances] = useState(false);

  // Build an index of instruments by id and by symbol for fast lookup
  const instrumentById = useMemo(() => {
    const map = new Map<string, TradingInstrumentView>();
    for (const inst of instruments) map.set(inst.id, inst);
    return map;
  }, [instruments]);

  const instrumentBySymbol = useMemo(() => {
    const map = new Map<string, TradingInstrumentView>();
    for (const inst of instruments) map.set(inst.symbol, inst);
    return map;
  }, [instruments]);

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

  async function loadCurrencyAssets() {
    setCurrencyAssetsLoading(true);
    try {
      const results = await Promise.all(
        WALLET_CURRENCIES.map(async (code) => {
          try {
            const b = await getWalletBalance(code);
            return {
              symbol: code,
              name: CURRENCY_NAMES[code] ?? code,
              available: b.availableBalance,
              locked: b.lockedBalance,
              total: b.availableBalance + b.lockedBalance,
              depositEnabled: true,
              withdrawalEnabled: true,
              status: 'ACTIVE',
            };
          } catch {
            return {
              symbol: code,
              name: CURRENCY_NAMES[code] ?? code,
              available: 0,
              locked: 0,
              total: 0,
              depositEnabled: true,
              withdrawalEnabled: true,
              status: 'ACTIVE',
            };
          }
        }),
      );
      setCurrencyAssets(results);
    } finally {
      setCurrencyAssetsLoading(false);
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
    void loadCurrencyAssets();
    void loadPositions();
    void loadInstruments();
  }, []);

  const totalAvailable = useMemo(() => wallet?.availableBalance ?? 0, [wallet]);
  const totalLocked = useMemo(() => wallet?.lockedBalance ?? 0, [wallet]);
  const totalAssets = useMemo(
    () => (wallet ? wallet.availableBalance + wallet.lockedBalance : 0),
    [wallet],
  );
  const currency = useMemo(() => wallet?.currency ?? 'BDT', [wallet]);

  // Filter positions by search query and asset type
  const filteredHoldings = useMemo(() => {
    return positions.filter((pos) => {
      const matchesSearch =
        searchQuery === '' ||
        pos.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
        pos.name.toLowerCase().includes(searchQuery.toLowerCase());

      const instrument =
        instrumentById.get(pos.instrumentId) ?? instrumentBySymbol.get(pos.symbol);
      const posType = instrument?.type ?? null;

      const matchesType =
        selectedAssetType === 'ALL' || (posType !== null && posType === selectedAssetType);

      return matchesSearch && matchesType;
    });
  }, [positions, searchQuery, selectedAssetType, instrumentById, instrumentBySymbol]);

  // Filter currency assets by search
  const filteredCurrencies = useMemo(() => {
    if (!searchQuery) return currencyAssets;
    const q = searchQuery.toLowerCase();
    return currencyAssets.filter(
      (c) => c.symbol.toLowerCase().includes(q) || c.name.toLowerCase().includes(q),
    );
  }, [currencyAssets, searchQuery]);

  const loading = walletLoading || currencyAssetsLoading || positionsLoading || instrumentsLoading;
  const error = walletError ?? positionsError ?? instrumentsError ?? null;

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
                void loadCurrencyAssets();
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
        {/* Header */}
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

        {/* Primary Wallet Balance Cards */}
        <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-4 mb-8">
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Assets ({currency})</p>
                <p className="mt-1 text-2xl font-bold text-slate-100 font-mono">
                  {hideBalances
                    ? '••••••'
                    : currencySymbol(currency as WalletCurrencyCode) +
                      formatWalletAmount(totalAssets, currency as WalletCurrencyCode)}
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
                  {hideBalances
                    ? '••••••'
                    : currencySymbol(currency as WalletCurrencyCode) +
                      formatWalletAmount(totalAvailable, currency as WalletCurrencyCode)}
                </p>
              </div>
              <div className="h-12 w-12 shrink-0 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                <svg className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="2" x2="12" y2="22" />
                  <line x1="2" y1="12" x2="22" y2="12" />
                </svg>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Locked Balance</p>
                <p className="mt-1 text-2xl font-bold text-amber-400 font-mono">
                  {hideBalances
                    ? '••••••'
                    : currencySymbol(currency as WalletCurrencyCode) +
                      formatWalletAmount(totalLocked, currency as WalletCurrencyCode)}
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
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Active Positions</p>
                <p className="mt-1 text-2xl font-bold text-slate-100 font-mono">
                  {positions.filter((p) => p.status === 'OPEN').length}
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

        {/* ── 1. WALLET CURRENCY ASSETS TABLE ── */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold text-white">Wallet Currency Balances</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Real-time multi-currency ledger balances supported for deposit and withdrawal.
              </p>
            </div>
            <div className="flex gap-2">
              <Link
                href="/wallet/deposit"
                className="rounded-lg bg-teal-500 hover:bg-teal-400 text-ink-950 font-bold px-3 py-1.5 text-xs transition"
              >
                + Deposit
              </Link>
              <Link
                href="/wallet/withdraw"
                className="rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/5 text-slate-200 px-3 py-1.5 text-xs transition"
              >
                Withdraw
              </Link>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/5 bg-ink-800">
            <table className="w-full text-left text-sm border-collapse">
              <thead>
                <tr className="border-b border-white/5 bg-white/[0.02]">
                  <th className="px-4 pb-3 pt-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider">Asset</th>
                  <th className="px-4 pb-3 pt-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider text-right">Available Balance</th>
                  <th className="px-4 pb-3 pt-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider text-right">Locked Balance</th>
                  <th className="px-4 pb-3 pt-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider text-right">Total Balance</th>
                  <th className="px-4 pb-3 pt-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider text-center">Status</th>
                  <th className="px-4 pb-3 pt-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredCurrencies.map((asset) => (
                  <tr key={asset.symbol} className="hover:bg-white/[0.03] transition">
                    <td className="px-4 py-3 text-slate-200 font-medium">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 shrink-0 rounded-xl bg-teal-500/10 text-teal-300 font-bold text-sm flex items-center justify-center border border-teal-500/20">
                          {currencySymbol(asset.symbol)}
                        </div>
                        <div>
                          <div className="text-white font-bold">{asset.symbol}</div>
                          <div className="text-[11px] text-slate-400">{asset.name}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-semibold text-emerald-400">
                      {hideBalances ? '••••••' : formatWalletAmount(asset.available, asset.symbol)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-amber-400">
                      {hideBalances ? '••••••' : formatWalletAmount(asset.locked, asset.symbol)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono font-bold text-white">
                      {hideBalances ? '••••••' : formatWalletAmount(asset.total, asset.symbol)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                        {asset.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Link
                          href={`/wallet/deposit`}
                          className="text-xs text-teal-400 hover:text-teal-300 font-medium underline underline-offset-2"
                        >
                          Deposit
                        </Link>
                        <span className="text-slate-600">|</span>
                        <Link
                          href={`/wallet/withdraw`}
                          className="text-xs text-slate-300 hover:text-white font-medium underline underline-offset-2"
                        >
                          Withdraw
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── 2. TRADING ASSETS & HOLDINGS SECTION ── */}
        <section className="mb-8">
          {/* Search + Filter Bar */}
          <div className="mb-4 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-white">Trading Portfolio & Margin Assets</h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Your live trading positions, contract quantities, and mark-to-market valuations.
              </p>
            </div>
            <Link href="/trading" className="text-xs text-indigo-400 hover:text-indigo-300 font-medium">
              Open Trading Terminal →
            </Link>
          </div>

          <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1 relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.3-4.3" />
              </svg>
              <input
                type="text"
                placeholder="Search assets by symbol or name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-lg border border-white/10 bg-ink-800 text-slate-200 text-xs focus:outline-none focus:border-teal-500"
              />
            </div>
            <div className="flex gap-1.5 overflow-x-auto">
              <button
                onClick={() => setSelectedAssetType('ALL')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
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
                  className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
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

          {positions.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-sm font-medium text-slate-300">No active trading positions</p>
              <p className="text-xs text-slate-500 mt-1">
                Open the trading terminal to start building your portfolio.
              </p>
              <div className="mt-4">
                <Link href="/trading" className="inline-flex items-center gap-2 text-xs text-teal-400 font-medium hover:text-teal-300">
                  Go to Trading Terminal →
                </Link>
              </div>
            </Card>
          ) : filteredHoldings.length === 0 ? (
            <Card className="p-8 text-center">
              <p className="text-sm font-medium text-slate-300">No holdings match your search</p>
              <p className="text-xs text-slate-500 mt-1">Try adjusting your filters.</p>
              <button
                onClick={() => { setSearchQuery(''); setSelectedAssetType('ALL'); }}
                className="mt-3 text-xs text-teal-400 underline hover:text-teal-300"
              >
                Clear filters
              </button>
            </Card>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-white/5 bg-ink-800">
              <table className="w-full text-left text-sm border-collapse">
                <thead>
                  <tr className="border-b border-white/5 bg-white/[0.02]">
                    <th className="px-4 pb-3 pt-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider">Asset</th>
                    <th className="px-4 pb-3 pt-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider">Type</th>
                    <th className="px-4 pb-3 pt-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider text-right">Quantity</th>
                    <th className="px-4 pb-3 pt-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider text-right">Entry Price</th>
                    <th className="px-4 pb-3 pt-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider text-right">Current Price</th>
                    <th className="px-4 pb-3 pt-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider text-right">Market Value</th>
                    <th className="px-4 pb-3 pt-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider text-right">Unrealized P&L</th>
                    <th className="px-4 pb-3 pt-3 text-[11px] font-medium text-slate-400 uppercase tracking-wider text-right hidden sm:table-cell">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {filteredHoldings.map((pos) => {
                    const instrument =
                      instrumentById.get(pos.instrumentId) ?? instrumentBySymbol.get(pos.symbol);
                    const livePrice = instrument?.currentPrice ?? pos.currentPrice;
                    const pnlColor = pos.unrealizedPnl >= 0 ? 'text-emerald-400' : 'text-rose-400';
                    const pnlSign = pos.unrealizedPnl >= 0 ? '+' : '';
                    const marketValue = (Number(pos.quantity) || 0) * (Number(livePrice) || 0);
                    const pnlPct =
                      pos.avgEntryPrice > 0
                        ? ((Number(pos.unrealizedPnl) / (Number(pos.avgEntryPrice) * Number(pos.quantity))) * 100)
                        : 0;
                    const instrumentType = instrument?.type;
                    const isEnabled = instrument?.isEnabled ?? true;

                    return (
                      <tr key={pos.id} className="hover:bg-white/[0.03] transition">
                        <td className="px-4 py-3 text-slate-200 font-medium">
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
                        <td className="px-4 py-3">
                          {instrumentType ? (
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-medium border ${ASSET_TYPE_COLORS[instrumentType]}`}
                            >
                              {ASSET_TYPE_LABELS[instrumentType]}
                            </span>
                          ) : (
                            <span className="text-slate-500 text-[10px]">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300 font-mono">
                          {hideBalances ? '••••' : Number(pos.quantity).toFixed(4)}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300 font-mono">
                          {hideBalances
                            ? '••••••'
                            : currencySymbol(currency as WalletCurrencyCode) +
                              formatWalletAmount(
                                Math.round(Number(pos.avgEntryPrice) || 0),
                                currency as WalletCurrencyCode,
                              )}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300 font-mono">
                          {hideBalances
                            ? '••••••'
                            : currencySymbol(currency as WalletCurrencyCode) +
                              formatWalletAmount(
                                Math.round(Number(livePrice) || 0),
                                currency as WalletCurrencyCode,
                              )}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-200 font-mono">
                          {hideBalances
                            ? '••••••'
                            : currencySymbol(currency as WalletCurrencyCode) +
                              formatWalletAmount(
                                Math.round(marketValue || 0),
                                currency as WalletCurrencyCode,
                              )}
                        </td>
                        <td className={`px-4 py-3 text-right font-mono font-medium ${pnlColor}`}>
                          {hideBalances ? (
                            '••••••'
                          ) : (
                            <>
                              {pnlSign}
                              {formatWalletAmount(
                                Math.round(Number(pos.unrealizedPnl) || 0),
                                currency as WalletCurrencyCode,
                              )}{' '}
                              <span className="text-[10px]">
                                ({pnlSign}
                                {Math.abs(pnlPct).toFixed(2)}%)
                              </span>
                            </>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right hidden sm:table-cell">
                          {!isEnabled ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-500/10 text-slate-400 border border-slate-500/20">
                              Unavailable
                            </span>
                          ) : (
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                                pos.status === 'OPEN'
                                  ? 'bg-emerald-500/15 text-emerald-400'
                                  : 'bg-slate-500/10 text-slate-400'
                              }`}
                            >
                              {pos.status === 'OPEN' ? 'Open' : 'Closed'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Quick Action Navigation */}
        <section className="mb-8">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-5 text-center">
              <h3 className="text-sm font-semibold text-slate-200 mb-1">Deposit Funds</h3>
              <p className="text-xs text-slate-500 mb-3">bKash, Nagad, Rocket, Bank, Card</p>
              <Link href="/wallet/deposit" className="text-xs text-teal-400 font-medium hover:text-teal-300">
                Deposit Now →
              </Link>
            </Card>
            <Card className="p-5 text-center">
              <h3 className="text-sm font-semibold text-slate-200 mb-1">Withdraw Funds</h3>
              <p className="text-xs text-slate-500 mb-3">Request a payout to your account</p>
              <Link href="/wallet/withdraw" className="text-xs text-teal-400 font-medium hover:text-teal-300">
                Withdraw Now →
              </Link>
            </Card>
            <Card className="p-5 text-center">
              <h3 className="text-sm font-semibold text-slate-200 mb-1">Live Trading</h3>
              <p className="text-xs text-slate-500 mb-3">Trade crypto, forex and commodities</p>
              <Link href="/trading" className="text-xs text-teal-400 font-medium hover:text-teal-300">
                Trade Terminal →
              </Link>
            </Card>
            <Card className="p-5 text-center">
              <h3 className="text-sm font-semibold text-slate-200 mb-1">Transaction Ledger</h3>
              <p className="text-xs text-slate-500 mb-3">View filtered transaction history</p>
              <Link href="/wallet/transactions" className="text-xs text-teal-400 font-medium hover:text-teal-300">
                View Ledger →
              </Link>
            </Card>
          </div>
        </section>
      </div>
    </main>
  );
}
