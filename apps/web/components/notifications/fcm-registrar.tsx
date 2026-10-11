'use client';

/**
 * FCM push registrar — mounted once in the root layout.
 *
 * When the authenticated session becomes ready, it registers this browser's
 * FCM push capability for the logged-in user (permission → service worker →
 * token → backend device row). On logout the browser's registration is
 * deactivated. Both operations are best-effort and never block the UI.
 */

import { useEffect, useRef } from 'react';
import { useAuth } from '@/src/lib/auth';
import {
  deactivateFcmPush,
  registerFcmPush,
} from '@/lib/notifications/fcm-client';

export function FcmRegistrar() {
  const { ready, isAuthenticated, user } = useAuth();
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;

    // Session (re)established → (re)register push for THIS user.
    if (isAuthenticated && user?.id && lastUserIdRef.current !== user.id) {
      lastUserIdRef.current = user.id;
      void registerFcmPush();
      return;
    }

    // Signed out (explicit logout / definitive 401) → deactivate this browser.
    if (!isAuthenticated && lastUserIdRef.current !== null) {
      lastUserIdRef.current = null;
      void deactivateFcmPush();
    }
  }, [ready, isAuthenticated, user?.id]);

  // Renders nothing — it is a side-effect-only component.
  return null;
}