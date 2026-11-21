import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { Public } from '../../common/decorators/public.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ADMIN_PERMISSIONS } from '@tanvion-royale/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';
import { P2PService } from './p2p.service';
import {
  ListP2POffersQueryDto,
  P2PQuoteDto,
  CreateP2POrderDto,
  SubmitP2PPaymentDto,
  CancelP2POrderDto,
  ListP2POrdersQueryDto,
  AdminP2POfferDto,
  AdminVerifyP2PPaymentDto,
  AdminResolveP2PDisputeDto,
} from './dto/p2p.dto';

@ApiTags('p2p')
@Controller('p2p')
export class P2PController {
  constructor(private readonly p2p: P2PService) {}

  @Get('offers')
  @Public()
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @ApiOperation({ summary: 'List active P2P marketplace offers' })
  async offers(@Query() query: ListP2POffersQueryDto) {
    return this.p2p.listOffers(query);
  }

  @Get('quote')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Estimate crypto quantity for a fiat amount' })
  async quote(
    @CurrentUser() auth: AuthenticatedUser,
    @Query() dto: P2PQuoteDto,
  ) {
    void auth;
    return this.p2p.getQuote(dto);
  }

  @Post('orders')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a P2P order (reserves buyer funds)' })
  async createOrder(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() dto: CreateP2POrderDto,
  ) {
    return this.p2p.createOrder(auth, dto);
  }

  @Get('orders/:id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get P2P order details with payment and dispute' })
  async getOrder(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.p2p.getOrder(auth, id);
  }

  @Post('orders/:id/payment')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Submit payment evidence for a P2P order' })
  async submitPayment(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SubmitP2PPaymentDto,
  ) {
    dto.orderId = id;
    return this.p2p.submitPayment(auth, dto);
  }

  @Post('orders/:id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Cancel a P2P order and release reserved funds' })
  async cancelOrder(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CancelP2POrderDto,
  ) {
    dto.orderId = id;
    return this.p2p.cancelOrder(auth, dto);
  }

  @Get('orders')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "List the current user's P2P orders" })
  async listOrders(
    @CurrentUser() auth: AuthenticatedUser,
    @Query() query: ListP2POrdersQueryDto,
  ) {
    return this.p2p.listOrders(auth, query);
  }

  @Get('royale-pay/balance')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get Royale Pay (wallet) balance' })
  async royalePayBalance(@CurrentUser() auth: AuthenticatedUser) {
    return this.p2p.getRoyalePayBalance(auth);
  }
}

/**
 * Admin P2P endpoints (role protected).
 */
@ApiTags('admin/p2p')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Roles('SUPER_ADMIN', 'ADMIN')
@Controller('admin/p2p')
export class AdminP2PController {
  constructor(private readonly p2p: P2PService) {}

  @Get('offers')
  @RequirePermissions(ADMIN_PERMISSIONS.TRADING_READ)
  @ApiOperation({ summary: 'List all P2P offers (admin)' })
  async adminListOffers() {
    return this.p2p.adminListOffers();
  }

  @Post('offers')
  @RequirePermissions(ADMIN_PERMISSIONS.TRADING_MANAGE)
  @ApiOperation({ summary: 'Create a P2P merchant offer (admin)' })
  async adminCreateOffer(@Body() dto: AdminP2POfferDto) {
    return this.p2p.adminCreateOffer(dto);
  }

  @Patch('offers/:id')
  @RequirePermissions(ADMIN_PERMISSIONS.TRADING_MANAGE)
  @ApiOperation({ summary: 'Update a P2P merchant offer (admin)' })
  async adminUpdateOffer(
    @Param('id') id: string,
    @Body() dto: AdminP2POfferDto,
  ) {
    return this.p2p.adminUpdateOffer(id, dto);
  }

  @Get('orders')
  @RequirePermissions(ADMIN_PERMISSIONS.TRADING_READ)
  @ApiOperation({ summary: 'List all P2P orders (admin)' })
  async adminListOrders() {
    return this.p2p.adminListOrders();
  }

  @Post('orders/:id/verify-payment')
  @RequirePermissions(ADMIN_PERMISSIONS.TRADING_MANAGE)
  @ApiOperation({ summary: 'Verify or reject a P2P payment (admin)' })
  async adminVerifyPayment(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminVerifyP2PPaymentDto,
  ) {
    dto.orderId = id;
    return this.p2p.adminVerifyPayment(auth, dto);
  }

  @Post('orders/:id/complete')
  @RequirePermissions(ADMIN_PERMISSIONS.TRADING_MANAGE)
  @ApiOperation({ summary: 'Complete a verified P2P order (admin)' })
  async adminCompleteOrder(@Param('id') id: string) {
    return this.p2p.adminCompleteOrder(id);
  }

  @Get('disputes')
  @RequirePermissions(ADMIN_PERMISSIONS.TRADING_READ)
  @ApiOperation({ summary: 'List all P2P disputes (admin)' })
  async adminListDisputes() {
    return this.p2p.adminListDisputes();
  }

  @Post('disputes/:id/resolve')
  @RequirePermissions(ADMIN_PERMISSIONS.TRADING_MANAGE)
  @ApiOperation({ summary: 'Resolve a P2P dispute (admin)' })
  async adminResolveDispute(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AdminResolveP2PDisputeDto,
  ) {
    dto.disputeId = id;
    return this.p2p.adminResolveDispute(auth, dto);
  }
}