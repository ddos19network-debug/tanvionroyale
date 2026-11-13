import React from "react";

/**
 * Trading Bottom Navigation for Mobile
 * Responsive bottom menu for trade execution on mobile devices
 */
interface TradingBottomNavProps {
  isExpanded: boolean;
  onToggle: () => void;
  selectedTab: string;
  onSelect: (tab: string) => void;
}

const navItems = [
  { key: "spot", label: "Spot", icon: "TrendingUp" },
  { key: "margin", label: "Margin", icon: "LoaderCcw" },
  { key: "futures", label: "Futures", icon: "Zap" },
  { key: "options", label: "Options", icon: "MenuSquare" },
];

const iconPaths: Record<string, string> = {
  spot: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5",
  margin: "M12 4v16m8-8H4",
  futures: "M12 2a10 10 0 100 20A10.011 10.011 0 0012 2Zm.79 5.26l-2.05 4.34-1.29-2.85M9.54 5.95l2.05 4.34 1.29-2.85M5.96 9.54l2.05 4.34 1.29-2.85m1.41-5.3L3.16 2.23a9.968 9.968 0 0114.18 0Z",
  options: "M3 4h18M3 8h18M3 12h18M3 16h18",
};

export default function TradingBottomNav({
  isExpanded,
  onToggle,
  selectedTab,
  onSelect,
}: TradingBottomNavProps) {
  return (
    <div
      className={`fixed bottom-0 left-0 right-0 ${isExpanded ? "py-6" : "py-4"} bg-gray-950/95 backdrop-blur-md border-t border-gray-700 transition-all duration-300 ease-out ${
        isExpanded ? "" : "transform translate-y-full"
      } md:static md:translate-y-0`}
    >
      <div className="max-w-7xl mx-auto flex flex-col items-center gap-2">
        {isExpanded ? (
          /* Expanded view - shows trade options in a grid */}
          <div className="flex flex-wrap justify-center gap-4">
            {navItems.map((item) => (
              <button
                key={item.key}
                onClick={() => onSelect(item.key)}
                className={`flex-1 rounded bg-gray-800/50 px-4 py-3 text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-700/50 transition-all ${
                  selectedTab === item.key ? "bg-gray-700 text-white" : ""
                }`}
              >
                <svg
                  className="w-4 h-4 mr-2"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d={iconPaths[item.key] || ""} />
                </svg>
                {item.label}
              </button>
            ))}
          </div>
        ) : (
          /* Collapsed view - floating action button */
          <button
            onClick={onToggle}
            className="flex items-center gap-2 rounded-full bg-amber-600 px-4 py-3 text-white font-medium shadow-lg shadow-amber-500/20 hover:bg-amber-500 transition-colors"
            aria-label="Trade options"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 5v14M5 12h14" />
            </svg>
            Trade
          </button>
        )}

        {/* Close button in expanded view */}
        {isExpanded && (
          <button
            onClick={onToggle}
            className="absolute top-3 right-3 rounded-full bg-gray-800 p-1 hover:bg-gray-700 transition-colors"
            aria-label="Close options"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}