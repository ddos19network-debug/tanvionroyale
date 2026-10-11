'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, Card, CardContent } from '@tanvion-royale/ui';
import { createWithdrawal, getWalletBalance, listPaymentMethods, submitManualWithdrawal } from '@/lib/api';
import { ApiClientError } from '@/lib/api/client';
import {
  WALLET_CURRENCIES,
  currencySymbol,
  formatWalletAmount,
  fromMinor,
  listMyManualWithdrawals,
  type ManualWithdrawalView,
} from '@/lib/api/wallet';
import {
  resolveWithdrawalDestinationKind,
  withdrawalDestinationFieldsFor,
  type PaymentMethodView,
  type WalletCurrency,
  type WithdrawalDestinationKind,
} from '@tanvion-royale/types';

const CURRENCIES = WALLET_CURRENCIES;

const CURRENCY_LABELS: Record<WalletCurrency, string> = {
  BDT: 'Bangladeshi Taka',
  USD: 'US Dollar',
  EUR: 'Euro',
};

const CURRENCY_STYLES: Record<WalletCurrency, string> = {
  BDT: 'border-emerald-500/40 bg-emerald-950/50 text-emerald-300',
  USD: 'border-blue-500/40 bg-blue-950/50 text-blue-300',
  EUR: 'border-violet-500/40 bg-violet-950/50 text-violet-300',
};

