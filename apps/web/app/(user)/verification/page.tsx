'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Card, CardContent, CardHeader, CardTitle, Button } from '@tanvion-royale/ui';
import {
  getVerificationStatus,
  getLoginMethods,
  sendPhoneVerification,
  verifyPhone,
  sendEmailVerificationOtp,
  verifyEmailOtp,
  startFaceVerification,
  disconnectLoginMethod,
  getOAuthLinkUrl,
  type VerificationStatus,
  type LoginMethods,
} from '@/lib/api/verification';
import { useAuth } from '@/src/lib/auth';
import { updateStoredUser } from '@/lib/auth/session';
import { getMe } from '@/lib/api/users';

/** Shared, consistent status badge used across the verification center. */
function StatusPill({
  state,
  label,
}: {
  state: 'verified' | 'pending' | 'rejected' | 'unverified';
  label: string;
}) {
  const styles: Record<typeof state, string> = {
    verified: 'bg-emerald-500/15 text-emerald-300',
    pending: 'bg-amber-500/15 text-amber-300',
    rejected: 'bg-red-500/15 text-red-300',
    unverified: 'bg-ink-700 text-slate-300',
  };
  const icon = state === 'verified' ? '✓' : state === 'pending' ? '…' : state === 'rejected' ? '✕' : '•';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[state]}`}
    >
      <span aria-hidden="true">{icon}</span> {label}
      <span className="sr-only">({state})</span>
    </span>
  );
}

function verificationPill(status: string): { state: 'verified' | 'pending' | 'rejected' | 'unverified'; label: string } {
  switch (status) {
    case 'VERIFIED':
      return { state: 'verified', label: 'Verified' };
    case 'PENDING':
      return { state: 'pending', label: 'Pending' };
    case 'REJECTED':
      return { state: 'rejected', label: 'Not verified' };
    case 'UNAVAILABLE':
      return { state: 'unverified', label: 'No email' };
    default:
      return { state: 'unverified', label: 'Not verified' };
  }
}

/** Resend cooldown shown in the UI — mirrors the backend 60s OTP cooldown. */
const RESEND_COOLDOWN_SECONDS = 60;

function VerificationCenterInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { ready, isAuthenticated } = useAuth();
  const [status, setStatus] = useState<VerificationStatus | null>(null);
  const [methods, setMethods] = useState<LoginMethods | null>(null);
  const [phone, setPhone] = useState('');
  const [phoneOtp, setPhoneOtp] = useState('');
  const [phoneStep, setPhoneStep] = useState<'idle' | 'sent'>('idle');
  const [phoneCooldown, setPhoneCooldown] = useState(0);
  const [emailOtp, setEmailOtp] = useState('');
  const [emailStep, setEmailStep] = useState<'idle' | 'sent'>('idle');
  const [emailCooldown, setEmailCooldown] = useState(0);
  const [emailInfo, setEmailInfo] = useState('');
  const [faceInfo, setFaceInfo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  /** Set when a verification becomes complete during THIS visit (backend-confirmed). */
  const [completedNow, setCompletedNow] = useState(false);

  // Ticks the resend countdowns once per second until they reach zero.
  useEffect(() => {
    if (phoneCooldown <= 0 && emailCooldown <= 0) return;
    const t = setTimeout(() => {
      setPhoneCooldown((s) => (s > 0 ? s - 1 : 0));
      setEmailCooldown((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearTimeout(t);
  }, [phoneCooldown, emailCooldown]);

  const refresh = useCallback(() => {
    getVerificationStatus()
      .then(setStatus)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'));
    getLoginMethods()
      .then(setMethods)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    /*
     * Gate on the auth provider (ready + isAuthenticated), never on a raw
     * localStorage read: while the provider is restoring a session from the
     * refresh token the raw read can transiently be null, and redirecting
     * during that window is exactly the reload bounce this flow must avoid.
     */
    if (!ready) return;
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    refresh();
  }, [ready, isAuthenticated, router, refresh]);

  async function onSendPhone(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await sendPhoneVerification(phone || undefined);
      setPhoneStep('sent');
      setPhoneCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the code');
    } finally {
      setLoading(false);
    }
  }

  async function refreshStoredUser() {
    // After a verification succeeds the stored PublicUser is stale for the
    // rest of the tab. Re-fetch /auth/me and persist it so AuthProvider (which
    // listens for the session-changed event) picks up the new verification
    // state immediately. A transient failure here is non-fatal — the backend
    // remains the source of truth for protected features.
    try {
      const me = await getMe();
      updateStoredUser(me);
    } catch {
      /* non-fatal — verification response already confirmed the state */
    }
  }

  async function onVerifyPhone(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const s = await verifyPhone(phoneOtp);
      setStatus(s);
      setPhoneStep('idle');
      setPhoneOtp('');
      setPhoneCooldown(0);
      // ONE-OF-TWO rule: phone OR email verified -> requirement complete.
      if (s.initialVerificationComplete) setCompletedNow(true);
      await refreshStoredUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  }

  async function onSendEmailOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setEmailInfo('');
    setLoading(true);
    try {
      const res = await sendEmailVerificationOtp();
      setEmailStep('sent');
      setEmailCooldown(RESEND_COOLDOWN_SECONDS);
      setEmailInfo(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the code');
    } finally {
      setLoading(false);
    }
  }

  async function onVerifyEmailOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const s = await verifyEmailOtp(emailOtp);
      setStatus(s);
      setEmailStep('idle');
      setEmailOtp('');
      setEmailCooldown(0);
      setEmailInfo('');
      // ONE-OF-TWO rule: phone OR email verified -> requirement complete.
      if (s.initialVerificationComplete) setCompletedNow(true);
      await refreshStoredUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  }

  // Redirect to the main interface ONLY after the backend has confirmed a
  // verification in this session (never on failure, never on initial load —
  // users coming from Settings must stay on the Verification Center).
  useEffect(() => {
    if (!completedNow) return;
    const t = setTimeout(() => router.replace('/dashboard'), 1500);
    return () => clearTimeout(t);
  }, [completedNow, router]);

  async function onStartFace() {
    setError(null);
    setLoading(true);
    try {
      const s = await startFaceVerification();
      setStatus(s);
      setFaceInfo('Your face verification is under review.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start face verification');
    } finally {
      setLoading(false);
    }
  }

  async function linkProvider(provider: 'google' | 'facebook') {
    setError(null);
    try {
      const url = await getOAuthLinkUrl(provider);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect provider');
    }
  }

  async function onDisconnect(provider: 'PHONE' | 'GOOGLE' | 'FACEBOOK') {
    setError(null);
    try {
      const m = await disconnectLoginMethod(provider);
      setMethods(m);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect');
    }
  }

  useEffect(() => {
    if (params.get('linked')) refresh();
  }, [params, refresh]);

  if (!status) {
    return (
      <Card className="w-full max-w-2xl">
        <CardContent>
          <p className="text-sm text-slate-500">Loading verification status…</p>
        </CardContent>
      </Card>
    );
  }

  const inputClass = 'rounded-md border border-ink-600 px-3 py-2 text-sm';

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-semibold">Verification Center</h1>
        <p className="text-sm text-slate-500">
          Verify your phone OR your email to continue — one of the two is enough. Face verification
          is independent and never blocks access.
        </p>
      </div>

      {status.initialVerificationComplete && (
        <div className="rounded-md bg-emerald-950/50 px-4 py-3" role="status" aria-live="polite">
          <p className="text-sm font-medium text-emerald-300">
            ✓ Verification complete
            {completedNow ? ' — redirecting you to your dashboard…' : ''}
          </p>
          {!completedNow && (
            <p className="mt-1 text-xs text-emerald-400">
              You can verify the remaining method later from Settings → Verification.
            </p>
          )}
          {completedNow && (
            <Button type="button" className="mt-2" onClick={() => router.replace('/dashboard')}>
              Continue to dashboard
            </Button>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      {/* Phone */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Phone Verification
            <StatusPill {...verificationPill(status.phone.status)} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {status.phone.status === 'VERIFIED' ? (
            <p className="text-sm text-emerald-300">
              ✓ Phone verified
              {status.phone.autoVerifiedDuringSignup ? ' automatically during signup' : ''}.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {phoneStep === 'idle' ? (
                <form onSubmit={onSendPhone} className="flex flex-col gap-2">
                  <input
                    type="tel"
                    placeholder={status.phone.phone ?? '+447911123456'}
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className={inputClass}
                  />
                  <Button type="submit" disabled={loading}>
                    {loading ? 'Sending…' : 'Verify phone'}
                  </Button>
                </form>
              ) : (
                <form onSubmit={onVerifyPhone} className="flex flex-col gap-2">
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="6-digit code"
                    value={phoneOtp}
                    onChange={(e) => setPhoneOtp(e.target.value.replace(/\D/g, ''))}
                    className={inputClass}
                  />
                  <Button type="submit" disabled={loading || phoneOtp.length !== 6}>
                    {loading ? 'Verifying…' : 'Submit OTP'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={loading || phoneCooldown > 0}
                    onClick={onSendPhone}
                  >
                    {phoneCooldown > 0
                      ? `Resend available in ${phoneCooldown}s`
                      : 'Resend code'}
                  </Button>
                  <button
                    type="button"
                    className="text-xs text-slate-500 hover:underline focus-visible:underline"
                    onClick={() => {
                      setPhoneStep('idle');
                      setPhoneOtp('');
                    }}
                  >
                    Cancel
                  </button>
                </form>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Email */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Email / Gmail Verification
            <StatusPill {...verificationPill(status.email.status)} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {status.email.status === 'VERIFIED' ? (
            <p className="text-sm text-emerald-300">
              {status.email.email && /@gmail\.com$/i.test(status.email.email)
                ? '✓ Gmail verified automatically'
                : '✓ Email verified'}
              .
            </p>
          ) : status.email.status === 'UNAVAILABLE' ? (
            <p className="text-sm text-slate-500">
              No email address linked. Connect an email or a provider to verify one.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-slate-300">{status.email.email}</p>
              {emailStep === 'idle' ? (
                <form onSubmit={onSendEmailOtp} className="flex flex-col gap-2">
                  <Button type="submit" variant="outline" disabled={loading}>
                    {loading ? 'Sending…' : 'Send code'}
                  </Button>
                </form>
              ) : (
                <form onSubmit={onVerifyEmailOtp} className="flex flex-col gap-2">
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    placeholder="6-digit code"
                    value={emailOtp}
                    onChange={(e) => setEmailOtp(e.target.value.replace(/\D/g, ''))}
                    className={inputClass}
                  />
                  <Button type="submit" disabled={loading || emailOtp.length !== 6}>
                    {loading ? 'Verifying…' : 'Verify email'}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={loading || emailCooldown > 0}
                    onClick={onSendEmailOtp}
                  >
                    {emailCooldown > 0
                      ? `Resend available in ${emailCooldown}s`
                      : 'Resend code'}
                  </Button>
                  <button
                    type="button"
                    className="text-xs text-slate-500 hover:underline focus-visible:underline"
                    onClick={() => {
                      setEmailStep('idle');
                      setEmailOtp('');
                      setEmailInfo('');
                    }}
                  >
                    Cancel
                  </button>
                </form>
              )}
              {emailInfo && <p className="text-sm text-emerald-300">{emailInfo}</p>}
            </div>
          )}
        </CardContent>
      </Card>
{/* Face */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Face Verification
            <StatusPill {...verificationPill(status.face.status)} />
          </CardTitle>
        </CardHeader>
        <CardContent>
          {status.face.status === 'VERIFIED' && (
            <p className="text-sm text-emerald-300">✓ Face verified.</p>
          )}
          {status.face.status === 'PENDING' && (
            <p className="text-sm text-amber-300">
              Pending review. We’ll notify you once it is complete.
            </p>
          )}
          {(status.face.status === 'NOT_STARTED' || status.face.status === 'REJECTED') && (
            <div className="flex flex-col gap-2">
              {status.face.configured ? (
                <p className="text-sm text-slate-300">
                  The identity provider is <code>{status.face.provider}</code>. This is an
                  independent verification step.
                </p>
              ) : (
                <p className="text-sm text-slate-300">
                  Face verification is unavailable — a biometric provider is not configured, so
                  verification is pending manual review. Google / Facebook / phone sign-in does{' '}
                  <span className="font-semibold">not</span> verify your face.
                </p>
              )}
              <Button type="button" variant="outline" onClick={onStartFace} disabled={loading}>
                {loading
                  ? 'Starting…'
                  : status.face.configured
                    ? 'Start Face Verification'
                    : 'Submit for Manual Review'}
              </Button>
              {faceInfo && <p className="text-sm text-emerald-300">{faceInfo}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Login methods */}
      <Card>
        <CardHeader>
          <CardTitle>Login Methods</CardTitle>
        </CardHeader>
        <CardContent>
          {methods && (
            <div className="flex flex-col gap-3">
              {[
                {
                  name: 'Phone',
                  connected: methods.phone.length > 0,
                  multi:
                    methods.phone.length + (methods.google ? 1 : 0) + (methods.facebook ? 1 : 0) >
                    1,
                  connect: () => (window.location.href = '/verification'),
                  disconnect: () => onDisconnect('PHONE'),
                },
                {
                  name: 'Google',
                  connected: methods.google,
                  multi:
                    methods.phone.length + (methods.google ? 1 : 0) + (methods.facebook ? 1 : 0) >
                    1,
                  connect: () => linkProvider('google'),
                  disconnect: () => onDisconnect('GOOGLE'),
                },
                {
                  name: 'Facebook',
                  connected: methods.facebook,
                  multi:
                    methods.phone.length + (methods.google ? 1 : 0) + (methods.facebook ? 1 : 0) >
                    1,
                  connect: () => linkProvider('facebook'),
                  disconnect: () => onDisconnect('FACEBOOK'),
                },
              ].map((m) => (
                <div key={m.name} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{m.name}</span>
                  <span className="flex items-center gap-2">
                    {m.connected ? (
                      <StatusPill state="verified" label="Connected" />
                    ) : (
                      <StatusPill state="unverified" label="Not connected" />
                    )}
                    {m.connected ? (
                      m.multi && (
                        <button
                          type="button"
                          className="text-xs text-red-500 hover:underline focus-visible:underline"
                          onClick={m.disconnect}
                          aria-label={`Disconnect ${m.name}`}
                        >
                          Disconnect
                        </button>
                      )
                    ) : (
                      <button
                        type="button"
                        className="font-medium text-indigo-400 hover:underline focus-visible:underline"
                        onClick={m.connect}
                        aria-label={`Connect ${m.name}`}
                      >
                        Connect
                      </button>
                    )}
                  </span>
                </div>
              ))}
              <p className="text-xs text-slate-400">
                You cannot disconnect your last remaining login method (prevents account lockout).
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}

export default function VerificationCenterPage() {
  return (
    <Suspense fallback={null}>
      <VerificationCenterInner />
    </Suspense>
  );
}