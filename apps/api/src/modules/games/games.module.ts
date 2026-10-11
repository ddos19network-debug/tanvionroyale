import { Module } from '@nestjs/common';
import { FreePlayGamesController } from './games.controller';
import { GamesService } from './games.service';

/**
 * Free-play games module (internally developed, zero-money games).
 * No free-play game touches the wallet, bets, odds or any licensed-provider
 * boundary — those stay behind the betting/payment fail-safe gates.
 */
@Module({
  controllers: [FreePlayGamesController],
  providers: [GamesService],
  exports: [GamesService],
})
export class GamesModule {}