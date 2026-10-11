'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { searchGames, type Game } from '@/lib/data/games';
import { GameCard } from './GameCard';

interface SearchOverlayProps {
  open: boolean;
  onClose: () => void;
  favorites?: Set<string>;
  onToggleFavorite?: (id: string) => void;
}

/**
 * Global game search overlay. Filters the demo game data by title,
 * provider, and category. Accessible: labelled input, live results
 * region, clear button, Escape to close, focus returned on close.
 */
export function SearchOverlay({ open, onClose, favorites, onToggleFavorite }: SearchOverlayProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  // Same trap as the admin Modal: `onClose` is an inline arrow in the caller
  // so it changes identity on every render (including every keystroke here).
  // It must not be an effect dependency, or effects would re-run per keystroke.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (open) {
      setQuery('');
      inputRef.current?.focus();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const results = useMemo<Game[]>(() => (open ? searchGames(query).slice(0, 12) : []), [query, open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/70 p-4 pt-[10vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Search games"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl overflow-hidden rounded-xl border border-white/10 bg-ink-900 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-white/10 p-3">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="shrink-0 text-slate-400" aria-hidden>
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search games, providers, categories…"
            aria-label="Search games by title, provider, or category"
            className="w-full bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                setQuery('');
                inputRef.current?.focus();
              }}
              className="shrink-0 rounded-md px-2 py-1 text-xs text-slate-400 hover:text-white"
            >
              Clear
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close search"
            className="shrink-0 rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="max-h-[55vh] overflow-y-auto p-3" role="region" aria-live="polite">
          {query.trim() === '' ? (
            <p className="p-4 text-center text-sm text-slate-400">
              Start typing to search the game catalog.
            </p>
          ) : results.length === 0 ? (
            <p className="p-4 text-center text-sm text-slate-400">
              No games found for “{query}”. Try a different title, provider, or category.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {results.map((game) => (
                <li key={game.id} className="min-w-0">
                  <GameCard
                    game={game}
                    favorite={favorites?.has(game.id) ?? false}
                    onToggleFavorite={onToggleFavorite}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}