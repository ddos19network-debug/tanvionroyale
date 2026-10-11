'use client';

/**
 * THE signup form.
 *
 * ONE component, mounted at both `/signup` and `/register`, so the two URLs
 * resolve to exactly the same page, the same validation and the same referral
 * attribution. There is no duplicated form to drift out of sync.
 *
 * REFERRAL FLOW (the bug this fixes)
 *   The referral code is captured ONCE, here, from `?ref=` and/or the
 *   same-tab session (see lib/referral-capture.ts), and is then:
 *     - sent with the phone/OTP signup request, where the account is created;
 *     - forwarded into the Google/Facebook OAuth start, which carries it in a
 *       signed server-side state token;
 *     - preserved across form switches, validation errors and refreshes.
 *
 *   The browser NEVER chooses a referrer. It can only present a code; the
 *   server resolves the owner and applies the self-referral / duplicate /
 *   disabled-program guards exactly as it does for every other signup path.
 */
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@tanvion-royale/ui';
import {
  phoneSignupSendOtp,
  phoneSignupVerify,
  getOAuthRedirectUrl,
} from '@/lib/api/auth';
import { trackReferralClick, useReferralCode } from '@/lib/referral-capture';
import { saveSession } from '@/lib/auth/session';
import {
  friendlyAuthError,
  validatePassword,
  PASSWORD_REQUIREMENTS,
} from '@/lib/auth/errors';
import { normalizePhoneInput, isValidPhoneInput } from '@/lib/auth/phone';


