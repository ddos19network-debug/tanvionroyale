'use client';

import { useCallback, useEffect, useState, Fragment } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@tanvion-royale/ui';
import { useAuth } from '@/src/lib/auth';
import { getDashboardOverview } from '@/lib/api/dashboard';
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

function formatNumber(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(n: number): string {
  const sign = n >= 0 ? '+' : '-';
  return '\$' + sign + '\$' + Math.abs(n).toFixed(2) + '%';
}

export default function DashboardPage() {
  const router = useRouter();
  const { ready, isAuthenticated } = useAuth();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hideBalances, setHideBalances] = useState(false);

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

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (ready && isAuthenticated && !data && !loading) { void load(); }
  }, [ready, isAuthenticated, data, loading, load]);

  if (loadError) {
    return (
      <main className="mx-auto max-w-7xl px-4 py-8">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="mt-4 rounded-md border border-red-500/40 bg-red-950/50 px-4 py-3" role="status">
          <p className="text-sm font-medium text-red-300">{loadError}</p>
          <button onClick={() => { setLoadError(null); void load(); }} className="mt-3 text-sm text-teal-400 underline underline-offset-4 hover:text-teal-300">Try again</button>
        </div>
      </main>
    );
  }

  const profile = data?.profile;
  const wallet = data?.wallet;
  const trading = data?.trading;
  const betting = data?.betting;
  const referral = data?.referral;
  const activity = data?.activity ?? [];
  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-6 mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          <p className="mt-1 text-sm text-slate-400">Your TANVIONROYALE account - profile, wallet, trading, betting and activity at a glance.</p>
        </div>
        {!loading && !loadError && (
          <div className="flex items-center gap-3">
            <button onClick={() => setHideBalances((prev) => !prev)} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-medium text-slate-300 hover:bg-white/5 transition">
              {hideBalances ? 'Show balances' : 'Hide balances'}
            </button>
          </div>
        )}
      </div>

      {data ? (
        <Fragment>
          <section className="mb-8">
            <div className="rounded-2xl border border-white/10 bg-ink-800 p-6">
              <div className="flex flex-col md:flex-row md:items-center gap-6">
                <div className="flex items-center gap-4">
                  {profile?.avatarUrl ? (
                    <img src={profile.avatarUrl} alt="Profile" className="w-16 h-16 rounded-full bg-ink-700 object-cover border border-white/10" />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-teal-500/20 to-blue-500/20 flex items-center justify-center">
                      <span className="text-xl font-bold text-teal-300">{profile?.username?.charAt(0)?.toUpperCase() ?? 'U'}</span>
                    </div>
                  )}
                  <div>
                    <h2 className="text-lg font-bold text-white">{profile?.username ?? 'User'}</h2>
                    <p className="text-xs text-slate-400 font-mono">UID: {profile?.uid ?? '—'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right hidden md:block">
                    <p className="text-xs text-slate-500 uppercase tracking-wider">Account status</p>
                    <p className="text-sm font-medium text-white">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${profile?.status === 'ACTIVE' ? 'bg-emerald-500/15 text-emerald-400' : profile?.status === 'SUSPENDED' || profile?.status === 'LOCKED' ? 'bg-red-500/15 text-red-400' : 'bg-slate-500/10 text-slate-400'}`}>
                      {STATUS_LABEL[profile?.status ?? ''] ?? profile?.status}
                    </span>
                    </p>
                  </div>
                  <div className="text-right hidden md:block">
                    <p className="text-xs text-slate-500 uppercase tracking-wider">VIP status</p>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-amber-400">{profile?.vipTitle ?? 'Regular'}</span>
                      <span className="text-xs text-slate-400 bg-white/[0.05] px-2 py-0.5 rounded">Level {profile?.vipLevel ?? 1}</span>
                    </div>
                  </div>
                  <div className="md:hidden w-full flex justify-end">
                    <Button variant="outline" size="sm" onClick={() => router.replace('/profile')}>View Profile</Button>
                  </div>
                </div>
              </div>
              <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4 border-t border-white/10 pt-6">
                <div className="p-4 rounded-xl bg-white/[0.02]"><p className="text-xs text-slate-500 uppercase tracking-wider">Email</p><p className="text-sm font-medium text-slate-200 truncate">{profile?.email ?? 'Not set'}</p></div>
                <div className="p-4 rounded-xl bg-white/[0.02]"><p className="text-xs text-slate-500 uppercase tracking-wider">Verification</p><p className="text-sm font-medium text-slate-200">{KYC_LABEL[profile?.kycStatus ?? 'NOT_STARTED'] ?? profile?.kycStatus}</p></div>
                <div className="p-4 rounded-xl bg-white/[0.02]"><p className="text-xs text-slate-500 uppercase tracking-wider">Social links</p><p className="text-sm font-medium text-slate-200">{profile?.socialLinked ? 'Connected' : 'Not connected'}</p></div>
                <div className="p-4 rounded-xl bg-white/[0.02]"><p className="text-xs text-slate-500 uppercase tracking-wider">Member since</p><p className="text-sm font-medium text-slate-200">{new Date(profile?.createdAt ?? Date.now()).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}</p></div>
              </div>
            </div>
          </section>
        </Fragment>
      ) : null}
    </main>
  );
}
