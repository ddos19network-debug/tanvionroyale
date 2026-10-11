/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { TradingService, TradingErrors } from '../src/modules/trading/trading.service';
import type { MarketDataProvider, MarketPrice } from '../src/modules/trading/market-data.provider';

const ENV = process.env;

afterEach(() => {
  process.env = ENV;
});

function quote(price: number): MarketPrice {
  return {
    price,
    dataSource: 'DEMO',
    asOf: new Date('2026-01-01T00:00:00Z').toISOString(),
    label: 'DEMO data — synthetic prices, not a live feed',
  };
}

/** Fixed-price fake market data so P&L assertions are exact. */
function fixedProvider(priceBySymbol: Record<string, number>): MarketDataProvider {
  return {
    name: 'test-fixed',
    getLatestPrice: (inst: { symbol: string }) => quote(priceBySymbol[inst.symbol] ?? 0),
    getHistoricalPrices: (inst: { symbol: string }, points: number) =>
      Array.from({ length: points }, (_, i) => ({
        t: new Date(i * 60_000).toISOString(),
        price: priceBySymbol[inst.symbol] ?? 0,
      })),
    getMarketStatus: () => ({
      open: true,
      label: 'DEMO data',
      dataSource: 'DEMO' as const,
    }),
  };
}

/** In-memory fake of the paper-trading Prisma surface (incl. $transaction cb). */
function makeTradingFake() {
  const state = {
    accounts: [] as any[],
    instruments: [] as any[],
    orders: [] as any[],
    positions: [] as any[],
    transactions: [] as any[],
  };
  let seq = 0;
  const id = () => `id-${++seq}`;
  // Monotonic timestamps so "newest-first" sorting is never a same-ms tie.
  const rowNow = () => new Date(Date.now() + ++seq);

  const fake: any = {
    tradingAccount: {
      findUnique: jest.fn(async ({ where }: any) =>
        state.accounts.find((a) => a.userId === where.userId || a.id === where.id) ?? null,
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { createdAt: new Date(), updatedAt: new Date(), ...data, id: id() };
        state.accounts.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = state.accounts.find((a) => a.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    tradingInstrument: {
      findUnique: jest.fn(async ({ where }: any) =>
        state.instruments.find((i) => i.id === where.id || i.symbol === where.symbol) ?? null,
      ),
      findMany: jest.fn(async ({ where }: any) => {
        const enabled = where?.isEnabled;
        return state.instruments.filter((i) => enabled === undefined || i.isEnabled === enabled);
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = state.instruments.find((i) => i.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    tradingOrder: {
      create: jest.fn(async ({ data }: any) => {
        const row = { createdAt: rowNow(), updatedAt: rowNow(), ...data, id: id() };
        state.orders.push(row);
        return row;
      }),
      findMany: jest.fn(async ({ where }: any) => {
        const rows = state.orders.filter((o) => o.accountId === where.accountId);
        return rows
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .map((o) => ({
            ...o,
            instrument: state.instruments.find((i) => i.id === o.instrumentId),
          }));
      }),
    },
    tradingPosition: {
      findUnique: jest.fn(async ({ where }: any) =>
        state.positions.find((p) => p.id === where.id) ?? null,
      ),
      findFirst: jest.fn(async ({ where }: any) =>
        state.positions.find(
          (p) =>
            p.accountId === where.accountId &&
            p.instrumentId === where.instrumentId &&
            p.status === where.status,
        ) ?? null,
      ),
      findMany: jest.fn(async ({ where }: any) =>
        state.positions.filter(
          (p) => p.accountId === where.accountId && p.status === where.status,
        ),
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = {
          status: 'OPEN',
          realizedPnl: 0,
          closedAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
          id: id(),
        };
        state.positions.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = state.positions.find((p) => p.id === where.id)!;
        Object.assign(row, data);
        return row;
      }),
    },
    tradingTransaction: {
      create: jest.fn(async ({ data }: any) => {
        const row = { createdAt: rowNow(), ...data, id: id() };
        state.transactions.push(row);
        return row;
      }),
      findMany: jest.fn(async ({ where }: any) =>
        state.transactions
          .filter((t) => t.accountId === where.accountId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
      ),
    },
    user: { findUnique: jest.fn(async () => null) },
    $transaction: jest.fn(async (cb: any) => cb(fake)),
  };
  return { fake, state };
}

function makeService(priceBySymbol: Record<string, number>) {
  const { fake, state } = makeTradingFake();
  const svc = new TradingService(fake, fixedProvider(priceBySymbol));
  return { svc, state };
}

function seedInstrument(state: any, overrides: Record<string, unknown> = {}) {
  const inst = {
    id: 'inst-aapl',
    symbol: 'AAPL',
    name: 'Apple Inc.',
    type: 'STOCK',
    basePrice: 15000,
    isEnabled: true,
    dataSource: 'DEMO',
    sortOrder: 1,
    ...overrides,
  };
  state.instruments.push(inst);
  return inst;
}

function seedAccount(state: any, balance = 10_000_00, userId = 'u1') {
  const acc = {
    id: 'acc-1',
    userId,
    currency: 'USD',
    virtualBalance: balance,
    createdAt: new Date(),
  };
  state.accounts.push(acc);
  return acc;
}

describe('Paper trading engine (server-authoritative, virtual only)', () => {
  it('creates an account with the virtual starting balance and a credit transaction', async () => {
    process.env = { ...ENV, TRADING_STARTING_BALANCE: '250000' };
    const { svc, state } = makeService({ AAPL: 15000 });

    const account = await svc.getOrCreateAccount('u1');

    expect(account.virtualBalance).toBe(250_000);
    expect(state.transactions).toHaveLength(1);
    expect(state.transactions[0].type).toBe('ACCOUNT_CREDIT');
    expect(state.transactions[0].amount).toBe(250_000);
  });

  it('BUY fills at the provider price, debits integer cost, opens a position', async () => {
    const { svc, state } = makeService({ AAPL: 15000 });
    seedInstrument(state);
    seedAccount(state, 10_000_00);

    const result = await svc.placeOrder('u1', 'inst-aapl', 'BUY', 10);

    expect(result.order.status).toBe('FILLED');
    expect(result.order.priceFilled).toBe(15000);
    expect(result.order.notional).toBe(150_000);
    expect(result.account.virtualBalance).toBe(10_000_00 - 150_000);
    expect(result.openedPosition?.status).toBe('OPEN');
    expect(result.openedPosition?.unrealizedPnl).toBe(0);
    expect(state.transactions[0].amount).toBe(-150_000);
  });

  it('rejects a BUY when the virtual balance is insufficient (never negative)', async () => {
    const { svc, state } = makeService({ AAPL: 15000 });
    seedInstrument(state);
    seedAccount(state, 100_000);

    await expect(svc.placeOrder('u1', 'inst-aapl', 'BUY', 10)).rejects.toThrow(
      'Insufficient virtual balance',
    );
    expect(state.orders).toHaveLength(0);
    expect(state.positions).toHaveLength(0);
  });

  it('rejects a second same-side order while a position is open', async () => {
    const { svc, state } = makeService({ AAPL: 15000 });
    seedInstrument(state);
    seedAccount(state);

    await svc.placeOrder('u1', 'inst-aapl', 'BUY', 5);
    await expect(svc.placeOrder('u1', 'inst-aapl', 'BUY', 5)).rejects.toThrow(ConflictException);
    expect(TradingErrors.positionExists()).toBeInstanceOf(ConflictException);
  });

  it('an opposite-side order with a mismatched quantity is rejected', async () => {
    const { svc, state } = makeService({ AAPL: 15000 });
    seedInstrument(state);
    seedAccount(state);

    await svc.placeOrder('u1', 'inst-aapl', 'BUY', 5);
    await expect(svc.placeOrder('u1', 'inst-aapl', 'SELL', 3)).rejects.toThrow(
      'Close quantity must equal the open position quantity (5).',
    );
  });

  it('a disabled instrument cannot be traded', async () => {
    const { svc, state } = makeService({ AAPL: 15000 });
    seedInstrument(state, { isEnabled: false });
    seedAccount(state);

    await expect(svc.placeOrder('u1', 'inst-aapl', 'BUY', 1)).rejects.toThrow(NotFoundException);
  });

  it('invalid quantities and sides are rejected before any state changes', async () => {
    const { svc, state } = makeService({ AAPL: 15000 });
    seedInstrument(state);
    seedAccount(state);

    await expect(svc.placeOrder('u1', 'inst-aapl', 'BUY', 0)).rejects.toThrow(BadRequestException);
    await expect(svc.placeOrder('u1', 'inst-aapl', 'BUY', 2.5)).rejects.toThrow(BadRequestException);
    await expect(svc.placeOrder('u1', 'inst-aapl', 'HOLD' as any, 1)).rejects.toThrow(
      BadRequestException,
    );
    expect(state.orders).toHaveLength(0);
  });

  it('closing another user’s position is a NotFound (ownership enforced)', async () => {
    const { svc, state } = makeService({ AAPL: 15000 });
    seedInstrument(state);
    seedAccount(state, 10_000_00, 'u1');
    seedAccount(state, 10_000_00, 'u2');
    state.positions.push({
      id: 'pos-x',
      accountId: 'acc-1',
      instrumentId: 'inst-aapl',
      side: 'BUY',
      quantity: 1,
      avgEntryPrice: 15000,
      status: 'OPEN',
      realizedPnl: 0,
      closedAt: null,
      createdAt: new Date(),
    });

    // acc-1 belongs to u1 — closing with u2 must fail.
    await expect(svc.closePosition('u2', 'pos-x')).rejects.toThrow(NotFoundException);
  });
});

describe('Paper trading round-trips (integer P&L)', () => {
  it('SELL (short) credits proceeds and realizes (entry - exit) * qty on cover', async () => {
    const { svc, state } = makeService({ AAPL: 15000 });
    seedInstrument(state);
    seedAccount(state, 10_000_00);

    const open = await svc.placeOrder('u1', 'inst-aapl', 'SELL', 10);
    expect(open.account.virtualBalance).toBe(10_000_00 + 150_000);
    expect(open.openedPosition?.side).toBe('SELL');

    // Cover the short at 145.00 with a fixed-price provider.
    const svc2 = new TradingService((svc as any).prisma, fixedProvider({ AAPL: 14500 }));
    const close = await svc2.closePosition('u1', open.openedPosition!.id);

    expect(close.closedPosition?.status).toBe('CLOSED');
    expect(close.closedPosition?.realizedPnl).toBe((15_000 - 14_500) * 10);
    // Net cash effect equals the realized P&L exactly.
    expect(close.account.virtualBalance - 10_000_00).toBe(close.closedPosition!.realizedPnl);
  });

  it('closing a LONG position realizes (exit - entry) * qty', async () => {
    const { svc, state } = makeService({ AAPL: 15000 });
    seedInstrument(state);
    seedAccount(state, 10_000_00);

    const open = await svc.placeOrder('u1', 'inst-aapl', 'BUY', 4);
    const svc2 = new TradingService((svc as any).prisma, fixedProvider({ AAPL: 15123 }));
    const close = await svc2.closePosition('u1', open.openedPosition!.id);

    expect(close.closedPosition?.realizedPnl).toBe((15_123 - 15_000) * 4);
    expect(close.account.virtualBalance).toBe(10_000_00 - 60_000 + 60_492);
  });

  it('portfolio equity = virtual balance + unrealized P&L (integer math)', async () => {
    const { svc, state } = makeService({ AAPL: 15000 });
    seedInstrument(state);
    seedAccount(state, 10_000_00);

    await svc.placeOrder('u1', 'inst-aapl', 'BUY', 10);
    const svc2 = new TradingService((svc as any).prisma, fixedProvider({ AAPL: 15042 }));
    const portfolio = await svc2.listPortfolio('u1');

    expect(portfolio.unrealizedPnl).toBe((15_042 - 15_000) * 10);
    expect(portfolio.equity).toBe(10_000_00 - 150_000 + 420);
    expect(portfolio.positions[0].currentPrice).toBe(15_042);
  });

  it('order and transaction history are returned newest-first', async () => {
    const { svc, state } = makeService({ AAPL: 15000 });
    seedInstrument(state);
    seedAccount(state);

    await svc.placeOrder('u1', 'inst-aapl', 'BUY', 1);
    await svc.placeOrder('u1', 'inst-aapl', 'SELL', 1); // closes the long
    const orders = await svc.listOrders('u1');
    const txs = await svc.listTransactions('u1');

    expect(orders).toHaveLength(2);
    expect(orders[0].side).toBe('SELL');
    expect(txs.length).toBeGreaterThanOrEqual(2);
  });

  it('the demo feed is deterministic within its minute bucket and clearly DEMO', async () => {
    const { DemoTradingMarketDataProvider } = await import(
      '../src/modules/trading/market-data.provider'
    );
    const provider = new DemoTradingMarketDataProvider();
    const inst = { id: 'x', symbol: 'AAPL', basePrice: 15000 };

    const a = provider.getLatestPrice(inst);
    const b = provider.getLatestPrice(inst);
    expect(a.dataSource).toBe('DEMO');
    expect(a.label).toContain('DEMO');
    expect(a.price).toBe(b.price);
    expect(Math.abs(a.price - 15000)).toBeLessThanOrEqual(15000 * 0.032 + 1);
    expect(provider.getHistoricalPrices(inst, 30)).toHaveLength(30);
  });
});