'use client';

import Link from 'next/link';

interface CategoryNavProps {
  categories: readonly string[];
  active: string;
  onSelect: (category: string) => void;
}

/**
 * Horizontally scrollable game category navigation.
 * Desktop: inline navigation row. Mobile: swipeable horizontal scroll
 * (single codebase — no separate mobile markup).
 */
export function CategoryNav({ categories, active, onSelect }: CategoryNavProps) {
  return (
    <nav aria-label="Game categories" className="relative">
      <ul className="no-scrollbar flex items-center gap-2 overflow-x-auto scroll-smooth pb-1">
        {categories.map((category) => {
          const isActive = category === active;
          return (
            <li key={category} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(category)}
                aria-current={isActive ? 'page' : undefined}
                className={`whitespace-nowrap rounded-full px-4 py-2 text-xs font-semibold transition sm:text-sm ${
                  isActive
                    ? 'bg-brand text-ink-950 shadow-[0_0_16px_rgba(20,184,166,0.35)]'
                    : 'bg-ink-800 text-slate-300 hover:bg-ink-700 hover:text-white'
                }`}
              >
                {category}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Static link variant used on the /games landing page. */
export function CategoryLinkNav({ categories }: { categories: readonly string[] }) {
  return (
    <nav aria-label="Game categories">
      <ul className="no-scrollbar flex items-center gap-2 overflow-x-auto scroll-smooth pb-1">
        {categories.map((category) => (
          <li key={category} className="shrink-0">
            <Link
              href={`/games?category=${encodeURIComponent(category)}`}
              className="block whitespace-nowrap rounded-full bg-ink-800 px-4 py-2 text-xs font-semibold text-slate-300 transition hover:bg-ink-700 hover:text-white sm:text-sm"
            >
              {category}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}