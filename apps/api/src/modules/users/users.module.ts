import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { ProfileController } from './profile.controller';
import { UsersService } from './users.service';
import { ProfileActivityService } from './profile-activity.service';

@Module({
  controllers: [UsersController, ProfileController],
  providers: [UsersService, ProfileActivityService],
  exports: [UsersService],
})
export class UsersModule {}
