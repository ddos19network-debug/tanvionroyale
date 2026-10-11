import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ProfileActivityService } from './profile-activity.service';
import { ListActivityQueryDto } from './dto/list-activity-query.dto';
import { ListGamesQueryDto } from './dto/list-games-query.dto';

/**
 * Authenticated profile-center endpoints (GET /users/me/...).
 * All reads are scoped to the JWT user — no client-supplied userId.
 * Admin panel untouched: these live under the user controller namespace.
 */
@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('users/me')
export class ProfileController {
  constructor(private readonly activity: ProfileActivityService) {}

  @Get('summary')
  @ApiOperation({ summary: 'My account summary (wallet + totals)' })
  summary(@CurrentUser() auth: AuthenticatedUser) {
    return this.activity.getSummary(auth);
  }

  @Get('activity')
  @ApiOperation({ summary: 'My combined activity feed (paginated)' })
  listActivity(@CurrentUser() auth: AuthenticatedUser, @Query() query: ListActivityQueryDto) {
    return this.activity.listActivity(auth, query);
  }

  @Get('games')
  @ApiOperation({ summary: 'My free-play game results (paginated)' })
  listGames(@CurrentUser() auth: AuthenticatedUser, @Query() query: ListGamesQueryDto) {
    return this.activity.listGames(auth, query);
  }

  @Get('crash')
  @ApiOperation({ summary: 'My Sky Rocket crash bets (paginated)' })
  listCrash(@CurrentUser() auth: AuthenticatedUser, @Query() query: ListGamesQueryDto) {
    return this.activity.listCrash(auth, query);
  }
}
