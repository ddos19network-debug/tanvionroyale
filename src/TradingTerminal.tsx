import React, { useState, useEffect } from "react";
import MarketWatch from "./MarketWatch";
import TradingChart from "./TradingChart";
import OrderForm from "./OrderForm";
import PositionsTable from "./PositionsTable";

/**
 * Main Trading Terminal Layout - Exness Terminal Style
 * 
 * 3-pane layout:
 * - Left Sidebar: Market Watch
 * - Center: Advanced Charting
 * - Right Panel: Order Execution / Bottom Drawer: Positions
 * 
 * Strictly uses Tanvion Royale branding colors throughout.
 */
export default function TradingTerminal() {
  // State for currently selected trading asset/symbol
  const [selectedAsset, setSelectedAsset] = useState({
    symbol: "BTC/USD",
    price: "91,240.50",
    change: "+2.45%",
    isUp: true,
    lastPrice: 91240.50,
  });

  // WebSocket connection state
  const [wsStatus, setWsStatus] = useState<"connecting" | "connected" | "disconnected" | "error">("connecting");
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  // State for balance and portfolio
  const [balance, setBalance] = useState("$10,450.00");
  const [openPositions, setOpenPositions] = useState<Position[]>([]);
  
  // Track margin used for balance deduction
  const marginUsed = openPositions.reduce((sum, pos) => sum + (pos.marginUsed || 0), 0);
  const availableBalance = parseFloat(balance.replace(/[$,]/g, "")) - marginUsed;

  // Initialize WebSocket connection
  useEffect(() => {
    let ws: WebSocket | null = null;
    let reconnectTimeout: NodeJS.Timeout | null = null;
    let isConnected = false;

    const connect = () => {
      setWsStatus("connecting");
      const url = "wss://pricefeed.exness.com/ticks"; // Mock price feed endpoint
      ws = new WebSocket(url);

      ws.onopen = () => {
        setWsStatus("connected");
        isConnected = true;
        setReconnectAttempts(0);
        // Subscribe to BTC/USD tick channel
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: "subscribe",
            symbol: "BTC/USD",
          }));
        }
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "tick" && data.symbol === selectedAsset.symbol) {
            const priceChange = data.priceChange / 100; // Percentage change
            const priceMultiplier = 1 + priceChange;
            const newPrice = Math.round(selectedAsset.lastPrice * priceMultiplier * 100) / 100;
            
            // Ensure price doesn't go to zero or negative
            if (newPrice > 0) {
              const changePercent = ((newPrice - selectedAsset.lastPrice) / selectedAsset.lastPrice * 100).toFixed(2);
              const isUp = newPrice > selectedAsset.lastPrice;

              setSelectedAsset({
                symbol: selectedAsset.symbol,
                price: newPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
                change: `${changePercent > 0 ? "+" : ""}${changePercent}%`,
                isUp,
                lastPrice: newPrice,
              });
            }
          }
        } catch (error) {
          console.error("Error parsing price tick:", error);
        }
      };

      ws.onclose = () => {
        setWsStatus("disconnected");
        isConnected = false;
        // Attempt reconnection with exponential backoff
        if (reconnectAttempts < 5) {
          setReconnectAttempts(prev => prev + 1);
          reconnectTimeout = setTimeout(connect, 1000 * Math.pow(2, reconnectAttempts));
        }
      };

      ws.onerror = (error) => {
        setWsStatus("error");
        console.error("WebSocket error:", error);
      };
    };

    connect();

    // Cleanup on unmount
    return () => {
      if (ws) {
        ws.close();
      }
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
    };
  }, [selectedAsset.symbol, reconnectAttempts]);

  // Fallback price tick simulation when WebSocket is not available
  useEffect(() => {
    if (wsStatus !== "connected") {
      const priceTick = () => {
        const priceChange = (Math.random() - 0.5) * 5; // -2.5 to +2.5
        const newPrice = parseFloat(selectedAsset.price.replace(/,/g, "")) + priceChange;
        const changePercent = ((priceChange / (parseFloat(selectedAsset.price.replace(/,/g, "")))) * 100).toFixed(2);
        const isUp = priceChange > 0;

        setSelectedAsset({
          symbol: selectedAsset.symbol,
          price: newPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
          change: `${changePercent > 0 ? "+" : ""}${changePercent}%`,
          isUp,
          lastPrice: newPrice,
        });
      };

      // Simulate real-time price ticks every 2 seconds when WebSocket disconnected
      const interval = setInterval(priceTick, 2000);
      return () => clearInterval(interval);
    }
  }, [wsStatus, selectedAsset.symbol, selectedAsset.price]);

  // ... rest of the component remains the same
}

/** Position interface for type safety */
interface Position {
  id: string;
  symbol: string;
  side: "long" | "short";
  entryPrice: number;
  currentPrice: number;
  size: number;
  tp: number;
  sl: number;
  pnl: number;
  pnlPercent: number;
  timestamp: number;
}