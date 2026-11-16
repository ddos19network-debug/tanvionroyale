'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Shared mobile navigation visibility controller.
 *
 * Coordinates Top Menu and Bottom Menu visibility based on finger swipe
 * gestures, NOT ordinary scroll direction.
 *
 * Behaviour:
 *   - Finger swipe DOWN  → Bottom Menu visible, Top Menu hidden
 *   - Finger swipe UP    → Top Menu visible, Bottom Menu hidden
 *   - Normal scrolling   → Both hidden
 *   - Scroll stop        → Both remain hidden (no auto-reveal)
 *   - Desktop (>=768px)  → Both controlled by their own CSS (sm:hidden)
 *
 * Consumers (AppHeader, BottomNav, TradingShell header, UnifiedProfile
 * header) call this hook and apply the returned visibility booleans to
 * their transform classes.
 */
export function useMobileNavVisibility() {
  const [topVisible, setTopVisible] = useState(true);
  const [bottomVisible, setBottomVisible] = useState(true);

  const touchStartY = useRef<number | null>(null);
  const touchStartTime = useRef<number | null>(null);
  const touchLastY = useRef<number | null>(null);

  /* Configurable threshold: minimum px movement to count as a swipe */
  const SWIPE_THRESHOLD = 30;
  /* Maximum total movement for a gesture to be considered a "short swipe" */
  const MAX_SWIPE_DISTANCE = 200;
  /* Maximum duration (ms) for a gesture to be considered a "short swipe" */
  const MAX_SWIPE_DURATION = 400;

  const showTopOnly = useCallback(() => {
    setTopVisible(true);
    setBottomVisible(false);
  }, []);

  const showBottomOnly = useCallback(() => {
    setTopVisible(false);
    setBottomVisible(true);
  }, []);

  const hideBoth = useCallback(() => {
    setTopVisible(false);
    setBottomVisible(false);
  }, []);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const t = e.touches[0];
    touchStartY.current = t.clientY;
    touchLastY.current = t.clientY;
    touchStartTime.current = performance.now();
  }, []);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    if (window.innerWidth >= 768) return;
    if (touchStartY.current === null) return;

    const t = e.touches[0];
    touchLastY.current = t.clientY;
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (window.innerWidth >= 768) {
      touchStartY.current = null;
      touchLastY.current = null;
      touchStartTime.current = null;
      return;
    }
    if (touchStartY.current === null || touchLastY.current === null || touchStartTime.current === null) {
      touchStartY.current = null;
      touchLastY.current = null;
      touchStartTime.current = null;
      return;
    }

    const deltaY = touchLastY.current - touchStartY.current; // positive = finger moved down
    const absDelta = Math.abs(deltaY);
    const duration = performance.now() - touchStartTime.current;

    // Only treat as intentional short swipe if within bounds
    if (
      absDelta >= SWIPE_THRESHOLD &&
      absDelta <= MAX_SWIPE_DISTANCE &&
      duration <= MAX_SWIPE_DURATION
    ) {
      if (deltaY > 0) {
        // Finger moved DOWN → show Bottom Menu
        showBottomOnly();
      } else {
        // Finger moved UP → show Top Menu
        showTopOnly();
      }
    }
    // Otherwise: normal scrolling → both stay hidden

    touchStartY.current = null;
    touchLastY.current = null;
    touchStartTime.current = null;
  }, [showTopOnly, showBottomOnly]);

  useEffect(() => {
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: true });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  return { topVisible, bottomVisible, showTopOnly, showBottomOnly, hideBoth };
}
