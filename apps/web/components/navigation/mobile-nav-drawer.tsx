'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { LogoMark } from '@/components/brand/logo';
import { NavIcon } from './nav-icon';
import { UnreadBadge } from '@/components/notifications/unread-badge';
import { StudioSidebarNav } from './studio-sidebar-nav';
import { normalizeStudio, studioProductFromQuery } from '@/lib/casino/studio-query';
import { userNavSections, type UserNavItem } from './user-nav';

const PROFILE_ICON =
  'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z';
const LOGOUT_ICON =
  'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9';
const TRADING_ICON = 'M3 17l6-6 4 4 8-8M15 7h6v6';

export interface MobileNavDrawerProps {
  open: boolean;
  onClose: () => void;
  isAuthenticated: boolean;
  user: any;
  onLogout: () => void;
  loggingOut?: boolean;
}

/**
 * Mobile navigation off-canvas drawer (< 768px).
 *
 * Requirements satisfied:
 * - Desktop sidebar (UserSidebar) remains 100% unchanged.
 * - Below 768px, navigation renders as a smooth sliding drawer from the left.
 * - Hamburger button opens the drawer.
 * - Clicking any item or backdrop or pressing Escape closes it immediately.
 * - Prevents horizontal overflow.
 * - Integrates with browser back button navigation.
 * - Supports touch drag gestures to dismiss.
 */
export function MobileNavDrawer({
  open,
  onClose,
  isAuthenticated,
  user,
  onLogout,
  loggingOut = false,
}: MobileNavDrawerProps) {
  const pathname = usePathname() || '';
  const searchParams = useSearchParams();
  const category = searchParams.get('category');
  const product = searchParams.get('product');

  const studioProduct = studioProductFromQuery(product);
  const currentStudio = normalizeStudio(searchParams.get('provider'));

  // The drawer is rendered through a portal into <body>. The header it is
  // declared in is `position: fixed` + transformed (hide-on-scroll) +
  // backdrop-filtered, and any of those turns the header into the containing
  // block of `fixed` children, which would clip the drawer to the header bar.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const drawerRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number | null>(null);
  const touchCurrentX = useRef<number | null>(null);

  // Keyboard accessibility: Escape key closes the drawer
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // Browser back navigation integration
  useEffect(() => {
    if (!open) return;

    window.history.pushState({ mobileDrawerOpen: true }, '');

    const handlePopState = () => {
      onClose();
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [open, onClose]);

  // Touch gesture handling: swipe left to dismiss
  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    touchCurrentX.current = e.touches[0].clientX;
  };

  const handleTouchEnd = () => {
    if (touchStartX.current !== null && touchCurrentX.current !== null) {
      const diffX = touchStartX.current - touchCurrentX.current;
      // If swiped left by more than 50px, close drawer
      if (diffX > 50) {
        onClose();
      }
    }
    touchStartX.current = null;
    touchCurrentX.current = null;
  };

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex md:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Navigation drawer"
    >
      {/* Backdrop overlay */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-sm transition-opacity duration-300 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer content pane */}
      <div
        ref={drawerRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="relative z-10 flex w-72 max-w-[85vw] flex-col bg-ink-950 border-r border-ink-800 shadow-2xl transition-transform duration-300 ease-out transform translate-x-0"
      >
        {/* Brand header */}
        <div className="flex items-center justify-between border-b border-ink-800 px-4 py-3.5">
          <Link
            href="/"
            onClick={onClose}
            className="flex items-center gap-2.5"
            aria-label="TANVIONROYALE home"
          >
            <LogoMark className="h-7 w-7" gradientId="tr-mobile-drawer" />
            <span className="text-sm font-extrabold tracking-tight text-white">
              TANVIONROYALE
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-ink-800 hover:text-white"
            aria-label="Close drawer"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable Navigation sections */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-2 py-3">
          {/* Trading: separate product, always opens in a NEW tab where the
              main top menu is replaced by the trading top menu. */}
          <div className="mb-3">
            <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              TRADING
            </p>
            <a
              href="/trading/home"
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-slate-300 transition hover:bg-ink-800 hover:text-white"
            >
              <NavIcon d={TRADING_ICON} />
              <span className="flex-1 truncate">Trading</span>
            </a>
          </div>

          {userNavSections.map((section) => {
            const ownsGames = section.items.some((item) =>
              typeof item.href === 'string' && item.href.startsWith('/games'),
            );

            return (
              <div key={section.title} className="mb-3">
                <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  {section.title}
                </p>
                <nav className="flex flex-col gap-0.5">
                  {section.items.map((item) => {
                    const active = item.active(pathname, category, product);

                    if (item.href === null) {
                      return (
                        <span
                          key={item.key}
                          title={item.note}
                          className="flex cursor-not-allowed items-center gap-2.5 rounded-lg px-3 py-2 text-xs text-slate-600 opacity-70"
                        >
                          <NavIcon d={item.icon} />
                          <span className="flex-1 truncate">{item.label}</span>
                          <span className="rounded bg-ink-800 px-1.5 py-0.5 text-[8px] uppercase text-slate-500">
                            Unavailable
                          </span>
                        </span>
                      );
                    }

                    return (
                      <Link
                        key={item.key}
                        href={item.href}
                        onClick={onClose}
                        className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition ${
                          active
                            ? 'bg-teal-500/15 text-teal-300 font-semibold'
                            : 'text-slate-300 hover:bg-ink-800 hover:text-white'
                        }`}
                      >
                        <NavIcon d={item.icon} />
                        <span className="flex-1 truncate">{item.label}</span>
                        {item.key === 'notification' ? <UnreadBadge /> : null}
                      </Link>
                    );
                  })}
                </nav>

                {/* Studios dynamic submenu for mobile */}
                {ownsGames ? (
                  <div className="mt-1 pl-2" onClick={onClose}>
                    <StudioSidebarNav
                      product={studioProduct}
                      pathname={pathname}
                      currentProvider={currentStudio}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* Footer / Account Section */}
        <div className="border-t border-ink-800 bg-ink-900/60 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {isAuthenticated ? (
            <div className="flex flex-col gap-2">
              <Link
                href="/profile"
                onClick={onClose}
                className="flex items-center gap-2.5 rounded-lg bg-teal-500/10 border border-teal-500/20 px-3 py-2 text-xs font-semibold text-teal-300 hover:bg-teal-500/20"
              >
                <NavIcon d={PROFILE_ICON} />
                <span className="truncate">Profile ({user?.username ?? 'Account'})</span>
              </Link>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onLogout();
                }}
                disabled={loggingOut}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-slate-400 hover:bg-red-500/10 hover:text-red-300"
              >
                <NavIcon d={LOGOUT_ICON} />
                <span>{loggingOut ? 'Signing out...' : 'Sign out'}</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Link
                href="/login"
                onClick={onClose}
                className="rounded-lg border border-slate-700 bg-ink-800 py-2 text-center text-xs font-medium text-slate-200 hover:bg-ink-700"
              >
                Login
              </Link>
              <Link
                href="/register"
                onClick={onClose}
                className="rounded-lg bg-teal-500 py-2 text-center text-xs font-semibold text-ink-950 hover:bg-teal-400"
              >
                Register
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}