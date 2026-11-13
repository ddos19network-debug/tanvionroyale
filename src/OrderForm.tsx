import React, { useState } from "react";

/**
 * OrderForm - Trade Execution Form
 * 
 * Form for executing buy/sell orders with margin logic
 * and leverage selection. Follows Exness Terminal UX patterns
 * with Tanvion Royale custom branding.
 */
export interface OrderFormProps {
  selectedAsset: {
    symbol: string;
    price: string;
    change: string;
    isUp: boolean;
    lastPrice: number;
  };
  balance: string;
  setOpenPositions: React.Dispatch<React.SetStateAction<any[]>>;
  setBalance: React.Dispatch<React.SetStateAction<string>>;
}

export interface OrderFormState {
  leverage: number;
  orderSize: number;
  marginUsed: number;
  marginAvailable: number;
  selectedSide: "long" | "short";
}

/**
 * OrderForm - Trade Execution Form
 * 
 * Features:
 * - Leverage selection (1x, 5x, 10x, 50x, 100x)
 * - Order size input with live margin calculation
 * - Buy/Sell side toggle
 * - Real-time margin available display
 * - Execution confirmation
 */
export default function OrderForm({
  selectedAsset,
  balance,
  setOpenPositions,
  setBalance,
}: OrderFormProps) {
  const [leverage, setLeverage] = useState(10);
  const [orderSize, setOrderSize] = useState(0.01);
  const [selectedSide, setSelectedSide] = useState<"long" | "short">("long");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Calculate margin based on leverage and position size
  const marginPerUnit = selectedAsset.lastPrice / leverage;
  const marginUsed = orderSize * marginPerUnit;
  const marginAvailable = parseFloat(balance.replace(/[$,]/g, "")) - marginUsed;

  const handleBuy = () => {
    setIsSubmitting(true);
    // Calculate margin to deduct from balance
    const marginPerUnit = selectedAsset.lastPrice / leverage;
    const marginUsed = orderSize * marginPerUnit;
    // Calculate new balance
    const newBalance = (parseFloat(balance.replace(/[$,]/g, "")) - marginUsed).toFixed(2);
    
    // Simulate order execution
    const newPosition = {
      id: Date.now().toString(),
      symbol: selectedAsset.symbol,
      side: "long",
      entryPrice: selectedAsset.lastPrice,
      size: orderSize,
      leverage: leverage,
      tp: 0,
      sl: 0,
      pnl: 0,
      pnlPercent: 0,
      timestamp: Date.now(),
      marginUsed: marginUsed,
    };

    setOpenPositions((prev: any[]) => [...prev, newPosition]);
    setBalance(`$${newBalance}`);
    setIsSubmitting(false);
    setOrderSize(0.01);
  };

  const handleSell = () => {
    setIsSubmitting(true);
    // Calculate margin to deduct from balance
    const marginPerUnit = selectedAsset.lastPrice / leverage;
    const marginUsed = orderSize * marginPerUnit;
    // Calculate new balance
    const newBalance = (parseFloat(balance.replace(/[$,]/g, "")) - marginUsed).toFixed(2);
    
    // Simulate order execution
    const newPosition = {
      id: Date.now().toString(),
      symbol: selectedAsset.symbol,
      side: "short",
      entryPrice: selectedAsset.lastPrice,
      size: orderSize,
      leverage: leverage,
      tp: 0,
      sl: 0,
      pnl: 0,
      pnlPercent: 0,
      timestamp: Date.now(),
      marginUsed: marginUsed,
    };

    setOpenPositions((prev: any[]) => [...prev, newPosition]);
    setBalance(`$${newBalance}`);
    setIsSubmitting(false);
    setOrderSize(0.01);
  };

  return (
    <div className="p-4 space-y-3">
      {/* Leverage Selection */}
      <div>
        <label className="text-sm text-gray-300 font-medium mb-1">Leverage</label>
        <div className="flex space-x-2">
          {[1, 5, 10, 50, 100].map((lev) => (
            <button
              key={lev}
              onClick={() => setLeverage(lev)}
              className={lev === leverage
                ? "flex-1 py-1 rounded bg-amber-600/20 text-amber-400 font-medium border border-amber-500/50"
                : "flex-1 py-1 rounded bg-transparent text-gray-400 hover:text-white hover:bg-[#1B212D] text-xs"
              }
            >
              {lev}x
            </button>
          ))}
        </div>
      </div>

      {/* Order Side Toggle */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => setSelectedSide("long")}
          className={selectedSide === "long"
            ? "col-span-2 py-2 rounded bg-green-600/20 text-green-400 font-medium text-xs border border-green-500/50"
            : "py-2 rounded bg-transparent text-gray-400 hover:text-white hover:bg-[#1B212D] text-xs"
          }
        >
          BUY ({selectedAsset.symbol})
        </button>
        <button
          onClick={() => setSelectedSide("short")}
          className={selectedSide === "short"
            ? "col-span-2 py-2 rounded bg-red-600/20 text-red-400 font-medium text-xs border border-red-500/50"
            : "py-2 rounded bg-transparent text-gray-400 hover:text-white hover:bg-[#1B212D] text-xs"
          }
        >
          SELL ({selectedAsset.symbol})
        </button>
      </div>

      {/* Order Size and Margin */}
      <div>
        <label className="text-sm text-gray-300 font-medium mb-1">Position Size</label>
        <input
          type="number"
          step="0.01"
          min="0.01"
          value={orderSize}
          onChange={(e) => setOrderSize(parseFloat(e.target.value) || 0.01)}
          className="w-full py-2 bg-[#1B212D] border border-gray-700 rounded text-xs text-white focus:outline-none focus:border-amber-500"
          placeholder="Enter position size"
        />
        <div className="mt-1 flex justify-between text-xs">
          <span>Size: {orderSize} {selectedAsset.symbol.split("/")[0]}</span>
          <span>Margin: ${marginUsed.toFixed(2)}</span>
        </div>
        <div className="mt-1 flex justify-between text-xs">
          <span>Available: ${marginAvailable.toFixed(2)}</span>
          <span>{leverage}x leverage</span>
        </div>
      </div>

      {/* Execute Button */}
      <div>
        <button
          onClick={selectedSide === "long" ? handleBuy : handleSell}
          disabled={isSubmitting}
          className={`
            w-full py-2 rounded bg-${selectedSide === "long" ? "green" : "red"}-600/20 
            text-${selectedSide === "long" ? "green" : "red"}-400 font-medium 
            border border-${selectedSide === "long" ? "green" : "red"}-500/50 
            hover:bg-${selectedSide === "long" ? "green-500" : "red-500"} 
            transition-colors
          `}
        >
          {isSubmitting ? "Executing..." : `${selectedSide === "long" ? "BUY" : "SELL"} ${selectedAsset.symbol}`}
        </button>
      </div>
    </div>
  );
}