'use client';

/**
 * Admin - Referral program.
 *
 * Real endpoints (ADMIN / SUPER_ADMIN only; RBAC enforced server-side):
 *   GET   /admin/referral/settings
 *   PATCH /admin/referral/settings
 *   GET   /admin/referral/stats
 *   GET   /admin/referral/top-referrers
 *   GET   /admin/referral/referrers?search=
 *   GET   /admin/referral/rewards?search=&status=
 *   POST  /admin/referral/rewards/:id/adjust
 *
 * NOTHING about a reward is hard-coded in this page: every amount, rule, cap
 * and the on/off switch is read from and written to the server settings. The
 * page only collects input - the backend re-validates and recomputes everything.
 *
 * A manual adjustment REQUIRES a reason and is fully audited server-side, so a
 * balance is never silently changed.
 */

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@tanvion-royale/ui';
import type {
  ReferralAdminStats,
  ReferralBonusType,
  ReferralQualificationRule,
  ReferralSettingsView,
  ReferralTopReferrer,
} from '@tanvion-royale/types';
import {
  adjustReferralReward,
  formatMinor,
  getReferralSettings,
  getReferralStats,
  getTopReferrers,
  searchReferralRewards,
  searchReferrers,
  updateReferralSettings,
  type AdminRewardRow,
} from '@/lib/api/referral';
import { describeApiError } from '@/lib/api/client';
import { AdminPageHeader, AdminStatCard, formatDateTime } from '@/components/admin/ui';
import { useToast } from '@/components/admin/toast';
import AffiliateAdminPanel from '@/components/admin/affiliate-admin-panel';

const RULES: ReferralQualificationRule[] = [
  'REGISTRATION',
  'VERIFIED_ACCOUNT',
  'MIN_DEPOSIT',
  'MIN_WAGER',
  'DEPOSIT_AND_WAGER',
];
const TYPES: ReferralBonusType[] = ['FIXED_AMOUNT', 'PERCENTAGE'];
const RULE_LABELS: Record<string, string> = {
  REGISTRATION: 'Registration only',
  VERIFIED_ACCOUNT: 'Registration + verified account',
  MIN_DEPOSIT: 'Registration + minimum deposit',
  MIN_WAGER: 'Registration + minimum wager',
  DEPOSIT_AND_WAGER: 'Registration + deposit and wager',
};

const inputClass =
  'w-full rounded-md border border-white/10 bg-ink-800 px-3 py-2 text-sm text-slate-100 focus:border-brand/60 focus:outline-none';
const labelClass = 'flex flex-col gap-1 text-xs font-medium text-slate-400';

