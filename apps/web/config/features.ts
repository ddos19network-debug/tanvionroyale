/**
 * Centralised FRONTEND feature flags.
 *
 * Single source of truth for user-facing UI that is present in the codebase but
 * intentionally switched off. Import these constants instead of scattering
 * `if (false)` checks through components, so the feature can be turned back on
 * by flipping ONE value here.
 *
 * IMPORTANT — these flags only control what the CUSTOMER SEES. They never
 * touch the backend: the betting APIs, settlement service, wallet ledgers,
 * crash engine, WebSocket feed and admin tooling all stay exactly as they are.
 */

/**
 * Bet Slip (sports betting checkout panel) visibility.
 *
 * `false` currently: the temporary Bet Slip UI is hidden site-wide (the
 * floating/floating-bottom widget, the "Add to Bet Slip" action, the profile
 * "Bet Slip" tab and every piece of Bet Slip copy).
 *
 * The backend betting architecture (POST /bets, odds validation, settlement,
 * wallet transactions, /my-bets, admin betting screens) is NOT disabled — the
 * client-side API layer (`lib/api/betting.ts`) and the BetSlip provider/context
 * stay mounted so flipping this flag to `true` restores the existing flow with
 * no backend change.
 */
export const BET_SLIP_ENABLED = false;