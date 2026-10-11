'use client';

/**
 * Admin shell (Phase 17): sidebar navigation, top bar with the verified user
 * and sign-out, and mobile drawer behavior. Rendered strictly inside the
 * AdminGate — only verified ADMIN/SUPER_ADMIN sessions ever see it.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@tanvion-royale/ui';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { logoutCurrentSession } from '@/lib/api/users';
import { clearSession } from '@/lib/auth/session';
import { ToastProvider } from './toast';
import { AdminGate, useVerifiedAdmin } from './admin-guard';

const NAV_ITEMS: Array<{
  href: string;
  label: string;
  icon: string;
  exact?: boolean;
  permission?: string;
}> = [
  { href: '/admin', label: 'Dashboard', icon: '📊', exact: true, permission: ADMIN_PERMISSIONS.DASHBOARD_READ },
  { href: '/admin/sports', label: 'Sports', icon: '🏆', permission: ADMIN_PERMISSIONS.SPORTS_READ },
  { href: '/admin/partner-providers', label: 'Partner providers', icon: '🔌', permission: ADMIN_PERMISSIONS.PARTNER_PROVIDERS_READ },
  { href: '/admin/casino', label: 'Casino provider', icon: '🎰', permission: ADMIN_PERMISSIONS.CASINO_READ },
  { href: '/admin/betting', label: 'Betting', icon: '🎲', permission: ADMIN_PERMISSIONS.BETTING_READ },
  { href: '/admin/crash', label: 'Sky Rocket', icon: '🚀', permission: ADMIN_PERMISSIONS.CRASH_READ },
  { href: '/admin/wallets', label: 'Wallets', icon: '👛', permission: ADMIN_PERMISSIONS.WALLETS_READ },
  { href: '/admin/payment-gateways', label: 'Payment gateways', icon: '🔐', permission: ADMIN_PERMISSIONS.PAYMENT_GATEWAYS_READ },
  { href: '/admin/payment-methods', label: 'Payment methods', icon: '💳', permission: ADMIN_PERMISSIONS.PAYMENT_METHODS_READ },
  { href: '/admin/manual-deposits', label: 'Deposits', icon: '💰', permission: ADMIN_PERMISSIONS.DEPOSITS_READ },
  { href: '/admin/manual-withdrawals', label: 'Withdrawals', icon: '💸', permission: ADMIN_PERMISSIONS.WITHDRAWALS_READ },
  { href: '/admin/users', label: 'Users', icon: '👥', permission: ADMIN_PERMISSIONS.USERS_READ },
  { href: '/admin/support', label: 'Support', icon: '💬', permission: ADMIN_PERMISSIONS.SUPPORT_READ },
  { href: '/admin/admins', label: 'Admins', icon: '🛡️', permission: ADMIN_PERMISSIONS.ADMINS_READ },
  { href: '/admin/audit-logs', label: 'Audit logs', icon: '🧾', permission: ADMIN_PERMISSIONS.AUDIT_LOGS_READ },
  { href: '/admin/notifications', label: 'Notifications', icon: '🔔', permission: ADMIN_PERMISSIONS.NOTIFICATIONS_READ },
  { href: '/admin/referral', label: 'Referral', icon: '🤝', permission: ADMIN_PERMISSIONS.USERS_READ },
  { href: '/admin/settings', label: 'Settings', icon: '⚙️', permission: ADMIN_PERMISSIONS.SETTINGS_READ },
];

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const admin = useVerifiedAdmin();
  // SUPER_ADMIN-only sections (e.g. admin management) are hidden for everyone
  // else. Visibility is convenience only — the API 403s non-SUPER_ADMIN calls.
  const items = NAV_ITEMS.filter((item) => {
    return (
      !item.permission ||
      admin?.isMasterAdmin ||
      (!!admin && admin.permissions.includes(item.permission))
    );
  });
  return (
    <nav aria-label="Admin sections" className="flex flex-1 flex-col gap-1 px-3 py-4">
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm transition ${
              active
                ? 'bg-teal-500/15 text-teal-300'
                : 'text-slate-400 hover:bg-ink-700 hover:text-slate-100'
            }`}
          >
            <span aria-hidden>{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function AdminShell({ children, userLabel }: { children: ReactNode; userLabel?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const admin = useVerifiedAdmin();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef<HTMLElement | null>(null);

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // While the drawer is open: lock background scroll (with restore on
  // close/unmount) and close on Escape. Skipped on desktop viewports where
  // the drawer never renders, so a resize can never leave the page
  // scroll-locked behind an invisible drawer.
  useEffect(() => {
    if (!drawerOpen) return;
    if (window.matchMedia('(min-width: 1024px)').matches) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setDrawerOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);

    // Move focus into the drawer once it has rendered so keyboard and screen
    // reader users land inside the navigation.
    const focusTimer = window.setTimeout(() => drawerRef.current?.focus(), 0);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(focusTimer);
    };
  }, [drawerOpen]);

  async function onLogout() {
    try {
      await logoutCurrentSession();
    } catch {
      // Session may already be invalid — clear locally regardless.
    }
    clearSession();
    // Staff sign-out lands on the dedicated staff login, not the customer one.
    router.replace('/admin/login');
  }

  const current = NAV_ITEMS.find((item) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href),
  );

  return (
    <div className="flex min-h-screen bg-ink-950">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-ink-700 bg-ink-900 lg:flex">
        <div className="border-b border-ink-700 px-4 py-4">
          <Link href="/admin" className="text-lg font-bold text-white">
            TANVIONROYALE
          </Link>
          <p className="mt-0.5 text-xs uppercase tracking-wide text-slate-500">Admin panel</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <SidebarNav />
        </div>
        <div className="border-t border-ink-700 px-4 py-3 text-xs text-slate-500">
          <Link href="/" className="hover:text-teal-300 hover:underline">
            ← Back to site
          </Link>
        </div>
      </aside>

      {/* Mobile drawer — only the backdrop closes it on tap; taps, scrolls
          and form interactions inside the panel itself must never. */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-black/60"
            onClick={() => setDrawerOpen(false)}
          />
          <aside
            id="admin-mobile-nav"
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Admin navigation"
            tabIndex={-1}
            className="absolute left-0 top-0 flex h-full w-64 max-w-[85vw] flex-col border-r border-ink-700 bg-ink-900 outline-none"
          >
            <div className="flex items-center justify-between gap-2 border-b border-ink-700 px-4 py-4">
              <div className="min-w-0">
                <p className="text-lg font-bold text-white">TANVIONROYALE</p>
                <p className="mt-0.5 text-xs uppercase tracking-wide text-slate-500">Admin panel</p>
              </div>
              <button
                type="button"
                aria-label="Close navigation menu"
                onClick={() => setDrawerOpen(false)}
                className="shrink-0 rounded-md border border-ink-600 p-1.5 text-slate-300 hover:bg-ink-700 hover:text-white"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path
                    d="M6 6l12 12M18 6L6 18"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <SidebarNav onNavigate={() => setDrawerOpen(false)} />
            </div>
            <div className="border-t border-ink-700 px-4 py-3 text-xs text-slate-500">
              <Link href="/" onClick={() => setDrawerOpen(false)} className="hover:text-teal-300 hover:underline">
                ← Back to site
              </Link>
            </div>
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-3 border-b border-ink-700 bg-ink-900/95 px-4 py-3 backdrop-blur">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              className="rounded-md border border-ink-600 p-1.5 text-slate-300 hover:bg-ink-700 hover:text-white lg:hidden"
              aria-label="Open navigation menu"
              aria-controls="admin-mobile-nav"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
            >
              <span aria-hidden>☰</span>
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-white">TANVION ROYALE</p>
              <p className="truncate text-[11px] text-slate-500">
                Admin{current ? ` · ${current.label}` : ''}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {admin && <span className="hidden text-xs text-slate-400 sm:inline">{admin.label}</span>}
            <Button variant="outline" size="sm" onClick={onLogout}>
              Sign out
            </Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
          {current && current.permission && !admin?.isMasterAdmin && !admin?.permissions.includes(current.permission) ? (
            <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 p-4 text-sm text-amber-200">
              403 — You do not have read access to this admin section. Ask a Master Admin to grant{' '}
              <code className="font-mono">{current.permission}</code>.
            </div>
          ) : (
            children
          )}
        </main>
      </div>
    </div>
  );
}

/** Root of the /admin section: guard → shell → page content. */
export function AdminLayoutClient({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <AdminLayoutGate>{children}</AdminLayoutGate>
    </ToastProvider>
  );
}

/**
 * /admin/login sits outside the AdminGate (same ToastProvider) so a
 * session-less staff member can actually reach the sign-in form instead of
 * looping back through the unauthenticated redirect.
 */
function AdminLayoutGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === '/admin/login' || pathname.startsWith('/admin/login/')) {
    return <>{children}</>;
  }
  return (
    <AdminGate>{(user) => <AdminShell userLabel={user.label}>{children}</AdminShell>}</AdminGate>
  );
}
