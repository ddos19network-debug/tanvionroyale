'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Global mobile navigation visibility controller (scroll-only, speed based).
 *
 * ONE singleton store drives every mobile header (AppHeader, TradingShell,
 * UnifiedProfile) and BottomNav. Mobile only (< 768px); desktop is inert.
 *
 * SPEC:
 *  1. Initial load / route change: Top + Bottom both VISIBLE.
 *  2. FAST scroll (speed >= FAST_SPEED_PX_PER_S, any direction):
 *       BOTH menus HIDE, and a "fast latch" is set. While the latch is set
 *       (including the momentum tail after the finger lifts) NOTHING shows.
 *  3. SLOW scroll never hides a menu, however far it goes.
 *  4. Scroll stops (no scroll event for REST_MS): latch is released.
 *       Visibility itself does NOT change (no auto show, no auto hide).
 *  5. HALKA scroll = slow scroll after a rest, HALKA_MIN_PX in one direction.
 *       Direction is REVERSED on purpose:
 *         - page scrolled DOWN (scrollY increases, lower content comes in)
 *             -> TOP menu shows
 *         - page scrolled UP (scrollY decreases, upper content comes in)
 *             -> BOTTOM menu shows
 *       The other menu keeps its current state. Shows immediately, it does
 *       not wait for the scroll to stop.
 *  6. Top and Bottom are independent. Only a FAST scroll hides them.
 *  7. Near the top of the page (scrollY <= TOP_ALWAYS_VISIBLE_PX) Top shows.
 *  8. Desktop (>= 768px): inert. Top always visible, Bottom hidden by CSS.
 *
 * Speed = distance scrolled inside the last SPEED_WINDOW_MS (px per second).
 * A "scroll session" = scroll events with gaps shorter than REST_MS.
 */

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

interface NavVisibilityState {
  top: boolean;
  bottom: boolean;
}

const MOBILE_MAX_WIDTH = 768;

/** Slow movement in ONE direction needed to reveal a menu (px). */
const HALKA_MIN_PX = 8;

/** At/above this speed the scroll is "fast": hide both + latch (px/s). */
const FAST_SPEED_PX_PER_S = 600;

/** Window used to measure scroll speed (ms). */
const SPEED_WINDOW_MS = 100;

/** No scroll event for this long = scrolling has stopped / session ended (ms). */
const REST_MS = 150;

/** A session must be at least this old before a menu may be revealed (ms).
 *  Gives a fast flick time to be recognised so it never flashes a menu. */
const MIN_REVEAL_AGE_MS = 48;

/** Ignore scroll events right after a route change (scroll restoration) (ms). */
const ROUTE_IGNORE_MS = 400;

/** Top menu is always shown this close to the top of the page (px). */
const TOP_ALWAYS_VISIBLE_PX = 25;

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

const ALL_VISIBLE: NavVisibilityState = { top: true, bottom: true };

let state: NavVisibilityState = { ...ALL_VISIBLE };
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function setState(next: NavVisibilityState) {
  if (next.top === state.top && next.bottom === state.bottom) return;
  state = next;
  emit();
}

// ---------------------------------------------------------------------------
// Scroll session tracking
// ---------------------------------------------------------------------------

interface ScrollSample {
  t: number;
  d: number;
}

let lastY = typeof window !== 'undefined' ? window.scrollY : 0;
let ignoreUntil = 0;

let sessionActive = false;
let sessionStartT = 0;
let samples: ScrollSample[] = [];
let dirAccum = 0; // signed: > 0 scrolled down, < 0 scrolled up
let fastLatched = false;
let restTimer: ReturnType<typeof setTimeout> | null = null;

let lastPathname: string | null = null;

/** Keyboard tracking */
let keyboardOpen = false;
let keyboardTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isMobile(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < MOBILE_MAX_WIDTH;
}

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const t = (el as HTMLInputElement).type;
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'file', 'image', 'color'].includes(t);
  }
  return (el as HTMLElement).isContentEditable === true;
}

/** Only the main page scroll counts (not carousels, dropdown lists, etc.). */
function isPageScrollTarget(target: EventTarget | null): boolean {
  if (typeof document === 'undefined') return false;
  return (
    target === document ||
    target === document.documentElement ||
    target === document.body ||
    target === window
  );
}

