/**
 * Frontend wallet API.
 *
 * All wallet/payment requests go through the TANVIONROYALE backend.
 * The frontend never talks directly to bKash/Nagad/Rocket/Bank/Card gateways.
 *
 * Money entered by the user is converted from major units to integer minor
 * units before it is sent to the backend.
 */

import { authFetch } from './client';

import type {
  ManualDepositView,
  PaymentMethodView,
  WalletBalanceView,
  WalletCurrency,
  WalletTransactionView,
  WalletView,
  CreateWalletTransactionResponse,
  SubmitManualDepositResponse,
} from '@tanvion-royale/types';

export const WALLET_CURRENCIES = ['BDT', 'USD', 'EUR'] as const;

export type WalletCurrencyCode = (typeof WALLET_CURRENCIES)[number];

/* -------------------------------------------------------------------------- */
/* Wallet                                                                     */
/* -------------------------------------------------------------------------- */

export async function getWallet(): Promise<WalletView> {
  return authFetch<WalletView>('/wallet');
}

export async function getWalletBalance(
  currency?: WalletCurrencyCode,
): Promise<WalletBalanceView> {
  const params = new URLSearchParams();

  if (currency) {
    params.set('currency', currency);
  }

  const qs = params.toString();

  return authFetch<WalletBalanceView>(
    `/wallet/balance${qs ? `?${qs}` : ''}`,
  );
}

/* -------------------------------------------------------------------------- */
/* Transactions                                                               */
/* -------------------------------------------------------------------------- */

export interface WalletTransactionFilters {
  status?: string;
  type?: string;
  currency?: WalletCurrencyCode | string;
  limit?: number;
  page?: number;
  search?: string;
}

export async function listWalletTransactions(
  filters: WalletTransactionFilters = {},
): Promise<WalletTransactionView[]> {
  const params = new URLSearchParams();

  if (filters.status && filters.status !== 'ALL') {
    params.set('status', filters.status);
  }

  if (filters.type && filters.type !== 'ALL') {
    params.set('type', filters.type);
  }

  if (filters.currency) {
    params.set('currency', filters.currency);
  }

  if (filters.limit) {
    params.set('limit', String(filters.limit));
  }

  if (filters.page) {
    params.set('page', String(filters.page));
  }

  if (filters.search?.trim()) {
    params.set('search', filters.search.trim());
  }

  const qs = params.toString();

  return authFetch<WalletTransactionView[]>(
    `/wallet/transactions${qs ? `?${qs}` : ''}`,
  );
}

export async function getWalletTransaction(
  id: string,
): Promise<WalletTransactionView> {
  return authFetch<WalletTransactionView>(
    `/wallet/transactions/${encodeURIComponent(id)}`,
  );
}

/* -------------------------------------------------------------------------- */
/* Amount helpers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Converts a user-entered major-unit amount into integer minor units.
 *
 * Examples:
 *   "100"    -> 10000
 *   "10.50"  -> 1050
 *   "1,250"  -> 125000
 *
 * The backend remains the final authority for validation.
 */
export function toMinor(amountMajor: string): number {
  const normalized = (amountMajor || '')
    .replace(/,/g, '')
    .trim();

  if (!normalized) {
    return 0;
  }

  const parsed = Number.parseFloat(normalized);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.floor(parsed * 100);
}

/**
 * Converts integer minor units to a displayable major-unit string.
 */
export function fromMinor(amountMinor: number): string {
  if (!Number.isFinite(amountMinor)) {
    return '0.00';
  }

  return (amountMinor / 100).toFixed(2);
}

function newIdempotencyKey(): string {
  if (
    typeof crypto !== 'undefined' &&
    'randomUUID' in crypto
  ) {
    return crypto.randomUUID();
  }

  return `wallet-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 12)}`;
}

/* -------------------------------------------------------------------------- */
/* Gateway deposit / withdrawal                                               */
/* -------------------------------------------------------------------------- */

export interface CreateWalletTransactionInput {
  /** Major-unit amount entered by the user, e.g. "100.50". */
  amountMajor: string;

  /** Wallet currency. */
  currency?: WalletCurrencyCode;
}

export interface CreateWalletTransactionResult
  extends CreateWalletTransactionResponse {}

/**
 * Creates a gateway-backed deposit request.
 *
 * The actual payment provider is selected/configured by the backend.
 * This function does NOT call a payment gateway directly.
 */
export async function createDeposit(
  amountMajor: string,
  currency: WalletCurrencyCode = 'BDT',
): Promise<CreateWalletTransactionResult> {
  return authFetch<CreateWalletTransactionResult>('/wallet/deposits', {
    method: 'POST',
    body: JSON.stringify({
      amount: toMinor(amountMajor),
      currency,
      idempotencyKey: newIdempotencyKey(),
    }),
  });
}

/**
 * Creates a gateway-backed withdrawal request.
 *
 * The actual payment provider is selected/configured by the backend.
 */
export async function createWithdrawal(
  amountMajor: string,
  currency: WalletCurrencyCode = 'BDT',
): Promise<CreateWalletTransactionResult> {
  return authFetch<CreateWalletTransactionResult>('/wallet/withdrawals', {
    method: 'POST',
    body: JSON.stringify({
      amount: toMinor(amountMajor),
      currency,
      idempotencyKey: newIdempotencyKey(),
    }),
  });
}

/* -------------------------------------------------------------------------- */
/* Manual payment methods                                                     */
/* -------------------------------------------------------------------------- */

export interface ListPaymentMethodsOptions {
  currency?: WalletCurrencyCode;
  purpose?: 'deposit' | 'withdrawal';
}

/**
 * Gets active manual payment methods configured by Admin.
 *
 * Examples:
 *   bKash
 *   Nagad
 *   Rocket
 *   Bank
 *   Card
 *
 * Account numbers/instructions returned here are controlled by the backend.
 */
