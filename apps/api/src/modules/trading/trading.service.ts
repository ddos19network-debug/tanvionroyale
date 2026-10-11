import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  type MarketDataProvider,
  type MarketPrice,
  createMarketDataProvider,
} from './market-data.provider';
import { loadTradingConfig, type TradingConfig } from './trading.config';

export type TradingOrderSideView = 'BUY' | 'SELL';

export interface TradingAccountView {
  id: string;
  currency: string;
  virtualBalance: number; // minor units — VIRTUAL money only
  startingBalance: number;
  createdAt: string;
}

export interface TradingTransactionView {
  id: string;
  type: string;
  amount: number; // signed minor units
  reason: string;
  createdAt: string;
}

export interface TradingOrderView {
  id: string;
  instrumentId: string;
  symbol: string;
  name: string;
  side: TradingOrderSideView;
  status: 'FILLED' | 'REJECTED' | 'CANCELLED';
  quantity: number;
  priceFilled: number | null;
  notional: number;
  failureReason: string | null;
  createdAt: string;
}

export interface TradingPositionView {
  id: string;
  instrumentId: string;
  symbol: string;
  name: string;
  side: TradingOrderSideView;
  quantity: number;
  avgEntryPrice: number;
  currentPrice: number;
  unrealizedPnl: number; // minor units
  status: 'OPEN' | 'CLOSED';
  realizedPnl: number;
  closedAt: string | null;
  createdAt: string;
}

export interface TradingInstrumentView {
  id: string;
  symbol: string;
  name: string;
  type: string;
  basePrice: number;
  isEnabled: boolean;
  dataSource: string;
  currentPrice: number;
  priceAsOf: string | null;
  priceLabel: string;
}

export interface InstrumentDetailView extends TradingInstrumentView {
  history: { t: string; price: number }[];
}

export interface PortfolioView {
  account: TradingAccountView;
  marketStatus: { open: boolean; label: string; dataSource: string };
  realizedPnl: number;
  unrealizedPnl: number;
  equity: number; // virtual balance + unrealized P&L (minor units)
  positions: TradingPositionView[];
}

export interface OrderResultView {
  order: TradingOrderView;
  account: TradingAccountView;
  /** Set when the order closed an existing open position. */
  closedPosition: TradingPositionView | null;
  /** Set when a new open position was created. */
  openedPosition: TradingPositionView | null;
}

/** Safe, user-facing paper-trading errors. */
export class TradingErrors {
  static insufficientBalance(): BadRequestException {
    return new BadRequestException('Insufficient virtual balance for this paper order.');
  }
  static positionExists(): ConflictException {
    return new ConflictException(
      'You already have an open paper position for this instrument. Close it first.',
    );
  }
}

/**
 * Paper-trading engine (server-authoritative).
 *
 * - Prices always come from the injected MarketDataProvider (never the client).
 * - Balances and P&L are computed exclusively with INTEGER minor-unit math.
 * - Every virtual-balance mutation is persisted as a TradingTransaction row in
 *   the same DB transaction (append-only paper ledger).
 * - The paper account is deliberately separate from the real Wallet.
 */
@Injectable()
export class TradingService {
  private readonly config: TradingConfig;
  private readonly data: MarketDataProvider;

  constructor(private readonly prisma: PrismaService, @Optional() data?: MarketDataProvider) {
    this.config = loadTradingConfig();
    // Provider resolution mirrors the rest of the platform: without a real
    // market-data feed the DEMO provider is used and ALWAYS labeled DEMO.
    this.data = data ?? createMarketDataProvider();
  }

  // --------------------------------------------------------------------------
  // Accounts
  // --------------------------------------------------------------------------

