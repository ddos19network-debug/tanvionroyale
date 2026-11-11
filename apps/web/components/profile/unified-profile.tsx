'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/src/lib/auth';
import { getMe, updateProfile } from '@/lib/api/users';
import { getProfileSummary, type ProfileSummary } from '@/lib/api/profile';
import { claimTradingFaucet, formatMinor, formatPrice, formatPercent } from '@/lib/api/trading';
import type { PublicUser } from '@tanvion-royale/types';

interface MarketCoin {
  symbol: string;
  name: string;
  price: number;
  change: number;
  high: number;
  low: number;
  volume: string;
  holdingAmount?: string;
  holdingValue?: string;
}

const SAMPLE_COINS: Record<string, MarketCoin[]> = {
  holding: [
    { symbol: 'BTCUSD', name: 'Bitcoin', price: 7586000, change: 320, high: 7650000, low: 7420000, volume: '$18.4B', holdingAmount: '0.00002962 BTC', holdingValue: '≈ $2.19' },
    { symbol: 'ETHUSD', name: 'Ethereum', price: 384000, change: 185, high: 391000, low: 375000, volume: '$9.2B', holdingAmount: '0.00000000 ETH', holdingValue: '≈ $0.00' },
  ],
  hot: [
    { symbol: 'BTCUSD', name: 'Bitcoin', price: 7586000, change: 320, high: 7650000, low: 7420000, volume: '$18.4B' },
    { symbol: 'ETHUSD', name: 'Ethereum', price: 384000, change: 185, high: 391000, low: 375000, volume: '$9.2B' },
    { symbol: 'SOLUSD', name: 'Solana', price: 19850, change: -85, high: 20500, low: 19200, volume: '$4.1B' },
    { symbol: 'BNBUSD', name: 'BNB', price: 61500, change: 120, high: 62400, low: 60200, volume: '$3.1B' },
    { symbol: 'NVDA', name: 'NVIDIA Corp', price: 14200, change: 450, high: 14500, low: 13900, volume: '$5.2B' },
  ],
  new: [
    { symbol: 'SUIUSD', name: 'Sui', price: 320, change: 840, high: 345, low: 290, volume: '$920M' },
    { symbol: 'TIAUSD', name: 'Celestia', price: 620, change: 210, high: 645, low: 595, volume: '$410M' },
    { symbol: 'APTUSD', name: 'Aptos', price: 980, change: -140, high: 1040, low: 960, volume: '$380M' },
    { symbol: 'PEPEUSD', name: 'Pepe', price: 1, change: 1250, high: 1.2, low: 0.9, volume: '$1.4B' },
  ],
  favorite: [
    { symbol: 'BTCUSD', name: 'Bitcoin', price: 7586000, change: 320, high: 7650000, low: 7420000, volume: '$18.4B' },
    { symbol: 'SOLUSD', name: 'Solana', price: 19850, change: -85, high: 20500, low: 19200, volume: '$4.1B' },
    { symbol: 'NVDA', name: 'NVIDIA Corp', price: 14200, change: 450, high: 14500, low: 13900, volume: '$5.2B' },
  ],
  gainers: [
    { symbol: 'PEPEUSD', name: 'Pepe', price: 1, change: 1250, high: 1.2, low: 0.9, volume: '$1.4B' },
    { symbol: 'SUIUSD', name: 'Sui', price: 320, change: 840, high: 345, low: 290, volume: '$920M' },
    { symbol: 'NVDA', name: 'NVIDIA Corp', price: 14200, change: 450, high: 14500, low: 13900, volume: '$5.2B' },
    { symbol: 'BTCUSD', name: 'Bitcoin', price: 7586000, change: 320, high: 7650000, low: 7420000, volume: '$18.4B' },
  ],
  volume: [
    { symbol: 'BTCUSD', name: 'Bitcoin', price: 7586000, change: 320, high: 7650000, low: 7420000, volume: '$18.4B' },
    { symbol: 'ETHUSD', name: 'Ethereum', price: 384000, change: 185, high: 391000, low: 375000, volume: '$9.2B' },
    { symbol: 'NVDA', name: 'NVIDIA Corp', price: 14200, change: 450, high: 14500, low: 13900, volume: '$5.2B' },
    { symbol: 'SOLUSD', name: 'Solana', price: 19850, change: -85, high: 20500, low: 19200, volume: '$4.1B' },
  ],
};

type ProfileTab =
  | 'dashboard'
  | 'assets'
  | 'betting'
  | 'games'
  | 'casino'
  | 'deposits'
  | 'withdrawals'
  | 'wallet'
  | 'orders'
  | 'rewards'
  | 'referral'
  | 'account'
  | 'subaccounts'
  | 'royalepay'
  | 'activity'
  | 'settings'
  | 'account-identification'
  | 'account-security'
  | 'account-payment'
  | 'account-api'
  | 'account-statement'
  | 'account-reports';

