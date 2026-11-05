'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/src/lib/auth';
import { SearchOverlay } from '@/components/home/SearchOverlay';
import { LogoMark } from '@/components/brand/logo';
import { NavIcon } from '@/components/navigation/nav-icon';
import { UnreadBadge } from '@/components/notifications/unread-badge';
import { userNavSections } from '@/components/navigation/user-nav';
import type { UserNavItem } from '@/components/navigation/user-nav';

const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/sports', label: 'Sports' },
  { href: '/games', label: 'Games' },
  { href: '/trading', label: 'Trading' },
  { href: '/live', label: 'Live' },
  { href: '/promotions', label: 'Promotions' },
  { href: '/my-bets', label: 'My Bets' },
  { href: '/wallet', label: 'Wallet' },
  { href: '/support', label: 'Support' },
];

/*
 * Session-action icons for the bottom block of the mobile menu.
 *
 * Same 24x24 stroke / currentColor vocabulary as every icon in
 * components/navigation/user-nav.ts and components/navigation/bottom-nav.tsx,
 * rendered through <NavIcon> so they inherit the row's text colour.
 *
 *   PROFILE_ICON is the EXACT path the mobile bottom nav already uses for
 *   "Profile" (bottom-nav.tsx ITEMS) â€” reusing it verbatim keeps one icon for
 *   one destination instead of inventing a second look-alike.
 *
 *   LOGOUT_ICON is the sign-out glyph (door + outgoing arrow). There is no
 *   route behind it: it is an ACTION, not navigation.
 */
const PROFILE_ICON =
  'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z';
const LOGOUT_ICON =
  'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9';

