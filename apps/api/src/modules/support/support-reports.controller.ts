import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
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
  CreateProblemReportDto,
  ListMyReportsQueryDto,
  SendReportMessageDto,
} from './dto/support.dto';

/**
 * User "Report a Problem" (support/reports) — REST.
 *
 * A report is a support case of its own (source PROBLEM_REPORT): submitting one
 * ALWAYS creates a new ticket instead of reusing the Live Chat conversation, so
 * every reported problem keeps its own status, messages and screenshot.
 *
 * The identity is ALWAYS the authenticated user from the JWT; every query is
 * scoped to auth.id, so a user can only ever read/write their OWN reports
 * (IDOR-safe) — the DTO deliberately has no userId field.
 */
@ApiTags('support')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('support/reports')
export class SupportReportsController {
  constructor(private readonly support: SupportService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // screenshot payload — tighter than chat
  @ApiOperation({ summary: 'Submit a problem report (optionally with a screenshot)' })
  create(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() dto: CreateProblemReportDto,
  ) {
    return this.support.createProblemReport(auth.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'My problem reports (status filter + pagination)' })
  list(
    @CurrentUser() auth: AuthenticatedUser,
    @Query() query: ListMyReportsQueryDto,
  ) {
    return this.support.listMyReports(auth.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of MY reports with all messages' })
  getOne(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.support.getMyReport(auth.id, id);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Follow-up message on one of MY reports' })
  reply(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendReportMessageDto,
  ) {
    return this.support.replyToMyReport(auth.id, id, dto);
  }
}