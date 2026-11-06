import { Module } from '@nestjs/common';
import { FreePlayGamesController } from './games.controller';
import { GamesService } from './games.service';
import { SlotController } from './slots/slot.controller';
import { SlotService } from './slots/slot.service';
import { CrashModule } from '../crash/crash.module';

/**
 * Free-play games module (internally developed, zero-money games).
 * Includes the 10 Royale Play slots (royale-pharaoh through frozen-empire)
 * with server-authoritative integer math and free-play points wallet integration.
 */
@Module({
  imports: [CrashModule],
  controllers: [FreePlayGamesController, SlotController],
  providers: [GamesService, SlotService],
  exports: [GamesService, SlotService],
})
export class GamesModule {}
