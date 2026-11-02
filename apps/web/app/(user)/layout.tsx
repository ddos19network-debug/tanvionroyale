"use client";

import { AppHeader } from '@/components/layout/app-header';
import { usePathname } from 'next/navigation';

/**
 * Shared layout for EVERY TANVIONROYALE user-panel route.
 *
 * WHY THIS EXISTS
 * ---------------
 * The top navigation (<AppHeader />) used to be imported and rendered by each
 * user-panel page individually. Pages that forgot the import had no top nav at
 * all (/wallet, /wallet/deposit, /notifications, /support/chat, /verification),
 * while every page that did import it had to be kept in sync by hand — exactly
 * the drift this single shared layout removes.
 *
 * URLS ARE UNCHANGED: the route group `(user)` is parenthesised, so it is
 * transparent to routing. `app/(user)/wallet/page.tsx` still serves `/wallet`,
 * `app/(user)/support/chat/page.tsx` still serves `/support/chat`, and so on.
 * Moving a page into this group changes its folder location only, never its
 * path.
 *
 * SCOPE: every path that starts with one of the USER_PANEL_PREFIXES in
 * components/navigation/user-nav.ts — plus the platform home `/` itself
 * (app/(user)/page.tsx) — lives here, so the desktop sidebar (rendered once
 * by the root layout) and this top header always agree. `/home` is part of
 * that list too (app/(user)/home/page.tsx, still served at `/home`). The
 * Admin panel, the auth screens and the static legal pages (/privacy, /terms)
 * keep their own chrome and are deliberately NOT part of this group.
 *
 * The content wrapper is intentionally a plain full-width `<div>` rather than a
 * second `<main>`: every page in the group still renders its own semantic
 * `<main>` with its page-specific width/background, and nesting `<main>`
 * elements would duplicate an ARIA landmark. `w-full min-w-0 flex-1` keeps the
 * content area at 100% of the width available next to the desktop sidebar.
 */
export default function UserPanelLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Hide the top navigation during full-screen gameplay so the game gets the
  // entire display. Game play pages live under /games/play/<slug>.
  const isGamePlay = pathname.startsWith("/games/play/");

  return (
    <>
      {/* Top navigation: rendered ONCE here for the whole user panel.
          Hidden on game-play pages for a full-screen, immersive game shell. */}
      {!isGamePlay && <AppHeader />}

      {/* Full-width content column — pages own the inner <main>. */}
      <div className="w-full min-w-0 flex-1">{children}</div>
    </>
  );
}