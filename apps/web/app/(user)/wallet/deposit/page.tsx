'use client';

import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from 'react';
import Link from 'next/link';

import {
  currencySymbol,
  formatWalletAmount,
  listPaymentMethods,
  listMyManualDeposits,
  submitManualDeposit,
  type WalletCurrencyCode,
} from '@/lib/api/wallet';

import type {
  ManualDepositView,
  PaymentMethodView,
} from '@tanvion-royale/types';

const CURRENCIES: Array<{
  code: WalletCurrencyCode;
  name: string;
  description: string;
}> = [
  {
    code: 'BDT',
    name: 'Bangladesh Taka',
    description: 'বাংলাদেশি টাকা',
  },
  {
    code: 'USD',
    name: 'US Dollar',
    description: 'United States Dollar',
  },
  {
    code: 'EUR',
    name: 'Euro',
    description: 'European Euro',
  },
];

const METHOD_ICONS: Record<string, string> = {
  BKASH: 'bK',
  NAGAD: 'N',
  ROCKET: 'R',
  BANK: '৳',
  CARD: '▣',
  OTHER: '₿',
};

const METHOD_COLORS: Record<string, string> = {
  BKASH: 'bg-pink-500/15 text-pink-300 border-pink-500/40',
  NAGAD: 'bg-orange-500/15 text-orange-300 border-orange-500/40',
  ROCKET: 'bg-purple-500/15 text-purple-300 border-purple-500/40',
  BANK: 'bg-blue-500/15 text-blue-300 border-blue-500/40',
  CARD: 'bg-ink-700 text-slate-300 border-white/10',
  OTHER: 'bg-ink-700 text-slate-300 border-white/10',
};

function methodKey(method: PaymentMethodView): string {
  return String(method.type || method.code || 'OTHER').toUpperCase();
}

function getMethodIcon(method: PaymentMethodView): string {
  const key = methodKey(method);

  if (key.includes('BKASH')) {
    return METHOD_ICONS.BKASH;
  }

  if (key.includes('NAGAD')) {
    return METHOD_ICONS.NAGAD;
  }

  if (key.includes('ROCKET')) {
    return METHOD_ICONS.ROCKET;
  }

  if (key.includes('BANK')) {
    return METHOD_ICONS.BANK;
  }

  if (key.includes('CARD')) {
    return METHOD_ICONS.CARD;
  }

  return METHOD_ICONS.OTHER;
}

function getMethodColor(method: PaymentMethodView): string {
  const key = methodKey(method);

  if (key.includes('BKASH')) {
    return METHOD_COLORS.BKASH;
  }

  if (key.includes('NAGAD')) {
    return METHOD_COLORS.NAGAD;
  }

  if (key.includes('ROCKET')) {
    return METHOD_COLORS.ROCKET;
  }

  if (key.includes('BANK')) {
    return METHOD_COLORS.BANK;
  }

  if (key.includes('CARD')) {
    return METHOD_COLORS.CARD;
  }

  return METHOD_COLORS.OTHER;
}

function statusLabel(status: ManualDepositView['status']): string {
  switch (status) {
    case 'PENDING':
      return 'Pending';

    case 'UNDER_REVIEW':
      return 'Under review';

    case 'APPROVED':
      return 'Approved';

    case 'REJECTED':
      return 'Rejected';

    case 'CANCELLED':
      return 'Cancelled';

    default:
      return status;
  }
}

function statusClass(status: ManualDepositView['status']): string {
  switch (status) {
    case 'APPROVED':
      return 'bg-emerald-500/15 text-emerald-300';

    case 'REJECTED':
      return 'bg-red-500/15 text-red-300';

    case 'UNDER_REVIEW':
      return 'bg-amber-500/15 text-amber-300';

    case 'CANCELLED':
      return 'bg-ink-700 text-slate-300';

    default:
      return 'bg-blue-500/15 text-blue-300';
  }
}

