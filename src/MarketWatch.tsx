import React, { useState, useEffect } from "react";
import { Search } from "lucide-react";

export interface Asset {
  id: string;
  name: string;
  symbol: string;
  category: "crypto" | "forex" | "indices" | "commodities";
  baseCurrency: string;
  quoteCurrency: string;
}

export interface MarketWatchProps {
  selectedAsset: {
    symbol: string;
    price: string;
    change: string;
    isUp: boolean;
    lastPrice: number;
  };
  setSelectedAsset: React.Dispatch<React.SetStateAction<{
    symbol: string;
    price: string;
    change: string;
    isUp: boolean;
    lastPrice: number;
  }>>;
}

/** Mock asset data */
const ASSETS: Asset[] = [
  { id: "1", name: "Bitcoin", symbol: "BTC/USD", category: "crypto", baseCurrency: "BTC", quoteCurrency: "USD" },
  { id: "2", name: "Ethereum", symbol: "ETH/USD", category: "crypto", baseCurrency: "ETH", quoteCurrency: "USD" },
  { id: "3", name: "Solana", symbol: "SOL/USD", category: "crypto", baseCurrency: "SOL", quoteCurrency: "USD" },
  { id: "4", name: "Cardano", symbol: "ADA/USD", category: "crypto", baseCurrency: "ADA", quoteCurrency: "USD" },
  { id: "5", name: "Ripple", symbol: "XRP/USD", category: "crypto", baseCurrency: "XRP", quoteCurrency: "USD" },
  { id: "6", name: "EUR/USD", symbol: "EUR/USD", category: "forex", baseCurrency: "EUR", quoteCurrency: "USD" },
  { id: "7", name: "GBP/USD", symbol: "GBP/USD", category: "forex", baseCurrency: "GBP", quoteCurrency: "USD" },
  { id: "8", name: "USD/JPY", symbol: "USD/JPY", category: "forex", baseCurrency: "USD", quoteCurrency: "JPY" },
  { id: "9", name: "AUD/USD", symbol: "AUD/USD", category: "forex", baseCurrency: "AUD", quoteCurrency: "USD" },
  { id: "10", name: "S&P 500", symbol: "US500", category: "indices", baseCurrency: "USD", quoteCurrency: "USD" },
  { id: "11", name: "NASDAQ", symbol: "US100", category: "indices", baseCurrency: "USD", quoteCurrency: "USD" },
  { id: "12", name: "Dow Jones", symbol: "US30", category: "indices", baseCurrency: "USD", quoteCurrency: "USD" },
  { id: "13", name: "Gold", symbol: "XAU/USD", category: "commodities", baseCurrency: "XAU", quoteCurrency: "USD" },
  { id: "14", name: "Silver", symbol: "XAG/USD", category: "commodities", baseCurrency: "XAG", quoteCurrency: "USD" },
  { id: "15", name: "Crude Oil", symbol: "WTI/USD", category: "commodities", baseCurrency: "WTI", quoteCurrency: "USD" },
];
export default function MarketWatch({
  selectedAsset,
  setSelectedAsset,
}: MarketWatchProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTab, setActiveTab] = useState<"favorites" | "crypto" | "forex" | "indices" | "commodities">("favorites");
  const [categories, setCategories] = useState<"favorites" | "crypto" | "forex" | "indices" | "commodities">([]);

  const filteredAssets = ASSETS.filter((asset) => {
    const matchesSearch = asset.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      asset.symbol.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categories.length === 0 || categories.includes(asset.category);
    return matchesSearch && matchesCategory;
  });

  useEffect(() => {
    const uniqueCategories = ["crypto", "forex", "indices", "commodities"];
    setCategories(["favorites", ...uniqueCategories]);
  }, []);

  useEffect(() => {
    setActiveTab(categories.length > 0 ? categories[0] : "favorites");
  }, [categories]);

  const handleSelectAsset = (asset: Asset) => {
    const priceChange = (Math.random() - 0.5) * 5;
    const newPrice = (selectedAsset.lastPrice || 91240.5) + priceChange;
    const changePercent = ((priceChange / (selectedAsset.lastPrice || 91240.5)) * 100).toFixed(2);
    const isUp = priceChange > 0;

    setSelectedAsset({
      symbol: asset.symbol,
      price: newPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      change: `${changePercent > 0 ? "+" : ""}${changePercent}%`,
      isUp,
      lastPrice: newPrice,
    });
  };
