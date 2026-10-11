/** Shape attached to requests by the JWT auth guard. */
export interface AuthenticatedUser {
  id: string;
  sessionId: string;
  roles: string[];
  /**
   * Authentication context of the backing Session row (authoritative — read
   * from the database on every request, never from a token claim).
   * JwtAuthGuard ALWAYS sets it; optional on the type only so service-level
   * test literals stay assignable. RolesGuard fails CLOSED: anything that is
   * not exactly 'STAFF' (including undefined) is refused on every
   * ADMIN/SUPER_ADMIN route, so a customer session can never authenticate an
   * admin API call — even after the account is promoted mid-session.
   */
  sessionKind?: 'CUSTOMER' | 'STAFF';
  /**
   * Effective permissions loaded from the authoritative User/Role rows on
   * every request. Optional only for legacy service-level test literals;
   * JwtAuthGuard always attaches it for real HTTP requests.
   */
  permissions?: string[];
  /** True only for an allowlisted Master Admin identity. */
  isMasterAdmin?: boolean;
}
