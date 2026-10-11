'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, Button, Skeleton } from '@tanvion-royale/ui';
import { useAuth } from '@/src/lib/auth';
import { getMe } from '@/lib/api/users';
import { ApiClientError } from '@/lib/api/client';
import type { PublicUser } from '@tanvion-royale/types';

const KYC_LABEL: Record<string, string> = {
  NOT_STARTED: 'Not started',
  PENDING: 'Pending review',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
  EXPIRED: 'Expired',
  MANUAL_REVIEW: 'Manual review',
};

/** Customer dashboard — the home of the single TANVIONROYALE account. */
export default function DashboardPage() {
  const router = useRouter();
  const { ready, isAuthenticated, fetchUser } = useAuth();
  
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    // Wait for auth to be ready before checking
    if (!ready) {
      return;
    }

    // If not authenticated after auth check, redirect to login
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }

    let cancelled = false;
    setLoading(true);

    // Fetch user data. A DEFINITIVE 401/403 (invalid/revoked session, suspended
    // account) sends the user to login; a transient failure (502/503/504,
    // network) never kicks an authenticated user out of the dashboard.
    getMe()
      .then((me) => {
        if (!cancelled) setUser(me);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
          router.replace('/login');
          return;
        }
        setLoadError('Could not reach the server. Please try again.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [router, ready, isAuthenticated]);

  // Also fetch user when auth state changes
  useEffect(() => {
    if (ready && isAuthenticated && !user) {
      fetchUser();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, isAuthenticated, fetchUser]);

  return (
    <>
      <main className="mx-auto max-w-7xl px-4 py-8">
        <h1 className="text-2xl font-bold">Account overview</h1>
        <p className="mt-1 text-sm text-slate-300">
          Your TANVIONROYALE account — one place for profile, wallet, bets and support.
        </p>

        {loadError && (
          <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-950/50 px-4 py-3" role="status">
            <p className="text-sm font-medium text-amber-300">{loadError}</p>
          </div>
        )}

        {loading ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Skeleton className="h-40" />
            <Skeleton className="h-40" />
          </div>
        ) : user ? (
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Welcome, {user.username}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p>
                  <span className="text-slate-500">Email:</span> {user.email}
                  {!user.emailVerified && (
                    <span className="ml-2 rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">
                      Unverified
                    </span>
                  )}
                </p>
                <p>
                  <span className="text-slate-500">Account status:</span> {user.status}
                </p>
                <p>
                  <span className="text-slate-500">KYC status:</span>{' '}
                  {KYC_LABEL[user.kycStatus] ?? user.kycStatus}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Quick actions</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                <Link href="/wallet">
                  <Button variant="outline" size="sm">
                    Wallet
                  </Button>
                </Link>
                <Link href="/sports">
                  <Button variant="outline" size="sm">
                    Sports
                  </Button>
                </Link>
                <Link href="/my-bets">
                  <Button variant="outline" size="sm">
                    My Bets
                  </Button>
                </Link>
                <Link href="/profile">
                  <Button variant="outline" size="sm">
                    Profile
                  </Button>
                </Link>
                <Link href="/settings">
                  <Button variant="outline" size="sm">
                    Settings
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>
        ) : null}
      </main>
    </>
  );
}
