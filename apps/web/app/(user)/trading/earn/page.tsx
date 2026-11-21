'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TradingShell } from '@/components/trading/trading-shell';
import { claimTradingFaucet, formatMinor } from '@/lib/api/trading';
import { getMyReferral, type MyReferralResponse } from '@/lib/api/referral';
import { useAuth } from '@/src/lib/auth';

export default function TradingEarnPage() {
  const { ready, isAuthenticated } = useAuth();
  const [referralData, setReferralData] = useState<MyReferralResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [faucetMessage, setFaucetMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!ready || !isAuthenticated) return;
    let cancelled = false;

    getMyReferral()
      .then((data) => {
        if (!cancelled) setReferralData(data);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [ready, isAuthenticated]);

  async function handleClaimFaucet() {
    setFaucetLoading(true);
    try {
      const acc = await claimTradingFaucet(1_000_000, false);
      setFaucetMessage(`Success! Claimed ${formatMinor(1_000_000, acc.currency)} demo trading funds.`);
      setTimeout(() => setFaucetMessage(null), 4000);
    } catch {
      setFaucetMessage('Please sign in to claim demo trading funds.');
      setTimeout(() => setFaucetMessage(null), 4000);
    } finally {
      setFaucetLoading(false);
    }
  }

  function handleCopy(text: string) {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  const referralCode = referralData?.summary?.referralCode ?? 'ROYALE';
  const referralLink = typeof window !== 'undefined'
    ? `${window.location.origin}/signup?ref=${referralCode}`
    : `https://tanvionroyale.com/signup?ref=${referralCode}`;

  return (
    <TradingShell>
      <div className="space-y-8 max-w-6xl mx-auto py-2">
        {faucetMessage && (
          <div className="rounded-xl bg-amber-400/10 border border-amber-400/30 p-3.5 text-center text-xs font-bold text-amber-400 shadow-lg">
            {faucetMessage}
          </div>
        )}

        {/* Hero Banner */}
        <div className="relative overflow-hidden rounded-3xl border border-amber-500/20 bg-gradient-to-br from-ink-900 via-ink-900 to-[#1c1809] p-6 sm:p-10 shadow-2xl">
          <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-amber-400/10 blur-3xl pointer-events-none" />
          <div className="relative z-10 max-w-2xl space-y-3">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-[11px] font-bold text-amber-400 uppercase tracking-wider">
              <span>👑</span>
              <span>Royale Earn & Rewards</span>
            </div>
            <h1 className="text-2xl sm:text-4xl font-black text-white tracking-tight">
              Earn Rewards with TANVIONROYALE
            </h1>
            <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
              Unlock trading fee rebates, referral commissions, and practice risk-free with verified platform reward programs.
            </p>
          </div>
        </div>

        {/* 3 Core Earning Programs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Card 1: Referral & Affiliate */}
          <div className="flex flex-col justify-between rounded-2xl border border-ink-700/80 bg-ink-900/60 p-6 shadow-xl backdrop-blur">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-400/10 text-amber-400 font-bold text-lg">
                  🤝
                </span>
                <span className="rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400">
                  Active
                </span>
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Referral Program</h3>
                <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                  Invite friends to trade on TANVIONROYALE and earn up to 20% commission on trading fees and wagers.
                </p>
              </div>

              {isAuthenticated && referralData ? (
                <div className="rounded-xl border border-ink-800 bg-ink-950 p-3 space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Referred Users</span>
                    <span className="font-mono font-bold text-white">
                      {referralData.summary.totalReferrals}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-400">Total Commissions</span>
                    <span className="font-mono font-bold text-amber-400">
                      {formatMinor(referralData.summary.totalEarned, referralData.summary.currency || 'BDT')}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="mt-6 pt-4 border-t border-ink-800">
              <button
                type="button"
                onClick={() => handleCopy(referralLink)}
                className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-[#F0B90B] py-2.5 text-xs font-bold text-ink-950 hover:brightness-110 transition active:scale-95 shadow-md shadow-amber-500/10"
              >
                <span>{copied ? '✓ Link Copied' : 'Copy Referral Link'}</span>
              </button>
            </div>
          </div>

          {/* Card 2: Demo Faucet */}
          <div className="flex flex-col justify-between rounded-2xl border border-ink-700/80 bg-ink-900/60 p-6 shadow-xl backdrop-blur">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-400 font-bold text-lg">
                  💧
                </span>
                <span className="rounded-full bg-blue-500/10 border border-blue-500/20 px-2.5 py-0.5 text-[10px] font-bold text-blue-400">
                  Instant
                </span>
              </div>
              <div>
                <h3 className="text-base font-bold text-white">Demo Trading Faucet</h3>
                <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                  Claim $10,000 in virtual funds to test advanced trading strategies on the live market chart risk-free.
                </p>
              </div>

              <div className="rounded-xl border border-ink-800 bg-ink-950 p-3 space-y-1">
                <div className="text-[11px] text-slate-400">Claimable Amount</div>
                <div className="text-lg font-black text-white font-mono">$10,000.00 USD</div>
                <div className="text-[10px] text-slate-500">Virtual trading balance (no real funds required)</div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-ink-800">
              <button
                type="button"
                onClick={handleClaimFaucet}
                disabled={faucetLoading}
                className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-ink-700 bg-ink-800 py-2.5 text-xs font-bold text-white hover:border-amber-400/40 hover:text-amber-400 transition active:scale-95 disabled:opacity-50"
              >
                <span>{faucetLoading ? 'Processing...' : 'Claim $10,000 Demo Funds'}</span>
              </button>
            </div>
          </div>

          {/* Card 3: VIP Trading Rebates */}
          <div className="flex flex-col justify-between rounded-2xl border border-ink-700/80 bg-ink-900/60 p-6 shadow-xl backdrop-blur">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400 font-bold text-lg">
                  ⭐
                </span>
                <span className="rounded-full bg-purple-500/10 border border-purple-500/20 px-2.5 py-0.5 text-[10px] font-bold text-purple-400">
                  VIP Club
                </span>
              </div>
              <div>
                <h3 className="text-base font-bold text-white">VIP Fee Rebates</h3>
                <p className="mt-1 text-xs text-slate-400 leading-relaxed">
                  Higher trading volume automatically elevates your VIP status, granting up to 50% discount on maker/taker fees.
                </p>
              </div>

              <div className="rounded-xl border border-ink-800 bg-ink-950 p-3 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Tier 1 (Standard)</span>
                  <span className="font-mono text-slate-300">0.10% Fee</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-amber-400 font-medium">VIP Tier 5 (Pro)</span>
                  <span className="font-mono font-bold text-emerald-400">0.05% Fee (-50%)</span>
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-ink-800">
              <Link
                href="/trading/profile"
                className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-ink-700 bg-ink-800 py-2.5 text-xs font-bold text-white hover:border-amber-400/40 hover:text-amber-400 transition active:scale-95"
              >
                <span>View VIP Tier & Progress</span>
              </Link>
            </div>
          </div>
        </div>

        {/* Transparent Notice about Staking & Fixed Yields (Phase 4 Roadmap) */}
        <div className="rounded-2xl border border-ink-800 bg-ink-900/30 p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-400/10 text-amber-400 font-bold text-sm shrink-0">
              ℹ️
            </span>
            <div className="space-y-1">
              <h4 className="text-sm font-bold text-white">
                Upcoming Phase 4: Institutional Staking & Liquid Yield Vaults
              </h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                TANVIONROYALE does not display fabricated APY percentages or fake deposit lockups. Liquid staking contracts for ETH, SOL, and USDT yield farming are currently in audit and scheduled for deployment in Phase 4. Early announcements will appear directly in your notification center.
              </p>
            </div>
          </div>
        </div>
      </div>
    </TradingShell>
  );
}