return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-gray-800/30">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            placeholder="Search assets (BTC, EUR/USD, Gold)..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 pr-3 py-2 bg-[#1B212D] border border-gray-700 rounded-l text-xs text-white focus:outline-none focus:border-amber-500"
            autoComplete="off"
          />
        </div>
      </div>

      <div className="p-1 border-b border-gray-800/30">
        <div className="flex space-x-1 overflow-x-auto pb-1">
          <button
            key="favorites"
            onClick={() => setActiveTab("favorites")}
            className={activeTab === "favorites"
              ? "flex-1 py-2 rounded bg-amber-600/20 text-amber-400 font-medium text-xs border border-amber-500/50"
              : "flex-1 py-2 rounded bg-transparent text-gray-400 hover:text-white hover:bg-[#1B212D] text-xs"
            }
          >
            Favorites
          </button>
          <button
            key="crypto"
            onClick={() => setActiveTab("crypto")}
            className={activeTab === "crypto"
              ? "flex-1 py-2 rounded bg-green-600/20 text-green-400 font-medium text-xs border border-green-500/50"
              : "flex-1 py-2 rounded bg-transparent text-gray-400 hover:text-white hover:bg-[#1B212D] text-xs"
            }
          >
            Crypto
          </button>
          <button
            key="forex"
            onClick={() => setActiveTab("forex")}
            className={activeTab === "forex"
              ? "flex-1 py-2 rounded bg-blue-600/20 text-blue-400 font-medium text-xs border border-blue-500/50"
              : "flex-1 py-2 rounded bg-transparent text-gray-400 hover:text-white hover:bg-[#1B212D] text-xs"
            }
          >
            Forex
          </button>
          <button
            key="indices"
            onClick={() => setActiveTab("indices")}
            className={activeTab === "indices"
              ? "flex-1 py-2 rounded bg-purple-600/20 text-purple-400 font-medium text-xs border border-purple-500/50"
              : "flex-1 py-2 rounded bg-transparent text-gray-400 hover:text-white hover:bg-[#1B212D] text-xs"
            }
          >
            Indices
          </button>
          <button
            key="commodities"
            onClick={() => setActiveTab("commodities")}
            className={activeTab === "commodities"
              ? "flex-1 py-2 rounded bg-orange-600/20 text-orange-400 font-medium text-xs border border-orange-500/50"
              : "flex-1 py-2 rounded bg-transparent text-gray-400 hover:text-white hover:bg-[#1B212D] text-xs"
            }
          >
            Commodities
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {filteredAssets.length === 0 ? (
          <div className="col-span-full py-8 text-center text-gray-500 text-xs">
            No assets in selected category
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filteredAssets.map((asset) => (
              <div
                key={asset.id}
                className={`
                  group bg-[#1B212D] border border-gray-700 rounded p-2 cursor-pointer hover:bg-[#2A3445] transition-colors
                  ${selectedAsset.symbol === asset.symbol
                    ? "border-amber-600/50 shadow-amber-500/10"
                    : ""}
                `}
                onClick={() => handleSelectAsset(asset)}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-300 font-medium">{asset.name}</span>
                  <span className="text-xs text-gray-500">{asset.symbol}</span>
                </div>
                <div className="mt-1">
                  <span className={`text-base font-mono ${asset.symbol === selectedAsset.symbol ? "text-amber-400" : "text-gray-400"}`}>
                    {asset.symbol}
                  </span>
                  <span className={`text-xs font-medium ${asset.symbol === selectedAsset.symbol ? (selectedAsset.isUp ? "text-green-400" : "text-red-500") : "opacity-50"}`}>
                    {selectedAsset.symbol === asset.symbol ? selectedAsset.change : "—"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}