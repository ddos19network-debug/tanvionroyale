'use client';

import { TradingShell } from '@/components/trading/trading-shell';
import { useEffect, useState } from 'react';

export default function TradingNotificationPage() {
  const [notifications, setNotifications] = useState<Array<{
    id: number;
    title: string;
    message: string;
    time: string;
    read: boolean;
  }>>([]);

  const markAsRead = (id: number) => {
    setNotifications(
      notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n,
      ),
    );
  };

  useEffect(() => {
    // Initialize with sample notifications
    const sample = [
      { id: 1, title: 'Deposit Successful', message: '₹5,000 deposited to your Trading Wallet', time: '2 min ago', read: false },
      { id: 2, title: 'Price Alert', message: 'BTCUSD reached $75,000', time: '15 min ago', read: true },
      { id: 3, title: 'Order Filled', message: 'BTC/USD order of 0.5 BTC filled at $74,500', time: '1 hour ago', read: false },
    ];
    setNotifications(sample);
  }, []);

  return (
    <TradingShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black text-white sm:text-3xl tracking-tight">
            Notification
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Stay updated on your trades, deposits, and platform activity.
          </p>
        </div>

        {/* Notifications List */}
        <div className="rounded-xl border border-white/10 bg-[#121620] overflow-hidden shadow-xl">
          <div className="px-4 py-3 border-b border-white/10">
            <h2 className="text-sm font-bold text-white">Notifications</h2>
            <div className="flex items-center justify-between text-[10px] text-slate-400">
              <span>Mark all as read</span>
              <span>See all</span>
            </div>
          </div>

          <div className="p-4 pt-0">
            {notifications.length === 0 && (
              <div className="text-center py-8 text-slate-500">
                <span className="text-3xl sm:text-4x bottom-4 block">
                  <svg className="mx-auto mb-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="9" y1="9" x2="9.01" y2="9" />
                    <line x1="15" y1="9" x2="15.01" y2="9" />
                  </svg>
                </span>
                <p>No new notifications</p>
              </div>
            )}

            {notifications.map((n) => (
              <div
                key={n.id}
                className={`flex items-start gap-3 py-3 ${
                  n.read ? 'bg-white/5' : 'bg-amber-500/10'
                } transition`}
              >
                <div className="flex-shrink-0 rounded-lg bg-amber-500/20 p-2">
                  <svg
                    className="h-4 w-4 text-amber-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="9" y1="9" x2="9.01" y2="9" />
                    <line x1="15" y1="9" x2="15.01" y2="9" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-white truncate">{n.title}</p>
                  <p className="text-[9px] text-slate-400 truncate">{n.message}</p>
                </div>
                <div className="text-right text-[9px] sm:text-[10px] text-slate-400">
                  {n.time}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </TradingShell>
  );
}