export default function WalletWithdrawPage() {
  const [currency, setCurrency] = useState<WalletCurrency>('BDT');
  const [amount, setAmount] = useState('');

  const [availableBalance, setAvailableBalance] =
    useState<number | null>(null);

  const [methods, setMethods] = useState<PaymentMethodView[]>([]);
  const [methodCode, setMethodCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [bankName, setBankName] = useState('');
  const [branch, setBranch] = useState('');
  const [routingNumber, setRoutingNumber] = useState('');
  const [history, setHistory] = useState<ManualWithdrawalView[]>([]);

  const [loadingBalance, setLoadingBalance] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [error, setError] = useState<string | null>(null);

  /**
   * Server-confirmed result of the LAST successful withdrawal. When set, the
   * completed form is replaced by a dedicated success state showing the
   * request reference/status and the correct next actions — the user is
   * never left sitting inside a form that already succeeded (Part 4 B / 7).
   */
  const [submitted, setSubmitted] = useState<{
    message: string;
    reference: string;
    status: string;
    method: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoadingBalance(true);
    setError(null);

    getWalletBalance(currency)
      .then((balance) => {
        if (!cancelled) {
          setAvailableBalance(balance.availableBalance);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;

        setAvailableBalance(null);

        if (
          err instanceof ApiClientError &&
          err.status === 401
        ) {
          setError('Please sign in first.');
        } else if (err instanceof ApiClientError) {
          setError(err.message);
        } else {
          setError('Unable to load your wallet balance.');
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingBalance(false);
        }
      });

    listPaymentMethods({ currency, purpose: 'withdrawal' })
      .then((items) => {
        if (cancelled) return;
        setMethods(items);
        setMethodCode((prev) =>
          items.some((m) => m.code === prev) ? prev : items[0]?.code ?? '',
        );
      })
      .catch(() => {
        if (!cancelled) setMethods([]);
      });

    return () => {
      cancelled = true;
    };
  }, [currency]);

  useEffect(() => {
    let cancelled = false;
    listMyManualWithdrawals(5)
      .then((items) => {
        if (!cancelled) setHistory(items);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedMethod = methods.find((m) => m.code === methodCode) ?? null;
  const isManualFlow = selectedMethod?.type === 'MANUAL';
  // Single source of truth for which destination fields the selected
  // admin-configured method needs. Same resolver as the backend, so the UI
  // can never show fields the API would reject (or hide fields it requires).
  const destinationKind: WithdrawalDestinationKind =
    resolveWithdrawalDestinationKind(
      selectedMethod ? selectedMethod.code : null,
    );
  const destinationFields = withdrawalDestinationFieldsFor(
    selectedMethod ? selectedMethod.code : null,
    {
      methodRoutingNumber: selectedMethod
        ? selectedMethod.routingNumber
        : null,
    },
  );
  const showBankFields = isManualFlow && destinationKind === 'BANK';
  const showWalletFields =
    isManualFlow && destinationKind !== 'CARD';
  const showCardGatewayNotice =
    isManualFlow && destinationKind === 'CARD';

  function handleMethodChange(nextCode: string) {
    // Switching categories clears now-irrelevant bank fields so a stale
    // Bank → Nagad switch can never submit hidden bank data. Amount is
    // intentionally preserved.
    const nextKind = resolveWithdrawalDestinationKind(nextCode);
    const prevKind = destinationKind;
    setMethodCode(nextCode);
    setError(null);
    if (nextKind !== prevKind && nextKind !== 'BANK') {
      setBankName('');
      setBranch('');
      setRoutingNumber('');
    }
  }

  function handleCurrencyChange(nextCurrency: WalletCurrency) {
    setCurrency(nextCurrency);
    setAmount('');
    setError(null);
    setSubmitted(null);
  }

  /** Success state → back to a fresh form for another withdrawal. */
  function resetAfterSuccess() {
    setSubmitted(null);
    setError(null);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    // Double-submit guard (Part 35): ignore a second Enter/click while the
    // request is still in flight.
    if (submitting) return;

    setError(null);

    const parsed = Number.parseFloat(amount);

    if (!Number.isFinite(parsed) || parsed <= 0) {
      setError('Enter a valid amount greater than 0.');
      return;
    }

    if (availableBalance !== null && parsed > availableBalance) {
      setError(
        `Insufficient ${currency} balance. Available balance is ${formatWalletAmount(
          availableBalance,
          currency,
        )}.`,
      );
      return;
    }

    setSubmitting(true);

    try {
      if (isManualFlow && selectedMethod) {
        if (destinationKind === 'CARD') {
          setError('Card withdrawals are processed through the configured payment gateway.');
          return;
        }
        if (!accountNumber.trim()) {
          setError(
            destinationKind === 'BANK'
              ? 'Account number is required.'
              : 'Mobile/account number is required.',
          );
          return;
        }
        if (!accountName.trim()) {
          setError('Account holder name is required.');
          return;
        }
        if (destinationFields.requireBankName && !bankName.trim()) {
          setError('Bank name is required.');
          return;
        }
        if (destinationFields.requireBranch && !branch.trim()) {
          setError('Branch is required.');
          return;
        }
        if (
          destinationFields.requireRoutingNumber &&
          !routingNumber.trim()
        ) {
          setError('Routing number is required.');
          return;
        }
        if (
          selectedMethod.minWithdrawal !== null &&
          parsed * 100 < Number(selectedMethod.minWithdrawal)
        ) {
          setError(`Minimum withdrawal is ${formatWalletAmount(Number(selectedMethod.minWithdrawal), currency)}.`);
          return;
        }
        if (
          selectedMethod.maxWithdrawal !== null &&
          parsed * 100 > Number(selectedMethod.maxWithdrawal)
        ) {
          setError(`Maximum withdrawal is ${formatWalletAmount(Number(selectedMethod.maxWithdrawal), currency)}.`);
          return;
        }
        const result = await submitManualWithdrawal({
          methodCode: selectedMethod.code,
          currency,
          amountMajor: amount,
          accountNumber: accountNumber.trim(),
          accountName: accountName.trim() || undefined,
          // Only bank destinations carry bank columns; wallet requests send
          // none so hidden fields can never leak.
          bankName:
            destinationKind === 'BANK'
              ? bankName.trim() || undefined
              : undefined,
          branch:
            destinationKind === 'BANK'
              ? branch.trim() || undefined
              : undefined,
          routingNumber:
            destinationKind === 'BANK'
              ? routingNumber.trim() || undefined
              : undefined,
        });

        // SUCCESS (Part 7): clear sensitive destination fields, refresh the
        // displayed balance from the server-confirmed wallet (the amount is
        // now reserved), revalidate the recent-requests list, and swap the
        // completed form for the dedicated success state.
        const message = `Withdrawal request of ${formatWalletAmount(result.withdrawal.amount, currency)} submitted. Funds are reserved and pending admin review.`;
        setSubmitted({
          message,
          reference: result.withdrawal.id,
          status: result.withdrawal.status,
          method: result.withdrawal.methodName || result.withdrawal.methodCode,
        });
        setAmount('');
        setAccountNumber('');
        setAccountName('');
        setBankName('');
        setBranch('');
        setRoutingNumber('');
        setAvailableBalance(result.wallet.availableBalance);
        setHistory((prev) => [result.withdrawal, ...prev].slice(0, 5));
        return;
      }

      const result = await createWithdrawal(
        amount,
        currency,
      );

      const status = result.transaction.status;

      // SUCCESS (gateway flow): no setTimeout, no hard redirect — show the
      // dedicated success state in place, refresh the balance from the
      // server-confirmed wallet in the response, and let the user choose the
      // next step (transactions / wallet / another withdrawal).
      const message =
        status === 'COMPLETED'
          ? `Withdrawal of ${formatWalletAmount(
              parsed,
              currency,
            )} completed successfully.`
          : `Withdrawal request submitted. Current status: ${status}.`;

      setSubmitted({
        message,
        reference: result.transaction.id,
        status,
        method: selectedMethod?.displayName || currency,
      });
      setAmount('');
      setAvailableBalance(result.wallet.availableBalance);
    } catch (err: unknown) {
      if (
        err instanceof ApiClientError &&
        err.status === 401
      ) {
        setError('Please sign in first.');
      } else if (err instanceof ApiClientError) {
        setError(err.message);
      } else {
        setError(
          'Something went wrong while submitting the withdrawal.',
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  const symbol = currencySymbol(currency);

  return (
    <>
      {/* Page surface + width now match the rest of the account pages
          (/wallet, /wallet/deposit, /notifications, /support/chat): a
          full-width light surface with a centred content column. The dark
          ink-950 page background made the slate-900/slate-600 text of this
          light-themed page look dim and low-contrast. */}
      <main className="min-h-screen w-full bg-ink-950 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
        <div className="mx-auto w-full max-w-2xl">
          {/* Header */}
          <section>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-100 sm:text-3xl">
                  Withdraw
                </h1>

                <p className="mt-1 text-sm leading-6 text-slate-300">
                  Withdraw funds from your wallet using the
                  configured payment provider.
                </p>
              </div>

              <Link
                href="/wallet"
                className="inline-flex w-fit items-center justify-center rounded-lg border border-white/10 bg-ink-800 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/5"
              >
                ← Wallet
              </Link>
            </div>
          </section>

          {/* Balance */}
          <Card className="mt-5 overflow-hidden">
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                    Available balance
                  </p>

                  {loadingBalance ? (
                    <div className="mt-2 h-8 w-36 animate-pulse rounded bg-ink-700" />
                  ) : (
                    <p className="mt-1 text-2xl font-bold text-slate-100">
                      {availableBalance !== null
                        ? formatWalletAmount(
                            availableBalance,
                            currency,
                          )
                        : '—'}
                    </p>
                  )}
                </div>

                <div
                  className={`rounded-xl border px-3 py-2 text-center ${CURRENCY_STYLES[currency]}`}
                >
                  <p className="text-lg font-bold">
                    {symbol}
                  </p>
                  <p className="text-[10px] font-semibold">
                    {currency}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Form — after a confirmed API success the completed form is
              replaced by a dedicated success state with the request
              reference/status and next actions (Part 4 B / Part 7). */}
          <Card className="mt-4">
            <CardContent className="p-4 sm:p-6">
              {submitted ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="space-y-4"
                >
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-lg font-bold text-emerald-300">
                      ✓
                    </span>

                    <div className="min-w-0">
                      <h2 className="text-base font-bold text-emerald-300">
                        Withdrawal confirmed
                      </h2>

                      <p className="mt-1 text-sm leading-6 text-emerald-200">
                        {submitted.message}
                      </p>
                    </div>
                  </div>

                  <dl className="grid gap-2 rounded-xl border border-white/10 bg-ink-800 p-4 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-500">
                        Request reference
                      </dt>
                      <dd className="mt-0.5 break-all font-mono font-semibold text-slate-100">
                        {submitted.reference}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-500">
                        Status
                      </dt>
                      <dd className="mt-0.5">
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-300">
                          {submitted.status}
                        </span>
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-500">
                        Method
                      </dt>
                      <dd className="mt-0.5 font-semibold text-slate-100">
                        {submitted.method}
                      </dd>
                    </div>

                    <div>
                      <dt className="text-xs uppercase tracking-wide text-slate-500">
                        Available balance
                      </dt>
                      <dd className="mt-0.5 font-semibold text-slate-100">
                        {availableBalance !== null
                          ? formatWalletAmount(
                              availableBalance,
                              currency,
                            )
                          : '—'}
                      </dd>
                    </div>
                  </dl>

                  <p className="text-xs leading-5 text-slate-400">
                    The balance above is refreshed from
                    the server. Track this request under
                    Recent requests (below) or in your
                    full transaction history.
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={resetAfterSuccess}
                      className="rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-ink-950 transition hover:bg-brand-dark"
                    >
                      Make another withdrawal
                    </button>

                    <Link
                      href="/wallet/transactions"
                      className="rounded-xl border border-ink-600 px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-white/10"
                    >
                      View transactions
                    </Link>

                    <Link
                      href="/wallet"
                      className="rounded-xl border border-ink-600 px-4 py-2.5 text-sm font-semibold text-slate-300 transition hover:bg-white/10"
                    >
                      Back to wallet
                    </Link>
                  </div>
                </div>
              ) : (
              <form onSubmit={onSubmit} className="space-y-5">
                {/* Currency */}
                <div>
                  <label className="mb-2 block text-sm font-semibold text-slate-200">
                    Select currency
                  </label>

                  <div className="grid grid-cols-3 gap-2 sm:gap-3">
                    {CURRENCIES.map((item) => {
                      const selected = currency === item;

                      return (
                        <button
                          key={item}
                          type="button"
                          onClick={() =>
                            handleCurrencyChange(item)
                          }
                          className={`rounded-xl border px-3 py-3 text-left transition ${
                            selected
                              ? 'border-indigo-600 bg-indigo-600 text-white'
                              : `${CURRENCY_STYLES[item]} hover:opacity-80`
                          }`}
                        >
                          <span className="block text-base font-bold">
                            {currencySymbol(item)} {item}
                          </span>

                          <span
                            className={`mt-0.5 block text-[11px] ${
                              selected
                                ? 'text-indigo-100'
                                : 'opacity-75'
                            }`}
                          >
                            {CURRENCY_LABELS[item]}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Payment method */}
                <div>
                  <label
                    htmlFor="withdraw-method"
                    className="block text-sm font-semibold text-slate-200"
                  >
                    Payment method
                  </label>

                  {methods.length === 0 ? (
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                      No withdrawal methods are available for {currency} yet.
                      Gateway withdrawals are only processed when a real provider
                      is configured by the administrator.
                    </p>
                  ) : (
                    <select
                      id="withdraw-method"
                      value={methodCode}
                      onChange={(e) => {
                        handleMethodChange(e.target.value);
                      }}
                      className="mt-2 w-full rounded-xl border border-ink-600 bg-ink-800 px-3 py-3 text-sm font-medium text-slate-100 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
                    >
                      {methods.map((m) => (
                        <option key={m.id} value={m.code}>
                          {m.displayName} ({m.type === 'MANUAL' ? 'manual review' : 'gateway'})
                        </option>
                      ))}
                    </select>
                  )}

                  {selectedMethod?.instructions && (
                    <p className="mt-2 text-xs leading-5 text-slate-500">
                      {selectedMethod.instructions}
                    </p>
                  )}
                </div>

                {/* Amount */}
                <div>
                  <label
                    htmlFor="withdraw-amount"
                    className="block text-sm font-semibold text-slate-200"
                  >
                    Withdrawal amount
                  </label>

                  <div className="relative mt-2">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-slate-500">
                      {symbol}
                    </span>

                    <input
                      id="withdraw-amount"
                      data-testid="withdraw-amount"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => {
                        setAmount(e.target.value);
                        setError(null);
                      }}
                      className="w-full rounded-xl border border-ink-600 bg-ink-800 py-3 pl-9 pr-4 text-base font-medium text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-brand focus:ring-2 focus:ring-brand/20"
                    />
                  </div>

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span>
                      Currency: {currency}
                    </span>

                    {availableBalance !== null && (
                      <button
                        type="button"
                        onClick={() =>
                          setAmount(
                            fromMinor(availableBalance),
                          )
                        }
                        className="font-semibold text-indigo-400 hover:text-indigo-300"
                      >
                        Use available balance
                      </button>
                    )}
                  </div>
                </div>

                {/* Manual destination fields — dynamic per payment-method category */}
                {isManualFlow && showCardGatewayNotice && (
                  <div className="space-y-2 rounded-xl border border-white/10 bg-ink-900 p-4">
                    <p className="text-sm font-semibold text-slate-200">
                      Card withdrawal
                    </p>
                    <p className="text-xs leading-5 text-slate-500">
                      Card payouts are processed through the configured payment
                      gateway. Manual card details (including CVV, PIN or OTP)
                      are never collected here.
                    </p>
                  </div>
                )}
                {showWalletFields && (
                  <div className="space-y-4 rounded-xl border border-amber-500/40 bg-amber-950/50 p-4">
                    <p className="text-sm font-semibold text-amber-300">
                      Manual withdrawal destination
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <label className="block text-sm">
                        <span className="mb-1 block text-xs font-medium text-amber-300">
                          {destinationKind === 'BANK'
                            ? 'Account number *'
                            : 'Destination account number / mobile *'}
                        </span>
                        <input
                          value={accountNumber}
                          onChange={(e) => setAccountNumber(e.target.value)}
                          placeholder={
                            destinationKind === 'BANK'
                              ? 'Account number'
                              : '01712345678'
                          }
                          autoComplete="off"
                          className="w-full rounded-lg border border-amber-500/40 bg-ink-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30"
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="mb-1 block text-xs font-medium text-amber-300">
                          Account holder / full name *
                        </span>
                        <input
                          value={accountName}
                          onChange={(e) => setAccountName(e.target.value)}
                          placeholder="Full name"
                          autoComplete="off"
                          className="w-full rounded-lg border border-amber-500/40 bg-ink-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30"
                        />
                      </label>
                      {showBankFields && (
                        <>
                          <label className="block text-sm">
                            <span className="mb-1 block text-xs font-medium text-amber-300">
                              Bank name *
                            </span>
                            <input
                              value={bankName}
                              onChange={(e) => setBankName(e.target.value)}
                              placeholder="BRAC Bank"
                              autoComplete="off"
                              className="w-full rounded-lg border border-amber-500/40 bg-ink-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30"
                            />
                          </label>
                          <label className="block text-sm">
                            <span className="mb-1 block text-xs font-medium text-amber-300">
                              Branch *
                            </span>
                            <input
                              value={branch}
                              onChange={(e) => setBranch(e.target.value)}
                              placeholder="Gulshan"
                              autoComplete="off"
                              className="w-full rounded-lg border border-amber-500/40 bg-ink-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30"
                            />
                          </label>
                          <label className="block text-sm sm:col-span-2">
                            <span className="mb-1 block text-xs font-medium text-amber-300">
                              Routing number
                              {destinationFields.requireRoutingNumber
                                ? ' *'
                                : ' (only if required by your bank)'}
                            </span>
                            <input
                              value={routingNumber}
                              onChange={(e) => setRoutingNumber(e.target.value)}
                              placeholder="060277536"
                              autoComplete="off"
                              inputMode="numeric"
                              className="w-full rounded-lg border border-amber-500/40 bg-ink-800 px-3 py-2 text-sm text-slate-100 outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/30"
                            />
                          </label>
                        </>
                      )}
                    </div>
                    <p className="text-xs leading-5 text-amber-300">
                      Funds are reserved immediately. An admin confirms the payout
                      — this page never claims the money was sent.
                    </p>
                  </div>
                )}

                {/* Important notice */}
                <div className="rounded-xl border border-amber-500/40 bg-amber-950/50 p-4">
                  <div className="flex gap-3">
                    <div className="text-lg">ℹ️</div>

                    <div>
                      <p className="text-sm font-semibold text-amber-300">
                        Withdrawal processing
                      </p>

                      <p className="mt-1 text-xs leading-5 text-amber-300">
                        Your withdrawal is processed through the
                        payment provider configured by the
                        administrator. If no provider is configured,
                        the request will not be falsely marked as
                        completed.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Error */}
                {error && (
                  <div
                    className="rounded-xl border border-red-500/40 bg-red-950/50 px-4 py-3 text-sm leading-5 text-red-300"
                    role="alert"
                  >
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={
                    submitting ||
                    loadingBalance ||
                    !amount.trim()
                  }
                  className="w-full"
                >
                  {submitting
                    ? 'Submitting withdrawal…'
                    : isManualFlow
                      ? 'Request manual withdrawal'
                      : `Withdraw ${currency}`}
                </Button>
              </form>
              )}
            </CardContent>
          </Card>

          {/* Recent manual withdrawals */}
          {history.length > 0 && (
            <Card className="mt-4">
              <CardContent className="p-4 sm:p-5">
                <h2 className="text-sm font-semibold text-slate-200">
                  Recent manual withdrawal requests
                </h2>
                <ul className="mt-3 space-y-2">
                  {history.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-white/10 px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-200">
                          {formatWalletAmount(item.amount, item.currency)}{' '}
                          via {item.methodName || item.methodCode}
                        </p>
                        <p className="text-xs text-slate-500">
                          {new Date(item.createdAt).toLocaleString()}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            item.status === 'COMPLETED'
                              ? 'bg-emerald-500/15 text-emerald-300'
                              : item.status === 'REJECTED' || item.status === 'CANCELLED'
                                ? 'bg-red-500/15 text-red-300'
                                : 'bg-amber-500/15 text-amber-300'
                          }`}
                        >
                          {item.status.replaceAll('_', ' ')}
                        </span>
                        {item.rejectionReason && (
                          <span className="max-w-[180px] truncate text-[11px] text-slate-500">
                            {item.rejectionReason}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Footer links */}
          <div className="mt-5 flex flex-col items-center justify-center gap-3 text-sm sm:flex-row">
            <Link
              href="/wallet"
              className="text-slate-500 underline underline-offset-2 hover:text-slate-100"
            >
              Back to wallet
            </Link>

            <span className="hidden text-slate-300 sm:inline">
              •
            </span>

            <Link
              href="/wallet/transactions"
              className="text-indigo-400 underline underline-offset-2 hover:text-indigo-300"
            >
              View transactions
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}
