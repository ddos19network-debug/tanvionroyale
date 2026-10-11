'use client';

/**
 * REFERRAL PROGRAM panel for the user profile.
 *
 * Existing TANVIONROYALE dark theme only: the same Card / Button / Skeleton /
 * typography / spacing vocabulary the other profile tabs use. No new design
 * system, no new colour palette.
 *
 * WHAT IT SHOWS
 *   - the caller's own code and shareable link, with copy buttons;
 *   - headline counters (total / qualified / pending / earned / paid);
 *   - the admin-configured qualification rule, so the user knows what is still
 *     required - the VALUES come from the server, never hard-coded here;
 *   - the referred users (username + MASKED email only - the API never returns
 *     anything more sensitive);
 *   - the reward history.
 *
 * Every number is server-computed. This component never derives money, never
 * posts an amount and never guesses a qualification - it only renders what
 * `GET /me/referral*` returned.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, Card, CardContent, CardHeader, CardTitle, Skeleton } from '@tanvion-royale/ui';
import type { MyReferredUser, ReferralRewardView } from '@tanvion-royale/types';
import {
  formatMinor,
  getMyReferral,
  getMyReferralRewards,
  getMyReferredUsers,
  syncMyReferral,
  type MyReferralResponse,
} from '@/lib/api/referral';
import { describeApiError } from '@/lib/api/client';
import { StatusBadge, copyText, fmtDate } from './profile-helpers';

/** Human wording for the admin-chosen qualification rule. */
const RULE_LABELS: Record<string, string> = {
  REGISTRATION: 'Sign up',
  VERIFIED_ACCOUNT: 'Sign up + verify your account',
  MIN_DEPOSIT: 'Sign up + a minimum deposit',
  MIN_WAGER: 'Sign up + a minimum wager',
  DEPOSIT_AND_WAGER: 'Sign up + a minimum deposit and wager',
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/5 bg-ink-800/60 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-100">{value}</p>
    </div>
  );
}

