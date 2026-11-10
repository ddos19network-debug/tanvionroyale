'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { ChartTerminal } from './chart-terminal';
import { OrderBook } from './order-book';
import { MarketTrades } from './market-trades';
import { BuySellPanel } from './buy-sell-panel';
import { TradingPositionsPanel } from './trading-positions-panel';
import { InstrumentsSidebar } from './instruments-sidebar';
import { BinanceOverview } from './binance-overview';
import { getLiveMarketQuotes } from '@/lib/api/live-rates';
import {
  listTradingInstruments,
  getTradingCandles,
  getTradingOrderBook,
  getTradingRecentTrades,
  getTradingPortfolio,
  listTradingOrders,
  listOpenTradingOrders,
  listTradingHistory,
  claimTradingFaucet,
  formatMinor,
  type TradingInstrumentView,
  type TradingCandle,
  type TradingOrderBook,
  type TradingMarketTrade,
  type TradingPortfolioView,
  type TradingOrderView,
  type TradingTransactionView,
} from '@/lib/api/trading';

export function TradingTerminal() {
  const searchParams = useSearchParams();
  const urlSymbol = searchParams.get('symbol');

  const [instruments, setInstruments] = useState<TradingInstrumentView[]>([]);
  const [selectedInstrument, setSelectedInstrument] = useState<TradingInstrumentView | null>(null);
  
  // Multi-tabs matching Exness Picture 2 (BTC, XAU/USD, USD/JPY, EUR/USD, +)
  const [openTabs, setOpenTabs] = useState<string[]>(['BTCUSD', 'XAUUSD', 'USDJPY', 'EURUSD']);
  
  const [candles, setCandles] = useState<TradingCandle[]>([]);
  const [timeframe, setTimeframe] = useState('1m'); // default to 1m matching picture 2
  const [orderBook, setOrderBook] = useState<TradingOrderBook | null>(null);
  const [recentTrades, setRecentTrades] = useState<TradingMarketTrade[]>([]);
  const [portfolio, setPortfolio] = useState<TradingPortfolioView | null>(null);
  const [orders, setOrders] = useState<TradingOrderView[]>([]);
  const [openOrders, setOpenOrders] = useState<TradingOrderView[]>([]);
  const [history, setHistory] = useState<TradingTransactionView[]>([]);
  const [selectedBookPrice, setSelectedBookPrice] = useState<number | null>(null);
  const [activeRightTab, setActiveRightTab] = useState<'orderbook' | 'trades'>('orderbook');
  
  // Collapsible Binance banner from Picture 1
  const [showBinanceHero, setShowBinanceHero] = useState<boolean>(true);
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const terminalRef = useRef<HTMLDivElement>(null);

  // Load public instruments first, then gracefully load private account data
  const loadInitialData = useCallback(async () => {
    try {
      const instList = await listTradingInstruments();
      setInstruments(instList);

      if (instList.length > 0) {
        let matched = instList[0];
        if (urlSymbol) {
          const found = instList.find(
            (i) => i.symbol.toLowerCase() === urlSymbol.toLowerCase(),
          );
          if (found) matched = found;
        }
        setSelectedInstrument(matched);
      }
    } catch {
      setError('Could not connect to market catalog.');
    }

    // Load user private data gracefully (non-blocking for guest visitors)
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
      setPortfolio(null);
    }
  }, [urlSymbol]);

  useEffect(() => {
    void loadInitialData();
  }, [loadInitialData]);

  // Real-time live quotes sync from free public feeds (Binance + Frankfurter)
  useEffect(() => {
    let mounted = true;

    async function syncLiveQuotes() {
      try {
        const live = await getLiveMarketQuotes();
        if (!mounted || Object.keys(live).length === 0) return;

        setInstruments((prev) =>
          prev.map((inst) => {
            const quote = live[inst.symbol];
            if (!quote) return inst;
            return {
              ...inst,
              currentPrice: quote.currentPrice,
              change24h: quote.change24h,
              high24h: quote.high24h,
              low24h: quote.low24h,
              volume24h: quote.volume24h,
              dataSource: 'LIVE',
            };
          }),
        );

        setSelectedInstrument((prev) => {
          if (!prev) return prev;
          const quote = live[prev.symbol];
          if (!quote) return prev;
          return {
            ...prev,
            currentPrice: quote.currentPrice,
            change24h: quote.change24h,
            high24h: quote.high24h,
            low24h: quote.low24h,
            volume24h: quote.volume24h,
            dataSource: 'LIVE',
          };
        });
      } catch {
        // Silently continue
      }
    }

    void syncLiveQuotes();
    const interval = setInterval(() => {
      void syncLiveQuotes();
    }, 4500);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  // Load market data for the selected instrument
  const loadMarketData = useCallback(
    async (inst: TradingInstrumentView, tf = timeframe) => {
      try {
        const [cList, ob, trs] = await Promise.all([
          getTradingCandles(inst.id, tf, 80),
          getTradingOrderBook(inst.id),
          getTradingRecentTrades(inst.id, 25),
        ]);
        setCandles(cList);
        setOrderBook(ob);
        setRecentTrades(trs);
      } catch {
        // Silently retry or handle
      }
    },
    [timeframe],
  );

  useEffect(() => {
    if (selectedInstrument) {
      void loadMarketData(selectedInstrument, timeframe);
    }
  }, [selectedInstrument, timeframe, loadMarketData]);

  // Refresh user account data after orders or closes
  const refreshUserData = useCallback(async () => {
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
      // Ignore
    }
  }, []);

  function handleSelectInstrument(inst: TradingInstrumentView) {
    setSelectedInstrument(inst);
    if (!openTabs.includes(inst.symbol)) {
      setOpenTabs((prev) => [...prev, inst.symbol]);
    }
  }

  function handleCloseTab(symbolToClose: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (openTabs.length <= 1) return;
    const nextTabs = openTabs.filter((s) => s !== symbolToClose);
    setOpenTabs(nextTabs);
    if (selectedInstrument?.symbol === symbolToClose) {
      const nextActiveSymbol = nextTabs[0];
      const nextInst = instruments.find((i) => i.symbol === nextActiveSymbol);
      if (nextInst) setSelectedInstrument(nextInst);
    }
  }

  function handleAddTab() {
    // Pick the first instrument not already in openTabs
    const candidate = instruments.find((i) => !openTabs.includes(i.symbol));
    if (candidate) {
      setOpenTabs((prev) => [...prev, candidate.symbol]);
      setSelectedInstrument(candidate);
    }
  }

  function scrollToTerminal() {
    terminalRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  if (error && instruments.length === 0) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-6 text-center text-rose-300">
        {error}
      </div>
    );
  }

  if (!selectedInstrument) {
    return (
      <div className="flex h-96 items-center justify-center text-slate-400 font-mono text-sm">
        Initializing Tanvion Exchange Terminal...
      </div>
    );
  }

  const balanceMinor = portfolio?.account?.virtualBalance ?? 1_000_000;
  const unrealizedPnl = portfolio?.unrealizedPnl ?? 0;

  return (
    <div className="flex flex-col gap-4 w-full">
      {/* 1. BINANCE OVERVIEW & HERO SECTION (FROM PICTURE 1) */}
      <div className="transition-all">
        <div className="flex items-center justify-between pb-1">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-400">
            <span>Exchange Hub View</span>
          </div>
          <button
            type="button"
            onClick={() => setShowBinanceHero(!showBinanceHero)}
            className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-semibold text-slate-300 hover:text-white hover:bg-white/10 transition"
          >
            <span>{showBinanceHero ? 'Hide Banner' : 'Show Binance Banner'}</span>
            <span>{showBinanceHero ? '▲' : '▼'}</span>
          </button>
        </div>

        {showBinanceHero && (
          <BinanceOverview
            instruments={instruments}
            balanceMinor={balanceMinor}
            todayPnlMinor={unrealizedPnl}
            onSelectInstrument={handleSelectInstrument}
            onTradeNowClick={scrollToTerminal}
          />
        )}
      </div>

      {/* 2. EXNESS WEBTRADING TERMINAL HEADER & MULTI-TABS (FROM PICTURE 2) */}
      <div ref={terminalRef} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 bg-[#0e121b] px-3 py-1.5 rounded-t-xl">
          {/* Exness Multi-Asset Open Tabs Strip */}
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-none py-1">
            {openTabs.map((tabSymbol) => {
              const inst = instruments.find((i) => i.symbol === tabSymbol);
              const isActive = selectedInstrument.symbol === tabSymbol;
              return (
                <div
                  key={tabSymbol}
                  onClick={() => inst && setSelectedInstrument(inst)}
                  className={`group flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-bold cursor-pointer transition select-none ${
                    isActive
                      ? 'border border-amber-400/40 bg-[#1a2233] text-amber-300 shadow-md'
                      : 'border border-white/5 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10'
                  }`}
                >
                  <span className="text-amber-400">⚡</span>
                  <span>{tabSymbol}</span>
                  <span className="text-[10px] text-slate-500 font-mono">III</span>
                  {openTabs.length > 1 && (
                    <button
                      type="button"
                      onClick={(e) => handleCloseTab(tabSymbol, e)}
                      className="ml-1 text-slate-500 hover:text-rose-400 transition"
                      title="Close tab"
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}

            {/* Plus Tab to Add Instrument */}
            <button
              type="button"
              onClick={handleAddTab}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition font-bold text-sm"
              title="Add New Instrument Tab"
            >
              +
            </button>
          </div>

          {/* Account Status Pill & Action Buttons (matching Exness #159593044 | 0.00 USC) */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 rounded-lg border border-white/10 bg-[#121620] px-3 py-1 text-xs font-mono">
              <span className="text-slate-400">#159593044</span>
              <span className="text-slate-600">|</span>
              <span className="font-bold text-white">
                {formatMinor(balanceMinor, portfolio?.account?.currency ?? 'USD')}
              </span>
            </div>

            <button
              type="button"
              onClick={() => void claimTradingFaucet(1_000_000).then(() => refreshUserData())}
              className="flex items-center gap-1 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-1 text-xs font-bold text-amber-300 hover:bg-amber-400/20 transition"
            >
              <span>Deposit</span>
            </button>
          </div>
        </div>

        {/* 3. EXNESS THREE-COLUMN WORKSPACE: LEFT INSTRUMENTS, CENTER CHART & POSITIONS, RIGHT ORDER PANEL */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 items-start">
          {/* Left Column: Instruments List Sidebar (3 cols or collapsed) */}
          <div
            className={`transition-all duration-300 ${
              sidebarCollapsed ? 'lg:col-span-1' : 'lg:col-span-3'
            } h-[760px]`}
          >
            <InstrumentsSidebar
              instruments={instruments}
              selectedInstrument={selectedInstrument}
              onSelect={handleSelectInstrument}
              isCollapsed={sidebarCollapsed}
              onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
            />
          </div>

          {/* Center Column: Chart Terminal + Bottom Positions Panel (6 or 7 cols) */}
          <div
            className={`flex flex-col gap-3 ${
              sidebarCollapsed ? 'lg:col-span-8' : 'lg:col-span-6'
            }`}
          >
            {/* Candlestick & Volume Chart with Exness Controls & Drawing Toolbar */}
            <div className="h-[460px] w-full">
              <ChartTerminal
                symbol={selectedInstrument.symbol}
                instrumentName={selectedInstrument.name}
                currentPrice={selectedInstrument.currentPrice}
                candles={candles}
                timeframe={timeframe}
                onTimeframeChange={(tf) => setTimeframe(tf)}
                onTickPrice={(price) => {
                  setSelectedInstrument((prev) =>
                    prev ? { ...prev, currentPrice: price } : null,
                  );
                }}
              />
            </div>

            {/* Exness Positions Panel with Open / Pending / Closed & Margin Status Bar */}
            <TradingPositionsPanel
              portfolio={portfolio}
              orders={orders}
              openOrders={openOrders}
              history={history}
              onRefresh={() => void refreshUserData()}
            />
          </div>

          {/* Right Column: Exness Dual Sell/Buy Panel & Order Book (3 cols) */}
          <div className="lg:col-span-3 flex flex-col gap-3">
            {/* Exness Buy/Sell Order Panel */}
            <BuySellPanel
              instrument={selectedInstrument}
              currency={portfolio?.account?.currency ?? 'USD'}
              virtualBalance={balanceMinor}
              selectedPrice={selectedBookPrice}
              isLoggedIn={portfolio !== null}
              onOrderPlaced={() => void refreshUserData()}
              onBalanceUpdated={() => void refreshUserData()}
            />

            {/* Order Book / Market Trades Tabs */}
            <div className="h-[280px] w-full flex flex-col rounded-xl border border-white/10 bg-[#121620] overflow-hidden">
              <div className="flex border-b border-white/10 bg-[#0e121b] text-xs font-bold">
                <button
                  type="button"
                  onClick={() => setActiveRightTab('orderbook')}
                  className={`flex-1 py-2 text-center transition ${
                    activeRightTab === 'orderbook'
                      ? 'border-b-2 border-amber-400 text-amber-300 font-extrabold bg-white/5'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Order Book
                </button>
                <button
                  type="button"
                  onClick={() => setActiveRightTab('trades')}
                  className={`flex-1 py-2 text-center transition ${
                    activeRightTab === 'trades'
                      ? 'border-b-2 border-amber-400 text-amber-300 font-extrabold bg-white/5'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Market Trades
                </button>
              </div>

              <div className="flex-1 p-1 overflow-hidden">
                {activeRightTab === 'orderbook' ? (
                  <OrderBook
                    orderBook={orderBook}
                    symbol={selectedInstrument.symbol}
                    onSelectPrice={(p) => setSelectedBookPrice(p)}
                  />
                ) : (
                  <MarketTrades
                    trades={recentTrades}
                    symbol={selectedInstrument.symbol}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
