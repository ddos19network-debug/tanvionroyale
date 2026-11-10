'use client';

import { useState } from 'react';
import type {
  TradingPositionView,
  TradingOrderView,
  TradingTransactionView,
  TradingPortfolioView,
} from '@/lib/api/trading';
import {
  formatMinor,
  formatPrice,
  closeTradingPosition,
  cancelTradingOrder,
} from '@/lib/api/trading';

interface PositionsPanelProps {
  portfolio: TradingPortfolioView | null;
  orders: TradingOrderView[];
  openOrders: TradingOrderView[];
  history: TradingTransactionView[];
  onRefresh: () => void;
}

export function TradingPositionsPanel({
  portfolio,
  orders,
  openOrders,
  history,
  onRefresh,
}: PositionsPanelProps) {
  const [activeTab, setActiveTab] = useState<'open' | 'pending' | 'closed'>('open');
  const [closingId, setClosingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const positions = portfolio?.positions ?? [];
  const openPositions = positions.filter((p) => p.status === 'OPEN');
  const closedPositions = positions.filter((p) => p.status === 'CLOSED');
  const currency = portfolio?.account?.currency ?? 'USD';

  // Exness Margin Calculations
  const balance = portfolio?.account?.virtualBalance ?? 1_000_000;
  const unrealizedPnl = portfolio?.unrealizedPnl ?? 0;
  const equity = balance + unrealizedPnl;
  
  // Compute used margin from open positions (assume 10x average leverage)
  const usedMargin = openPositions.reduce((acc, pos) => {
    const notional = pos.quantity * pos.currentPrice;
    const lev = pos.leverage ?? 10;
    return acc + Math.round(notional / lev);
  }, 0);

  const freeMargin = Math.max(0, equity - usedMargin);
  const marginLevel = usedMargin > 0 ? ((equity / usedMargin) * 100).toFixed(2) + '%' : '—';

  async function handleClosePosition(positionId: string) {
    setClosingId(positionId);
    setActionMessage(null);
    try {
      const res = await closeTradingPosition(positionId);
      const pnl = res.closedPosition?.realizedPnl ?? 0;
      setActionMessage(`Position closed. Realized P&L: ${formatMinor(pnl, currency)}.`);
      onRefresh();
    } catch {
      setActionMessage('Failed to close position.');
    } finally {
      setClosingId(null);
    }
  }

  async function handleCancelOrder(orderId: string) {
    setCancellingId(orderId);
    setActionMessage(null);
    try {
      await cancelTradingOrder(orderId);
      setActionMessage('Order cancelled. Funds released.');
      onRefresh();
    } catch {
      setActionMessage('Failed to cancel order.');
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <div className="flex flex-col rounded-xl border border-white/10 bg-[#121620] overflow-hidden text-xs shadow-2xl">
      {/* Top Tabs: Open | Pending | Closed */}
      <div className="flex items-center justify-between border-b border-white/10 bg-[#0e121b] px-4 py-2">
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('open')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold transition ${
              activeTab === 'open'
                ? 'bg-amber-400 text-black font-extrabold shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <span>Open</span>
            {openPositions.length > 0 && (
              <span className="rounded-full bg-black/40 px-1.5 py-0.2 text-[10px] text-amber-200">
                {openPositions.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('pending')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold transition ${
              activeTab === 'pending'
                ? 'bg-amber-400 text-black font-extrabold shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <span>Pending</span>
            {openOrders.length > 0 && (
              <span className="rounded-full bg-black/40 px-1.5 py-0.2 text-[10px] text-amber-200">
                {openOrders.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('closed')}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-bold transition ${
              activeTab === 'closed'
                ? 'bg-amber-400 text-black font-extrabold shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            <span>Closed</span>
          </button>
        </div>

        {actionMessage && (
          <div className="text-[11px] font-semibold text-emerald-400 animate-fade-in">
            {actionMessage}
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="min-h-[160px] max-h-[220px] overflow-y-auto">
        {/* Open Positions Tab */}
        {activeTab === 'open' && (
          <>
            {openPositions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/5 text-2xl text-slate-400 mb-2">
                  💼
                </div>
                <p className="font-semibold text-slate-400">No open positions</p>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Execute Buy or Sell orders to open a trade.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono">
                  <thead className="bg-[#0e121b] text-slate-400 text-[11px] sticky top-0">
                    <tr>
                      <th className="py-2 px-3">Symbol</th>
                      <th className="py-2 px-3">Side</th>
                      <th className="py-2 px-3">Volume</th>
                      <th className="py-2 px-3">Entry Price</th>
                      <th className="py-2 px-3">Current Price</th>
                      <th className="py-2 px-3">Unrealized P&L</th>
                      <th className="py-2 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {openPositions.map((pos) => {
                      const isUp = pos.unrealizedPnl >= 0;
                      return (
                        <tr key={pos.id} className="hover:bg-white/[0.03] transition">
                          <td className="py-2 px-3 font-bold text-white">{pos.symbol}</td>
                          <td className="py-2 px-3">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold ${
                                pos.side === 'BUY'
                                  ? 'bg-blue-500/20 text-blue-400'
                                  : 'bg-rose-500/20 text-rose-400'
                              }`}
                            >
                              {pos.side}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-white">{pos.quantity} Lots</td>
                          <td className="py-2 px-3 text-slate-300">
                            {formatPrice(pos.avgEntryPrice, pos.symbol)}
                          </td>
                          <td className="py-2 px-3 text-white">
                            {formatPrice(pos.currentPrice, pos.symbol)}
                          </td>
                          <td className={`py-2 px-3 font-bold ${isUp ? 'text-blue-400' : 'text-rose-400'}`}>
                            {isUp ? '+' : ''}
                            {formatMinor(pos.unrealizedPnl, currency)}
                          </td>
                          <td className="py-2 px-3 text-right">
                            <button
                              type="button"
                              disabled={closingId === pos.id}
                              onClick={() => void handleClosePosition(pos.id)}
                              className="rounded bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-300 hover:bg-rose-500/30 transition disabled:opacity-50"
                            >
                              {closingId === pos.id ? 'Closing...' : 'Close'}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Pending Orders Tab */}
        {activeTab === 'pending' && (
          <>
            {openOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/5 text-2xl text-slate-400 mb-2">
                  ⏳
                </div>
                <p className="font-semibold text-slate-400">No pending orders</p>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Limit and Stop orders waiting to trigger will appear here.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono">
                  <thead className="bg-[#0e121b] text-slate-400 text-[11px] sticky top-0">
                    <tr>
                      <th className="py-2 px-3">Symbol</th>
                      <th className="py-2 px-3">Type</th>
                      <th className="py-2 px-3">Side</th>
                      <th className="py-2 px-3">Quantity</th>
                      <th className="py-2 px-3">Trigger Price</th>
                      <th className="py-2 px-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {openOrders.map((ord) => (
                      <tr key={ord.id} className="hover:bg-white/[0.03] transition">
                        <td className="py-2 px-3 font-bold text-white">{ord.symbol}</td>
                        <td className="py-2 px-3 text-amber-300 font-semibold">{ord.type ?? 'LIMIT'}</td>
                        <td className="py-2 px-3">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold ${
                              ord.side === 'BUY'
                                ? 'bg-blue-500/20 text-blue-400'
                                : 'bg-rose-500/20 text-rose-400'
                            }`}
                          >
                            {ord.side}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-white">{ord.quantity} Lots</td>
                        <td className="py-2 px-3 text-slate-300">
                          {formatPrice(ord.limitPrice ?? ord.notional, ord.symbol)}
                        </td>
                        <td className="py-2 px-3 text-right">
                          <button
                            type="button"
                            disabled={cancellingId === ord.id}
                            onClick={() => void handleCancelOrder(ord.id)}
                            className="rounded bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-300 hover:bg-rose-500/30 transition disabled:opacity-50"
                          >
                            {cancellingId === ord.id ? 'Cancelling...' : 'Cancel'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {/* Closed Positions & History Tab */}
        {activeTab === 'closed' && (
          <>
            {closedPositions.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-500">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/5 text-2xl text-slate-400 mb-2">
                  📑
                </div>
                <p className="font-semibold text-slate-400">No closed positions</p>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  History of closed trades will be tracked here.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left font-mono">
                  <thead className="bg-[#0e121b] text-slate-400 text-[11px] sticky top-0">
                    <tr>
                      <th className="py-2 px-3">Symbol</th>
                      <th className="py-2 px-3">Side</th>
                      <th className="py-2 px-3">Volume</th>
                      <th className="py-2 px-3">Entry Price</th>
                      <th className="py-2 px-3">Realized P&L</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {closedPositions.map((pos) => (
                      <tr key={pos.id} className="hover:bg-white/[0.03] transition">
                        <td className="py-2 px-3 font-bold text-white">{pos.symbol}</td>
                        <td className="py-2 px-3">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-extrabold ${
                              pos.side === 'BUY'
                                ? 'bg-blue-500/20 text-blue-400'
                                : 'bg-rose-500/20 text-rose-400'
                            }`}
                          >
                            {pos.side}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-white">{pos.quantity} Lots</td>
                        <td className="py-2 px-3 text-slate-300">
                          {formatPrice(pos.avgEntryPrice, pos.symbol)}
                        </td>
                        <td
                          className={`py-2 px-3 font-bold ${
                            pos.realizedPnl >= 0 ? 'text-blue-400' : 'text-rose-400'
                          }`}
                        >
                          {pos.realizedPnl >= 0 ? '+' : ''}
                          {formatMinor(pos.realizedPnl, currency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {/* EXNESS ACCOUNT MARGIN STATUS BAR (MATCHING PICTURE 2 EXACTLY) */}
      <div className="flex flex-wrap items-center justify-between border-t border-white/10 bg-[#0a0d14] px-4 py-2 font-mono text-[11px] text-slate-400">
        <div className="flex flex-wrap items-center gap-4 sm:gap-6">
          <div>
            <span>Equity: </span>
            <span className="font-bold text-white">{formatMinor(equity, currency)}</span>
          </div>
          <div>
            <span>Free Margin: </span>
            <span className="font-bold text-white">{formatMinor(freeMargin, currency)}</span>
          </div>
          <div>
            <span>Balance: </span>
            <span className="font-bold text-white">{formatMinor(balance, currency)}</span>
          </div>
          <div>
            <span>Margin: </span>
            <span className="font-bold text-white">{formatMinor(usedMargin, currency)}</span>
          </div>
          <div>
            <span>Margin level: </span>
            <span className="font-bold text-amber-300">{marginLevel}</span>
          </div>
        </div>

        <div className="text-[10px] text-emerald-400 font-semibold hidden md:flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Terminal #159593044 (Live Feed)
        </div>
      </div>
    </div>
  );
}
