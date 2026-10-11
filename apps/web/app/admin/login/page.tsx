'use client';

/**
 * Dedicated staff sign-in (Part A).
 *
 * Same Card/Button kit as the customer login page, but one combined
 * Username / Gmail field + password against POST /auth/admin-login. The
 * backend 403s correct credentials that lack ADMIN/SUPER_ADMIN — the copy
 * below states that plainly (generic, no credential-vs-role distinction
 * beyond "staff only"). A validated `next` path returns the admin to the
 * page they were bounced from; otherwise a verified staff session lands on
 * /admin. Customer sessions that somehow open /admin/* are still refused by
 * the backend RolesGuard.
 */
import { useState, type FormEvent, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@tanvion-royale/ui';
import { sanitizeNextPath } from '@tanvion-royale/validation';
import { adminLogin } from '@/lib/api/auth';
import { saveSession } from '@/lib/auth/session';
import { friendlyAdminError } from '@/lib/auth/errors';

function AdminLoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const nextPath = sanitizeNextPath(params.get('next'), '');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const session = await adminLogin(identifier.trim(), password);
      saveSession(session);
      router.push(nextPath || '/admin');
    } catch (err) {
      setError(friendlyAdminError(err));
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    'w-full rounded-md border border-ink-600 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60';

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 px-4">
      <Card className="w-full max-w-md" aria-labelledby="admin-login-heading">
        <CardHeader>
          <CardTitle id="admin-login-heading" className="text-center tracking-wide">
            STAFF LOGIN
          </CardTitle>
          <p className="mt-1 text-center text-xs text-slate-500">
            TANVIONROYALE administration — ADMIN / SUPER_ADMIN accounts only.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
            <label htmlFor="admin-login-identifier" className="flex flex-col gap-1 text-sm font-medium">
              Username / Gmail
              <input
                id="admin-login-identifier"
                name="identifier"
                type="text"
                autoComplete="username"
                required
                placeholder="staff_username or staff@gmail.com"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                className={inputClass}
                aria-describedby={error ? 'admin-login-error' : undefined}
              />
            </label>
            <label htmlFor="admin-login-password" className="flex flex-col gap-1 text-sm font-medium">
              Password
              <input
                id="admin-login-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </label>
            <div aria-live="polite">
              {error && (
                <p id="admin-login-error" role="alert" className="text-sm text-red-400">
                  {error}
                </p>
              )}
            </div>
            <Button type="submit" disabled={loading} aria-busy={loading}>
              {loading ? 'Verifying staff access…' : 'Sign in as staff'}
            </Button>
          </form>
          <p className="mt-4 text-center text-xs text-slate-500">
            Customer account?{' '}
            <Link href="/login" className="font-medium text-indigo-400 hover:underline focus-visible:underline">
              Sign in here
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense fallback={null}>
      <AdminLoginInner />
    </Suspense>
  );
}
