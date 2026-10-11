'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, Skeleton } from '@tanvion-royale/ui';
import { listWalletTransactions } from '@/lib/api';
import { ApiClientError } from '@/lib/api/client';
import {
  WALLET_CURRENCIES,
  currencySymbol,
  formatWalletAmount,
} from '@/lib/api/wallet';
import type {
  WalletCurrency,
  WalletTransactionView,
} from '@tanvion-royale/types';

const STATUS_FILTERS = [
  'ALL',
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'REVERSED',
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number];

const CURRENCY_FILTERS = ['ALL', ...WALLET_CURRENCIES] as const;
type CurrencyFilter = (typeof CURRENCY_FILTERS)[number];

const STATUS_STYLE: Record<string, string> = {
  PENDING: 'bg-amber-500/15 text-amber-300',
  PROCESSING: 'bg-blue-500/15 text-blue-300',
  COMPLETED: 'bg-emerald-500/15 text-emerald-300',
  FAILED: 'bg-red-500/15 text-red-300',
  CANCELLED: 'bg-ink-700 text-slate-300',
  REVERSED: 'bg-ink-700 text-slate-300',
};

const CURRENCY_STYLE: Record<WalletCurrency, string> = {
  BDT: 'bg-emerald-950/50 text-emerald-300 border-emerald-500/40',
  USD: 'bg-blue-950/50 text-blue-300 border-blue-500/40',
  EUR: 'bg-violet-950/50 text-violet-300 border-violet-500/40',
};

