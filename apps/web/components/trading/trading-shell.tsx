'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AppFooter } from '@/components/layout/app-footer';
import { SearchOverlay } from '@/components/home/SearchOverlay';
import { LogoMark } from '@/components/brand/logo';
import { claimTradingFaucet, formatMinor, formatPrice, formatPercent } from '@/lib/api/trading';
import { useAuth } from '@/src/lib/auth';

const TOP_MENU = [
  { href: '/trading/home', label: 'Home' },
  { href: '/trading/market', label: 'Market' },
  { href: '/trading/buy-crypto', label: 'Buy Crypto' },
  { href: '/trading', label: 'Trade' },
  { href: '/trading/earn', label: 'Earn' },
  { href: '/trading/deposit', label: 'Deposit' },
  { href: '/trading/notification', label: 'Notification' },
  { href: '/trading/profile', label: 'Profile' },
];

const MAIN_NAV = [
  { href: '/trading/home', label: 'Home' },
  { href: '/trading/market', label: 'Market' },
  { href: '/trading/buy-crypto', label: 'Buy Crypto' },
  { href: '/trading', label: 'Trade' },
  { href: '/trading/earn', label: 'Earn' },
];

const SEARCHABLE_PAIRS = [
  { symbol: 'BTCUSD', name: 'Bitcoin', price: 7586000, change: 320, type: 'CRYPTO' },
  { symbol: 'ETHUSD', name: 'Ethereum', price: 384000, change: 185, type: 'CRYPTO' },
  { symbol: 'SOLUSD', name: 'Solana', price: 19850, change: -85, type: 'CRYPTO' },
  { symbol: 'BNBUSD', name: 'BNB', price: 61500, change: 120, type: 'CRYPTO' },
  { symbol: 'NVDA', name: 'NVIDIA Corp', price: 14200, change: 450, type: 'STOCK' },
  { symbol: 'AAPL', name: 'Apple Inc', price: 22800, change: 65, type: 'STOCK' },
  { symbol: 'XAUUSD', name: 'Gold Spot', price: 274000, change: 42, type: 'COMMODITY' },
  { symbol: 'TSLA', name: 'Tesla Inc', price: 21800, change: -120, type: 'STOCK' },
];

