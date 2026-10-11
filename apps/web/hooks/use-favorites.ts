'use client';

import { useCallback, useEffect, useState } from 'react';

const FAVORITES_KEY = 'ng.favorites';

/**
 * Client-side favorites UI state (localStorage-backed).
 * This is presentation-only — it does not touch auth, wallet, or betting APIs.
 */
export function useFavorites() {
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FAVORITES_KEY);
      if (raw) setFavorites(new Set(JSON.parse(raw) as string[]));
    } catch {
      // corrupted storage — start fresh
    }
    setReady(true);
  }, []);

  const persist = (next: Set<string>) => {
    setFavorites(next);
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]));
    } catch {
      // storage unavailable — favorites stay in-memory
    }
  };

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const isFavorite = useCallback((id: string) => favorites.has(id), [favorites]);

  return { favorites, toggleFavorite, isFavorite, ready };
}