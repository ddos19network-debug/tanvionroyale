'use client';

import { useCallback, useEffect, useState, Fragment } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@tanvion-royale/ui';
import { useAuth } from '@/src/lib/auth';
import { getDashboardOverview, type DashboardOverview } from '@/lib/api/dashboard';
import { ApiClientError } from '@/lib/api/client';
import { currencySymbol, formatWalletAmount } from '@/lib/api/wallet';

const KYC_LABEL: Record<string, string> = {
  NOT_STARTED: 'Not started',
  PENDING: 'Pending review',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
  MANUAL_REVIEW: 'Manual review',
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
  LOCKED: 'Locked',
  PENDING: 'Pending',
  CLOSED: 'Closed',
  BANNED: 'Banned',
};

const ACTIVITY_ICON: Record<string, string> = {
  DEPOSIT: '💰',
  WITHDRAWAL: '📤',
  SPORTS: '⚽',
  GAMES: '🎮',
  CRASH: '🚀',
  PROFILE: '👤',
  WALLET: '💳',
};

const STATUS_STYLE: Record<string, string> = {
  COMPLETED: 'bg-emerald-500/15 text-emerald-300',
  PENDING: 'bg-amber-500/15 text-amber-300',
  PROCESSING: 'bg-blue-500/15 text-blue-300',
  FAILED: 'bg-red-500/15 text-red-300',
  CANCELLED: 'bg-slate-500/10 text-slate-400',
  WON: 'bg-emerald-500/15 text-emerald-300',
  LOST: 'bg-red-500/15 text-red-300',
  CASHED_OUT: 'bg-teal-500/15 text-teal-300',
  SETTLED: 'bg-slate-500/10 text-slate-300',
  ACTIVE: 'bg-blue-500/15 text-blue-300',
};