export async function listPaymentMethods(
  options: ListPaymentMethodsOptions = {},
): Promise<PaymentMethodView[]> {
  const params = new URLSearchParams();

  if (options.currency) {
    params.set('currency', options.currency);
  }

  if (options.purpose) {
    params.set('purpose', options.purpose);
  }

  const qs = params.toString();

  return authFetch<PaymentMethodView[]>(
    `/wallet/payment-methods${qs ? `?${qs}` : ''}`,
  );
}

/* -------------------------------------------------------------------------- */
/* Manual deposits                                                            */
/* -------------------------------------------------------------------------- */

export interface SubmitManualDepositInput {
  methodCode: string;
  currency: WalletCurrencyCode;

  /**
   * Major-unit amount entered by the user.
   * Example: "1000" or "1000.50".
   */
  amountMajor: string;

  /**
   * Optional payment transaction/reference ID.
   *
   * Screenshot OR transaction ID is enough.
   * Both can also be supplied.
   */
  referenceId?: string;

  /**
   * Optional screenshot encoded as a data URL.
   *
   * Example:
   * data:image/jpeg;base64,...
   */
  proofDataUrl?: string;
}

export async function submitManualDeposit(
  input: SubmitManualDepositInput,
): Promise<SubmitManualDepositResponse> {
  const referenceId = input.referenceId?.trim() || undefined;

  const proofDataUrl =
    input.proofDataUrl?.trim() || undefined;

  if (!referenceId && !proofDataUrl) {
    throw new Error(
      'Please provide a transaction ID or payment screenshot.',
    );
  }

  return authFetch<SubmitManualDepositResponse>(
    '/wallet/manual-deposits',
    {
      method: 'POST',
      body: JSON.stringify({
        methodCode: input.methodCode,
        currency: input.currency,
        amount: toMinor(input.amountMajor),
        referenceId,
        proofDataUrl,
        idempotencyKey: newIdempotencyKey(),
      }),
    },
  );
}

/**
 * Returns the current user's manual deposit history.
 */
export async function listMyManualDeposits(
  limit = 20,
): Promise<ManualDepositView[]> {
  const safeLimit = Math.min(
    Math.max(Math.floor(limit), 1),
    100,
  );

  return authFetch<ManualDepositView[]>(
    `/wallet/manual-deposits?limit=${safeLimit}`,
  );
}

/* -------------------------------------------------------------------------- */
/* Manual withdrawals                                                          */
/* -------------------------------------------------------------------------- */

export interface SubmitManualWithdrawalInput {
  methodCode: string;
  currency: WalletCurrencyCode;

  /** Major-unit amount entered by the user (converted to minor units). */
  amountMajor: string;

  /** Optional destination account number / mobile number. */
  accountNumber?: string;

  /** Optional account/payee holder name. */
  accountName?: string;

  /** Bank only. */
  bankName?: string;

  /** Bank only. */
  branch?: string;

  /** Bank only. */
  routingNumber?: string;
}

export interface ManualWithdrawalView {
  id: string;
  userId: string;
  methodId: string;
  methodCode: string;
  methodName: string;
  methodType: string;
  amount: number;
  currency: string;
  destinationAccount: string | null;
  destinationName: string | null;
  bankName: string | null;
  branch: string | null;
  routingNumber: string | null;
  status: string;
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  walletTransactionId: string | null;
  providerReference: string | null;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * POST /wallet/manual-withdrawals — submits a manual withdrawal request.
 * Funds are RESERVED server-side; the request stays PENDING for admin review.
 * Never completes or sends money from the frontend.
 */
export async function submitManualWithdrawal(
  input: SubmitManualWithdrawalInput,
): Promise<{ withdrawal: ManualWithdrawalView; wallet: WalletView }> {
  const parsed = Number.parseFloat(input.amountMajor.replace(/,/g, '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error('Enter a valid withdrawal amount greater than 0.');
  }
  return authFetch<{ withdrawal: ManualWithdrawalView; wallet: WalletView }>(
    '/wallet/manual-withdrawals',
    {
      method: 'POST',
      body: JSON.stringify({
        methodCode: input.methodCode,
        currency: input.currency,
        amount: toMinor(input.amountMajor),
        accountNumber: input.accountNumber?.trim() || undefined,
        accountName: input.accountName?.trim() || undefined,
        bankName: input.bankName?.trim() || undefined,
        branch: input.branch?.trim() || undefined,
        routingNumber: input.routingNumber?.trim() || undefined,
        idempotencyKey: newIdempotencyKey(),
      }),
    },
  );
}

/** GET /wallet/manual-withdrawals — current user's withdrawal history. */
export async function listMyManualWithdrawals(
  limit = 20,
): Promise<ManualWithdrawalView[]> {
  const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 100);
  return authFetch<ManualWithdrawalView[]>(`/wallet/manual-withdrawals?limit=${safeLimit}`);
}

/* -------------------------------------------------------------------------- */
/* Currency helpers                                                           */
/* -------------------------------------------------------------------------- */

export function isWalletCurrency(
  value: string,
): value is WalletCurrency {
  return (
    value === 'BDT' ||
    value === 'USD' ||
    value === 'EUR'
  );
}

export function currencySymbol(
  currency: WalletCurrencyCode | string,
): string {
  switch (currency) {
    case 'BDT':
      return '৳';

    case 'USD':
      return '$';

    case 'EUR':
      return '€';

    default:
      return currency;
  }
}

export function formatWalletAmount(
  amountMinor: number,
  currency: WalletCurrencyCode | string,
): string {
  const amount = fromMinor(amountMinor);

  return `${currencySymbol(currency)}${amount}`;
}