  async getOrCreateAccount(userId: string): Promise<TradingAccountView> {
    const existing = await this.prisma.tradingAccount.findUnique({
      where: { userId },
    });
    if (existing) return this.toAccountView(existing);

    return this.prisma.$transaction(async (tx) => {
      const account = await tx.tradingAccount.create({
        data: {
          userId,
          currency: this.config.currency,
          virtualBalance: this.config.startingBalanceMinor,
        },
      });
      await tx.tradingTransaction.create({
        data: {
          accountId: account.id,
          type: 'ACCOUNT_CREDIT',
          amount: account.virtualBalance,
          reason: 'VIRTUAL_STARTING_BALANCE',
        },
      });
      return this.toAccountView(account);
    });
  }

  async getAccountView(userId: string): Promise<TradingAccountView | null> {
    const account = await this.prisma.tradingAccount.findUnique({ where: { userId } });
    return account ? this.toAccountView(account) : null;
  }

  // --------------------------------------------------------------------------
  // Instruments (market data)
  // --------------------------------------------------------------------------

  async listInstruments(userId: string): Promise<TradingInstrumentView[]> {
    await this.getOrCreateAccount(userId);
    const instruments = await this.prisma.tradingInstrument.findMany({
      where: { isEnabled: true },
      orderBy: { sortOrder: 'asc' },
    });
    return instruments.map((inst) => this.toInstrumentView(inst, this.data.getLatestPrice(inst)));
  }

  async getInstrument(userId: string, instrumentId: string): Promise<InstrumentDetailView> {
    await this.getOrCreateAccount(userId);
    const instrument = await this.prisma.tradingInstrument.findUnique({
      where: { id: instrumentId },
    });
    if (!instrument || !instrument.isEnabled) {
      throw new NotFoundException('Instrument not found');
    }
    const quote = this.data.getLatestPrice(instrument);
    const history = this.data.getHistoricalPrices(instrument, this.config.historyPoints);
    return { ...this.toInstrumentView(instrument, quote), history };
  }

  // --------------------------------------------------------------------------
  // Orders
  // --------------------------------------------------------------------------

  /** Opens a new paper position or (opposite side) closes an existing one. */
  async placeOrder(
    userId: string,
    instrumentId: string,
    side: TradingOrderSideView,
    quantity: number,
  ): Promise<OrderResultView> {
    if (side !== 'BUY' && side !== 'SELL') {
      throw new BadRequestException('side must be BUY or SELL');
    }
    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new BadRequestException('quantity must be a positive whole number');
    }
    if (quantity > this.config.maxOrderQuantity) {
      throw new BadRequestException('quantity exceeds the maximum per order');
    }

    const instrument = await this.prisma.tradingInstrument.findUnique({
      where: { id: instrumentId },
    });
    if (!instrument || !instrument.isEnabled) {
      throw new NotFoundException('Instrument is not available');
    }
    const quote = this.data.getLatestPrice(instrument);

