import { z } from 'zod';

// ---------------------------------------------------------------------------
// Wallet domain (Phase 6) shared validation.
// Money is validated as integer MINOR UNITS; never floats.
// These schemas mirror the class-validator DTOs — the backend ALWAYS
// revalidates server-side and never trusts frontend amounts/status.
// ---------------------------------------------------------------------------

export const walletTransactionTypeSchema = z.enum([
  'DEPOSIT',
  'WITHDRAWAL',
  'BET_STAKE',
  'BET_PAYOUT',
  'BET_REFUND',
  'ADJUSTMENT',
]);

export const walletTransactionStatusSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'REVERSED',
]);

export const walletStatusFilterSchema = z.enum([
  'ALL',
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

/** ISO 4217 currencies currently supported by the wallet (BDT default). */
export const supportedWalletCurrencySchema = z.enum(['BDT', 'USD', 'EUR']);

/** A deposit request. Amount is minor units (e.g. 1050 = BDT 10.50). */
export const createDepositSchema = z
  .object({
    amount: z.number().int('Amount must be an integer in minor units').min(1),
    currency: supportedWalletCurrencySchema.default('BDT'),
    idempotencyKey: z.string().min(8).max(128),
  })
  .strict();
export type CreateDepositInput = z.infer<typeof createDepositSchema>;

/** A withdrawal request. Amount is minor units. */
export const createWithdrawalSchema = createDepositSchema;
export type CreateWithdrawalInput = z.infer<typeof createWithdrawalSchema>;

export const listWalletTransactionsQuerySchema = z
  .object({
    status: walletStatusFilterSchema.optional(),
    type: walletTransactionTypeSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();
export type ListWalletTransactionsQueryInput = z.infer<typeof listWalletTransactionsQuerySchema>;

/** Admin wallet adjustment (RBAC ADMIN; requires a reason + idempotency key). */
export const walletAdjustmentSchema = z
  .object({
    /** Signed minor units: positive credits, negative debits. */
    amount: z.number().int().refine((v) => v !== 0, 'amount must not be zero'),
    currency: supportedWalletCurrencySchema.default('BDT'),
    reason: z.string().min(3).max(500),
    idempotencyKey: z.string().min(8).max(128),
  })
  .strict();
export type WalletAdjustmentInput = z.infer<typeof walletAdjustmentSchema>;
