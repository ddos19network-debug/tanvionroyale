/**
 * SlotController — REST endpoints for the 10 Royale Play slots.
 *
 * GET  /games/play/:slug/slot/config  (public)
 * POST /games/play/:slug/slot/spin    (auth required)
 * GET  /games/play/:slug/slot/rounds  (auth required)
 */

import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user';
import { SlotService } from './slot.service';
import type {
  SlotConfigView,
  SlotRoundHistoryEntry,
  SlotSpinRequest,
  SlotSpinResponse,
} from '@tanvion-royale/types';

@ApiTags('games/play/slots')
@Controller('games/play/:slug/slot')
export class SlotController {
  constructor(private readonly slotService: SlotService) {}

  @Public()
  @Get('config')
  @ApiOperation({ summary: 'Get public slot configuration and paytable' })
  getConfig(@Param('slug') slug: string): SlotConfigView {
    return this.slotService.getConfig(slug);
  }

  @Post('spin')
  @ApiOperation({ summary: 'Play a server-authoritative slot spin' })
  spin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
    @Body() dto: SlotSpinRequest,
  ): Promise<SlotSpinResponse> {
    return this.slotService.spin(user.id, slug, dto);
  }

  @Get('rounds')
  @ApiOperation({ summary: 'Recent slot rounds history for the user' })
  listRounds(
    @CurrentUser() user: AuthenticatedUser,
    @Param('slug') slug: string,
  ): Promise<SlotRoundHistoryEntry[]> {
    return this.slotService.listRounds(user.id, slug);
  }
}
