import Link from 'next/link';
import { LogoMark } from '@/components/brand/logo';

const FOOTER_SECTIONS = [
  {
    heading: 'Platform',
    links: [
      { href: '/', label: 'Home' },
      { href: '/games', label: 'Games' },
      { href: '/sports', label: 'Sports' },
      { href: '/live', label: 'Live' },
    ],
  },
  {
    heading: 'Account',
    links: [
      { href: '/profile', label: 'Profile' },
      { href: '/favorites', label: 'Favorites' },
      { href: '/my-bets', label: 'My Bets' },
      { href: '/wallet', label: 'Wallet' },
    ],
  },
  {
    heading: 'More',
    links: [
      { href: '/promotions', label: 'Promotions' },
      { href: '/support', label: 'Support' },
      { href: '/settings', label: 'Settings' },
      { href: '/health', label: 'System status' },
    ],
  },
  {
    heading: 'Legal',
    links: [
      { href: '/privacy', label: 'Privacy Policy' },
      { href: '/terms', label: 'Terms of Service' },
      { href: '/account-deletion', label: 'Account Deletion' },
    ],
  },
];

/** TANVIONROYALE footer — original branding, responsive columns. */
export function AppFooter() {
  return (
    <footer className="mt-12 border-t border-white/10 bg-ink-950">
      <div className="mx-auto grid max-w-7xl gap-8 px-4 py-10 sm:grid-cols-2 lg:grid-cols-5">
        <div>
          <div className="flex items-center gap-2">
            <LogoMark className="h-8 w-8" gradientId="tr-footer-mark" />
            <span className="text-lg font-extrabold text-white">
              TANVIONROYALE
            </span>
          </div>
          <p className="mt-3 max-w-xs text-xs leading-relaxed text-slate-400">
            TANVIONROYALE — all in one place. Browse games and sports in one modern platform.
            Entertainment catalog only — this demo interface does not process real-money transactions.
          </p>
        </div>
        {FOOTER_SECTIONS.map((section) => (
          <nav key={section.heading} aria-label={`Footer: ${section.heading}`}>
            <h3 className="text-sm font-semibold text-white">{section.heading}</h3>
            <ul className="mt-3 space-y-2">
              {section.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="text-xs text-slate-400 transition hover:text-brand sm:text-sm">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-white/10 py-4 pb-24 text-center text-[11px] text-slate-500 sm:pb-4">
        © {new Date().getFullYear()} TANVIONROYALE. All rights reserved. 18+ · Play responsibly.
      </div>
    </footer>
  );
}