import { Global, Module } from '@nestjs/common';
import { FcmPushSender } from './fcm.sender';
import { NotificationService } from './notification.service';
import { NotificationsController } from './notifications.controller';
import { AdminNotificationsController } from './admin-notifications.controller';

/**
 * Canonical FCM/in-app notification module.
 *
 * GLOBAL so financial + settlement services (wallet ManualPaymentService,
 * betting SettlementService, auth AuthService) can inject NotificationService
 * WITHOUT creating import cycles: those modules do NOT import this module —
 * Nest resolves the provider from the global scope.
 *
 * Source of truth = Postgres Notification tables. FCM = push delivery only.
 * A push failure inside NotificationService NEVER throws, so it can never
 * roll back the business operation that created the notification.
 */
@Global()
@Module({
  controllers: [NotificationsController, AdminNotificationsController],
  providers: [FcmPushSender, NotificationService],
  exports: [NotificationService, FcmPushSender],
})
export class NotificationsModule {}
