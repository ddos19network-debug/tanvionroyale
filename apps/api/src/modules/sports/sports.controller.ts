import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SportsService } from './sports.service';
import {
  CreateGameDto,
  CreateSportDto,
  UpdateGameAvailabilityDto,
  UpdateGameDto,
  UpdateSportDto,
  UpsertProviderMappingDto,
} from './dto/sports.dto';

/**
 * Public, read-only sports catalog. Only ACTIVE content is served to normal
 * users; all availability decisions are computed server-side.
 */
@ApiTags('sports')
@Public()
@Controller('sports')
export class SportsController {
  constructor(private readonly sportsService: SportsService) {}

  @Get()
  @ApiOperation({ summary: 'List active sports' })
  async listSports() {
    return this.sportsService.listSports();
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Get an active sport by slug, with its active games' })
  async getSport(@Param('slug') slug: string) {
    return this.sportsService.getSportBySlug(slug);
  }

  @Get(':slug/games')
  @ApiOperation({ summary: 'List active games for an active sport' })
  async getSportGames(@Param('slug') slug: string) {
    return this.sportsService.getSportGames(slug);
  }

  @Get(':slug/competitions')
  @ApiOperation({ summary: 'List active competitions for an active sport' })
  async getSportCompetitions(@Param('slug') slug: string) {
    return this.sportsService.listCompetitions(slug);
  }
}

@ApiTags('games')
@Public()
@Controller('games')
export class GamesController {
  constructor(private readonly sportsService: SportsService) {}

  @Get(':slug')
  @ApiOperation({ summary: 'Get an active game by slug (public view)' })
  async getGame(@Param('slug') slug: string) {
    return this.sportsService.getGameBySlug(slug);
  }
}

/**
 * Admin catalog management. Uses the existing JWT + RBAC guards; normal users
 * can never modify the catalog.
 */
@ApiTags('admin/sports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
@RequirePermissions(ADMIN_PERMISSIONS.SPORTS_READ, ADMIN_PERMISSIONS.SPORTS_MANAGE)
@Controller('admin')
export class AdminSportsController {
  constructor(private readonly sportsService: SportsService) {}

  private context(req: Request): { ip?: string; userAgent?: string } {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  // -- Sports ---------------------------------------------------------------

  @Post('sports')
  @ApiOperation({ summary: 'Create a sport (admin)' })
  async createSport(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() dto: CreateSportDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.sportsService.adminCreateSport(auth, dto, ip, userAgent);
  }

  @Patch('sports/:id')
  @ApiOperation({ summary: 'Update a sport (admin)' })
  async updateSport(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSportDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.sportsService.adminUpdateSport(auth, id, dto, ip, userAgent);
  }

  @Delete('sports/:id')
  @ApiOperation({ summary: 'Delete a sport (admin)' })
  async deleteSport(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    const { ip, userAgent } = this.context(req);
    await this.sportsService.adminDeleteSport(auth, id, ip, userAgent);
  }

  // -- Games ----------------------------------------------------------------

  @Post('games')
  @ApiOperation({ summary: 'Create a game (admin)' })
  async createGame(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() dto: CreateGameDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.sportsService.adminCreateGame(auth, dto, ip, userAgent);
  }

  @Patch('games/:id')
  @ApiOperation({ summary: 'Update a game (admin)' })
  async updateGame(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateGameDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.sportsService.adminUpdateGame(auth, id, dto, ip, userAgent);
  }

  @Delete('games/:id')
  @ApiOperation({ summary: 'Delete a game (admin)' })
  async deleteGame(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
    @Req() req: Request,
  ): Promise<void> {
    const { ip, userAgent } = this.context(req);
    await this.sportsService.adminDeleteGame(auth, id, ip, userAgent);
  }

  // -- Availability & provider mapping ---------------------------------------

  @Patch('games/:id/availability')
  @ApiOperation({ summary: 'Enable/disable gambling for a game (admin)' })
  async updateAvailability(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateGameAvailabilityDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.sportsService.adminUpdateAvailability(auth, id, dto, ip, userAgent);
  }

  @Patch('games/:id/provider')
  @ApiOperation({ summary: 'Create/update the provider mapping for a game (admin)' })
  async upsertProviderMapping(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpsertProviderMappingDto,
    @Req() req: Request,
  ) {
    const { ip, userAgent } = this.context(req);
    return this.sportsService.adminUpsertProviderMapping(auth, id, dto, ip, userAgent);
  }
}
