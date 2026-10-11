# TANVION ROYALE — FCM Notification System

Production-ready browser push + in-app notifications for USERS and ADMINS.
Firebase Cloud Messaging is ONLY the push-delivery provider. The Neon/
PostgreSQL `Notification` tables remain the single source of truth for
history, read/unread state, recipients, events and auditability.

```
TANVION ROYALE Backend (NestJS)
        |
NotificationService (apps/api/src/modules/notifications)
        |
PostgreSQL Notification / NotificationDevice / NotificationDelivery
        |                     (source of truth, audit, idempotency)
Firebase Cloud Messaging (Firebase Admin SDK, server-side only)
        |
User / Admin browser push (firebase-messaging-sw.js on Vercel, HTTPS)
```

## What was added / reused

| Area | Detail |
| --- | --- |
| Existing infra reused | JWT auth guards, `@Roles('ADMIN','SUPER_ADMIN')` RBAC, Prisma schema + additive migrations, admin panel design system (`AdminPageHeader`, `AdminStatCard`, toast), user sidebar/nav definitions, manual-deposit/withdrawal review flows, settlement engine |
| Prisma models (new, additive) | `Notification` (recipient, audience, type, title, message, data JSON, server-set `actionUrl`, `dedupeKey`, read state), `NotificationDevice` (provider, token, platform, browser, isActive, lastSeenAt — unique `(provider, token)`), `NotificationDelivery` (per-device outcome: PENDING/SENT/FAILED/SKIPPED/INVALID_TOKEN, unique `(notificationId, deviceId)`) |
| Migration | `database/prisma/migrations/20260914000000_add_notifications` — additive only (CREATE TYPE/TABLE/INDEX; no DROP/ALTER of existing tables) |
| Backend module | `apps/api/src/modules/notifications`: `NotificationService` (single writer of the tables), `FcmPushSender` (lazy Firebase Admin, fail-safe), user controller, admin controller, DTOs, global `NotificationsModule` |
| User API | `GET /notifications`, `GET /notifications/unread-count`, `POST /notifications/:id/read`, `POST /notifications/read-all`, `POST /notifications/devices`, `POST /notifications/devices/deactivate` (JwtAuthGuard; every query scoped to `recipientUserId = auth.id` — IDOR-safe) |
| Admin API | `GET /admin/notifications`, `GET /admin/notifications/stats`, `POST /admin/notifications/send` (`mode: all | selected | single`) — `@Roles('ADMIN','SUPER_ADMIN')` |
| Automatic user events | Deposit approved / rejected, withdrawal approved / rejected / completed, bet won / lost — strictly AFTER the business operation commits, dedupe-keyed |
| Automatic admin events | New deposit request, new withdrawal request, new user registration (+ reusable security-alert helper) |
| Frontend | `/notifications` page (filter, mark read, mark all, unread badge, safe navigation), unread badge in sidebar + mobile menu, `FcmRegistrar` mounted in the root layout, `/firebase-messaging-sw.js` service worker, typed API client `lib/api/notifications.ts`, FCM client `lib/notifications/fcm-client.ts` |
## Automatic events (no fake events — post-commit only)

| Business event | Trigger point | dedupeKey (idempotency) |
| --- | --- | --- |
| Deposit approved | `ManualPaymentService.reviewManualDeposit` after credit + APPROVED update succeed | `deposit-approved:{depositId}` |
| Deposit rejected | `reviewManualDeposit` after the REJECTED update commits | `deposit-rejected:{depositId}` |
| Withdrawal approved | `reviewManualWithdrawal` after the atomic APPROVED claim | `withdrawal-approved:{withdrawalId}` |
| Withdrawal rejected | `reviewManualWithdrawal` after the REJECTED claim + fund release | `withdrawal-rejected:{withdrawalId}` |
| Withdrawal completed | `completeManualWithdrawal` after the settlement ledger succeeds | `withdrawal-completed:{withdrawalId}` |
| Bet won / bet lost | `SettlementService.settleBet` after the settlement transaction COMMITS | `bet-settlement:{betId}` |
| New deposit/withdrawal request (→ admins) | submission flows | `new-deposit-request:{id}` / `new-withdrawal-request:{id}` |
| New user registration (→ admins) | `AuthService.register` after the audit log | `new-user-registration:{userId}` |