export default function DepositPage() {
  const [currency, setCurrency] =
    useState<WalletCurrencyCode>('BDT');

  const [paymentMethods, setPaymentMethods] = useState<
    PaymentMethodView[]
  >([]);

  const [selectedMethodCode, setSelectedMethodCode] =
    useState<string>('');

  const [amount, setAmount] = useState('');

  const [referenceId, setReferenceId] = useState('');

  const [proofDataUrl, setProofDataUrl] =
    useState<string>('');

  const [proofFileName, setProofFileName] =
    useState('');

  const [loadingMethods, setLoadingMethods] =
    useState(false);

  const [submitting, setSubmitting] =
    useState(false);

  const [loadingHistory, setLoadingHistory] =
    useState(false);

  const [history, setHistory] =
    useState<ManualDepositView[]>([]);

  const [error, setError] =
    useState('');

  const [success, setSuccess] =
    useState('');

  /**
   * Submit-context error (validation / API / screenshot). Rendered INSIDE the
   * form next to the submit button so a failed submit is never only visible
   * in a banner far above the fold (Part 5: stay in context, clear error,
   * retry).
   */
  const [formError, setFormError] =
    useState('');

  /**
   * The server-confirmed deposit after a successful submit. When set, the
   * completed submit form is REPLACED by a dedicated success state that shows
   * the request reference and the correct next actions — the user is never
   * left sitting inside a form that already succeeded (Part 4, Category B).
   */
  const [submitted, setSubmitted] =
    useState<ManualDepositView | null>(
      null,
    );

  const [copiedField, setCopiedField] =
    useState('');

  const selectedMethod = useMemo(
    () =>
      paymentMethods.find(
        (method) =>
          method.code === selectedMethodCode,
      ) ?? null,
    [paymentMethods, selectedMethodCode],
  );

  const currencyInfo =
    CURRENCIES.find(
      (item) => item.code === currency,
    ) ?? CURRENCIES[0];

  const numericAmount = Number(
    amount.replace(/,/g, '').trim(),
  );

  const formattedAmount =
    Number.isFinite(numericAmount) && numericAmount > 0
      ? numericAmount.toLocaleString(undefined, {
          minimumFractionDigits: 0,
          maximumFractionDigits: 2,
        })
      : '0';

  const canSubmit =
    Boolean(selectedMethod) &&
    Boolean(amount.trim()) &&
    numericAmount > 0 &&
    Boolean(referenceId.trim() || proofDataUrl);

  async function loadPaymentMethods(
    selectedCurrency: WalletCurrencyCode,
  ) {
    setLoadingMethods(true);
    setError('');

    try {
      const methods = await listPaymentMethods({
        currency: selectedCurrency,
        purpose: 'deposit',
      });

      setPaymentMethods(methods);

      setSelectedMethodCode(
        methods.length > 0 ? methods[0].code : '',
      );
    } catch (err) {
      setPaymentMethods([]);
      setSelectedMethodCode('');

      setError(
        err instanceof Error
          ? err.message
          : 'Unable to load payment methods.',
      );
    } finally {
      setLoadingMethods(false);
    }
  }

  async function loadHistory() {
    setLoadingHistory(true);

    try {
      const deposits = await listMyManualDeposits(10);
      setHistory(deposits);
    } catch {
      // History is secondary to the deposit form.
      // Do not block the deposit page if it fails.
    } finally {
      setLoadingHistory(false);
    }
  }

  useEffect(() => {
    void loadPaymentMethods(currency);
  }, [currency]);

  useEffect(() => {
    void loadHistory();
  }, []);

  async function handleCopy(
    value: string,
    field: string,
  ) {
    if (!value) {
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);

      window.setTimeout(() => {
        setCopiedField('');
      }, 1800);
    } catch {
      setError('Unable to copy the information.');
    }
  }

  async function handleProofChange(
    event: ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    setProofDataUrl('');
    setProofFileName('');

    if (!file) {
      return;
    }

    if (!file.type.startsWith('image/')) {
      setFormError('Please select an image screenshot.');
      event.target.value = '';
      return;
    }

    /*
     * Keep the browser payload reasonably small.
     * The backend DTO also validates the final payload size.
     */
    if (file.size > 1_800_000) {
      setFormError(
        'Screenshot is too large. Please use an image under 1.8 MB.',
      );
      event.target.value = '';
      return;
    }

    try {
      const reader = new FileReader();

      reader.onload = () => {
        const result = reader.result;

        if (typeof result !== 'string') {
          setFormError('Unable to read the screenshot.');
          return;
        }

        setProofDataUrl(result);
        setProofFileName(file.name);
        setFormError('');
      };

      reader.onerror = () => {
        setFormError('Unable to read the screenshot.');
      };

      reader.readAsDataURL(file);
    } catch {
      setFormError('Unable to process the screenshot.');
    }
  }

  function validateForm(): string | null {
    if (!selectedMethod) {
      return 'Please select a payment method.';
    }

    if (!amount.trim()) {
      return 'Please enter the deposit amount.';
    }

    if (
      !Number.isFinite(numericAmount) ||
      numericAmount <= 0
    ) {
      return 'Please enter a valid deposit amount.';
    }

    if (
      selectedMethod.minDeposit !== null &&
      numericAmount * 100 <
        Number(selectedMethod.minDeposit)
    ) {
      return `Minimum deposit is ${formatWalletAmount(
        Number(selectedMethod.minDeposit),
        currency,
      )}.`;
    }

    if (
      selectedMethod.maxDeposit !== null &&
      numericAmount * 100 >
        Number(selectedMethod.maxDeposit)
    ) {
      return `Maximum deposit is ${formatWalletAmount(
        Number(selectedMethod.maxDeposit),
        currency,
      )}.`;
    }

    /*
     * Transaction ID and screenshot are both individually optional.
     * At least one must be supplied.
     */
    if (
      !referenceId.trim() &&
      !proofDataUrl
    ) {
      return 'Please provide a transaction ID or payment screenshot.';
    }

    return null;
  }

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    // Double-submit guard (Part 35): ignore a second Enter/click while the
    // request is still in flight.
    if (submitting) {
      return;
    }

    setError('');
    setSuccess('');
    setFormError('');

    const validationError = validateForm();

    if (validationError) {
      setFormError(validationError);
      return;
    }

    if (!selectedMethod) {
      return;
    }

    setSubmitting(true);

    try {
      const result = await submitManualDeposit({
        methodCode: selectedMethod.code,
        currency,
        amountMajor: amount,
        referenceId:
          referenceId.trim() || undefined,
        proofDataUrl:
          proofDataUrl || undefined,
      });

      // SUCCESS (Part 6): keep the server-confirmed request so the UI can show
      // its reference/status, clear every sensitive field, revalidate the
      // history list, then replace the completed form with a dedicated
      // success state + next actions (never leave the user inside a form
      // that already succeeded).
      setSubmitted(result.deposit);
      setSuccess(
        'Deposit submitted successfully. Your payment will be reviewed by the admin team.',
      );

      setAmount('');
      setReferenceId('');
      setProofDataUrl('');
      setProofFileName('');

      const fileInput =
        document.getElementById(
          'deposit-proof',
        ) as HTMLInputElement | null;

      if (fileInput) {
        fileInput.value = '';
      }

      await loadHistory();
    } catch (err) {
      // FAILURE (Part 5): stay on the form, surface the error NEXT TO the
      // submit button, keep every entered value, restore the button.
      setFormError(
        err instanceof Error
          ? err.message
          : 'Unable to submit the deposit.',
      );
    } finally {
      setSubmitting(false);
    }
  }

  /** Success state → back to a fresh form for another deposit. */
  function resetAfterSuccess() {
    setSubmitted(null);
    setSuccess('');
    setFormError('');
  }

  return (
    <main className="min-h-screen w-full bg-ink-950 px-3 py-4 sm:px-6 sm:py-6 lg:px-8">
      <div className="mx-auto w-full max-w-6xl">
        {/* ---------------------------------------------------------------- */}
        {/* Header                                                            */}
        {/* ---------------------------------------------------------------- */}

        <div className="mb-5 rounded-2xl border border-white/10 bg-ink-800 p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
                Wallet
              </p>

              <h1 className="text-2xl font-bold tracking-tight text-slate-100 sm:text-3xl">
                Deposit Funds
              </h1>

              <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                Select your currency and payment method,
                complete the payment, then submit your
                transaction information.
              </p>
            </div>

            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand/15 text-xl text-brand">
              +
            </div>
          </div>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Alerts                                                            */}
        {/* ---------------------------------------------------------------- */}

        {error && (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-red-500/40 bg-red-950/50 px-4 py-3 text-sm font-medium leading-5 text-red-300"
          >
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          {/* ================================================================= */}
          {/* LEFT                                                               */}
          {/* ================================================================= */}

          <section className="min-w-0 space-y-5">
            {/* Currency */}

            <div className="rounded-2xl border border-white/10 bg-ink-800 p-4 sm:p-5">
              <div className="mb-4">
                <h2 className="text-base font-bold text-slate-100">
                  1. Select currency
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  Choose the wallet currency you want to
                  deposit into.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {CURRENCIES.map((item) => {
                  const active =
                    currency === item.code;

                  return (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => {
                        setCurrency(item.code);
                        setError('');
                        setSuccess('');
                        setFormError('');
                        setSubmitted(null);
                      }}
                      className={[
                        'min-w-0 rounded-xl border p-4 text-left transition',
                        'focus:outline-none focus:ring-2 focus:ring-brand/40 focus:ring-offset-2',
                        active
                          ? 'border-brand bg-brand text-ink-950'
                          : 'border-white/10 bg-ink-800 text-slate-100 hover:border-brand/60',
                      ].join(' ')}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span
                          className={[
                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold',
                            active
                              ? 'bg-white/15 text-white'
                              : 'bg-ink-700 text-slate-300',
                          ].join(' ')}
                        >
                          {currencySymbol(item.code)}
                        </span>

                        <span
                          className={[
                            'text-xs font-bold',
                            active
                              ? 'text-white'
                              : 'text-slate-400',
                          ].join(' ')}
                        >
                          {item.code}
                        </span>
                      </div>

                      <div className="mt-3 min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {item.name}
                        </p>

                        <p
                          className={[
                            'mt-1 truncate text-xs',
                            active
                              ? 'text-white/70'
                              : 'text-slate-500',
                          ].join(' ')}
                        >
                          {item.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Payment methods */}

            <div className="rounded-2xl border border-white/10 bg-ink-800 p-4 sm:p-5">
              <div className="mb-4">
                <h2 className="text-base font-bold text-slate-100">
                  2. Select payment method
                </h2>

                <p className="mt-1 text-xs text-slate-500">
                  Available methods for {currencyInfo.name}.
                </p>
              </div>

              {loadingMethods ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[1, 2, 3, 4, 5].map(
                    (item) => (
                      <div
                        key={item}
                        className="h-28 animate-pulse rounded-xl bg-ink-700"
                      />
                    ),
                  )}
                </div>
              ) : paymentMethods.length === 0 ? (
                <div className="rounded-xl border border-dashed border-ink-600 bg-ink-900 px-4 py-8 text-center">
                  <p className="text-sm font-semibold text-slate-300">
                    No payment method available
                  </p>

                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Admin has not configured a deposit
                    method for {currency}.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {paymentMethods.map(
                    (method) => {
                      const active =
                        selectedMethodCode ===
                        method.code;

                      return (
                        <button
                          key={method.id}
                          type="button"
                          onClick={() => {
                            setSelectedMethodCode(
                              method.code,
                            );
                            setError('');
                            // NOTE: the success panel is a record of the
                            // ALREADY-submitted request — browsing methods
                            // must not blank its message. Only in-form
                            // errors are cleared here.
                            setFormError('');
                          }}
                          className={[
                            'min-w-0 rounded-xl border p-3 text-left transition sm:p-4',
                            'focus:outline-none focus:ring-2 focus:ring-brand/40 focus:ring-offset-2',
                            active
                              ? 'border-brand bg-ink-900 ring-1 ring-brand'
                              : 'border-white/10 hover:border-brand/60',
                          ].join(' ')}
                        >
                          <div className="flex items-center gap-3">
                            <span
                              className={[
                                'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-xs font-extrabold',
                                getMethodColor(
                                  method,
                                ),
                              ].join(' ')}
                            >
                              {getMethodIcon(
                                method,
                              )}
                            </span>

                            <span className="min-w-0">
                              <span className="block truncate text-sm font-bold text-slate-100">
                                {method.displayName}
                              </span>

                              <span className="mt-0.5 block truncate text-[11px] text-slate-500">
                                {methodKey(
                                  method,
                                )}
                              </span>
                            </span>
                          </div>

                          <div className="mt-3 flex items-center justify-between gap-2">
                            <span className="text-[11px] text-slate-500">
                              Deposit
                            </span>

                            <span
                              className={[
                                'h-2 w-2 rounded-full',
                                active
                                  ? 'bg-emerald-500'
                                  : 'bg-ink-600',
                              ].join(' ')}
                            />
                          </div>
                        </button>
                      );
                    },
                  )}
                </div>
              )}
            </div>

            {/* Account details */}

            {selectedMethod && (
              <div className="rounded-2xl border border-white/10 bg-ink-800 p-4 sm:p-5">
                <div className="mb-4">
                  <h2 className="text-base font-bold text-slate-100">
                    3. Payment account
                  </h2>

                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Send your payment to the account
                    configured by Admin.
                  </p>
                </div>

                <div className="space-y-3">
                  {selectedMethod.accountNumber && (
                    <CopyableInfo
                      label="Account / Number"
                      value={
                        selectedMethod.accountNumber
                      }
                      field="account"
                      copiedField={copiedField}
                      onCopy={handleCopy}
                    />
                  )}

                  {selectedMethod.accountName && (
                    <CopyableInfo
                      label="Account Name"
                      value={
                        selectedMethod.accountName
                      }
                      field="account-name"
                      copiedField={copiedField}
                      onCopy={handleCopy}
                    />
                  )}

                  {selectedMethod.bankName && (
                    <CopyableInfo
                      label="Bank"
                      value={
                        selectedMethod.bankName
                      }
                      field="bank"
                      copiedField={copiedField}
                      onCopy={handleCopy}
                    />
                  )}

                  {selectedMethod.branch && (
                    <CopyableInfo
                      label="Branch"
                      value={
                        selectedMethod.branch
                      }
                      field="branch"
                      copiedField={copiedField}
                      onCopy={handleCopy}
                    />
                  )}

                  {selectedMethod.routingNumber && (
                    <CopyableInfo
                      label="Routing Number"
                      value={
                        selectedMethod.routingNumber
                      }
                      field="routing"
                      copiedField={copiedField}
                      onCopy={handleCopy}
                    />
                  )}

                  {selectedMethod.instructions && (
                    <div className="rounded-xl border border-amber-500/40 bg-amber-950/50 p-4">
                      <p className="text-xs font-bold uppercase tracking-wide text-amber-300">
                        Payment instructions
                      </p>

                      <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-amber-300">
                        {selectedMethod.instructions}
                      </p>
                    </div>
                  )}

                  {!selectedMethod.accountNumber &&
                    !selectedMethod.accountName &&
                    !selectedMethod.bankName &&
                    !selectedMethod.instructions && (
                      <div className="rounded-xl bg-ink-900 p-4 text-sm text-slate-300">
                        Please follow the instructions
                        provided by the payment method.
                      </div>
                    )}
                </div>
              </div>
            )}

            {/* Submit form — after a confirmed API success the completed form
                is replaced by a dedicated success state with the request
                reference and next actions (Part 4 Category B / Part 6). */}
            {submitted ? (
              <div
                role="status"
                aria-live="polite"
                className="rounded-2xl border border-emerald-500/40 bg-ink-800 p-4 sm:p-5"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-lg font-bold text-emerald-300">
                    ✓
                  </span>

                  <div className="min-w-0">
                    <h2 className="text-base font-bold text-emerald-300">
                      Deposit submitted
                    </h2>

                    <p className="mt-1 text-sm leading-6 text-emerald-200">
                      {success}
                    </p>
                  </div>
                </div>

                <dl className="mt-4 grid gap-2 rounded-xl bg-ink-900 p-4 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      Request reference
                    </dt>
                    <dd className="mt-0.5 break-all font-mono font-semibold text-slate-100">
                      {submitted.referenceId ||
                        submitted.id}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      Amount
                    </dt>
                    <dd className="mt-0.5 font-semibold text-slate-100">
                      {formatWalletAmount(
                        Number(
                          submitted.amount,
                        ),
                        submitted.currency,
                      )}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      Method
                    </dt>
                    <dd className="mt-0.5 font-semibold text-slate-100">
                      {submitted.methodName}
                    </dd>
                  </div>

                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">
                      Status
                    </dt>
                    <dd className="mt-0.5">
                      <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs font-semibold text-amber-300">
                        {statusLabel(
                          submitted.status,
                        )}
                      </span>
                    </dd>
                  </div>
                </dl>

                <p className="mt-3 text-xs leading-5 text-slate-400">
                  Your request is now visible under
                  Recent deposits (right) and in your
                  transaction history. Nothing further
                  is needed from you — the admin team
                  reviews it manually.
                </p>

                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={resetAfterSuccess}
                    className="rounded-xl bg-brand px-4 py-2.5 text-sm font-bold text-ink-950 transition hover:bg-brand-dark"
                  >
                    Make another deposit
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
            <form
              onSubmit={handleSubmit}
              className="rounded-2xl border border-white/10 bg-ink-800 p-4 sm:p-5"
            >
              <div className="mb-5">
                <h2 className="text-base font-bold text-slate-100">
                  4. Submit payment details
                </h2>

                <p className="mt-1 text-xs leading-5 text-slate-500">
                  After completing the external payment,
                  provide a transaction ID, screenshot, or
                  both.
                </p>
              </div>

              {/* Amount */}

              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-slate-200">
                  Amount ({currency})
                </span>

                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">
                    {currencySymbol(
                      currency,
                    )}
                  </span>

                  <input
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={amount}
                    onChange={(event) => {
                      setAmount(
                        event.target.value,
                      );
                      setFormError('');
                    }}
                    placeholder="0.00"
                    className="w-full rounded-xl border border-ink-600 bg-ink-800 py-3 pl-9 pr-4 text-base font-semibold text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-brand focus:ring-2 focus:ring-brand/20"
                  />
                </div>

                <p className="mt-2 text-xs text-slate-500">
                  Enter the exact amount you paid.
                </p>
              </label>

              {/* Transaction ID */}

              <label className="mt-5 block">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-200">
                    Transaction ID
                  </span>

                  <span className="text-[11px] font-medium text-slate-400">
                    Optional if you upload a screenshot
                  </span>
                </div>

                <input
                  type="text"
                  value={referenceId}
                  onChange={(event) => {
                    setReferenceId(
                      event.target.value,
                    );
                    setFormError('');
                  }}
                  placeholder="e.g. TXN123456789"
                  maxLength={100}
                  className="w-full rounded-xl border border-ink-600 bg-ink-800 px-4 py-3 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-brand focus:ring-2 focus:ring-brand/20"
                />
              </label>

              {/* Screenshot */}

              <div className="mt-5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                  <label
                    htmlFor="deposit-proof"
                    className="text-sm font-semibold text-slate-200"
                  >
                    Payment screenshot
                  </label>

                  <span className="text-[11px] font-medium text-slate-400">
                    Optional if you provide a transaction ID
                  </span>
                </div>

                <label
                  htmlFor="deposit-proof"
                  className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-ink-600 bg-ink-900 px-4 py-7 text-center transition hover:border-brand/60 hover:bg-white/10"
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-full bg-ink-800 text-lg">
                    ↑
                  </span>

                  <span className="mt-3 text-sm font-semibold text-slate-200">
                    {proofFileName
                      ? proofFileName
                      : 'Upload payment screenshot'}
                  </span>

                  <span className="mt-1 max-w-xs text-xs leading-5 text-slate-500">
                    JPG, PNG or other image. Maximum
                    1.8 MB.
                  </span>

                  <input
                    id="deposit-proof"
                    type="file"
                    accept="image/*"
                    onChange={
                      handleProofChange
                    }
                    className="sr-only"
                  />
                </label>

                {proofDataUrl && (
                  <div className="mt-3 overflow-hidden rounded-xl border border-emerald-500/40 bg-emerald-950/50 px-3 py-2 text-xs font-medium text-emerald-300">
                    Screenshot selected successfully.
                  </div>
                )}
              </div>

              {/* Requirement info */}

              <div className="mt-5 rounded-xl border border-blue-500/40 bg-blue-950/50 p-4">
                <p className="text-xs font-bold text-blue-300">
                  Verification requirement
                </p>

                <p className="mt-1 text-xs leading-5 text-blue-300">
                  Transaction ID OR Payment Screenshot is
                  required. Provide at least one: a
                  transaction ID, a screenshot, or both.
                </p>
              </div>

              {/* Summary */}

              <div className="mt-5 rounded-xl bg-ink-900 p-4">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-sm text-slate-500">
                    Deposit amount
                  </span>

                  <span className="text-lg font-bold text-slate-100">
                    {currencySymbol(
                      currency,
                    )}
                    {formattedAmount}
                  </span>
                </div>

                <div className="mt-2 flex items-center justify-between gap-4">
                  <span className="text-sm text-slate-500">
                    Payment method
                  </span>

                  <span className="max-w-[55%] truncate text-right text-sm font-semibold text-slate-200">
                    {selectedMethod
                      ?.displayName ??
                      'Not selected'}
                  </span>
                </div>
              </div>

              {/* Submit-context error (Part 5): stays in place, values kept,
                  button restored by `finally` — retry is one click away. */}
              {formError && (
                <div
                  role="alert"
                  className="mt-5 rounded-xl border border-red-500/40 bg-red-950/50 px-4 py-3 text-sm font-medium leading-5 text-red-300"
                >
                  {formError}
                </div>
              )}

              <button
                type="submit"
                disabled={
                  submitting ||
                  loadingMethods ||
                  !canSubmit
                }
                className="mt-5 w-full rounded-xl bg-brand px-4 py-3.5 text-sm font-bold text-ink-950 transition hover:bg-brand-dark disabled:cursor-not-allowed disabled:bg-ink-700 disabled:text-slate-400"
              >
                {submitting
                  ? 'Submitting...'
                  : 'Submit Deposit'}
              </button>
            </form>
            )}
          </section>

          {/* ================================================================= */}
          {/* RIGHT                                                              */}
          {/* ================================================================= */}

          <aside className="min-w-0 space-y-5">
            {/* Selected summary */}

            <div className="rounded-2xl border border-white/10 bg-ink-800 p-4 sm:p-5">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                Current selection
              </p>

              <div className="mt-4 flex items-center gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand/15 text-lg font-bold text-brand">
                  {currencySymbol(
                    currency,
                  )}
                </span>

                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-100">
                    {currencyInfo.name}
                  </p>

                  <p className="mt-0.5 text-xs text-slate-500">
                    {currency}
                  </p>
                </div>
              </div>

              <div className="mt-4 border-t border-white/5 pt-4">
                <p className="text-xs text-slate-500">
                  Payment method
                </p>

                <p className="mt-1 truncate text-sm font-semibold text-slate-100">
                  {selectedMethod
                    ?.displayName ??
                    'Select a method'}
                </p>
              </div>
            </div>

            {/* How it works */}

            <div className="rounded-2xl border border-white/10 bg-ink-800 p-4 sm:p-5">
              <h3 className="text-sm font-bold text-slate-100">
                How it works
              </h3>

              <div className="mt-4 space-y-4">
                <Step
                  number="1"
                  title="Choose currency"
                  text="Select BDT, USD or EUR."
                />

                <Step
                  number="2"
                  title="Choose payment method"
                  text="Select bKash, Nagad, Rocket, Bank or Card when available."
                />

                <Step
                  number="3"
                  title="Make payment"
                  text="Pay using the account information shown above."
                />

                <Step
                  number="4"
                  title="Submit proof"
                  text="Enter your transaction ID or upload a payment screenshot."
                />

                <Step
                  number="5"
                  title="Admin verification"
                  text="Your deposit is credited after successful verification."
                />
              </div>
            </div>

            {/* Recent deposits */}

            <div className="rounded-2xl border border-white/10 bg-ink-800 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold text-slate-100">
                  Recent deposits
                </h3>

                {loadingHistory && (
                  <span className="text-[11px] text-slate-400">
                    Loading...
                  </span>
                )}
              </div>

              {history.length === 0 ? (
                <div className="mt-4 rounded-xl bg-ink-900 px-4 py-6 text-center">
                  <p className="text-xs text-slate-500">
                    No manual deposits yet.
                  </p>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  {history.slice(0, 5).map(
                    (deposit) => (
                      <div
                        key={deposit.id}
                        className="min-w-0 rounded-xl border border-white/5 p-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-100">
                              {deposit.methodName}
                            </p>

                            <p className="mt-1 text-xs text-slate-500">
                              {deposit.currency}
                            </p>
                          </div>

                          <span
                            className={[
                              'shrink-0 rounded-full px-2 py-1 text-[10px] font-bold',
                              statusClass(
                                deposit.status,
                              ),
                            ].join(' ')}
                          >
                            {statusLabel(
                              deposit.status,
                            )}
                          </span>
                        </div>

                        <div className="mt-3 flex items-center justify-between gap-3">
                          <span className="text-xs text-slate-500">
                            Amount
                          </span>

                          <span className="text-sm font-bold text-slate-100">
                            {formatWalletAmount(
                              Number(
                                deposit.amount,
                              ),
                              deposit.currency,
                            )}
                          </span>
                        </div>

                        {deposit.referenceId && (
                          <p className="mt-2 truncate text-[11px] text-slate-400">
                            TX: {deposit.referenceId}
                          </p>
                        )}
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/* Small UI components                                                        */
/* -------------------------------------------------------------------------- */

function CopyableInfo({
  label,
  value,
  field,
  copiedField,
  onCopy,
}: {
  label: string;
  value: string;
  field: string;
  copiedField: string;
  onCopy: (
    value: string,
    field: string,
  ) => void;
}) {
  const copied = copiedField === field;

  return (
    <div className="rounded-xl border border-white/10 bg-ink-900 p-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {label}
          </p>

          <p className="mt-1 break-all text-sm font-bold text-slate-100">
            {value}
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            onCopy(value, field)
          }
          className="shrink-0 rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 text-xs font-bold text-slate-300 transition hover:border-brand/60 hover:text-white"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

function Step({
  number,
  title,
  text,
}: {
  number: string;
  title: string;
  text: string;
}) {
  return (
    <div className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand/15 text-xs font-bold text-brand">
        {number}
      </span>

      <div className="min-w-0">
        <p className="text-xs font-bold text-slate-100">
          {title}
        </p>

        <p className="mt-1 text-xs leading-5 text-slate-500">
          {text}
        </p>
      </div>
    </div>
  );
}
