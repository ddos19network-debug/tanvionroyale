import { z } from 'zod';

// ---------------------------------------------------------------------------
// P2P Crypto Marketplace + Royale Pay validation (shared).
// Money amounts are integer MINOR UNITS; never floats.
// Backend ALWAYS revalidates server-side and never trusts frontend amounts.
// ---------------------------------------------------------------------------

export const p2pSymbolSchema = z.enum(['USDT', 'BTC', 'ETH', 'BNB']);
export type P2PSymbolInput = z.infer<typeof p2pSymbolSchema>;

export const p2pFiatSchema = z.enum(['BDT', 'USD', 'EUR']);
export type P2PFiatInput = z.infer<typeof p2pFiatSchema>;

export const p2pOrderSideSchema = z.enum(['BUY', 'SELL']);
export type P2POrderSideInput = z.infer<typeof p2pOrderSideSchema>;

export const p2pPaymentMethodSchema = z.enum([
  'bkash',
  'nagad',
  'rocket',
  'upay',
  'bank',
  'royale-pay',
]);
export type P2PPaymentMethodInput = z.infer<typeof p2pPaymentMethodSchema>;

export const p2pOrderStatusSchema = z.enum([
  'CREATED',
  'PAYMENT_PENDING',
  'PAYMENT_SUBMITTED',
  'PAYMENT_VERIFICATION_PENDING',
  'PROCESSING',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
  'DISPUTED',
  'REFUNDED',
  'FAILED',
]);
export type P2POrderStatusInput = z.infer<typeof p2pOrderStatusSchema>;

/** Public offer listing filters. Amounts are fiat minor units. */
export const p2pFilterQuerySchema = z
  .object({
    symbol: p2pSymbolSchema.optional(),
    fiat: p2pFiatSchema.optional(),
    side: p2pOrderSideSchema.optional(),
    paymentMethod: p2pPaymentMethodSchema.optional(),
    minAmount: z.coerce.number().int().nonnegative().optional(),
    maxAmount: z.coerce.number().int().nonnegative().optional(),
    sortBy: z.enum(['price', 'available', 'relevance']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();
export type P2PFilterInput = z.infer<typeof p2pFilterQuerySchema>;

/** Create a P2P order. idempotencyKey prevents duplicate orders. */
export const createP2POrderSchema = z
  .object({
    symbol: p2pSymbolSchema,
    fiat: p2pFiatSchema,
    side: p2pOrderSideSchema,
    /** Fiat minor units the buyer pays (or seller receives). */
    fiatAmount: z.number().int().positive(),
    /** Crypto base units. */
    cryptoAmount: z.number().int().positive(),
    pricePerFiatUnit: z.number().int().positive(),
    offerId: z.string().uuid(),
    paymentMethod: p2pPaymentMethodSchema,
    idempotencyKey: z.string().min(8).max(128),
  })
  .strict();
export type CreateP2POrderInput = z.infer<typeof createP2POrderSchema>;

/** Submit payment evidence for an order. */
export const submitP2PPaymentSchema = z
  .object({
    orderId: z.string().uuid(),
    method: p2pPaymentMethodSchema,
    reference: z.string().min(1).max(255).optional().or(z.literal('')),
    proofUrl: z.string().url().optional().or(z.literal('')),
  })
  .strict();
export type SubmitP2PPaymentInput = z.infer<typeof submitP2PPaymentSchema>;

/** Cancel an order (owner only, before payment verification). */
export const cancelP2POrderSchema = z
  .object({
    orderId: z.string().uuid(),
    reason: z.string().min(1).max(500).optional(),
  })
  .strict();
export type CancelP2POrderInput = z.infer<typeof cancelP2POrderSchema>;

/** Order history query. */
export const listP2POrdersQuerySchema = z
  .object({
    status: p2pOrderStatusSchema.optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();
export type ListP2POrdersQueryInput = z.infer<typeof listP2POrdersQuerySchema>;