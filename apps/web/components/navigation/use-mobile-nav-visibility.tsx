'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Global mobile navigation visibility controller.
 *
 * ONE singleton store drives every mobile header (AppHeader, TradingShell,
 * UnifiedProfile) and BottomNav. Mobile only (< 768px); desktop is inert.
 *
 * USER-CONFIRMED SPECIFICATION:
 *
 * 1. Initial page load / route change:
 *    - Both menus VISIBLE.
 *
 * 2. Normal continuous scrolling (any direction):
 *    - BOTH menus HIDE ("scroll er somoy 2 ta menu hide hobe scroll jekono pase holei").
 *
 * 3. When scrolling stops:
 *    - Menus do NOT automatically show ("scroll stop hole menu show hobe na jotokhon pojonto halka scroll hobe").
 *    - If both were hidden, both remain hidden.
 *
 * 4. Post-scroll small movement ("halka scroll"):
 *    - When upper content comes into display (scroll up / pull down):
 *      * Top Menu SHOWS ("halka oporer contain display te asle top menu").
 *      * Bottom Menu keeps its current state (does not hide if already visible).
 *    - When lower content comes into display (scroll down / push up):
 *      * Bottom Menu SHOWS ("nicher contain jokhon display te asbe tokhon buttom").
 *      * Top Menu keeps its current state (does not hide if already visible).
 *
 * 5. Independent visibility ("ekbar menu show hole normal scrolling sara hide hobe na,
 *    mane holo ekta menu show hole arekta hide hobe na"):
 *    - Once a menu shows, it will NOT hide unless normal continuous scrolling occurs.
 *    - Showing Top Menu never hides Bottom Menu.
 *    - Showing Bottom Menu never hides Top Menu.
 *
 * 6. Normal scrolling resumes:
 *    - BOTH menus hide ("jokhon normal scroll hobe tokhon 2 tai hide hobe").
 *
 * 7. Desktop (>= 768px):
 *    - Inert. Top Menu always visible, Bottom Menu always hidden via md:hidden.
 */

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

interface NavVisibilityState {
  top: boolean;
  bottom: boolean;
}

const MOBILE_MAX_WIDTH = 768;

/** Threshold for detecting a small intentional menu reveal gesture (px) */
const HALKA_MIN_PX = 6;
const HALKA_MAX_PX = 70;

/** Distance threshold for regular continuous scrolling (px) */
const CONTINUOUS_SCROLL_PX = 100;

/** Immunity duration after a reveal gesture to prevent momentum scroll from re-hiding (ms) */
const REVEAL_IMMUNITY_MS = 600;

/** Delay after the last movement before considering scrolling stopped (ms) */
const SCROLL_STOP_DEBOUNCE_MS = 180;

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
// Interaction tracking
// ---------------------------------------------------------------------------

let scrollStopTimer: ReturnType<typeof setTimeout> | null = null;
let lastRevealTime = 0;

/** Touch tracking */
let touchActive = false;
let touchStartY = 0;
let touchStartX = 0;
let touchIgnored = false;
let gestureRevealedThisTouch = false;

/** Pointer tracking (mouse drag in responsive mode) */
let pointerActive = false;
let pointerStartY = 0;
let pointerStartX = 0;
let gestureRevealedThisPointer = false;

/** Wheel tracking (trackpad / mousewheel in responsive mode) */
let wheelAccum = 0;
let wheelTimer: ReturnType<typeof setTimeout> | null = null;
let wheelTicks = 0;

/** Native scroll tracking */
let lastScrollY = typeof window !== 'undefined' ? window.scrollY : 0;
let accumulatedScrollDelta = 0;

/** Keyboard tracking */
let keyboardOpen = false;
let keyboardTimer: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isMobile(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < MOBILE_MAX_WIDTH;
}

function shouldIgnoreTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('canvas, input[type="range"], [data-nav-ignore]') !== null;
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

// ---------------------------------------------------------------------------
// Menu actions
// ---------------------------------------------------------------------------

/** Show Top Menu. Does NOT hide Bottom Menu if already visible. */
function revealTop() {
  lastRevealTime = Date.now();
  if (state.top) return;
  setState({ top: true, bottom: state.bottom });
}

/** Show Bottom Menu. Does NOT hide Top Menu if already visible. */
function revealBottom() {
  if (keyboardOpen) return;
  lastRevealTime = Date.now();
  if (state.bottom) return;
  setState({ top: state.top, bottom: true });
}

/** Normal continuous scrolling: hide both menus together. */
function hideBoth() {
  // Respect reveal immunity so small reveal movements aren't immediately killed by momentum
  if (Date.now() - lastRevealTime < REVEAL_IMMUNITY_MS) return;
  if (!state.top && !state.bottom) return;
  setState({ top: false, bottom: false });
}

/** Stop debounce: resets tracking when scrolling has fully stopped. */
function scheduleScrollStop() {
  if (scrollStopTimer !== null) clearTimeout(scrollStopTimer);
  scrollStopTimer = setTimeout(() => {
    scrollStopTimer = null;
    accumulatedScrollDelta = 0;
    // Both menus stay in their current state (no auto-show)
  }, SCROLL_STOP_DEBOUNCE_MS);
}

/** Reset to initial state (used on route change). */
export function resetMobileNavVisibility() {
  touchActive = false;
  pointerActive = false;
  gestureRevealedThisTouch = false;
  gestureRevealedThisPointer = false;
  accumulatedScrollDelta = 0;
  wheelAccum = 0;
  wheelTicks = 0;
  lastRevealTime = 0;
  if (scrollStopTimer !== null) {
    clearTimeout(scrollStopTimer);
    scrollStopTimer = null;
  }
  if (wheelTimer !== null) {
    clearTimeout(wheelTimer);
    wheelTimer = null;
  }
  lastScrollY = typeof window !== 'undefined' ? window.scrollY : 0;
  setState({ ...ALL_VISIBLE });
}

// ---------------------------------------------------------------------------
// Touch Event Handlers (Real Mobile Devices & Touch Emulation)
// ---------------------------------------------------------------------------

function onTouchStart(e: TouchEvent) {
  if (!isMobile()) return;
  if (e.touches.length !== 1) {
    touchIgnored = true;
    return;
  }
  const touch = e.touches[0];
  touchActive = true;
  touchIgnored = shouldIgnoreTarget(e.target);
  touchStartY = touch.clientY;
  touchStartX = touch.clientX;
  gestureRevealedThisTouch = false;

  if (scrollStopTimer !== null) {
    clearTimeout(scrollStopTimer);
    scrollStopTimer = null;
  }
}

function onTouchMove(e: TouchEvent) {
  if (!touchActive || touchIgnored || !isMobile()) return;
  const touch = e.touches[0];
  if (!touch) return;

  const currentY = touch.clientY;
  const currentX = touch.clientX;

  const dy = currentY - touchStartY;
  const dx = currentX - touchStartX;

  // Ignore horizontal swipes (carousels, tabs, tables)
  if (Math.abs(dx) > Math.abs(dy) * 1.5) return;

  const dist = Math.abs(dy);

  // 1. Halka scroll (small intentional movement to reveal appropriate menu)
  if (dist >= HALKA_MIN_PX && dist <= HALKA_MAX_PX) {
    if (!gestureRevealedThisTouch) {
      if (dy > 0) {
        // Finger moved down: upper content comes into view -> Top Menu
        revealTop();
        gestureRevealedThisTouch = true;
      } else if (dy < 0) {
        // Finger moved up: lower content comes into view -> Bottom Menu
        revealBottom();
        gestureRevealedThisTouch = true;
      }
    }
  }

  // 2. Normal continuous scrolling:
  // If user scrolled far (> CONTINUOUS_SCROLL_PX) without a reveal, or kept scrolling past 150px
  if (!gestureRevealedThisTouch && dist >= CONTINUOUS_SCROLL_PX) {
    hideBoth();
  } else if (gestureRevealedThisTouch && dist >= 160) {
    hideBoth();
  }

  scheduleScrollStop();
}

function onTouchEnd() {
  touchActive = false;
  touchIgnored = false;
  gestureRevealedThisTouch = false;
  scheduleScrollStop();
}

// ---------------------------------------------------------------------------
// Pointer Event Handlers (Mouse Drag in Responsive Mode)
// ---------------------------------------------------------------------------

function onPointerDown(e: PointerEvent) {
  if (!isMobile() || e.pointerType === 'touch') return;
  pointerActive = true;
  pointerStartY = e.clientY;
  pointerStartX = e.clientX;
  gestureRevealedThisPointer = false;

  if (scrollStopTimer !== null) {
    clearTimeout(scrollStopTimer);
    scrollStopTimer = null;
  }
}

function onPointerMove(e: PointerEvent) {
  if (!pointerActive || !isMobile() || e.pointerType === 'touch') return;
  const dy = e.clientY - pointerStartY;
  const dx = e.clientX - pointerStartX;
  if (Math.abs(dx) > Math.abs(dy) * 1.5) return;

  const dist = Math.abs(dy);

  // 1. Halka scroll:
  if (dist >= HALKA_MIN_PX && dist <= HALKA_MAX_PX) {
    if (!gestureRevealedThisPointer) {
      if (dy > 0) {
        revealTop();
        gestureRevealedThisPointer = true;
      } else if (dy < 0) {
        revealBottom();
        gestureRevealedThisPointer = true;
      }
    }
  }

  // 2. Normal continuous drag:
  if (!gestureRevealedThisPointer && dist >= CONTINUOUS_SCROLL_PX) {
    hideBoth();
  } else if (gestureRevealedThisPointer && dist >= 160) {
    hideBoth();
  }

  scheduleScrollStop();
}

function onPointerUp(e: PointerEvent) {
  if (e.pointerType === 'touch') return;
  pointerActive = false;
  gestureRevealedThisPointer = false;
  scheduleScrollStop();
}

// ---------------------------------------------------------------------------
// Mouse Wheel / Trackpad (Desktop Browser Testing in Responsive Mode)
// ---------------------------------------------------------------------------

function onWheel(e: WheelEvent) {
  if (!isMobile() || touchActive) return;

  const delta = e.deltaY;
  if (Math.abs(delta) < 1) return;

  wheelAccum += delta;
  wheelTicks += 1;

  if (wheelTimer !== null) clearTimeout(wheelTimer);
  wheelTimer = setTimeout(() => {
    wheelTimer = null;
    wheelAccum = 0;
    wheelTicks = 0;
  }, 200);

  // Fast continuous wheel spinning (> 300px or 4+ continuous ticks) -> normal scrolling
  if (wheelTicks >= 4 || Math.abs(wheelAccum) >= 300) {
    hideBoth();
    scheduleScrollStop();
    return;
  }

  // Single notch or gentle wheel tick (halka scroll):
  if (delta < 0) {
    // Wheel up: upper content comes into view -> Top Menu
    revealTop();
  } else if (delta > 0) {
    // Wheel down: lower content comes into view -> Bottom Menu
    revealBottom();
  }

  scheduleScrollStop();
}

// ---------------------------------------------------------------------------
// Native Window Scroll Event (Momentum Scroll, Scrollbar Drag, Keyboard)
// ---------------------------------------------------------------------------

function onScroll() {
  if (!isMobile()) return;

  const currentY = window.scrollY || 0;
  const delta = currentY - lastScrollY;
  lastScrollY = currentY;

  // Near the top of the page, top menu is always visible
  if (currentY <= 25) {
    revealTop();
    return;
  }

  // If a reveal gesture just happened or user is touching, do not let scroll hide menus
  if (touchActive || Date.now() - lastRevealTime < REVEAL_IMMUNITY_MS || Math.abs(delta) < 1) {
    return;
  }

  accumulatedScrollDelta += delta;

  // Normal continuous scrolling in either direction hides both menus
  if (Math.abs(accumulatedScrollDelta) >= CONTINUOUS_SCROLL_PX) {
    hideBoth();
  } else if (accumulatedScrollDelta <= -HALKA_MIN_PX) {
    // Light scroll up brings upper content into display -> Top Menu
    revealTop();
  } else if (accumulatedScrollDelta >= HALKA_MIN_PX) {
    // Light scroll down brings lower content into display -> Bottom Menu
    revealBottom();
  }

  scheduleScrollStop();
}

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
// Singleton Subscription Management
// ---------------------------------------------------------------------------

function attachListeners() {
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: true });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('touchcancel', onTouchEnd, { passive: true });

  window.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerup', onPointerUp, { passive: true });
  window.addEventListener('pointercancel', onPointerUp, { passive: true });

  window.addEventListener('wheel', onWheel, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true, capture: true });
  window.addEventListener('resize', onResize);
  window.addEventListener('focusin', onFocusIn);
  window.addEventListener('focusout', onFocusOut);
}

function detachListeners() {
  window.removeEventListener('touchstart', onTouchStart);
  window.removeEventListener('touchmove', onTouchMove);
  window.removeEventListener('touchend', onTouchEnd);
  window.removeEventListener('touchcancel', onTouchEnd);

  window.removeEventListener('pointerdown', onPointerDown);
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerUp);

  window.removeEventListener('wheel', onWheel);
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
      if (scrollStopTimer !== null) {
        clearTimeout(scrollStopTimer);
        scrollStopTimer = null;
      }
      if (wheelTimer !== null) {
        clearTimeout(wheelTimer);
        wheelTimer = null;
      }
      if (keyboardTimer !== null) {
        clearTimeout(keyboardTimer);
        keyboardTimer = null;
      }
      touchActive = false;
      pointerActive = false;
      gestureRevealedThisTouch = false;
      gestureRevealedThisPointer = false;
      accumulatedScrollDelta = 0;
      wheelAccum = 0;
      wheelTicks = 0;
      lastRevealTime = 0;
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

  // Every route change starts with both bars visible
  useEffect(() => {
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
