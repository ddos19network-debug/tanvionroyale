import React, { useState } from "react";
import MainLayout from "../src/components/main-layout";
import QuickNavTabs from "../src/components/quick-nav-tabs";

interface DashboardProfile {
  username: string;
  uid: string;
  avatar: string;
  vipLevel: string;
  following: number;
  followers: number;
  wallet: {
    amount: string;
    currency: string;
    usdValue: string;
  };
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("holding");
  const profile: DashboardProfile = {
    username: "user",
    uid: "ROYALE-7X9K2P",
    avatar: "/images/avatar-default.png",
    vipLevel: "Regular User >",
    following: 128,
    followers: 3421,
    wallet: {
      amount: "0.00002962",
      currency: "BTC",
      usdValue: "2.19",
    },
  };

  const toggleMask = () => {
    // Toggle mask state
  };

  return (
    <MainLayout
      profile={profile}
      onToggleSidebar={() => {}}
      onCopyUid={() => console.log("UID copied")}
      onToggleMask={toggleMask}
      selectedMenu="dashboard"
      onMenuSelect={(menu: string) => console.log("Select:", menu)}
    >
      {/* Quick Navigation Tabs */}
      <QuickNavTabs
        activeTab={activeTab}
        onSelectTab={(tab: string) => setActiveTab(tab)}
      />

      {/* Dashboard Content */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Assets Card */}
        <div className="bg-gray-900/50 border border-gray-700 rounded-xl p-6">
          <h3 className="font-semibold text-white mb-4">Portfolio Overview</h3>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <span className="text-3xl font-bold text-amber-400">12.45 BTC</span>
              <span className="text-sm text-gray-400">Total Balance</span>
            </div>
            <div>
              <span className="text-3xl font-bold text-green-400">$4,520</span>
              <span className="text-sm text-gray-400">USD Value</span>
            </div>
            <div>
              <span className="text-3xl font-bold text-blue-400">34</span>
              <span className="text-sm text-gray-400">Assets</span>
            </div>
          </div>
        </div>

        {/* Holdings Card */}
        <div className="bg-gray-900/50 border border-gray-700 rounded-xl p-6">
          <h3 className="font-semibold text-white mb-4">Recent Holdings</h3>
          <div className="space-y-3">
            <div>
              <span className="font-medium text-white">BTC/USD</span>
              <span className="text-gray-400">91,240.50</span>
              <span className="text-green-400 text-sm">+2.45%</span>
            </div>
            <div>
              <span className="font-medium text-white">ETH/USD</span>
              <span className="text-gray-400">6,540.20</span>
              <span className="text-red-500 text-sm">-1.20%</span>
            </div>
            <div>
              <span className="font-medium text-white">SOL/USD</span>
              <span className="text-gray-400">32.50</span>
              <span className="text-green-400 text-sm">+5.60%</span>
            </div>
          </div>
        </div>

        {/* Quick Stats Card */}
        <div className="col-span-2 lg:col-span-3 bg-gray-900/50 border border-gray-700 rounded-xl p-6">
          <h3 className="font-semibold text-white mb-4">Market Stats</h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <span className="text-2xl font-bold text-amber-400">24h</span>
              <span className="text-gray-400">Volume (B)</span>
            </div>
            <div>
              <span className="text-2xl font-bold text-green-400">BTC</span>
              <span className="text-gray-400">$91.2k</span>
            </div>
            <div>
              <span className="text-2xl font-bold text-blue-400">ETH</span>
              <span className="text-gray-400">$6.5k</span>
            </div>
          </div>
        </div>
      </div>
    </MainLayout>
  );
}