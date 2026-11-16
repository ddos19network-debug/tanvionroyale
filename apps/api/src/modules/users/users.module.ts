import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { ProfileController } from './profile.controller';
import { DashboardController } from './dashboard.controller';
import { UsersService } from './users.service';
import { ProfileActivityService } from './profile-activity.service';

@Module({
  controllers: [UsersController, ProfileController, DashboardController],
  providers: [UsersService, ProfileActivityService],
  exports: [UsersService, ProfileActivityService],
})
export class UsersModule {}
