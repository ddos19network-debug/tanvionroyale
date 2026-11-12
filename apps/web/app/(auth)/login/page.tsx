'use client';

import { useState, type FormEvent, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@tanvion-royale/ui';
import { sanitizeNextPath } from '@tanvion-royale/validation';
import { loginWithIdentifier, getOAuthRedirectUrl } from '@/lib/api/auth';
import { saveSession } from '@/lib/auth/session';
import { friendlyAuthError } from '@/lib/auth/errors';
import { ApiClientError } from '@/lib/api/client';

/**
 * Login (unified customer sign-in: email OR phone number + password — one
 * field, one POST /auth/login endpoint). Supports an optional, strictly
 * validated `next` path (e.g. /login?next=/admin/users) so an admin bounced
 * to login returns to the admin page afterwards. The path is sanitized with
 * the shared same-origin-only rule — open redirects are impossible.
 */
function LoginPageInner() {
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
      const session = await loginWithIdentifier(identifier, password);
      saveSession(session);
      // ONE-OF-TWO rule: phone OR email verification completes the initial
      // requirement. Face verification never blocks access.
      const fullyVerified =
        (session.user.phoneVerified || session.user.emailVerified) &&
        session.user.status === 'ACTIVE';
      if (nextPath && fullyVerified) {
        router.push(nextPath);
        return;
      }
      router.push(fullyVerified ? '/dashboard' : '/verification');
    } catch (err) {
      setError(friendlyAuthError(err, 'login'));
    } finally {
      setLoading(false);
    }
  }

  const [oauthUnavailable, setOauthUnavailable] = useState<string | null>(null);

  async function continueWith(provider: 'google' | 'facebook') {
    setError(null);
    setOauthUnavailable(null);
    try {
      const url = await getOAuthRedirectUrl(provider);
      window.location.href = url;
    } catch (err) {
      // 503 = OAuth credentials not configured on the server
      if (err instanceof ApiClientError && err.status === 503) {
        const name = provider.charAt(0).toUpperCase() + provider.slice(1);
        setOauthUnavailable(`${name} login is not configured on this server. Please use email/password login instead.`);
        return;
      }
      setError(friendlyAuthError(err, 'oauth'));
    }
  }

  const inputClass =
    'w-full rounded-md border border-ink-600 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60';

  return (
    <Card className="w-full max-w-md" aria-labelledby="login-heading">
      <CardHeader>
        <CardTitle id="login-heading" className="text-center tracking-wide">LOGIN</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <label htmlFor="login-identifier" className="flex flex-col gap-1 text-sm font-medium">
            Email or Phone Number
            <input
              id="login-identifier"
              name="identifier"
              type="text"
              autoComplete="username"
              required
              placeholder="Email or phone number"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              className={inputClass}
              aria-describedby={error ? 'login-error' : undefined}
            />
          </label>
          <label htmlFor="login-password" className="flex flex-col gap-1 text-sm font-medium">
            Password
            <input
              id="login-password"
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
              <p id="login-error" role="alert" className="text-sm text-red-400">
                {error}
              </p>
            )}
          </div>
          <Button type="submit" disabled={loading} aria-busy={loading}>
            {loading ? 'Signing in…' : 'Login'}
          </Button>
        </form>
        <div className="my-4 flex items-center gap-2 text-xs text-slate-400" role="separator" aria-label="or">
          <span className="h-px flex-1 bg-ink-600" /> OR{' '}
          <span className="h-px flex-1 bg-ink-600" />
        </div>
        <div className="flex flex-col gap-2">
          {oauthUnavailable && (
            <p role="alert" className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/30 rounded px-3 py-2">
              ⚠️ {oauthUnavailable}
            </p>
          )}
          <Button type="button" variant="outline" disabled={loading} onClick={() => continueWith('google')}>
            Continue with Google
          </Button>
          <Button type="button" variant="outline" disabled={loading} onClick={() => continueWith('facebook')}>
            Continue with Facebook
          </Button>
        </div>
        <p className="mt-4 flex flex-col items-center gap-1 text-sm text-slate-500">
          <Link href="/settings" className="hover:underline focus-visible:underline">
            Forgot password?
          </Link>
          <span>
            <Link href="/register" className="font-medium text-indigo-400 hover:underline focus-visible:underline">
              Create account
            </Link>
          </span>
        </p>
      </CardContent>
    </Card>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginPageInner />
    </Suspense>
  );
}