/** Minor units -> the major-unit string an admin types (25000 -> "250"). */
const toMajor = (minor: number) => (minor / 100).toFixed(2);
/** Major-unit string -> minor units ("250" -> 25000). */
const toMinor = (major: string) => {
  const n = Number(major);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

export default function AdminReferralPage() {
  const { toast } = useToast();
  const [stats, setStats] = useState<ReferralAdminStats | null>(null);
  const [settings, setSettings] = useState<ReferralSettingsView | null>(null);
  const [top, setTop] = useState<ReferralTopReferrer[]>([]);
  const [rewards, setRewards] = useState<AdminRewardRow[]>([]);
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<ReferralTopReferrer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [adjusting, setAdjusting] = useState<{ id: string; amount: string; reason: string } | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [s, st, t, r] = await Promise.all([
        getReferralSettings(),
        getReferralStats(),
        getTopReferrers(),
        searchReferralRewards({}),
      ]);
      setSettings(s);
      setStats(st);
      setTop(t.items);
      setRewards(r.items);
    } catch (err) {
      setError(describeApiError(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onSearch = useCallback(async () => {
    if (!search.trim()) {
      setSearchResults([]);
      return;
    }
    setError(null);
    try {
      const res = await searchReferrers(search.trim());
      setSearchResults(res.items);
    } catch (err) {
      setError(describeApiError(err));
    }
  }, [search]);

  /**
   * Saves the configuration. The server validates every value and the service
   * is the only thing that computes a reward from it.
   */
  const onSave = useCallback(async () => {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const saved = await updateReferralSettings({
        isEnabled: settings.isEnabled,
        currency: settings.currency,
        signupPath: settings.signupPath,
        referrerBonusType: settings.referrerBonusType,
        referrerBonusAmount: settings.referrerBonusAmount,
        referrerBonusPercent: settings.referrerBonusPercent,
        referredBonusType: settings.referredBonusType,
        referredBonusAmount: settings.referredBonusAmount,
        referredBonusPercent: settings.referredBonusPercent,
        qualificationRule: settings.qualificationRule,
        minDepositAmount: settings.minDepositAmount,
        minWagerAmount: settings.minWagerAmount,
        maxRewardPerReferral: settings.maxRewardPerReferral,
        maxTotalRewardPerUser: settings.maxTotalRewardPerUser,
        qualificationExpiresInDays: settings.qualificationExpiresInDays,
        requireVerifiedAccount: settings.requireVerifiedAccount,
      });
      setSettings(saved);
      toast('Referral settings saved', 'success');
      await load();
    } catch (err) {
      setError(describeApiError(err));
      toast(describeApiError(err), 'error');
    } finally {
      setSaving(false);
    }
  }, [settings, load, toast]);

  // A manual adjustment is always reasoned and always audited server-side.
  const onAdjust = useCallback(async () => {
    if (!adjusting) return;
    setError(null);
    try {
      await adjustReferralReward(adjusting.id, toMinor(adjusting.amount), adjusting.reason);
      toast('Reward adjusted', 'success');
      setAdjusting(null);
      await load();
    } catch (err) {
      setError(describeApiError(err));
      toast(describeApiError(err), 'error');
    }
  }, [adjusting, load, toast]);

  const money = (v: number) => formatMinor(v, stats?.currency ?? 'BDT');

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Referral program"
        description="Configure rewards, review referred users and audit every referral reward."
        crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Referral' }]}
      />

      {error ? (
        <p className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      {/* ---------------- Dashboard ---------------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <AdminStatCard
          label="Program"
          value={stats?.programEnabled ? 'ON' : 'OFF'}
          hint={`${stats?.totalReferrers ?? 0} referrers`}
        />
        <AdminStatCard label="Referred users" value={stats?.totalReferredUsers ?? 0} hint={`${stats?.qualifiedReferrals ?? 0} qualified`} />
        <AdminStatCard label="Pending" value={stats?.pendingReferrals ?? 0} hint={`${stats?.rejectedReferrals ?? 0} rejected`} />
        <AdminStatCard label="Rewards paid" value={money(stats?.paidRewardAmount ?? 0)} hint={`${stats?.totalRewards ?? 0} reward rows`} />
        <AdminStatCard label="Pending rewards" value={money(stats?.pendingRewardAmount ?? 0)} hint="Not yet paid" />
        <AdminStatCard label="Rejected rewards" value={money(stats?.rejectedRewardAmount ?? 0)} hint="Kept for audit" />
      </div>

      {/* ---------------- Settings ---------------- */}
      {settings ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Referral settings</CardTitle>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <input
                type="checkbox"
                data-testid="referral-enabled"
                checked={settings.isEnabled}
                onChange={(e) => setSettings({ ...settings, isEnabled: e.target.checked })}
                className="h-4 w-4 accent-brand"
              />
              Program {settings.isEnabled ? 'ON' : 'OFF'}
            </label>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className={labelClass}>
                Referrer reward type
                <select
                  className={inputClass}
                  value={settings.referrerBonusType}
                  onChange={(e) => setSettings({ ...settings, referrerBonusType: e.target.value as ReferralBonusType })}
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t === 'FIXED_AMOUNT' ? 'Fixed amount' : 'Percentage of deposit'}
                    </option>
                  ))}
                </select>
              </label>
              {settings.referrerBonusType === 'FIXED_AMOUNT' ? (
                <label className={labelClass}>
                  Referrer bonus
                  <input
                    className={inputClass}
                    inputMode="decimal"
                    value={toMajor(settings.referrerBonusAmount)}
                    onChange={(e) => setSettings({ ...settings, referrerBonusAmount: toMinor(e.target.value) })}
                  />
                </label>
              ) : (
                <label className={labelClass}>
                  Referrer percent (1-100)
                  <input
                    className={inputClass}
                    type="number"
                    min={0}
                    max={100}
                    value={settings.referrerBonusPercent}
                    onChange={(e) => setSettings({ ...settings, referrerBonusPercent: Number(e.target.value) })}
                  />
                </label>
              )}

              <label className={labelClass}>
                New user reward type
                <select
                  className={inputClass}
                  value={settings.referredBonusType}
                  onChange={(e) => setSettings({ ...settings, referredBonusType: e.target.value as ReferralBonusType })}
                >
                  {TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t === 'FIXED_AMOUNT' ? 'Fixed amount' : 'Percentage of deposit'}
                    </option>
                  ))}
                </select>
              </label>
              {settings.referredBonusType === 'FIXED_AMOUNT' ? (
                <label className={labelClass}>
                  New user bonus
                  <input
                    className={inputClass}
                    inputMode="decimal"
                    value={toMajor(settings.referredBonusAmount)}
                    onChange={(e) => setSettings({ ...settings, referredBonusAmount: toMinor(e.target.value) })}
                  />
                </label>
              ) : (
                <label className={labelClass}>
                  New user percent (1-100)
                  <input
                    className={inputClass}
                    type="number"
                    min={0}
                    max={100}
                    value={settings.referredBonusPercent}
                    onChange={(e) => setSettings({ ...settings, referredBonusPercent: Number(e.target.value) })}
                  />
                </label>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <label className={labelClass}>
                Qualification rule
                <select
                  data-testid="referral-rule"
                  className={inputClass}
                  value={settings.qualificationRule}
                  onChange={(e) => setSettings({ ...settings, qualificationRule: e.target.value as ReferralQualificationRule })}
                >
                  {RULES.map((r) => (
                    <option key={r} value={r}>
                      {RULE_LABELS[r]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={labelClass}>
                Minimum deposit
                <input
                  className={inputClass}
                  inputMode="decimal"
                  value={toMajor(settings.minDepositAmount)}
                  onChange={(e) => setSettings({ ...settings, minDepositAmount: toMinor(e.target.value) })}
                />
              </label>
              <label className={labelClass}>
                Minimum wager
                <input
                  className={inputClass}
                  inputMode="decimal"
                  value={toMajor(settings.minWagerAmount)}
                  onChange={(e) => setSettings({ ...settings, minWagerAmount: toMinor(e.target.value) })}
                />
              </label>
              <label className={labelClass}>
                Max reward per referral (0 = uncapped)
                <input
                  className={inputClass}
                  inputMode="decimal"
                  value={toMajor(settings.maxRewardPerReferral)}
                  onChange={(e) => setSettings({ ...settings, maxRewardPerReferral: toMinor(e.target.value) })}
                />
              </label>
              <label className={labelClass}>
                Max total reward per user (blank = uncapped)
                <input
                  className={inputClass}
                  inputMode="decimal"
                  value={settings.maxTotalRewardPerUser == null ? '' : toMajor(settings.maxTotalRewardPerUser)}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      maxTotalRewardPerUser: e.target.value.trim() === '' ? null : toMinor(e.target.value),
                    })
                  }
                />
              </label>
              <label className={labelClass}>
                Qualify within days (blank = never expires)
                <input
                  className={inputClass}
                  type="number"
                  min={0}
                  value={settings.qualificationExpiresInDays ?? ''}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      qualificationExpiresInDays: e.target.value.trim() === '' ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
              <label className={labelClass}>
                Signup link path
                <input
                  className={inputClass}
                  value={settings.signupPath}
                  onChange={(e) => setSettings({ ...settings, signupPath: e.target.value })}
                />
              </label>
              <label className="flex items-end gap-2 pb-2 text-xs font-semibold text-slate-300">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-brand"
                  checked={settings.requireVerifiedAccount}
                  onChange={(e) => setSettings({ ...settings, requireVerifiedAccount: e.target.checked })}
                />
                Also require a verified account
              </label>
            </div>

            <p className="text-[11px] text-slate-500">
              Percentage rewards are always bounded by the caps above, so they can never mint unlimited
              money. Amounts are in the wallet currency ({settings.currency}).
            </p>

            <Button onClick={() => void onSave()} disabled={saving} data-testid="referral-save">
              {saving ? 'Saving...' : 'Save settings'}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {/* ---------------- Search referrers ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Search referrers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap gap-2">
            <input
              className={`${inputClass} max-w-xs`}
              placeholder="Username, user ID or referral code"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void onSearch();
              }}
              data-testid="referral-search"
            />
            <Button variant="outline" onClick={() => void onSearch()}>
              Search
            </Button>
          </div>
          {searchResults.length > 0 ? (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/5 text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3 font-semibold">Username</th>
                  <th className="py-2 pr-3 font-semibold">Referral code</th>
                  <th className="py-2 font-semibold">Referred</th>
                </tr>
              </thead>
              <tbody>
                {searchResults.map((row) => (
                  <tr key={row.userId} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-3 text-slate-200">{row.username}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-slate-400">
                      {row.referralCode ?? '-'}
                    </td>
                    <td className="py-2 text-slate-200">{row.referredCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
        </CardContent>
      </Card>

      {/* ---------------- Top referrers ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Top referrers</CardTitle>
        </CardHeader>
        <CardContent>
          {top.length === 0 ? (
            <p className="text-sm text-slate-500">No referrals yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/5 text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="py-2 pr-3 font-semibold">Username</th>
                  <th className="py-2 pr-3 font-semibold">Code</th>
                  <th className="py-2 pr-3 font-semibold">Referred</th>
                  <th className="py-2 pr-3 font-semibold">Qualified</th>
                  <th className="py-2 font-semibold">Earned</th>
                </tr>
              </thead>
              <tbody>
                {top.map((row) => (
                  <tr key={row.userId} className="border-b border-white/5 last:border-0">
                    <td className="py-2 pr-3 text-slate-200">{row.username}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-slate-400">
                      {row.referralCode ?? '-'}
                    </td>
                    <td className="py-2 pr-3 text-slate-200">{row.referredCount}</td>
                    <td className="py-2 pr-3 text-slate-200">{row.qualifiedCount}</td>
                    <td className="py-2 text-slate-200">{money(row.earnedTotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* ---------------- Reward ledger + manual adjustment ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Referral rewards</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {adjusting ? (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <label className={labelClass}>
                Adjustment (major units, negative claws back)
                <input
                  className={inputClass}
                  inputMode="decimal"
                  value={adjusting.amount}
                  onChange={(e) => setAdjusting({ ...adjusting, amount: e.target.value })}
                />
              </label>
              <label className={`${labelClass} flex-1`}>
                Reason (required, permanently audited)
                <input
                  className={inputClass}
                  minLength={5}
                  value={adjusting.reason}
                  onChange={(e) => setAdjusting({ ...adjusting, reason: e.target.value })}
                />
              </label>
              <Button onClick={() => void onAdjust()}>Apply</Button>
              <Button variant="ghost" onClick={() => setAdjusting(null)}>
                Cancel
              </Button>
            </div>
          ) : null}

          {rewards.length === 0 ? (
            <p className="text-sm text-slate-500">No referral rewards yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead>
                  <tr className="border-b border-white/5 text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="py-2 pr-3 font-semibold">When</th>
                    <th className="py-2 pr-3 font-semibold">Recipient</th>
                    <th className="py-2 pr-3 font-semibold">Type</th>
                    <th className="py-2 pr-3 font-semibold">Status</th>
                    <th className="py-2 pr-3 font-semibold">Amount</th>
                    <th className="py-2 font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rewards.map((row) => (
                    <tr key={row.id} className="border-b border-white/5 last:border-0">
                      <td className="py-2 pr-3 text-xs text-slate-400">
                        {formatDateTime(row.createdAt)}
                      </td>
                      <td className="py-2 pr-3 text-slate-200">
                        {row.recipient === 'REFERRER' ? 'Referrer' : 'New user'}
                      </td>
                      <td className="py-2 pr-3 text-xs text-slate-400">
                        {row.username ?? row.referralCode}
                      </td>
                      <td className="py-2 pr-3 text-xs text-slate-300">{row.status}</td>
                      <td className="py-2 pr-3 text-slate-200">{formatMinor(row.amount, row.currency)}</td>
                      <td className="py-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setAdjusting({ id: row.id, amount: '0', reason: '' })}
                        >
                          Adjust
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Affiliate program. Mounted here (rather than as a second admin page)
          because the affiliate layer is a view over the SAME referral data —
          one page, one set of rules, no competing source of truth. */}
      <AffiliateAdminPanel />
    </div>
  );
}
