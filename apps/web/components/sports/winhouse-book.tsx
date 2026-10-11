'use client';

/**
 * BIG SPORT — the embedded WinHouse sportsbook (provider-hosted book).
 *
 * WHY A COMPONENT AND NOT A RAW IFRAME
 * ------------------------------------
 * The provider's own loader (`embed.js`) is used, exactly as its documentation
 * requires: a hand-written iframe parks the book's fixed bottom tab bar and
 * betslip below the fold on phones. The loader keeps the frame the height that
 * is actually on screen and subtracts `data-bottom-gap` (the height of our own
 * fixed mobile bottom navigation) so nothing is covered.
 *
 * SECURITY / OWNERSHIP
 * --------------------
 *  - the launch token is minted SERVER-SIDE on every page load and expires in
 *    minutes; the browser only ever receives that token, the PUBLIC embed key
 *    and the book origin;
 *  - the wallet API key and the callback token are never sent to the browser —
 *    they authenticate the provider's wallet callbacks on the API;
 *  - money lives in the ONE TANVION wallet: every stake/payout the book makes is
 *    applied to WalletService and appears in the wallet UI and ledger.
 *
 * FAILURE BEHAVIOUR
 * -----------------
 * No configured provider (or an unreachable API) renders NOTHING: no fake book,
 * no invented matches and no broken frame. TANVION's own BIG SPORT content below
 * stays exactly as it was.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/src/lib/auth';
import { getWinHouseLaunch, type WinHouseLaunchView } from '@/lib/api/winhouse';

/** Container the provider loader paints the book into (data-target). */
export const WINHOUSE_BOOK_ELEMENT_ID = 'winhouse-book';

/** Minimal shape of the provider's loader global (`embed.js`). */
interface WinHouseEmbedGlobal {
  refit?: () => void;
  setLaunch?: (token: string) => void;
}

declare global {
  interface Window {
    WinHouseEmbed?: WinHouseEmbedGlobal;
  }
}

export function WinHouseBook() {
  const { ready, isAuthenticated } = useAuth();
  const [config, setConfig] = useState<WinHouseLaunchView | null>(null);
  const [failed, setFailed] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // 1) Mint the launch token server-side (per page load) and read the PUBLIC
  //    embed configuration. A 503 means "no embedded book is configured" and is
  //    deliberately NOT an error the visitor should see.
  useEffect(() => {
    if (!ready || !isAuthenticated) return;
    let cancelled = false;

    getWinHouseLaunch()
      .then((data) => {
        if (!cancelled) setConfig(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [ready, isAuthenticated]);

  // 2) Inject the provider loader exactly once the container exists.
  useEffect(() => {
    if (!config) return;
    const container = containerRef.current;
    if (!container) return;

    const script = document.createElement('script');
    script.src = `${config.embedBaseUrl}/embed.js`;
    script.async = true;
    // data-key — the PUBLIC embed key (never the wallet API key).
    script.dataset['key'] = config.embedKey;
    script.dataset['target'] = `#${WINHOUSE_BOOK_ELEMENT_ID}`;
    // data-height — desktop frame height; phones are sized by the loader.
    script.dataset['height'] = config.frameHeight;
    // data-bottom-gap — our fixed mobile bottom nav, subtracted on phones.
    script.dataset['bottomGap'] = String(config.bottomGapPx);
    // data-embed — hide the book's own top bar/left rail (we provide the chrome).
    script.dataset['embed'] = '1';
    script.dataset['lang'] = config.language;
    script.dataset['theme'] = config.theme;
    // data-launch — the signed, short-lived launch token (Model B SSO).
    script.dataset['launch'] = config.launch;

    container.appendChild(script);

    return () => {
      // Unmount safety: drop the loader and the frame it built. `refit()` is
      // only meaningful while the loader is alive.
      script.remove();
      container.querySelectorAll('iframe').forEach((frame) => frame.remove());
    };
  }, [config]);

  // 3) Keep the frame the height that is actually on screen: the mobile header
  //    hides/shows on scroll and the keyboard/orientation change the viewport.
  const refit = useCallback(() => {
    try {
      window.WinHouseEmbed?.refit?.();
    } catch {
      // The loader is a third party: a refit failure must never break the page.
    }
  }, []);

  useEffect(() => {
    if (!config) return;
    window.addEventListener('resize', refit);
    window.addEventListener('orientationchange', refit);
    return () => {
      window.removeEventListener('resize', refit);
      window.removeEventListener('orientationchange', refit);
    };
  }, [config, refit]);

  if (failed || !config) return null;

  return (
    <section
      aria-label="BIG SPORT sportsbook"
      className="mt-6 w-full overflow-hidden rounded-xl border border-white/10 bg-ink-900/40"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2 sm:px-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white sm:text-base">
            Sportsbook — {config.provider}
          </h2>
          <p className="text-xs text-slate-400">
            Live and pre-match odds opened by {config.provider} · balance taken from your TANVION wallet.
          </p>
        </div>
        <span className="rounded-full border border-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">
          {config.environment === 'production' ? 'Live' : 'Sandbox'}
        </span>
      </div>
      {/* No fixed height and no min-height here: the provider loader owns the
          frame sizing (a min-height taller than a phone screen is the classic
          "no tab bar / no betslip" bug). */}
      <div id={WINHOUSE_BOOK_ELEMENT_ID} ref={containerRef} className="w-full" />
    </section>
  );
}
