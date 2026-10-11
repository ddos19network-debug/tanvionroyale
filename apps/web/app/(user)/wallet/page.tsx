'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  currencySymbol,
  formatWalletAmount,
  getWalletBalance,
  type WalletCurrencyCode,
} from '@/lib/api/wallet';

import type { WalletBalanceView } from '@tanvion-royale/types';

const CURRENCIES: WalletCurrencyCode[] = [
  'BDT',
  'USD',
  'EUR',
];

export default function WalletPage() {
  const [selectedCurrency, setSelectedCurrency] =
    useState<WalletCurrencyCode>('BDT');

  const [balances, setBalances] = useState<
    Partial<Record<WalletCurrencyCode, WalletBalanceView>>
  >({});

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const selectedBalance =
    balances[selectedCurrency];

  const selectedAvailable =
    Number(selectedBalance?.availableBalance ?? 0);

  const selectedLocked =
    Number(selectedBalance?.lockedBalance ?? 0);

  const totalCurrencies = useMemo(() => {
    return CURRENCIES.length;
  }, []);

  async function loadBalances() {
    setLoading(true);
    setError('');

    try {
      const results = await Promise.all(
        CURRENCIES.map(async (currency) => {
          try {
            const balance =
              await getWalletBalance(currency);

            return [currency, balance] as const;
          } catch {
            return [currency, null] as const;
          }
        }),
      );

      const nextBalances: Partial<
        Record<WalletCurrencyCode, WalletBalanceView>
      > = {};

      for (const [currency, balance] of results) {
        if (balance) {
          nextBalances[currency] = balance;
        }
      }

      setBalances(nextBalances);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load wallet balance.',
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadBalances();
  }, []);

  return (
    <main className="min-h-screen w-full bg-ink-950 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        {/* Header */}

        <div className="mb-5 rounded-2xl border border-white/10 bg-ink-800 p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                My Wallet
              </p>

              <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-100 sm:text-3xl">
                Wallet Overview
              </h1>

              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                Manage your balances, deposits,
                withdrawals and wallet transactions.
              </p>
            </div>

            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand/15 text-xl font-bold text-brand">
              ৳
            </div>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mb-5 rounded-xl border border-red-500/40 bg-red-950/50 px-4 py-3 text-sm font-medium leading-5 text-red-300"
          >
            {error}
          </div>
        )}

        {/* Main balance */}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <section className="min-w-0 space-y-5">
            {/* Currency selector */}

            <div className="rounded-2xl border border-white/10 bg-ink-800 p-4 sm:p-5">
              <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="text-base font-bold text-slate-100">
                    Wallet currencies
                  </h2>

                  <p className="mt-1 text-xs text-slate-500">
                    {totalCurrencies} supported currencies
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {CURRENCIES.map((currency) => {
                  const balance =
                    balances[currency];

                  const active =
                    selectedCurrency === currency;

                  const available =
                    Number(
                      balance?.availableBalance ?? 0,
                    );

                  return (
                    <button
                      key={currency}
                      type="button"
                      onClick={() =>
                        setSelectedCurrency(currency)
                      }
                      className={[
                        'min-w-0 rounded-xl border p-4 text-left transition',
                        'focus:outline-none focus:ring-2 focus:ring-brand/40 focus:ring-offset-2',
                        active
                          ? 'border-brand bg-brand text-ink-950'
                          : 'border-white/10 bg-ink-800 hover:border-brand/60',
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span
                          className={[
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-base font-bold',
                            active
                              ? 'bg-white/15 text-white'
                              : 'bg-ink-700 text-slate-300',
                          ].join(' ')}
                        >
                          {currencySymbol(
                            currency,
                          )}
                        </span>

                        <span
                          className={[
                            'text-xs font-bold',
                            active
                              ? 'text-white'
                              : 'text-slate-400',
                          ].join(' ')}
                        >
                          {currency}
                        </span>
                      </div>

                      <p
                        className={[
                          'mt-4 text-xl font-bold',
                          active
                            ? 'text-white'
                            : 'text-slate-100',
                        ].join(' ')}
                      >
                        {formatWalletAmount(
                          available,
                          currency,
                        )}
                      </p>

                      <p
                        className={[
                          'mt-1 text-xs',
                          active
                            ? 'text-white/65'
                            : 'text-slate-500',
                        ].join(' ')}
                      >
                        Available balance
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Selected balance */}

            <div className="overflow-hidden rounded-2xl border border-white/10 bg-ink-800">
              <div className="border-b border-white/5 p-4 sm:p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-lg font-bold text-brand">
                    {currencySymbol(
                      selectedCurrency,
                    )}
                  </span>

                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Selected wallet
                    </p>

                    <h2 className="mt-0.5 text-lg font-bold text-slate-100">
                      {selectedCurrency}
                    </h2>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 divide-y divide-white/5 sm:grid-cols-2 sm:divide-x sm:divide-y-0">
                <div className="p-5">
                  <p className="text-xs font-medium text-slate-500">
                    Available balance
                  </p>

                  <p className="mt-2 break-all text-2xl font-bold tracking-tight text-slate-100 sm:text-3xl">
                    {loading
                      ? 'Loading...'
                      : formatWalletAmount(
                          selectedAvailable,
                          selectedCurrency,
                        )}
                  </p>

                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    Funds currently available for
                    wallet operations.
                  </p>
                </div>

                <div className="p-5">
                  <p className="text-xs font-medium text-slate-500">
                    Locked balance
                  </p>

                  <p className="mt-2 break-all text-2xl font-bold tracking-tight text-slate-100 sm:text-3xl">
                    {loading
                      ? 'Loading...'
                      : formatWalletAmount(
                          selectedLocked,
                          selectedCurrency,
                        )}
                  </p>

                  <p className="mt-2 text-xs leading-5 text-slate-500">
                    Funds temporarily locked by
                    pending wallet operations.
                  </p>
                </div>
              </div>
            </div>

            {/* Actions */}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <a
                href="/wallet/deposit"
                className="rounded-2xl border border-white/10 bg-ink-800 p-4 transition hover:border-brand/60"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-lg font-bold text-emerald-300">
                  +
                </span>

                <h3 className="mt-4 text-sm font-bold text-slate-100">
                  Deposit
                </h3>

                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Add funds using available payment
                  methods.
                </p>
              </a>

              <a
                href="/wallet/withdraw"
                className="rounded-2xl border border-white/10 bg-ink-800 p-4 transition hover:border-brand/60"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15 text-lg font-bold text-blue-300">
                  ↑
                </span>

                <h3 className="mt-4 text-sm font-bold text-slate-100">
                  Withdraw
                </h3>

                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Request a withdrawal from your
                  available balance.
                </p>
              </a>

              <a
                href="/wallet/transactions"
                className="rounded-2xl border border-white/10 bg-ink-800 p-4 transition hover:border-brand/60"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink-700 text-lg font-bold text-slate-300">
                  ≡
                </span>

                <h3 className="mt-4 text-sm font-bold text-slate-100">
                  Transactions
                </h3>

                <p className="mt-1 text-xs leading-5 text-slate-500">
                  View your complete wallet activity.
                </p>
              </a>
            </div>
          </section>

          {/* Right sidebar */}

          <aside className="min-w-0 space-y-5">
            {/* Quick summary */}

            <div className="rounded-2xl border border-white/10 bg-ink-800 p-4 sm:p-5">
              <h3 className="text-sm font-bold text-slate-100">
                Wallet summary
              </h3>

              <div className="mt-4 space-y-3">
                {CURRENCIES.map((currency) => {
                  const balance =
                    balances[currency];

                  return (
                    <div
                      key={currency}
                      className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-ink-900 p-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ink-800 text-sm font-bold text-slate-300">
                          {currencySymbol(
                            currency,
                          )}
                        </span>

                        <span className="text-sm font-semibold text-slate-200">
                          {currency}
                        </span>
                      </div>

                      <span className="shrink-0 text-sm font-bold text-slate-100">
                        {loading
                          ? '...'
                          : formatWalletAmount(
                              Number(
                                balance?.availableBalance ??
                                  0,
                              ),
                              currency,
                            )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Information */}

            <div className="rounded-2xl border border-white/10 bg-ink-800 p-4 sm:p-5">
              <h3 className="text-sm font-bold text-slate-100">
                Wallet information
              </h3>

              <div className="mt-4 space-y-4">
                <InfoRow
                  title="Supported currencies"
                  value="BDT • USD • EUR"
                />

                <InfoRow
                  title="Deposit"
                  value="Manual + gateway"
                />

                <InfoRow
                  title="Payment methods"
                  value="bKash • Nagad • Rocket • Bank • Card"
                />

                <InfoRow
                  title="Verification"
                  value="Admin review"
                />
              </div>
            </div>

            {/* Security note */}

            <div className="rounded-2xl border border-amber-500/40 bg-amber-950/50 p-4 sm:p-5">
              <p className="text-sm font-bold text-amber-300">
                Payment safety
              </p>

              <p className="mt-2 text-xs leading-5 text-amber-300">
                Always send funds only to the payment
                account shown on the official deposit
                page. Do not share your password, OTP or
                private account credentials.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

function InfoRow({
  title,
  value,
}: {
  title: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {title}
      </p>

      <p className="mt-1 break-words text-sm font-semibold text-slate-200">
        {value}
      </p>
    </div>
  );
}
