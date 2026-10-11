/**
 * Auth module — centralized authentication context for the TANVIONROYALE web app.
 *
 * Provides:
 * - `AuthProvider` — React context provider that manages auth state
 * - `useAuth()` — hook to access auth state and actions
 * - `StoredSession`, `AuthState`, `AuthActions`, `AuthContextValue` — types
 *
 * The provider uses the existing localStorage-based session store
 * (`@/lib/auth/session`) and the existing API client (`@/lib/api/client`).
 */

export { AuthProvider, useAuth } from './AuthProvider';
export type { StoredSession, AuthState, AuthActions, AuthContextValue } from './AuthProvider';
