'use client';

import Link from 'next/link';
import { studioHref } from '@/lib/casino/studio-query';

/**
 * Provider (studio) card: logo placeholder, name, real game count, View All.
 *
 * The count and the link are driven by the PUBLIC catalog response
 * (`GET /casino/catalog/providers?product=…`) — i.e. by the providers that are
 * actually ACTIVE and hold games — never by a hard-coded list. The link carries
 * the real provider row id through the shared `studioHref` contract, so it
 * produces exactly the same href as the studio selector and the left menu
 * (`/games?product=<product>&provider=<id>`) and can never drift from them.
 *
 * `logo` stays optional: a real provider has no gradient token, so the brand
 * gradient is used as the same placeholder tile the rest of the UI uses.
 */
export interface ProviderCardEntry {
  id: string;
  name: string;
  gameCount: number;
  logo?: string;
}

interface ProviderCardProps {
  provider: ProviderCardEntry;
  /** `casino` → BIG CASINO, `live` → BIG LIVE CASINO. */
  product?: 'casino' | 'live';
}

const DEFAULT_LOGO = 'from-brand to-ink-800';

/** Provider card: logo placeholder, name, game count, View All link. */
export function ProviderCard({ provider, product = 'casino' }: ProviderCardProps) {
  return (
    <article className="flex flex-col items-center gap-3 rounded-xl border border-white/10 bg-ink-800 p-4 text-center transition duration-200 hover:-translate-y-1 hover:border-brand/60 hover:shadow-[0_8px_30px_rgba(20,184,166,0.15)] sm:p-5">
      <div
        className={`flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br ${provider.logo ?? DEFAULT_LOGO} text-base font-extrabold text-white sm:h-16 sm:w-16 sm:text-lg`}
        aria-hidden
      >
        {provider.name.split(' ').map((word) => word[0]).join('')}
      </div>
      <div className="min-w-0 text-center">
        <h3 className="truncate text-sm font-semibold text-white">{provider.name}</h3>
        <p className="mt-0.5 text-xs text-slate-400">{provider.gameCount} games</p>
      </div>
      <Link
        href={studioHref(product, provider.id)}
        className="mt-auto w-full rounded-lg border border-brand/50 px-3 py-1.5 text-center text-xs font-semibold text-brand transition hover:bg-brand hover:text-ink-950"
      >
        View All
      </Link>
    </article>
  );
}

/**
 * Full studios section — grid on desktop, swipeable row on mobile.
 *
 * Rendered from the same public provider list the studio selector and the left
 * menu use, so a card, a chip and a sidebar row can never disagree.
 *
 * Renders nothing when there are no active providers, so an empty provider row
 * can never take the place of the real games above it.
 */
export function ProvidersSection({
  items,
  product = 'casino',
}: {
  items: readonly ProviderCardEntry[];
  product?: 'casino' | 'live';
}) {
  if (items.length === 0) return null;
  return (
    <section aria-labelledby="providers-heading">
      <h2 id="providers-heading" className="mb-4 text-lg font-bold text-white sm:text-xl">
        Studios
      </h2>
      <ul className="no-scrollbar -mx-1 flex snap-x gap-3 overflow-x-auto px-1 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:overflow-visible sm:px-0 lg:grid-cols-6">
        {items.map((provider) => (
          <li key={provider.id} className="w-40 shrink-0 snap-start sm:w-auto">
            <ProviderCard provider={provider} product={product} />
          </li>
        ))}
      </ul>
    </section>
  );
}