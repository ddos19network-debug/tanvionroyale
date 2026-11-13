import React from "react";

/**
 * PositionsTable - Live PnL Tracker
 * 
 * Displays open positions with real-time PnL calculations
 * and closure actions. Matches Exness Terminal styling.
 */
export interface Position {
  id: string;
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  currentPrice: number;
  size: number;
  leverage: number;
  tp: number;
  sl: number;
  pnl: number;
  pnlPercent: number;
  timestamp: number;
}

export interface PositionsTableProps {
  openPositions: Position[];
  setOpenPositions: React.Dispatch<React.SetStateAction<Position[]>>;
  selectedAsset: {
    symbol: string;
    price: string;
    change: string;
    isUp: boolean;
    lastPrice: number;
  };
}

/**
 * PositionsTable - Open Positions and Live PnL Tracker
 * 
 * Features:
 * - Live position list with entry/exit prices
 * - Realized and unrealized PnL calculation
 * - TP/SL levels display
 * - Close position actions
 * - Total account balance impact summary
 */
export default function PositionsTable({
  openPositions,
  setOpenPositions,
  selectedAsset,
}: PositionsTableProps) {
  // Calculate total PnL
  const totalPnL = openPositions.reduce(
    (sum, pos) => sum + pos.pnl,
    0
  );
  const totalPnLPercent = openPositions.length > 0
    ? (totalPnL / Math.abs(totalPnL + openPositions.reduce((sum, pos) => sum + pos.entryPrice * pos.size, 0)) * 100)
    : 0;

  // Format number with proper formatting
  const formatNumber = (num: number) => num.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  // Calculate average PnL per position
  const avgPnL = openPositions.length > 0
    ? totalPnL / openPositions.length
    : 0;

  return (
    <div className="p-4 space-y-3">
      {/* Positions List */}
      <div>
        <label className="text-sm text-gray-300 font-medium mb-2">Open Positions</label>
        {openPositions.length === 0 ? (
          <div className="p-3 bg-[#1B212D] rounded text-center text-gray-500">
            No open positions
          </div>
        ) : (
          <div className="overflow-x-auto text-sm">
            <table className="w-full border border-gray-700 rounded">
              <thead className="bg-[#12161F] border-b border-gray-700/50">
                <tr>
                  <th className="p-2 text-left text-xs font-medium text-gray-300">Symbol</th>
                  <th className="p-2 text-left text-xs font-medium text-gray-300">Side</th>
                  <th className="p-2 text-left text-xs font-medium text-gray-300">Entry</th>
                  <th className="p-2 text-left text-xs font-medium text-gray-300">Current</th>
                  <th className="p-2 text-left text-xs font-medium text-gray-300">Size</th>
                  <th className="p-2 text-left text-xs font-medium text-gray-300">PnL</th>
                  <th className="p-2 text-left text-xs font-medium text-gray-300">Actions</th>
                </tr>
              </thead>
              <tbody>
                {openPositions.map((pos) => (
                  <tr key={pos.id} className="border-b border-gray-700/50 hover:bg-[#1A2632]">
                    <td className="p-2 font-medium">{pos.symbol}</td>
                    <td className="p-2">
                      <span className={pos.side === "long" ? "text-green-400" : "text-red-400">
                        {pos.side.toUpperCase()}
                      </span>
                    </td>
                    <td className="p-2 font-mono text-amber-400">{formatNumber(pos.entryPrice)}</td>
                    <td className="p-2 font-mono">
                      <span className={pos.pnl >= 0 ? "text-green-400" : "text-red-500">
                        {formatNumber(pos.currentPrice)}
                      </span>
                    </td>
                    <td className="p-2 font-mono text-gray-300">{formatNumber(pos.size)}</td>
                    <td className="p-2">
                      <span className={pos.pnl >= 0 ? "text-green-400" : "text-red-500">
                        {formatNumber(pos.pnl)} ({formatNumber(pos.pnlPercent)}%)
                      </span>
                    </td>
                    <td className="p-2">
                      <button
                        className="px-2 py-1 rounded text-xs text-red-400 hover:text-red-300 transition-colors"
                        onClick={() => setOpenPositions((prev: Position[]) => prev.filter((p) => p.id !== pos.id))}
                      >
                        Close
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Summary Section */}
      <div className="grid grid-cols-2 gap-2 pt-2">
        <div className="p-3 bg-[#1B212D] rounded border border-gray-700/50">
          <div className="text-xs text-gray-400">Total PnL</div>
          <div className="text-lg font-bold {totalPnL >= 0 ? "text-green-400" : "text-red-500"}">
            {formatNumber(totalPnL)}
          </div>
          <div className="text-xs text-gray-500">{formatNumber(totalPnLPercent)}%</div>
        </div>
        <div className="p-3 bg-[#1B212D] rounded border border-gray-700/50">
          <div className="text-xs text-gray-400">Avg PnL/Trade</div>
          <div className="text-lg font-medium">
            {formatNumber(avgPnL)}
          </div>
          <div className="text-xs text-gray-500">{openPositions.length} positions</div>
        </div>
      </div>
    </div>
  );
}