export function AppHeader() {
  const router = useRouter();
  const { user, ready, isAuthenticated, logout } = useAuth();

  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [localUser, setLocalUser] = useState<typeof user>(null);
  const [localReady, setLocalReady] = useState(false);

  /*
   * Mobile top navigation visibility.
   *
   * Behaviour:
   *
   * 1. At the top of the page:
   *      Header is visible.
   *
   * 2. When scrolling starts:
   *      Header immediately moves above the viewport.
   *
   * 3. During Android/iOS momentum scrolling:
   *      Header remains hidden.
   *
   * 4. When scrolling completely stops:
   *      Header becomes visible again.
   *
   * 5. Desktop/tablet:
   *      Header is always visible.
   */
  const [mobileHeaderHidden, setMobileHeaderHidden] =
    useState(false);

  /*
   * Keep the latest mobile menu state available to the
   * scroll listener without recreating the listener.
   */
  const mobileMenuOpenRef =
    useRef(false);

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

  // Two-back exit confirmation state
  const [showExitConfirm, setShowExitConfirm] =
    useState(false);

  /*
   * Logout is an in-flight ACTION, not navigation, so it needs its own
   * single-flight guard.
   *
   * A REF, not the state value, is what actually stops a second request:
   * several taps dispatched in the SAME task all read the same stale
   * `loggingOut` closure (React batches state updates), so `if (loggingOut)`
   * would still let every one of them through. The ref is updated
   * synchronously, so the guard is correct even for a burst. `loggingOut`
   * state is kept purely to drive `disabled` / the "Logging outâ€¦" label.
   */
  const [loggingOut, setLoggingOut] = useState(false);
  const loggingOutRef = useRef(false);

  const [exitMessage, setExitMessage] =
    useState('Exit TANVION ROYALE?');

  const [firstBackTime, setFirstBackTime] =
    useState<number | null>(null);

  /*
   * Keep the mobile-menu ref synchronized.
   */
  useEffect(() => {
    mobileMenuOpenRef.current =
      mobileMenuOpen;

    /*
     * The header must stay visible while the mobile
     * navigation drawer/menu is open.
     */
    if (mobileMenuOpen) {
      setMobileHeaderHidden(false);
    }
  }, [mobileMenuOpen]);

  /*
   * Sync auth state.
   */
  useEffect(() => {
    if (ready) {
      setLocalUser(user);
      setLocalReady(true);
    }
  }, [ready, user]);

  /*
   * MOBILE TOP NAVIGATION SCROLL CONTROL
   * ====================================
   *
   * IMPORTANT:
   *
   * The header itself is fixed to the viewport.
   *
   * This avoids the unreliable combination of:
   *
   *      position: sticky
   *      +
   *      transform
   *
   * that can behave differently on Android Chrome.
   *
   * We keep a spacer in the document where the header
   * normally occupies its space.
   *
   * Scroll behaviour:
   *
   *      scroll starts
   *          â†“
   *      header hides
   *          â†“
   *      momentum scrolling continues
   *          â†“
   *      header stays hidden
   *          â†“
   *      scroll stops
   *          â†“
   *      header shows
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
     * Show header.
     */
    const showHeader = () => {
      clearScrollStopTimer();

      setMobileHeaderHidden(false);
    };

    /*
     * Hide header immediately and schedule its return.
     */
    const handleScrolling = () => {
      /*
       * Desktop/tablet never uses auto-hide.
       */
      if (window.innerWidth >= 768) {
        showHeader();
        return;
      }

      /*
       * Keep header visible while mobile menu is open.
       */
      if (mobileMenuOpenRef.current) {
        showHeader();
        return;
      }

      /*
       * At the very top, header must be visible.
       */
      if (window.scrollY <= 2) {
        showHeader();
        return;
      }

      /*
       * Page is currently being scrolled.
       */
      setMobileHeaderHidden(true);

      /*
       * Every new scroll event resets the timer.
       *
       * Therefore, as long as Android Chrome keeps
       * generating momentum scroll events, the header
       * cannot reappear.
       */
      clearScrollStopTimer();

      scrollStopTimerRef.current =
        setTimeout(() => {
          scrollStopTimerRef.current =
            null;

          /*
           * Only show after the page has actually stopped
           * moving and the menu isn't open.
           */
          if (
            window.innerWidth < 768 &&
            !mobileMenuOpenRef.current
          ) {
            setMobileHeaderHidden(false);
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
      if (
        window.innerWidth < 768 &&
        !mobileMenuOpenRef.current
      ) {
        showHeader();
      }
    };

    /*
     * Restore header after responsive viewport changes.
     */
    const handleResize = () => {
      if (
        window.innerWidth >= 768 ||
        window.scrollY <= 2
      ) {
        showHeader();
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
      setMobileHeaderHidden(false);
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
   * Handle two-back exit logic.
   */
  useEffect(() => {
    function handleBackNavigation(
      e: Event,
    ) {
      const customEvent =
        e as CustomEvent;

      if (
        customEvent?.detail?.type === 'back'
      ) {
        const pathname =
          window.location.pathname;

        const isRoot =
          pathname === '/' ||
          pathname === '/home' ||
          pathname === '';

        if (isRoot) {
          const now = Date.now();

          if (
            firstBackTime === null
          ) {
            /*
             * First back at root.
             */
            setFirstBackTime(now);
          } else if (
            now - firstBackTime <
            2500
          ) {
            /*
             * Second back within 2.5 seconds.
             */
            setShowExitConfirm(true);
            setFirstBackTime(null);
          } else {
            /*
             * First back expired.
             */
            setFirstBackTime(now);
          }
        } else {
          /*
           * Not at root.
           */
          setFirstBackTime(null);
        }
      }
    }

    window.addEventListener(
      'app:back-pressed',
      handleBackNavigation as EventListener,
    );

    return () => {
      window.removeEventListener(
        'app:back-pressed',
        handleBackNavigation as EventListener,
      );
    };
  }, [firstBackTime]);

  /**
   * THE logout action, shared by the desktop header button and the mobile
   * menu row. There is exactly ONE logout implementation in the app: this
   * function only sequences the canonical `logout()` from <AuthProvider>
   * (AuthProvider.tsx) and never re-implements it.
   *
   * `logout()` is the single source of truth and it already:
   *   1. POSTs /auth/logout so the server-side Session row is revoked
   *      (the API's JwtAuthGuard re-checks the Session row on every request,
   *      so revoking it is what actually ends the session â€” not just the token);
   *   2. swallows a failed/expired request on purpose, so a session that is
   *      ALREADY invalid still transitions to logged-out instead of stranding
   *      the user, and no raw API error is ever surfaced;
   *   3. calls clearSession('logout') -> removes ng.access / ng.refresh /
   *      ng.user and dispatches `ng:session-changed` ('cleared'), which the
   *      provider itself listens for, so `user` becomes null everywhere;
   *   4. router.replace('/login') â€” the canonical logged-out destination.
   *
   * So all that is left here is the UI sequencing:
   *   - single-flight guard, so a double tap cannot double-POST or
   *     double-navigate;
   *   - close the menu AFTER the session is gone (it used to close FIRST,
   *     which briefly showed authenticated-only navigation with no way to
   *     act on it), inside `finally` so even an unexpected throw cannot
   *     leave the user sitting in a menu that still looks signed in.
   */
  async function onLogout() {
    if (loggingOutRef.current) return;

    loggingOutRef.current = true;
    setLoggingOut(true);

    try {
      await logout();
    } finally {
      setMobileMenuOpen(false);
      setLoggingOut(false);
      loggingOutRef.current = false;

      // Preserved from the previous behaviour (and a no-op when the provider
      // already replaced to /login): the canonical logged-out destination.
      router.push('/login');
    }
  }

  function closeMobileMenu() {
    setMobileMenuOpen(false);
  }

  function handleExitConfirm() {
    setShowExitConfirm(false);

    if (firstBackTime) {
      setFirstBackTime(null);
    }

    /*
     * For web, browser security does not allow a page
     * to arbitrarily close the current browser tab.
     *
     * Native wrappers can listen for this event.
     */
    window.dispatchEvent(
      new CustomEvent(
        'app:exit-requested',
      ),
    );
  }

  function handleExitCancel() {
    setShowExitConfirm(false);
    setFirstBackTime(null);
  }

  /*
   * Don't render user-specific UI until
   * auth state is resolved.
   */
  if (!localReady) {
    return null;
  }

  const displayUser = localUser;

  return (
    <>
      {/*
       * FIXED HEADER SPACER
       *
       * The actual header is position: fixed, so it no longer
       * participates in normal document flow.
       *
       * This spacer preserves exactly the same visual space
       * the old header occupied.
       *
       * Mobile:
       *   h-14 = 56px
       *
       * sm+:
       *   h-16 = 64px
       */}
      <div
        aria-hidden="true"
        className="h-14 sm:h-16"
      />

      {/*
       * FIXED MOBILE/DESKTOP HEADER
       *
       * Mobile:
       *   visible:
       *     translate-y-0
       *
       *   hidden:
       *     -translate-y-full
       *
       * Desktop:
       *   md:translate-y-0
       *
       * so desktop can never remain hidden because of
       * the mobile scroll state.
       */}
      <header
        className={`fixed inset-x-0 top-0 z-40 border-b border-white/10 bg-ink-950/95 backdrop-blur transition-transform duration-200 ease-out md:translate-y-0 ${
          mobileHeaderHidden
            ? '-translate-y-full'
            : 'translate-y-0'
        }`}
      >
        <div className="mx-auto w-full max-w-7xl px-3 sm:px-4 lg:px-8">
          <div className="flex min-h-14 items-center justify-between gap-2 py-2 sm:min-h-16 sm:gap-3">

            {/* Logo */}
            <Link
              href="/"
              onClick={closeMobileMenu}
              className="flex min-w-0 shrink-0 items-center gap-2"
              aria-label="TANVIONROYALE home"
            >
              <LogoMark
                className="h-8 w-8 sm:h-9 sm:w-9"
                gradientId="tr-header-mark"
              />

              <span className="hidden text-base font-extrabold tracking-tight text-white xs:inline sm:text-lg">
                TANVIONROYALE
              </span>
            </Link>

            {/* Desktop navigation */}
            <nav
              className="hidden min-w-0 flex-1 items-center justify-center gap-0.5 lg:flex"
              aria-label="Main navigation"
            >
              {NAV_LINKS.map(
                (link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="whitespace-nowrap rounded-md px-2 py-1.5 text-sm text-slate-300 transition hover:bg-white/5 hover:text-white xl:px-2.5"
                  >
                    {link.label}
                  </Link>
                ),
              )}
            </nav>

            {/* Actions */}
            <div className="flex shrink-0 items-center gap-1 sm:gap-2">

              {/* Desktop search */}
              <label className="relative hidden xl:block">
                <span className="sr-only">
                  Search games
                </span>

                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
                  aria-hidden
                >
                  <circle
                    cx="11"
                    cy="11"
                    r="7"
                    stroke="currentColor"
                    strokeWidth="2"
                  />

                  <path
                    d="M20 20l-3.5-3.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>

                <input
                  type="search"
                  onFocus={() =>
                    setSearchOpen(true)
                  }
                  placeholder="Search gamesâ€¦"
                  aria-label="Search games by title, provider, or category"
                  className="h-9 w-48 rounded-full border border-white/10 bg-ink-800 pl-9 pr-3 text-sm text-white placeholder:text-slate-500 outline-none focus:border-brand xl:w-56"
                />
              </label>

              {/* Mobile/tablet search */}
              <button
                type="button"
                onClick={() =>
                  setSearchOpen(true)
                }
                aria-label="Open game search"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition hover:bg-white/10 hover:text-white xl:hidden"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden
                >
                  <circle
                    cx="11"
                    cy="11"
                    r="7"
                    stroke="currentColor"
                    strokeWidth="2"
                  />

                  <path
                    d="M20 20l-3.5-3.5"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>

              {/* Desktop auth */}
              <div className="hidden items-center gap-1 sm:gap-2 md:flex">
                {localReady &&
                displayUser ? (
                  <>
                    <Link
                      href="/profile"
                      className="max-w-28 truncate rounded-full border border-brand/40 px-3 py-1.5 text-xs font-semibold text-brand transition hover:bg-brand/10 sm:max-w-none sm:text-sm"
                      data-testid="header-username"
                    >
                      {displayUser.username}
                    </Link>

                    <button
                      type="button"
                      onClick={onLogout}
                      disabled={loggingOut}
                      aria-busy={loggingOut}
                      className="rounded-lg px-2.5 py-1.5 text-xs text-slate-300 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm"
                    >
                      {loggingOut
                        ? 'Logging outâ€¦'
                        : 'Log out'}
                    </button>
                  </>
                ) : (
                  <>
                    <Link
                      href="/login"
                      className="rounded-lg px-2 py-1.5 text-xs font-medium text-slate-200 transition hover:text-white sm:px-2.5 sm:text-sm"
                    >
                      Login
                    </Link>

                    <Link
                      href="/register"
                      className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-ink-950 transition hover:bg-brand-dark sm:px-4 sm:text-sm"
                    >
                      Register
                    </Link>
                  </>
                )}
              </div>

              {/* Mobile menu button */}
              <button
                type="button"
                onClick={() =>
                  setMobileMenuOpen(
                    (open) => !open,
                  )
                }
                aria-label={
                  mobileMenuOpen
                    ? 'Close menu'
                    : 'Open menu'
                }
                aria-expanded={
                  mobileMenuOpen
                }
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 text-slate-200 transition hover:bg-white/10 hover:text-white lg:hidden"
              >
                {mobileMenuOpen ? (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden
                  >
                    <path
                      d="M6 6l12 12M18 6L6 18"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                ) : (
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden
                  >
                    <path
                      d="M4 7h16M4 12h16M4 17h16"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/*
            MOBILE NAVIGATION

            One scroll container for the WHOLE menu. `userNavSections` now
            carries four sections (MAIN / ACCOUNT / SERVICE / PERSONAL), and
            the header this panel lives in is `position: fixed`:

                <header className="fixed inset-x-0 top-0 â€¦">

            A fixed box does not travel with the document, so once the menu is
            taller than the viewport its tail is pushed past the bottom edge of
            the screen and can NEVER be scrolled to. That is exactly what used
            to hide the last section (PERSONAL -> the affiliate entry +
            "Settings") and the login/register row on short phones: they were
            rendered, just off-screen.

            `max-height` + `overflow-y-auto` turns the panel into the single
            scroll container, so every section stays reachable. The reserved
            space keeps the two fixed bars clear:

                3.5rem  the header bar itself (h-14) â€” logo + close X stay usable
                ~3.5rem the mobile bottom nav (fixed bottom-0, ~50px)
                ~2rem   breathing room / safe-area

            `100dvh` (not `100vh`) so the cap follows the REAL visible height
            when the mobile browser toolbar is expanded; the `100vh` class is
            the fallback for engines without `dvh`. `overscroll-contain` keeps
            a swipe inside the menu from chaining to the page behind it, which
            is what would otherwise hide the header mid-menu.

            This is presentation only: the section list itself still comes
            straight from `userNavSections`, unchanged, and the desktop
            `UserSidebar` is not affected.
          */}
          {mobileMenuOpen && (
            <div className="max-h-[calc(100dvh-9rem)] supports-[height:0dvh]:max-h-[calc(100dvh-9rem)] overflow-y-auto overscroll-contain border-t border-white/10 py-3 lg:hidden">

              {/* Same user-panel items + routes as the desktop sidebar */}
              {userNavSections.map(
                (section) => (
                  <div
                    key={section.title}
                    className="mb-1.5"
                  >
                    <p className="px-3 pb-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                      {section.title}
                    </p>

                    <nav
                      aria-label={`Mobile ${section.title} navigation`}
                      className="grid grid-cols-2 gap-1.5"
                    >
                      {section.items.map(
                        (item) => (
                          <MobileNavItem
                            key={item.key}
                            item={item}
                            onNavigate={
                              closeMobileMenu
                            }
                          />
                        ),
                      )}
                    </nav>
                  </div>
                ),
              )}

              {/*
                SESSION ACTIONS â€” the last block of the menu, below a rule so it
                can never be mistaken for a navigation section.

                Deliberately NOT part of `userNavSections`: that array is a list
                of real ROUTES consumed by BOTH the mobile menu and the desktop
                sidebar, and logout is not a destination. There is no /logout
                page and none was added â€” the button runs the same canonical
                `onLogout()` the desktop header button runs, which delegates to
                <AuthProvider>'s `logout()`.

                Signed in  -> Profile (unchanged styling) + a full-width Logout
                              row built like every other menu row (icon + label),
                              so it is as easy to hit as a navigation item and
                              is unmistakably an action.
                Signed out -> the existing Login / Register pair, untouched.
              */}
              <div className="mt-3 border-t border-white/10 pt-3">
                {localReady &&
                displayUser ? (
                  <div className="flex flex-col gap-1.5">
                    <Link
                      href="/profile"
                      onClick={
                        closeMobileMenu
                      }
                      className="rounded-lg border border-brand/30 bg-brand/10 px-3 py-2.5 text-center text-sm font-semibold text-brand"
                    >
                      Profile
                    </Link>

                    <button
                      type="button"
                      onClick={onLogout}
                      disabled={loggingOut}
                      aria-busy={loggingOut}
                      className="flex min-w-0 items-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/5 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                    >
                      <NavIcon d={LOGOUT_ICON} />

                      <span className="min-w-0 flex-1 truncate text-left">
                        {loggingOut
                          ? 'Logging outâ€¦'
                          : 'Logout'}
                      </span>
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <Link
                      href="/login"
                      onClick={
                        closeMobileMenu
                      }
                      className="rounded-lg border border-white/10 px-3 py-2.5 text-center text-sm font-medium text-slate-200"
                    >
                      Login
                    </Link>

                    <Link
                      href="/register"
                      onClick={
                        closeMobileMenu
                      }
                      className="rounded-lg bg-brand px-3 py-2.5 text-center text-sm font-semibold text-ink-950"
                    >
                      Register
                    </Link>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </header>

      <SearchOverlay
        open={searchOpen}
        onClose={() =>
          setSearchOpen(false)
        }
      />

      {/* Two-back exit confirmation dialog */}
      {showExitConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/90 p-4"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="exit-title"
        >
          <div className="bg-ink-800 rounded-xl p-6 max-w-sm w-full shadow-2xl">

            <h2
              id="exit-title"
              className="text-lg font-bold text-white text-center"
            >
              {exitMessage}
            </h2>

            <p className="mt-2 text-sm text-slate-400 text-center">
              This will exit TANVION ROYALE.
            </p>

            <div className="mt-6 flex gap-3">

              <button
                type="button"
                onClick={
                  handleExitCancel
                }
                className="flex-1 rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-white/5"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={
                  handleExitConfirm
                }
                className="flex-1 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-brand-dark"
              >
                Exit
              </button>

            </div>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Mobile hamburger entry â€”
 * same item/route as the desktop sidebar.
 */
function MobileNavItem({
  item,
  onNavigate,
}: {
  item: UserNavItem;
  onNavigate: () => void;
}) {
  /*
   * Feature does not exist on the platform yet â€”
   * keep an honest disabled entry.
   */
  if (item.href === null) {
    return (
      <span
        title={item.note}
        className="flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-500 opacity-70"
      >
        <NavIcon d={item.icon} />

        {item.label}

        {item.note ? (
          <span className="sr-only">
            , {item.note}
          </span>
        ) : null}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className="flex min-w-0 items-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-white/5 hover:text-white"
    >
      <NavIcon d={item.icon} />

      <span className="min-w-0 flex-1 truncate">
        {item.label}
      </span>

      {item.key === 'notification' ? <UnreadBadge /> : null}
    </Link>
  );
}
