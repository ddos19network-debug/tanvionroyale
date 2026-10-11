// ---------------------------------------------------------------------------
// Wallet / Transactions domain
//
// Money amounts are represented as integer units.
// Supported wallet currencies: BDT, USD, EUR.
// ---------------------------------------------------------------------------

import type { MinorUnit } from './money';

export const WALLET_CURRENCIES = ['BDT', 'USD', 'EUR'] as const;

export type WalletCurrency = (typeof WALLET_CURRENCIES)[number];

export type WalletStatus = 'ACTIVE' | 'FROZEN' | 'CLOSED';

/**
 * Payment method execution mode.
 *  - MANUAL  : user pays/receives externally; admin reviews the request.
 *  - GATEWAY : a real configured payment provider adapter drives the flow.
 */
export type PaymentMethodMode = 'MANUAL' | 'GATEWAY';

/**
 * USER REFERRAL PROGRAM — shared contract.
 *
 * Mirrors the Prisma enums in `database/prisma/schema.prisma` so the API, the
 * admin panel and the profile page all speak the same language. All amounts are
 * integer MINOR UNITS, like every other money value in the project.
 */

export type ReferralStatus = 'PENDING' | 'QUALIFIED' | 'REJECTED' | 'CANCELLED';

export type ReferralRewardRecipient = 'REFERRER' | 'REFERRED';

export type ReferralRewardStatus =
  | 'PENDING'
  | 'QUALIFIED'
  | 'PAID'
  | 'REJECTED'
  | 'CANCELLED';

export type ReferralBonusType = 'FIXED_AMOUNT' | 'PERCENTAGE';

export type ReferralQualificationRule =
  | 'REGISTRATION'
  | 'VERIFIED_ACCOUNT'
  | 'MIN_DEPOSIT'
  | 'MIN_WAGER'
  | 'DEPOSIT_AND_WAGER';

/** Admin-configured program settings (nothing about a reward is hard-coded). */
export interface ReferralSettingsView {
  isEnabled: boolean;
  currency: string;
  signupPath: string;
  referrerBonusType: ReferralBonusType;
  referrerBonusAmount: MinorUnit;
  referrerBonusPercent: number;
  referredBonusType: ReferralBonusType;
  referredBonusAmount: MinorUnit;
  referredBonusPercent: number;
  qualificationRule: ReferralQualificationRule;
  minDepositAmount: MinorUnit;
  minWagerAmount: MinorUnit;
  maxRewardPerReferral: MinorUnit;
  maxTotalRewardPerUser: MinorUnit | null;
  qualificationExpiresInDays: number | null;
  requireVerifiedAccount: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

/** The caller's own referral identity + headline numbers (own data only). */
export interface MyReferralSummary {
  referralCode: string;
  referralLink: string;
  programEnabled: boolean;
  /** The public, non-sensitive settings a player may see. */
  qualificationRule: ReferralQualificationRule;
  minDepositAmount: MinorUnit;
  minWagerAmount: MinorUnit;
  totalReferrals: number;
  activeReferrals: number;
  qualifiedReferrals: number;
  pendingReferrals: number;
  rejectedReferrals: number;
  totalEarned: MinorUnit;
  paidTotal: MinorUnit;
  availableTotal: MinorUnit;
  currency: string;
}

/**
 * One referred user as seen by THEIR referrer.
 *
 * PRIVACY: only a safe display identifier is exposed (username + a masked
 * email). Never a password, token, payment detail, phone number, IP or any
 * other private credential — this endpoint is scoped to the authenticated
 * caller and returns nobody else's data.
 */
export interface MyReferredUser {
  referralId: string;
  /** Stable public display identifier. */
  username: string;
  /** e.g. "t***e@example.com", or null when the account has no email. */
  maskedEmail: string | null;
  joinedAt: string;
  status: ReferralStatus;
  /** Minor units this referral has actually paid the referrer. */
  bonusEarned: MinorUnit;
  qualifiedAt: string | null;
  statusReason: string | null;
}

export interface ReferralRewardView {
  id: string;
  referralId: string;
  recipient: ReferralRewardRecipient;
  status: ReferralRewardStatus;
  amount: MinorUnit;
  currency: string;
  /** Short, non-sensitive label of who the reward paid (own referrals only). */
  username: string | null;
  createdAt: string;
  paidAt: string | null;
  statusReason: string | null;
}

/** Admin referral dashboard headline counters. */
export interface ReferralAdminStats {
  programEnabled: boolean;
  totalReferrers: number;
  totalReferredUsers: number;
  pendingReferrals: number;
  qualifiedReferrals: number;
  rejectedReferrals: number;
  cancelledReferrals: number;
  totalRewards: number;
  pendingRewardAmount: MinorUnit;
  paidRewardAmount: MinorUnit;
  rejectedRewardAmount: MinorUnit;
  currency: string;
}

export interface ReferralTopReferrer {
  userId: string;
  username: string;
  referralCode: string;
  referredCount: number;
  qualifiedCount: number;
  earnedTotal: MinorUnit;
}

export type WalletTransactionType =
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'BET_STAKE'
  | 'BET_PAYOUT'
  | 'BET_REFUND'
  | 'ADJUSTMENT'
  | 'REFERRAL_BONUS';

export type WalletTransactionStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REVERSED';

export type LedgerDirection = 'CREDIT' | 'DEBIT';

/**
 * A user's wallet for one currency.
 *
 * Balances are stored as integer units.
 */
export interface WalletView {
  id: string;
  userId: string;
  currency: WalletCurrency | string;
  availableBalance: MinorUnit;
  lockedBalance: MinorUnit;
  status: WalletStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * A wallet transaction as returned to its owner.
 */
export interface WalletTransactionView {
  id: string;
  walletId: string;
  userId: string;
  type: WalletTransactionType;
  status: WalletTransactionStatus;

