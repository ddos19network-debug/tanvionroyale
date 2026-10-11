/**
 * Embedded sportsbook (BIG SPORT) frontend API — WinHouse Model B.
 *
 * The browser NEVER talks to the provider for money and NEVER sees a wallet
 * credential: it asks the TANVION backend for a SHORT-LIVED signed launch token
 * (minted server-side per page load) plus the PUBLIC embed key and book origin.
 * Everything else — the wallet API key, the callback token, every balance
 * movement — stays server-side.
 */
import { authFetch } from './client';

/** Result of GET /winhouse/launch (see packages/types/src/winhouse.ts). */
export interface WinHouseLaunchView {
  provider: string;
  integration: 'SPORTS_IFRAME';
  product: 'SPORT';
  environment: 'sandbox' | 'production';
  /** PUBLIC embed key (`ifr_…`) — public by provider design. */
  embedKey: string;
  /** Book origin the loader/iframe is served from. */
  embedBaseUrl: string;
  /** Signed launch token — handed to the loader as `data-launch`. */
  launch: string;
  expiresAt: string;
  playerId: string;
  language: string;
  theme: 'dark' | 'light';
  /** Desktop frame height handed to the loader (`data-height`). */
  frameHeight: string;
  /** Our own mobile bottom-nav height in px (`data-bottom-gap`). */
  bottomGapPx: number;
}

/**
 * Mints the signed launch token for the signed-in player.
 *
 * Throws ApiClientError(503) when no embedded sportsbook is configured — the
 * caller then shows nothing rather than a broken or fake book.
 */
export function getWinHouseLaunch(): Promise<WinHouseLaunchView> {
  return authFetch<WinHouseLaunchView>('/winhouse/launch');
}
