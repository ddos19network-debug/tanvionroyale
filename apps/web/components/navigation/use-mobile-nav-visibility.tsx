'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { usePathname } from 'next/navigation';

/**
 * Shared mobile navigation visibility controller ("headroom" behaviour).
 *
 * ONE store is shared by EVERY mobile top bar (AppHeader, TradingShell header,
 * UnifiedProfile header) and the BottomNav, so all of them always follow the
 * exact same rule and can never disagree with each other.
 *
 * Mobile only (viewport < 768px). Desktop: the controller is inert.
 *
 *   - Page load / route change          -> Top + Bottom visible
 *   - Scroll DOWN (real scrolling)      -> Top + Bottom slide away
 *   - Scroll UP (even a little)         -> Top + Bottom slide back
 *   - Tiny scroll / jitter / bounce     -> nothing changes (no flicker)
 *   - At the very top / very bottom     -> Top + Bottom visible
 *   - Swipe down on a page that cannot
 *     scroll any further                -> Top + Bottom visible
 *   - Typing (input focused)            -> Bottom hides so the keyboard
 *                                          never pushes it over the field
 *
 * While a finger is on the screen the direction comes from the finger itself
 * (works on EVERY page: window scroll, inner scroll containers, pages that
 * cannot scroll). Without a finger (momentum, wheel, keyboard, scripts) it
 * comes from the real scroll position of whatever element scrolled.
 * Touches that start on a chart/canvas/slider/[data-nav-ignore] never move the
 * bars, so trading charts can be dragged freely.
 */

interface NavVisibilityState {
  top: boolean;
  bottom: boolean;
}

const MOBILE_MAX_WIDTH = 768;
/** Scrolling DOWN this many px (in one direction) hides the bars. */
const HIDE_DISTANCE = 28;
/** Scrolling UP this many px (in one direction) shows the bars. */
const SHOW_DISTANCE = 12;
/** Never hide while the page is still this close to the top (header height). */
const MIN_Y_TO_HIDE = 64;
/** Within this many px of the top / bottom edge the bars are always shown. */
const EDGE_PX = 8;
/** Inner scroll containers only count when they are at least this tall (ratio of viewport). */
const MIN_CONTAINER_RATIO = 0.5;

const ALL_VISIBLE: NavVisibilityState = { top: true, bottom: true };

let state: NavVisibilityState = ALL_VISIBLE;
const listeners = new Set<() => void>();

/* Scroll bookkeeping (module level: there is exactly one controller). */
let lastYBySource = new WeakMap<object, number>();
let accumulated = 0; // signed: > 0 scrolling down, < 0 scrolling up
let keyboardOpen = false;
let keyboardTimer: ReturnType<typeof setTimeout> | null = null;

/* Touch bookkeeping. */
let touchActive = false;
let touchLastY = 0;
let touchIgnored = false;
/** The element that scrolls for the current touch (null = the window). */
let touchScroller: Element | null = null;

function isMobileViewport(): boolean {
  return typeof window !== 'undefined' && window.innerWidth < MOBILE_MAX_WIDTH;
}

function setState(next: NavVisibilityState) {
  if (next.top === state.top && next.bottom === state.bottom) return;
  state = next;
  listeners.forEach((listener) => listener());
}

function showBoth() {
  setState({ top: true, bottom: !keyboardOpen });
}

function hideBoth() {
  setState({ top: false, bottom: false });
}

function showTopOnly() {
  setState({ top: true, bottom: state.bottom });
}

function showBottomOnly() {
  setState({ top: state.top, bottom: !keyboardOpen });
}

/** Back to the resting state (used on route change). */
export function resetMobileNavVisibility() {
  lastYBySource = new WeakMap<object, number>();
  accumulated = 0;
  touchActive = false;
  showBoth();
}

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'file', 'image', 'color'].includes(type);
  }
  return (el as HTMLElement).isContentEditable === true;
}

function onFocusIn(e: FocusEvent) {
  if (!isMobileViewport()) return;
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
  // Focus often hops between two fields: wait a beat before bringing the bar back.
  keyboardTimer = setTimeout(() => {
    keyboardTimer = null;
    if (isEditable(document.activeElement)) return;
    keyboardOpen = false;
    setState({ top: state.top, bottom: true });
  }, 120);
}

/** Shared decision: `accumulated` > 0 = scrolling down, < 0 = scrolling up. */
function evaluate(y: number, maxY: number) {
  // Edges: nothing more to reveal / hide.
  if (y <= EDGE_PX || y >= maxY - EDGE_PX) {
    showBoth();
    return;
  }
  if (accumulated >= HIDE_DISTANCE && y > MIN_Y_TO_HIDE) {
    hideBoth();
  } else if (accumulated <= -SHOW_DISTANCE) {
    showBoth();
  }
}

