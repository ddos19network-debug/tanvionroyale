import React from "react";

/**
 * Quick Navigation Tabs for Dashboard Overview
 * Holdings, Hot, New Listing, Favorite, Top Gainers, 24h Volume
 */
interface QuickNavTabsProps {
  activeTab: string;
  onSelectTab: (tab: string) => void;
}

const navTabs = [
  { key: "holding", label: "Holding" },
  { key: "hot", label: "Hot" },
  { key: "new-listing", label: "New Listing" },
  { key: "favorite", label: "Favorite" },
  { key: "top-gainers", label: "Top Gainers" },
  { key: "volume", label: "24h Volume" },
];

export default function QuickNavTabs({
  activeTab,
  onSelectTab,
}: QuickNavTabsProps) {
  return (
    <div className="flex flex-wrap gap-2 mb-6">
      {navTabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onSelectTab(tab.key)}
          className={`flex-1 rounded border border-gray-700 px-4 py-2 text-xs font-medium text-gray-300 hover:text-white hover:bg-gray-900/30 transition-all ${
            activeTab === tab.key
              ? "bg-gray-900/30 text-white border-amber-600/50"
              : ""
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}