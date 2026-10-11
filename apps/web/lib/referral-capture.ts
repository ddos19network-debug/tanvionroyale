'use client';

/**
 * Shared REFERRAL CODE capture for the signup flows.
 *
 * WHY THIS EXISTS
 * ---------------
 * A visitor who follows `https://<site>/signup?ref=CODE` must keep that code
 * all the way through account creation, even when they:
 *   - switch between the phone/OTP form and the OAuth buttons;
 *   - trigger a validation error and re-submit;
 *   - navigate to /login and back;
 *   - bounce out to Google and come back;
 *   - refresh the page mid-flow.
 *
 * HOW IT WORKS
 *   - the value from `?ref=` is validated in the browser (shape only — the
 *     SERVER always re-validates and resolves the owner, so nothing here is
 *     trusted for attribution);
 *   - it is mirrored into `sessionStorage`, so a same-tab navigation or a
 *     refresh keeps it;
 *   - it is a public referral code, not a credential, so this is safe. No
 *     token, id or ownership decision is ever stored here.
 *
 * The same helper is used by BOTH `/signup` and `/register`, so the two URLs
 * resolve to exactly one attribution flow.
 */
import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'tanvion:referral';

/**
 * The exact shape this platform issues (`TANV` + 12 Crockford characters).
 * Mirrors `referral-code.ts` on the API so a malformed value is dropped before
 * it ever reaches the network. The server re-checks it regardless.
 */
const CODE_SHAPE = /^TANV[23456789ABCDEFGHJKMNPQRSTVWXYZ]{12}$/;

export function isReferralCodeShape(value: string): boolean {
  return CODE_SHAPE.test(value);
}

/** Normalises a raw `?ref=` value, tolerating a pasted full link. */
export function normalizeReferralCodeInput(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  const fromUrl = trimmed.match(/[?&]ref=([A-Za-z0-9]+)/i);
  const candidate = (fromUrl ? fromUrl[1] : trimmed).toUpperCase();
  return isReferralCodeShape(candidate) ? candidate : null;
}

function readStored(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return normalizeReferralCodeInput(window.sessionStorage.getItem(STORAGE_KEY));
  } catch {
    // Private mode / disabled storage: the query value still works for this
    // page view, we simply lose persistence.
    return null;
  }
}

function writeStored(code: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (code) window.sessionStorage.setItem(STORAGE_KEY, code);
    else window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage failures must never break signup.
  }
}

/**
 * The referral code for this signup session.
 *
 * `fromQuery` is the raw `?ref=` search param (or null). The returned code is
 * the query value when present, otherwise the one remembered earlier in this
 * tab, otherwise null. Invalid values are discarded — they are never sent and
 * never stored, so a bad link still lets the visitor sign up normally.
 */
export function useReferralCode(fromQuery: string | null): {
  referralCode: string | null;
  /** True when a code was present but not valid — lets the UI say so. */
  invalidCode: boolean;
  clear: () => void;
} {
  const [referralCode, setReferralCode] = useState<string | null>(null);
  const [invalidCode, setInvalidCode] = useState(false);

  useEffect(() => {
    if (fromQuery === null) {
      // No ?ref= on this navigation: keep whatever this tab already had, so
      // moving between /signup, /register and /login cannot lose the code.
      setReferralCode(readStored());
      return;
    }
    const normalized = normalizeReferralCodeInput(fromQuery);
    if (normalized) {
      writeStored(normalized);
      setReferralCode(normalized);
      setInvalidCode(false);
      return;
    }
    // A non-empty but unusable code. Nothing is stored and nothing is sent.
    setReferralCode(readStored());
    setInvalidCode((fromQuery ?? '').trim().length > 0);
  }, [fromQuery]);

  const clear = useCallback(() => {
    writeStored(null);
    setReferralCode(null);
    setInvalidCode(false);
  }, []);

  return { referralCode, invalidCode, clear };
}

/**
 * Records one click on an affiliate/referral link.
 *
 * Fire-and-forget and failure-tolerant by design: it must never delay or block
 * the signup form, and the server de-duplicates it per visitor per day, so a
 * refresh or a double call is counted once.
 */
export function trackReferralClick(code: string, path: string): void {
  if (!isReferralCodeShape(code)) return;
  const send = () => {
    void fetch(
      `${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/v1/me/affiliate/track-click`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, path }),
        credentials: 'omit',
        keepalive: true,
      },
    ).catch(() => undefined);
  };
  // Never block the first paint on an analytics call.
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    (window as unknown as { requestIdleCallback: (cb: () => void) => void })
      .requestIdleCallback(send);
  } else {
    send();
  }
}