function resetSession() {
  sessionActive = false;
  sessionStartT = 0;
  samples = [];
  dirAccum = 0;
  fastLatched = false;
  if (restTimer !== null) {
    clearTimeout(restTimer);
    restTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Menu actions
// ---------------------------------------------------------------------------

/** Show Top Menu. Does NOT hide Bottom Menu. */
function revealTop() {
  if (state.top) return;
  setState({ top: true, bottom: state.bottom });
}

/** Show Bottom Menu. Does NOT hide Top Menu. */
function revealBottom() {
  if (keyboardOpen) return;
  if (state.bottom) return;
  setState({ top: state.top, bottom: true });
}

/** Fast scroll: hide both menus together. */
function hideBoth() {
  if (!state.top && !state.bottom) return;
  setState({ top: false, bottom: false });
}

/**
 * Reveal the menu for a slow movement in one direction.
 * REVERSED mapping: scrolled down -> Top, scrolled up -> Bottom.
 */
function revealForDirection(signedDistance: number) {
  if (signedDistance > 0) {
    revealTop();
  } else if (signedDistance < 0) {
    revealBottom();
  }
}

/** Reset to initial state (used on route change). */
export function resetMobileNavVisibility() {
  resetSession();
  lastY = typeof window !== 'undefined' ? window.scrollY : 0;
  ignoreUntil = Date.now() + ROUTE_IGNORE_MS;
  setState({ ...ALL_VISIBLE });
}

// ---------------------------------------------------------------------------
// Scroll handling
// ---------------------------------------------------------------------------

/**
 * Scrolling has stopped (REST_MS without a scroll event).
 * Releases the fast latch. A very short slow movement that ended before the
 * normal reveal gate opened is still honoured here.
 * NEVER hides anything.
 */
function endSession() {
  restTimer = null;

  if (!fastLatched && Math.abs(dirAccum) >= HALKA_MIN_PX) {
    revealForDirection(dirAccum);
  }

  sessionActive = false;
  sessionStartT = 0;
  samples = [];
  dirAccum = 0;
  fastLatched = false;
}

function onScroll(e: Event) {
  if (!isMobile()) return;
  if (!isPageScrollTarget(e.target)) return;

  const now = performance.now();
  const y = window.scrollY || 0;
  const delta = y - lastY;
  lastY = y;

  // Route change / programmatic restore: ignore.
  if (Date.now() < ignoreUntil) return;

  // iOS rubber-band overscroll: ignore.
  const maxY = document.documentElement.scrollHeight - window.innerHeight;
  if (y < 0 || y > maxY) return;

  if (Math.abs(delta) < 1) return;

  // Near the top of the page the top menu is always visible.
  if (y <= TOP_ALWAYS_VISIBLE_PX) {
    revealTop();
    return;
  }

  if (!sessionActive) {
    sessionActive = true;
    sessionStartT = now;
    samples = [];
    dirAccum = 0;
    fastLatched = false;
  }

  // Speed over the last SPEED_WINDOW_MS, in px per second.
  samples.push({ t: now, d: Math.abs(delta) });
  while (samples.length > 0 && samples[0].t < now - SPEED_WINDOW_MS) {
    samples.shift();
  }
  let windowDistance = 0;
  for (const s of samples) windowDistance += s.d;
  const speed = windowDistance * (1000 / SPEED_WINDOW_MS);

  // FAST: hide both once, then latch until the scroll fully stops.
  if (!fastLatched && speed >= FAST_SPEED_PX_PER_S) {
    fastLatched = true;
    hideBoth();
  }

  // SLOW: accumulate movement in one direction and reveal at HALKA_MIN_PX.
  if (!fastLatched) {
    if (dirAccum !== 0 && Math.sign(dirAccum) !== Math.sign(delta)) {
      dirAccum = 0; // direction changed: count again from zero
    }
    dirAccum += delta;

    if (Math.abs(dirAccum) >= HALKA_MIN_PX && now - sessionStartT >= MIN_REVEAL_AGE_MS) {
      revealForDirection(dirAccum);
      dirAccum = 0;
    }
  }

  if (restTimer !== null) clearTimeout(restTimer);
  restTimer = setTimeout(endSession, REST_MS);
}

// ---------------------------------------------------------------------------
// Keyboard / resize
// ---------------------------------------------------------------------------

function onFocusIn(e: FocusEvent) {
  if (!isMobile()) return;
  if (!isEditable(e.target as Element | null)) return;
  if (keyboardTimer !== null) {
    clearTimeout(keyboardTimer);
    keyboardTimer = null;
  }
  keyboardOpen = true;
  setState({ top: state.top, bottom: false });
}

function onFocusOut() {
  if (!keyboardOpen) return;
  if (keyboardTimer !== null) clearTimeout(keyboardTimer);
  keyboardTimer = setTimeout(() => {
    keyboardTimer = null;
    if (isEditable(document.activeElement)) return;
    keyboardOpen = false;
    setState({ top: state.top, bottom: true });
  }, 150);
}

function onResize() {
  if (!isMobile()) {
    // Desktop: Top Menu always visible (Bottom Menu hidden by md:hidden CSS)
    setState({ top: true, bottom: false });
  }
}

// ---------------------------------------------------------------------------
// Singleton subscription management
// ---------------------------------------------------------------------------

function attachListeners() {
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  window.addEventListener('resize', onResize);
  window.addEventListener('focusin', onFocusIn);
  window.addEventListener('focusout', onFocusOut);
}

function detachListeners() {
  window.removeEventListener('scroll', onScroll, true);
  window.removeEventListener('resize', onResize);
  window.removeEventListener('focusin', onFocusIn);
  window.removeEventListener('focusout', onFocusOut);
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) attachListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      detachListeners();
      resetSession();
      if (keyboardTimer !== null) {
        clearTimeout(keyboardTimer);
        keyboardTimer = null;
      }
      keyboardOpen = false;
    }
  };
}

function getSnapshot(): NavVisibilityState {
  return state;
}

function getServerSnapshot(): NavVisibilityState {
  // SSR: render both visible
  return ALL_VISIBLE;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMobileNavVisibility() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const pathname = usePathname();

  // Every route change starts with both bars visible.
  // Several components use this hook, so only reset when the path really changed.
  useEffect(() => {
    if (lastPathname === pathname) return;
    lastPathname = pathname;
    resetMobileNavVisibility();
  }, [pathname]);

  const showTop = useCallback(() => revealTop(), []);
  const showBottom = useCallback(() => revealBottom(), []);

  return {
    topVisible: current.top,
    bottomVisible: current.bottom,
    showTop,
    showBottom,
  };
}