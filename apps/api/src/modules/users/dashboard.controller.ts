import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { ProfileActivityService } from './profile-activity.service';

/**
 * High-performance aggregated Executive Dashboard API.
 * Route: GET /api/v1/dashboard/overview
 * Scoped strictly to the authenticated user from the verified JWT.
 */
@ApiTags('dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly activityService: ProfileActivityService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Get unified multi-domain dashboard overview' })
  async getOverview(@CurrentUser() auth: AuthenticatedUser) {
    return this.activityService.getDashboardOverview(auth);
  }
}
