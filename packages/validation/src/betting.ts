import { z } from 'zod';

// ---------------------------------------------------------------------------
// Betting domain (Phase 5) shared validation.
// Money is validated as integer MINOR UNITS; odds as decimal strings.
// ---------------------------------------------------------------------------

export const eventStatusSchema = z.enum(['SCHEDULED', 'LIVE', 'SUSPENDED', 'FINISHED', 'CANCELLED']);
export const marketStatusSchema = z.enum(['OPEN', 'SUSPENDED', 'CLOSED']);
export const selectionStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export const betStatusSchema = z.enum([
  'PENDING',
  'ACCEPTED',
  'REJECTED',
  'CANCELLED',
  'SETTLED',
  'VOID',
]);
export const betTypeSchema = z.enum(['SINGLE', 'MULTIPLE']);
export const betStatusFilterSchema = z.enum(['ALL', 'PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'SETTLED', 'VOID']);

/** A decimal odds value, up to 2 decimal places (e.g. "1.85", "2", "3.4"). */
export const oddsStringSchema = z.string().regex(/^\d+(\.\d{1,2})?$/, 'Odds must be a decimal string such as "1.85"');

/** ISO 4217 uppercase currency code (wallet-supported: BDT/USD/EUR). */
export const currencySchema = z
  .string()
  .length(3)
  .regex(/^[A-Z]{3}$/, 'Currency must be an ISO 4217 code (e.g. BDT)');

/** Idempotency key used to de-duplicate bet placement requests. */
export const idempotencyKeySchema = z.string().min(8).max(128);

/**
 * A single bet placement request. `stake` is always expressed in integer minor
 * units (e.g. poisha for BDT). SINGLE bets only.
 */
export const placeBetSchema = z
  .object({
    eventId: z.string().uuid('A valid eventId is required'),
    marketId: z.string().uuid('A valid marketId is required'),
    selectionId: z.string().uuid('A valid selectionId is required'),
    stake: z.number().int('Stake must be an integer in minor units').min(1),
    requestedOdds: oddsStringSchema,
    currency: currencySchema.default('BDT'),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export type PlaceBetInput = z.infer<typeof placeBetSchema>;

export const listBetsQuerySchema = z.object({
  status: betStatusFilterSchema.optional(),
}).strict();
export type ListBetsQueryInput = z.infer<typeof listBetsQuerySchema>;