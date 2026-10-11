import { z } from 'zod';

/** Editable profile fields (Phase 3). Identity/KYC fields are NOT editable here. */
export const updateProfileSchema = z
  .object({
    firstName: z.string().min(1).max(64).optional(),
    lastName: z.string().min(1).max(64).optional(),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/, 'Country must be an ISO 3166-1 alpha-2 code')
      .optional(),
    timezone: z.string().min(1).max(64).optional(),
    phone: z.string().min(6).max(24).optional(),
  })
  .strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Change password — requires the current password. */
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z.string().min(8).max(128),
  })
  .strict();

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