The `(dedupeKey, recipientUserId)` unique constraint makes retries, double-
clicks, webhook replays and worker restarts impossible to duplicate. VOID
refunds intentionally do not notify (no win/loss happened).

## Failure behaviour

- `NotificationService.create()` NEVER throws from the push path: it stores the
  row, then best-effort fans out to devices. FCM down / unconfigured →
  deliveries stay PENDING (retryable) or SKIPPED.
- FCM `INVALID_TOKEN` responses deactivate the device (`isActive=false`) so we
  never repeatedly send to stale registrations.
- Financial operations (credit/debit/ledger) never depend on FCM. A push
  failure cannot roll back a deposit, withdrawal or settlement (covered by
  tests).

## Security

- Server-side only: `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` /
  `FIREBASE_PRIVATE_KEY` (Render). Never logged, never in `NEXT_PUBLIC_*`,
  never in the browser bundle, never in git.
- Public-by-design web config in Vercel: `NEXT_PUBLIC_FIREBASE_*` (Firebase
  web API keys are identifiers, not secrets).
- `actionUrl` is server-set and allowlisted (`/wallet`, `/my-bets`,
  `/dashboard`, `/promotions`, `/profile`, `/settings`, `/support`, `/admin`);
  the service worker re-checks the click target and ignores anything that is
  not a same-site relative path. Arbitrary external URLs are never opened.
- Content is validated with class-validator DTOs; titles/messages are trimmed
  and length-capped; only ADMIN/SUPER_ADMIN can send.
- Users can only ever read/mark their own rows (scoped queries + ownership
  check on `markRead`).

## Real-time in-app updates

FCM handles browser push. For the in-app badge the simplest stable mechanism is
used: the `UnreadBadge` component polls `GET /notifications/unread-count` every
30s, refreshes on window focus, and refreshes instantly on the internal
`tr:notifications-changed` event that the notification center dispatches after
read mutations. No full page refresh needed; the DB stays the source of truth.

## Environment variables

Vercel (apps/web, PUBLIC — safe for the browser):

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`
- `NEXT_PUBLIC_FIREBASE_VAPID_KEY`

Render (apps/api, SECRET — dashboard only):

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` (use literal `\n` escapes for newlines)

Without Firebase configured everything still works: notifications are stored
and shown in-app; pushes are recorded as SKIPPED.

## Setup checklist

Firebase Console:

1. Create the project.
2. Project settings → Your apps → register a **Web app** (collect the web
   config for the Vercel variables above).
3. Cloud Messaging is enabled by default for web push.
4. Project settings → Cloud Messaging → Web push certificates → generate the
   **VAPID key pair** (public key → `NEXT_PUBLIC_FIREBASE_VAPID_KEY`).
5. Project settings → Service accounts → **Generate new private key** (JSON)
   → set `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`,
   `FIREBASE_PRIVATE_KEY` in the Render dashboard. Never paste the key into
   chat, git or the frontend.

Vercel: add the seven `NEXT_PUBLIC_FIREBASE_*` variables (+ existing
`NEXT_PUBLIC_API_URL`).

Render: add the three Firebase Admin variables (+ existing `DATABASE_URL`,
`JWT_SECRET`, …) and deploy; on deploy run `prisma migrate deploy`
(`pnpm --filter @tanvion-royale/api prisma:migrate:deploy`) to apply the
additive migration.

## Acceptance mapping

- ADMIN → send to one / selected / all users → in-app rows + FCM push per
  registered device; suspended users and unknown ids are excluded.
- Deposit approved / rejected, withdrawal approved / rejected / completed,
  bet won / lost → automatic notifications (post-commit, dedupe-keyed).
- Admins have their own notification center (ADMIN audience feed + ops events).
- Read / mark-all / unread-count endpoints + UI badge.
- Multiple devices per user supported; stale tokens auto-deactivated.
- No fake events, no duplicate notifications, no credential leakage, and FCM
  failures can never roll back financial transactions.
| Admin UI | `/admin/notifications` — Create Notification (All Users / Selected Users / Individual User; System Announcement / New Promotion / Security Alert / General), delivery stats, recent history; sidebar entry 🔔 Notifications |
| Tests | `apps/api/test/notifications.spec.ts` — 8 unit tests (idempotency, fan-out, URL sanitisation, FCM-failure safety, stale-token cleanup, multi-device, IDOR, read lifecycle) |