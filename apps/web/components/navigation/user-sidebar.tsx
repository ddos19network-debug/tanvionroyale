'use client';

/**
 * Desktop left sidebar for the normal user-facing application.
 *
 * Rendered by the root layout as a flex sibling of the page content. It is
 * shown ONLY on user-panel routes (see isUserPanelRoute in ./user-nav) — that
 * includes the platform home `/`, which lives in the `(user)` route group —
 * never inside the Admin panel (which keeps its own AdminShell sidebar),
 * never on the auth screens or static pages, and never on mobile —
 * `hidden … lg:flex` keeps it at the lg (1024px+) desktop breakpoint while
 * mobile keeps the existing top-right hamburger menu.
 *
 * Active-route highlighting reads the REAL current route (pathname + the
 * /games catalog category query) via the shared user-nav predicates, so
 * nested routes keep their parent menu item highlighted.
 */
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { LogoMark } from '@/components/brand/logo';
import { NavIcon } from './nav-icon';
import { UnreadBadge } from '@/components/notifications/unread-badge';
import { StudioSidebarNav } from './studio-sidebar-nav';
import {
  normalizeStudio,
  studioProductFromQuery,
} from '@/lib/casino/studio-query';
import { isUserPanelRoute, userNavSections } from './user-nav';
import type { UserNavItem } from './user-nav';

export function UserSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const category = searchParams.get('category');
  const product = searchParams.get('product');

  // The studio submenu follows the product the user is actually looking at
  // (`?product=live` → live studios), so BIG CASINO and BIG LIVE CASINO are
  // never mixed in the menu.
  const studioProduct = studioProductFromQuery(product);
  const currentStudio = normalizeStudio(searchParams.get('provider'));

  // Not a user-panel route (admin/auth/landing/static) → render nothing so
  // the existing single-column layout (and the Admin shell) is untouched.
  if (!isUserPanelRoute(pathname)) return null;

  return (
    <aside
      aria-label="User navigation"
      className="hidden w-60 shrink-0 flex-col border-r border-ink-700 bg-ink-900 lg:flex"
    >
      {/* Brand header — identical crest/wordmark system used in the app header. */}
      <div className="border-b border-ink-700 px-4 py-4">
        <Link
          href="/"
          aria-label="TANVIONROYALE home"
          className="flex items-center gap-2"
        >
          <LogoMark className="h-8 w-8" gradientId="tr-user-sidebar" />
          <span className="min-w-0 truncate text-base font-extrabold tracking-tight text-white">
            TANVIONROYALE
          </span>
        </Link>
      </div>

      <div className="flex-1 overflow-y-auto">
        {userNavSections.map((section) => {
          /*
           * The studios submenu is attached to the section that already holds
           * the Games entries, so it reads as their child:
           *   Games → All Studios / <every active studio>
           * The section list itself is untouched — this only decides WHERE the
           * dynamic block is injected.
           */
          const ownsGames = section.items.some((item) =>
            typeof item.href === 'string' && item.href.startsWith('/games'),
          );
          return (
            <div key={section.title} className="pt-2">
              <p className="px-4 py-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                {section.title}
              </p>
              <nav
                aria-label={`${section.title} navigation`}
                className="flex flex-col gap-0.5 px-2"
              >
                {section.items.map((item) => (
                  <SidebarItem
                    key={item.key}
                    item={item}
                    pathname={pathname}
                    category={category}
                    product={product}
                  />
                ))}
              </nav>

              {/*
                DYNAMIC STUDIOS — the same public provider list the Home / Games
                selector shows. It adds navigation only: every entry is a real
                `/games?product=…&provider=…` link, and no studio name or id is
                written in the frontend.
              */}
              {ownsGames ? (
                <StudioSidebarNav
                  product={studioProduct}
                  pathname={pathname}
                  currentProvider={currentStudio}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="border-t border-ink-700 px-4 py-3 text-[11px] text-slate-500">
        User panel
      </div>
    </aside>
  );
}

function SidebarItem({
  item,
  pathname,
  category,
  product,
}: {
  item: UserNavItem;
  pathname: string;
  category: string | null;
  product: string | null;
}) {
  const active = item.active(pathname, category, product);

  // Feature does not exist on the platform yet — render an honest disabled
  // state instead of a fake route.
  if (item.href === null) {
    return (
      <span
        title={item.note}
        className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-3 py-2 text-sm text-slate-600 opacity-70"
      >
        <NavIcon d={item.icon} />
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
        <span className="rounded bg-ink-700 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500">
          Unavailable
        </span>
        {item.note ? <span className="sr-only">, {item.note}</span> : null}
      </span>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? 'page' : undefined}
      title={item.note}
      className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60 focus-visible:ring-offset-2 ${
        active
          ? 'bg-teal-500/15 text-teal-300'
          : 'text-slate-400 hover:bg-ink-700 hover:text-slate-100'
      }`}
    >
      <NavIcon d={item.icon} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.key === 'notification' ? <UnreadBadge /> : null}
    </Link>
  );
}