  /**
   * Signed amount:
   * positive = credit
   * negative = debit
   */
  amount: MinorUnit;

  currency: WalletCurrency | string;

  reference: string | null;
  failureReason: string | null;

  createdAt: string;
  updatedAt: string;
}

/**
 * Response of GET /wallet/balance.
 */
export interface WalletBalanceView {
  currency: WalletCurrency | string;
  availableBalance: MinorUnit;
  lockedBalance: MinorUnit;
}

/**
 * Result of POST /wallet/deposits
 * and POST /wallet/withdrawals.
 */
export interface CreateWalletTransactionResponse {
  transaction: WalletTransactionView;
  wallet: WalletView;
  duplicate: boolean;
}

/**
 * Supported manual payment method types.
 */
export type ManualPaymentMethodType =
  | 'BKASH'
  | 'NAGAD'
  | 'ROCKET'
  | 'BANK'
  | 'CARD'
  | 'OTHER';

/**
 * Manual payment method status.
 */
export type PaymentMethodStatus =
  | 'ACTIVE'
  | 'INACTIVE'
  | 'ARCHIVED';

/**
 * Manual deposit request status.
 */
export type ManualDepositStatus =
  | 'PENDING'
  | 'UNDER_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'CANCELLED';

/**
 * Payment method information shown to users.
 *
 * Sensitive gateway credentials must NEVER be returned
 * through this interface.
 */
export interface PaymentMethodView {
  id: string;
  code: string;
  displayName: string;
  /**
   * Execution mode of the method: MANUAL or GATEWAY.
   * (Legacy serializers that only emitted manual methods are updated to
   * always include it; the column/`type` field maps directly to it.)
   */
  type: 'MANUAL' | 'GATEWAY' | string;
  status: PaymentMethodStatus | string;

  supportedCurrencies: WalletCurrency[];

  depositEnabled: boolean;
  withdrawalEnabled: boolean;

  gatewayConfigId?: string | null;
  gatewayName?: string | null;

  accountNumber: string | null;
  accountName: string | null;
  bankName: string | null;
  branch: string | null;
  routingNumber: string | null;

  instructions: string | null;

  minDeposit: MinorUnit | null;
  maxDeposit: MinorUnit | null;

