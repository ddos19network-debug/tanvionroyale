'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { Button } from '@tanvion-royale/ui';
import { getAdminSummary, type AdminSummary } from '@/lib/api/admin';
import { ApiClientError } from '@/lib/api/client';
import {
  AdminPageHeader,
  AdminStatusBadge,
  formatDateTime,
  formatMinor,
} from '@/components/admin/ui';
import { useAdminPermission } from '@/components/admin/admin-guard';
import { currencySymbol } from '@/lib/api/wallet';

function formatCurrencyAmount(minor: number, currency: string) {
  const symbol = currencySymbol(currency);
  const major = (minor / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${symbol}${major}`;
}

export default function AdminDashboardPage() {
  const canReadDashboard = useAdminPermission(ADMIN_PERMISSIONS.DASHBOARD_READ);

  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAdminSummary();
      setSummary(data);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 403) {
        setError('You do not have permission to view the admin dashboard.');
      } else {
        setError(err instanceof Error ? err.message : 'Failed to load admin summary.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) {
    return (
      <div className="space-y-6">
        <AdminPageHeader
          title="Admin Dashboard"
          description="Platform operations and financial overview."
          crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Dashboard' }]}
        />
        <div className="rounded-xl border border-red-500/40 bg-red-950/50 p-6 text-center">
          <p className="text-sm font-medium text-red-300">{error}</p>
          <Button onClick={() => void load()} className="mt-4" variant="secondary" size="sm">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  const financial = summary?.financial;
  const wallets = summary?.wallets;
  const users = summary?.users;
  const system = summary?.system;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <AdminPageHeader
          title="Executive Administration Dashboard"
          description="Real-time financial liabilities, pending operations, and platform health."
          crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Dashboard' }]}
        />
        <div className="flex items-center gap-3">
          {system?.generatedAt && (
            <span className="text-xs text-slate-500">
              Updated: {formatDateTime(system.generatedAt)}
            </span>
          )}
          <Button onClick={() => void load()} disabled={loading} variant="secondary" size="sm">
            {loading ? 'Refreshing…' : '↻ Refresh'}
          </Button>
        </div>
      </div>

      {loading && !summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 rounded-xl border border-white/5 bg-ink-800 animate-pulse" />
          ))}
        </div>
      )}

      {summary && (
        <>
          {/* ── 1. ACTION REQUIRED NOTICES ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* Pending Deposits */}
            <Link
              href="/admin/manual-deposits"
              className={`rounded-2xl border p-5 transition flex flex-col justify-between ${
                (financial?.pendingDeposits ?? 0) > 0
                  ? 'border-amber-500/40 bg-amber-950/20 hover:border-amber-500/70'
                  : 'border-white/10 bg-ink-800 hover:border-white/20'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Pending Deposits
                  </p>
                  <span className="text-xl">💰</span>
                </div>
                <p className="text-3xl font-black text-white mt-2">
                  {financial?.pendingDeposits ?? 0}
                </p>
              </div>
              <p className="text-xs font-medium text-amber-400 mt-4">
                {(financial?.pendingDeposits ?? 0) > 0 ? 'Review & approve proof →' : 'No pending submissions'}
              </p>
            </Link>

            {/* Pending Withdrawals */}
            <Link
              href="/admin/manual-withdrawals"
              className={`rounded-2xl border p-5 transition flex flex-col justify-between ${
                (financial?.pendingWithdrawals ?? 0) > 0
                  ? 'border-rose-500/40 bg-rose-950/20 hover:border-rose-500/70'
                  : 'border-white/10 bg-ink-800 hover:border-white/20'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Pending Withdrawals
                  </p>
                  <span className="text-xl">💸</span>
                </div>
                <p className="text-3xl font-black text-white mt-2">
                  {financial?.pendingWithdrawals ?? 0}
                </p>
              </div>
              <p className="text-xs font-medium text-rose-400 mt-4">
                {(financial?.pendingWithdrawals ?? 0) > 0 ? 'Review & process payouts →' : 'No pending payouts'}
              </p>
            </Link>

            {/* Moderation Alerts */}
            <Link
              href="/admin/users"
              className="rounded-2xl border border-white/10 bg-ink-800 p-5 transition hover:border-white/20 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Total Users
                  </p>
                  <span className="text-xl">👥</span>
                </div>
                <p className="text-3xl font-black text-white mt-2">
                  {users?.total ?? 0}
                </p>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-400 mt-4">
                <span className="text-emerald-400 font-semibold">{users?.active ?? 0} Active</span>
                <span>•</span>
                <span className="text-amber-400 font-semibold">{users?.pending ?? 0} Pending</span>
                <span>•</span>
                <span className="text-rose-400 font-semibold">{users?.suspended ?? 0} Suspended</span>
              </div>
            </Link>
          </div>

          {/* ── 2. FINANCIAL LIABILITIES & VOLUME ── */}
          <div className="rounded-2xl border border-white/10 bg-ink-800 p-6 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white">Platform Financial Ledger Summary</h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  Aggregate customer balances and platform liabilities across all supported currencies.
                </p>
              </div>
              <Link href="/admin/wallets" className="text-xs text-teal-400 hover:text-teal-300 font-medium">
                Adjust Ledger →
              </Link>
            </div>

            {/* Volume Aggregates */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                <p className="text-xs uppercase tracking-wider text-slate-500">Completed Deposits</p>
                <p className="text-2xl font-black text-emerald-400 mt-1">
                  ৳{formatMinor(financial?.totalDepositsMinor ?? 0)}
                </p>
                <p className="text-[11px] text-slate-500 mt-1">Customer credited deposits</p>
              </div>

              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                <p className="text-xs uppercase tracking-wider text-slate-500">Completed Withdrawals</p>
                <p className="text-2xl font-black text-rose-400 mt-1">
                  ৳{formatMinor(financial?.totalWithdrawalsMinor ?? 0)}
                </p>
                <p className="text-[11px] text-slate-500 mt-1">Settled customer payouts</p>
              </div>

              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                <p className="text-xs uppercase tracking-wider text-slate-500">Active Customer Wallets</p>
                <p className="text-2xl font-black text-white mt-1">
                  {wallets?.wallets ?? 0}
                </p>
                <p className="text-[11px] text-slate-500 mt-1">Across all currencies</p>
              </div>

              <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5">
                <p className="text-xs uppercase tracking-wider text-slate-500">Database Status</p>
                <div className="flex items-center gap-2 mt-2">
                  <span
                    className={`h-3 w-3 rounded-full ${
                      system?.database === 'up' ? 'bg-emerald-400 animate-pulse' : 'bg-red-500'
                    }`}
                  />
                  <span className="text-sm font-bold text-white uppercase">{system?.database ?? 'UP'}</span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1">PostgreSQL 15+ ACID</p>
              </div>
            </div>

            {/* Currency Breakdown Table */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
                Customer Balances By Currency
              </p>
              <div className="overflow-x-auto rounded-xl border border-white/5 bg-ink-900/50">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-white/5 bg-white/[0.02]">
                      <th className="px-4 py-3 text-slate-400 uppercase font-semibold">Currency</th>
                      <th className="px-4 py-3 text-right text-slate-400 uppercase font-semibold">Total Accounts</th>
                      <th className="px-4 py-3 text-right text-slate-400 uppercase font-semibold">Available Liability</th>
                      <th className="px-4 py-3 text-right text-slate-400 uppercase font-semibold">Locked / Reserved</th>
                      <th className="px-4 py-3 text-right text-slate-400 uppercase font-semibold">Total Liability</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {wallets?.byCurrency.map((c) => (
                      <tr key={c.currency} className="hover:bg-white/[0.02]">
                        <td className="px-4 py-3 font-bold text-white flex items-center gap-2">
                          <span className="h-6 w-6 rounded bg-teal-500/15 text-teal-300 flex items-center justify-center font-mono">
                            {currencySymbol(c.currency)}
                          </span>
                          {c.currency}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-slate-300">{c.wallets}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-emerald-400">
                          {formatCurrencyAmount(c.availableMinor, c.currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-amber-400">
                          {formatCurrencyAmount(c.lockedMinor, c.currency)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-white">
                          {formatCurrencyAmount(c.availableMinor + c.lockedMinor, c.currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* ── 3. RECENT TRANSACTIONS ── */}
          {financial?.recentTransactions && financial.recentTransactions.length > 0 && (
            <div className="rounded-2xl border border-white/10 bg-ink-800 p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-white">Recent Financial Transactions</h2>
                  <p className="text-xs text-slate-400 mt-0.5">Latest system-wide ledger activity.</p>
                </div>
                <Link href="/admin/wallets" className="text-xs text-teal-400 hover:text-teal-300 font-medium">
                  Search By User →
                </Link>
              </div>

              <div className="overflow-x-auto rounded-xl border border-white/5 bg-ink-900/50">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-white/5 bg-white/[0.02]">
                      <th className="px-4 py-3 text-slate-400 uppercase font-semibold">Type</th>
                      <th className="px-4 py-3 text-slate-400 uppercase font-semibold">User ID</th>
                      <th className="px-4 py-3 text-slate-400 uppercase font-semibold">Reference</th>
                      <th className="px-4 py-3 text-right text-slate-400 uppercase font-semibold">Amount</th>
                      <th className="px-4 py-3 text-center text-slate-400 uppercase font-semibold">Status</th>
                      <th className="px-4 py-3 text-right text-slate-400 uppercase font-semibold">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {financial.recentTransactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-white/[0.02]">
                        <td className="px-4 py-3 font-semibold text-slate-200">{tx.type}</td>
                        <td className="px-4 py-3 font-mono text-slate-400">{tx.userId.slice(0, 8)}…</td>
                        <td className="px-4 py-3 font-mono text-slate-400">{tx.reference ?? '—'}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-white">
                          {formatCurrencyAmount(tx.amount, tx.currency)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <AdminStatusBadge value={tx.status} />
                        </td>
                        <td className="px-4 py-3 text-right text-slate-400">{formatDateTime(tx.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── 4. QUICK ADMINISTRATIVE LINKS ── */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <Link
              href="/admin/manual-deposits"
              className="p-4 rounded-xl border border-white/10 bg-ink-800 hover:border-teal-500/50 transition text-center"
            >
              <div className="text-2xl mb-1">💳</div>
              <p className="text-sm font-bold text-white">Manual Deposits</p>
              <p className="text-xs text-slate-400 mt-0.5">Review transaction proofs</p>
            </Link>

            <Link
              href="/admin/manual-withdrawals"
              className="p-4 rounded-xl border border-white/10 bg-ink-800 hover:border-teal-500/50 transition text-center"
            >
              <div className="text-2xl mb-1">🏦</div>
              <p className="text-sm font-bold text-white">Manual Withdrawals</p>
              <p className="text-xs text-slate-400 mt-0.5">Process customer payouts</p>
            </Link>

            <Link
              href="/admin/payment-methods"
              className="p-4 rounded-xl border border-white/10 bg-ink-800 hover:border-teal-500/50 transition text-center"
            >
              <div className="text-2xl mb-1">⚙️</div>
              <p className="text-sm font-bold text-white">Payment Methods</p>
              <p className="text-xs text-slate-400 mt-0.5">Configure gateways & limits</p>
            </Link>

            <Link
              href="/admin/audit-logs"
              className="p-4 rounded-xl border border-white/10 bg-ink-800 hover:border-teal-500/50 transition text-center"
            >
              <div className="text-2xl mb-1">🧾</div>
              <p className="text-sm font-bold text-white">Audit Trail</p>
              <p className="text-xs text-slate-400 mt-0.5">Immutable action log</p>
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
