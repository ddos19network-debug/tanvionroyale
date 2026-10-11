import { Module } from '@nestjs/common';
import { SupportService } from './support.service';
import { SupportController } from './support.controller';
import { SupportReportsController } from './support-reports.controller';
import { AdminSupportController } from './admin-support.controller';

/**
 * Support module (REST): Live Chat + "Report a Problem" (user side) and the
 * shared admin inbox.
 *
 * PrismaModule and NotificationsModule are @Global(), so the service gets
 * PrismaService + NotificationService injected without import cycles —
 * the same pattern the notifications module relies on.
 */
@Module({
  controllers: [
    SupportController,
    SupportReportsController,
    AdminSupportController,
  ],
  providers: [SupportService],
})
export class SupportModule {}
