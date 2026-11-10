'use client';

import { TradingShell } from '@/components/trading/trading-shell';
import Link from 'next/link';
import { useState } from 'react';

function ProfileStat({
  title,
  value,
  icon,
}: {
  title: string;
  value: string | number;
  icon: string;
}) {
  return (
    <div className="text-center">
      <div className="text-2xl font-bold text-amber-300">{icon}</div>
      <p className="text-sm text-slate-400">{title}</p>
      <p className="text-3xl font-black text-white">{value}</p>
    </div>
  );
}

export default function TradingProfilePage() {
  const [profileImage, setProfileImage] = useState<string>('/placeholder-user.png');
  const [settingsOpen, setSettingsOpen] = useState(false);

  const stats = [
    { title: 'Assets', value: '12.45 BTC', icon: '₿' },
    { title: '24h Volume', value: '$45,200', icon: '$' },
    { title: 'Win Rate', value: '67%', icon: '📊' },
    { title: 'Referrals', value: '128', icon: '👥' },
  ];

  return (
    <TradingShell>
      <div className="space-y-6">
        <div className="pt-6">
          {/* Profile Header */}
          <div className="flex flex-col sm:flex-row items-center justify-between sm:items-start gap-4">
            <div className="relative">
              <img
                src={profileImage}
                alt="User profile"
                className="w-20 h-20 rounded-full object-cover border-2 border-amber-500/20"
              />
              <div className="absolute bottom-1 right-1">
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="flex items-center justify-center rounded-full bg-amber-500/20 p-1"
                  aria-label="Edit profile"
                >
                  <svg className="h-4 w-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M13 2L3 14h9l-1 8 10-6L13 2z" />
                  </svg>
                </button>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-black text-white">RoyaleUser</h2>
              <p className="text-sm text-slate-400">Top Trader</p>
            </div>
          </div>

          {/* Profile Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
            {stats.map((stat) => (
              <ProfileStat key={stat.title} title={stat.title} value={stat.value} icon={stat.icon} />
            ))}
          </div>
        </div>

        {/* Settings Drawer */}
        {settingsOpen && (
          <div className="fixed inset-0 z-40 bg-black/80 backdrop-blur-sm p-6">
            <div className="bg-[#121620] rounded-xl p-6 sm:p-8 max-w-lg mx-auto space-y-4">
              <h3 className="text-xl font-black text-white">Settings</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="text-amber-400 text-sm">Username</span>
                  <span className="ml-auto text-slate-400">RoyaleUser</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-amber-400 text-sm">Email</span>
                  <span className="ml-auto text-slate-400">user@royale.example</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-amber-400 text-sm">Two-Factor</span>
                  <label className="relative">
                    <input type="checkbox" className="rounded border border-white/10 p-1 cursor-pointer" />
                    <span className="absolute left-1/2 -translate-x-1/2 text-[9px] text-slate-400">Enable</span>
                  </label>
                </div>
                <button
                  onClick={() => setSettingsOpen(false)}
                  className="w-full rounded-lg bg-amber-400 px-4 py-2 text-sm font-bold text-black transition hover:bg-amber-300 shadow-md shadow-amber-500/10 active:scale-95"
                >
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Bottom CTA */}
        <div className="pt-6">
          <button
            onClick={() => window.open('/profile', '_blank')}
            className="w-full rounded-lg bg-amber-400 px-6 py-3 text-sm font-bold text-black transition hover:bg-amber-300 shadow-md shadow-amber-500/10 active:scale-95"
          >
            View Full Profile on Royale Main →
          </button>
        </div>
      </div>
    </TradingShell>
  );
}