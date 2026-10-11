'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@tanvion-royale/ui';
import { saveSession, getSession } from '@/lib/auth/session';
import { getOrStartExchange, hasExchangeCompleted, markExchangeCompleted } from '@/lib/auth/oauth-callback';
import { friendlyAuthError } from '@/lib/auth/errors';

/**
 * OAuth landing page. The API redirects here with a short-lived ONE-TIME
 * exchange code (never tokens in the URL). The code is exchanged for the
 * regular token pair and the session is stored like any other login. The
 * code is stripped from the URL as soon as it has been used.
 */
function OAuthCallbackInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    const code = params.get('code');

    // No code in the URL: either a completed exchange whose URL was already
    // cleaned, or a stray visit. A stored session means "already completed".
    if (!code) {
      if (getSession()) {
        setCompleted(true);
        const t = setTimeout(() => router.replace('/dashboard'), 800);
        return () => clearTimeout(t);
      }
      setError('We could not complete the sign-in. Please try again.');
      return;
    }

    // Already exchanged this exact code earlier in this tab: never re-POST.
    if (hasExchangeCompleted(code)) {
      setCompleted(true);
      window.history.replaceState(null, '', window.location.pathname);
      const t = setTimeout(() => router.replace('/dashboard'), 800);
      return () => clearTimeout(t);
    }

    let cancelled = false;
    getOrStartExchange(code)
      .then((session) => {
        if (cancelled) return;
        saveSession(session);
        markExchangeCompleted(code);
        // Strip the one-time code from history BEFORE navigating.
        window.history.replaceState(null, '', window.location.pathname);
        setCompleted(true);
        // ONE-OF-TWO rule: Google/Facebook users whose provider-verified email
        // is already marked verified go straight to the dashboard; everyone
        // else completes phone OR email verification on /verification. The
        // OAuth exchange itself is untouched.
        const fullyVerified =
          (session.user.phoneVerified || session.user.emailVerified) &&
          session.user.status === 'ACTIVE';
        router.replace(fullyVerified ? '/dashboard' : '/verification');
      })
      .catch((err) => {
        if (!cancelled) setError(friendlyAuthError(err, 'oauth'));
      });
    return () => {
      cancelled = true;
    };
    // NOTE: depend on the code VALUE only - searchParams object identity
    // changes must not restart the exchange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('code'), router]);

  return (
    <Card className="w-full max-w-md" aria-labelledby="oauth-heading" aria-busy={!error}>
      <CardHeader>
        <CardTitle id="oauth-heading">
          {error ? 'Sign-in problem' : completed ? 'Signed in' : 'Completing sign-in…'}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div aria-live="polite">
          {error ? (
            <p role="alert" className="text-sm text-red-400">
              {error}
            </p>
          ) : completed ? (
            <p className="text-sm text-slate-500">Sign-in already completed. Redirecting…</p>
          ) : (
            <p className="text-sm text-slate-500">Please wait while we sign you in.</p>
          )}
        </div>
        {error && (
          <a
            href="/login"
            className="mt-3 inline-block text-sm font-medium text-indigo-400 hover:underline focus-visible:underline"
          >
            Back to login
          </a>
        )}
      </CardContent>
    </Card>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense fallback={null}>
      <OAuthCallbackInner />
    </Suspense>
  );
}
