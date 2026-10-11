import { Module } from '@nestjs/common';
import { AdminSportsController, GamesController, SportsController } from './sports.controller';
import { SportsService } from './sports.service';

@Module({
  controllers: [SportsController, GamesController, AdminSportsController],
  providers: [SportsService],
  exports: [SportsService],
})
export class SportsModule {}
