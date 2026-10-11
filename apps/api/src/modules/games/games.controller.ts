import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { GamesService } from './games.service';
import { GameActionDto, StartGameSessionDto } from './dto/game-session.dto';

/**
 * FREE-PLAY games endpoint (internally developed, no real money).
 *
 * Routes are intentionally nested under /games/play/:slug so they can never
 * collide with the public sports-catalog /games/:slug route. Session and result
 * endpoints require authentication (the global JwtAuthGuard applies); the
 * public metadata endpoint is readable without an account.
 */
@ApiTags('games/play')
@Controller('games/play')
export class FreePlayGamesController {
  constructor(private readonly gamesService: GamesService) {}

  @Public()
  @Get(':slug')
  @ApiOperation({ summary: 'Get free-play game metadata by slug (public)' })
  getGame(@Param('slug') slug: string) {
    return this.gamesService.getGameMeta(slug);
  }

  @Post(':slug/sessions')
  @ApiOperation({ summary: 'Start a free-play session (auth required)' })
  startSession(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() dto: StartGameSessionDto,
  ) {
    return this.gamesService.startSession(auth.id, slug, dto);
  }

  @Get(':slug/sessions/active')
  @ApiOperation({ summary: 'Get my active free-play session, if any (auth required)' })
  getActiveSession(@CurrentUser() auth: AuthenticatedUser, @Param('slug') slug: string) {
    return this.gamesService.getActiveSession(auth.id, slug);
  }

  @Get(':slug/sessions/:sessionId')
  @ApiOperation({ summary: 'Get a free-play session by id (auth required, ownership enforced)' })
  getSession(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.gamesService.getSession(auth.id, slug, sessionId);
  }

  @Post(':slug/sessions/:sessionId/actions')
  @ApiOperation({ summary: 'Apply a free-play engine action (auth required)' })
  takeAction(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('slug') slug: string,
    @Param('sessionId') sessionId: string,
    @Body() dto: GameActionDto,
  ) {
    return this.gamesService.takeAction(auth.id, slug, sessionId, dto);
  }

  @Get(':slug/results')
  @ApiOperation({ summary: 'My recent free-play results for a game (auth required)' })
  listResults(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('slug') slug: string,
    @Query('limit') limit?: string,
  ) {
    // limit is intentionally ignored for now — the service returns the
    // most recent 20 rows; kept in the signature so clients may later paginate.
    void limit;
    return this.gamesService.listResults(auth.id, slug);
  }
}