function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { referralCode, invalidCode } = useReferralCode(searchParams.get('ref'));

  // Phone + OTP flow
  const [phone, setPhone] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otp, setOtp] = useState('');

  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  /**
   * The CANONICAL phone the OTP was issued for.
   *
   * The user types `01712345678`; the API canonicalizes it to `+8801712345678`
   * and echoes that value back. Verification MUST use the value the backend
   * actually issued the code for — verifying with the raw local format would
   * look up a different OTP identifier and always fail. Falls back to the
   * locally-normalized value so an older API that omits the echo still works.
   */
  const [canonicalPhone, setCanonicalPhone] = useState('');

  // One click per code per page view. The server de-duplicates per visitor per
  // day, so a refresh never inflates the affiliate's click count.
  useEffect(() => {
    if (referralCode) trackReferralClick(referralCode, '/signup');
  }, [referralCode]);

  const inputClass =
    'w-full rounded-md border border-ink-600 px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20 disabled:opacity-60';

  async function sendOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    // Client-side phone validation, matching the backend normalizer exactly.
    // The API still re-validates (it is authoritative); this only avoids a
    // pointless round trip and explains the expected format immediately.
    if (!isValidPhoneInput(phone)) {
      setError('Enter a valid mobile number, e.g. 01712345678.');
      return;
    }

    // Same rules the backend enforces (8+ chars, lower, upper, digit). Checking
    // here means the customer learns the requirement BEFORE the OTP is sent,
    // instead of after a 400 round trip.
    const passwordProblem = validatePassword(password);
    if (passwordProblem) {
      setError(passwordProblem);
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    // Canonicalize before sending so the request carries `+8801712345678` for a
    // `01712345678` input — and, critically, NEVER re-prefixes a number the
    // user already typed as `+8801712345678`.
    const normalizedPhone = normalizePhoneInput(phone);

    setLoading(true);
    try {
      const res = await phoneSignupSendOtp({
        phone: normalizedPhone,
        password,
        username: username || undefined,
        ref: referralCode ?? undefined,
      });
      // The API's canonical value wins: it is what the OTP is bound to.
      setCanonicalPhone(res.phone || normalizedPhone);
      setPhone(res.phone || normalizedPhone);
      setOtpSent(true);
      setInfo(res.message);
    } catch (err) {
      setError(friendlyAuthError(err, 'signup'));
    } finally {
      setLoading(false);
    }
  }

  async function verifyOtp(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // Verify against the CANONICAL phone the OTP was issued for — never the
      // raw input. This is the mismatch that would make a correct code fail.
      const session = await phoneSignupVerify(canonicalPhone || normalizePhoneInput(phone), otp);
      saveSession(session);
      // ONE-OF-TWO rule: phone OR email verification unlocks the interface.
      router.push(
        (session.user.phoneVerified || session.user.emailVerified) &&
          session.user.status === 'ACTIVE'
          ? '/dashboard'
          : '/verification',
      );
    } catch (err) {
      setError(friendlyAuthError(err, 'signup'));
    } finally {
      setLoading(false);
    }
  }

  /**
   * The referral code rides along in the OAuth START request. The API puts it
   * in a signed state token and resolves the owner server-side after the
   * callback, so it survives the trip to the provider and back.
   */
  async function continueWith(provider: 'google' | 'facebook') {
    setError(null);
    try {
      const url = await getOAuthRedirectUrl(provider, referralCode);
      window.location.href = url;
    } catch (err) {
      setError(friendlyAuthError(err, 'oauth'));
    }
  }

  // Keep the code on the "already registered?" link so a visitor who bounces
  // to /login and comes back has not silently lost their attribution.
  const signInHref = referralCode
    ? `/login?ref=${encodeURIComponent(referralCode)}`
    : '/login';

  return (
    <Card className="w-full max-w-md" aria-labelledby="register-heading">
      <CardHeader>
        <CardTitle id="register-heading" className="text-center text-2xl font-bold">
          Create your account
        </CardTitle>
      </CardHeader>
      <CardContent>
        {referralCode ? (
          <p className="mb-4 rounded-md border border-teal-500/20 bg-teal-500/10 px-3 py-2 text-xs text-teal-200">
            Referral applied
          </p>
        ) : invalidCode ? (
          <p className="mb-4 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            That referral code is not valid â€” you can still create your account.
          </p>
        ) : null}

        {!otpSent ? (
          <form onSubmit={sendOtp} className="flex flex-col gap-4" noValidate>
            <label htmlFor="reg-username" className="flex flex-col gap-1 text-sm font-medium">
              Username
              <input
                id="reg-username"
                name="username"
                autoComplete="username"
                minLength={3}
                maxLength={32}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={inputClass}
                required
              />
            </label>
            <label htmlFor="reg-phone" className="flex flex-col gap-1 text-sm font-medium">
              Phone number
              <input
                id="reg-phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="01712345678"
                aria-describedby="reg-phone-hint"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={inputClass}
                required
              />
              {/* Tells the customer exactly what is accepted. A Bangladesh
                  number can be typed in the familiar local form; the `+880`
                  international form works too and is never double-prefixed. */}
              <span id="reg-phone-hint" className="text-xs font-normal text-slate-400">
                01712345678 or +8801712345678
              </span>
            </label>
            <label htmlFor="reg-password" className="flex flex-col gap-1 text-sm font-medium">
              Password
              <input
                id="reg-password"
                name="password"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                aria-describedby="reg-password-hint"
                required
              />
              {/* Mirrors the backend's rules exactly (8+ chars, lower, upper,
                  digit) so the requirement is visible before the OTP is sent
                  rather than surfacing as a 400 afterwards. */}
              <span id="reg-password-hint" className="text-xs font-normal text-slate-400">
                Must include: {PASSWORD_REQUIREMENTS.join(', ')}.
              </span>
            </label>
            <label htmlFor="reg-confirm" className="flex flex-col gap-1 text-sm font-medium">
              Confirm password
              <input
                id="reg-confirm"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={inputClass}
                required
              />
            </label>
            <div aria-live="polite">
              {error && (
                <p id="reg-error" role="alert" className="text-sm text-red-400">
                  {error}
                </p>
              )}
              {info && <p className="text-sm text-emerald-300">{info}</p>}
            </div>
            <Button type="submit" disabled={loading} aria-busy={loading}>
              {loading ? 'Sendingâ€¦' : 'Send OTP'}
            </Button>
          </form>
        ) : (
          <form onSubmit={verifyOtp} className="flex flex-col gap-4" noValidate>
            <label htmlFor="reg-otp" className="flex flex-col gap-1 text-sm font-medium">
              OTP
              <input
                id="reg-otp"
                name="otp"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                minLength={6}
                maxLength={6}
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                className={`${inputClass} text-center text-lg tracking-[0.4em]`}
              />
            </label>
            <div aria-live="polite">
              {error && (
                <p id="reg-error" role="alert" className="text-sm text-red-400">
                  {error}
                </p>
              )}
              {info && <p className="text-sm text-emerald-300">{info}</p>}
            </div>
            <Button type="submit" disabled={loading} aria-busy={loading}>
              {loading ? 'Verifyingâ€¦' : 'Verify & Create Account'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={loading}
              onClick={() => {
                setOtpSent(false);
                setOtp('');
                setError(null);
                // A new number means a new OTP identifier: clearing the canonical
                // value guarantees the next verification is bound to the phone
                // the LATEST send-otp actually issued a code for.
                setCanonicalPhone('');
                setPhone('');
              }}
            >
              Change phone number / resend
            </Button>
          </form>
        )}

        <div className="my-4 flex items-center gap-2 text-xs text-slate-400" role="separator" aria-label="or">
          <span className="h-px flex-1 bg-ink-600" /> OR{' '}
          <span className="h-px flex-1 bg-ink-600" />
        </div>
        <div className="flex flex-col gap-2">
          <Button type="button" variant="outline" onClick={() => continueWith('google')}>
            Continue with Google
          </Button>
          <Button type="button" variant="outline" onClick={() => continueWith('facebook')}>
            Continue with Facebook
          </Button>
        </div>
        <p className="mt-4 text-sm text-slate-500">
          Already registered?{' '}
          <Link href={signInHref} className="font-medium text-indigo-400 hover:underline">
            Sign in
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}

/**
 * `useSearchParams()` is read by {@link SignupForm} (it picks up the `?ref=`
 * referral code), and Next.js 14 requires any component that reads search
 * params to sit inside a Suspense boundary during static prerendering. This is
 * the same pattern the /verification page and the UserSidebar already use.
 */
export default function SignupPage() {
  return (
    <Suspense fallback={null}>
      <SignupForm />
    </Suspense>
  );
}
