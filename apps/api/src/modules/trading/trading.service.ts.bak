import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  type MarketDataProvider,
  type MarketPrice,
  type MarketCandle,
  type MarketOrderBook,
  type MarketTrade,
  createMarketDataProvider,
} from './market-data.provider';
import { loadTradingConfig, type TradingConfig } from './trading.config';

export type TradingOrderSideView = 'BUY' | 'SELL';
export type TradingOrderTypeView = 'MARKET' | 'LIMIT' | 'STOP_LIMIT';

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
  type?: TradingOrderTypeView;
  status: 'NEW' | 'SUBMITTING' | 'ACKNOWLEDGED' | 'FILLED' | 'REJECTED' | 'CANCELLED';
  quantity: number;
  priceFilled: number | null;
  limitPrice?: number | null;
  stopPrice?: number | null;
  notional: number;
  failureReason: string | null;
  createdAt: string;
  leverage?: number;
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
  leverage?: number;
  liquidationPrice?: number;
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
  change24h?: number;
  high24h?: number;
  low24h?: number;
  volume24h?: number;
}

export interface InstrumentDetailView extends TradingInstrumentView {
  history: { t: string; price: number }[];
  candles?: MarketCandle[];
}

export interface PortfolioView {
  account: TradingAccountView;
  marketStatus: { open: boolean; label: string; dataSource: string };
  realizedPnl: number;
  unrealizedPnl: number;
  equity: number; // virtual balance + unrealized P&L (minor units)
  positions: TradingPositionView[];
  openOrdersCount?: number;
}

export interface OrderResultView {
  order: TradingOrderView;
  account: TradingAccountView;
  /** Set when the order closed an existing open position. */
  closedPosition: TradingPositionView | null;
  /** Set when a new open position was created. */
  openedPosition: TradingPositionView | null;
}

export class TradingErrors {
  static insufficientBalance(): BadRequestException {
    return new BadRequestException('Insufficient virtual balance for this order.');
  }
  static positionExists(): ConflictException {
    return new ConflictException(
      'You already have an open position for this instrument. Close it first or modify it.',
    );
  }
}

const DEFAULT_INSTRUMENTS = [
  { symbol: 'BTCUSD', name: 'Bitcoin / USDT', type: 'CRYPTO' as const, basePrice: 8850000, sortOrder: 10 },
  { symbol: 'ETHUSD', name: 'Ethereum / USDT', type: 'CRYPTO' as const, basePrice: 315000, sortOrder: 20 },
  { symbol: 'SOLUSD', name: 'Solana / USDT', type: 'CRYPTO' as const, basePrice: 21200, sortOrder: 30 },
  { symbol: 'BNBUSD', name: 'BNB / USDT', type: 'CRYPTO' as const, basePrice: 63500, sortOrder: 40 },
  { symbol: 'XRPUSD', name: 'Ripple / USDT', type: 'CRYPTO' as const, basePrice: 72, sortOrder: 50 },
  { symbol: 'EURUSD', name: 'Euro / US Dollar', type: 'FOREX' as const, basePrice: 10850, sortOrder: 60 },
  { symbol: 'GBPUSD', name: 'British Pound / US Dollar', type: 'FOREX' as const, basePrice: 12980, sortOrder: 70 },
  { symbol: 'USDJPY', name: 'US Dollar / Japanese Yen', type: 'FOREX' as const, basePrice: 15240, sortOrder: 80 },
  { symbol: 'AUDCAD', name: 'Australian Dollar / Canadian Dollar', type: 'FOREX' as const, basePrice: 9150, sortOrder: 82 },
  { symbol: 'AUDUSD', name: 'Australian Dollar / US Dollar', type: 'FOREX' as const, basePrice: 6650, sortOrder: 85 },
  { symbol: 'XAUUSD', name: 'Gold Spot / US Dollar', type: 'COMMODITY' as const, basePrice: 268500, sortOrder: 90 },
  { symbol: 'USOIL', name: 'WTI Crude Oil', type: 'COMMODITY' as const, basePrice: 7120, sortOrder: 100 },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', type: 'STOCK' as const, basePrice: 14500, sortOrder: 110 },
  { symbol: 'SPCXB', name: 'SpaceX (bStocks)', type: 'STOCK' as const, basePrice: 13550, sortOrder: 115 },
  { symbol: 'AAPL', name: 'Apple Inc.', type: 'STOCK' as const, basePrice: 22800, sortOrder: 120 },
  { symbol: 'TSLA', name: 'Tesla Inc.', type: 'STOCK' as const, basePrice: 31000, sortOrder: 130 },
  { symbol: 'MSFT', name: 'Microsoft Corp.', type: 'STOCK' as const, basePrice: 42500, sortOrder: 140 },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', type: 'STOCK' as const, basePrice: 20800, sortOrder: 150 },
];

