'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

import { useAuth } from '@/src/lib/auth';
import { describeApiError } from '@/lib/api/client';
import {
  formatWalletAmount,
  getWalletBalance,
  type WalletCurrencyCode,
} from '@/lib/api/wallet';

/**
 * Header real-money balance chip.
 *
 * Section 5 requires a clearly visible real-money balance in the header /
 * account dropdown area. This is deliberately a SEPARATE, self-contained
 * component so the already-large AppHeader does not gain balance-fetching
 * logic, and so the fetch only ever runs for a signed-in user.
 *
 * Honesty rules enforced here:
 *
 *   - The figure is ONLY ever written from a real `GET /wallet/balance`
 *     response. Nothing is computed client-side and no stake/payout is applied
 *     locally, so it cannot claim a balance the server has not confirmed.
 *   - A failed request renders an explicit error affordance, NOT a zero. A
 *     fabricated "৳0.00" would read as "you have no money" about a request that
 *     never succeeded.
 *   - It only fetches once `isAuthenticated` is true, so an unauthenticated
 *     visitor never triggers a wallet request and never sees someone else's
 *     balance (the endpoint itself is additionally owner-scoped server-side).
 *
 * FREE-PLAY points are intentionally NOT shown here: they are a separate
 * ledger with no cash value, and mixing them into a header money chip would
 * misrepresent them as funds.
 */
export function HeaderBalance() {
  const { ready, isAuthenticated } = useAuth();

  const [currency] = useState<WalletCurrencyCode>('BDT');

  const [balanceMinor, setBalanceMinor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);

    try {
      const balance = await getWalletBalance(currency);

      setBalanceMinor(Number(balance?.availableBalance ?? 0));
      setError(null);
    } catch (err) {
      // Never substitute a zero for a request that failed.
      setBalanceMinor(null);
      setError(describeApiError(err));
    } finally {
      setLoading(false);
    }
  }, [currency]);

  useEffect(() => {
    // Only ever fetch for a resolved, signed-in session.
    if (!ready || !isAuthenticated) {
      setBalanceMinor(null);
      setError(null);
      return;
    }

    void load();
  }, [ready, isAuthenticated, load]);

  /*
   * A confirmed balance-changing action elsewhere in the app
   * (`window.dispatchEvent(new CustomEvent('app:wallet-changed'))`, matching
   * the app's existing `app:*` event vocabulary) reconciles the header without
   * a full page reload. The handler re-reads the authoritative value rather
   * than applying a local delta, so the chip can never show an unconfirmed
   * figure.
   */
  useEffect(() => {
    const onWalletChanged = (): void => {
      if (ready && isAuthenticated) void load();
    };

    window.addEventListener('app:wallet-changed', onWalletChanged);

    return () => {
      window.removeEventListener('app:wallet-changed', onWalletChanged);
    };
  }, [ready, isAuthenticated, load]);

  if (!ready || !isAuthenticated) {
    return null;
  }

  return (
    <Link
      href="/wallet"
      className="flex min-w-0 items-center gap-1.5 rounded-full border border-white/10 bg-ink-800 px-2.5 py-1.5 text-xs text-slate-200 transition hover:border-brand/60 hover:text-white focus:outline-none focus:ring-2 focus:ring-brand/40"
      data-testid="header-balance"
      title={error ?? 'Your available real-money balance'}
    >
      <span aria-hidden className="text-slate-400">
        ৳
      </span>

      <span className="tabular-nums font-semibold">
        {loading
          ? '…'
          : error || balanceMinor === null
            ? 'Unavailable'
            : formatWalletAmount(balanceMinor, currency)}
      </span>
    </Link>
  );
}
