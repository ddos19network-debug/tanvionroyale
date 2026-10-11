import { tickerMessages } from '@/lib/data/promotions';

/**
 * Horizontal promotion ticker with pause-on-hover.
 * Server component — the animation is pure CSS (globals.css .ticker-track).
 * Content is general platform messaging; no monetary bonus claims.
 */
export function PromotionTicker() {
  // Render the list twice so the -50% translateX marquee loops seamlessly.
  const items = [...tickerMessages, ...tickerMessages];
  return (
    <div
      className="overflow-hidden border-y border-white/10 bg-ink-800/60 py-2"
      aria-label="Latest announcements"
    >
      <div className="ticker-track flex w-max gap-10" aria-hidden={false}>
        {items.map((message, i) => (
          <span
            key={`${message}-${i}`}
            className="whitespace-nowrap text-xs font-medium text-brand sm:text-sm"
            aria-hidden={i >= tickerMessages.length}
          >
            ★ {message}
          </span>
        ))}
      </div>
    </div>
  );
}