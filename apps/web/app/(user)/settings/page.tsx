'use client';

/**
 * Settings — Account & Security / Verification center (master prompt Parts 1–25).
 *
 * Sections: Account information · Email · Phone · Verification · KYC ·
 * Password · Active sessions. Every status shown here is the raw
 * server-authoritative state from /verification/status and /users/me — the
 * client NEVER derives VERIFIED from the presence of a value, and KYC state is
 * display-only (no customer write path exists or is faked).
 *
 * Pinned contracts (apps/web/scripts/test-form-flow.cjs): the handlers
 * `onChangePassword` and `onRevoke` keep their exact names and success/error
 * ordering. Every new handler follows the same mutation contract: busy guard →
 * await API → success transition (close/clear + refresh + notice) → catch keeps
 * the form open with the server error → finally restores the busy flag.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, Button, Skeleton } from '@tanvion-royale/ui';
import { changePassword, listSessions, revokeSession, getMe } from '@/lib/api/users';
import {
  getVerificationStatus,
  getLoginMethods,
  sendPhoneVerification,
  verifyPhone,
  sendEmailVerificationOtp,
  verifyEmailOtp,
  setEmail,
  removeEmail,
  removePhone,
  type VerificationStatus,
  type LoginMethods,
} from '@/lib/api/verification';
import { useAuth } from '@/src/lib/auth';
import { ApiClientError } from '@/lib/api/client';
import type { PublicUser, SessionInfo } from '@tanvion-royale/types';

/** Shared, consistent status pill (same visual language as /verification). */
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
  const icon =
    state === 'verified' ? '✓' : state === 'pending' ? '…' : state === 'rejected' ? '✕' : '•';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[state]}`}
    >
      <span aria-hidden="true">{icon}</span> {label}
      <span className="sr-only">({state})</span>
    </span>
  );
}

/** Maps a backend verification/email/phone status onto the shared pill. */
function statusPill(status: string): {
  state: 'verified' | 'pending' | 'rejected' | 'unverified';
  label: string;
} {
  switch (status) {
    case 'VERIFIED':
      return { state: 'verified', label: 'Verified' };
    case 'PENDING':
      return { state: 'pending', label: 'Pending' };
    case 'UNAVAILABLE':
      return { state: 'unverified', label: 'No email' };
    default:
      return { state: 'unverified', label: 'Not verified' };
  }
}

/** Maps the backend KycStatus enum onto the shared pill (display only). */
function kycPill(status: string): {
  state: 'verified' | 'pending' | 'rejected' | 'unverified';
  label: string;
} {
  switch (status) {
    case 'VERIFIED':
      return { state: 'verified', label: 'Verified' };
    case 'PENDING':
      return { state: 'pending', label: 'Pending' };
    case 'MANUAL_REVIEW':
      return { state: 'pending', label: 'Manual review' };
    case 'REJECTED':
      return { state: 'rejected', label: 'Rejected' };
    case 'EXPIRED':
      return { state: 'unverified', label: 'Expired' };
    default:
      return { state: 'unverified', label: 'Not started' };
  }
}

const fieldClass = 'rounded-md border border-ink-600 px-3 py-2 text-sm';

/** Security settings */
export default function SettingsPage() {
  const router = useRouter();
  const { ready, isAuthenticated } = useAuth();
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [verification, setVerification] = useState<VerificationStatus | null>(null);
  const [methods, setMethods] = useState<LoginMethods | null>(null);
  const [me, setMe] = useState<PublicUser | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [changing, setChanging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ---- Email section state ----
  const [emailEditMode, setEmailEditMode] = useState<'idle' | 'edit'>('idle');
  const [emailValue, setEmailValue] = useState('');
  const [emailPassword, setEmailPassword] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);
  const [emailOtpStep, setEmailOtpStep] = useState<'idle' | 'sent'>('idle');
  const [emailOtp, setEmailOtp] = useState('');
  const [emailOtpBusy, setEmailOtpBusy] = useState(false);
  const [emailOtpSending, setEmailOtpSending] = useState(false);
  const [emailOtpError, setEmailOtpError] = useState<string | null>(null);
  const [emailRemoveOpen, setEmailRemoveOpen] = useState(false);
  const [emailRemovePassword, setEmailRemovePassword] = useState('');
  const [emailRemoveBusy, setEmailRemoveBusy] = useState(false);
  const [emailRemoveError, setEmailRemoveError] = useState<string | null>(null);

  // ---- Phone section state ----
  const [phoneEditMode, setPhoneEditMode] = useState<'idle' | 'edit'>('idle');
  const [phoneValue, setPhoneValue] = useState('');
  const [phoneBusy, setPhoneBusy] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneNotice, setPhoneNotice] = useState<string | null>(null);
  const [phoneOtpStep, setPhoneOtpStep] = useState<'idle' | 'sent'>('idle');
  const [phoneOtp, setPhoneOtp] = useState('');
  const [phoneOtpBusy, setPhoneOtpBusy] = useState(false);
  const [phoneOtpSending, setPhoneOtpSending] = useState(false);
  const [phoneOtpError, setPhoneOtpError] = useState<string | null>(null);
  const [phoneRemoveOpen, setPhoneRemoveOpen] = useState(false);
  const [phoneRemovePassword, setPhoneRemovePassword] = useState('');
  const [phoneRemoveBusy, setPhoneRemoveBusy] = useState(false);
  const [phoneRemoveError, setPhoneRemoveError] = useState<string | null>(null);

  // ---- KYC section state (display + honest availability notice) ----
  const [kycInfo, setKycInfo] = useState<string | null>(null);

  /** Re-reads every server-authoritative slice this page displays. */
  async function refresh(): Promise<void> {
    const [status, loginMethods, account] = await Promise.all([
      getVerificationStatus(),
      getLoginMethods(),
      getMe(),
    ]);
    setVerification(status);
    setMethods(loginMethods);
    setMe(account);
  }

  useEffect(() => {
    if (!ready) return;
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    let cancelled = false;
    setLoading(true);
    listSessions()
      .then((items) => { if (!cancelled) setSessions(items); })
      .catch((err) => {
        if (cancelled) return;
        // Only a definitive auth rejection sends the user to /login; a
        // transient backend failure (cold start / gateway) must not.
        if (err instanceof ApiClientError && (err.status === 401 || err.status === 403)) {
          router.replace('/login');
          return;
        }
        setError('Could not load your sessions. The server may be starting up — try again in a moment.');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    refresh().catch(() => undefined);
    return () => { cancelled = true; };
  }, [router, ready, isAuthenticated]);

  async function onChangePassword(e: FormEvent) {
    e.preventDefault();
    // Double-submit guard (Part 35).
    if (changing) return;
    setMessage(null);
    setError(null);
    setChanging(true);
    try {
      await changePassword(currentPassword, newPassword);
      // SUCCESS: clear the sensitive fields only here, then revalidate the
      // session list. A FAILURE preserves both password fields for retry.
      setMessage('Password changed. Other sessions have been signed out.');
      setCurrentPassword('');
      setNewPassword('');
      setSessions(await listSessions());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setChanging(false);
    }
  }

  async function onRevoke(sessionId: string) {
    setError(null);
    try {
      await revokeSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke session');
    }
  }

  /**
   * KYC (Parts 13–16): status is display-only, and no submission workflow /
   * provider exists in the backend today — so the Start action reports that
   * honestly instead of faking a PENDING or VERIFIED state.
   */
  function onStartKyc() {
    setKycInfo('KYC verification is currently unavailable.');
  }

  // ---- Email handlers ----

  function openEmailEdit() {
    setEmailError(null);
    setEmailNotice(null);
    setEmailValue(verification?.email.email ?? '');
    setEmailPassword('');
    setEmailRemoveOpen(false);
    setEmailEditMode('edit');
  }

  function cancelEmailEdit() {
    if (emailBusy) return;
    setEmailEditMode('idle');
    setEmailValue('');
    setEmailPassword('');
    setEmailError(null);
  }

  /** Add (no email yet) or change (email exists) — never verifies by itself. */
  async function onSubmitEmail(e: FormEvent) {
    e.preventDefault();
    if (emailBusy) return; // double-submit guard
    setEmailError(null);
    setEmailNotice(null);
    setEmailBusy(true);
    try {
      const next = await setEmail(emailValue.trim(), emailPassword);
      // SUCCESS: close the form, clear the sensitive field, refresh server
      // state, and surface the pending-verification result.
      setVerification(next);
      setEmailEditMode('idle');
      setEmailValue('');
      setEmailPassword('');
      const [loginMethods, account] = await Promise.all([getLoginMethods(), getMe()]);
      setMethods(loginMethods);
      setMe(account);
      setEmailNotice(
        'Email saved. Verification required — send a code below to verify the new address.',
      );
      setEmailOtpStep('idle');
    } catch (err) {
      // FAILURE: form stays open with the entered values + server error.
      setEmailError(err instanceof Error ? err.message : 'Failed to save the email address');
    } finally {
      setEmailBusy(false);
    }
  }

  async function onSendEmailOtp() {
    if (emailOtpSending) return;
    setEmailOtpError(null);
    setEmailNotice(null);
    setEmailOtpSending(true);
    try {
      await sendEmailVerificationOtp();
      setEmailOtpStep('sent');
      setEmailNotice('If the email address is valid, a verification code has been sent.');
    } catch (err) {
      // Resend cooldown / provider errors surface exactly as the server
      // reports them (60s cooldown enforced server-side).
      setEmailOtpError(err instanceof Error ? err.message : 'Could not send the code');
    } finally {
      setEmailOtpSending(false);
    }
  }

  async function onSubmitEmailOtp(e: FormEvent) {
    e.preventDefault();
    if (emailOtpBusy) return;
    setEmailOtpError(null);
    setEmailOtpBusy(true);
    try {
      const next = await verifyEmailOtp(emailOtp.trim());
      setVerification(next);
      setEmailOtp('');
      setEmailOtpStep('idle');
      setEmailNotice('Email verified.');
      const account = await getMe();
      setMe(account);
    } catch (err) {
      setEmailOtpError(err instanceof Error ? err.message : 'Invalid or expired code');
    } finally {
      setEmailOtpBusy(false);
    }
  }

  async function onSubmitRemoveEmail(e: FormEvent) {
    e.preventDefault();
    if (emailRemoveBusy) return;
    setEmailRemoveError(null);
    setEmailRemoveBusy(true);
    try {
      const next = await removeEmail(emailRemovePassword);
      setVerification(next);
      setEmailRemoveOpen(false);
      setEmailRemovePassword('');
      setEmailOtpStep('idle');
      setEmailNotice('Email removed from this account.');
      const [loginMethods, account] = await Promise.all([getLoginMethods(), getMe()]);
      setMethods(loginMethods);
      setMe(account);
    } catch (err) {
      // The server safety rule (last login/recovery path) is surfaced verbatim.
      setEmailRemoveError(err instanceof Error ? err.message : 'Failed to remove the email');
    } finally {
      setEmailRemoveBusy(false);
    }
  }

  // ---- Phone handlers ----

  function openPhoneEdit() {
    setPhoneError(null);
    setPhoneNotice(null);
    setPhoneValue('');
    setPhoneRemoveOpen(false);
    setPhoneEditMode('edit');
  }

  function cancelPhoneEdit() {
    if (phoneBusy) return;
    setPhoneEditMode('idle');
    setPhoneValue('');
    setPhoneError(null);
  }

  /**
   * Add or change the phone through the EXISTING verification flow: the number
   * is stored unverified by the server and ONLY a successful OTP to that exact
   * number ever marks it VERIFIED (Parts 9/10).
   */
  async function onSubmitPhone(e: FormEvent) {
    e.preventDefault();
    if (phoneBusy) return; // double-submit guard
    setPhoneError(null);
    setPhoneNotice(null);
    setPhoneBusy(true);
    try {
      await sendPhoneVerification(phoneValue.trim() || undefined);
      // SUCCESS: close the number form, refresh, and open the OTP step.
      setPhoneEditMode('idle');
      setPhoneValue('');
      setPhoneOtp('');
      setPhoneOtpStep('sent');
      setPhoneNotice('If the number is valid, a verification code has been sent.');
      await refresh();
    } catch (err) {
      // FAILURE: form stays open with the entered number + server error.
      setPhoneError(err instanceof Error ? err.message : 'Could not send the code');
    } finally {
      setPhoneBusy(false);
    }
  }

  /** Sends a code to the CURRENT (still unverified) number. */
  async function onSendPhoneOtp() {
    if (phoneOtpSending) return;
    setPhoneOtpError(null);
    setPhoneNotice(null);
    setPhoneOtpSending(true);
    try {
      await sendPhoneVerification();
      setPhoneOtpStep('sent');
      setPhoneNotice('If the number is valid, a verification code has been sent.');
    } catch (err) {
      setPhoneOtpError(err instanceof Error ? err.message : 'Could not send the code');
    } finally {
      setPhoneOtpSending(false);
    }
  }

  async function onSubmitPhoneOtp(e: FormEvent) {
    e.preventDefault();
    if (phoneOtpBusy) return;
    setPhoneOtpError(null);
    setPhoneOtpBusy(true);
    try {
      const next = await verifyPhone(phoneOtp.trim());
      setVerification(next);
      setPhoneOtp('');
      setPhoneOtpStep('idle');
      setPhoneNotice('Phone verified.');
      const [loginMethods, account] = await Promise.all([getLoginMethods(), getMe()]);
      setMethods(loginMethods);
      setMe(account);
    } catch (err) {
      // Wrong / expired / attempt-exhausted codes all land here and stay retryable.
      setPhoneOtpError(err instanceof Error ? err.message : 'Invalid or expired code');
    } finally {
      setPhoneOtpBusy(false);
    }
  }

  async function onSubmitRemovePhone(e: FormEvent) {
    e.preventDefault();
    if (phoneRemoveBusy) return;
    setPhoneRemoveError(null);
    setPhoneRemoveBusy(true);
    try {
      const next = await removePhone(phoneRemovePassword);
      setVerification(next);
      setPhoneRemoveOpen(false);
      setPhoneRemovePassword('');
      setPhoneOtpStep('idle');
      setPhoneNotice('Phone number removed from this account.');
      const [loginMethods, account] = await Promise.all([getLoginMethods(), getMe()]);
      setMethods(loginMethods);
      setMe(account);
    } catch (err) {
      // The server safety rule (last login/recovery path) is surfaced verbatim.
      setPhoneRemoveError(err instanceof Error ? err.message : 'Failed to remove the phone');
    } finally {
      setPhoneRemoveBusy(false);
    }
  }

  // Derived, server-truth-backed facts used by the cards below.
  const hasEmail = (verification?.email.status ?? 'UNAVAILABLE') !== 'UNAVAILABLE';
  const emailVerified = verification?.email.status === 'VERIFIED';
  const hasPhone = Boolean(verification?.phone.phone);
  const phoneVerified = verification?.phone.status === 'VERIFIED';
  const oauthLinked = Boolean(methods?.google || methods?.facebook);
  // Safety mirrors of the server rules — the API re-checks and is the authority.
  const canRemoveEmail = Boolean(verification?.phone.phone) || oauthLinked;
  const canRemovePhone = hasEmail || oauthLinked;
  const emailRemoveBlockReason =
    'You need another sign-in or recovery method first: add and verify a phone number, or link Google/Facebook.';
  const phoneRemoveBlockReason =
    'You need another sign-in or recovery method first: add an email address, or link Google/Facebook.';

  return (
    <>
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="mt-1 text-sm text-slate-500">
          Account &amp; security — sign-in details, verification status and sessions.
        </p>
        <div className="mt-6 space-y-4">
          {/* ---------------- A. Account information ---------------- */}
          <Card>
            <CardHeader><CardTitle>Account information</CardTitle></CardHeader>
            <CardContent>
              {!me ? (
                <Skeleton className="h-16" />
              ) : (
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Username</dt>
                    <dd className="font-medium">{me.username}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Name</dt>
                    <dd className="font-medium">
                      {[me.firstName, me.lastName].filter(Boolean).join(' ') || '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Status</dt>
                    <dd className="font-medium">{me.status}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-wide text-slate-500">Member since</dt>
                    <dd className="font-medium">{new Date(me.createdAt).toLocaleDateString()}</dd>
                  </div>
                </dl>
              )}
            </CardContent>
          </Card>
          {/* ---------------- B. Email ---------------- */}
          <Card>
            <CardHeader><CardTitle>Email</CardTitle></CardHeader>
            <CardContent>
              {!verification ? (
                <Skeleton className="h-20" />
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Email address</p>
                      <p className="break-all font-medium">
                        {hasEmail ? verification.email.email : 'No email address on this account'}
                      </p>
                    </div>
                    <StatusPill {...statusPill(verification.email.status)} />
                  </div>

                  {emailNotice && (
                    <p role="status" className="rounded-md border border-emerald-500/40 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">
                      {emailNotice}
                    </p>
                  )}
                  {emailError && (
                    <p role="alert" className="rounded-md border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-200">
                      {emailError}
                    </p>
                  )}

                  {emailEditMode === 'edit' ? (
                    <form onSubmit={onSubmitEmail} className="flex flex-col gap-3 rounded-md border border-ink-600 p-3">
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                          {hasEmail ? 'New email address' : 'Email address'}
                        </span>
                        <input
                          type="email"
                          required
                          autoComplete="email"
                          placeholder="name@example.com"
                          value={emailValue}
                          onChange={(e) => setEmailValue(e.target.value)}
                          disabled={emailBusy}
                          className={fieldClass}
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                          Current password (confirmation)
                        </span>
                        <input
                          type="password"
                          required
                          autoComplete="current-password"
                          value={emailPassword}
                          onChange={(e) => setEmailPassword(e.target.value)}
                          disabled={emailBusy}
                          className={fieldClass}
                        />
                        <span className="text-xs text-slate-500">
                          Changing a sign-in address always requires your password. Accounts without
                          a password must set one first (Profile → Set password).
                        </span>
                      </label>
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit" loading={emailBusy} size="sm">
                          {hasEmail ? 'Change email' : 'Add email'}
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={cancelEmailEdit} disabled={emailBusy}>
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {!hasEmail && (
                        <Button size="sm" onClick={openEmailEdit}>Add email</Button>
                      )}
                      {hasEmail && !emailVerified && (
                        emailOtpStep === 'sent' ? (
                          <form onSubmit={onSubmitEmailOtp} className="flex w-full flex-col gap-2 rounded-md border border-ink-600 p-3">
                            <label className="flex flex-col gap-1 text-sm">
                              <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Verification code</span>
                              <input
                                inputMode="numeric"
                                maxLength={6}
                                required
                                placeholder="6-digit code"
                                autoComplete="one-time-code"
                                value={emailOtp}
                                onChange={(e) => setEmailOtp(e.target.value)}
                                disabled={emailOtpBusy}
                                className={fieldClass}
                              />
                            </label>
                            {emailOtpError && (
                              <p role="alert" className="text-xs text-red-300">{emailOtpError}</p>
                            )}
                            <div className="flex flex-wrap gap-2">
                              <Button type="submit" size="sm" loading={emailOtpBusy}>Verify code</Button>
                              <Button type="button" variant="outline" size="sm" onClick={onSendEmailOtp} disabled={emailOtpSending}>
                                {emailOtpSending ? 'Sending…' : 'Resend code'}
                              </Button>
                              <Button type="button" variant="outline" size="sm" onClick={() => { setEmailOtpStep('idle'); setEmailOtp(''); setEmailOtpError(null); }}>
                                Cancel
                              </Button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <Button size="sm" onClick={onSendEmailOtp} loading={emailOtpSending}>Verify email</Button>
                            <Button variant="outline" size="sm" onClick={openEmailEdit}>Change email</Button>
                          </>
                        )
                      )}
                      {hasEmail && emailVerified && (
                        <Button variant="outline" size="sm" onClick={openEmailEdit}>Change email</Button>
                      )}
                      {hasEmail && !emailRemoveOpen && (
                        canRemoveEmail ? (
                          <Button variant="danger" size="sm" onClick={() => { setEmailRemoveOpen(true); setEmailRemoveError(null); setEmailRemovePassword(''); }}>
                            Remove email
                          </Button>
                        ) : (
                          <span className="self-center text-xs text-slate-500" title={emailRemoveBlockReason}>
                            Removal unavailable — another sign-in method is required
                          </span>
                        )
                      )}

                    </div>
                  )}
                  {emailRemoveOpen && (
                    <form onSubmit={onSubmitRemoveEmail} className="flex flex-col gap-3 rounded-md border border-red-500/40 bg-red-950/20 p-3">
                      <p className="text-xs text-red-200">
                        Removing the email disables email sign-in and email password recovery for
                        this account. Your phone or linked social sign-in will remain.
                      </p>
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Current password</span>
                        <input
                          type="password"
                          required
                          autoComplete="current-password"
                          value={emailRemovePassword}
                          onChange={(e) => setEmailRemovePassword(e.target.value)}
                          disabled={emailRemoveBusy}
                          className={fieldClass}
                        />
                      </label>
                      {emailRemoveError && (
                        <p role="alert" className="text-xs text-red-300">{emailRemoveError}</p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit" variant="danger" size="sm" loading={emailRemoveBusy}>Confirm removal</Button>
                        <Button type="button" variant="outline" size="sm" disabled={emailRemoveBusy}
                          onClick={() => { setEmailRemoveOpen(false); setEmailRemovePassword(''); setEmailRemoveError(null); }}>
                          Cancel
                        </Button>
                      </div>
                    </form>
                  )}

                </div>
              )}
            </CardContent>
          </Card>
          {/* ---------------- C. Phone ---------------- */}
          <Card>
            <CardHeader><CardTitle>Phone</CardTitle></CardHeader>
            <CardContent>
              {!verification ? (
                <Skeleton className="h-20" />
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Phone number</p>
                      <p className="break-all font-medium">
                        {hasPhone ? verification.phone.phone : 'No phone number on this account'}
                      </p>
                    </div>
                    <StatusPill {...statusPill(verification.phone.status)} />
                  </div>

                  {phoneNotice && (
                    <p role="status" className="rounded-md border border-emerald-500/40 bg-emerald-950/40 px-3 py-2 text-xs text-emerald-200">
                      {phoneNotice}
                    </p>
                  )}
                  {phoneError && (
                    <p role="alert" className="rounded-md border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-200">
                      {phoneError}
                    </p>
                  )}

                  {phoneEditMode === 'edit' ? (
                    <form onSubmit={onSubmitPhone} className="flex flex-col gap-3 rounded-md border border-ink-600 p-3">
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                          {hasPhone ? 'New phone number' : 'Phone number'}
                        </span>
                        <input
                          type="tel"
                          required
                          autoComplete="tel"
                          placeholder="+447911123456"
                          value={phoneValue}
                          onChange={(e) => setPhoneValue(e.target.value)}
                          disabled={phoneBusy}
                          className={fieldClass}
                        />
                        <span className="text-xs text-slate-500">
                          International format, e.g. +447911123456. The number stays UNVERIFIED
                          until you enter the OTP sent to it — changing it never carries the old
                          verification over.
                        </span>
                      </label>
                      {phoneError && (
                        <p role="alert" className="text-xs text-red-300">{phoneError}</p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit" loading={phoneBusy} size="sm">
                          {hasPhone ? 'Change number' : 'Send code'}
                        </Button>
                        <Button type="button" variant="outline" size="sm" onClick={cancelPhoneEdit} disabled={phoneBusy}>
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {!hasPhone && (
                        <Button size="sm" onClick={openPhoneEdit}>Add phone</Button>
                      )}
                      {hasPhone && !phoneVerified && (
                        phoneOtpStep === 'sent' ? (
                          <form onSubmit={onSubmitPhoneOtp} className="flex w-full flex-col gap-2 rounded-md border border-ink-600 p-3">
                            <label className="flex flex-col gap-1 text-sm">
                              <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Verification code</span>
                              <input
                                inputMode="numeric"
                                maxLength={6}
                                required
                                placeholder="6-digit code"
                                autoComplete="one-time-code"
                                value={phoneOtp}
                                onChange={(e) => setPhoneOtp(e.target.value)}
                                disabled={phoneOtpBusy}
                                className={fieldClass}
                              />
                            </label>
                            {phoneOtpError && (
                              <p role="alert" className="text-xs text-red-300">{phoneOtpError}</p>
                            )}
                            <div className="flex flex-wrap gap-2">
                              <Button type="submit" size="sm" loading={phoneOtpBusy}>Verify code</Button>
                              <Button type="button" variant="outline" size="sm" onClick={onSendPhoneOtp} disabled={phoneOtpSending}>
                                {phoneOtpSending ? 'Sending…' : 'Resend code'}
                              </Button>
                              <Button type="button" variant="outline" size="sm" onClick={() => { setPhoneOtpStep('idle'); setPhoneOtp(''); setPhoneOtpError(null); }}>
                                Cancel
                              </Button>
                            </div>
                          </form>
                        ) : (
                          <>
                            <Button size="sm" onClick={onSendPhoneOtp} loading={phoneOtpSending}>Verify phone</Button>
                            <Button variant="outline" size="sm" onClick={openPhoneEdit}>Change phone</Button>
                          </>
                        )
                      )}
                      {hasPhone && phoneVerified && (
                        <Button variant="outline" size="sm" onClick={openPhoneEdit}>Change phone</Button>
                      )}
                      {hasPhone && !phoneRemoveOpen && (
                        canRemovePhone ? (
                          <Button variant="danger" size="sm" onClick={() => { setPhoneRemoveOpen(true); setPhoneRemoveError(null); setPhoneRemovePassword(''); }}>
                            Remove phone
                          </Button>
                        ) : (
                          <span className="self-center text-xs text-slate-500" title={phoneRemoveBlockReason}>
                            Removal unavailable — another sign-in method is required
                          </span>
                        )
                      )}

                    </div>
                  )}
                  {phoneRemoveOpen && (
                    <form onSubmit={onSubmitRemovePhone} className="flex flex-col gap-3 rounded-md border border-red-500/40 bg-red-950/20 p-3">
                      <p className="text-xs text-red-200">
                        Removing the phone disables phone sign-in and phone-recovery codes for
                        this account. Your email or linked social sign-in will remain.
                      </p>
                      <label className="flex flex-col gap-1 text-sm">
                        <span className="text-xs font-medium uppercase tracking-wide text-slate-400">Current password</span>
                        <input
                          type="password"
                          required
                          autoComplete="current-password"
                          value={phoneRemovePassword}
                          onChange={(e) => setPhoneRemovePassword(e.target.value)}
                          disabled={phoneRemoveBusy}
                          className={fieldClass}
                        />
                      </label>
                      {phoneRemoveError && (
                        <p role="alert" className="text-xs text-red-300">{phoneRemoveError}</p>
                      )}
                      <div className="flex flex-wrap gap-2">
                        <Button type="submit" variant="danger" size="sm" loading={phoneRemoveBusy}>Confirm removal</Button>
                        <Button type="button" variant="outline" size="sm" disabled={phoneRemoveBusy}
                          onClick={() => { setPhoneRemoveOpen(false); setPhoneRemovePassword(''); setPhoneRemoveError(null); }}>
                          Cancel
                        </Button>
                      </div>
                    </form>
                  )}

                </div>
              )}
            </CardContent>
          </Card>
          {/* ---------------- D. Verification ---------------- */}
          <Card>
            <CardHeader><CardTitle>Verification</CardTitle></CardHeader>
            <CardContent>
              {!verification ? (
                <Skeleton className="h-24" />
              ) : (
                <div className="flex flex-col gap-3">
                  <ul className="flex flex-col gap-2 text-sm">
                    <li className="flex items-center justify-between gap-3">
                      <span className="text-slate-500">Email</span>
                      <StatusPill {...statusPill(verification.email.status)} />
                    </li>
                    <li className="flex items-center justify-between gap-3">
                      <span className="text-slate-500">Phone</span>
                      <StatusPill {...statusPill(verification.phone.status)} />
                    </li>
                    <li className="flex items-center justify-between gap-3">
                      <span className="text-slate-500">Face</span>
                      <StatusPill {...statusPill(verification.face.status)} />
                    </li>
                  </ul>
                  <p className="text-xs text-slate-500">
                    Statuses are read live from the server — never inferred. Face verification and
                    linked sign-in methods live in the Verification Center.
                  </p>
                  <Link href="/verification" className="text-sm font-medium text-teal-300 hover:underline">
                    Open the Verification Center →
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* ---------------- E. KYC (display-only; no workflow exists yet) ---------------- */}
          <Card>
            <CardHeader><CardTitle>KYC verification</CardTitle></CardHeader>
            <CardContent>
              {!me ? (
                <Skeleton className="h-16" />
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-slate-500">Status</p>
                      <p className="text-sm text-slate-400">
                        Identity verification (Know Your Customer) is separate from email and
                        phone verification.
                      </p>
                    </div>
                    <StatusPill {...kycPill(String(me.kycStatus))} />
                  </div>
                  {kycInfo && (
                    <p role="status" className="rounded-md border border-amber-500/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
                      {kycInfo}
                    </p>
                  )}
                  {String(me.kycStatus) === 'NOT_STARTED' && (
                    <Button variant="outline" size="sm" className="self-start" onClick={onStartKyc}>
                      Start KYC
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
          {/* ---------------- F. Password ---------------- */}
          <Card>
            <CardHeader><CardTitle>Change password</CardTitle></CardHeader>
            <CardContent>
              <form onSubmit={onChangePassword} className="flex flex-col gap-4">
                <label className="flex flex-col gap-1 text-sm">
                  Current password
                  <input type="password" required value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="rounded-md border border-ink-600 px-3 py-2" />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  New password
                  <input type="password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="rounded-md border border-ink-600 px-3 py-2" />
                </label>
                {message && <p className="text-sm text-green-400">{message}</p>}
                {error && <p className="text-sm text-red-400">{error}</p>}
                <Button type="submit" loading={changing} className="self-start">Change password</Button>
              </form>
            </CardContent>
          </Card>
          {/* ---------------- G. Active sessions ---------------- */}
          <Card>
            <CardHeader><CardTitle>Active sessions</CardTitle></CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-24" />
              ) : sessions.length === 0 ? (
                <p className="text-sm text-slate-500">No active sessions.</p>
              ) : (
                <ul className="divide-y divide-white/10 text-sm">
                  {sessions.map((session) => (
                    <li key={session.id} className="flex items-center justify-between gap-4 py-2">
                      <div>
                        <p className="font-medium">{session.current ? 'This device' : 'Other device'}{session.ip ? ` — ${session.ip}` : ''}</p>
                        <p className="text-xs text-slate-500">Started {new Date(session.createdAt).toLocaleString()}</p>
                      </div>
                      {!session.current && (
                        <Button variant="outline" size="sm" onClick={() => onRevoke(session.id)}>Revoke</Button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </main>
    </>
  );
}








