import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';

import { WalletService } from './wallet.service';
import { DepositService } from './deposit.service';
import { WithdrawalService } from './withdrawal.service';
import { ManualPaymentService } from './manual-payment.service';
import { CreateDepositDto } from './dto/create-deposit.dto';
import { CreateWithdrawalDto } from './dto/create-withdrawal.dto';
import { CreateManualWithdrawalDto } from './dto/create-manual-withdrawal.dto';
import { ListTransactionsQueryDto } from './dto/list-transactions-query.dto';
import {
  ListPaymentMethodsQueryDto,
  SubmitManualDepositDto,
} from './dto/manual-payment.dto';

/**
 * User wallet controller (Phase 6).
 *
 * Every balance mutation is performed by the ledger-backed wallet engine:
 * the frontend can never credit or debit a wallet directly. Gateway
 * deposits/withdrawals go through DepositService/WithdrawalService which use
 * the payment-provider factory; manual deposits are PENDING until an admin
 * approves them.
 *
 * Currency policy (server-enforced): BDT (default), USD, EUR.
 */
@ApiTags('wallet')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(
    private readonly walletService: WalletService,
    private readonly depositService: DepositService,
    private readonly withdrawalService: WithdrawalService,
    private readonly manualPaymentService: ManualPaymentService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Get the current user wallet (default currency)' })
  getWallet(@CurrentUser() auth: AuthenticatedUser) {
    return this.walletService.getMyWallet(auth);
  }

  @Get('balance')
  @ApiOperation({
    summary: 'Wallet balance. Optional currency: BDT (default), USD, EUR.',
  })
  async getBalance(
    @CurrentUser() auth: AuthenticatedUser,
    @Query('currency') currency?: string,
  ) {
    if (currency && currency.trim()) {
      return this.walletService.getMyBalanceByCurrency(auth, currency.trim());
    }
    return this.walletService.getMyBalance(auth);
  }

  @Get('transactions')
  @ApiOperation({ summary: 'List wallet transactions (paged, filterable)' })
  listTransactions(
    @CurrentUser() auth: AuthenticatedUser,
    @Query() query: ListTransactionsQueryDto,
  ) {
    return this.walletService.listMyTransactions(auth, {
      page: query.page,
      limit: query.limit,
      status: query.status && query.status !== 'ALL' ? query.status : undefined,
      currency: query.currency,
    });
  }

  @Get('transactions/:id')
  @ApiOperation({ summary: 'Get one wallet transaction owned by the caller' })
  getTransaction(
    @CurrentUser() auth: AuthenticatedUser,
    @Param('id') id: string,
  ) {
    return this.walletService.getMyTransaction(auth, id);
  }

  /* ---------------------------------------------------------------------- */
  /* Gateway deposits / withdrawals (provider selected by backend factory)   */
  /* ---------------------------------------------------------------------- */

  @Post('deposits')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a gateway deposit request (PENDING until verified)' })
  createDeposit(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() dto: CreateDepositDto,
    @Req() req: Request,
  ) {
    return this.depositService.createDeposit(
      auth,
      { ...dto, currency: dto.currency ?? 'BDT' },
      req.ip,
      req.headers['user-agent'],
    );
  }

  @Post('withdrawals')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Create a gateway withdrawal (funds reserved until settled)' })
  createWithdrawal(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() dto: CreateWithdrawalDto,
    @Req() req: Request,
  ) {
    return this.withdrawalService.createWithdrawal(
      auth,
      { ...dto, currency: dto.currency ?? 'BDT' },
      req.ip,
      req.headers['user-agent'],
    );
  }

  /* ---------------------------------------------------------------------- */
  /* Manual payment methods + manual deposits (admin-configured)             */
  /* ---------------------------------------------------------------------- */

  @Get('payment-methods')
  @ApiOperation({
    summary:
      'Active payment methods (bkash/nagad/rocket/bank/card) for a currency/purpose',
  })
  listPaymentMethods(@Query() query: ListPaymentMethodsQueryDto) {
    return this.manualPaymentService.listPaymentMethods(query);
  }

  @Post('manual-deposits')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Submit a manual deposit (transaction ID and/or screenshot). Stays PENDING until an admin approves it.',
  })
  submitManualDeposit(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() dto: SubmitManualDepositDto,
  ) {
    return this.manualPaymentService.submitManualDeposit(auth, dto);
  }

  @Get('manual-deposits')
  @ApiOperation({ summary: 'Current user manual deposit history' })
  listMyManualDeposits(@CurrentUser() auth: AuthenticatedUser) {
    return this.manualPaymentService.listMyDeposits(auth);
  }

  @Post('manual-withdrawals')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Submit a manual withdrawal (funds reserved, PENDING review)' })
  submitManualWithdrawal(
    @CurrentUser() auth: AuthenticatedUser,
    @Body() dto: CreateManualWithdrawalDto,
  ) {
    return this.manualPaymentService.submitManualWithdrawal(auth, dto);
  }

  @Get('manual-withdrawals')
  @ApiOperation({ summary: 'Current user manual withdrawal history' })
  listMyManualWithdrawals(@CurrentUser() auth: AuthenticatedUser) {
    return this.manualPaymentService.listMyWithdrawals(auth);
  }
}

