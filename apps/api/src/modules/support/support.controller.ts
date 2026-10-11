import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { SupportService } from './support.service';
import {
  ListSupportMessagesQueryDto,
  SendSupportMessageDto,
} from './dto/support.dto';

/**
 * User Live Chat (support messaging) — REST.
 *
 * The identity is ALWAYS the authenticated user from the JWT; every query is
 * scoped to auth.id so a user can only ever read/write their OWN conversation
 * (IDOR-safe). Poll-based refresh matches the platform's existing REST design.
 */
@ApiTags('support')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('support/chat')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get()
  @ApiOperation({
    summary: 'My active Live Chat conversation + recent messages',
  })
  conversation(@CurrentUser() auth: AuthenticatedUser) {
    return this.support.getMyConversation(auth.id);
  }

  @Get('messages')
  @ApiOperation({ summary: 'Older message history (keyset pagination)' })
  messages(
    @CurrentUser() auth: AuthenticatedUser,
    @Query() query: ListSupportMessagesQueryDto,
  ) {
    return this.support.listMyMessages(auth.id, query);
  }

  @Post('messages')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Send a chat message (validated server-side)' })
  send(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() dto: SendSupportMessageDto,
  ) {
    return this.support.sendMyMessage(auth.id, dto);
  }

  @Post('read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark the conversation as read (user side)' })
  markRead(@CurrentUser() auth: AuthenticatedUser) {
    return this.support.markMyRead(auth.id);
  }
}
