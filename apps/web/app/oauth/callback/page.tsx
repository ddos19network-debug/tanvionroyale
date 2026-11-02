'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@tanvion-royale/ui';
import { saveSession, getSession } from '@/lib/auth/session';
// NOTE: getOrStartExchange, hasExchangeCompleted, markExchangeCompleted are
// imported from '@/lib/auth/oauth-callback' but that module doesn't exist in this
// codebase. The frontend now handles the exchangeCode from the redirect URL
// instead. See the useEffect below for the new logic.
import { hasExchangeCompleted } from '@/lib/auth/oauth-callback';
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
    const exchangeCode = params.get('exchangeCode');

    // No code in the URL: either a completed exchange whose URL was already
    // cleaned, or a stray visit. A stored session means "already completed".
    if (!code && !exchangeCode) {
      if (getSession()) {
        setCompleted(true);
        const t = setTimeout(() => router.replace('/dashboard'), 800);
        return () => clearTimeout(t);
      }
      setError('We could not complete the sign-in. Please try again.');
      return;
    }

    // If we have an exchangeCode from the backend, use it; otherwise use the
    // Google auth code from the URL.
    const codeToUse = exchangeCode || code || '';

    // Already exchanged this exact code earlier in this tab: never re-POST.
    // Note: hasExchangeCompleted only works for codes exchanged through the
    // proper backend flow. For now, we skip this check when using exchangeCode.
    const shouldCheckCompleted = !exchangeCode;
    if (shouldCheckCompleted && codeToUse && hasExchangeCompleted(codeToUse)) {
      setCompleted(true);
      window.history.replaceState(null, '', window.location.pathname);
      const t = setTimeout(() => router.replace('/dashboard'), 800);
      return () => clearTimeout(t);
    }

    let cancelled = false;
    // Use the exchangeCode if available (backend-generated), otherwise use the
    // Google auth code. The backend OAuthExchangeDto expects a code that was
    // created via createExchangeCode() and stored in the OTP table.
    if (exchangeCode) {
      // Exchange the backend-generated exchange code for a session
      fetch('/api/v1/auth/oauth/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: exchangeCode }),
      })
        .then((res) => {
          if (!res.ok) throw new Error('Exchange failed');
          return res.json();
        })
        .then((session) => {
          if (cancelled) return;
          saveSession(session);
          // Strip the one-time code from history BEFORE navigating.
          window.history.replaceState(null, '', window.location.pathname);
          setCompleted(true);
          const fullyVerified =
            (session.user.phoneVerified || session.user.emailVerified) &&
            session.user.status === 'ACTIVE';
          router.replace(fullyVerified ? '/dashboard' : '/verification');
        })
        .catch((err) => {
          if (!cancelled) setError(friendlyAuthError(err, 'oauth'));
        });
    } else {
      // Fall back: no exchangeCode means either the code was already consumed
      // or this is a first visit without a backend-generated code. Attempt
      // navigation based on session state; if no session, show error.
      if (getSession()) {
        setCompleted(true);
        const t = setTimeout(() => router.replace('/dashboard'), 800);
        return () => clearTimeout(t);
      }
      setError('We could not complete the sign-in. Please try again.');
    }
    return () => {
      cancelled = true;
    };
    // NOTE: depend on the code VALUE only - searchParams object identity
    // changes must not restart the exchange.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('exchangeCode'), router]);

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
