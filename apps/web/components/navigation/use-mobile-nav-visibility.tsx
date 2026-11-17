'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Shared mobile navigation visibility controller.
 *
 * ONE store is shared by every consumer (main AppHeader, TradingShell header,
 * UnifiedProfile mobile header and the BottomNav), so the top and bottom bars
 * can never disagree with each other.
 *
 * Behaviour (mobile only, viewport < 768px):
 *
 *   ONLY ONE bar is ever visible at a time (or none while scrolling).
 *
 *   - At the very top of the page   -> Top menu visible, Bottom hidden
 *   - While the page is scrolling   -> Top + Bottom menu both hidden
 *   - Scrolling stops               -> both stay hidden (no auto-reveal)
 *   - Short finger swipe UP         -> Top menu appears   (Bottom stays hidden)
 *   - Short finger swipe DOWN       -> Bottom menu appears (Top stays hidden)
 *   - Route change                  -> Top menu visible, Bottom hidden
 *   - Desktop (>= 768px)            -> controller is inert, bars use their own CSS
 *
 * A "nudge" is a very gentle push: 4px..80px of finger travel. Anything bigger is a normal scroll gesture and hides both.
 * Nudges are detected from touch events (works even at the very end of the
 * page where nothing can scroll) AND from small scroll bursts as a fallback.
 */

interface NavVisibilityState {
  top: boolean;
  bottom: boolean;
}

const MOBILE_MAX_WIDTH = 768;
/** Minimum finger travel (px) to count as a nudge (smaller = a tap). */
const SWIPE_THRESHOLD = 4;
/** Maximum travel (px) for a gesture to still be a gentle nudge. */
const MAX_SWIPE_DISTANCE = 80;
/** Maximum duration (ms) for a gesture to still be a gentle nudge. */
const MAX_SWIPE_DURATION = 1500;
/** Scroll is considered "stopped" after this many ms without scroll events. */
const SCROLL_IDLE_MS = 140;
/** Page is considered "at the top" when scrollY is within this many px. */
const TOP_EDGE_PX = 8;

const INITIAL_STATE: NavVisibilityState = { top: true, bottom: false };

let state: NavVisibilityState = INITIAL_STATE;
const listeners = new Set<() => void>();

/* Gesture bookkeeping (module level: there is exactly one controller). */
let touchActive = false;
let touchStartY = 0;
let touchLastY = 0;
let touchStartTime = 0;
/** Scroll-burst tracking (fallback / non-touch scrolling). */
let burstActive = false;
let burstStartY = 0;
let burstLastY = 0;
let burstTimer: ReturnType<typeof setTimeout> | null = null;
/** After a deliberate reveal, momentum scrolling must not hide the bar again. */
let revealLocked = false;

function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < MOBILE_MAX_WIDTH;
}

function setState(next: NavVisibilityState) {
  if (next.top === state.top && next.bottom === state.bottom) return;
  state = next;
  listeners.forEach((listener) => listener());
}

/** Default resting state: top bar only. Two bars are never shown together. */
function showDefault() {
  setState({ top: true, bottom: false });
}

function hideBoth() {
  setState({ top: false, bottom: false });
}

function showTopOnly() {
  setState({ top: true, bottom: false });
}

function showBottomOnly() {
  setState({ top: false, bottom: true });
}

/** Reset to the default "everything visible" state (used on route change). */
function clearBurst() {
  burstActive = false;
  if (burstTimer !== null) {
    clearTimeout(burstTimer);
    burstTimer = null;
  }
}

export function resetMobileNavVisibility() {
  revealLocked = false;
  touchActive = false;
  clearBurst();
  showDefault();
}

function onTouchStart(e: TouchEvent) {
  if (!isMobileViewport()) return;
  const touch = e.touches[0];
  if (!touch) return;
  touchActive = true;
  revealLocked = false;
  clearBurst();
  touchStartY = touch.clientY;
  touchLastY = touch.clientY;
  touchStartTime = performance.now();
}

function onTouchMove(e: TouchEvent) {
  if (!touchActive || !isMobileViewport()) return;
  const touch = e.touches[0];
  if (!touch) return;
  touchLastY = touch.clientY;

  const distance = Math.abs(touchLastY - touchStartY);
  const duration = performance.now() - touchStartTime;

  // The gesture is already bigger than a gentle nudge: it is a normal scroll,
  // so hide both bars while the finger is still dragging.
  if (distance > MAX_SWIPE_DISTANCE || duration > MAX_SWIPE_DURATION) {
    hideBoth();
  }
}