function getTypeLabel(type: string) {
  return type
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getStatusLabel(status: string) {
  return status
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getTransactionDescription(tx: WalletTransactionView) {
  switch (tx.type) {
    case 'DEPOSIT':
      return 'Wallet deposit';

    case 'WITHDRAWAL':
      return 'Wallet withdrawal';

    case 'BET_STAKE':
      return 'Bet stake';

    case 'BET_PAYOUT':
      return 'Bet winnings';

    case 'BET_REFUND':
      return 'Bet refund';

    default:
      return getTypeLabel(tx.type);
  }
}

export default function WalletTransactionsPage() {
  const [transactions, setTransactions] = useState<WalletTransactionView[] | null>(
    null,
  );

  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>('ALL');

  const [currencyFilter, setCurrencyFilter] =
    useState<CurrencyFilter>('ALL');

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);

    const request = listWalletTransactions({
      status: statusFilter,
      limit: 100,
      ...(currencyFilter !== 'ALL'
        ? { currency: currencyFilter }
        : {}),
    });

    request
      .then((data) => {
        if (!cancelled) {
          setTransactions(data);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;

        if (err instanceof ApiClientError && err.status === 401) {
          setError('Please sign in to view your transactions.');
        } else if (err instanceof ApiClientError) {
          setError(err.message);
        } else {
          setError(
            'Something went wrong while loading your transactions.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [statusFilter, currencyFilter]);

  const summary = useMemo(() => {
    if (!transactions) {
      return {
        total: 0,
        deposits: 0,
        withdrawals: 0,
        betting: 0,
      };
    }

    return {
      total: transactions.length,
      deposits: transactions.filter(
        (tx) => tx.type === 'DEPOSIT',
      ).length,
      withdrawals: transactions.filter(
        (tx) => tx.type === 'WITHDRAWAL',
      ).length,
      betting: transactions.filter(
        (tx) =>
          tx.type === 'BET_STAKE' ||
          tx.type === 'BET_PAYOUT' ||
          tx.type === 'BET_REFUND',
      ).length,
    };
  }, [transactions]);

  return (
    <>
      <main className="mx-auto w-full max-w-5xl px-3 py-5 sm:px-4 sm:py-8">
        {/* Header */}
        <section>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-100 sm:text-3xl">
                Wallet transactions
              </h1>

              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-300">
                View your deposits, withdrawals, bets, winnings and other
                wallet activity.
              </p>
            </div>

            <a
              href="/wallet"
              className="inline-flex w-fit items-center justify-center rounded-lg border border-white/10 bg-ink-800 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/5"
            >
              ← Wallet
            </a>
          </div>
        </section>

        {/* Summary */}
        <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Total
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-100">
                {summary.total}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Deposits
              </p>
              <p className="mt-1 text-2xl font-bold text-emerald-400">
                {summary.deposits}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Withdrawals
              </p>
              <p className="mt-1 text-2xl font-bold text-red-400">
                {summary.withdrawals}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Betting
              </p>
              <p className="mt-1 text-2xl font-bold text-indigo-400">
                {summary.betting}
              </p>
            </CardContent>
          </Card>
        </section>

        {/* Filters */}
        <Card className="mt-5">
          <CardContent className="p-4">
            <div className="grid gap-4 md:grid-cols-[1fr_auto]">
              {/* Status */}
              <div>
                <p className="mb-2 text-sm font-semibold text-slate-200">
                  Transaction status
                </p>

                <div className="flex gap-2 overflow-x-auto pb-1">
                  {STATUS_FILTERS.map((status) => {
                    const active = statusFilter === status;

                    return (
                      <button
                        key={status}
                        type="button"
                        onClick={() =>
                          setStatusFilter(status)
                        }
                        className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                          active
                            ? 'bg-indigo-600 text-white'
                            : 'bg-ink-700 text-slate-300 hover:bg-white/15'
                        }`}
                      >
                        {getStatusLabel(status)}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Currency */}
              <div className="md:min-w-[250px]">
                <p className="mb-2 text-sm font-semibold text-slate-200">
                  Currency
                </p>

                <div className="grid grid-cols-4 gap-2">
                  {CURRENCY_FILTERS.map((currency) => {
                    const active =
                      currencyFilter === currency;

                    const label =
                      currency === 'ALL'
                        ? 'All'
                        : `${currencySymbol(currency)} ${currency}`;

                    return (
                      <button
                        key={currency}
                        type="button"
                        onClick={() =>
                          setCurrencyFilter(currency)
                        }
                        className={`rounded-lg border px-2 py-2 text-xs font-semibold transition ${
                          active
                            ? 'border-indigo-600 bg-indigo-600 text-white'
                            : currency === 'ALL'
                              ? 'border-white/10 bg-ink-800 text-slate-300 hover:bg-white/5'
                              : `${CURRENCY_STYLE[currency]} hover:opacity-80`
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Content */}
        {loading ? (
          <div className="mt-5 space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : error ? (
          <div
            className="mt-5 rounded-xl border border-red-500/40 bg-red-950/50 px-4 py-4 text-sm text-red-300"
            role="alert"
          >
            {error}
          </div>
        ) : !transactions || transactions.length === 0 ? (
          <Card className="mt-5">
            <CardContent className="flex flex-col items-center justify-center px-5 py-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-ink-700 text-2xl">
                💳
              </div>

              <h2 className="mt-4 text-base font-semibold text-slate-100">
                No transactions found
              </h2>

              <p className="mt-1 max-w-md text-sm leading-6 text-slate-500">
                There are no wallet transactions matching your
                selected filters.
              </p>

              {(statusFilter !== 'ALL' ||
                currencyFilter !== 'ALL') && (
                <button
                  type="button"
                  onClick={() => {
                    setStatusFilter('ALL');
                    setCurrencyFilter('ALL');
                  }}
                  className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-700"
                >
                  Clear filters
                </button>
              )}
            </CardContent>
          </Card>
        ) : (
          <section className="mt-5 space-y-3">
            {transactions.map((tx) => {
              const amountIsPositive = tx.amount >= 0;

              const currency =
                WALLET_CURRENCIES.includes(
                  tx.currency as WalletCurrency,
                )
                  ? (tx.currency as WalletCurrency)
                  : 'BDT';

              return (
                <Card key={tx.id}>
                  <CardContent className="p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      {/* Left */}
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="text-sm font-semibold text-slate-100">
                            {getTransactionDescription(tx)}
                          </h2>

                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                              STATUS_STYLE[tx.status] ??
                              'bg-ink-700 text-slate-300'
                            }`}
                          >
                            {getStatusLabel(tx.status)}
                          </span>
                        </div>

                        <div className="mt-2 space-y-1">
                          <p className="break-all text-xs text-slate-500">
                            Type: {getTypeLabel(tx.type)}
                          </p>

                          <p className="text-xs text-slate-500">
                            Ref:{' '}
                            <span className="break-all">
                              {tx.reference ?? '—'}
                            </span>
                          </p>

                          <p className="text-xs text-slate-500">
                            {new Date(
                              tx.createdAt,
                            ).toLocaleString([], {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })}
                          </p>
                        </div>
                      </div>

                      {/* Right */}
                      <div className="flex items-center justify-between gap-4 border-t border-white/5 pt-3 sm:min-w-[190px] sm:flex-col sm:items-end sm:border-0 sm:pt-0">
                        <span
                          className={`rounded-md border px-2 py-1 text-xs font-bold ${
                            CURRENCY_STYLE[currency]
                          }`}
                        >
                          {currency}
                        </span>

                        <div className="text-right">
                          <p
                            className={`text-lg font-bold ${
                              amountIsPositive
                                ? 'text-emerald-400'
                                : 'text-slate-200'
                            }`}
                          >
                            {amountIsPositive ? '+' : ''}
                            {formatWalletAmount(
                              tx.amount,
                              currency,
                            )}
                          </p>

                          <p className="text-[11px] text-slate-500">
                            {currencySymbol(currency)}{' '}
                            {currency}
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </section>
        )}

        {/* Bottom info */}
        {!loading && !error && transactions && transactions.length > 0 && (
          <p className="mt-5 text-center text-xs leading-5 text-slate-400">
            Showing up to the latest 100 transactions for the selected
            filters.
          </p>
        )}
      </main>
    </>
  );
}
