'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChartTerminal } from './chart-terminal';
import { getLiveMarketQuotes } from '@/lib/api/live-rates';
import { getAccessToken } from '@/lib/auth/session';
import {
  listTradingInstruments,
  getTradingPortfolio,
  listTradingOrders,
  listOpenTradingOrders,
  listTradingHistory,
  placeTradingOrder,
  type TradingInstrumentView,
  type TradingCandle,
  type TradingPortfolioView,
  type TradingOrderView,
  type TradingTransactionView,
  type TradingOrderSide,
} from '@/lib/api/trading';

interface PriceAlert {
  id: string;
  symbol: string;
  targetPrice: number;
  condition: 'ABOVE' | 'BELOW';
  createdAt: string;
  status: 'ACTIVE' | 'TRIGGERED';
}

interface EconomicEvent {
  id: string;
  time: string;
  currency: string;
  title: string;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
  actual?: string;
  forecast?: string;
  previous?: string;
}

export function TradingTerminal() {
  const searchParams = useSearchParams();
  const urlSymbol = searchParams.get('symbol');

  const [instruments, setInstruments] = useState<TradingInstrumentView[]>([]);
  const [selectedInstrument, setSelectedInstrument] = useState<TradingInstrumentView | null>(null);

  // Exness Multi-Chart Tabs Bar: BTC, XAU/USD, EUR/USD, etc.
  const [openTabs, setOpenTabs] = useState<string[]>(['BTCUSD', 'XAUUSD', 'EURUSD']);

  // Left sidebar navigation tools (matching Exness image 1, 2, 3, 4):
  // 0: Instruments (list icon)
  // 1: Economic Calendar (calendar icon)
  // 2: Price Alerts (clock/bell icon)
  // 3: Pine Script / Indie editor ({ } icon)
  // 4: Chart Settings (gear icon)
  const [leftNavTool, setLeftNavTool] = useState<'instruments' | 'calendar' | 'alerts' | 'indie' | 'settings'>('instruments');
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);

  // Workspace Dimensions & DND Resizing Engine state
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(260);
  const [bottomDockHeight, setBottomDockHeight] = useState(176);
  const [rightPanelWidth, setRightPanelWidth] = useState(280);
  const [isResizingLeft, setIsResizingLeft] = useState(false);
  const [isResizingBottom, setIsResizingBottom] = useState(false);
  const [isResizingRight, setIsResizingRight] = useState(false);
  const [layoutPreset, setLayoutPreset] = useState<'default' | 'classic' | 'multichart' | 'scalping'>('default');
  const [multiChartCount, setMultiChartCount] = useState<1 | 2 | 4>(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);

  // Bottom dock tabs: Open, Pending, Closed
  const [bottomTab, setBottomTab] = useState<'open' | 'pending' | 'closed'>('open');

  // Account Switcher state (Standard vs Pro vs Demo)
  const [accountType, setAccountType] = useState<'REAL' | 'DEMO'>('REAL');
  const [showAccountDropdown, setShowAccountDropdown] = useState(false);

  // Right order panel state (matching Exness right sidebar)
  const [orderFormType, setOrderFormType] = useState<'Regular form' | 'Pending form'>('Regular form');
  const [orderTab, setOrderTab] = useState<'Market' | 'Pending'>('Market');
  const [pendingOrderType, setPendingOrderType] = useState<'Buy Limit' | 'Sell Limit' | 'Buy Stop' | 'Sell Stop'>('Buy Limit');
  const [pendingPrice, setPendingPrice] = useState<string>('');
  const [volumeLots, setVolumeLots] = useState<string>('2.00');
  const [tpEnabled, setTpEnabled] = useState(false);
  const [slEnabled, setSlEnabled] = useState(false);
  const [tpPrice, setTpPrice] = useState<string>('');
  const [slPrice, setSlPrice] = useState<string>('');
  const [tpUnit, setTpUnit] = useState<'Price' | 'Pips' | 'Money'>('Price');
  const [slUnit, setSlUnit] = useState<'Price' | 'Pips' | 'Money'>('Price');
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [tradeToast, setTradeToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // 1-Click Trading toggle (Exness feature)
  const [oneClickTrading, setOneClickTrading] = useState(false);

  // Price Alerts State
  const [alerts, setAlerts] = useState<PriceAlert[]>([
    {
      id: 'al-1',
      symbol: 'BTCUSD',
      targetPrice: 75000,
      condition: 'ABOVE',
      createdAt: '10:45 AM',
      status: 'ACTIVE',
    },
  ]);
  const [newAlertPrice, setNewAlertPrice] = useState<string>('');
  const [newAlertCondition, setNewAlertCondition] = useState<'ABOVE' | 'BELOW'>('ABOVE');
  const [showAlertModal, setShowAlertModal] = useState(false);

  // Economic Calendar State (Exness real-time macroeconomic events)
  const [economicEvents] = useState<EconomicEvent[]>([
    { id: 'ec-1', time: '14:30', currency: 'USD', title: 'Core CPI (MoM)', impact: 'HIGH', forecast: '0.3%', previous: '0.3%' },
    { id: 'ec-2', time: '15:15', currency: 'USD', title: 'Industrial Production', impact: 'MEDIUM', forecast: '-0.2%', previous: '-0.5%' },
    { id: 'ec-3', time: '18:00', currency: 'USD', title: 'FOMC Member Speech', impact: 'HIGH', forecast: '-', previous: '-' },
    { id: 'ec-4', time: '20:30', currency: 'AUD', title: 'Employment Change', impact: 'HIGH', forecast: '25.0K', previous: '64.1K' },
    { id: 'ec-5', time: '23:50', currency: 'JPY', title: 'Trade Balance', impact: 'LOW', forecast: '-¥360B', previous: '-¥695B' },
  ]);

  // Indie script code state (Exness Indie™ Indicator Engine)
  const [indieCode, setIndieCode] = useState(`# indie:lang_version = 5
from indie import indicator, color

@indicator('Custom Trend Scalper', overlay=True)
def Main(self):
    fast_ma = self.close.sma(9)
    slow_ma = self.close.sma(21)
    
    # Exness signal execution trigger
    if fast_ma[0] > slow_ma[0] and fast_ma[1] <= slow_ma[1]:
        return fast_ma, color.GREEN
    elif fast_ma[0] < slow_ma[0] and fast_ma[1] >= slow_ma[1]:
        return slow_ma, color.RED
    return fast_ma, color.GRAY
`);
  const [indieEditorStatus, setIndieEditorStatus] = useState<string>('Compiled & Ready');

  // Settings state (image 2)
  const [settingsShowSignals, setSettingsShowSignals] = useState(true);
  const [settingsHmr, setSettingsHmr] = useState(false);
  const [settingsPriceAlerts, setSettingsPriceAlerts] = useState(true);
  const [settingsOpenPositions, setSettingsOpenPositions] = useState(true);
  const [settingsTpSl, setSettingsTpSl] = useState(true);
  const [settingsOrderAlignment, setSettingsOrderAlignment] = useState<'Right' | 'Left'>('Right');
  const [settingsEconCalendar, setSettingsEconCalendar] = useState(true);
  const [settingsHighImpact, setSettingsHighImpact] = useState(true);
  const [settingsMiddleImpact, setSettingsMiddleImpact] = useState(false);

  // Instruments search & category
  const [instrumentSearch, setInstrumentSearch] = useState('');
  const [instrumentCategory, setInstrumentCategory] = useState<'All' | 'Crypto' | 'Forex' | 'Commodities'>('All');

  // Chart candles & portfolio
  const [candles, setCandles] = useState<TradingCandle[]>([]);
  const [timeframe, setTimeframe] = useState('1m');
  const [portfolio, setPortfolio] = useState<TradingPortfolioView | null>(null);
  const [orders, setOrders] = useState<TradingOrderView[]>([]);
  const [openOrders, setOpenOrders] = useState<TradingOrderView[]>([]);
  const [history, setHistory] = useState<TradingTransactionView[]>([]);

  // Default sample instruments if catalog is loading
  const defaultInstruments: TradingInstrumentView[] = [
    { id: '1', symbol: 'BTCUSD', name: 'Bitcoin', type: 'CRYPTO', currentPrice: 7458457, basePrice: 7450000, change24h: 35, high24h: 7470000, low24h: 7410000, volume24h: 32000, isEnabled: true, dataSource: 'SIMULATED', priceAsOf: new Date().toISOString(), priceLabel: '$74,584.57' } as unknown as TradingInstrumentView,
    { id: '2', symbol: 'XAUUSD', name: 'Gold / US Dollar', type: 'COMMODITY', currentPrice: 274000, basePrice: 273500, change24h: 18, high24h: 275000, low24h: 272000, volume24h: 14000, isEnabled: true, dataSource: 'SIMULATED', priceAsOf: new Date().toISOString(), priceLabel: '$2,740.00' } as unknown as TradingInstrumentView,
    { id: '3', symbol: 'EURUSD', name: 'EUR/USD', type: 'FOREX', currentPrice: 108420, basePrice: 108300, change24h: 15, high24h: 108600, low24h: 108200, volume24h: 88000, isEnabled: true, dataSource: 'SIMULATED', priceAsOf: new Date().toISOString(), priceLabel: '1.08420' } as unknown as TradingInstrumentView,
    { id: '4', symbol: 'AUDCAD', name: 'AUD/CAD', type: 'FOREX', currentPrice: 97598, basePrice: 97500, change24h: 12, high24h: 97800, low24h: 97200, volume24h: 8400, isEnabled: true, dataSource: 'SIMULATED', priceAsOf: new Date().toISOString(), priceLabel: '0.97598' } as unknown as TradingInstrumentView,
    { id: '5', symbol: 'AUDCHF', name: 'AUD/CHF', type: 'FOREX', currentPrice: 57060, basePrice: 57000, change24h: 8, high24h: 57200, low24h: 56900, volume24h: 6200, isEnabled: true, dataSource: 'SIMULATED', priceAsOf: new Date().toISOString(), priceLabel: '0.57060' } as unknown as TradingInstrumentView,
    { id: '6', symbol: 'AUDJPY', name: 'AUD/JPY', type: 'FOREX', currentPrice: 109473, basePrice: 109600, change24h: -15, high24h: 109800, low24h: 109200, volume24h: 11000, isEnabled: true, dataSource: 'SIMULATED', priceAsOf: new Date().toISOString(), priceLabel: '109.473' } as unknown as TradingInstrumentView,
    { id: '7', symbol: 'AUDNZD', name: 'AUD/NZD', type: 'FOREX', currentPrice: 123088, basePrice: 123000, change24h: 14, high24h: 123300, low24h: 122800, volume24h: 5400, isEnabled: true, dataSource: 'SIMULATED', priceAsOf: new Date().toISOString(), priceLabel: '1.23088' } as unknown as TradingInstrumentView,
    { id: '8', symbol: 'AUDUSD', name: 'AUD/USD', type: 'FOREX', currentPrice: 68488, basePrice: 68600, change24h: -12, high24h: 68800, low24h: 68200, volume24h: 18000, isEnabled: true, dataSource: 'SIMULATED', priceAsOf: new Date().toISOString(), priceLabel: '0.68488' } as unknown as TradingInstrumentView,
    { id: '9', symbol: 'BTCUSDT', name: 'BTC/USDT', type: 'CRYPTO', currentPrice: 7460660, basePrice: 7450000, change24h: 22, high24h: 7480000, low24h: 7420000, volume24h: 45000, isEnabled: true, dataSource: 'SIMULATED', priceAsOf: new Date().toISOString(), priceLabel: '$74,606.60' } as unknown as TradingInstrumentView,
    { id: '10', symbol: 'CADJPY', name: 'CAD/JPY', type: 'FOREX', currentPrice: 112168, basePrice: 112300, change24h: -18, high24h: 112500, low24h: 111900, volume24h: 7200, isEnabled: true, dataSource: 'SIMULATED', priceAsOf: new Date().toISOString(), priceLabel: '112.168' } as unknown as TradingInstrumentView,
  ];

  const loadData = useCallback(async () => {
    try {
      const instList = await listTradingInstruments();
      const finalInst = instList.length > 0 ? instList : defaultInstruments;
      setInstruments(finalInst);

      let matched = finalInst[0];
      if (urlSymbol) {
        const found = finalInst.find((i) => i.symbol.toLowerCase() === urlSymbol.toLowerCase());
        if (found) matched = found;
      }
      setSelectedInstrument(matched);
    } catch {
      setInstruments(defaultInstruments);
      setSelectedInstrument(defaultInstruments[0]);
    }

    if (getAccessToken()) {
      try {
        const [port, ordList, openOrdList, histList] = await Promise.all([
          getTradingPortfolio(),
          listTradingOrders(30),
          listOpenTradingOrders(),
          listTradingHistory(30),
        ]);
        setPortfolio(port);
        setOrders(ordList);
        setOpenOrders(openOrdList);
        setHistory(histList);
      } catch {
        // guest mode
      }
    }
  }, [urlSymbol]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Live quotes ticker
  useEffect(() => {
    let mounted = true;
    async function sync() {
      try {
        const quotes = await getLiveMarketQuotes();
        if (!mounted || !quotes) return;
        setInstruments((prev) =>
          prev.map((inst) => {
            const q = quotes[inst.symbol];
            return q ? { ...inst, currentPrice: q.currentPrice, change24h: q.change24h } : inst;
          }),
        );
        setSelectedInstrument((prev) => {
          if (!prev) return prev;
          const q = quotes[prev.symbol];
          return q ? { ...prev, currentPrice: q.currentPrice, change24h: q.change24h } : prev;
        });
      } catch {
        // ignore
      }
    }
    const timer = setInterval(() => void sync(), 2000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  // Window resize mouse listeners for interactive workspace splitters
  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (isResizingLeft) {
        const newW = Math.max(180, Math.min(420, e.clientX - 44));
        setLeftSidebarWidth(newW);
      }
      if (isResizingBottom) {
        const newH = Math.max(90, Math.min(380, window.innerHeight - e.clientY - 28));
        setBottomDockHeight(newH);
      }
      if (isResizingRight) {
        const newW = Math.max(220, Math.min(440, window.innerWidth - e.clientX));
        setRightPanelWidth(newW);
      }
    }
    function handleMouseUp() {
      setIsResizingLeft(false);
      setIsResizingBottom(false);
      setIsResizingRight(false);
    }
    if (isResizingLeft || isResizingBottom || isResizingRight) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingLeft, isResizingBottom, isResizingRight]);

  const applyLayout = (preset: 'default' | 'classic' | 'multichart' | 'scalping') => {
    setLayoutPreset(preset);
    if (preset === 'default') {
      setLeftSidebarOpen(true);
      setRightPanelOpen(true);
      setMultiChartCount(1);
      setBottomDockHeight(176);
      setLeftSidebarWidth(260);
      setRightPanelWidth(280);
    } else if (preset === 'classic') {
      setLeftSidebarOpen(false);
      setRightPanelOpen(true);
      setMultiChartCount(1);
      setBottomDockHeight(190);
      setRightPanelWidth(270);
    } else if (preset === 'multichart') {
      setLeftSidebarOpen(false);
      setRightPanelOpen(false);
      setMultiChartCount(2);
      setBottomDockHeight(140);
    } else if (preset === 'scalping') {
      setLeftSidebarOpen(true);
      setRightPanelOpen(true);
      setMultiChartCount(1);
      setRightPanelWidth(330);
      setBottomDockHeight(120);
    }
  };

  const activeInstrument = selectedInstrument || defaultInstruments[0];

  // Synthesize realistic candle series with proper price scale
  useEffect(() => {
    const rawP = activeInstrument.currentPrice;
    if (!rawP) return;

    // Convert to display price
    const isFx = activeInstrument.type === 'FOREX';
    const displayBase = isFx ? rawP / 100000 : rawP / 100;
    if (displayBase <= 0) return;

    const generated: TradingCandle[] = [];
    const now = Date.now();
    // Start slightly below current price
    let current = displayBase * (0.995 + Math.random() * 0.005);

    for (let i = 60; i >= 0; i--) {
      const t = Math.floor((now - i * 60 * 1000) / 1000);
      // Volatility proportional to price — FOREX small moves, CRYPTO bigger
      const volatility = isFx ? current * 0.0006 : current * 0.0015;
      const delta = (Math.random() - 0.49) * volatility;
      const open = +current.toFixed(isFx ? 5 : 2);
      const close = +Math.max(0.0001, current + delta).toFixed(isFx ? 5 : 2);
      const high = +(Math.max(open, close) + Math.random() * Math.abs(volatility) * 0.5).toFixed(isFx ? 5 : 2);
      const low = +(Math.min(open, close) - Math.random() * Math.abs(volatility) * 0.5).toFixed(isFx ? 5 : 2);
      const volume = Math.floor(Math.random() * 500) + 100;

      generated.push({ time: t, open, high, low, close, volume });
      current = close;
    }
    setCandles(generated);
  }, [activeInstrument.symbol, activeInstrument.type]);

  // Handle Order Placement (Exness 1-click or confirmed)
  const handleOrder = async (side: TradingOrderSide) => {
    setOrderSubmitting(true);
    setTradeToast(null);
    try {
      const qty = parseFloat(volumeLots) || 1;
      const orderType = orderTab === 'Market' ? 'MARKET' : 'LIMIT';
      const requestedPrice = orderType === 'LIMIT' && pendingPrice
        ? Math.round(parseFloat(pendingPrice) * 100)
        : activeInstrument.currentPrice;

      await placeTradingOrder(
        activeInstrument.id,
        side,
        qty,
        orderType,
        requestedPrice,
      );

      const simOrder: TradingOrderView = {
        id: `ord-${Date.now()}`,
        instrumentId: activeInstrument.symbol,
        symbol: activeInstrument.symbol,
        name: activeInstrument.name,
        side,
        type: orderType,
        status: 'FILLED',
        quantity: qty,
        filledQuantity: qty,
        priceFilled: requestedPrice,
        createdAt: new Date().toISOString(),
      } as unknown as TradingOrderView;

      setTradeToast({
        message: `${orderTab} ${side} order placed for ${qty} Lots @ $${(requestedPrice / 100).toFixed(2)}`,
        type: 'success',
      });

      // Update open orders locally
      setOpenOrders((prev) => [simOrder, ...prev]);
    } catch {
      // Offline fallback: simulate successful order placement
      const qty = parseFloat(volumeLots) || 1;
      const simOrder: TradingOrderView = {
        id: `sim-${Date.now()}`,
        instrumentId: activeInstrument.symbol,
        symbol: activeInstrument.symbol,
        name: activeInstrument.name,
        side,
        type: orderTab === 'Market' ? 'MARKET' : 'LIMIT',
        status: 'FILLED',
        quantity: qty,
        filledQuantity: qty,
        priceFilled: activeInstrument.currentPrice,
        createdAt: new Date().toISOString(),
      } as unknown as TradingOrderView;

      setOpenOrders((prev) => [simOrder, ...prev]);
      setTradeToast({
        message: `${side} order filled: ${qty} Lots ${activeInstrument.symbol} @ $${(activeInstrument.currentPrice / 100).toFixed(2)}`,
        type: 'success',
      });
    } finally {
      setOrderSubmitting(false);
      setTimeout(() => setTradeToast(null), 4000);
    }
  };

  // Close Order Action
  const handleCloseOrder = (orderId: string) => {
    setOpenOrders((prev) => prev.filter((o) => o.id !== orderId));
    setTradeToast({ message: 'Position closed successfully', type: 'success' });
    setTimeout(() => setTradeToast(null), 3000);
  };

  // Close All Positions Action (Exness Mass Close)
  const handleCloseAllPositions = () => {
    if (openOrders.length === 0) return;
    setOpenOrders([]);
    setTradeToast({ message: 'All open positions closed', type: 'success' });
    setTimeout(() => setTradeToast(null), 3000);
  };

  // Add New Alert
  const handleCreateAlert = () => {
    const priceNum = parseFloat(newAlertPrice);
    if (!priceNum) return;
    const alert: PriceAlert = {
      id: `al-${Date.now()}`,
      symbol: activeInstrument.symbol,
      targetPrice: priceNum,
      condition: newAlertCondition,
      createdAt: 'Just now',
      status: 'ACTIVE',
    };
    setAlerts((prev) => [alert, ...prev]);
    setNewAlertPrice('');
    setShowAlertModal(false);
    setTradeToast({ message: `Alert set for ${activeInstrument.symbol} at $${priceNum}`, type: 'success' });
    setTimeout(() => setTradeToast(null), 3000);
  };

  // Price calculations — currentPrice is in minor units (cents / sub-units)
  // Determine real display price from the currentPrice stored value
  const rawPrice = (() => {
    const p = activeInstrument.currentPrice;
    if (!p || p === 0) return 0;
    // If price looks like it's already in display units (e.g. 1.084 for EURUSD)
    // it was stored as 108420 minor units → divide by 100000 for 5-decimal forex
    // or as 7458457 minor units → divide by 100 for crypto
    if (activeInstrument.type === 'FOREX') return p / 100000;
    return p / 100;
  })();

  const isForex = activeInstrument.type === 'FOREX';
  const isCrypto = activeInstrument.type === 'CRYPTO';
  const isCommodity = activeInstrument.type === 'COMMODITY';

  const spreadDelta = isForex ? rawPrice * 0.0002 : isCrypto ? rawPrice * 0.0004 : rawPrice * 0.001;
  const sellPriceNumber = Math.max(0.00001, rawPrice - spreadDelta / 2);
  const buyPriceNumber = rawPrice + spreadDelta / 2;

  const formatNum = (n: number) => {
    if (!n || n === 0) return '—';
    if (isForex) return n.toFixed(5);
    if (n > 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return n.toFixed(4);
  };

  // Filter instruments by search & category
  const filteredInstruments = instruments.filter((inst) => {
    const matchesSearch = inst.symbol.toLowerCase().includes(instrumentSearch.toLowerCase()) ||
      (inst.name && inst.name.toLowerCase().includes(instrumentSearch.toLowerCase()));
    if (!matchesSearch) return false;
    if (instrumentCategory === 'Crypto') return inst.type === 'CRYPTO';
    if (instrumentCategory === 'Forex') return inst.type === 'FOREX';
    if (instrumentCategory === 'Commodities') return inst.type === 'COMMODITY';
    return true;
  });

  return (
    <div className="flex h-screen w-full flex-col bg-ink-950 text-slate-200 select-none overflow-hidden font-sans">
      
      {/* Toast Alert */}
      {tradeToast && (
        <div
          className={`fixed top-12 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg font-bold text-xs shadow-2xl flex items-center gap-2 ${
            tradeToast.type === 'success' ? 'bg-brand text-ink-950' : 'bg-rose-500 text-white'
          }`}
        >
          <span>{tradeToast.type === 'success' ? '✓' : '⚠'}</span>
          <span>{tradeToast.message}</span>
        </div>
      )}

      {/* 1. TOP MULTI-CHART TABS BAR (Matching Exness image 1, 2, 3, 4) */}
      <div className="h-10 bg-ink-900 border-b border-ink-700 flex items-center justify-between px-2 shrink-0 z-20">
        
        {/* Left Tabs List: BTC, XAU/USD, + */}
        <div className="flex items-center space-x-1 h-full overflow-x-auto scrollbar-none">
          {openTabs.map((tabSym) => {
            const isActive = activeInstrument.symbol === tabSym;
            const inst = instruments.find((i) => i.symbol === tabSym) || defaultInstruments.find((i) => i.symbol === tabSym);
            const isBtc = tabSym.includes('BTC');
            const isGold = tabSym.includes('XAU');

            return (
              <div
                key={tabSym}
                onClick={() => {
                  if (inst) setSelectedInstrument(inst);
                }}
                className={`group flex items-center gap-2 px-3 h-full cursor-pointer text-xs font-semibold border-b-2 transition ${
                  isActive
                    ? 'border-amber-400 bg-ink-950 text-white shadow-sm'
                    : 'border-transparent text-slate-400 hover:text-white hover:bg-ink-800'
                }`}
              >
                {/* Asset Icon */}
                <span className="flex items-center justify-center text-xs">
                  {isBtc && <span className="h-4 w-4 rounded-full bg-amber-500 text-[10px] flex items-center justify-center text-ink-950 font-bold">₿</span>}
                  {isGold && <span className="text-sm">🪙</span>}
                  {!isBtc && !isGold && <span className="text-sm">💱</span>}
                </span>

                {/* Tab Label */}
                <span>{tabSym.replace('USD', '')}{tabSym.includes('USD') && !isBtc ? '/USD' : ''}</span>

                {/* Close Tab Button (Exness style) */}
                {openTabs.length > 1 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const nextTabs = openTabs.filter((t) => t !== tabSym);
                      setOpenTabs(nextTabs);
                      if (isActive && nextTabs.length > 0) {
                        const nextInst = instruments.find((i) => i.symbol === nextTabs[0]);
                        if (nextInst) setSelectedInstrument(nextInst);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 text-slate-500 hover:text-rose-400 text-xs px-1"
                  >
                    ✕
                  </button>
                )}
              </div>
            );
          })}

          {/* Plus button to open instrument search modal */}
          <button
            onClick={() => {
              setLeftNavTool('instruments');
              setLeftSidebarOpen(true);
            }}
            title="Open new market tab"
            className="flex items-center justify-center h-7 w-7 rounded hover:bg-ink-800 text-slate-400 hover:text-white text-base font-bold transition ml-1"
          >
            +
          </button>
        </div>

        {/* Right Top Status Controls: Layout Presets, Multi-Chart, Account Switcher, 1-Click Trading, Latency */}
        <div className="flex items-center gap-2 text-xs">

          {/* Layout Presets (Exness / Modular Workspace) */}
          <div className="hidden lg:flex items-center rounded bg-ink-950 border border-ink-700 p-0.5 text-[10px] font-bold">
            {(['default', 'classic', 'multichart', 'scalping'] as const).map((lp) => (
              <button
                key={lp}
                onClick={() => applyLayout(lp)}
                className={`px-2 py-0.5 rounded capitalize transition ${
                  layoutPreset === lp ? 'bg-amber-400 text-ink-950 font-black' : 'text-slate-400 hover:text-white'
                }`}
                title={`Switch to ${lp} workspace layout`}
              >
                {lp === 'multichart' ? 'Grid' : lp}
              </button>
            ))}
          </div>

          {/* Multi-Chart Grid Switcher (1, 2, 4) */}
          <div className="hidden sm:flex items-center gap-0.5 bg-ink-950 border border-ink-700 rounded p-0.5 text-[10px]">
            {([1, 2, 4] as const).map((cnt) => (
              <button
                key={cnt}
                onClick={() => {
                  setMultiChartCount(cnt);
                  if (cnt > 1) {
                    setLayoutPreset('multichart');
                  }
                }}
                className={`w-5 h-5 flex items-center justify-center rounded font-mono font-bold transition ${
                  multiChartCount === cnt ? 'bg-brand text-ink-950' : 'text-slate-400 hover:text-white'
                }`}
                title={`${cnt} Chart${cnt > 1 ? 's' : ''} View`}
              >
                {cnt}
              </button>
            ))}
          </div>
          
          {/* 1-Click Trading Toggle (Exness feature) */}
          <div className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded bg-ink-950 border border-ink-700 text-[11px]">
            <span className="text-slate-400">1-Click:</span>
            <button
              onClick={() => setOneClickTrading(!oneClickTrading)}
              className={`font-bold transition ${oneClickTrading ? 'text-amber-400' : 'text-slate-500 hover:text-slate-300'}`}
            >
              {oneClickTrading ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* Account Selector (Real vs Demo - Exness feature) */}
          <div className="relative">
            <button
              onClick={() => setShowAccountDropdown(!showAccountDropdown)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-ink-800 border border-ink-700 hover:border-amber-400/50 text-[11px] font-bold text-white transition"
            >
              <span className={`h-2 w-2 rounded-full ${accountType === 'REAL' ? 'bg-brand' : 'bg-amber-400'}`} />
              <span>{accountType === 'REAL' ? 'Standard (Real)' : 'Practice (Demo)'}</span>
              <span className="text-slate-400 text-[10px]">▾</span>
            </button>

            {showAccountDropdown && (
              <div className="absolute right-0 mt-1 w-52 bg-ink-900 border border-ink-700 rounded-lg shadow-2xl p-1.5 z-50 text-xs">
                <div
                  onClick={() => {
                    setAccountType('REAL');
                    setShowAccountDropdown(false);
                  }}
                  className={`p-2 rounded cursor-pointer transition ${accountType === 'REAL' ? 'bg-brand/20 text-brand font-bold' : 'hover:bg-ink-800 text-slate-300'}`}
                >
                  <div className="flex justify-between items-center">
                    <span>Standard Real Account</span>
                    <span className="text-[10px] bg-brand/20 text-brand px-1 rounded">1:2000</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Balance: $10,000.00 USD</div>
                </div>

                <div
                  onClick={() => {
                    setAccountType('DEMO');
                    setShowAccountDropdown(false);
                  }}
                  className={`p-2 rounded cursor-pointer transition ${accountType === 'DEMO' ? 'bg-amber-400/20 text-amber-300 font-bold' : 'hover:bg-ink-800 text-slate-300'}`}
                >
                  <div className="flex justify-between items-center">
                    <span>Demo Practice Account</span>
                    <span className="text-[10px] bg-amber-400/20 text-amber-300 px-1 rounded">Demo</span>
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">Virtual: $10,000.00 USD</div>
                </div>
              </div>
            )}
          </div>

          {/* Real-time Latency & Ping */}
          <div className="hidden sm:flex items-center gap-1.5 text-slate-400 font-mono text-[11px]">
            <span className="h-1.5 w-1.5 rounded-full bg-brand animate-pulse" />
            <span className="text-brand font-bold">12ms</span>
          </div>
        </div>
      </div>

      {/* MAIN WORKSPACE BODY (Flex Row) */}
      <div className="flex-1 flex overflow-hidden relative">

        {/* 1. SLIM LEFT TOOL STRIP (Matching Exness image 1, 2, 3, 4) */}
        <div className="w-11 bg-ink-900 border-r border-ink-700 flex flex-col items-center py-2 space-y-3 shrink-0 z-20">
          
          {/* Instruments / Watchlist */}
          <button
            onClick={() => {
              if (leftNavTool === 'instruments' && leftSidebarOpen) {
                setLeftSidebarOpen(false);
              } else {
                setLeftNavTool('instruments');
                setLeftSidebarOpen(true);
              }
            }}
            title="Watchlist & Instruments"
            className={`p-2 rounded-lg transition ${
              leftSidebarOpen && leftNavTool === 'instruments'
                ? 'bg-ink-800 text-amber-400 font-bold shadow-inner'
                : 'text-slate-400 hover:text-white hover:bg-ink-800/60'
            }`}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" />
              <line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" />
            </svg>
          </button>

          {/* Economic Calendar */}
          <button
            onClick={() => {
              if (leftNavTool === 'calendar' && leftSidebarOpen) {
                setLeftSidebarOpen(false);
              } else {
                setLeftNavTool('calendar');
                setLeftSidebarOpen(true);
              }
            }}
            title="Economic Calendar"
            className={`p-2 rounded-lg transition ${
              leftSidebarOpen && leftNavTool === 'calendar'
                ? 'bg-ink-800 text-amber-400 font-bold shadow-inner'
                : 'text-slate-400 hover:text-white hover:bg-ink-800/60'
            }`}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
              <line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </button>

          {/* Price Alerts */}
          <button
            onClick={() => {
              if (leftNavTool === 'alerts' && leftSidebarOpen) {
                setLeftSidebarOpen(false);
              } else {
                setLeftNavTool('alerts');
                setLeftSidebarOpen(true);
              }
            }}
            title="Price Alerts"
            className={`p-2 rounded-lg transition ${
              leftSidebarOpen && leftNavTool === 'alerts'
                ? 'bg-ink-800 text-amber-400 font-bold shadow-inner'
                : 'text-slate-400 hover:text-white hover:bg-ink-800/60'
            }`}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
          </button>

          {/* Indie / Script Editor */}
          <button
            onClick={() => {
              if (leftNavTool === 'indie' && leftSidebarOpen) {
                setLeftSidebarOpen(false);
              } else {
                setLeftNavTool('indie');
                setLeftSidebarOpen(true);
              }
            }}
            title="Exness Indie™ Script Editor"
            className={`p-2 rounded-lg transition ${
              leftSidebarOpen && leftNavTool === 'indie'
                ? 'bg-ink-800 text-amber-400 font-bold shadow-inner'
                : 'text-slate-400 hover:text-white hover:bg-ink-800/60'
            }`}
          >
            <span className="font-mono font-bold text-sm">{'{ }'}</span>
          </button>

          {/* Settings */}
          <button
            onClick={() => {
              if (leftNavTool === 'settings' && leftSidebarOpen) {
                setLeftSidebarOpen(false);
              } else {
                setLeftNavTool('settings');
                setLeftSidebarOpen(true);
              }
            }}
            title="Chart & Order Settings"
            className={`p-2 rounded-lg transition ${
              leftSidebarOpen && leftNavTool === 'settings'
                ? 'bg-ink-800 text-amber-400 font-bold shadow-inner'
                : 'text-slate-400 hover:text-white hover:bg-ink-800/60'
            }`}
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>

        {/* 2. DYNAMIC LEFT DRAWER PANEL (Matching Exness Picture 1, 2, 3, 4) */}
        {leftSidebarOpen && (
          <div
            style={{ width: `${leftSidebarWidth}px` }}
            className="bg-ink-900 border-r border-ink-700 flex flex-col shrink-0 z-10 overflow-hidden"
          >
            {/* Header with Title and Close button */}
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-ink-700 bg-ink-900">
              <span className="font-bold text-xs uppercase tracking-wider text-white">
                {leftNavTool === 'instruments' && 'INSTRUMENTS'}
                {leftNavTool === 'calendar' && 'ECONOMIC CALENDAR'}
                {leftNavTool === 'alerts' && 'PRICE ALERTS'}
                {leftNavTool === 'indie' && 'UNTITLED INDIC...'}
                {leftNavTool === 'settings' && 'SETTINGS'}
              </span>
              <div className="flex items-center gap-1.5">
                {leftNavTool === 'indie' && (
                  <button className="text-[11px] font-semibold text-slate-300 hover:text-white px-1.5 py-0.5 rounded bg-ink-800">
                    Share
                  </button>
                )}
                <button
                  onClick={() => setLeftSidebarOpen(false)}
                  className="text-slate-400 hover:text-white p-1 text-sm font-bold"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* TAB CONTENT: 1. Instruments (Image 1) */}
            {leftNavTool === 'instruments' && (
              <div className="flex flex-col flex-1 min-h-0">
                {/* Search input */}
                <div className="p-2 border-b border-ink-700">
                  <div className="relative">
                    <input
                      type="text"
                      value={instrumentSearch}
                      onChange={(e) => setInstrumentSearch(e.target.value)}
                      placeholder="Search"
                      className="w-full h-8 bg-ink-950 border border-ink-700 rounded pl-8 pr-3 text-xs text-white placeholder-slate-500 outline-none focus:border-amber-400"
                    />
                    <svg className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <circle cx="11" cy="11" r="7" strokeWidth={2} /><path d="M20 20l-3.5-3.5" strokeWidth={2} strokeLinecap="round" />
                    </svg>
                  </div>
                  {/* Category dropdown */}
                  <div className="mt-2">
                    <select
                      value={instrumentCategory}
                      onChange={(e) => setInstrumentCategory(e.target.value as any)}
                      className="w-full h-7 bg-ink-950 border border-ink-700 rounded px-2 text-xs text-slate-200 outline-none"
                    >
                      <option value="All">All</option>
                      <option value="Crypto">Crypto</option>
                      <option value="Forex">Forex</option>
                      <option value="Commodities">Commodities</option>
                    </select>
                  </div>
                </div>

                {/* Table Header: Symbol | Signal | Bid */}
                <div className="grid grid-cols-12 px-3 py-1.5 border-b border-ink-700 text-[10px] font-bold text-slate-400 bg-ink-950/50">
                  <span className="col-span-6">Symbol</span>
                  <span className="col-span-3 text-center">Signal</span>
                  <span className="col-span-3 text-right">Bid</span>
                </div>

                {/* Instruments List */}
                <div className="flex-1 overflow-y-auto divide-y divide-ink-800 scrollbar-thin">
                  {filteredInstruments.map((inst) => {
                    const isSelected = activeInstrument.symbol === inst.symbol;
                    const change = inst.change24h ?? 0;
                    const isUp = change >= 0;
                    return (
                      <div
                        key={inst.symbol}
                        onClick={() => {
                          setSelectedInstrument(inst);
                          if (!openTabs.includes(inst.symbol)) {
                            setOpenTabs([...openTabs, inst.symbol]);
                          }
                        }}
                        className={`grid grid-cols-12 px-3 py-2 items-center cursor-pointer transition text-xs ${
                          isSelected ? 'bg-ink-800 text-white font-bold border-l-2 border-amber-400' : 'hover:bg-ink-800/50 text-slate-300'
                        }`}
                      >
                        {/* Symbol Name & icon */}
                        <div className="col-span-6 flex items-center gap-2 truncate">
                          <span className="text-xs">{inst.symbol.includes('BTC') ? '🪙' : inst.symbol.includes('AUD') ? '🇦🇺' : inst.symbol.includes('CAD') ? '🇨🇦' : '📈'}</span>
                          <span className="font-semibold truncate">{inst.symbol}</span>
                        </div>

                        {/* Signal button matching Exness green/red square icon */}
                        <div className="col-span-3 flex justify-center">
                          <span className={`h-5 w-5 rounded flex items-center justify-center font-bold text-xs ${isUp ? 'bg-brand/20 text-brand' : 'bg-rose-600/20 text-rose-400'}`}>
                            {isUp ? '↑' : '↓'}
                          </span>
                        </div>

                        {/* Bid price */}
                        <div className="col-span-3 text-right font-mono text-[11px] font-semibold text-slate-200">
                          {(inst.currentPrice / 100).toFixed(inst.type === 'FOREX' ? 4 : 1)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* TAB CONTENT: 2. Economic Calendar (Exness real-time fundamental events) */}
            {leftNavTool === 'calendar' && (
              <div className="flex flex-col flex-1 min-h-0 p-3 overflow-y-auto space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-ink-700">
                  <span className="text-xs font-bold text-white">Upcoming Events</span>
                  <span className="text-[10px] text-amber-400 font-mono">Live UTC</span>
                </div>
                <div className="space-y-2">
                  {economicEvents.map((ev) => (
                    <div key={ev.id} className="p-2.5 rounded-lg bg-ink-950 border border-ink-800 space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-mono text-slate-400">{ev.time}</span>
                        <span className="font-bold text-white">{ev.currency}</span>
                        <span className={`text-[9px] px-1.5 py-0.5 rounded font-black ${
                          ev.impact === 'HIGH' ? 'bg-rose-500/20 text-rose-400' : 'bg-amber-500/20 text-amber-400'
                        }`}>
                          {ev.impact}
                        </span>
                      </div>
                      <p className="text-xs text-slate-200 font-semibold">{ev.title}</p>
                      <div className="flex justify-between text-[10px] text-slate-400 pt-1 font-mono">
                        <span>F: {ev.forecast}</span>
                        <span>P: {ev.previous}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* TAB CONTENT: 3. Price Alerts (Image 4) */}
            {leftNavTool === 'alerts' && (
              <div className="p-3 flex flex-col flex-1 h-full space-y-3">
                <div className="flex border-b border-ink-700 w-full text-center text-xs pb-1">
                  <span className="flex-1 font-bold text-white border-b-2 border-amber-400 pb-1">Active ({alerts.length})</span>
                  <span className="flex-1 text-slate-400">History</span>
                </div>

                {alerts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center flex-1 text-center space-y-3">
                    <div className="h-14 w-14 rounded-full border border-dashed border-ink-700 flex items-center justify-center text-xl text-slate-500">
                      ⏱
                    </div>
                    <div>
                      <h4 className="font-bold text-white text-xs">No alerts</h4>
                      <p className="text-[11px] text-slate-400 mt-1 max-w-[180px]">
                        Get notified instantly about price movements
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 flex-1 overflow-y-auto">
                    {alerts.map((al) => (
                      <div key={al.id} className="p-2.5 rounded-lg bg-ink-950 border border-ink-800 flex items-center justify-between">
                        <div>
                          <div className="text-xs font-bold text-white">{al.symbol} {al.condition === 'ABOVE' ? '≥' : '≤'} ${al.targetPrice}</div>
                          <div className="text-[10px] text-slate-400">{al.createdAt}</div>
                        </div>
                        <button
                          onClick={() => setAlerts((prev) => prev.filter((a) => a.id !== al.id))}
                          className="text-slate-500 hover:text-rose-400 text-xs px-1"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Create Alert Form Button / Modal */}
                {showAlertModal ? (
                  <div className="p-2.5 bg-ink-950 border border-ink-700 rounded-lg space-y-2">
                    <div className="flex justify-between items-center text-xs font-bold text-white">
                      <span>New Alert ({activeInstrument.symbol})</span>
                      <button onClick={() => setShowAlertModal(false)} className="text-slate-400">✕</button>
                    </div>
                    <input
                      type="number"
                      placeholder="Target Price (USD)"
                      value={newAlertPrice}
                      onChange={(e) => setNewAlertPrice(e.target.value)}
                      className="w-full h-8 bg-ink-900 border border-ink-700 rounded px-2 text-xs text-white outline-none"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => setNewAlertCondition('ABOVE')}
                        className={`flex-1 py-1 rounded text-xs font-bold ${newAlertCondition === 'ABOVE' ? 'bg-brand text-ink-950' : 'bg-ink-800 text-slate-400'}`}
                      >
                        Price ≥
                      </button>
                      <button
                        onClick={() => setNewAlertCondition('BELOW')}
                        className={`flex-1 py-1 rounded text-xs font-bold ${newAlertCondition === 'BELOW' ? 'bg-rose-500 text-white' : 'bg-ink-800 text-slate-400'}`}
                      >
                        Price ≤
                      </button>
                    </div>
                    <button
                      onClick={handleCreateAlert}
                      className="w-full py-1.5 bg-amber-400 text-ink-950 font-bold text-xs rounded hover:bg-amber-300 transition"
                    >
                      Save Alert
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowAlertModal(true)}
                    className="w-full rounded bg-ink-800 hover:bg-ink-700 text-white py-2 font-bold text-xs transition border border-ink-700"
                  >
                    + New alert
                  </button>
                )}
              </div>
            )}

            {/* TAB CONTENT: 4. Indie / Pine Script Editor (Image 3) */}
            {leftNavTool === 'indie' && (
              <div className="flex flex-col flex-1 p-2 space-y-2">
                <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
                  <span>Engine: Indie™ v5.0</span>
                  <span className="text-brand font-mono">{indieEditorStatus}</span>
                </div>
                <textarea
                  value={indieCode}
                  onChange={(e) => setIndieCode(e.target.value)}
                  className="flex-1 w-full bg-ink-950 text-emerald-400 font-mono text-[11px] p-3 rounded border border-ink-700 outline-none resize-none leading-relaxed"
                  spellCheck={false}
                />
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => {
                      setIndieEditorStatus('Saved');
                      setTradeToast({ message: 'Script saved to workspace', type: 'success' });
                      setTimeout(() => setTradeToast(null), 2500);
                    }}
                    className="flex-1 bg-ink-800 hover:bg-ink-700 text-white font-bold py-2 rounded text-xs transition border border-ink-700"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      setIndieEditorStatus('Applied to Chart');
                      setTradeToast({ message: 'Indicator added to active chart', type: 'success' });
                      setTimeout(() => setTradeToast(null), 2500);
                    }}
                    className="flex-1 bg-amber-400 hover:bg-amber-300 text-ink-950 font-bold py-2 rounded text-xs transition"
                  >
                    Add to chart
                  </button>
                </div>
              </div>
            )}

            {/* TAB CONTENT: 5. Chart & Order Settings (Image 2) */}
            {leftNavTool === 'settings' && (
              <div className="p-3 flex flex-col flex-1 space-y-4 overflow-y-auto">
                <span className="text-xs font-bold text-white uppercase tracking-wider">Show on chart</span>
                
                <div className="space-y-3 text-xs">
                  {[
                    { label: 'Signals', val: settingsShowSignals, toggle: () => setSettingsShowSignals(!settingsShowSignals) },
                    { label: 'HMR periods', val: settingsHmr, toggle: () => setSettingsHmr(!settingsHmr) },
                    { label: 'Price alerts', val: settingsPriceAlerts, toggle: () => setSettingsPriceAlerts(!settingsPriceAlerts) },
                    { label: 'Open positions', val: settingsOpenPositions, toggle: () => setSettingsOpenPositions(!settingsOpenPositions) },
                    { label: 'TP / SL / Stop / Limit', val: settingsTpSl, toggle: () => setSettingsTpSl(!settingsTpSl) },
                  ].map((s) => (
                    <div key={s.label} className="flex items-center justify-between text-slate-200">
                      <span>{s.label}</span>
                      <button
                        onClick={s.toggle}
                        className={`w-9 h-5 rounded-full p-0.5 transition-colors ${s.val ? 'bg-amber-400' : 'bg-ink-800 border border-ink-700'}`}
                      >
                        <div className={`w-4 h-4 rounded-full bg-white transition-transform ${s.val ? 'translate-x-4' : 'translate-x-0'}`} />
                      </button>
                    </div>
                  ))}
                </div>

                <div className="pt-2 border-t border-ink-700 space-y-1.5">
                  <span className="text-xs text-slate-300 font-semibold">Order and position alignment</span>
                  <select
                    value={settingsOrderAlignment}
                    onChange={(e) => setSettingsOrderAlignment(e.target.value as any)}
                    className="w-full h-8 bg-ink-950 border border-ink-700 rounded px-2 text-xs text-white outline-none"
                  >
                    <option value="Right">Right</option>
                    <option value="Left">Left</option>
                  </select>
                </div>

                <div className="pt-2 border-t border-ink-700 space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-200">
                    <span>Economic calendar</span>
                    <button
                      onClick={() => setSettingsEconCalendar(!settingsEconCalendar)}
                      className={`w-9 h-5 rounded-full p-0.5 transition-colors ${settingsEconCalendar ? 'bg-amber-400' : 'bg-ink-800 border border-ink-700'}`}
                    >
                      <div className={`w-4 h-4 rounded-full bg-white transition-transform ${settingsEconCalendar ? 'translate-x-4' : 'translate-x-0'}`} />
                    </button>
                  </div>
                  <div className="pl-2 space-y-1.5 text-[11px] text-slate-400">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={settingsHighImpact} onChange={(e) => setSettingsHighImpact(e.target.checked)} />
                      <span>High impact</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={settingsMiddleImpact} onChange={(e) => setSettingsMiddleImpact(e.target.checked)} />
                      <span>Middle impact</span>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Left Resize Splitter Handle */}
        {leftSidebarOpen && (
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              setIsResizingLeft(true);
            }}
            className={`w-1 hover:w-1.5 cursor-col-resize bg-ink-800 hover:bg-brand/60 active:bg-brand transition-all shrink-0 z-20 ${
              isResizingLeft ? 'bg-brand w-1.5' : ''
            }`}
            title="Drag to resize panel"
          />
        )}

        {/* 3. CENTER: CHART + BOTTOM POSITIONS DOCK */}
        <div className="flex-1 flex flex-col min-w-0 bg-ink-950 overflow-hidden">
          
          {/* Chart Workspace (Single, Dual, or 4-Chart Grid) */}
          <div className="flex-1 min-h-0 relative">
            {multiChartCount === 1 && (
              <ChartTerminal
                symbol={activeInstrument.symbol}
                instrumentName={activeInstrument.name}
                currentPrice={activeInstrument.currentPrice}
                candles={candles}
                timeframe={timeframe}
                onTimeframeChange={(tf) => setTimeframe(tf)}
                onTickPrice={(price) => {
                  setSelectedInstrument((prev) => (prev ? { ...prev, currentPrice: price } : null));
                }}
                showSignals={settingsShowSignals}
                showPositionsOnChart={settingsOpenPositions}
                showTpSlOnChart={settingsTpSl}
              />
            )}

            {multiChartCount === 2 && (
              <div className="w-full h-full grid grid-cols-2 gap-1 bg-ink-900">
                <ChartTerminal
                  symbol={activeInstrument.symbol}
                  instrumentName={activeInstrument.name}
                  currentPrice={activeInstrument.currentPrice}
                  candles={candles}
                  timeframe={timeframe}
                  onTimeframeChange={(tf) => setTimeframe(tf)}
                  showSignals={settingsShowSignals}
                />
                <ChartTerminal
                  symbol={openTabs[1] || 'XAUUSD'}
                  instrumentName={openTabs[1] || 'Gold / US Dollar'}
                  currentPrice={274000}
                  candles={candles}
                  timeframe="5m"
                  onTimeframeChange={() => {}}
                  showSignals={settingsShowSignals}
                />
              </div>
            )}

            {multiChartCount === 4 && (
              <div className="w-full h-full grid grid-cols-2 grid-rows-2 gap-1 bg-ink-900">
                <ChartTerminal
                  symbol={activeInstrument.symbol}
                  instrumentName={activeInstrument.name}
                  currentPrice={activeInstrument.currentPrice}
                  candles={candles}
                  timeframe={timeframe}
                  onTimeframeChange={(tf) => setTimeframe(tf)}
                  showSignals={settingsShowSignals}
                />
                <ChartTerminal
                  symbol={openTabs[1] || 'XAUUSD'}
                  instrumentName={openTabs[1] || 'Gold / US Dollar'}
                  currentPrice={274000}
                  candles={candles}
                  timeframe="5m"
                  onTimeframeChange={() => {}}
                />
                <ChartTerminal
                  symbol={openTabs[2] || 'EURUSD'}
                  instrumentName={openTabs[2] || 'EUR/USD'}
                  currentPrice={108420}
                  candles={candles}
                  timeframe="15m"
                  onTimeframeChange={() => {}}
                />
                <ChartTerminal
                  symbol="AUDUSD"
                  instrumentName="AUD/USD"
                  currentPrice={68488}
                  candles={candles}
                  timeframe="1h"
                  onTimeframeChange={() => {}}
                />
              </div>
            )}
          </div>

          {/* Bottom Dock Vertical Resize Handle */}
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              setIsResizingBottom(true);
            }}
            className={`h-1 hover:h-1.5 cursor-row-resize bg-ink-800 hover:bg-brand/60 active:bg-brand transition-all shrink-0 z-20 ${
              isResizingBottom ? 'bg-brand h-1.5' : ''
            }`}
            title="Drag to resize positions panel"
          />

          {/* Bottom Dock: Open | Pending | Closed positions (matching Exness image 1) */}
          <div
            style={{ height: `${bottomDockHeight}px` }}
            className="border-t border-ink-700 bg-ink-900 flex flex-col shrink-0 overflow-hidden"
          >
            {/* Tab header with Mass Actions */}
            <div className="flex items-center justify-between px-3 h-8 border-b border-ink-700 bg-ink-900">
              <div className="flex items-center gap-6 h-full text-xs font-bold">
                {(['open', 'pending', 'closed'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setBottomTab(tab)}
                    className={`h-full capitalize transition ${
                      bottomTab === tab ? 'text-amber-400 border-b-2 border-amber-400' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {tab} {tab === 'open' && `(${openOrders.length})`}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3 text-slate-400 text-xs">
                {openOrders.length > 0 && bottomTab === 'open' && (
                  <button
                    onClick={handleCloseAllPositions}
                    className="text-[11px] text-rose-400 hover:text-rose-300 font-bold transition px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/20"
                  >
                    Close All Positions
                  </button>
                )}
                <button className="hover:text-white">⋮</button>
                <button className="hover:text-white">✕</button>
              </div>
            </div>

            {/* Positions Table Content */}
            <div className="flex-1 flex flex-col items-center justify-center p-2 text-center overflow-hidden">
              {openOrders.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 text-slate-400 text-xs">
                  <div className="h-8 w-8 rounded bg-ink-800 flex items-center justify-center text-slate-300">
                    💼
                  </div>
                  <span className="font-semibold text-slate-300">No open positions</span>
                </div>
              ) : (
                <div className="w-full h-full overflow-y-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="text-slate-400 border-b border-ink-700 pb-1 text-[11px]">
                        <th>Symbol</th>
                        <th>Type</th>
                        <th>Lots</th>
                        <th>Open Price</th>
                        <th>SL</th>
                        <th>TP</th>
                        <th>Current Price</th>
                        <th>Profit (USD)</th>
                        <th className="text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {openOrders.map((ord) => {
                        const isOrdFx = (ord.instrumentId || activeInstrument.symbol).includes('/') || activeInstrument.type === 'FOREX';
                        const div = isOrdFx ? 100000 : 100;
                        const openPriceVal = (ord.priceFilled ?? (ord as any).price ?? 0) / div;
                        const curPriceVal = rawPrice;
                        const isBuy = ord.side === 'BUY';
                        const diff = isBuy ? (curPriceVal - openPriceVal) : (openPriceVal - curPriceVal);
                        const profitVal = diff * (ord.quantity || 1) * (isOrdFx ? 1000 : 1);
                        const isProf = profitVal >= 0;

                        return (
                          <tr key={ord.id} className="border-b border-ink-800 hover:bg-ink-800/40">
                            <td className="font-bold text-white py-1.5">{ord.instrumentId || activeInstrument.symbol}</td>
                            <td className={isBuy ? 'text-blue-400 font-bold' : 'text-rose-400 font-bold'}>{ord.side}</td>
                            <td>{ord.quantity}</td>
                            <td className="font-mono">{formatNum(openPriceVal)}</td>
                            <td className="text-slate-400">{slEnabled && slPrice ? slPrice : '-'}</td>
                            <td className="text-slate-400">{tpEnabled && tpPrice ? tpPrice : '-'}</td>
                            <td className="font-mono text-white">{formatNum(curPriceVal)}</td>
                            <td className={`font-mono font-bold ${isProf ? 'text-emerald-400' : 'text-rose-400'}`}>
                              {isProf ? '+' : ''}${profitVal.toFixed(2)}
                            </td>
                            <td className="text-right">
                              <button
                                onClick={() => handleCloseOrder(ord.id)}
                                className="px-2 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500 text-rose-300 hover:text-white font-bold text-[10px] transition"
                              >
                                Close
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Account Footer Bar (matching Exness image 1: Equity, Free Margin, Balance, Margin Level) */}
          <div className="h-7 border-t border-ink-700 bg-ink-950 px-3 flex items-center justify-between text-[11px] font-mono text-slate-400 shrink-0">
            <div className="flex items-center gap-4">
              <span>Equity: <strong className="text-white">0.00 USC</strong></span>
              <span>Free Margin: <strong className="text-white">0.00 USC</strong></span>
              <span>Balance: <strong className="text-white">{((portfolio?.account?.virtualBalance ?? 1000000) / 100).toFixed(2)} USD</strong></span>
              <span>Margin: <strong className="text-white">0.00 USC</strong></span>
              <span>Margin level: <strong className="text-white">-</strong></span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-brand font-bold">📶 6.13.0 [TE 1.4.0]</span>
            </div>
          </div>

        </div>

        {/* Right Execution Panel Resize Splitter Handle */}
        {rightPanelOpen && (
          <div
            onMouseDown={(e) => {
              e.preventDefault();
              setIsResizingRight(true);
            }}
            className={`w-1 hover:w-1.5 cursor-col-resize bg-ink-800 hover:bg-brand/60 active:bg-brand transition-all shrink-0 z-20 ${
              isResizingRight ? 'bg-brand w-1.5' : ''
            }`}
            title="Drag to resize order panel"
          />
        )}

        {/* 4. RIGHT SIDEBAR: EXNESS-STYLE ORDER EXECUTION PANEL (Matches Image 1, 2, 3, 4) */}
        {rightPanelOpen && (
          <div
            style={{ width: `${rightPanelWidth}px` }}
            className="bg-ink-900 border-l border-ink-700 flex flex-col p-3 space-y-3 shrink-0 overflow-y-auto"
          >
            {/* Header with symbol and close button */}
            <div className="flex items-center justify-between border-b border-ink-700 pb-2">
              <div className="flex items-center gap-2 font-bold text-white text-sm">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-[10px] text-ink-950 font-bold">
                  {isCrypto ? '₿' : isCommodity ? '🪙' : isForex ? '💱' : '📈'}
                </span>
                <span>{activeInstrument.symbol.replace('USD', '')}</span>
              </div>
              <button
                onClick={() => setRightPanelOpen(false)}
                className="text-slate-400 hover:text-white"
                title="Hide order panel"
              >
                ✕
              </button>
            </div>

            {/* Form selector dropdown: Regular form / Pending form */}
            <div>
              <select
                value={orderFormType}
                onChange={(e) => {
                  const val = e.target.value as any;
                  setOrderFormType(val);
                  if (val === 'Pending form') setOrderTab('Pending');
                  else setOrderTab('Market');
                }}
                className="w-full h-8 bg-ink-950 border border-ink-700 rounded px-2.5 text-xs text-white font-semibold outline-none"
              >
                <option value="Regular form">Regular form</option>
                <option value="Pending form">Pending form</option>
              </select>
            </div>

            {/* TWO BIG EXNESS SELL & BUY BOXES WITH SPREAD PILL */}
            <div className="grid grid-cols-2 gap-2 relative pt-1">
              {/* Sell Box (Red) */}
              <button
                onClick={() => handleOrder('SELL')}
                disabled={orderSubmitting}
                className="rounded-lg border border-rose-500/50 bg-[#2a171f] hover:bg-rose-950 p-2 text-left transition active:scale-95 flex flex-col justify-between h-16 group shadow-md"
              >
                <span className="text-[11px] text-rose-400 font-bold">Sell</span>
                <span className="font-mono font-black text-rose-300 text-xs sm:text-sm group-hover:text-white">
                  {formatNum(sellPriceNumber)}
                </span>
              </button>

              {/* Buy Box (Blue) */}
              <button
                onClick={() => handleOrder('BUY')}
                disabled={orderSubmitting}
                className="rounded-lg border border-blue-500/50 bg-[#122238] hover:bg-blue-950 p-2 text-left transition active:scale-95 flex flex-col justify-between h-16 group shadow-md"
              >
                <span className="text-[11px] text-blue-400 font-bold">Buy</span>
                <span className="font-mono font-black text-blue-300 text-xs sm:text-sm group-hover:text-white">
                  {formatNum(buyPriceNumber)}
                </span>
              </button>

              {/* Centered spread badge matching Exness */}
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-ink-950 border border-ink-700 rounded px-1.5 py-0.5 text-[9px] font-mono text-slate-300 shadow whitespace-nowrap">
                {(spreadDelta * 2).toFixed(isForex ? 5 : 2)} {isForex ? 'pips' : 'USD'}
              </div>
            </div>

          {/* Market Sentiment Bar: 54% Sell (Red) | 46% Buy (Blue) */}
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] font-mono text-slate-400 font-bold">
              <span className="text-rose-400">54%</span>
              <span className="text-blue-400">46%</span>
            </div>
            <div className="h-1.5 w-full bg-slate-700 rounded-full flex overflow-hidden">
              <div className="h-full bg-rose-500 w-[54%]" />
              <div className="h-full bg-blue-500 w-[46%]" />
            </div>
          </div>

          {/* Mode Tabs: Market | Pending */}
          <div className="grid grid-cols-2 bg-ink-950 p-0.5 rounded border border-ink-700 text-xs font-bold text-center">
            <button
              onClick={() => {
                setOrderTab('Market');
                setOrderFormType('Regular form');
              }}
              className={`py-1.5 rounded transition ${orderTab === 'Market' ? 'bg-ink-800 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              Market
            </button>
            <button
              onClick={() => {
                setOrderTab('Pending');
                setOrderFormType('Pending form');
              }}
              className={`py-1.5 rounded transition ${orderTab === 'Pending' ? 'bg-ink-800 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              Pending
            </button>
          </div>

          {/* If Pending mode: Exness Pending order type selector & price input */}
          {orderTab === 'Pending' && (
            <div className="space-y-2 p-2 bg-ink-950 rounded border border-ink-700">
              <div className="flex justify-between text-[11px] font-semibold text-slate-300">
                <span>Order Type</span>
              </div>
              <select
                value={pendingOrderType}
                onChange={(e) => setPendingOrderType(e.target.value as any)}
                className="w-full h-8 bg-ink-900 border border-ink-700 rounded px-2 text-xs text-white outline-none"
              >
                <option value="Buy Limit">Buy Limit</option>
                <option value="Sell Limit">Sell Limit</option>
                <option value="Buy Stop">Buy Stop</option>
                <option value="Sell Stop">Sell Stop</option>
              </select>

              <div className="space-y-1 pt-1">
                <span className="text-[11px] font-semibold text-slate-400">Trigger Price</span>
                <input
                  type="number"
                  placeholder={(rawPrice).toFixed(2)}
                  value={pendingPrice}
                  onChange={(e) => setPendingPrice(e.target.value)}
                  className="w-full h-8 bg-ink-900 border border-ink-700 rounded px-2 text-xs text-white font-mono outline-none"
                />
              </div>
            </div>
          )}

          {/* Volume Lot input with - and + step buttons */}
          <div className="space-y-1">
            <div className="flex justify-between text-[11px] font-semibold text-slate-400">
              <span>Volume</span>
            </div>
            <div className="flex items-center bg-ink-950 border border-ink-700 rounded overflow-hidden h-9">
              <input
                type="text"
                value={volumeLots}
                onChange={(e) => setVolumeLots(e.target.value)}
                className="w-full bg-transparent px-3 text-xs text-white font-mono font-bold outline-none"
              />
              <span className="text-[11px] text-slate-400 px-2 font-semibold">Lots</span>
              <button
                onClick={() => setVolumeLots((prev) => Math.max(0.01, +(parseFloat(prev) - 0.1).toFixed(2)).toString())}
                className="w-7 h-full flex items-center justify-center border-l border-ink-700 hover:bg-ink-800 text-slate-300 font-bold"
              >
                -
              </button>
              <button
                onClick={() => setVolumeLots((prev) => (parseFloat(prev) + 0.1).toFixed(2).toString())}
                className="w-7 h-full flex items-center justify-center border-l border-ink-700 hover:bg-ink-800 text-slate-300 font-bold"
              >
                +
              </button>
            </div>
          </div>

          {/* Take Profit section (Exness Price / Pips / Money Units) */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={tpEnabled}
                  onChange={(e) => setTpEnabled(e.target.checked)}
                  className="rounded"
                />
                <span>Take Profit</span>
              </label>
              <span className="text-[10px] text-slate-500">?</span>
            </div>
            <div className={`flex items-center bg-ink-950 border border-ink-700 rounded overflow-hidden h-9 ${!tpEnabled && 'opacity-60'}`}>
              <input
                type="text"
                disabled={!tpEnabled}
                value={tpPrice}
                onChange={(e) => setTpPrice(e.target.value)}
                placeholder="Not set"
                className="w-full bg-transparent px-3 text-xs text-white font-mono outline-none disabled:cursor-not-allowed"
              />
              <button
                type="button"
                onClick={() => {
                  if (tpUnit === 'Price') setTpUnit('Pips');
                  else if (tpUnit === 'Pips') setTpUnit('Money');
                  else setTpUnit('Price');
                }}
                className="text-[11px] text-slate-300 hover:text-white px-2 border-l border-ink-700"
              >
                {tpUnit} ▾
              </button>
              <button
                disabled={!tpEnabled}
                onClick={() => setTpPrice((prev) => ((parseFloat(prev) || rawPrice) - 1).toFixed(2))}
                className="w-7 h-full flex items-center justify-center border-l border-ink-700 text-slate-300 hover:bg-ink-800"
              >
                -
              </button>
              <button
                disabled={!tpEnabled}
                onClick={() => setTpPrice((prev) => ((parseFloat(prev) || rawPrice) + 1).toFixed(2))}
                className="w-7 h-full flex items-center justify-center border-l border-ink-700 text-slate-300 hover:bg-ink-800"
              >
                +
              </button>
            </div>
          </div>

          {/* Stop Loss section (Exness Price / Pips / Money Units) */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] font-semibold text-slate-400">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={slEnabled}
                  onChange={(e) => setSlEnabled(e.target.checked)}
                  className="rounded"
                />
                <span>Stop Loss</span>
              </label>
              <span className="text-[10px] text-slate-500">?</span>
            </div>
            <div className={`flex items-center bg-ink-950 border border-ink-700 rounded overflow-hidden h-9 ${!slEnabled && 'opacity-60'}`}>
              <input
                type="text"
                disabled={!slEnabled}
                value={slPrice}
                onChange={(e) => setSlPrice(e.target.value)}
                placeholder="Not set"
                className="w-full bg-transparent px-3 text-xs text-white font-mono outline-none disabled:cursor-not-allowed"
              />
              <button
                type="button"
                onClick={() => {
                  if (slUnit === 'Price') setSlUnit('Pips');
                  else if (slUnit === 'Pips') setSlUnit('Money');
                  else setSlUnit('Price');
                }}
                className="text-[11px] text-slate-300 hover:text-white px-2 border-l border-ink-700"
              >
                {slUnit} ▾
              </button>
              <button
                disabled={!slEnabled}
                onClick={() => setSlPrice((prev) => ((parseFloat(prev) || rawPrice) - 1).toFixed(2))}
                className="w-7 h-full flex items-center justify-center border-l border-ink-700 text-slate-300 hover:bg-ink-800"
              >
                -
              </button>
              <button
                disabled={!slEnabled}
                onClick={() => setSlPrice((prev) => ((parseFloat(prev) || rawPrice) + 1).toFixed(2))}
                className="w-7 h-full flex items-center justify-center border-l border-ink-700 text-slate-300 hover:bg-ink-800"
              >
                +
              </button>
            </div>
          </div>

          {/* Quick Execution Buy/Sell Actions */}
          <div className="pt-2 space-y-2">
            <button
              onClick={() => handleOrder('BUY')}
              disabled={orderSubmitting}
              className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 font-bold text-white text-xs transition active:scale-98 shadow-md"
            >
              {orderSubmitting ? 'Placing Order...' : `${orderTab === 'Market' ? 'Buy' : pendingOrderType} ${volumeLots} Lots`}
            </button>
            <button
              onClick={() => handleOrder('SELL')}
              disabled={orderSubmitting}
              className="w-full py-2.5 rounded-lg bg-rose-600 hover:bg-rose-500 font-bold text-white text-xs transition active:scale-98 shadow-md"
            >
              {orderSubmitting ? 'Placing Order...' : `${orderTab === 'Market' ? 'Sell' : pendingOrderType} ${volumeLots} Lots`}
            </button>
          </div>
        </div>
        )}

      </div>
    </div>
  );
}