function addToAccumulator(delta: number) {
  // New direction: restart the distance counter (kills jitter).
  if ((delta > 0 && accumulated < 0) || (delta < 0 && accumulated > 0)) accumulated = 0;
  accumulated += delta;
}

function scrollPosition(scroller: Element | null): { y: number; maxY: number } {
  if (scroller) {
    return { y: Math.max(0, scroller.scrollTop), maxY: scroller.scrollHeight - scroller.clientHeight };
  }
  return {
    // Clamp: iOS rubber-band reports negative / overshooting positions.
    y: Math.max(0, window.scrollY),
    maxY: document.documentElement.scrollHeight - window.innerHeight,
  };
}

/** Nearest ancestor that can really scroll vertically (null = the window). */
function findScroller(start: EventTarget | null): Element | null {
  let el = start instanceof Element ? start : null;
  while (el && el !== document.body && el !== document.documentElement) {
    if (el.scrollHeight > el.clientHeight + 1) {
      const overflowY = window.getComputedStyle(el).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') {
        // Tiny inner scrollers (dropdowns, tables) don't drive the page bars.
        return el.clientHeight >= window.innerHeight * MIN_CONTAINER_RATIO ? el : el.parentElement ? findScroller(el.parentElement) : null;
      }
    }
    el = el.parentElement;
  }
  return null;
}

function shouldIgnoreTouch(start: EventTarget | null): boolean {
  if (!(start instanceof Element)) return false;
  return start.closest('canvas, input[type="range"], [data-nav-ignore]') !== null;
}

function onScroll(e: Event) {
  if (!isMobileViewport()) return;
  // A finger is down: onTouchMove decides (avoids counting the same move twice).
  if (touchActive) return;

  const target = e.target;
  const isElement = target instanceof Element;

  // Small inner scrollers (dropdowns, drawers, tables, chat boxes) must not
  // drive the page navigation. Big inner page containers still do.
  if (isElement && (target as Element).clientHeight < window.innerHeight * MIN_CONTAINER_RATIO) return;

  const source: object = isElement ? (target as Element) : window;
  const { y, maxY } = scrollPosition(isElement ? (target as Element) : null);

  const last = lastYBySource.get(source);
  lastYBySource.set(source, y);
  if (last === undefined) return;

  const delta = y - last;
  if (delta === 0) return;

  addToAccumulator(delta);
  evaluate(y, maxY);
}

function onTouchStart(e: TouchEvent) {
  if (!isMobileViewport()) return;
  const touch = e.touches[0];
  if (!touch || e.touches.length > 1) {
    touchIgnored = true; // pinch / multi-touch is never a navigation gesture
    return;
  }
  touchActive = true;
  touchIgnored = shouldIgnoreTouch(e.target);
  touchScroller = findScroller(e.target);
  touchLastY = touch.clientY;
  accumulated = 0;
  lastYBySource = new WeakMap<object, number>(); // momentum starts from a fresh baseline
}

function onTouchMove(e: TouchEvent) {
  if (!touchActive || touchIgnored || !isMobileViewport()) return;
  const touch = e.touches[0];
  if (!touch) return;

  const dy = touch.clientY - touchLastY; // > 0: finger moves DOWN = page scrolls UP
  touchLastY = touch.clientY;
  if (dy === 0) return;

  addToAccumulator(-dy);
  const { y, maxY } = scrollPosition(touchScroller);
  evaluate(y, maxY);
}

function onTouchEnd() {
  touchActive = false;
  touchIgnored = false;
  touchScroller = null;
}

function onResize() {
  if (!isMobileViewport()) showBoth();
}

function attachListeners() {
  window.addEventListener('touchstart', onTouchStart, { passive: true });
  window.addEventListener('touchmove', onTouchMove, { passive: true });
  window.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('touchcancel', onTouchEnd, { passive: true });
  // Capture phase: scroll events from inner scroll containers do not bubble.
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
      if (keyboardTimer !== null) {
        clearTimeout(keyboardTimer);
        keyboardTimer = null;
      }
      keyboardOpen = false;
      accumulated = 0;
      touchActive = false;
    }
  };
}

function getSnapshot(): NavVisibilityState {
  return state;
}

function getServerSnapshot(): NavVisibilityState {
  return ALL_VISIBLE;
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
  const showAll = useCallback(() => showBoth(), []);
  const hide = useCallback(() => hideBoth(), []);

  return {
    topVisible: current.top,
    bottomVisible: current.bottom,
    showTopOnly: showTop,
    showBottomOnly: showBottom,
    showBoth: showAll,
    hideBoth: hide,
  };
}