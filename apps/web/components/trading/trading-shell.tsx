'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { AppFooter } from '@/components/layout/app-footer';
import { claimTradingFaucet, formatMinor } from '@/lib/api/trading';

const TOP_MENU = [
  { href: '/', label: 'Home', icon: 'H' },
  { href: '/trading/buy-crypto', label: 'Buy Crypto', icon: 'B' },
  { href: '/trading/markets', label: 'Markets', icon: 'M' },
  { href: '/trading', label: 'Trade', icon: 'T' },
  { href: '/trading/earn', label: 'Earn', icon: 'E' },
  { href: '/trading/search', label: 'Search', icon: 'S' },
  { href: '/wallet/deposit', label: 'Deposit', icon: 'D' },
  { href: '/notifications', label: 'Notifications', icon: 'N' },
  { href: '/profile', label: 'Profile', icon: 'P' },
];

const ICON_MAP: Record<string, string> = {
  Home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9z',
  BuyCrypto: 'M3 3v12h18V3H3zM3 9h18v7H3V9z',
  Markets: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z',
  Trade: 'M3 3v18h18V3H3zm16 16H5V5h14v14zM7 7h5v5H7V7zm12 12H9V9h10v10z',
  Earn: 'M3 3v18h18V3H3zm2 16V9h2v10H5zm10 0V9h2v10h-2z',
  Search: 'M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  Deposit: 'M12 2L2 7l10 5 10-5-10-5zm0 9l10-5v13H2V6z',
  Notification: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9',
  Profile: 'M12 12c2.2 0 4-1.8 4-4s-1.8-4-4-4-4 1.8-4 4 4zm0 2c-2.6 0-5 1.3-5 3v3h10v-3c0-1.7-2.4-3-5-3zm0-10c-4.4 0-8 3.6-8 8v3h16v-3c0-4.4-3.6-8-8-8z',
};

export function TradingShell({
  children,
  fullWidth = false,
  onBalanceUpdated,
}: {
  children: React.ReactNode;
  fullWidth?: boolean;
  onBalanceUpdated?: () => void;
}) {
  const pathname = usePathname();
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [faucetMessage, setFaucetMessage] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const activeItem = TOP_MENU.find(
    (item) => pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href)),
  );

  async function handleFaucet(amountMinor = 1_000_000, reset = false) {
    setFaucetLoading(true);
    try {
      const acc = await claimTradingFaucet(amountMinor, reset);
      setFaucetMessage(
        reset
          ? `Balance reset to ${formatMinor(acc.virtualBalance, acc.currency)}.`
          : `Claimed ${formatMinor(amountMinor, acc.currency)} demo funds!`,
      );
      onBalanceUpdated?.();
      setTimeout(() => setFaucetMessage(null), 4000);
    } catch {
      setFaucetMessage('Could not claim faucet. Please ensure you are logged in.');
      setTimeout(() => setFaucetMessage(null), 4000);
    } finally {
      setFaucetLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#0b0e14] text-slate-100">
      {faucetMessage && (
        <div className="bg-emerald-500/20 px-4 py-2 text-center text-xs font-medium text-emerald-300 transition-all">
          {faucetMessage}
        </div>
      )}

      {/* Navigation Header */}
      <header className="border-b border-white/10 bg-[#121620]/95 backdrop-blur sticky top-0 z-30">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-3 sm:px-4 py-2 sm:py-2.5 gap-2 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-4">
            {/* Back Button to return to main Casino / Sports platform */}
            <Link
              href="/"
              onClick={(e) => {
                if (typeof window !== 'undefined' && window.opener && window.history.length <= 2) {
                  e.preventDefault();
                  window.close();
                }
              }}
              className="flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 px-2.5 sm:px-3 py-1.5 text-xs font-bold text-amber-300 hover:bg-amber-400/20 hover:text-amber-200 transition active:scale-95 shadow-sm"
              title="Return to Royale Main Platform"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span className="whitespace-nowrap">Back to Platform</span>
            </Link>

            <div className="h-5 w-px bg-white/10 hidden sm:block" />

            <Link href="/trading" className="flex items-center gap-2 text-white">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-tr from-amber-500 to-amber-300 font-black text-black shadow-lg shadow-amber-500/20">
                R
              </span>
              <div className="hidden xs:block">
                <span className="text-base font-bold tracking-tight text-white">ROYALE</span>
                <span className="ml-1 text-xs font-semibold uppercase tracking-wider text-amber-400">
                  EXCHANGE
                </span>
              </div>
            </Link>
          </div>

          {/* Desktop: First Letter | Tablet: Icons Only */}
          <nav
            className="hidden sm:flex items-center gap-1 sm:gap-2 overflow-x-auto scrollbar-none py-0.5"
            aria-label="Trading sections"
          >
            {TOP_MENU.map((item) => {
              const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex flex-col items-center gap-0.5 rounded-lg px-2 sm:px-2.5 py-1 text-[10px] sm:text-xs font-semibold whitespace-nowrap transition ${
                    active
                      ? 'bg-amber-400 text-black shadow-md shadow-amber-500/20 font-bold'
                      : 'border border-white/5 bg-white/[0.03] text-slate-300 hover:bg-white/[0.08] hover:text-white'
                  }`}
                >
                  <span className="text-xs sm:text-sm font-bold">{item.icon}</span>
                  <span className="hidden sm:block">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Mobile Hamburger */}
          <div className="flex items-center sm:hidden">
            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              className="inline-flex items-center justify-center p-2 rounded-md text-slate-300 hover:bg-white/5 hover:text-white transition"
              aria-label="Open menu"
              aria-expanded={mobileMenuOpen}
            >
              <svg
                className="h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      {/* Mobile Drawer Menu */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 flex flex-col sm:hidden bg-[#0b0e14] text-slate-100">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="inline-flex items-center justify-center p-2 rounded-md text-slate-300 hover:bg-white/5"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
            <div className="flex items-center gap-2 text-white">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-tr from-amber-500 to-amber-300 font-black text-black shadow-sm">
                R
              </span>
              <span className="text-sm font-bold tracking-tight">ROYALE</span>
            </div>
          </div>
          <nav className="flex-1 overflow-y-auto py-4 px-4 space-y-1">
            {TOP_MENU.map((item) => {
              const active = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition ${
                    active
                      ? 'bg-amber-400 text-black font-bold'
                      : 'text-slate-300 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <svg
                    className="h-5 w-5 shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={active ? 'black' : 'currentColor'}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {ICON_MAP[item.label]}
                  </svg>
                  <span className="text-sm font-medium">{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
      )}

      {/* Main Content */}
      <main
        className={
          fullWidth
            ? 'flex-1 w-full px-2 sm:px-4 py-4 pb-20 sm:pb-8'
            : 'mx-auto flex-1 w-full max-w-7xl px-4 py-6 pb-20 sm:pb-8'
        }
      >
        {children}
      </main>

      {!fullWidth && <AppFooter />}
    </div>
  );
}

/** Professional SVG sparkline for previewing mini price charts. */
export function Sparkline({ points, height = 36, width = 120 }: { points: number[]; height?: number; width?: number }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(height - ((p - min) / span) * (height - 4) - 2).toFixed(1)}`)
    .join(' ');
  const up = points[points.length - 1] >= points[0];
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="overflow-visible">
      <path d={d} fill="none" stroke={up ? '#10b981' : '#f43f5e'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
