'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export interface HeroSlide {
  id: string;
  title: string;
  subtitle: string;
  ctaLabel: string;
  ctaHref: string;
  /** CSS gradient class — original placeholder artwork. */
  image: string;
}

interface HeroBannerProps {
  slides: HeroSlide[];
  /** Auto-rotation interval in ms. */
  interval?: number;
}

/**
 * Reusable hero banner slider: auto rotation, prev/next controls,
 * pagination dots, keyboard accessible, responsive aspect ratios
 * (wide on desktop, shorter on mobile) via CSS breakpoints.
 */
export function HeroBanner({ slides, interval = 5000 }: HeroBannerProps) {
  const [index, setIndex] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const go = useCallback(
    (next: number) => setIndex(((next % slides.length) + slides.length) % slides.length),
    [slides.length],
  );

  useEffect(() => {
    if (slides.length < 2) return;
    timer.current = setInterval(() => setIndex((i) => (i + 1) % slides.length), interval);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [slides.length, interval]);

  if (slides.length === 0) return null;

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured promotions"
      className="relative overflow-hidden rounded-xl border border-white/10 bg-ink-900"
      onMouseEnter={() => timer.current && clearInterval(timer.current)}
      onMouseLeave={() => {
        if (slides.length >= 2) {
          timer.current = setInterval(() => setIndex((i) => (i + 1) % slides.length), interval);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') go(index - 1);
        if (e.key === 'ArrowRight') go(index + 1);
      }}
      tabIndex={0}
    >
      <div className="relative aspect-[16/7] w-full sm:aspect-[16/6] lg:aspect-[21/7]">
        {slides.map((slide, i) => (
          <div
            key={slide.id}
            role="group"
            aria-roledescription="slide"
            aria-label={`${i + 1} of ${slides.length}`}
            aria-hidden={i !== index}
            className={`absolute inset-0 flex flex-col justify-center gap-2 bg-gradient-to-br ${slide.image} p-6 transition-opacity duration-500 sm:p-10 lg:p-14 ${
              i === index ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          >
            <span className="w-fit rounded-full bg-black/30 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-white/90 sm:text-xs">
              TANVIONROYALE
            </span>
            <h2 className="max-w-xl text-xl font-bold text-white drop-shadow sm:text-3xl lg:text-4xl">
              {slide.title}
            </h2>
            <p className="max-w-lg text-xs text-white/85 sm:text-base lg:text-lg">{slide.subtitle}</p>
            <Link
              href={slide.ctaHref}
              tabIndex={i === index ? 0 : -1}
              className="mt-2 w-fit rounded-lg bg-white px-4 py-2 text-xs font-semibold text-ink-900 transition hover:bg-white/90 sm:px-6 sm:py-2.5 sm:text-sm"
            >
              {slide.ctaLabel}
            </Link>
          </div>
        ))}
      </div>

      {/* Prev / next controls */}
      <button
        type="button"
        onClick={() => go(index - 1)}
        aria-label="Previous slide"
        className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white transition hover:bg-black/60"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => go(index + 1)}
        aria-label="Next slide"
        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/40 p-2 text-white transition hover:bg-black/60"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Pagination dots */}
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2" role="tablist" aria-label="Slides">
        {slides.map((slide, i) => (
          <button
            key={slide.id}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={`Go to slide ${i + 1}`}
            onClick={() => go(i)}
            className={`h-1.5 rounded-full transition-all ${i === index ? 'w-6 bg-white' : 'w-2 bg-white/50 hover:bg-white/70'}`}
          />
        ))}
      </div>
    </section>
  );
}