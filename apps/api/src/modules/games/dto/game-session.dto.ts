import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';

/** Valid targets for the Lightning Dice free-play engine. */
const DICE_TARGETS = ['OVER_7', 'UNDER_7', 'EXACT_7'] as const;

/**
 * Start a free-play session.
 * `payload.target` is honored only by games that use it (Lightning Dice);
 * other engines ignore it.
 */
export class StartGameSessionDto {
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  target?: (typeof DICE_TARGETS)[number];
}

/** One action for the free-play engine (START / TICK / CASH_OUT / ROLL / CONCEDE). */
export class GameActionDto {
  @IsString()
  type!: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}