  minWithdrawal: MinorUnit | null;
  maxWithdrawal: MinorUnit | null;

  requireTransactionId: boolean;
  requireProof: boolean;

  sortOrder: number;

  createdAt: string;
  updatedAt: string;
}

/**
 * Payment gateway config as returned to admins (secrets masked).
 *
 * Raw secrets are NEVER exposed — only boolean *Set flags.
 */
export interface PaymentGatewayView {
  id: string;
  name: string;
  code: string;
  providerType: string;
  baseUrl: string;
  status: string;
  apiKeySet: boolean;
  apiSecretSet: boolean;
  webhookSecretSet: boolean;
  authMode: string | null;
  apiVersion: string | null;
  timeoutMs: number;
  supportedCurrencies: string[];
  depositEnabled: boolean;
  withdrawalEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Manual deposit request returned to the user.
 *
 * Proof/screenshot data itself is not returned here.
 */
export interface ManualDepositView {
  id: string;
  userId: string;

  methodId: string;
  methodCode: string;
  methodName: string;

  amount: MinorUnit;
  currency: WalletCurrency | string;

  referenceId: string | null;

  status: ManualDepositStatus;

  rejectionReason: string | null;

  reviewedBy: string | null;
  reviewedAt: string | null;

  transactionId: string | null;

  createdAt: string;
  updatedAt: string;
}

/**
 * Result of submitting a manual deposit.
 */
export interface SubmitManualDepositResponse {
  deposit: ManualDepositView;
}

export type WithdrawalDestinationKind =
  | 'MOBILE_WALLET'
  | 'BANK'
  | 'CARD'
  | 'UNKNOWN';

export const MOBILE_WALLET_METHOD_CODES = [
  'bkash',
  'nagad',
  'rocket',
  'upay',
  'surecash',
  'mcash',
  'tapp',
] as const;

function normaliseMethodCode(
  code: string | null | undefined,
): string {
  return String(code ?? '').trim().toLowerCase();
}

export function resolveWithdrawalDestinationKind(
  code: string | null | undefined,
): WithdrawalDestinationKind {
  const normalised = normaliseMethodCode(code);
  if (!normalised) return 'UNKNOWN';
  if (
    (MOBILE_WALLET_METHOD_CODES as readonly string[]).includes(
      normalised,
    )
  ) {
    return 'MOBILE_WALLET';
  }
  if (normalised === 'bank') return 'BANK';
  if (normalised === 'card') return 'CARD';
  if (normalised.startsWith('bank-') || normalised.endsWith('-bank')) {
    return 'BANK';
  }
  return 'UNKNOWN';
}

export function isMobileWalletMethodCode(
  code: string | null | undefined,
): boolean {
  return resolveWithdrawalDestinationKind(code) === 'MOBILE_WALLET';
}

export function isBankMethodCode(
  code: string | null | undefined,
): boolean {
  return resolveWithdrawalDestinationKind(code) === 'BANK';
}

// ---------------------------------------------------------------------------
// Manual withdrawals
// ---------------------------------------------------------------------------
export type ManualWithdrawalStatus =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'COMPLETED'
  | 'CANCELLED';

/**
 * Withdrawal request as returned to its owner / admins.
 *
 * Destination details only contain the minimum required by the selected
 * payment method — never CVV/PIN/OTP/passwords/provider secrets.
 */
export interface WithdrawalRequestView {
  id: string;
  userId: string;
  methodId: string;
  methodCode: string;
  methodName: string;
  methodType: 'MANUAL' | 'GATEWAY' | string;

  amount: MinorUnit;
  currency: WalletCurrency | string;

  destinationAccount: string | null;
  destinationName: string | null;
  bankName: string | null;
  branch: string | null;
  routingNumber: string | null;

  status: ManualWithdrawalStatus;
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;

  /** Set when the reservation/settlement wallet transaction exists. */
  walletTransactionId: string | null;
  providerReference: string | null;
  idempotencyKey: string;