export function ReferralPanel() {
  const [data, setData] = useState<MyReferralResponse | null>(null);
  const [referred, setReferred] = useState<MyReferredUser[]>([]);
  const [rewards, setRewards] = useState<ReferralRewardView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summary, users, history] = await Promise.all([
        getMyReferral(),
        getMyReferredUsers(),
        getMyReferralRewards(),
      ]);
      setData(summary);
      setReferred(users.items);
      setRewards(history.items);
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Re-evaluates pending qualifications. Idempotent server-side: a referral that
  // already paid can never pay again.
  const onSync = useCallback(async () => {
    setSyncing(true);
    setError(null);
    try {
      await syncMyReferral();
      await load();
    } catch (err) {
      setError(describeApiError(err));
    } finally {
      setSyncing(false);
    }
  }, [load]);

  const onCopy = useCallback((value: string, which: 'code' | 'link') => {
    copyText(value);
    setCopied(which);
    window.setTimeout(() => setCopied(null), 2000);
  }, []);

  if (loading && !data) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <Card className="border-red-500/30 bg-red-500/5">
        <CardHeader>
          <CardTitle>Referral program</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-red-300">{error}</p>
          <Button onClick={() => void load()} variant="outline" size="sm">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;
  const { summary, settings } = data;
  const money = (value: number) => formatMinor(value, summary.currency);
  const ruleLabel = RULE_LABELS[settings.qualificationRule] ?? settings.qualificationRule;
  const showsMoney = settings.qualificationRule === 'MIN_DEPOSIT' ||
    settings.qualificationRule === 'MIN_WAGER' ||
    settings.qualificationRule === 'DEPOSIT_AND_WAGER';

  return (
    <div className="space-y-6" data-testid="referral-panel">
      {/* ---------------- Code + shareable link ---------------- */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Referral program</CardTitle>
          {!summary.programEnabled ? (
            <span className="rounded-full bg-ink-700 px-3 py-1 text-[11px] font-semibold text-slate-400">
              Coming soon
            </span>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-brand/20 bg-brand/5 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Your referral code
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <code
                data-testid="referral-code"
                className="select-all font-mono text-xl font-bold tracking-wider text-brand"
              >
                {summary.referralCode}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onCopy(summary.referralCode, 'code')}
              >
                {copied === 'code' ? 'Copied' : 'Copy Code'}
              </Button>
            </div>

            <p className="mt-4 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Referral link
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <code
                data-testid="referral-link"
                className="max-w-full break-all rounded bg-ink-900/60 px-2 py-1 font-mono text-xs text-slate-300"
              >
                {summary.referralLink}
              </code>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onCopy(summary.referralLink, 'link')}
              >
                {copied === 'link' ? 'Copied' : 'Copy Referral Link'}
              </Button>
            </div>
          </div>

          <p className="text-xs text-slate-400">
            To earn, a friend must <span className="font-semibold text-slate-300">{ruleLabel}</span>
            {showsMoney
              ? ` (${money(settings.minDepositAmount)} minimum deposit, ${money(
                  settings.minWagerAmount,
                )} minimum wager).`
              : '.'}
          </p>
        </CardContent>
      </Card>

      {/* ---------------- Counters ---------------- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Total referrals" value={String(summary.totalReferrals)} />
        <Stat label="Qualified" value={String(summary.qualifiedReferrals)} />
        <Stat label="Pending" value={String(summary.pendingReferrals)} />
        <Stat label="Earned" value={money(summary.totalEarned)} />
        <Stat label="Paid" value={money(summary.paidTotal)} />
        <Stat label="Available" value={money(summary.availableTotal)} />
      </div>

      {/* ---------------- Referred users ---------------- */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Your referrals</CardTitle>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void onSync()}
            disabled={syncing}
            title="Re-check whether any referral now meets the requirement"
          >
            {syncing ? 'Checking...' : 'Refresh status'}
          </Button>
        </CardHeader>
        <CardContent>
          {error ? <p className="mb-3 text-xs text-amber-300">{error}</p> : null}
          {referred.length === 0 ? (
            <p className="text-sm text-slate-500">
              No referrals yet. Share your link to get started.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[540px] text-left text-sm">
                <thead>
                  <tr className="border-b border-white/5 text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="py-2 pr-3 font-semibold">User</th>
                    <th className="py-2 pr-3 font-semibold">Joined</th>
                    <th className="py-2 pr-3 font-semibold">Status</th>
                    <th className="py-2 font-semibold">Bonus</th>
                  </tr>
                </thead>
                <tbody>
                  {referred.map((user) => (
                    <tr key={user.referralId} className="border-b border-white/5 last:border-0">
                      <td className="py-2 pr-3">
                        <p className="font-medium text-slate-200">{user.username}</p>
                        {user.maskedEmail ? (
                          <p className="text-[11px] text-slate-500">{user.maskedEmail}</p>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-xs text-slate-400">{fmtDate(user.joinedAt)}</td>
                      <td className="py-2 pr-3">
                        <StatusBadge value={user.status} />
                      </td>
                      <td className="py-2 font-medium text-slate-200">
                        {money(user.bonusEarned)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ---------------- Reward history ---------------- */}
      <Card>
        <CardHeader>
          <CardTitle>Referral history</CardTitle>
        </CardHeader>
        <CardContent>
          {rewards.length === 0 ? (
            <p className="text-sm text-slate-500">No rewards yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[540px] text-left text-sm">
                <thead>
                  <tr className="border-b border-white/5 text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="py-2 pr-3 font-semibold">With</th>
                    <th className="py-2 pr-3 font-semibold">Type</th>
                    <th className="py-2 pr-3 font-semibold">Status</th>
                    <th className="py-2 font-semibold">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {rewards.map((reward) => (
                    <tr key={reward.id} className="border-b border-white/5 last:border-0">
                      <td className="py-2 pr-3 text-slate-300">{reward.username ?? '-'}</td>
                      <td className="py-2 pr-3 text-xs text-slate-400">
                        {reward.recipient === 'REFERRER' ? 'Referrer bonus' : 'Welcome bonus'}
                      </td>
                      <td className="py-2 pr-3">
                        <StatusBadge value={reward.status} />
                      </td>
                      <td className="py-2 font-medium text-slate-200">
                        {formatMinor(reward.amount, reward.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
