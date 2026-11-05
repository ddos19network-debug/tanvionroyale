import { Module } from '@nestjs/common';
import { RouletteGateway } from './roulette.gateway';
import { RouletteRoundEngine } from './roulette-round-engine';

@Module({
  providers: [RouletteGateway, RouletteRoundEngine],
  exports: [RouletteRoundEngine],
})
export class RouletteModule {}

