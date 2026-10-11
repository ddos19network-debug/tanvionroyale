/**
 * A user session as visible to the account owner. Token hashes are
 * intentionally omitted — only metadata the user can reason about.
 */
export interface SessionInfo {
  id: string;
  ip: string | null;
  userAgent: string | null;
  createdAt: string;
  expiresAt: string;
  /** True when this is the session the request was made from. */
  current: boolean;
}
