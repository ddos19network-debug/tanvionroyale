'use client';

import { TradingShell } from '@/components/trading/trading-shell';
import { useState } from 'react';

function DepositMethodCard({
  title,
  method,
  description,
  icon,
}: {
  title: string;
  method: string;
  description: string;
  icon: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#121620] p-5 sm:p-6 shadow-sm hover:bg-white/5 transition">
      <div className="flex items-center gap-3 sm:items-start">
        <div className="flex-shrink-0 rounded-lg bg-amber-500/20 p-2 sm:p-3">
          <span className="text-amber-400 text-sm">{icon}</span>
        </div>
        <div className="flex-1 pt-2">
          <h3 className="text-sm font-bold text-white tracking-tight">{title}</h3>
          <p className="text-[10px] text-slate-400 sm:text-sm">{description}</p>
        </div>
      </div>
    </div>
  );
}

export default function TradingDepositPage() {
  const [balance, setBalance] = useState<string>('—');
  const [depositAmount, setDepositAmount] = useState<string>('');

  const methods = [
    { title: 'Bkash', method: 'bkash', description: 'Instant deposit via Bkash mobile banking', icon: '📱' },
    { title: 'Nagad', method: 'nagad', description: 'Instant deposit via Nagad mobile banking', icon: '📲' },
    { title: 'Rocket', method: 'rocket', description: 'Instant deposit via Rocket mobile banking', icon: '🚀' },
    { title: 'Bank Account', method: 'bank', description: 'Bank transfer to your Royale account', icon: '🏦' },
    { title: 'Card', method: 'card', description: 'Deposit via Visa/Mastercard', icon: '💳' },
    { title: 'Royale Pay', method: 'royale', description: 'Deposit using your Royale Balance', icon: '👑' },
    { title: 'Transfer', method: 'transfer', description: 'Transfer from your main Royale wallet', icon: '↔️' },
  ];

  const handleDeposit = () => {
    // Handle deposit logic
    setDepositAmount('');
  };

  return (
    <TradingShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black text-white sm:text-3xl tracking-tight">
            Deposit
          </h1>
          <p className="mt-1 text-sm text-slate-400">
            Add funds to your Trading Wallet. Minimum deposit: $10.
          </p>
        </div>

        {/* Trading Wallet Balance */}
        <div className="rounded-xl border border-white/10 bg-[#121620] p-5 sm:p-6 text-right sm:text-left">
          <div className="text-sm text-slate-400 mb-1 sm:mb-2">Trading Wallet Balance</div>
          <div className="text-3xl font-black text-amber-300">{balance}</div>
          <div className="text-xs text-slate-500">Main Royale Wallet → Trading Wallet</div>
        </div>

        {/* Deposit Methods */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {methods.map((method) => (
            <DepositMethodCard
              key={method.method}
              title={method.title}
              method={method.method}
              description={method.description}
              icon={method.icon}
            />
          ))}
        </div>

        {/* Deposit Form */}
        <div className="rounded-xl border border-white/10 bg-[#121620] p-6 sm:p-8 shadow-sm">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-slate-300 mb-1">Amount</label>
              <input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="0"
                className="w-full rounded-lg border border-white/10 bg-[#0e121b] px-3 py-2.5 text-sm sm:text-base text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-300 mb-1">Payment Method</label>
              <select
                className="w-full rounded-lg border border-white/10 bg-[#0e121b] px-3 py-2.5 text-sm sm:text-base text-white placeholder-slate-500 focus:border-amber-400 focus:outline-none"
              >
                <option>Select method</option>
                {methods.map((m) => (
                  <option key={m.method} value={m.method}>
                    {m.title}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-6 sm:mt-8">
            <button
              onClick={handleDeposit}
              className="w-full rounded-lg bg-amber-400 px-6 py-2.5 text-sm font-bold text-black transition hover:bg-amber-300 shadow-md shadow-amber-500/10 active:scale-95"
            >
              Deposit Now
            </button>
          </div>
        </div>
      </div>
    </TradingShell>
  );
}