@Injectable()
export class TradingService implements OnModuleInit {
  private readonly config: TradingConfig;
  private readonly data: MarketDataProvider;
  /** In-memory active limit orders waiting to trigger (keyed by userId) */
  private readonly pendingOrders = new Map<string, TradingOrderView[]>();

  constructor(private readonly prisma: PrismaService, @Optional() data?: MarketDataProvider) {
    this.config = loadTradingConfig();
    this.data = data ?? createMarketDataProvider();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureSeedInstruments();
    } catch {
      // Non-blocking in case migration is running
    }
  }

  /** Seed comprehensive crypto, forex, commodities, and stock instruments if missing. */
  async ensureSeedInstruments(): Promise<void> {
    try {
      const count = await this.prisma.tradingInstrument.count();
      if (count < 8) {
        for (const inst of DEFAULT_INSTRUMENTS) {
          await this.prisma.tradingInstrument.upsert({
            where: { symbol: inst.symbol },
            update: {
              name: inst.name,
              type: inst.type,
              basePrice: inst.basePrice,
              sortOrder: inst.sortOrder,
            },
            create: {
              symbol: inst.symbol,
              name: inst.name,
              type: inst.type,
              basePrice: inst.basePrice,
              sortOrder: inst.sortOrder,
              dataSource: 'DEMO',
              isEnabled: true,
            },
          });
        }
      }
    } catch {
      // Safe fallback
    }
  }

  // --------------------------------------------------------------------------
  // Accounts & Faucet
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

  /** Demo faucet to top up or reset virtual balance. */
  async claimFaucet(
    userId: string,
    amountMinor = 1_000_000, // $10,000.00
    reset = false,
  ): Promise<TradingAccountView> {
    const account = await this.getOrCreateAccount(userId);
    const targetAmount = Math.max(10_000, Math.trunc(amountMinor)); // min $100

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.tradingAccount.findUnique({ where: { id: account.id } });
      if (!current) throw new NotFoundException('Account not found');

      const newBalance = reset ? targetAmount : current.virtualBalance + targetAmount;
      const creditDelta = reset ? targetAmount - current.virtualBalance : targetAmount;

      await tx.tradingTransaction.create({
        data: {
          accountId: current.id,
          type: 'ACCOUNT_CREDIT',
          amount: creditDelta,
          reason: reset ? 'DEMO_BALANCE_RESET' : 'DEMO_FAUCET_TOPUP',
        },
      });

      const updated = await tx.tradingAccount.update({
        where: { id: current.id },
        data: { virtualBalance: newBalance },
      });

      return this.toAccountView(updated);
    });
  }

  // --------------------------------------------------------------------------
  // Instruments & Market Data (Public & Fast)
  // --------------------------------------------------------------------------

  async listInstruments(userId?: string): Promise<TradingInstrumentView[]> {
    if (userId) {
      try {
        await this.getOrCreateAccount(userId);
      } catch {
        // Non-blocking
      }
    }
    const instruments = await this.prisma.tradingInstrument.findMany({
      where: { isEnabled: true },
      orderBy: { sortOrder: 'asc' },
    });
    return instruments.map((inst) => this.toInstrumentView(inst, this.data.getLatestPrice(inst)));
  }

  async getInstrument(userId: string | undefined, instrumentIdOrSymbol: string): Promise<InstrumentDetailView> {
    const instrument = await this.findInstrument(instrumentIdOrSymbol);
    const quote = this.data.getLatestPrice(instrument);
    const history = this.data.getHistoricalPrices(instrument, this.config.historyPoints);
    const candles = this.data.getCandles(instrument, '15m', 80);
    return { ...this.toInstrumentView(instrument, quote), history, candles };
  }

  async getCandles(
    userId: string | undefined,
    instrumentIdOrSymbol: string,
    timeframe = '15m',
    count = 80,
  ): Promise<MarketCandle[]> {
    const instrument = await this.findInstrument(instrumentIdOrSymbol);
    return this.data.getCandles(instrument, timeframe, count);
  }

  async getOrderBook(
    userId: string | undefined,
    instrumentIdOrSymbol: string,
  ): Promise<MarketOrderBook> {
    const instrument = await this.findInstrument(instrumentIdOrSymbol);
    return this.data.getOrderBook(instrument);
  }

  async getRecentTrades(
    userId: string | undefined,
    instrumentIdOrSymbol: string,
    count = 25,
  ): Promise<MarketTrade[]> {
    const instrument = await this.findInstrument(instrumentIdOrSymbol);
    return this.data.getRecentTrades(instrument, count);
  }

  private async findInstrument(idOrSymbol: string) {
    const cleanSymbol = idOrSymbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const instrument = await this.prisma.tradingInstrument.findFirst({
      where: {
        OR: [
          { id: idOrSymbol },
          { symbol: idOrSymbol },
          { symbol: cleanSymbol },
        ],
      },
    });
    if (!instrument || !instrument.isEnabled) {
      throw new NotFoundException('Instrument not found or is disabled');
    }
    return instrument;
  }

  // --------------------------------------------------------------------------
  // Orders & Execution
  // --------------------------------------------------------------------------

  async placeOrder(
    userId: string,
    instrumentId: string,
    side: TradingOrderSideView,
    quantity: number,
    type: TradingOrderTypeView = 'MARKET',
    limitPrice?: number,
    stopPrice?: number,
    leverage = 1,
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

    const instrument = await this.findInstrument(instrumentId);
    const quote = this.data.getLatestPrice(instrument);
    const marketPrice = quote.price;

    return this.prisma.$transaction(async (tx) => {
      const account = await tx.tradingAccount.findUnique({ where: { userId } });
      if (!account) {
        throw new NotFoundException('Trading account not found. Create one first.');
      }

      // Check if this order is a LIMIT order that does not cross the market yet
      const isLimitWaiting =
        type === 'LIMIT' &&
        limitPrice != null &&
        ((side === 'BUY' && limitPrice < marketPrice) || (side === 'SELL' && limitPrice > marketPrice));

      if (isLimitWaiting) {
        const requiredCost = Math.round((limitPrice * quantity) / Math.max(1, leverage));
        if (side === 'BUY' && account.virtualBalance < requiredCost) {
          throw TradingErrors.insufficientBalance();
        }

        const balanceAfter =
          side === 'BUY' ? account.virtualBalance - requiredCost : account.virtualBalance;

        if (side === 'BUY') {
          await tx.tradingTransaction.create({
            data: {
              accountId: account.id,
              type: 'BUY',
              amount: -requiredCost,
              reason: `LIMIT_RESERVE ${instrument.symbol} @ ${(limitPrice / 100).toFixed(2)}`,
            },
          });
          await tx.tradingAccount.update({
            where: { id: account.id },
            data: { virtualBalance: balanceAfter },
          });
        }

        const pendingOrder: TradingOrderView = {
          id: `ord_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          instrumentId: instrument.id,
          symbol: instrument.symbol,
          name: instrument.name,
          side,
          type,
          status: 'ACKNOWLEDGED',
          quantity,
          priceFilled: null,
          limitPrice,
          notional: limitPrice * quantity,
          failureReason: null,
          createdAt: new Date().toISOString(),
          leverage,
        };

        const existing = this.pendingOrders.get(userId) ?? [];
        this.pendingOrders.set(userId, [pendingOrder, ...existing]);

        const updatedAccount = await tx.tradingAccount.findUniqueOrThrow({ where: { id: account.id } });

        return {
          order: pendingOrder,
          account: this.toAccountView(updatedAccount),
          closedPosition: null,
          openedPosition: null,
        };
      }

      // Market fill or crossed Limit order:
      const fillPrice = type === 'LIMIT' && limitPrice ? limitPrice : marketPrice;

      const openPosition = await tx.tradingPosition.findFirst({
        where: { accountId: account.id, instrumentId: instrument.id, status: 'OPEN' },
      });

      if (openPosition) {
        if (openPosition.side === side) {
          throw TradingErrors.positionExists();
        }
        if (openPosition.quantity !== quantity) {
          throw new BadRequestException(
            `Close quantity must equal the open position quantity (${openPosition.quantity}).`,
          );
        }
        return this.closePositionTx(tx, account, openPosition, instrument, fillPrice);
      }

      // Open new position
      const notional = fillPrice * quantity;
      const marginCost = Math.round(notional / Math.max(1, leverage));

      if (side === 'BUY' && account.virtualBalance < marginCost) {
        throw TradingErrors.insufficientBalance();
      }

      const balanceAfter =
        side === 'BUY' ? account.virtualBalance - marginCost : account.virtualBalance + marginCost;

      const order = await tx.tradingOrder.create({
        data: {
          accountId: account.id,
          instrumentId: instrument.id,
          side,
          status: 'FILLED',
          priceFilled: fillPrice,
          quantity,
          notional,
        },
      });

      await tx.tradingTransaction.create({
        data: {
          accountId: account.id,
          type: side === 'BUY' ? 'BUY' : 'SELL',
          amount: side === 'BUY' ? -marginCost : marginCost,
          reason: `${side} ${instrument.symbol} @ ${(fillPrice / 100).toFixed(2)}${leverage > 1 ? ` (${leverage}x)` : ''}`,
        },
      });

      const position = await tx.tradingPosition.create({
        data: {
          accountId: account.id,
          instrumentId: instrument.id,
          side,
          quantity,
          avgEntryPrice: fillPrice,
        },
      });

      const updatedAccount = await tx.tradingAccount.update({
        where: { id: account.id },
        data: { virtualBalance: balanceAfter },
      });

      return {
        order: this.toOrderView(order, instrument, type, fillPrice, leverage),
        account: this.toAccountView(updatedAccount),
        closedPosition: null,
        openedPosition: this.toPositionView(position, instrument, fillPrice, undefined, leverage),
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
      return this.closePositionTx(tx, account, fresh, instrument, quote.price);
    });
  }

  private async closePositionTx(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    tx: any,
    account: { id: string; virtualBalance: number },
    position: { id: string; side: string; quantity: number; avgEntryPrice: number },
    instrument: { id: string; symbol: string; name: string },
    currentPrice: number,
  ): Promise<OrderResultView> {
    const side = position.side as 'BUY' | 'SELL';
    const closeSide: 'BUY' | 'SELL' = side === 'BUY' ? 'SELL' : 'BUY';
    const cost = currentPrice * position.quantity;
    const pnl =
      side === 'BUY'
        ? (currentPrice - position.avgEntryPrice) * position.quantity
        : (position.avgEntryPrice - currentPrice) * position.quantity;

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
        priceFilled: currentPrice,
        quantity: position.quantity,
        notional: cost,
      },
    });

    await tx.tradingTransaction.create({
      data: {
        accountId: account.id,
        type: pnl >= 0 ? 'CLOSE_PROFIT' : 'CLOSE_LOSS',
        amount: pnl,
        reason: `CLOSE ${instrument.symbol} PNL ${pnl >= 0 ? '+' : ''}${(pnl / 100).toFixed(2)}`,
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
      order: this.toOrderView(order, instrument, 'MARKET', currentPrice),
      account: this.toAccountView(updatedAccount),
      closedPosition: this.toPositionView(closed, instrument, currentPrice),
      openedPosition: null,
    };
  }

  async cancelOrder(userId: string, orderId: string): Promise<TradingOrderView> {
    const account = await this.getOrCreateAccount(userId);
    const userPending = this.pendingOrders.get(userId) ?? [];
    const idx = userPending.findIndex((o) => o.id === orderId);

    if (idx === -1) {
      // Check if it exists in database
      const dbOrder = await this.prisma.tradingOrder.findUnique({
        where: { id: orderId },
        include: { instrument: true },
      });
      if (dbOrder && dbOrder.accountId === account.id) {
        return this.toOrderView(dbOrder, dbOrder.instrument);
      }
      throw new NotFoundException('Active order not found');
    }

    const [order] = userPending.splice(idx, 1);
    this.pendingOrders.set(userId, userPending);

    // Refund reserved funds if BUY
    if (order.side === 'BUY' && order.notional > 0) {
      await this.prisma.$transaction(async (tx) => {
        await tx.tradingAccount.update({
          where: { id: account.id },
          data: { virtualBalance: { increment: order.notional } },
        });
        await tx.tradingTransaction.create({
          data: {
            accountId: account.id,
            type: 'ACCOUNT_CREDIT',
            amount: order.notional,
            reason: `CANCEL_REFUND ${order.symbol}`,
          },
        });
      });
    }

    return { ...order, status: 'CANCELLED' };
  }

  async listOpenOrders(userId: string): Promise<TradingOrderView[]> {
    await this.getOrCreateAccount(userId);
    return this.pendingOrders.get(userId) ?? [];
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
    const openOrdersCount = (this.pendingOrders.get(userId) ?? []).length;

    return {
      account,
      marketStatus: this.data.getMarketStatus(),
      realizedPnl: realized,
      unrealizedPnl: unrealized,
      equity: account.virtualBalance + unrealized,
      positions: views,
      openOrdersCount,
    };
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
    Array<{ username: string; equity: number; realizedPnl: number; winRate?: number; totalTrades?: number }>
  > {
    const accounts = await this.prisma.tradingAccount.findMany({
      include: {
        user: true,
        positions: true,
      },
      take: 200,
      orderBy: { virtualBalance: 'desc' },
    });
    const instruments = await this.prisma.tradingInstrument.findMany({
      where: { isEnabled: true },
    });
    const byId = new Map(instruments.map((i) => [i.id, i]));
    const rows: Array<{ username: string; equity: number; realizedPnl: number; winRate?: number; totalTrades?: number }> = [];

    for (const acc of accounts) {
      let unrealized = 0;
      let realized = 0;
      let wins = 0;
      const closed = acc.positions.filter((p) => p.status === 'CLOSED');
      for (const pos of acc.positions) {
        if (pos.status === 'OPEN') {
          const instrument = byId.get(pos.instrumentId);
          if (!instrument) continue;
          const quote = this.data.getLatestPrice(instrument);
          unrealized += this.positionPnl(pos.side, pos.avgEntryPrice, quote.price, pos.quantity);
        } else if (pos.status === 'CLOSED') {
          realized += pos.realizedPnl ?? 0;
          if ((pos.realizedPnl ?? 0) > 0) wins++;
        }
      }
      const winRate = closed.length > 0 ? Math.round((wins / closed.length) * 100) : 50;

      rows.push({
        username: acc.user.username,
        equity: acc.virtualBalance + unrealized,
        realizedPnl: realized,
        winRate,
        totalTrades: acc.positions.length,
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
  // Helpers
  // --------------------------------------------------------------------------

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
      change24h: quote.change24h,
      high24h: quote.high24h,
      low24h: quote.low24h,
      volume24h: quote.volume24h,
    };
  }

  private toOrderView(
    order: Record<string, unknown>,
    instrument: { id: string; symbol: string; name: string },
    type: TradingOrderTypeView = 'MARKET',
    priceOrLimit?: number,
    leverage = 1,
  ): TradingOrderView {
    return {
      id: order.id as string,
      instrumentId: instrument.id,
      symbol: instrument.symbol,
      name: instrument.name,
      side: order.side as TradingOrderSideView,
      type,
      status: order.status as TradingOrderView['status'],
      quantity: order.quantity as number,
      priceFilled: (order.priceFilled as number | null) ?? null,
      notional: order.notional as number,
      limitPrice: priceOrLimit,
      failureReason: null,
      createdAt: (order.createdAt as Date).toISOString(),
      leverage,
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
    leverage = 1,
  ): TradingPositionView {
    const liquidationSpread = Math.round(pos.avgEntryPrice * (0.9 / leverage));
    const liquidationPrice =
      pos.side === 'BUY'
        ? Math.max(1, pos.avgEntryPrice - liquidationSpread)
        : pos.avgEntryPrice + liquidationSpread;

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
      leverage,
      liquidationPrice,
    };
  }
}
