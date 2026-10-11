/**
 * TANVION ROYALE — Firebase FCM browser push registration (web client).
 *
 * SECURITY: only NEXT_PUBLIC_FIREBASE_* (public web config) is used here.
 * FIREBASE_PRIVATE_KEY / service-account credentials NEVER appear in the
 * browser — they are backend-only (Render) variables. Without
 * NEXT_PUBLIC_FIREBASE_PROJECT_ID the module is a silent no-op (fail-safe).
 *
 * The Firebase SDK is imported DYNAMICALLY inside the functions so the heavy
 * firebase bundle is never pulled into pages that never register push.
 */

import type { FirebaseOptions } from 'firebase/app';

import {
  registerNotificationDevice,
  deactivateNotificationDevice,
} from '@/lib/api/notifications';
import { getAccessToken } from '@/lib/auth/session';

/** Public, non-secret Firebase web configuration (Vercel env). */
export interface FirebaseWebConfig {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  /** Web Push VAPID public key (Firebase console → Cloud Messaging). */
  vapidKey?: string;
}

const FCM_TOKEN_STORAGE_KEY = 'tr:fcm-registration-token';

export function readFirebaseWebConfig(): FirebaseWebConfig {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    vapidKey: process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY,
  };
}

export function isFirebaseWebConfigured(): boolean {
  const cfg = readFirebaseWebConfig();
  return Boolean(cfg.projectId && cfg.apiKey);
}

/** The most recently registered token, for deactivation on logout. */
export function getStoredFcmToken(): string | null {
  try {
    return window.localStorage.getItem(FCM_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function rememberToken(token: string): void {
  try {
    window.localStorage.setItem(FCM_TOKEN_STORAGE_KEY, token);
  } catch {
    /* storage unavailable — push registration is best-effort */
  }
}

export interface FcmRegistrationResult {
  registered: boolean;
  token?: string;
}
/**
 * Register (or refresh) this browser's FCM push capability for the CURRENT
 * authenticated user. Best-effort: every failure returns { registered: false }
 * and NEVER throws — push registration must never break the app.
 */
export async function registerFcmPush(): Promise<FcmRegistrationResult> {
  if (typeof window === 'undefined') return { registered: false };
  if (!isFirebaseWebConfigured()) return { registered: false };
  if (!('serviceWorker' in navigator)) return { registered: false };

  try {
    const { isSupported } = await import('firebase/messaging');
    if (!(await isSupported())) return { registered: false };

    // Request notification permission (user-visible prompt).
    if (typeof Notification.requestPermission === 'function') {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return { registered: false };
    } else if (Notification.permission !== 'granted') {
      return { registered: false };
    }

    // Register the messaging service worker at its canonical path.
    const registration = await navigator.serviceWorker.register(
      '/firebase-messaging-sw.js',
    );
    if (registration.installing) {
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 5000)),
      ]);
    }

    // Obtain the FCM registration/installation token.
    const cfg = readFirebaseWebConfig();
    const { initializeApp } = await import('firebase/app');
    const app = initializeApp({
      apiKey: cfg.apiKey,
      authDomain: cfg.authDomain,
      projectId: cfg.projectId,
      storageBucket: cfg.storageBucket,
      messagingSenderId: cfg.messagingSenderId,
      appId: cfg.appId,
    } as FirebaseOptions);
    const { getMessaging, getToken } = await import('firebase/messaging');
    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      serviceWorkerRegistration: registration,
      ...(cfg.vapidKey ? { vapidKey: cfg.vapidKey } : {}),
    });
    if (!token) return { registered: false };

    // Associate the token with the authenticated user on the backend (the user
    // is derived from the JWT server-side, never from the request body).
    const result = await registerNotificationDevice({
      token,
      platform: 'web',
      browser: navigator.userAgent.slice(0, 64),
    });
    if (result.isActive) rememberToken(token);
    return { registered: result.isActive, token };
  } catch {
    // Fail-safe: no permission, no SW, no Firebase config → no push.
    return { registered: false };
  }
}

/**
 * Deactivate the current browser's push registration (logout / permission
 * revoked). Best-effort, never throws.
 *
 * IMPORTANT (401 noise): FcmRegistrar calls this on the signed-out transition,
 * which happens AFTER the session has already been cleared from localStorage.
 * Firing the protected call anyway produced a guaranteed
 * `POST /notifications/devices/deactivate -> 401` on every logout.
 *
 * When no access token remains there is nothing the server could authorize, so
 * the request is skipped and the local registration is simply forgotten. The
 * stored rows stay safe: FCM reports stale tokens as deactivated, and a push is
 * only ever delivered to a token owned by a live session. The backend guard is
 * NOT weakened to silence this.
 */
export async function deactivateFcmPush(): Promise<void> {
  if (typeof window === 'undefined') return;
  const token = getStoredFcmToken();
  try {
    window.localStorage.removeItem(FCM_TOKEN_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  if (!token) return;
  // No session left => no authorized call to make; do not fire a doomed request.
  if (!getAccessToken()) return;
  try {
    await deactivateNotificationDevice(token);
  } catch {
    /* server may be unreachable during logout — rows stay active until FCM reports them stale */
  }
}
