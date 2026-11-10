'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';

const ITEMS = [
  { href: '/', label: 'Home', icon: 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1v-9z' },
  { href: '/games', label: 'Games', icon: 'M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z' },
  { href: '/sports', label: 'Sports', icon: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 4a6 6 0 1 1 0 12 6 6 0 0 1 0-12z' },
  { href: '/trading', label: 'Trading', icon: 'M3 17l6-6 4 4 8-8M15 7h6v6', target: '_blank', rel: 'noopener noreferrer' },
  { href: '/profile', label: 'Profile', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z' },
];

/**
 * Mobile-only bottom navigation (hidden at sm+ via CSS breakpoints).
 * The user-panel pages add the bottom padding so it never covers page
 * content.
 *
 * MOBILE BOTTOM NAVIGATION VISIBILITY
 * -----------------------------------
 *
 * Behaviour (identical timing to the mobile top header in
 * components/layout/app-header.tsx, mirrored here on purpose so the two
 * bars move together):
 *
 * 1. At the top of the page:
 *      Nav is visible.
 *
 * 2. When scrolling starts:
 *      Nav immediately moves below the viewport.
 *
 * 3. During Android/iOS momentum scrolling:
 *      Nav remains hidden.
 *
 * 4. When scrolling completely stops:
 *      Nav becomes visible again.
 *
 * 5. Desktop/tablet:
 *      Nav is always visible (moot — `sm:hidden` already
 *      removes it at that width).
 */
export function BottomNav() {
  const pathname = usePathname();

  const [hidden, setHidden] = useState(false);

  /*
   * Scroll-stop fallback timer.
   */
  const scrollStopTimerRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);

  /*
   * requestAnimationFrame prevents excessive React
   * state updates during high-frequency scrolling.
   */
  const scrollFrameRef =
    useRef<number | null>(null);

  /*
   * MOBILE BOTTOM NAVIGATION SCROLL CONTROL
   * =======================================
   *
   * The nav itself is fixed to the viewport.
   *
   * Every new scroll event hides it immediately and restarts
   * a 600ms fallback timer, so as long as Android Chrome keeps
   * generating momentum scroll events the nav cannot reappear.
   */
  useEffect(() => {
    /*
     * Clear pending fallback timer.
     */
    const clearScrollStopTimer = () => {
      if (
        scrollStopTimerRef.current !== null
      ) {
        clearTimeout(
          scrollStopTimerRef.current,
        );

        scrollStopTimerRef.current = null;
      }
    };

    /*
     * Show nav.
     */
    const showNav = () => {
      clearScrollStopTimer();

      setHidden(false);
    };

    /*
     * Hide nav immediately and schedule its return.
     */
    const handleScrolling = () => {
      /*
       * Desktop/tablet never uses auto-hide.
       */
      if (window.innerWidth >= 768) {
        showNav();
        return;
      }

      /*
       * At the very top, nav must be visible.
       */
      if (window.scrollY <= 2) {
        showNav();
        return;
      }

      /*
       * Page is currently being scrolled.
       */
      setHidden(true);

      /*
       * Every new scroll event resets the timer.
       *
       * Therefore, as long as Android Chrome keeps
       * generating momentum scroll events, the nav
       * cannot reappear.
       */
      clearScrollStopTimer();

      scrollStopTimerRef.current =
        setTimeout(() => {
          scrollStopTimerRef.current =
            null;

          /*
           * Only show after the page has actually stopped
           * moving.
           */
          if (window.innerWidth < 768) {
            setHidden(false);
          }
        }, 600);
    };

    /*
     * Throttle scroll processing to animation frames.
     */
    const handleScroll = () => {
      if (
        scrollFrameRef.current !== null
      ) {
        return;
      }

      scrollFrameRef.current =
        window.requestAnimationFrame(() => {
          scrollFrameRef.current = null;

          handleScrolling();
        });
    };

    /*
     * Modern browsers, including current Chromium,
     * provide scrollend.
     *
     * This fires after scrolling/momentum has ended.
     */
    const handleScrollEnd = () => {
      if (window.innerWidth < 768) {
        showNav();
      }
    };

    /*
     * Restore nav after responsive viewport changes.
     */
    const handleResize = () => {
      if (
        window.innerWidth >= 768 ||
        window.scrollY <= 2
      ) {
        showNav();
      }
    };

    /*
     * Listen to the real document/window scroll.
     */
    window.addEventListener(
      'scroll',
      handleScroll,
      {
        passive: true,
      },
    );

    /*
     * Listen for actual end of scrolling.
     */
    window.addEventListener(
      'scrollend',
      handleScrollEnd as EventListener,
    );

    /*
     * Handle screen rotation / viewport resize.
     */
    window.addEventListener(
      'resize',
      handleResize,
    );

    /*
     * Initial state.
     */
    if (
      window.innerWidth >= 768 ||
      window.scrollY <= 2
    ) {
      setHidden(false);
    }

    return () => {
      window.removeEventListener(
        'scroll',
        handleScroll,
      );

      window.removeEventListener(
        'scrollend',
        handleScrollEnd as EventListener,
      );

      window.removeEventListener(
        'resize',
        handleResize,
      );

      clearScrollStopTimer();

      if (
        scrollFrameRef.current !== null
      ) {
        window.cancelAnimationFrame(
          scrollFrameRef.current,
        );

        scrollFrameRef.current = null;
      }
    };
  }, []);

  /*
   * FIXED MOBILE BOTTOM NAV
   *
   * visible:
   *   translate-y-0
   *
   * hidden:
   *   translate-y-full
   *
   * The nav is pinned to the bottom, so it hides
   * DOWNWARD — the opposite direction from the top
   * header's -translate-y-full.
   *
   * `sm:hidden` keeps the nav off every desktop/tablet
   * viewport regardless of the scroll state.
   */
  return (
    <nav
      aria-label="Mobile navigation"
      className={`fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden transition-transform duration-200 ease-out ${
        hidden
          ? 'translate-y-full'
          : 'translate-y-0'
      }`}
    >
      <ul className="mx-auto flex max-w-lg">
        {ITEMS.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                target={'target' in item ? (item as { target?: string }).target : undefined}
                rel={'rel' in item ? (item as { rel?: string }).rel : undefined}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition ${
                  active ? 'text-brand' : 'text-slate-400 hover:text-white'
                }`}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d={item.icon} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}