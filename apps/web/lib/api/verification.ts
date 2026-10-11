/**
 * Frontend Verification Center API (Phase 11).
 *
 * Settings Account & Security additions (master prompt Parts 5–11):
 * setEmail / removeEmail / removePhone — password-confirmed identifier
 * management whose responses are the same server-authoritative
 * VerificationStatus as every other endpoint here (the client NEVER derives
 * verification state on its own).
 */
import { authFetch, apiFetch } from './client';

export { getOAuthLinkUrl } from './auth';

export type VerificationState = 'NOT_STARTED' | 'PENDING' | 'VERIFIED' | 'REJECTED' | 'EXPIRED';

export interface VerificationStatus {
  /**
   * ONE-OF-TWO rule: true as soon as the phone OR the email is verified.
   * Face verification never contributes to (or blocks) this condition.
   */
  initialVerificationComplete: boolean;
  phone: {
    status: VerificationState | 'UNAVAILABLE';
    phone: string | null;
    verifiedAt: string | null;
    autoVerifiedDuringSignup: boolean;
  };
  email: {
    status: VerificationState | 'UNAVAILABLE';
    email: string | null;
    verifiedAt: string | null;
  };
  face: {
    status: VerificationState;
    verifiedAt: string | null;
    provider: string;
    /** True when a real biometric provider is configured (vs. the mock/manual-review fallback). */
    configured: boolean;
  };
}

export interface LoginMethods {
  phone: string[];
  google: boolean;
  facebook: boolean;
}

export async function getVerificationStatus(): Promise<VerificationStatus> {
  return authFetch<VerificationStatus>('/verification/status');
}

export async function getLoginMethods(): Promise<LoginMethods> {
  return authFetch<LoginMethods>('/verification/methods');
}

export async function sendPhoneVerification(phone?: string): Promise<{ message: string }> {
  return authFetch<{ message: string }>('/verification/phone/send', {
    method: 'POST',
    body: JSON.stringify(phone ? { phone } : {}),
  });
}

/** Add or change the account email. Stored UNVERIFIED — never a fake success. */
export async function setEmail(
  email: string,
  currentPassword: string,
): Promise<VerificationStatus> {
  return authFetch<VerificationStatus>('/verification/email/set', {
    method: 'POST',
    body: JSON.stringify({ email, currentPassword }),
  });
}

/** Remove the email. The server refuses when it is the last login/recovery path. */
export async function removeEmail(currentPassword: string): Promise<VerificationStatus> {
  return authFetch<VerificationStatus>('/verification/email', {
    method: 'DELETE',
    body: JSON.stringify({ currentPassword }),
  });
}

/** Remove the phone. The server refuses when it is the last login/recovery path. */
export async function removePhone(currentPassword: string): Promise<VerificationStatus> {
  return authFetch<VerificationStatus>('/verification/phone', {
    method: 'DELETE',
    body: JSON.stringify({ currentPassword }),
  });
}

export async function verifyPhone(code: string): Promise<VerificationStatus> {
  return authFetch<VerificationStatus>('/verification/phone/verify', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export async function sendEmailVerification(): Promise<{ message: string }> {
  return authFetch<{ message: string }>('/verification/email/send', { method: 'POST' });
}

export async function verifyEmail(token: string): Promise<VerificationStatus> {
  return apiFetch<VerificationStatus>('/verification/email/verify', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

/**
 * Email OTP flow for the verification page (purpose EMAIL_VERIFY). This is
 * intentionally independent of the emailed verification LINK above — the two
 * flows never consume or invalidate each other's credentials.
 */
export async function sendEmailVerificationOtp(): Promise<{ message: string }> {
  return authFetch<{ message: string }>('/verification/email/send-otp', { method: 'POST' });
}

export async function verifyEmailOtp(code: string): Promise<VerificationStatus> {
  return authFetch<VerificationStatus>('/verification/email/verify-otp', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export async function startFaceVerification(): Promise<VerificationStatus> {
  return authFetch<VerificationStatus>('/verification/face/start', { method: 'POST' });
}

export async function disconnectLoginMethod(
  provider: 'PHONE' | 'GOOGLE' | 'FACEBOOK',
): Promise<LoginMethods> {
  return authFetch<LoginMethods>('/verification/methods/disconnect', {
    method: 'POST',
    body: JSON.stringify({ provider }),
  });
}