export function UnifiedProfile() {
  const { user: authUser, logout } = useAuth();
  const [user, setUser] = useState<PublicUser | null>(authUser);
  const [summary, setSummary] = useState<ProfileSummary | null>(null);

  const [activeTab, setActiveTab] = useState<ProfileTab>('dashboard');
  const [accountOpen, setAccountOpen] = useState(false);
  const [assetsOpen, setAssetsOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);

  const [activeMarketTab, setActiveMarketTab] = useState<
    'holding' | 'hot' | 'new' | 'favorite' | 'gainers' | 'volume'
  >('holding');

  const [isClient, setIsClient] = useState(false);
  const [showValue, setShowValue] = useState(true);
  const [selectedCurrency, setSelectedCurrency] = useState<'BTC' | 'USD' | 'USDT'>('BTC');
  const [copiedUid, setCopiedUid] = useState(false);
  const [faucetLoading, setFaucetLoading] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Edit profile form state
  const [username, setUsername] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    setIsClient(true);
    let mounted = true;
    getMe()
      .then((me) => {
        if (mounted && me) {
          setUser(me);
          setUsername(me.username || '');
          setFirstName(me.firstName || '');
          setLastName(me.lastName || '');
          setPhone(me.phone || '');
          setCountry(me.country || '');
        }
      })
      .catch(() => {});

    getProfileSummary()
      .then((s) => {
        if (mounted) setSummary(s);
      })
      .catch(() => {});

    return () => {
      mounted = false;
    };
  }, []);

  const uid = isClient && user?.id ? String(Math.abs(hashString(user.id))).padStart(10, '0').slice(0, 10) : '1147705039';
  const displayName = isClient && user?.username
    ? user.username
    : isClient && user?.firstName
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

  function handleCopyUid() {
    if (typeof navigator !== 'undefined') {
      navigator.clipboard.writeText(uid);
      setCopiedUid(true);
      setTimeout(() => setCopiedUid(false), 2000);
    }
  }

  async function handleClaimFaucet() {
    setFaucetLoading(true);
    try {
      const acc = await claimTradingFaucet(1_000_000, false);
      setToastMessage(`Claimed ${formatMinor(1_000_000, acc.currency)} demo funds!`);
      setTimeout(() => setToastMessage(null), 3500);
    } catch {
      setToastMessage('Could not claim faucet. Ensure you are signed in.');
      setTimeout(() => setToastMessage(null), 3500);
    } finally {
      setFaucetLoading(false);
    }
  }

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveSuccess(false);
    try {
      const updated = await updateProfile({ firstName, lastName, phone, country });
      setUser(updated);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch {
      setToastMessage('Failed to update profile settings.');
      setTimeout(() => setToastMessage(null), 3000);
    } finally {
      setSaving(false);
    }
  }

  const currentCoins = SAMPLE_COINS[activeMarketTab] ?? SAMPLE_COINS.holding;

  // ── Sidebar nav item helper ─────────────────────────────────────────────────
  function NavItem({
    tab,
    icon,
    label,
    hasChevron,
    isOpen,
    onToggle,
  }: {
    tab: ProfileTab;
    icon: React.ReactNode;
    label: string;
    hasChevron?: boolean;
    isOpen?: boolean;
    onToggle?: () => void;
  }) {
    const active = activeTab === tab || activeTab.startsWith(tab + '-');
    return (
      <button
        onClick={() => {
          if (onToggle) {
            onToggle();
          } else {
            setActiveTab(tab);
          }
        }}
        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs sm:text-sm font-semibold transition ${
          active
            ? 'bg-white/10 text-white font-bold'
            : 'text-slate-400 hover:text-white hover:bg-white/5'
        }`}
      >
        <div className="flex items-center gap-3">
          {icon}
          <span>{label}</span>
        </div>
        {hasChevron && (
          <svg
            className={`h-3.5 w-3.5 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        )}
      </button>
    );
  }

  function SubItem({ tab, label }: { tab: ProfileTab; label: string }) {
    return (
      <button
        onClick={() => setActiveTab(tab)}
        className={`w-full text-left pl-10 pr-3 py-2 rounded-lg text-xs font-medium transition ${
          activeTab === tab
            ? 'text-white bg-white/8 font-semibold'
            : 'text-slate-500 hover:text-white hover:bg-white/5'
        }`}
      >
        {label}
      </button>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0e14] text-slate-100 flex flex-col md:flex-row">
      {toastMessage && (
        <div className="fixed top-16 right-4 z-50 rounded-lg bg-emerald-500/90 text-black px-4 py-2 text-xs font-bold shadow-xl">
          {toastMessage}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          LEFT SIDEBAR — Full menu as specified
          ══════════════════════════════════════════════════════════ */}
      <aside className="w-full md:w-60 lg:w-64 border-b md:border-b-0 md:border-r border-white/10 bg-[#0e121a] flex-shrink-0">
        <div className="p-3 space-y-0.5 overflow-y-auto max-h-screen">

          {/* Dashboard */}
          <NavItem tab="dashboard" label="Dashboard" icon={
            <svg className="h-4 w-4 shrink-0 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          } />

          {/* Assets (expandable) */}
          <NavItem tab="assets" label="Assets" hasChevron isOpen={assetsOpen} onToggle={() => { setAssetsOpen(o => !o); setActiveTab('assets'); }} icon={
            <svg className="h-4 w-4 shrink-0 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="4" width="20" height="16" rx="2" /><line x1="2" y1="10" x2="22" y2="10" />
            </svg>
          } />

          {/* Betting */}
          <NavItem tab="betting" label="Betting" icon={
            <svg className="h-4 w-4 shrink-0 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
            </svg>
          } />

          {/* Games */}
          <NavItem tab="games" label="Games" icon={
            <svg className="h-4 w-4 shrink-0 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="6" width="20" height="12" rx="4" /><line x1="8" y1="12" x2="8" y2="12" strokeWidth="3" strokeLinecap="round" /><line x1="16" y1="10" x2="16" y2="10" strokeWidth="3" strokeLinecap="round" /><line x1="14" y1="12" x2="18" y2="12" strokeWidth="1.5" /><line x1="16" y1="10" x2="16" y2="14" strokeWidth="1.5" />
            </svg>
          } />

          {/* Casino */}
          <NavItem tab="casino" label="Casino" icon={
            <svg className="h-4 w-4 shrink-0 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" /><path d="M12 8v4l3 3" />
            </svg>
          } />

          {/* Deposits */}
          <NavItem tab="deposits" label="Deposits" icon={
            <svg className="h-4 w-4 shrink-0 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2v13m0 0l-4-4m4 4l4-4" /><rect x="2" y="17" width="20" height="4" rx="1" />
            </svg>
          } />

          {/* Withdrawals */}
          <NavItem tab="withdrawals" label="Withdrawals" icon={
            <svg className="h-4 w-4 shrink-0 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22V9m0 0l-4 4m4-4l4 4" /><rect x="2" y="3" width="20" height="4" rx="1" />
            </svg>
          } />

          {/* Wallet */}
          <NavItem tab="wallet" label="Wallet" icon={
            <svg className="h-4 w-4 shrink-0 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z" /><path d="M16 3H8a2 2 0 0 0-2 2v2h12V5a2 2 0 0 0-2-2z" /><circle cx="17" cy="13" r="1" fill="currentColor" />
            </svg>
          } />

          {/* Referral */}
          <NavItem tab="referral" label="Referral" icon={
            <svg className="h-4 w-4 shrink-0 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" /><line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" />
            </svg>
          } />

          {/* Orders (expandable) */}
          <NavItem tab="orders" label="Orders" hasChevron isOpen={ordersOpen} onToggle={() => { setOrdersOpen(o => !o); setActiveTab('orders'); }} icon={
            <svg className="h-4 w-4 shrink-0 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          } />

          {/* Rewards Hub */}
          <NavItem tab="rewards" label="Rewards Hub" icon={
            <svg className="h-4 w-4 shrink-0 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
            </svg>
          } />

          {/* Divider */}
          <div className="h-px bg-white/10 my-1.5" />

          {/* Account (expandable with sub-items) */}
          <NavItem tab="account" label="Account" hasChevron isOpen={accountOpen} onToggle={() => setAccountOpen(o => !o)} icon={
            <svg className="h-4 w-4 shrink-0 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
            </svg>
          } />
          {accountOpen && (
            <div className="space-y-0.5 ml-1">
              <SubItem tab="account-identification" label="Identification" />
              <SubItem tab="account-security" label="Security" />
              <SubItem tab="account-payment" label="Payment" />
              <SubItem tab="account-api" label="API Management" />
              <SubItem tab="account-statement" label="Account Statement" />
              <SubItem tab="account-reports" label="Financial Reports" />
            </div>
          )}

          {/* Sub Accounts */}
          <NavItem tab="subaccounts" label="Sub Accounts" icon={
            <svg className="h-4 w-4 shrink-0 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
          } />

          {/* Divider */}
          <div className="h-px bg-white/10 my-1.5" />

          {/* Royale Pay */}
          <NavItem tab="royalepay" label="Royale Pay" icon={
            <svg className="h-4 w-4 shrink-0 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /><path d="M6 15h4" />
            </svg>
          } />

          {/* Activity */}
          <NavItem tab="activity" label="Activity" icon={
            <svg className="h-4 w-4 shrink-0 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          } />

          {/* Settings */}
          <NavItem tab="settings" label="Settings" icon={
            <svg className="h-4 w-4 shrink-0 text-slate-300" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          } />

        </div>
      </aside>

      {/* ══════════════════════════════════════════════════════════
          MAIN CONTENT AREA
          ══════════════════════════════════════════════════════════ */}
      <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-6 overflow-y-auto max-w-7xl">

        {/* ── TOP USER BANNER ─────────────────────────────────────── */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
          <div className="flex items-center gap-4">
            <div className="relative flex-shrink-0">
              <div className="h-14 w-14 sm:h-16 sm:w-16 rounded-full bg-[#1b2230] border-2 border-white/10 flex items-center justify-center overflow-hidden shadow-lg">
                <div className="h-10 w-10 sm:h-12 sm:w-12 rounded-full bg-gradient-to-tr from-[#F0B90B] to-[#fcd535] flex items-center justify-center shadow-inner">
                  <svg className="h-6 w-6 sm:h-7 sm:w-7 text-white" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                  </svg>
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <h2 suppressHydrationWarning className="text-lg sm:text-xl font-bold text-white tracking-tight">{displayName}</h2>
              <button type="button" className="inline-flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 font-semibold transition">
                <svg className="h-3.5 w-3.5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="2" width="20" height="20" rx="5" ry="5" /><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" /><line x1="17.5" y1="6.5" x2="17.51" y2="6.5" />
                </svg>
                <span>Link Social Account &gt;</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6 text-xs text-slate-400">
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">UID</div>
              <div className="flex items-center gap-1.5 font-mono text-white font-semibold">
                <span suppressHydrationWarning>{uid}</span>
                <button type="button" onClick={handleCopyUid} title="Copy UID" className="text-slate-400 hover:text-white transition">
                  {copiedUid ? (
                    <span className="text-[10px] text-emerald-400 font-sans">Copied!</span>
                  ) : (
                    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">VIP Level</div>
              <button className="text-white hover:text-amber-400 font-semibold transition flex items-center gap-0.5">
                <span>Regular User</span><span className="text-[10px] text-slate-500">&gt;</span>
              </button>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Following</div>
              <button className="text-white hover:text-amber-400 font-semibold transition flex items-center gap-0.5">
                <span>0</span><span className="text-[10px] text-slate-500">&gt;</span>
              </button>
            </div>
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-wider">Followers</div>
              <button className="text-white hover:text-amber-400 font-semibold transition flex items-center gap-0.5">
                <span>0</span><span className="text-[10px] text-slate-500">&gt;</span>
              </button>
            </div>
          </div>
        </div>

        {/* ── EST. TOTAL VALUE CARD ────────────────────────────────── */}
        <div className="rounded-2xl border border-white/10 bg-[#121620] p-5 sm:p-6 shadow-xl relative overflow-hidden">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-xs sm:text-sm font-semibold text-slate-300">
                <span>Est. Total Value</span>
                <button type="button" onClick={() => setShowValue((prev) => !prev)} className="text-slate-400 hover:text-white transition">
                  {showValue ? (
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></svg>
                  ) : (
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" /></svg>
                  )}
                </button>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight font-mono">
                  {showValue ? '0.00002962' : '********'}
                </span>
                <button type="button" onClick={() => setSelectedCurrency((c) => (c === 'BTC' ? 'USD' : c === 'USD' ? 'USDT' : 'BTC'))} className="flex items-center gap-1 text-xs sm:text-sm font-bold text-slate-300 hover:text-white transition">
                  <span>{selectedCurrency}</span>
                  <svg className="h-3 w-3 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
              </div>
              <div className="flex items-center gap-3 text-xs text-slate-400">
                <span className="font-mono">{showValue ? '≈ $2.19' : '≈ *****'}</span>
                <span>•</span>
                <div className="flex items-center gap-1">
                  <span>Today&apos;s PnL</span>
                  <svg className="h-3 w-3 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" /><line x1="12" y1="8" x2="12.01" y2="8" /></svg>
                  <span className="font-mono text-slate-300 font-semibold">{showValue ? '- $0.00(0.00%)' : '****'}</span>
                </div>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row sm:items-center gap-4 lg:gap-8">
              <div className="relative w-44 sm:w-56 h-14 hidden sm:block">
                <svg className="w-full h-full overflow-visible" viewBox="0 0 200 50">
                  <defs>
                    <linearGradient id="yellowGlow" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#F0B90B" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#F0B90B" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>
                  <path d="M 0 20 L 20 22 L 40 24 L 60 21 L 80 23 L 95 18 L 105 38 L 120 38 L 150 38 L 200 38 L 200 50 L 0 50 Z" fill="url(#yellowGlow)" />
                  <path d="M 0 20 L 20 22 L 40 24 L 60 21 L 80 23 L 95 18 L 105 38 L 120 38 L 150 38 L 200 38" fill="none" stroke="#F0B90B" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="flex items-center gap-2">
                <Link href="/trading/deposit" className="rounded-lg bg-white/10 hover:bg-white/15 px-4 py-2 text-xs font-bold text-white transition active:scale-95">Deposit</Link>
                <Link href="/wallet" className="rounded-lg bg-white/10 hover:bg-white/15 px-4 py-2 text-xs font-bold text-white transition active:scale-95">Withdraw</Link>
                <button type="button" onClick={handleClaimFaucet} disabled={faucetLoading} className="rounded-lg bg-white/10 hover:bg-white/15 px-4 py-2 text-xs font-bold text-white transition active:scale-95 disabled:opacity-50">
                  {faucetLoading ? 'Claiming...' : 'Cash In'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── DASHBOARD: MARKETS CARD ──────────────────────────────── */}
        {activeTab === 'dashboard' && (
          <div className="rounded-2xl border border-white/10 bg-[#121620] p-5 sm:p-6 shadow-xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base sm:text-lg font-bold text-white">Markets</h3>
              <Link href="/trading/market" className="text-xs text-slate-400 hover:text-amber-400 font-semibold transition flex items-center gap-0.5">
                <span>More</span><span>&gt;</span>
              </Link>
            </div>
            <div className="flex items-center gap-2 border-b border-white/5 pb-2 overflow-x-auto scrollbar-none">
              {(['holding', 'hot', 'new', 'favorite', 'gainers', 'volume'] as const).map((key) => (
                <button
                  key={key}
                  onClick={() => setActiveMarketTab(key)}
                  className={`text-xs sm:text-sm font-semibold px-2.5 py-1 rounded transition whitespace-nowrap ${
                    activeMarketTab === key ? 'text-white border-b-2 border-[#F0B90B] font-bold' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {key === 'hot' ? 'Hot' : key === 'new' ? 'New Listing' : key === 'gainers' ? 'Top Gainers' : key === 'volume' ? '24h Volume' : key.charAt(0).toUpperCase() + key.slice(1)}
                </button>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-[11px] font-medium text-slate-400 border-b border-white/5 pb-2">
                    <th className="py-2.5 font-normal">Pair</th>
                    <th className="py-2.5 text-right font-normal">Last Price</th>
                    <th className="py-2.5 text-right font-normal">24h Change</th>
                    <th className="py-2.5 text-right font-normal hidden sm:table-cell">24h High</th>
                    <th className="py-2.5 text-right font-normal hidden sm:table-cell">24h Low</th>
                    <th className="py-2.5 text-right font-normal">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {currentCoins.map((coin) => {
                    const isUp = coin.change >= 0;
                    return (
                      <tr key={coin.symbol} className="hover:bg-white/[0.02] transition">
                        <td className="py-3">
                          <div className="flex items-center gap-2">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-400/10 font-bold text-[10px] text-amber-300">{coin.symbol.slice(0, 3)}</span>
                            <div>
                              <div className="font-bold text-white">{coin.symbol}</div>
                              <div className="text-[10px] text-slate-500">{coin.name}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 text-right font-mono font-bold text-white">{formatPrice(coin.price, coin.symbol)}</td>
                        <td className="py-3 text-right font-mono font-bold">
                          <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] ${isUp ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'}`}>
                            {isUp ? '+' : ''}{formatPercent(coin.change)}
                          </span>
                        </td>
                        <td className="py-3 text-right font-mono text-slate-300 hidden sm:table-cell">{formatPrice(coin.high, coin.symbol)}</td>
                        <td className="py-3 text-right font-mono text-slate-300 hidden sm:table-cell">{formatPrice(coin.low, coin.symbol)}</td>
                        <td className="py-3 text-right">
                          <Link href={`/trading?symbol=${coin.symbol}`} className="rounded-md bg-amber-400/15 px-3 py-1 font-bold text-amber-300 hover:bg-amber-400 hover:text-black transition text-xs">Trade</Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── ASSETS / WALLET TAB ──────────────────────────────────── */}
        {(activeTab === 'assets' || activeTab === 'wallet') && (
          <div className="rounded-2xl border border-white/10 bg-[#121620] p-6 shadow-xl space-y-6">
            <div>
              <h3 className="text-lg font-bold text-white">Assets &amp; Wallet</h3>
              <p className="text-xs text-slate-400 mt-1">Overview of your virtual trading balance, casino wallet, and recent transactions.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                <div className="text-[11px] text-slate-400 uppercase tracking-wider">Trading Balance</div>
                <div className="mt-1 text-2xl font-black text-amber-300 font-mono">
                  {summary?.wallet ? formatMinor(summary.wallet.availableBalance, summary.wallet.currency) : '$10,000.00'}
                </div>
                <div className="text-xs text-slate-500 mt-1">Available for paper trading</div>
              </div>
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                <div className="text-[11px] text-slate-400 uppercase tracking-wider">Casino / Main Wallet</div>
                <div className="mt-1 text-2xl font-black text-white font-mono">
                  {summary?.wallet ? formatMinor(summary.wallet.availableBalance, summary.wallet.currency) : '$0.00'}
                </div>
                <div className="text-xs text-slate-500 mt-1">Available for Games &amp; Sports</div>
              </div>
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                <div className="text-[11px] text-slate-400 uppercase tracking-wider">Total Est. Value</div>
                <div className="mt-1 text-2xl font-black text-emerald-400 font-mono">0.00002962 BTC</div>
                <div className="text-xs text-slate-500 mt-1">≈ $2.19 USD</div>
              </div>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <Link href="/trading/deposit" className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-bold text-black hover:bg-amber-300 transition">Deposit Funds</Link>
              <Link href="/wallet" className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-bold text-white hover:bg-white/10 transition">Manage Wallets &amp; Withdraw</Link>
            </div>
          </div>
        )}

        {/* ── DEPOSITS TAB ─────────────────────────────────────────── */}
        {activeTab === 'deposits' && (
          <div className="rounded-2xl border border-white/10 bg-[#121620] p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-white">Deposits</h3>
            <p className="text-xs text-slate-400">View your deposit history and add funds to your account.</p>
            <Link href="/trading/deposit" className="inline-block rounded-lg bg-amber-400 px-5 py-2.5 text-xs font-bold text-black hover:bg-amber-300 transition">Make a Deposit</Link>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-8 text-center text-slate-400 text-sm">No deposit history found.</div>
          </div>
        )}

        {/* ── WITHDRAWALS TAB ──────────────────────────────────────── */}
        {activeTab === 'withdrawals' && (
          <div className="rounded-2xl border border-white/10 bg-[#121620] p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-white">Withdrawals</h3>
            <p className="text-xs text-slate-400">View your withdrawal history and request a payout.</p>
            <Link href="/wallet" className="inline-block rounded-lg bg-amber-400 px-5 py-2.5 text-xs font-bold text-black hover:bg-amber-300 transition">Withdraw Funds</Link>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-8 text-center text-slate-400 text-sm">No withdrawal history found.</div>
          </div>
        )}

        {/* ── BETTING TAB ──────────────────────────────────────────── */}
        {activeTab === 'betting' && (
          <div className="rounded-2xl border border-white/10 bg-[#121620] p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-white">Betting History</h3>
            <p className="text-xs text-slate-400">View your sports bets, live bets, and bet results.</p>
            <Link href="/my-bets" className="inline-block rounded-lg bg-amber-400 px-5 py-2.5 text-xs font-bold text-black hover:bg-amber-300 transition">View My Bets</Link>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-8 text-center text-slate-400 text-sm">No betting history found.</div>
          </div>
        )}

        {/* ── GAMES TAB ────────────────────────────────────────────── */}
        {activeTab === 'games' && (
          <div className="rounded-2xl border border-white/10 bg-[#121620] p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-white">Games History</h3>
            <p className="text-xs text-slate-400">View your casino game sessions and results.</p>
            <Link href="/games" className="inline-block rounded-lg bg-amber-400 px-5 py-2.5 text-xs font-bold text-black hover:bg-amber-300 transition">Browse Games</Link>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-8 text-center text-slate-400 text-sm">No game history found.</div>
          </div>
        )}

        {/* ── CASINO TAB ───────────────────────────────────────────── */}
        {activeTab === 'casino' && (
          <div className="rounded-2xl border border-white/10 bg-[#121620] p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-white">Casino Activity</h3>
            <p className="text-xs text-slate-400">View your casino wager history, wins, and losses.</p>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-8 text-center text-slate-400 text-sm">No casino history found.</div>
          </div>
        )}

        {/* ── ORDERS TAB ───────────────────────────────────────────── */}
        {activeTab === 'orders' && (
          <div className="rounded-2xl border border-white/10 bg-[#121620] p-6 shadow-xl space-y-6">
            <div>
              <h3 className="text-lg font-bold text-white">Orders &amp; History</h3>
              <p className="text-xs text-slate-400 mt-1">View your active trading orders, closed positions, sports betting slips, and casino wagers.</p>
            </div>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <Link href="/trading" className="rounded-lg bg-amber-400 px-3.5 py-1.5 text-xs font-bold text-black hover:bg-amber-300 transition">Go to Trading Terminal</Link>
                <Link href="/my-bets" className="rounded-lg border border-white/10 bg-white/5 px-3.5 py-1.5 text-xs font-semibold text-slate-200 hover:bg-white/10 transition">View Sports Bets</Link>
              </div>
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-8 text-center text-slate-400 text-sm">No active pending orders.</div>
            </div>
          </div>
        )}

        {/* ── REWARDS HUB TAB ──────────────────────────────────────── */}
        {activeTab === 'rewards' && (
          <div className="rounded-2xl border border-white/10 bg-[#121620] p-6 shadow-xl space-y-6">
            <div>
              <h3 className="text-lg font-bold text-white">Rewards Hub</h3>
              <p className="text-xs text-slate-400 mt-1">Claim demo trading funds, view VIP tier progress, and unlock platform promotions.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold text-white">Daily Demo Faucet</div>
                  <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">Free</span>
                </div>
                <p className="text-xs text-slate-400">Instantly add $10,000 in virtual demo trading balance.</p>
                <button type="button" onClick={handleClaimFaucet} disabled={faucetLoading} className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-bold text-black hover:bg-amber-300 transition active:scale-95 disabled:opacity-50">
                  {faucetLoading ? 'Claiming...' : 'Claim $10,000 Funds'}
                </button>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-bold text-white">VIP Status: Regular User</div>
                  <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">Level 1</span>
                </div>
                <p className="text-xs text-slate-400">Upgrade your VIP tier by trading volume and wagering.</p>
                <Link href="/promotions" className="inline-block rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white hover:bg-white/10 transition">View VIP Benefits &gt;</Link>
              </div>
            </div>
          </div>
        )}

        {/* ── REFERRAL TAB ─────────────────────────────────────────── */}
        {activeTab === 'referral' && (
          <div className="rounded-2xl border border-white/10 bg-[#121620] p-6 shadow-xl space-y-6">
            <div>
              <h3 className="text-lg font-bold text-white">Referral Program</h3>
              <p className="text-xs text-slate-400 mt-1">Invite friends to Tanvion Royale and earn up to 40% commission.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                <div className="text-[11px] text-slate-400 uppercase tracking-wider">Total Referred</div>
                <div className="mt-1 text-2xl font-black text-white">0</div>
              </div>
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                <div className="text-[11px] text-slate-400 uppercase tracking-wider">Commission Rate</div>
                <div className="mt-1 text-2xl font-black text-amber-400">20%</div>
              </div>
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                <div className="text-[11px] text-slate-400 uppercase tracking-wider">Total Earned</div>
                <div className="mt-1 text-2xl font-black text-emerald-400">$0.00</div>
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-2">
              <div className="text-xs font-semibold text-slate-300">Your Referral Code</div>
              <div className="flex items-center gap-2">
                <input type="text" readOnly value={`ROYALE-${uid}`} className="rounded-lg border border-white/10 bg-[#0b0e14] px-3 py-2 text-xs text-amber-300 font-mono font-bold max-w-xs w-full" />
                <button type="button" onClick={() => { navigator.clipboard.writeText(`ROYALE-${uid}`); setToastMessage('Referral code copied!'); setTimeout(() => setToastMessage(null), 2500); }} className="rounded-lg bg-amber-400 px-3 py-2 text-xs font-bold text-black hover:bg-amber-300 transition">Copy</button>
              </div>
            </div>
          </div>
        )}

        {/* ── ROYALE PAY TAB ───────────────────────────────────────── */}
        {activeTab === 'royalepay' && (
          <div className="rounded-2xl border border-white/10 bg-[#121620] p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-white">Royale Pay</h3>
            <p className="text-xs text-slate-400">Send and receive payments instantly using Royale Pay — Tanvion Royale&apos;s built-in payment system.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                <div className="text-[11px] text-slate-400 uppercase tracking-wider">Royale Pay Balance</div>
                <div className="mt-1 text-2xl font-black text-amber-300 font-mono">$0.00</div>
              </div>
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-4">
                <div className="text-[11px] text-slate-400 uppercase tracking-wider">Total Transactions</div>
                <div className="mt-1 text-2xl font-black text-white">0</div>
              </div>
            </div>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-8 text-center text-slate-400 text-sm">No Royale Pay transactions yet.</div>
          </div>
        )}

        {/* ── ACTIVITY TAB ─────────────────────────────────────────── */}
        {activeTab === 'activity' && (
          <div className="rounded-2xl border border-white/10 bg-[#121620] p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-white">Activity Log</h3>
            <p className="text-xs text-slate-400">View your recent account activity including logins, trades, and transactions.</p>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-8 text-center text-slate-400 text-sm">No recent activity.</div>
          </div>
        )}

        {/* ── ACCOUNT SUB-ITEMS ─────────────────────────────────────── */}
        {activeTab === 'account-identification' && (
          <div className="rounded-2xl border border-white/10 bg-[#121620] p-6 shadow-xl space-y-6">
            <h3 className="text-lg font-bold text-white">Identification (KYC)</h3>
            <p className="text-xs text-slate-400">Complete identity verification to unlock higher limits and withdraw funds.</p>
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4 text-xs text-amber-300 font-medium">Not Verified — Upload your government ID to get verified.</div>
            <button className="rounded-lg bg-amber-400 px-5 py-2.5 text-xs font-bold text-black hover:bg-amber-300 transition">Start Verification</button>
          </div>
        )}

        {activeTab === 'account-security' && (
          <div className="rounded-2xl border border-white/10 bg-[#121620] p-6 shadow-xl space-y-6">
            <h3 className="text-lg font-bold text-white">Security Settings</h3>
            <p className="text-xs text-slate-400">Manage your password, two-factor authentication, and login activity.</p>
            <div className="space-y-3">
              <div className="flex items-center justify-between p-4 rounded-xl border border-white/5 bg-white/[0.02]">
                <div><div className="text-sm font-semibold text-white">Two-Factor Auth (2FA)</div><div className="text-xs text-slate-500 mt-0.5">Protect your account with 2FA</div></div>
                <span className="text-xs font-bold text-rose-400 bg-rose-500/10 px-3 py-1 rounded">Disabled</span>
              </div>
              <div className="flex items-center justify-between p-4 rounded-xl border border-white/5 bg-white/[0.02]">
                <div><div className="text-sm font-semibold text-white">Password</div><div className="text-xs text-slate-500 mt-0.5">Last changed: Never</div></div>
                <button className="text-xs font-bold text-amber-400 hover:text-amber-300 transition">Change</button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'account-payment' && (
          <div className="rounded-2xl border border-white/10 bg-[#121620] p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-white">Payment Methods</h3>
            <p className="text-xs text-slate-400">Manage your linked bank accounts, mobile banking, and crypto addresses.</p>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-8 text-center text-slate-400 text-sm">No payment methods added.</div>
            <button className="rounded-lg bg-amber-400 px-5 py-2.5 text-xs font-bold text-black hover:bg-amber-300 transition">Add Payment Method</button>
          </div>
        )}

        {activeTab === 'account-api' && (
          <div className="rounded-2xl border border-white/10 bg-[#121620] p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-white">API Management</h3>
            <p className="text-xs text-slate-400">Create and manage API keys for algorithmic trading and third-party integrations.</p>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-8 text-center text-slate-400 text-sm">No API keys created yet.</div>
            <button className="rounded-lg bg-amber-400 px-5 py-2.5 text-xs font-bold text-black hover:bg-amber-300 transition">Create API Key</button>
          </div>
        )}

        {activeTab === 'account-statement' && (
          <div className="rounded-2xl border border-white/10 bg-[#121620] p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-white">Account Statement</h3>
            <p className="text-xs text-slate-400">Download your complete account statement for any date range.</p>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-8 text-center text-slate-400 text-sm">No statement data available.</div>
          </div>
        )}

        {activeTab === 'account-reports' && (
          <div className="rounded-2xl border border-white/10 bg-[#121620] p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-white">Financial Reports</h3>
            <p className="text-xs text-slate-400">View detailed financial reports including P&amp;L, tax summaries, and trading analytics.</p>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-8 text-center text-slate-400 text-sm">No financial report data available.</div>
          </div>
        )}

        {/* ── SUB ACCOUNTS TAB ─────────────────────────────────────── */}
        {activeTab === 'subaccounts' && (
          <div className="rounded-2xl border border-white/10 bg-[#121620] p-6 shadow-xl space-y-4">
            <h3 className="text-lg font-bold text-white">Sub Accounts</h3>
            <p className="text-xs text-slate-400">Create and manage isolated trading sub-accounts.</p>
            <div className="rounded-xl border border-white/5 bg-white/[0.02] p-8 text-center text-slate-400 text-sm">You currently have no active sub-accounts.</div>
          </div>
        )}

        {/* ── SETTINGS TAB ─────────────────────────────────────────── */}
        {activeTab === 'settings' && (
          <div className="rounded-2xl border border-white/10 bg-[#121620] p-6 shadow-xl space-y-6">
            <div>
              <h3 className="text-lg font-bold text-white">Account Settings &amp; Profile</h3>
              <p className="text-xs text-slate-400 mt-1">Manage your personal information, security preferences, and verification status.</p>
            </div>
            {saveSuccess && (
              <div className="rounded-lg bg-emerald-500/20 border border-emerald-500/30 px-4 py-2 text-xs font-medium text-emerald-300">Profile updated successfully!</div>
            )}
            <form onSubmit={handleSaveProfile} className="space-y-4 max-w-xl">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">Username</label>
                  <input type="text" disabled value={username} className="w-full rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-slate-400 cursor-not-allowed" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 mb-1">UID</label>
                  <input type="text" disabled value={uid} className="w-full rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-slate-400 font-mono cursor-not-allowed" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">First Name</label>
                  <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Enter first name" className="w-full rounded-lg border border-white/10 bg-[#0b0e14] px-3 py-2 text-xs text-white focus:border-amber-400 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Last Name</label>
                  <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Enter last name" className="w-full rounded-lg border border-white/10 bg-[#0b0e14] px-3 py-2 text-xs text-white focus:border-amber-400 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Country</label>
                  <input type="text" value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country" className="w-full rounded-lg border border-white/10 bg-[#0b0e14] px-3 py-2 text-xs text-white focus:border-amber-400 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">Phone</label>
                  <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone number" className="w-full rounded-lg border border-white/10 bg-[#0b0e14] px-3 py-2 text-xs text-white focus:border-amber-400 focus:outline-none" />
                </div>
              </div>
              <div className="pt-2 flex items-center gap-3">
                <button type="submit" disabled={saving} className="rounded-lg bg-amber-400 px-5 py-2 text-xs font-bold text-black hover:bg-amber-300 transition active:scale-95 disabled:opacity-50">
                  {saving ? 'Saving...' : 'Save Profile'}
                </button>
                <button type="button" onClick={() => logout?.()} className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-2 text-xs font-semibold text-rose-400 hover:bg-rose-500/20 transition">Log Out</button>
              </div>
            </form>
          </div>
        )}

      </main>
    </div>
  );
}