  createdAt: string;
  updatedAt: string;
}

/**
 * Result of submitting a manual withdrawal.
 */
export interface SubmitManualWithdrawalResponse {
  withdrawal: WithdrawalRequestView;
  /** Wallet right after the balance reservation (amount locked). */
  wallet: WalletView;
}

export interface WithdrawalDestinationFields {
  kind: WithdrawalDestinationKind;
  requireAccountNumber: boolean;
  requireAccountName: boolean;
  requireBankName: boolean;
  requireBranch: boolean;
  requireRoutingNumber: boolean;
  allowBankName: boolean;
  allowBranch: boolean;
  allowRoutingNumber: boolean;
}

export function withdrawalDestinationFieldsFor(
  code: string | null | undefined,
  options?: {
    methodRoutingNumber?: string | null;
  },
): WithdrawalDestinationFields {
  const kind = resolveWithdrawalDestinationKind(code);
  if (kind === 'BANK') {
    const routingRequired =
      String(options?.methodRoutingNumber ?? '').trim().length > 0;
    return {
      kind,
      requireAccountNumber: true,
      requireAccountName: true,
      requireBankName: true,
      requireBranch: true,
      requireRoutingNumber: routingRequired,
      allowBankName: true,
      allowBranch: true,
      allowRoutingNumber: true,
    };
  }
  if (kind === 'CARD') {
    return {
      kind,
      requireAccountNumber: false,
      requireAccountName: false,
      requireBankName: false,
      requireBranch: false,
      requireRoutingNumber: false,
      allowBankName: false,
      allowBranch: false,
      allowRoutingNumber: false,
    };
  }
  return {
    kind,
    requireAccountNumber: true,
    requireAccountName: true,
    requireBankName: false,
    requireBranch: false,
    requireRoutingNumber: false,
    allowBankName: false,
    allowBranch: false,
    allowRoutingNumber: false,
  };
}

export function sanitiseWithdrawalDestinationForKind(
  kind: WithdrawalDestinationKind,
  destination: {
    accountNumber?: string | null;
    accountName?: string | null;
    bankName?: string | null;
    branch?: string | null;
    routingNumber?: string | null;
  },
): {
  accountNumber: string | null;
  accountName: string | null;
  bankName: string | null;
  branch: string | null;
  routingNumber: string | null;
} {
  const trimOrNull = (
    value: string | null | undefined,
  ): string | null => {
    const trimmed = String(value ?? '').trim();
    return trimmed ? trimmed : null;
  };
  if (kind === 'BANK') {
    return {
      accountNumber: trimOrNull(destination.accountNumber),
      accountName: trimOrNull(destination.accountName),
      bankName: trimOrNull(destination.bankName),
      branch: trimOrNull(destination.branch),
      routingNumber: trimOrNull(destination.routingNumber),
    };
  }
  return {
    accountNumber: trimOrNull(destination.accountNumber),
    accountName: trimOrNull(destination.accountName),
    bankName: null,
    branch: null,
    routingNumber: null,
  };
}

/** Manual-withdrawal destination fields accepted by the API. */
export interface WithdrawalDestinationInput {
  /** Mobile/account number (bKash/Nagad/Rocket/Bank). */
  accountNumber?: string;
  /** Account/payee holder name where the method requires it. */
  accountName?: string;
  /** Bank only. */
  bankName?: string;
  /** Bank only. */
  branch?: string;
  /** Bank only. */
  routingNumber?: string;
}

/**
 * Structured wallet error codes surfaced to clients.
 */
export type WalletErrorCode =
  | 'INVALID_AMOUNT'
  | 'UNSUPPORTED_CURRENCY'
  | 'AMOUNT_OUT_OF_RANGE'
  | 'WALLET_NOT_FOUND'
  | 'WALLET_FROZEN'
  | 'INSUFFICIENT_FUNDS'
  | 'INVALID_TRANSACTION_STATE'
  | 'DUPLICATE_REQUEST'
  | 'PROVIDER_UNAVAILABLE'
  | 'WITHDRAWAL_RESERVATION_CONFLICT'
  | 'WITHDRAWAL_RESERVATION_MISSING'
  | 'WITHDRAWAL_ALREADY_SETTLED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_ERROR';
