'use client';

import { TradingShell } from '@/components/trading/trading-shell';

function EarnCard({
  title,
  description,
  ctaText,
  ctaHref,
}: {
  title: string;
  description: string;
  ctaText: string;
  ctaHref: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#121620] p-6 sm:p-8 shadow-sm hover:bg-white/5 transition">
      <div className="flex items-start gap-4 sm:items-center sm:flex-row-reverse">
        <div className="flex-shrink-0 rounded-lg bg-amber-500/20 p-3 sm:p-4">
          <svg className="h-5 w-5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M8 14s1.5 2 4 2 4-2 4-2" />
            <line x1="9" y1="9" x2="9.01" y2="9" />
            <line x1="15" y1="9" x2="15.01" y2="9" />
          </svg>
        </div>
        <div className="flex-1 pt-2 sm:pt-0">
          <h3 className="text-sm font-bold text-white tracking-tight">{title}</h3>
          <p className="text-[10px] text-slate-400 sm:text-sm">{description}</p>
        </div>
      </div>
      <div className="mt-4 sm:mt-0 text-right sm:text-left">
        <a
          href={ctaHref}
          className="inline-block rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-black transition hover:bg-amber-300 shadow-md shadow-amber-500/10 active:scale-95"
        >
          {ctaText}
        </a>
      </div>
    </div>
  );
}

export default function TradingEarnPage() {
  return (
    <TradingShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black text-white sm:text-3xl tracking-tight">
            Earn
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Grow your crypto with flexible and fixed-term savings options.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <EarnCard
            title="Flexible Savings"
            description="Earn passive income on your crypto holdings with no lock-up period. Redeem anytime."
            ctaText="Start Earning"
            ctaHref="/trading/earn/flexible"
          />
          <EarnCard
            title="Fixed-Term Savings"
            description="Lock your crypto for a fixed term to earn higher APY. Terms range from 30 to 90 days."
            ctaText="Choose Term"
            ctaHref="/trading/earn/fixed"
          />
          <EarnCard
            title="Staking"
            description="Support network security and earn rewards by staking supported cryptocurrencies."
            ctaText="Start Staking"
            ctaHref="/trading/earn/staking"
          />
        </div>
      </div>
    </TradingShell>
  );
}