    return this.prisma.$transaction(async (tx) => {
      const account = await tx.tradingAccount.findUnique({ where: { userId } });
      if (!account) {
        throw new NotFoundException('Trading account not found. Create one first.');
      }

      const openPosition = await tx.tradingPosition.findFirst({
        where: { accountId: account.id, instrumentId, status: 'OPEN' },
      });

      // Same side => only one open paper position at a time; opposite side =>
      // this order closes the full position in one round trip.
      if (openPosition) {
        if (openPosition.side === side) {
          throw TradingErrors.positionExists();
        }
        if (openPosition.quantity !== quantity) {
          throw new BadRequestException(
            `Close quantity must equal the open position quantity (${openPosition.quantity}).`,
          );
        }
        return this.closePositionTx(tx, account, openPosition, instrument, quote);
      }

      // Open a fresh position (BUY long or SELL short — paper only).
      const cost = quote.price * quantity;
      if (side === 'BUY' && account.virtualBalance < cost) {
        throw TradingErrors.insufficientBalance();
      }
      const balanceAfter =
        side === 'BUY' ? account.virtualBalance - cost : account.virtualBalance + cost;

      const order = await tx.tradingOrder.create({
        data: {
          accountId: account.id,
          instrumentId: instrument.id,
          side,
          status: 'FILLED',
          priceFilled: quote.price,
          quantity,
          notional: cost,
        },
      });
      await tx.tradingTransaction.create({
        data: {
          accountId: account.id,
          type: side === 'BUY' ? 'BUY' : 'SELL',
          amount: side === 'BUY' ? -cost : cost,
          reason: `${side} ${instrument.symbol}`,
        },
      });
      const position = await tx.tradingPosition.create({
        data: {
          accountId: account.id,
          instrumentId: instrument.id,
          side,
          quantity,
          avgEntryPrice: quote.price,
        },
      });
      const updatedAccount = await tx.tradingAccount.update({
        where: { id: account.id },
        data: { virtualBalance: balanceAfter },
      });

      return {
        order: this.toOrderView(order, instrument),
        account: this.toAccountView(updatedAccount),
        closedPosition: null,
        openedPosition: this.toPositionView(position, instrument, quote.price),
      };
    });
  }

  async closePosition(userId: string, positionId: string): Promise<OrderResultView> {
    const position = await this.prisma.tradingPosition.findUnique({
      where: { id: positionId },
    });
    if (!position) throw new NotFoundException('Position not found');
    const account = await this.prisma.tradingAccount.findUnique({
      where: { id: position.accountId },
    });
    if (!account || account.userId !== userId) {
      throw new NotFoundException('Position not found');
    }
    const instrument = await this.prisma.tradingInstrument.findUnique({
      where: { id: position.instrumentId },
    });
    if (!instrument || !instrument.isEnabled) {
      throw new ConflictException('Instrument is not currently open for trading');
    }
    const quote = this.data.getLatestPrice(instrument);

    return this.prisma.$transaction(async (tx) => {
      const fresh = await tx.tradingPosition.findUnique({ where: { id: positionId } });
      if (!fresh || fresh.accountId !== account.id) {
        throw new NotFoundException('Position not found');
      }
      if (fresh.status !== 'OPEN') {
        throw new ConflictException('Position is already closed');
      }
      return this.closePositionTx(tx, account, fresh, instrument, quote);
    });
  }

  /**
   * Core round-trip executor: closes a position, debits/credits the virtual
   * balance by the closing fill and realizes integer P&L in one transaction.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async closePositionTx(
    tx: any,
    account: { id: string; virtualBalance: number },
    position: { id: string; side: string; quantity: number; avgEntryPrice: number },
    instrument: { id: string; symbol: string; name: string },
    quote: MarketPrice,
  ): Promise<OrderResultView> {
    const side = position.side as 'BUY' | 'SELL';
    const closeSide: 'BUY' | 'SELL' = side === 'BUY' ? 'SELL' : 'BUY';
    const cost = quote.price * position.quantity;
    const pnl =
      side === 'BUY'
        ? (quote.price - position.avgEntryPrice) * position.quantity
        : (position.avgEntryPrice - quote.price) * position.quantity;

    const balanceAfter =
      closeSide === 'SELL' ? account.virtualBalance + cost : account.virtualBalance - cost;
    if (balanceAfter < 0) {
      throw TradingErrors.insufficientBalance();
    }

    const order = await tx.tradingOrder.create({
      data: {
        accountId: account.id,
        instrumentId: instrument.id,
        side: closeSide,
        status: 'FILLED',
        priceFilled: quote.price,
        quantity: position.quantity,
        notional: cost,
      },
    });
    await tx.tradingTransaction.create({
      data: {
        accountId: account.id,
        type: pnl >= 0 ? 'CLOSE_PROFIT' : 'CLOSE_LOSS',
        amount: pnl,
        reason: `CLOSE ${instrument.symbol} PNL ${pnl >= 0 ? '+' : ''}${pnl}`,
      },
    });
    const closed = await tx.tradingPosition.update({
      where: { id: position.id },
      data: { status: 'CLOSED', realizedPnl: pnl, closedAt: new Date() },
    });
    const updatedAccount = await tx.tradingAccount.update({
      where: { id: account.id },
      data: { virtualBalance: balanceAfter },
    });
    return {
      order: this.toOrderView(order, instrument),
      account: this.toAccountView(updatedAccount),
      closedPosition: this.toPositionView(closed, instrument, quote.price),
      openedPosition: null,
    };
  }

  // --------------------------------------------------------------------------
  // Portfolio, history, leaderboard
  // --------------------------------------------------------------------------

  async listPortfolio(userId: string): Promise<PortfolioView> {
    const account = await this.getOrCreateAccount(userId);
    const [positions, instruments] = await Promise.all([
      this.prisma.tradingPosition.findMany({
        where: { accountId: account.id, status: 'OPEN' },
      }),
      this.prisma.tradingInstrument.findMany({ where: { isEnabled: true } }),
    ]);
    const byId = new Map(instruments.map((i) => [i.id, i]));

    let unrealized = 0;
    const views: TradingPositionView[] = [];
    for (const pos of positions) {
      const instrument = byId.get(pos.instrumentId);
      if (!instrument) continue;
      const quote = this.data.getLatestPrice(instrument);
      const pnl = this.positionPnl(pos.side, pos.avgEntryPrice, quote.price, pos.quantity);
      unrealized += pnl;
      views.push(this.toPositionView(pos, instrument, quote.price, pnl));
    }

    const closed = await this.prisma.tradingPosition.findMany({
      where: { accountId: account.id, status: 'CLOSED' },
    });
    const realized = closed.reduce((sum, p) => sum + (p.realizedPnl ?? 0), 0);

    return {
      account,
      marketStatus: this.data.getMarketStatus(),
      realizedPnl: realized,
      unrealizedPnl: unrealized,
      equity: account.virtualBalance + unrealized,
      positions: views,
    };
  }

  async listOrders(userId: string, limit = 50): Promise<TradingOrderView[]> {
    const account = await this.getOrCreateAccount(userId);
    const rows = await this.prisma.tradingOrder.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      include: { instrument: true },
    });
    return rows.map((order) => this.toOrderView(order, order.instrument));
  }

  async listTransactions(userId: string, limit = 50): Promise<TradingTransactionView[]> {
    const account = await this.getOrCreateAccount(userId);
    const rows = await this.prisma.tradingTransaction.findMany({
      where: { accountId: account.id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
    });
    return rows.map((t) => ({
      id: t.id,
      type: t.type,
      amount: t.amount,
      reason: t.reason,
      createdAt: t.createdAt.toISOString(),
    }));
  }

  async getLeaderboard(limit = 10): Promise<
    Array<{ username: string; equity: number; realizedPnl: number }>
  > {
    const accounts = await this.prisma.tradingAccount.findMany({
      include: { user: true, positions: { where: { status: 'OPEN' } } },
      take: 200,
      orderBy: { virtualBalance: 'desc' as const },
    });
    const instruments = await this.prisma.tradingInstrument.findMany({
      where: { isEnabled: true },
    });
    const byId = new Map(instruments.map((i) => [i.id, i]));
    const rows: Array<{ username: string; equity: number; realizedPnl: number }> = [];
    for (const acc of accounts) {
      let unrealized = 0;
      let realized = 0;
      for (const pos of acc.positions) {
        const instrument = byId.get(pos.instrumentId);
        if (!instrument) continue;
        const quote = this.data.getLatestPrice(instrument);
        unrealized += this.positionPnl(pos.side, pos.avgEntryPrice, quote.price, pos.quantity);
        realized += pos.realizedPnl ?? 0;
      }
      rows.push({
        username: acc.user.username,
        equity: acc.virtualBalance + unrealized + realized,
        realizedPnl: realized,
      });
    }
    rows.sort((a, b) => b.equity - a.equity);
    return rows.slice(0, limit);
  }

  // --------------------------------------------------------------------------
  // Admin
  // --------------------------------------------------------------------------

  async adminListInstruments(): Promise<
    Array<{
      id: string;
      symbol: string;
      name: string;
      type: string;
      basePrice: number;
      isEnabled: boolean;
      dataSource: string;
    }>
  > {
    const rows = await this.prisma.tradingInstrument.findMany({ orderBy: { sortOrder: 'asc' } });
    return rows.map((row) => ({
      id: row.id,
      symbol: row.symbol,
      name: row.name,
      type: row.type,
      basePrice: row.basePrice,
      isEnabled: row.isEnabled,
      dataSource: row.dataSource,
    }));
  }

  async adminSetInstrumentEnabled(
    instrumentId: string,
    isEnabled: boolean,
  ): Promise<{ id: string; isEnabled: boolean }> {
    const instrument = await this.prisma.tradingInstrument.findUnique({
      where: { id: instrumentId },
    });
    if (!instrument) throw new NotFoundException('Instrument not found');
    const updated = await this.prisma.tradingInstrument.update({
      where: { id: instrumentId },
      data: { isEnabled },
    });
    return { id: updated.id, isEnabled: updated.isEnabled };
  }

  // --------------------------------------------------------------------------
  // Integer math + view helpers
  // --------------------------------------------------------------------------

  /** P&L in minor units using integer math only (long or short). */
  private positionPnl(side: string, entry: number, current: number, quantity: number): number {
    return side === 'BUY' ? (current - entry) * quantity : (entry - current) * quantity;
  }

  private toAccountView(account: {
    id: string;
    currency: string;
    virtualBalance: number;
    createdAt?: Date;
  }): TradingAccountView {
    return {
      id: account.id,
      currency: account.currency ?? this.config.currency,
      virtualBalance: account.virtualBalance,
      startingBalance: this.config.startingBalanceMinor,
      createdAt: (account.createdAt ?? new Date()).toISOString(),
    };
  }

  private toInstrumentView(
    instrument: {
      id: string;
      symbol: string;
      name: string;
      type: string;
      basePrice: number;
      isEnabled: boolean;
      dataSource: string;
    },
    quote: MarketPrice,
  ): TradingInstrumentView {
    return {
      id: instrument.id,
      symbol: instrument.symbol,
      name: instrument.name,
      type: instrument.type,
      basePrice: instrument.basePrice,
      isEnabled: instrument.isEnabled,
      dataSource: instrument.dataSource,
      currentPrice: quote.price,
      priceAsOf: quote.asOf,
      priceLabel: quote.label,
    };
  }

  private toOrderView(
    order: Record<string, unknown>,
    instrument: { id: string; symbol: string; name: string },
  ): TradingOrderView {
    return {
      id: order.id as string,
      instrumentId: instrument.id,
      symbol: instrument.symbol,
      name: instrument.name,
      side: order.side as TradingOrderSideView,
      status: order.status as TradingOrderView['status'],
      quantity: order.quantity as number,
      priceFilled: (order.priceFilled as number | null) ?? null,
      notional: order.notional as number,
      failureReason: null,
      createdAt: (order.createdAt as Date).toISOString(),
    };
  }

  private toPositionView(
    pos: {
      id: string;
      side: string;
      quantity: number;
      avgEntryPrice: number;
      status: string;
      realizedPnl?: number | null;
      closedAt?: Date | null;
      createdAt?: Date;
    },
    instrument: { id: string; symbol: string; name: string },
    currentPrice: number,
    unrealizedOverride?: number,
  ): TradingPositionView {
    return {
      id: pos.id,
      instrumentId: instrument.id,
      symbol: instrument.symbol,
      name: instrument.name,
      side: pos.side as TradingOrderSideView,
      quantity: pos.quantity,
      avgEntryPrice: pos.avgEntryPrice,
      currentPrice,
      unrealizedPnl:
        unrealizedOverride ??
        this.positionPnl(pos.side, pos.avgEntryPrice, currentPrice, pos.quantity),
      status: pos.status as 'OPEN' | 'CLOSED',
      realizedPnl: pos.realizedPnl ?? 0,
      closedAt: pos.closedAt?.toISOString() ?? null,
      createdAt: (pos.createdAt ?? new Date()).toISOString(),
    };
  }
}