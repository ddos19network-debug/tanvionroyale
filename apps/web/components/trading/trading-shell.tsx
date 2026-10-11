'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AppFooter } from '@/components/layout/app-footer';

const TABS = [
  { href: '/trading', label: 'Overview' },
  { href: '/trading/markets', label: 'Markets' },
  { href: '/trading/portfolio', label: 'Portfolio' },
  { href: '/trading/history', label: 'History' },
  { href: '/trading/leaderboard', label: 'Leaderboard' },
];

/**
 * Shared shell for the TANVION ROYALE paper-trading section.
 * The PAPER banner is ALWAYS rendered: this is a virtual simulator, never
 * real brokerage, and the virtual balance is not the platform wallet.
 */
export function TradingShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <>
      <main className="mx-auto max-w-6xl px-4 py-8 pb-24 sm:pb-10">
        <div
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300"
          role="note"
        >
          <span className="font-bold uppercase tracking-wide">Paper trading</span> — virtual money
          only. Balances here are simulator credits, separate from your wallet, and can never be
          deposited, withdrawn or exchanged. Prices are clearly labelled; without a configured
          market-data feed they are DEMO data.
        </div>

        <nav className="mt-4 flex flex-wrap gap-2" aria-label="Trading sections">
          {TABS.map((tab) => {
            const active =
              tab.href === '/trading' ? pathname === '/trading' : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? 'page' : undefined}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
                  active
                    ? 'bg-brand text-ink-950'
                    : 'border border-white/10 bg-ink-800 text-slate-300 hover:bg-white/5'
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-6">{children}</div>
      </main>
      <AppFooter />
    </>
  );
}

/** Minimal SVG sparkline for DEMO price history (presentation only). */
export function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const w = 220;
  const h = 56;
  const step = w / (points.length - 1);
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - ((p - min) / span) * h).toFixed(1)}`)
    .join(' ');
  const up = points[points.length - 1] >= points[0];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="max-w-full">
      <path d={d} fill="none" stroke={up ? '#34d399' : '#f87171'} strokeWidth="2" />
    </svg>
  );
}