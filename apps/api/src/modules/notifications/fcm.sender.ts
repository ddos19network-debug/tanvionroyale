import { Injectable, Logger } from '@nestjs/common';

/**
 * Firebase Cloud Messaging (FCM) push sender - server-side ONLY.
 *
 * The Firebase Admin SDK service-account credentials come EXCLUSIVELY from
 * backend environment variables:
 *
 *   FIREBASE_PROJECT_ID
 *   FIREBASE_CLIENT_EMAIL
 *   FIREBASE_PRIVATE_KEY   (Render dashboard ONLY - never NEXT_PUBLIC_*)
 *
 * A private key is NEVER logged, never stored in a notification/device row
 * and never shipped to the browser. The Firebase WEB (public) configuration
 * in the frontend is a different, public-by-design set of values.
 *
 * The firebase-admin SDK is loaded lazily (require inside the accessor) so
 * any module that never sends push never pays the import cost - the same
 * fail-safe lazy pattern as the nodemailer SMTP adapter (email-sender.ts).
 *
 * FAIL-SAFE: isConfigured() false means "not configured" - the Notification
 * Service records SKIPPED deliveries and the caller continues (a push outage
 * must never roll back a deposit/withdrawal/settlement).
 */

export interface FcmSendTarget {
  deviceId: string;
  token: string;
}

export type FcmDeliveryOutcome = 'SENT' | 'FAILED' | 'SKIPPED' | 'INVALID_TOKEN';

export interface FcmSendResult {
  deviceId: string;
  outcome: FcmDeliveryOutcome;
  /** Truncated error (never credentials, never a full token). */
  error?: string;
}

export interface FcmSendRequest {
  targets: FcmSendTarget[];
  title: string;
  body: string;
  /** Public, non-secret data visible to the browser push payload. */
  data?: Record<string, string>;
  /** Optional notification click destination (server-set, allowlisted). */
  actionUrl?: string | null;
}

/** FCM messaging error codes that mean "this registration is stale". */
const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/mismatched-credential',
]);

interface MessagingLike {
  sendEachForMulticast(message: {
    tokens: string[];
    notification?: { title: string; body: string };
    data?: Record<string, string>;
    webpush?: { fcmOptions?: { link?: string } };
  }): Promise<{
    successCount: number;
    failureCount: number;
    responses: Array<{
      success: boolean;
      error?: { code?: string; message?: string };
    }>;
  }>;
}

/** Truncate an error message for safe storage/logging. */
export function safeErrorText(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message?: unknown }).message ?? 'unknown')
        : String(error ?? 'unknown');
  return raw.replace(/\s+/g, ' ').slice(0, 300);
}

@Injectable()
export class FcmPushSender {
  private readonly logger = new Logger(FcmPushSender.name);
  private cached: MessagingLike | null | undefined;

  /** True only when all three service-account variables are present. */
  isConfigured(): boolean {
    return Boolean(
      (process.env.FIREBASE_PROJECT_ID ?? '').trim() &&
        (process.env.FIREBASE_CLIENT_EMAIL ?? '').trim() &&
        (process.env.FIREBASE_PRIVATE_KEY ?? '').trim(),
    );
  }

  /**
   * Resolves the FCM Messaging instance once. Never logs the key, the client
   * email or any token. Returns null when not configured (SKIPPED, fail-safe).
   */
  private async messaging(): Promise<MessagingLike | null> {
    if (this.cached !== undefined) return this.cached;
    if (!this.isConfigured()) {
      this.cached = null;
      return null;
    }
    try {
      // Lazy require keeps firebase-admin out of any code path that never
      // sends push (same pattern as the nodemailer adapter).
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const adminApp = require('firebase-admin/app') as typeof import('firebase-admin/app');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const adminMessaging = require('firebase-admin/messaging') as typeof import('firebase-admin/messaging');
      const app =
        adminApp.getApps()[0] ??
        adminApp.initializeApp({
          credential: adminApp.cert({
            projectId: (process.env.FIREBASE_PROJECT_ID ?? '').trim(),
            clientEmail: (process.env.FIREBASE_CLIENT_EMAIL ?? '').trim(),
            // The env value stores real newlines as escaped \n (Render dashboard):
            privateKey: (process.env.FIREBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n'),
          }),
        });
      this.cached = adminMessaging.getMessaging(app) as unknown as MessagingLike;
      this.logger.log('Firebase Cloud Messaging (FCM) push delivery initialized');
      return this.cached;
    } catch (error) {
      // Initialization failure = delivery unavailable, not a business error.
      this.logger.error(
        `FCM initialization failed (push delivery will be SKIPPED): ${safeErrorText(error)}`,
      );
      this.cached = null;
      return null;
    }
  }

  /**
   * Best-effort FCM multicast. NEVER throws: unconfigured FCM returns all
   * targets as SKIPPED; a send error maps per-device to SENT / FAILED /
   * INVALID_TOKEN (stale registrations are deactivated by NotificationService).
   * Logs only counts + truncated errors - never keys, emails or tokens.
   */
  async send(request: FcmSendRequest): Promise<FcmSendResult[]> {
    const messaging = await this.messaging();
    if (!messaging) {
      return request.targets.map((t) => ({ deviceId: t.deviceId, outcome: 'SKIPPED' as const }));
    }
    if (request.targets.length === 0) return [];
    try {
      const response = await messaging.sendEachForMulticast({
        tokens: request.targets.map((t) => t.token),
        notification: { title: request.title.slice(0, 120), body: request.body.slice(0, 2000) },
        data: request.data ?? {},
        ...(request.actionUrl ? { webpush: { fcmOptions: { link: request.actionUrl } } } : {}),
      });
      this.logger.log(`FCM multicast: ${response.successCount} sent, ${response.failureCount} failed (${request.targets.length} targets)`);
      return request.targets.map((t, i) => {
        const r = response.responses[i];
        if (r?.success) return { deviceId: t.deviceId, outcome: 'SENT' as const };
        const code = r?.error?.code ?? '';
        if (INVALID_TOKEN_CODES.has(code)) {
          this.logger.warn(`FCM stale registration deactivated (code=${code})`);
          return { deviceId: t.deviceId, outcome: 'INVALID_TOKEN' as const, error: code.slice(0, 120) };
        }
        return {
          deviceId: t.deviceId,
          outcome: 'FAILED' as const,
          error: safeErrorText(r?.error?.message ?? code ?? 'send failed'),
        };
      });
    } catch (error) {
      this.logger.warn(`FCM send failed (deliveries left FAILED): ${safeErrorText(error)}`);
      return request.targets.map((t) => ({
        deviceId: t.deviceId,
        outcome: 'FAILED' as const,
        error: safeErrorText(error),
      }));
    }
  }
}
