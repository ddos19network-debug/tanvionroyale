import Link from 'next/link';
import type { Metadata } from 'next';

/**
 * Page metadata for the whole auth group (login / signup / register).
 *
 * It lives in this SERVER layout rather than on the `'use client'` signup
 * page, because a client component may only export a default export.
 */
export const metadata: Metadata = {
  title: 'TANVIONROYALE — Sign in or create an account',
  description: 'Sign in to TANVIONROYALE, or create a free account to start playing.',
  // Auth screens are per-user; never index them.
  robots: { index: false, follow: true },
};

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-ink-950 px-4">
      <Link href="/" className="text-xl font-bold tracking-tight">
        TANVIONROYALE
      </Link>
      {children}
    </div>
  );
}