function formatRelativeTime(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function MaskedAmount({ children, hide }: { children: React.ReactNode; hide: boolean }) {
  if (hide) return <span className="tracking-widest text-slate-500">••••••</span>;
  return <>{children}</>;
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="rounded-xl bg-white/[0.02] border border-white/[0.06] p-4 flex flex-col gap-1">
      <p className="text-xs text-slate-500 uppercase tracking-wider">{label}</p>
      <div className={`text-lg font-bold ${color ?? 'text-white'}`}>{value}</div>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function SectionHeader({
  title,
  link,
  linkLabel,
}: {
  title: string;
  link?: string;
  linkLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-base font-bold text-white">{title}</h2>
      {link && linkLabel && (
        <Link href={link} className="text-xs text-teal-400 hover:text-teal-300 font-medium transition">
          {linkLabel} →
        </Link>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { ready, isAuthenticated } = useAuth();

  const [data, setData] = useState<DashboardOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hideBalances, setHideBalances] = useState(false);
  const [copiedRef, setCopiedRef] = useState(false);
  const [copiedUid, setCopiedUid] = useState(false);

  const load = useCallback(async () => {
    if (!ready) return;
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    try {
      const overview = await getDashboardOverview();
      if (!cancelled) setData(overview);
    } catch (err) {
      if (cancelled) return;
      if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
        router.replace('/login');
        return;
      }
      setLoadError('Could not reach the server. Please try again.');
    } finally {
      if (!cancelled) setLoading(false);
    }
  }, [ready, isAuthenticated, router]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleCopyReferral = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedRef(true);
      setTimeout(() => setCopiedRef(false), 2000);
    } catch {
      // fallback
    }
  };

  const handleCopyUid = async (uid: string) => {
    try {
      await navigator.clipboard.writeText(uid);
      setCopiedUid(true);
      setTimeout(() => setCopiedUid(false), 2000);
    } catch {
      // fallback
    }
  };

  if (loadError) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8">
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <div className="mt-4 rounded-md border border-red-500/40 bg-red-950/50 px-4 py-3" role="status">
          <p className="text-sm font-medium text-red-300">{loadError}</p>
          <button
            onClick={() => {
              setLoadError(null);
              void load();
            }}
            className="mt-3 text-sm text-teal-400 underline underline-offset-4 hover:text-teal-300"
          >
            Try again
          </button>
        </div>
      </main>
    );
  }

  const profile = data?.profile;
  const wallet = data?.wallet;
  const financial = data?.financial;
  const trading = data?.trading;
  const notifications = data?.notifications;
  const referral = data?.referral;
  const activity = data?.activity ?? [];
  const walletCurrency = wallet?.currency ?? 'BDT';
  const totalBalance = (wallet?.availableBalance ?? 0) + (wallet?.frozenBalance ?? 0);
  const pnlToday = wallet?.pnlToday ?? 0;
  const pnlPct = wallet?.pnlPercentage ?? 0;
  const pnlUp = pnlToday >= 0;

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-400">
            Your TANVIONROYALE account — profile, wallet, trading and financial overview at a glance.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {!loading && (
            <button
              onClick={() => setHideBalances((prev) => !prev)}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/5 transition"
            >
              {hideBalances ? '👁 Show balances' : '🙈 Hide balances'}
            </button>
          )}
          <button
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/5 transition disabled:opacity-50"
          >
            {loading ? '…' : '↻ Refresh'}
          </button>
        </div>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-white/10 bg-ink-800 p-6">
            <div className="flex items-center gap-4">
              <Skeleton className="w-16 h-16 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
            <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-14 rounded-xl" />
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-32 rounded-2xl" />
            ))}
          </div>
        </div>
      )}

      {/* Main Content */}
      {!loading && data && (
        <Fragment>
          {/* ── 1. ACCOUNT OVERVIEW ── */}
          <section className="mb-6">
            <div className="rounded-2xl border border-white/10 bg-ink-800 p-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  {profile?.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={profile.avatarUrl}
                      alt="Profile"
                      className="w-16 h-16 rounded-full bg-ink-700 object-cover border border-white/10"
                    />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-teal-500/20 to-blue-500/20 flex items-center justify-center shrink-0 border border-teal-500/30">
                      <span className="text-xl font-bold text-teal-300">
                        {profile?.username?.charAt(0)?.toUpperCase() ?? 'U'}
                      </span>
                    </div>
                  )}
                  <div>
                    <h2 className="text-lg font-bold text-white">{profile?.username ?? 'User'}</h2>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-slate-400 font-mono">UID: {profile?.uid ?? '—'}</span>
                      {profile?.uid && (
                        <button
                          type="button"
                          onClick={() => handleCopyUid(profile.uid)}
                          className="text-[10px] text-teal-400 hover:text-teal-300 px-1.5 py-0.5 rounded bg-teal-500/10 border border-teal-500/20"
                        >
                          {copiedUid ? '✓ Copied' : 'Copy'}
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          profile?.status === 'ACTIVE'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : profile?.status === 'SUSPENDED' || profile?.status === 'LOCKED'
                            ? 'bg-red-500/15 text-red-400'
                            : 'bg-slate-500/10 text-slate-400'
                        }`}
                      >
                        {STATUS_LABEL[profile?.status ?? ''] ?? profile?.status ?? 'Active'}
                      </span>
                      {profile?.vipTitle && (
                        <span className="px-2 py-0.5 rounded text-xs font-medium bg-amber-500/15 text-amber-400 border border-amber-500/20">
                          {profile.vipTitle}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Link
                    href="/profile"
                    className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium text-slate-300 hover:bg-white/5 transition"
                  >
                    Edit Profile
                  </Link>
                  <Link
                    href="/settings"
                    className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-2 text-xs font-medium text-slate-300 hover:bg-white/5 transition"
                  >
                    Security Settings
                  </Link>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-3 border-t border-white/10 pt-5">
                <div className="p-3 rounded-xl bg-white/[0.02]">
                  <p className="text-xs text-slate-500 uppercase tracking-wider">Email</p>
                  <p className="text-sm font-medium text-slate-200 truncate mt-0.5">{profile?.email ?? 'Not set'}</p>
                </div>
                <div className="p-3 rounded-xl bg-white/[0.02]">
                  <p className="text-xs text-slate-500 uppercase tracking-wider">KYC Verification</p>
                  <p className="text-sm font-medium text-slate-200 mt-0.5">
                    {KYC_LABEL[profile?.kycStatus ?? 'NOT_STARTED'] ?? profile?.kycStatus}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-white/[0.02]">
                  <p className="text-xs text-slate-500 uppercase tracking-wider">Security</p>
                  <p className="text-sm font-medium text-slate-200 mt-0.5">
                    {profile?.socialLinked ? '✓ Social Linked' : 'Standard Auth'}
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-white/[0.02]">
                  <p className="text-xs text-slate-500 uppercase tracking-wider">Member Since</p>
                  <p className="text-sm font-medium text-slate-200 mt-0.5">
                    {profile?.status ? 'Verified Account' : '—'}
                  </p>
                </div>
              </div>
            </div>
          </section>

          {/* ── 2. WALLET SUMMARY ── */}
          <section className="mb-6">
            <SectionHeader title="Wallet Summary" link="/wallet" linkLabel="Manage wallet" />
            <div className="rounded-2xl border border-white/10 bg-ink-800 p-6">
              {/* Total balance */}
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-5">
                <div>
                  <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Total Balance ({walletCurrency})</p>
                  <p className="text-3xl font-black text-white">
                    <MaskedAmount hide={hideBalances}>
                      {currencySymbol(walletCurrency)}
                      {formatWalletAmount(totalBalance, walletCurrency)}
                    </MaskedAmount>
                  </p>
                  {pnlToday !== 0 && (
                    <p className={`text-xs font-medium mt-1 ${pnlUp ? 'text-emerald-400' : 'text-red-400'}`}>
                      {pnlUp ? '+' : ''}
                      {formatWalletAmount(Math.abs(pnlToday), walletCurrency)} ({pnlUp ? '+' : ''}
                      {pnlPct.toFixed(2)}%) today
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Link
                    href="/wallet/deposit"
                    className="rounded-lg bg-teal-500 hover:bg-teal-400 text-ink-950 font-bold px-4 py-2 text-sm transition"
                  >
                    + Deposit
                  </Link>
                  <Link
                    href="/wallet/withdraw"
                    className="rounded-lg border border-white/10 bg-white/[0.03] hover:bg-white/5 text-slate-200 font-medium px-4 py-2 text-sm transition"
                  >
                    Withdraw
                  </Link>
                </div>
              </div>

              {/* Balance breakdown */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <StatCard
                  label="Available Balance"
                  value={
                    <MaskedAmount hide={hideBalances}>
                      {currencySymbol(walletCurrency)}
                      {formatWalletAmount(wallet?.availableBalance ?? 0, walletCurrency)}
                    </MaskedAmount>
                  }
                  color="text-emerald-400"
                />
                <StatCard
                  label="Locked / Frozen"
                  value={
                    <MaskedAmount hide={hideBalances}>
                      {currencySymbol(walletCurrency)}
                      {formatWalletAmount(wallet?.frozenBalance ?? 0, walletCurrency)}
                    </MaskedAmount>
                  }
                  color="text-amber-400"
                />
                <StatCard
                  label="Est. USD Value"
                  value={
                    <MaskedAmount hide={hideBalances}>
                      ${formatWalletAmount(wallet?.totalEstimatedUsd ?? 0, 'USD')}
                    </MaskedAmount>
                  }
                  color="text-white"
                  sub={`≈ ${(wallet?.totalEstimatedBtc ?? 0).toFixed(6)} BTC`}
                />
              </div>

              {/* Supported Currencies Breakdown */}
              {wallet?.assets && wallet.assets.length > 0 && (
                <div className="mt-5 border-t border-white/[0.06] pt-4">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
                    Supported Currency Balances
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {wallet.assets.map((asset) => (
                      <div
                        key={asset.symbol}
                        className="rounded-xl border border-white/5 bg-white/[0.02] p-3 flex items-center justify-between"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-white">{asset.symbol}</span>
                            <span className="text-[11px] text-slate-400">{asset.name}</span>
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            Available:{' '}
                            <MaskedAmount hide={hideBalances}>
                              {currencySymbol(asset.symbol)}
                              {formatWalletAmount(asset.available, asset.symbol)}
                            </MaskedAmount>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-sm font-bold text-slate-200">
                            <MaskedAmount hide={hideBalances}>
                              {currencySymbol(asset.symbol)}
                              {formatWalletAmount(asset.total, asset.symbol)}
                            </MaskedAmount>
                          </div>
                          {asset.frozen > 0 && (
                            <div className="text-[10px] text-amber-400 font-mono">
                              Locked:{' '}
                              <MaskedAmount hide={hideBalances}>
                                {formatWalletAmount(asset.frozen, asset.symbol)}
                              </MaskedAmount>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* ── 3. FINANCIAL OVERVIEW ── */}
          <section className="mb-6">
            <SectionHeader title="Financial Overview" link="/wallet/transactions" linkLabel="All transactions" />
            <div className="rounded-2xl border border-white/10 bg-ink-800 p-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <StatCard
                  label="Total Deposits"
                  value={
                    <MaskedAmount hide={hideBalances}>
                      {currencySymbol(walletCurrency)}
                      {formatWalletAmount(financial?.totalDeposits ?? 0, walletCurrency)}
                    </MaskedAmount>
                  }
                  color="text-emerald-400"
                />
                <StatCard
                  label="Total Withdrawals"
                  value={
                    <MaskedAmount hide={hideBalances}>
                      {currencySymbol(walletCurrency)}
                      {formatWalletAmount(financial?.totalWithdrawals ?? 0, walletCurrency)}
                    </MaskedAmount>
                  }
                  color="text-rose-400"
                />
                <StatCard
                  label="Pending Deposits"
                  value={financial?.pendingDepositsCount ?? 0}
                  color={(financial?.pendingDepositsCount ?? 0) > 0 ? 'text-amber-400' : 'text-slate-300'}
                  sub={(financial?.pendingDepositsCount ?? 0) > 0 ? 'Under review' : 'None pending'}
                />
                <StatCard
                  label="Pending Withdrawals"
                  value={financial?.pendingWithdrawalsCount ?? 0}
                  color={(financial?.pendingWithdrawalsCount ?? 0) > 0 ? 'text-amber-400' : 'text-slate-300'}
                  sub={(financial?.pendingWithdrawalsCount ?? 0) > 0 ? 'In verification' : 'None pending'}
                />
              </div>

              {/* Recent Transactions List */}
              <div className="border-t border-white/[0.06] pt-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Recent Transactions</h3>
                  <Link href="/wallet/transactions" className="text-xs text-teal-400 hover:text-teal-300 font-medium">
                    View Ledger →
                  </Link>
                </div>
                {(!financial?.recentTransactions || financial.recentTransactions.length === 0) ? (
                  <p className="text-xs text-slate-500 py-3 text-center">No recent financial transactions found.</p>
                ) : (
                  <div className="overflow-x-auto rounded-xl border border-white/5">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="border-b border-white/5 bg-white/[0.02]">
                          <th className="px-3 py-2 text-[10px] font-medium text-slate-400 uppercase">Type</th>
                          <th className="px-3 py-2 text-[10px] font-medium text-slate-400 uppercase">Reference</th>
                          <th className="px-3 py-2 text-[10px] font-medium text-slate-400 uppercase text-right">Amount</th>
                          <th className="px-3 py-2 text-[10px] font-medium text-slate-400 uppercase text-right">Status</th>
                          <th className="px-3 py-2 text-[10px] font-medium text-slate-400 uppercase text-right">Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {financial.recentTransactions.map((tx) => (
                          <tr key={tx.id} className="hover:bg-white/[0.02]">
                            <td className="px-3 py-2 text-slate-200 font-semibold">{tx.type}</td>
                            <td className="px-3 py-2 font-mono text-slate-400">{tx.reference ?? tx.id.slice(0, 8)}</td>
                            <td
                              className={`px-3 py-2 text-right font-mono font-bold ${
                                tx.type === 'DEPOSIT' || tx.type === 'BET_PAYOUT'
                                  ? 'text-emerald-400'
                                  : 'text-slate-200'
                              }`}
                            >
                              <MaskedAmount hide={hideBalances}>
                                {currencySymbol(tx.currency)}
                                {formatWalletAmount(tx.amount, tx.currency)}
                              </MaskedAmount>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                  STATUS_STYLE[tx.status] ?? 'bg-slate-500/10 text-slate-400'
                                }`}
                              >
                                {tx.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right text-slate-500">{formatRelativeTime(tx.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ── 4. TRADING OVERVIEW ── */}
          <section className="mb-6">
            <SectionHeader title="Trading Overview" link="/trading" linkLabel="Open trading terminal" />
            <div className="rounded-2xl border border-white/10 bg-ink-800 p-6">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                <StatCard
                  label="Portfolio Value"
                  value={
                    <MaskedAmount hide={hideBalances}>
                      ${formatWalletAmount(trading?.portfolioValue ?? 10000000, 'USD')}
                    </MaskedAmount>
                  }
                  color="text-white"
                />
                <StatCard
                  label="Virtual Balance"
                  value={
                    <MaskedAmount hide={hideBalances}>
                      ${formatWalletAmount(trading?.virtualBalance ?? 10000000, 'USD')}
                    </MaskedAmount>
                  }
                  color="text-teal-400"
                />
                <StatCard
                  label="Open Positions"
                  value={trading?.activePositionsCount ?? 0}
                  color={(trading?.activePositionsCount ?? 0) > 0 ? 'text-blue-400' : 'text-slate-300'}
                />
                <StatCard
                  label="Total Orders"
                  value={trading?.totalOrders ?? 0}
                  sub={`${trading?.openOrdersCount ?? 0} open`}
                />
              </div>

              {/* Market Overview Tickers & Recent Orders */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 border-t border-white/[0.06] pt-4">
                {/* Market Overview */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Market Overview</h3>
                    <Link href="/trading" className="text-xs text-teal-400 hover:text-teal-300">
                      View All Markets →
                    </Link>
                  </div>
                  {(!trading?.marketOverview || trading.marketOverview.length === 0) ? (
                    <p className="text-xs text-slate-500 py-3">Market feed loading...</p>
                  ) : (
                    <div className="space-y-1.5">
                      {trading.marketOverview.slice(0, 4).map((inst) => (
                        <div
                          key={inst.symbol}
                          className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] border border-white/5"
                        >
                          <div>
                            <span className="font-bold text-xs text-white">{inst.symbol}</span>
                            <span className="text-[10px] text-slate-500 ml-2">{inst.name}</span>
                          </div>
                          <div className="font-mono text-xs font-bold text-emerald-400">
                            ${formatWalletAmount(inst.basePrice, 'USD')}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Recent Trading Orders */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Recent Orders</h3>
                    <Link href="/trading" className="text-xs text-teal-400 hover:text-teal-300">
                      Order Book →
                    </Link>
                  </div>
                  {(!trading?.recentOrders || trading.recentOrders.length === 0) ? (
                    <p className="text-xs text-slate-500 py-3">No trading orders submitted yet.</p>
                  ) : (
                    <div className="space-y-1.5">
                      {trading.recentOrders.slice(0, 4).map((ord) => (
                        <div
                          key={ord.id}
                          className="flex items-center justify-between p-2 rounded-lg bg-white/[0.02] border border-white/5"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                ord.side === 'BUY'
                                  ? 'bg-emerald-500/15 text-emerald-300'
                                  : 'bg-rose-500/15 text-rose-300'
                              }`}
                            >
                              {ord.side}
                            </span>
                            <span className="font-mono text-xs font-semibold text-white">{ord.symbol}</span>
                          </div>
                          <div className="text-right">
                            <span className="font-mono text-xs text-slate-300">{ord.quantity} units</span>
                            <span className="text-[10px] text-slate-500 ml-2">
                              {STATUS_STYLE[ord.status] ? (
                                <span className={`px-1 py-0.2 rounded ${STATUS_STYLE[ord.status]}`}>
                                  {ord.status}
                                </span>
                              ) : (
                                ord.status
                              )}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </section>

          {/* ── 5. NOTIFICATIONS SECTION ── */}
          {notifications && (
            <section className="mb-6">
              <SectionHeader title="Notifications" link="/notifications" linkLabel="Notification center" />
              <div className="rounded-2xl border border-white/10 bg-ink-800 p-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-200">System Alerts & Notices</span>
                    {notifications.unreadCount > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-teal-500/20 text-teal-300 border border-teal-500/30">
                        {notifications.unreadCount} unread
                      </span>
                    )}
                  </div>
                  <Link href="/notifications" className="text-xs text-teal-400 hover:text-teal-300">
                    Mark all read →
                  </Link>
                </div>
                {notifications.items.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-4">No notifications at this time.</p>
                ) : (
                  <div className="divide-y divide-white/[0.04]">
                    {notifications.items.slice(0, 4).map((item) => (
                      <div key={item.id} className="py-2.5 flex items-start justify-between gap-3">
                        <div className="flex items-start gap-2.5">
                          <span className="text-sm shrink-0 mt-0.5">
                            {item.isRead ? '✉️' : '📩'}
                          </span>
                          <div>
                            <p className="text-xs font-bold text-white">{item.title}</p>
                            <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">{item.message}</p>
                          </div>
                        </div>
                        <span className="text-[10px] text-slate-600 shrink-0">
                          {formatRelativeTime(item.createdAt)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ── 6. REFERRAL SUMMARY ── */}
          {referral && (
            <section className="mb-6">
              <SectionHeader title="Referral Program" link="/affiliate" linkLabel="Full details" />
              <div className="rounded-2xl border border-white/10 bg-ink-800 p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                  <div>
                    <p className="text-xs text-slate-500 uppercase tracking-wider mb-1">Your Referral Code</p>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-lg text-white">{referral.referralCode}</span>
                      <button
                        onClick={() => handleCopyReferral(referral.referralCode)}
                        className="rounded px-2 py-0.5 text-xs font-medium border border-white/10 bg-white/[0.03] text-slate-300 hover:bg-white/5 transition"
                      >
                        {copiedRef ? '✓ Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <StatCard label="Total Referred" value={referral.totalReferred ?? 0} />
                  <StatCard label="Qualified" value={referral.qualifiedReferrals ?? 0} color="text-emerald-400" />
                  <StatCard
                    label="Total Earnings"
                    value={
                      <MaskedAmount hide={hideBalances}>
                        {currencySymbol(walletCurrency)}
                        {formatWalletAmount(referral.totalEarningsMinor ?? 0, walletCurrency)}
                      </MaskedAmount>
                    }
                    color="text-amber-400"
                  />
                </div>
              </div>
            </section>
          )}

          {/* ── 7. RECENT ACTIVITY ── */}
          <section className="mb-6">
            <SectionHeader title="Recent Activity" link="/profile" linkLabel="Full history" />
            <div className="rounded-2xl border border-white/10 bg-ink-800 overflow-hidden">
              {activity.length === 0 ? (
                <div className="p-8 text-center">
                  <p className="text-3xl mb-2">📋</p>
                  <p className="text-sm font-medium text-slate-300">No recent activity</p>
                  <p className="text-xs text-slate-500 mt-1">Your deposits, bets, trades and game results will appear here.</p>
                </div>
              ) : (
                <ul className="divide-y divide-white/[0.04]">
                  {activity.slice(0, 8).map((item) => (
                    <li key={item.id} className="flex items-center gap-3 px-5 py-3 hover:bg-white/[0.02] transition">
                      <span className="text-xl shrink-0">{ACTIVITY_ICON[item.kind] ?? '📄'}</span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-200 truncate">{item.title}</p>
                        {item.subtitle && <p className="text-xs text-slate-500 truncate">{item.subtitle}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        {item.amount != null && (
                          <p
                            className={`text-sm font-bold font-mono ${
                              item.amount >= 0 ? 'text-emerald-400' : 'text-red-400'
                            }`}
                          >
                            <MaskedAmount hide={hideBalances}>
                              {item.amount >= 0 ? '+' : ''}
                              {currencySymbol(item.currency ?? walletCurrency)}
                              {formatWalletAmount(Math.abs(item.amount), item.currency ?? walletCurrency)}
                            </MaskedAmount>
                          </p>
                        )}
                        <div className="flex items-center gap-1 justify-end mt-0.5">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                              STATUS_STYLE[item.status?.toUpperCase()] ?? 'bg-slate-500/10 text-slate-400'
                            }`}
                          >
                            {item.status?.replace(/_/g, ' ')}
                          </span>
                          <span className="text-[10px] text-slate-600">{formatRelativeTime(item.createdAt)}</span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* ── 8. QUICK ACTIONS ── */}
          <section className="mb-6">
            <SectionHeader title="Quick Actions" />
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {[
                { href: '/wallet/deposit', icon: '💳', label: 'Deposit', desc: 'Add funds' },
                { href: '/wallet/withdraw', icon: '📤', label: 'Withdraw', desc: 'Request payout' },
                { href: '/trading', icon: '📊', label: 'Trade', desc: 'Open terminal' },
                { href: '/wallet', icon: '💰', label: 'Wallet', desc: 'Manage funds' },
                { href: '/games/play', icon: '🎮', label: 'Games', desc: 'Play now' },
              ].map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  className="rounded-2xl border border-white/10 bg-ink-800 hover:border-teal-500/30 hover:bg-white/[0.04] p-4 text-center transition group"
                >
                  <div className="text-2xl mb-2">{action.icon}</div>
                  <p className="text-sm font-semibold text-slate-200 group-hover:text-white transition">
                    {action.label}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">{action.desc}</p>
                </Link>
              ))}
            </div>
          </section>
        </Fragment>
      )}
    </main>
  );
}