const ICON_MAP: Record<string, string> = {
  Home: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9z',
  Market: 'M3 3v18h18V3H3zm16 16H5V5h14v14zM7 7h5v5H7V7zm12 12H9V9h10v10z',
  'Buy Crypto': 'M12 2L2 7l10 5 10-5-10-5zm0 9l-10-5v8l10 5 10-5V6z',
  Trade: 'M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4',
  Earn: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 8v1m0 0c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  Deposit: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
  Notification: 'M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 0 1-3.46 0',
  Profile: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z',
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
  const router = useRouter();
  const { user, logout } = useAuth();

  const [mounted, setMounted] = useState(false);
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [faucetMessage, setFaucetMessage] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  // Search box state in menu
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDropdownOpen, setSearchDropdownOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Keyboard shortcut Ctrl+K to focus search box or open search
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (window.innerWidth >= 1280) {
          searchInputRef.current?.focus();
          setSearchDropdownOpen(true);
        } else {
          setSearchOpen(true);
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Close search dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setSearchDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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

  const isDepositActive =
    pathname.startsWith('/trading/deposit') || pathname.startsWith('/wallet/deposit');
  const isNotificationActive =
    pathname.startsWith('/trading/notification') || pathname.startsWith('/notifications');
  const isProfileActive =
    pathname.startsWith('/trading/profile') || pathname.startsWith('/profile');

  const filteredPairs = SEARCHABLE_PAIRS.filter(
    (p) =>
      p.symbol.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.name.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  // Hydration-safe UID & display name
  const uid = mounted && user?.id
    ? String(Math.abs(hashString(user.id))).padStart(10, '0').slice(0, 10)
    : '1147705039';

  const displayName = mounted && user?.username
    ? user.username
    : mounted && user?.firstName
    ? `${user.firstName} ${user.lastName ?? ''}`.trim()
    : 'user';

  function hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return hash;
  }

  return (
    <div className="flex min-h-screen flex-col bg-ink-950 text-slate-100">
      {faucetMessage && (
        <div className="bg-brand/20 border-b border-brand/30 px-4 py-2 text-center text-xs font-semibold text-brand transition-all">
          {faucetMessage}
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════════
          TRADING HEADER  —  3 zones: [LEFT: logo+back] [CENTER: nav] [RIGHT: actions]
          All zones are flex-shrink-safe. Zero overlap at any screen width.
          ═══════════════════════════════════════════════════════════════════ */}
      <header className="border-b border-ink-700/80 bg-ink-900/95 backdrop-blur sticky top-0 z-30 shadow-md">
        <div className="mx-auto flex max-w-[1400px] items-center px-2 sm:px-3 py-2 gap-2">

          {/* ── ZONE 1: Back button + Logo (always visible, shrink-0) ── */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Back Button */}
            <Link
              href="/"
              onClick={(e) => {
                if (typeof window !== 'undefined' && window.opener && window.history.length <= 2) {
                  e.preventDefault();
                  window.close();
                }
              }}
              className="flex items-center gap-1 rounded-full border border-ink-700/80 bg-ink-800/80 p-1.5 sm:px-2.5 sm:py-1 text-xs font-semibold text-slate-300 hover:border-brand/40 hover:text-brand hover:bg-brand/5 transition active:scale-95 shadow-sm shrink-0"
              title="Return to Royale Main Platform"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              <span className="whitespace-nowrap hidden lg:inline">Back</span>
            </Link>

            {/* ROYALE EXCHANGE Logo */}
            <Link href="/trading/home" className="flex items-center gap-1.5 text-white shrink-0 group">
              <LogoMark className="h-7 w-7 sm:h-8 sm:w-8 shrink-0 transition group-hover:scale-105" />
              <div className="hidden sm:flex items-center">
                <span className="text-sm font-bold tracking-tight text-white">ROYALE</span>
                <span className="ml-1 text-xs font-semibold uppercase tracking-wider text-amber-400">EXCHANGE</span>
              </div>
            </Link>
          </div>

          {/* ── ZONE 2: Nav links (shrink-0, hidden on mobile, all 5 items visible on md+) ── */}
          <nav
            className="hidden md:flex items-center gap-1 lg:gap-2 shrink-0 mx-2 lg:mx-4 min-w-0"
            aria-label="Trading sections"
          >
            {MAIN_NAV.map((item) => {
              const active =
                item.href === '/trading/home'
                  ? pathname === '/trading/home' || pathname === '/trading/'
                  : item.href === '/trading'
                  ? pathname === '/trading'
                  : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center rounded-full px-2 lg:px-2.5 py-1 text-xs lg:text-sm font-semibold whitespace-nowrap transition ${
                    active
                      ? 'border border-brand/50 bg-brand/10 text-brand font-bold shadow-sm'
                      : 'text-slate-300 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* ── ZONE 3: Search + Deposit + Notification + Profile (shrink-0, ml-auto) ── */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 ml-auto pl-2">

            {/* Search pill — xl+ screens only (compact width to keep comfortable distance from Trade/Earn) */}
            <div ref={searchContainerRef} className="hidden xl:block relative mr-1">
              <label className="relative block">
                <span className="sr-only">Search coins and pairs</span>
                <svg
                  width="13" height="13"
                  viewBox="0 0 24 24" fill="none"
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500"
                  aria-hidden="true"
                >
                  <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                  <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
                <input
                  ref={searchInputRef}
                  type="search"
                  value={searchQuery}
                  onChange={(e) => {
                    setSearchQuery(e.target.value);
                    setSearchDropdownOpen(true);
                  }}
                  onFocus={() => setSearchDropdownOpen(true)}
                  placeholder="Search coins, pairs..."
                  aria-label="Search"
                  className="h-8 w-32 xl:w-36 2xl:w-40 rounded-full border border-white/10 bg-ink-800 pl-7 pr-3 text-xs text-white placeholder:text-slate-500 outline-none focus:border-brand transition-all"
                />
              </label>

              {/* Search dropdown */}
              {searchDropdownOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-72 z-50 rounded-2xl border border-ink-700 bg-ink-900 shadow-2xl overflow-hidden py-1">
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-ink-800 flex items-center justify-between">
                    <span>Markets</span>
                    <Link
                      href="/trading/market"
                      onClick={() => setSearchDropdownOpen(false)}
                      className="text-brand hover:underline font-bold"
                    >
                      All Markets &gt;
                    </Link>
                  </div>
                  <div className="max-h-60 overflow-y-auto divide-y divide-ink-800">
                    {filteredPairs.length === 0 ? (
                      <div className="px-3 py-4 text-center text-xs text-slate-400">
                        No coins found for &quot;{searchQuery}&quot;
                      </div>
                    ) : (
                      filteredPairs.map((p) => {
                        const isUp = p.change >= 0;
                        return (
                          <div
                            key={p.symbol}
                            onClick={() => {
                              router.push(`/trading?symbol=${p.symbol}`);
                              setSearchDropdownOpen(false);
                              setSearchQuery('');
                            }}
                            className="flex items-center justify-between px-3 py-2 hover:bg-ink-800/60 cursor-pointer transition text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand/10 text-[10px] font-bold text-brand">
                                {p.symbol.slice(0, 3)}
                              </span>
                              <div>
                                <div className="font-bold text-white">{p.symbol}</div>
                                <div className="text-[10px] text-slate-400">{p.name}</div>
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-mono font-bold text-white">
                                {formatPrice(p.price, p.symbol)}
                              </div>
                              <div className={`text-[10px] font-mono ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {isUp ? '+' : ''}{formatPercent(p.change)}
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Search icon-button — < xl screens */}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="p-1.5 rounded-full border border-ink-700/80 bg-ink-800/80 text-slate-300 hover:text-white hover:border-brand/40 transition xl:hidden shrink-0"
              aria-label="Search"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>

            {/* Deposit Button — golden pill, never overlaps */}
            <Link
              href="/trading/deposit"
              className={`flex items-center gap-1.5 rounded-full px-2.5 sm:px-3.5 py-1.5 text-xs font-bold transition active:scale-95 whitespace-nowrap shadow-sm shrink-0 ${
                isDepositActive
                  ? 'bg-amber-300 text-ink-950 ring-2 ring-amber-400 shadow-amber-500/30'
                  : 'bg-gradient-to-r from-amber-400 to-[#F0B90B] text-ink-950 hover:brightness-110 shadow-amber-500/20'
              }`}
            >
              <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="2" y="5" width="20" height="14" rx="2" />
                <line x1="2" y1="10" x2="22" y2="10" />
              </svg>
              <span>Deposit</span>
            </Link>

            {/* Notification Icon */}
            <Link
              href="/trading/notification"
              className={`p-1.5 rounded-full text-xs transition shrink-0 ${
                isNotificationActive
                  ? 'bg-brand/20 text-brand border border-brand/50'
                  : 'border border-ink-700/80 bg-ink-800/60 text-slate-300 hover:text-white hover:border-brand/40'
              }`}
              aria-label="Notifications"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </Link>

            {/* Profile Link (direct navigation to /trading/profile — no dropdown) */}
            <Link
              href="/trading/profile"
              className={`flex items-center gap-1.5 rounded-full px-2.5 sm:px-3 py-1 border transition shrink-0 ${
                isProfileActive
                  ? 'border-brand bg-brand/15 text-brand shadow-sm font-bold'
                  : 'border-brand/40 bg-brand/5 text-brand hover:bg-brand/10'
              }`}
              aria-label="User Profile"
              title="Go to Trading Profile & Dashboard"
            >
              {/* Binance-style gold avatar */}
              <div className="h-5 w-5 rounded-full bg-gradient-to-tr from-[#F0B90B] to-[#fcd535] flex items-center justify-center shadow flex-shrink-0">
                <svg className="h-3 w-3 text-slate-900" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                </svg>
              </div>
              <span suppressHydrationWarning className="hidden sm:block max-w-[90px] lg:max-w-[120px] truncate text-xs font-semibold text-brand">
                {displayName}
              </span>
            </Link>

            {/* Mobile hamburger — hidden on md+ (nav zone handles navigation) */}
            <button
              type="button"
              onClick={() => setMobileMenuOpen((prev) => !prev)}
              className="inline-flex items-center justify-center p-1.5 rounded-full border border-ink-700 bg-ink-800/80 text-slate-300 hover:bg-ink-800 hover:text-white transition md:hidden shrink-0"
              aria-label="Open menu"
              aria-expanded={mobileMenuOpen}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>
          </div>

        </div>
      </header>

      {/* ── Mobile Full-screen Drawer ── */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-40 flex flex-col md:hidden bg-ink-950 text-slate-100">
          {/* Drawer header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-ink-800">
            <div className="flex items-center gap-2 text-white">
              <LogoMark className="h-7 w-7" />
              <div className="flex items-center text-sm font-bold tracking-tight">
                <span className="text-white">ROYALE</span>
                <span className="ml-1 text-amber-400">EXCHANGE</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="inline-flex items-center justify-center p-2 rounded-md text-slate-300 hover:bg-ink-800"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* User badge */}
          <div className="p-4 border-b border-ink-800 flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-tr from-[#F0B90B] to-[#fcd535] flex items-center justify-center text-slate-900 shadow">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
              </svg>
            </div>
            <div>
              <div suppressHydrationWarning className="font-bold text-white text-sm">{displayName}</div>
              <div suppressHydrationWarning className="text-[11px] text-slate-400 font-mono">UID: {uid}</div>
            </div>
          </div>

          {/* Nav links */}
          <nav className="flex-1 overflow-y-auto py-4 px-4 space-y-1">
            {TOP_MENU.map((item) => {
              const active =
                item.href === '/trading/home'
                  ? pathname === '/trading/home' || pathname === '/trading/'
                  : item.href === '/trading'
                  ? pathname === '/trading'
                  : pathname.startsWith(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 transition ${
                    active
                      ? 'bg-brand/15 text-brand font-bold border border-brand/40'
                      : 'text-slate-300 hover:bg-ink-800 hover:text-white'
                  }`}
                >
                  <svg
                    className="h-5 w-5 shrink-0"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={active ? '#14b8a6' : 'currentColor'}
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={ICON_MAP[item.label]} />
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
            ? 'flex-1 w-full p-0 pb-0'
            : 'mx-auto flex-1 w-full max-w-7xl px-4 py-6 pb-20 sm:pb-8'
        }
      >
        {children}
      </main>

      {!fullWidth && <AppFooter />}

      {/* Search Overlay */}
      <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}

/** Professional SVG sparkline for previewing mini price charts. */
export function Sparkline({
  points,
  height = 36,
  width = 120,
}: {
  points: number[];
  height?: number;
  width?: number;
}) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const d = points
    .map(
      (p, i) =>
        `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(
          height -
          ((p - min) / span) * (height - 4) -
          2
        ).toFixed(1)}`,
    )
    .join(' ');
  const up = points[points.length - 1] >= points[0];
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden
      className="overflow-visible"
    >
      <path
        d={d}
        fill="none"
        stroke={up ? '#10b981' : '#f43f5e'}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
