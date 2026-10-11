import { z } from 'zod';

const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Shared catalog status enum. */
export const catalogStatusSchema = z.enum(['ACTIVE', 'INACTIVE']);
export type CatalogStatusInput = z.infer<typeof catalogStatusSchema>;

export const slugSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(SLUG_REGEX, 'Slug may only contain lowercase letters, numbers and hyphens');

// ---------------------------------------------------------------------------
// Sports
// ---------------------------------------------------------------------------

export const createSportSchema = z
  .object({
    name: z.string().min(1).max(64),
    slug: slugSchema,
    description: z.string().max(1000).optional(),
    icon: z.string().max(256).optional(),
    status: catalogStatusSchema.optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();
export type CreateSportInput = z.infer<typeof createSportSchema>;

export const updateSportSchema = createSportSchema.partial();
export type UpdateSportInput = z.infer<typeof updateSportSchema>;

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

export const createGameSchema = z
  .object({
    sportId: z.string().uuid('A valid sportId is required'),
    name: z.string().min(1).max(64),
    slug: slugSchema,
    description: z.string().max(1000).optional(),
    status: catalogStatusSchema.optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();
export type CreateGameInput = z.infer<typeof createGameSchema>;

export const updateGameSchema = createGameSchema
  .partial()
  .omit({ sportId: true })
  .extend({ sportId: z.string().uuid('A valid sportId is required').optional() });
export type UpdateGameInput = z.infer<typeof updateGameSchema>;

// ---------------------------------------------------------------------------
// Gambling availability (default-safe: false unless explicitly enabled)
// ---------------------------------------------------------------------------

export const updateGameAvailabilitySchema = z
  .object({
    gamblingEnabled: z.boolean(),
  })
  .strict();
export type UpdateGameAvailabilityInput = z.infer<typeof updateGameAvailabilitySchema>;

// ---------------------------------------------------------------------------
// Provider mapping (existing operator-provider abstraction terminology)
// ---------------------------------------------------------------------------

export const upsertProviderMappingSchema = z
  .object({
    providerName: z.string().min(1).max(64),
    externalGameId: z.string().min(1).max(128),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .strict();
export type UpsertProviderMappingInput = z.infer<typeof upsertProviderMappingSchema>;