function onTouchEnd(e?: TouchEvent) {
  if (!touchActive) return;
  touchActive = false;
  if (!isMobileViewport()) return;

  // Browsers do not send touchmove until the finger leaves the tap "slop"
  // area, so touchLastY can be stale. The final position is the truth.
  const endTouch = e?.changedTouches?.[0];
  if (endTouch) touchLastY = endTouch.clientY;

  const deltaY = touchLastY - touchStartY; // > 0 : finger moved DOWN
  const distance = Math.abs(deltaY);
  const duration = performance.now() - touchStartTime;

  if (distance < SWIPE_THRESHOLD) {
    // A tap / tiny jitter: leave the bars exactly as they are.
    return;
  }

  if (distance <= MAX_SWIPE_DISTANCE && duration <= MAX_SWIPE_DURATION) {
    // Deliberate short swipe -> reveal one bar and keep it through momentum.
    revealLocked = true;
    if (deltaY > 0) {
      showBottomOnly(); // finger moved DOWN  -> Bottom menu
    } else {
      showTopOnly(); // finger moved UP    -> Top menu
    }
    return;
  }

  // Long / fast gesture = normal scrolling.
  revealLocked = false;
  hideBoth();
}

function onBurstEnd() {
  burstTimer = null;
  if (!burstActive) return;
  burstActive = false;
  if (touchActive || revealLocked || !isMobileViewport()) return;

  // Scrolling has STOPPED. If the whole burst was only a gentle nudge,
  // reveal a bar by direction (page moved down = finger swiped UP).
  const delta = burstLastY - burstStartY;
  const distance = Math.abs(delta);
  if (distance >= SWIPE_THRESHOLD && distance <= MAX_SWIPE_DISTANCE) {
    if (delta > 0) {
      showTopOnly();
    } else {
      showBottomOnly();
    }
  }
}

function onScroll() {
  if (!isMobileViewport()) return;

  const y = window.scrollY;

  // A finger is down: touchmove/touchend decide (avoids flicker on nudges).
  if (touchActive) return;

  // Momentum after a deliberate reveal must not undo that reveal.
  if (revealLocked) return;

  // Back at the top of the document: Top menu only.
  if (y <= TOP_EDGE_PX) {
    clearBurst();
    showDefault();
    return;
  }

  if (!burstActive) {
    burstActive = true;
    burstStartY = y;
  }
  burstLastY = y;

  // Bigger than a nudge = real scrolling: hide both immediately.
  if (Math.abs(burstLastY - burstStartY) > MAX_SWIPE_DISTANCE) {
    hideBoth();
  }

  if (burstTimer !== null) clearTimeout(burstTimer);
  burstTimer = setTimeout(onBurstEnd, SCROLL_IDLE_MS);
}

function onResize() {
  if (!isMobileViewport()) showDefault();
}

function attachListeners() {
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: true });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('touchcancel', onTouchEnd, { passive: true });
  // Capture phase: scroll events from inner scroll containers do not bubble.
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  window.addEventListener('resize', onResize);
}

function detachListeners() {
  window.removeEventListener('touchstart', onTouchStart);
  window.removeEventListener('touchmove', onTouchMove);
  window.removeEventListener('touchend', onTouchEnd);
  window.removeEventListener('touchcancel', onTouchEnd);
  window.removeEventListener('scroll', onScroll, true);
  window.removeEventListener('resize', onResize);
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) attachListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      detachListeners();
      touchActive = false;
      revealLocked = false;
      clearBurst();
    }
  };
}

function getSnapshot(): NavVisibilityState {
  return state;
}

function getServerSnapshot(): NavVisibilityState {
  return INITIAL_STATE;
}

export function useMobileNavVisibility() {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const pathname = usePathname();

  // Every route change starts with both bars visible.
  useEffect(() => {
    resetMobileNavVisibility();
  }, [pathname]);

  const showTop = useCallback(() => showTopOnly(), []);
  const showBottom = useCallback(() => showBottomOnly(), []);
  const hide = useCallback(() => hideBoth(), []);

  return {
    topVisible: current.top,
    bottomVisible: current.bottom,
    showTopOnly: showTop,
    showBottomOnly: showBottom,
    hideBoth: hide,
  };
}