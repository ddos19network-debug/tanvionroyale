/**
 * User account lifecycle status.
 *
 * SUSPENDED is a temporary/reviewable state (admin can unsuspend); BANNED is
 * the permanent/severe state (ToS violation, fraud — admin must deliberately
 * unban). Both block sign-in and every authenticated request.
 */
export enum UserStatus {
  PENDING = 'PENDING',
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  BANNED = 'BANNED',
  LOCKED = 'LOCKED',
  CLOSED = 'CLOSED',
}

/**
 * Identity verification state.
 */
export enum KycStatus {
  NOT_STARTED = 'NOT_STARTED',
  PENDING = 'PENDING',
  VERIFIED = 'VERIFIED',
  REJECTED = 'REJECTED',
  EXPIRED = 'EXPIRED',
  MANUAL_REVIEW = 'MANUAL_REVIEW',
}

/**
 * RBAC roles available in TanvionRoyale.
 */
export enum RoleName {
  SUPER_ADMIN = 'SUPER_ADMIN',
  ADMIN = 'ADMIN',
  FINANCE = 'FINANCE',
  SUPPORT = 'SUPPORT',
  COMPLIANCE = 'COMPLIANCE',
  CONTENT_MANAGER = 'CONTENT_MANAGER',
  ANALYST = 'ANALYST',
}

/**
 * Public shape of a user as serialized to the frontend.
 * Passwords and sensitive internal fields are intentionally omitted.
 */
export interface PublicUser {
  id: string;
  email: string;
  username: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  country: string | null;
  timezone: string;
  status: UserStatus;
  emailVerified: boolean;
  phoneVerified: boolean;
  kycStatus: KycStatus;
  createdAt: string;
  updatedAt: string;
}