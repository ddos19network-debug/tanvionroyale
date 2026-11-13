import React, { useState } from "react";

export interface WalletBalance {
  amount: string;
  currency: string;
  usdValue: string;
}

export interface ProfileData {
  username: string;
  uid: string;
  avatar: string;
  vipLevel: string;
  following: number;
  followers: number;
  wallet: WalletBalance;
}

export interface DashboardHeaderProps {
  profile: ProfileData;
  onToggleSidebar: () => void;
  onCopyUid: () => void;
  onToggleMask: () => void;
}
export default function DashboardHeader({
  profile,
  onToggleSidebar,
  onCopyUid,
  onToggleMask,
}: DashboardHeaderProps) {
  const [masked, setMasked] = useState(false);

  return (
    <header className="border-b border-gray-700 bg-gray-950/90 backdrop-blur-lg sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between flex-wrap gap-4">
          {/* Sidebar Toggle (mobile) */}
          <button
            onClick={onToggleSidebar}
            className="md:hidden p-2 rounded hover:bg-gray-800 transition-colors"
            aria-label="Toggle sidebar"
          >
            <svg
              className="w-5 h-5 text-white"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m-3-3v1a1 1 0 01-1 1h-3m-5-3h5m3-5V5a1 1 0 011-1h2a1 1 0 011 1v2Z" />
            </svg>
          </button>

          {/* Profile Card */}
          <div className="flex items-center gap-4 md:w-80">
            <div className="relative">
              <img
                src={profile.avatar}
                alt={profile.username}
                className="w-10 h-10 rounded-full object-cover border-2 border-gray-700"
              />
              <button
                onClick={() => console.log("Open social links")}
                className="absolute -bottom-1 right-1 text-xs text-gray-400 hover:text-white transition-colors"
              >
                Link Social Account >
              </button>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-white">{profile.username}</span>
                <span className="text-xs text-gray-400">{profile.vipLevel}</span>
              </div>
              <div className="mt-1 text-xs text-gray-500">
                UID: <span className="font-mono text-gray-300" onClick={onCopyUid}>{profile.uid}</span>
                <button
                  onClick={onCopyUid}
                  className="ml-1 text-[var(--primary)] text-xs underline underline-offset-2"
                  title="Copy UID"
                >
                  Copy
                </button>
              </div>
            </div>
          </div>

          {/* Wallet Value Bar */}
          <div className="flex items-center gap-4 md:w-[400px]">
            <div className="relative flex-1">
              <span className="text-white font-medium">Est. Total Value</span>
              <button
                onClick={onToggleMask}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-gray-800 transition-colors"
                aria-label="Hide/Mask balances"
              >
                {masked ? (
                  <EyeOff
                    className="w-4 h-4 text-gray-500"
                    width={16}
                    height={16}
                  />
                ) : (
                  <Eye
                    className="w-4 h-4 text-gray-500"
                    width={16}
                    height={16}
                  />
                )}
              </button>
            </div>

            <div className="ml-4 text-right">
              <span className="text-lg font-bold text-white">{masked ? "****" : profile.wallet.amount}</span>
              <span className="text-gray-400 text-sm">≈ {masked ? "****" : profile.wallet.usdValue} USD</span>
            </div>
          </div>
        </div>

        {/* PnL & Quick Actions */}
        <div className="mt-4 flex items-center justify-between flex-wrap gap-4">
          {/* Today's PnL */}
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-400">Today's PnL</span>
            <span className="text-base font-mono text-green-400">+12.45%</span>
          </div>

          {/* Sparkline placeholder */}
          <div className="hidden md:block w-32 h-4 bg-gray-700 rounded overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-500 via-yellow-500 to-red-500"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <button className="px-3 py-1 rounded text-xs font-medium bg-green-600/20 text-green-400 border border-green-500/50 hover:bg-green-600/30 transition-colors">
              Deposit
            </button>
            <button className="px-3 py-1 rounded text-xs font-medium bg-blue-600/20 text-blue-400 border border-blue-500/50 hover:bg-blue-600/30 transition-colors">
              Withdraw
            </button>
            <button className="px-3 py-1 rounded text-xs font-medium bg-amber-600/20 text-amber-400 border border-amber-500/50 hover:bg-amber-600/30 transition-colors">
              Cash In
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}