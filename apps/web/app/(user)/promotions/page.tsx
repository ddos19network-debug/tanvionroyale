import type { Metadata } from 'next';
import { AppFooter } from '@/components/layout/app-footer';
import { PromotionTicker } from '@/components/home/PromotionTicker';
import { promotions } from '@/lib/data/promotions';

export const metadata: Metadata = {
  title: 'Promotions — TANVIONROYALE',
  description: 'Current TANVIONROYALE platform promotions and events.',
};

/**
 * Promotions page. Content is general platform messaging only — no monetary
 * bonus claims, since no promotion/bonus system is configured server-side.
 */
export default function PromotionsPage() {
  return (
    <>
      <PromotionTicker />
      <main className="mx-auto max-w-7xl px-4 py-6 pb-24 sm:pb-10">
        <h1 className="text-2xl font-bold text-white sm:text-3xl">Promotions</h1>
        <p className="mt-1 text-sm text-slate-400">
          Platform news, events, and rotating in-game activities.
        </p>
        <ul className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {promotions.map((promotion) => (
            <li key={promotion.id}>
              <article className="overflow-hidden rounded-xl border border-white/10 bg-ink-800 transition duration-200 hover:-translate-y-1 hover:border-brand/60">
                <div className={`relative aspect-[16/7] w-full bg-gradient-to-br ${promotion.image}`}>
                  <span className="absolute left-3 top-3 rounded-md bg-black/40 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/90">
                    {promotion.tag}
                  </span>
                </div>
                <div className="p-4">
                  <h2 className="text-base font-semibold text-white">{promotion.title}</h2>
                  <p className="mt-1 text-sm text-slate-400">{promotion.description}</p>
                </div>
              </article>
            </li>
          ))}
        </ul>
      </main>
      <AppFooter />
    </>
  );
}