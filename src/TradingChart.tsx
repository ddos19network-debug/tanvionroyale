import React from "react";

/**
 * TradingView Lightweight Charts Wrapper
 * 
 * Wrapper for TradingView's lightweight charts library
 * Provides a clean chart container with proper typography
 * for price/PnL elements to prevent layout shift.
 */
export interface TradingChartProps {
  selectedAsset: {
    symbol: string;
    price: string;
    change: string;
    isUp: boolean;
    lastPrice: number;
  };
}

/**
 * TradingChart - Main chart component
 * 
 * Renders the TradingView lightweight charts container.
 * In a production environment, this would initialize the
 * TradingView chart with the selected symbol data.
 */
export default function TradingChart({ selectedAsset }: TradingChartProps) {
  // Simulate chart data for demonstration
  const chartData = [
    { time: "00:00", open: 91230, high: 91500, low: 91000, close: 91240.5, volume: 1234 },
    { time: "04:00", open: 91240.5, high: 91600, low: 91100, close: 91400, volume: 2345 },
    { time: "08:00", open: 91400, high: 91800, low: 91350, close: 91550, volume: 3456 },
    { time: "12:00", open: 91550, high: 92000, low: 91500, close: 91700, volume: 4567 },
    { time: "16:00", open: 91700, high: 92100, low: 91650, close: 91850, volume: 5678 },
    { time: "20:00", open: 91850, high: 92200, low: 91800, close: 91240.5, volume: 6789 },
  ];

  return (
    <div className="h-full relative bg-[#0F131D] rounded border border-gray-800/50 overflow-hidden">
      {/* Chart Header */}
      <div className="p-3 border-b border-gray-700/50 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-300">
          {selectedAsset.symbol} Chart
        </span>
        <span className={selectedAsset.isUp ? "text-green-400" : "text-red-500">
          {selectedAsset.change}
        </span>
      </div>

      {/* Candlestick Container */}
      <div className="h-64 relative">
        {/* Chart content would be rendered by TradingView Lightweight Charts */}
        <div className="h-full flex items-center justify-center text-center text-gray-400">
          <div className="text-xs font-mono">
            Chart container ready for TradingView integration
          </div>
          <div className="mt-2">
            {selectedAsset.price}
          </div>
        </div>
      </div>

      {/* Bottom Info Bar */}
      <div className="p-3 border-t border-gray-700/50 flex items-center justify-between">
        <span className="text-xs text-gray-400">Last Update: real-time</span>
        <span className="text-sm font-mono text-amber-400">
          {selectedAsset.price}
        </span>
      </div>
    </div>
  );
export interface TradingChartProps {
  selectedAsset: {
    symbol: string;
    price: string;
    change: string;
    isUp: boolean;
    lastPrice: number;
  };
  showIndicators?: boolean;
  smaPeriods?: number[];
  emaPeriods?: number[];
  rsiPeriod?: number;
}
}
const calculateSMA = (prices: number[], period: number): number[] => {
  const sma: number[] = [];
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      sma.push(prices[i]);
    } else {
      const window = prices.slice(i - period + 1, i + 1);
      const average = window.reduce((sum, price) => sum + price, 0) / period;
      sma.push(average);
    }
  }
  return sma;
};

const calculateEMA = (prices: number[], period: number): number[] => {
  const ema: number[] = [];
  const multiplier = 2 / (period + 1);
  
  for (let i = 0; i < prices.length; i++) {
    if (i === 0) {
      ema.push(prices[i]);
    } else if (i < period - 1) {
      ema.push(prices[i]);
    } else {
      const currentPrice = prices[i];
      const previousEMA = ema[i - 1];
      const newEMA = (currentPrice - previousEMA) * multiplier + previousEMA;
      ema.push(newEMA);
    }
  }
  return ema;
};

const calculateRSI = (prices: number[], period: number): number[] => {
  const rsi: number[] = [];
  let gains = 0;
  let losses = 0;
  
  // Initial average gain/loss
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  
  let avgGain = gains / period;
  let avgLoss = losses / period;
  
  // First RSI value
  if (avgLoss === 0) {
    rsi.push(100);
  } else {
    const rs = avgGain / avgLoss;
    rsi.push(100 - (100 / (1 + rs)));
  }
  
  // Subsequent RSI values
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) gains = change;
    else losses = Math.abs(change);
    
    avgGain = (avgGain * (period - 1) + gains) / period;
    avgLoss = (avgLoss * (period - 1) + losses) / period;
    
    if (avgLoss === 0) {
      rsi.push(100);
    } else {
      const rs = avgGain / avgLoss;
      rsi.push(100 - (100 / (1 + rs)));
    }
  }
  
  return rsi;
};