import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';

export interface DashboardOverviewView {
  profile: {
    id: string;
    uid: string;
    username: string;
    email: string | null;
    avatarUrl: string | null;
    vipLevel: number;
    vipTitle: string;
    vipProgress: number;
    vipPoints: number;
    followingCount: number;
    followersCount: number;
    verificationStatus: string;
    kycStatus: string;
    status: string;
    socialLinked: boolean;
  };
  wallet: {
    totalEstimatedUsd: number;
    totalEstimatedBtc: number;
    availableBalance: number;
    frozenBalance: number;
    currency: string;
    pnlToday: number;
    pnlPercentage: number;
    sparkline: number[];
    assets: {
      symbol: string;
      name: string;
      available: number;
      frozen: number;
      total: number;
      price: number;
      usdValue: number;
      change24h: number;
    }[];
  };
  financial: {
    totalDeposits: number;
    totalWithdrawals: number;
    pendingDepositsCount: number;
    pendingWithdrawalsCount: number;
    recentTransactions: {
      id: string;
      type: string;
      amount: number;
      currency: string;
      status: string;
      reference: string | null;
      createdAt: string;
    }[];
  };
  trading: {
    openOrdersCount: number;
    activePositionsCount: number;
    virtualBalance: number;
    portfolioValue: number;
    unrealizedPnl: number;
    totalOrders: number;
    recentOrders: {
      id: string;
      symbol: string;
      side: string;
      quantity: number;
      priceFilled: number | null;
      status: string;
      createdAt: string;
    }[];
    marketOverview: {
      symbol: string;
      name: string;
      type: string;
      basePrice: number;
    }[];
  };
  notifications: {
    unreadCount: number;
    items: {
      id: string;
      type: string;
      title: string;
      message: string;
      isRead: boolean;
      createdAt: string;
      actionUrl: string | null;
    }[];
  };
  betting: {
    activeBetsCount: number;
    totalBets: number;
    settledBets: number;
    totalWins: number;
    totalLosses: number;
    totalStaked: number;
    totalPayout: number;
  };
  casino: {
    totalGamesPlayed: number;
    totalCrashBets: number;
    recentWinMinor: number;
  };
  rewards: {
    availableRewardsCount: number;
    dailyCheckInAvailable: boolean;
    streakDays: number;
    vipBenefits: string[];
  };
  referral: {
    referralCode: string;
    referralLink: string;
    totalReferred: number;
    qualifiedReferrals: number;
    totalEarningsMinor: number;
  };
  activity: ActivityItemView[];
}

export interface ProfileSummaryView {
  wallet: { availableBalance: number; lockedBalance: number; currency: string } | null;
  totalDeposited: number;
  totalWithdrawn: number;
  pendingWithdrawals: number;
  totalBets: number;
  settledBets: number;
  totalWins: number;
  totalLosses: number;
  totalStaked: number;
  totalPayout: number;
  totalGames: number;
  totalCrashBets: number;
  currency: string;
}

export interface ActivityItemView {
  id: string;
  kind: 'SPORTS' | 'GAMES' | 'CRASH' | 'DEPOSIT' | 'WITHDRAWAL' | 'WALLET' | 'PROFILE';
  title: string;
  subtitle: string | null;
  amount: number | null;
  currency: string | null;
  status: string;
  createdAt: string;
  refId: string | null;
}

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

/** Aggregation reads ONLY caller-owned rows (auth.id from JWT). Pure reads. */
@Injectable()
export class ProfileActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardOverview(auth: AuthenticatedUser): Promise<DashboardOverviewView> {
    const userId = auth.id;

    // Fetch user and all domain data in parallel
    const [
      user,
      identities,
      wallets,
      tradingAccount,
      bets,
      gamesCount,
      crashBetsCount,
      referralsCount,
      referralRewards,
      recentActivityData,
      depositSum,
      withdrawalSum,
      pendingDepositsCount,
      pendingWithdrawalsCount,
      recentTxns,
      unreadNotificationsCount,
      recentNotifications,
      marketInstruments,
    ] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          username: true,
          email: true,
          phone: true,
          kycStatus: true,
          status: true,
          referralCode: true,
          createdAt: true,
        },
      }),
      this.prisma.authIdentity.findMany({
        where: { userId },
        select: { provider: true },
      }),
      this.prisma.wallet.findMany({
        where: { userId },
        select: { currency: true, availableBalance: true, lockedBalance: true },
      }),
      this.prisma.tradingAccount.findFirst({
        where: { userId },
        select: { id: true, virtualBalance: true, currency: true },
      }),
      this.prisma.bet.findMany({
        where: { userId },
        select: { status: true, result: true, stake: true, payout: true, currency: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.gameResult.count({ where: { userId } }),
      this.prisma.crashBet.count({ where: { userId } }),
      this.prisma.referral.count({ where: { referrerUserId: userId } }),
      this.prisma.referralReward.findMany({
        where: { userId },
        select: { amount: true, status: true },
      }),
      this.listActivity(auth, { limit: 8 }),
      this.prisma.walletTransaction.aggregate({
        where: { userId, type: 'DEPOSIT', status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      this.prisma.walletTransaction.aggregate({
        where: { userId, type: 'WITHDRAWAL', status: 'COMPLETED' },
        _sum: { amount: true },
      }),
      this.prisma.manualDepositRequest.count({ where: { userId, status: 'PENDING' } }),
      this.prisma.withdrawalRequest.count({ where: { userId, status: 'PENDING' } }),
      this.prisma.walletTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          type: true,
          amount: true,
          currency: true,
          status: true,
          reference: true,
          createdAt: true,
        },
      }),
      this.prisma.notification.count({ where: { recipientUserId: userId, isRead: false } }),
      this.prisma.notification.findMany({
        where: { recipientUserId: userId },
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: {
          id: true,
          type: true,
          title: true,
          message: true,
          isRead: true,
          actionUrl: true,
          createdAt: true,
        },
      }),
      this.prisma.tradingInstrument.findMany({
        where: { isEnabled: true },
        take: 6,
        select: {
          symbol: true,
          name: true,
          type: true,
          basePrice: true,
        },
      }),
    ]);

    // Query trading positions & orders if trading account exists
    let openPositions: { id: string; avgEntryPrice: number; quantity: number }[] = [];
    let openOrdersCount = 0;
    let totalOrdersCount = 0;
    let recentTradingOrders: {
      id: string;
      symbol: string;
      side: string;
      quantity: number;
      priceFilled: number | null;
      status: string;
      createdAt: string;
    }[] = [];

    if (tradingAccount) {
      const [pos, openOrd, totOrd, recOrd] = await Promise.all([
        this.prisma.tradingPosition.findMany({
          where: { accountId: tradingAccount.id, status: 'OPEN' },
          select: { id: true, avgEntryPrice: true, quantity: true },
        }),
        this.prisma.tradingOrder.count({
          where: { accountId: tradingAccount.id, status: { in: ['NEW', 'SUBMITTING', 'ACKNOWLEDGED'] } },
        }),
        this.prisma.tradingOrder.count({
          where: { accountId: tradingAccount.id },
        }),
        this.prisma.tradingOrder.findMany({
          where: { accountId: tradingAccount.id },
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            side: true,
            status: true,
            quantity: true,
            priceFilled: true,
            createdAt: true,
            instrument: { select: { symbol: true } },
          },
        }),
      ]);
      openPositions = pos;
      openOrdersCount = openOrd;
      totalOrdersCount = totOrd;
      recentTradingOrders = recOrd.map((o) => ({
        id: o.id,
        symbol: o.instrument.symbol,
        side: o.side,
        quantity: o.quantity,
        priceFilled: o.priceFilled,
        status: o.status,
        createdAt: o.createdAt.toISOString(),
      }));
    }

    const uid = user ? user.id.slice(0, 8).toUpperCase() : 'TR-USER';

    // Calculate VIP Level from betting/game volume
    const totalStaked = bets.reduce((acc, b) => acc + b.stake, 0);
    let vipLevel = 1;
    let vipTitle = 'VIP 1 (Bronze)';
    let vipProgress = 20;
    if (totalStaked > 5_000_000) {
      vipLevel = 5;
      vipTitle = 'VIP 5 (Diamond)';
      vipProgress = 100;
    } else if (totalStaked > 2_000_000) {
      vipLevel = 4;
      vipTitle = 'VIP 4 (Platinum)';
      vipProgress = Math.min(99, Math.round((totalStaked / 5_000_000) * 100));
    } else if (totalStaked > 500_000) {
      vipLevel = 3;
      vipTitle = 'VIP 3 (Gold)';
      vipProgress = Math.min(99, Math.round((totalStaked / 2_000_000) * 100));
    } else if (totalStaked > 100_000) {
      vipLevel = 2;
      vipTitle = 'VIP 2 (Silver)';
      vipProgress = Math.min(99, Math.round((totalStaked / 500_000) * 100));
    } else {
      vipProgress = Math.min(99, Math.max(10, Math.round((totalStaked / 100_000) * 100)));
    }

    // Currencies conversion mapping (to USD)
    const rateToUsd: Record<string, number> = {
      USD: 1.0,
      USDT: 1.0,
      EUR: 1.08,
      BDT: 0.00833,
      BTC: 92_000,
      ETH: 3_200,
    };

    let totalUsdCents = 0;
    const assetsList = wallets.map((w) => {
      const rate = rateToUsd[w.currency] || 1.0;
      const totalUnits = (w.availableBalance + w.lockedBalance) / 100;
      const usdVal = totalUnits * rate;
      totalUsdCents += Math.round(usdVal * 100);

      const symbolMap: Record<string, string> = {
        BDT: 'Bangladeshi Taka',
        USD: 'US Dollar',
        EUR: 'Euro',
        BTC: 'Bitcoin',
        ETH: 'Ethereum',
        USDT: 'Tether USD',
      };

      return {
        symbol: w.currency,
        name: symbolMap[w.currency] || w.currency,
        available: w.availableBalance,
        frozen: w.lockedBalance,
        total: w.availableBalance + w.lockedBalance,
        price: rate,
        usdValue: Math.round(usdVal * 100),
        change24h: 1.25,
      };
    });

    const primaryWallet = wallets[0] ?? null;
    const btcRate = rateToUsd['BTC'] || 92_000;
    const totalEstimatedUsd = totalUsdCents;
    const totalEstimatedBtc = totalUsdCents > 0 ? (totalUsdCents / 100) / btcRate : 0;

    // Today's PnL
    const today = startOfDay(new Date());
    const todayBets = bets.filter((b) => b.createdAt >= today && b.status === 'SETTLED');
    const pnlToday = todayBets.reduce((acc, b) => acc + ((b.payout ?? 0) - b.stake), 0);
    const pnlPercentage = totalUsdCents > 0 ? Math.round((pnlToday / totalUsdCents) * 10000) / 100 : 0;

    // Sparkline points (7 days normalized progression)
    const sparkline = [
      Math.max(10, totalUsdCents * 0.92),
      Math.max(10, totalUsdCents * 0.94),
      Math.max(10, totalUsdCents * 0.91),
      Math.max(10, totalUsdCents * 0.96),
      Math.max(10, totalUsdCents * 0.98),
      Math.max(10, totalUsdCents * 0.99),
      Math.max(10, totalUsdCents),
    ].map((val) => Math.round(val));

    const settled = bets.filter((b) => b.status === 'SETTLED');
    const totalRewardsEarned = referralRewards
      .filter((r) => r.status === 'PAID' || r.status === 'QUALIFIED')
      .reduce((acc, r) => acc + r.amount, 0);

    return {
      profile: {
        id: user?.id ?? auth.id,
        uid,
        username: user?.username ?? 'tr-user',
        email: user?.email ?? null,
        avatarUrl: null,
        vipLevel,
        vipTitle,
        vipProgress,
        vipPoints: Math.round(totalStaked / 100),
        followingCount: 0,
        followersCount: 0,
        verificationStatus: user?.kycStatus ?? 'NOT_STARTED',
        kycStatus: user?.kycStatus ?? 'NOT_STARTED',
        status: user?.status ?? 'ACTIVE',
        socialLinked: identities.length > 0,
      },
      wallet: {
        totalEstimatedUsd,
        totalEstimatedBtc,
        availableBalance: primaryWallet?.availableBalance ?? 0,
        frozenBalance: primaryWallet?.lockedBalance ?? 0,
        currency: primaryWallet?.currency ?? 'USD',
        pnlToday,
        pnlPercentage,
        sparkline,
        assets: assetsList,
      },
      financial: {
        totalDeposits: depositSum._sum.amount ?? 0,
        totalWithdrawals: withdrawalSum._sum.amount ?? 0,
        pendingDepositsCount,
        pendingWithdrawalsCount,
        recentTransactions: recentTxns.map((t) => ({
          id: t.id,
          type: t.type,
          amount: t.amount,
          currency: t.currency,
          status: t.status,
          reference: t.reference,
          createdAt: t.createdAt.toISOString(),
        })),
      },
      notifications: {
        unreadCount: unreadNotificationsCount,
        items: recentNotifications.map((n) => ({
          id: n.id,
          type: n.type,
          title: n.title,
          message: n.message,
          isRead: n.isRead,
          actionUrl: n.actionUrl,
          createdAt: n.createdAt.toISOString(),
        })),
      },
      trading: {
        openOrdersCount,
        activePositionsCount: openPositions.length,
        virtualBalance: tradingAccount?.virtualBalance ?? 10_000_000,
        portfolioValue:
          (tradingAccount?.virtualBalance ?? 10_000_000) +
          Math.round(
            openPositions.reduce((acc, p) => acc + p.quantity * p.avgEntryPrice, 0),
          ),
        unrealizedPnl: 0,
        totalOrders: totalOrdersCount,
        recentOrders: recentTradingOrders,
        marketOverview: marketInstruments,
      },
      betting: {
        activeBetsCount: bets.filter((b) => b.status === 'PENDING').length,
        totalBets: bets.length,
        settledBets: settled.length,
        totalWins: settled.filter((b) => b.result === 'WIN').length,
        totalLosses: settled.filter((b) => b.result === 'LOSS').length,
        totalStaked,
        totalPayout: settled.reduce((acc, b) => acc + (b.payout ?? 0), 0),
      },
      casino: {
        totalGamesPlayed: gamesCount,
        totalCrashBets: crashBetsCount,
        recentWinMinor: 0,
      },
      rewards: {
        availableRewardsCount: 1,
        dailyCheckInAvailable: true,
        streakDays: 3,
        vipBenefits: [
          'Priority 24/7 VIP Support',
          'Lower Trading & Exchange Spreads',
          'Weekly Cashback on Sports & Casino',
          'Exclusive Royale VIP Events',
        ],
      },
      referral: {
        referralCode: user?.referralCode ?? '',
        referralLink: user?.referralCode ? `https://tanvionroyale.com/referral/${user.referralCode}` : '',
        totalReferred: referralsCount,
        qualifiedReferrals: referralsCount,
        totalEarningsMinor: totalRewardsEarned,
      },
      activity: recentActivityData.items,
    };
  }

  async getSummary(auth: AuthenticatedUser): Promise<ProfileSummaryView> {
    const userId = auth.id;
    const [wallets, deposits, withdrawals, bets, games, crashBets] = await Promise.all([
      this.prisma.wallet.findMany({ where: { userId } }),
      this.prisma.walletTransaction.findMany({
        where: { userId, type: 'DEPOSIT', status: 'COMPLETED' },
        select: { amount: true, currency: true },
      }),
      this.prisma.walletTransaction.findMany({
        where: { userId, type: 'WITHDRAWAL' },
        select: { amount: true, status: true, currency: true },
      }),
      this.prisma.bet.findMany({
        where: { userId },
        select: { status: true, result: true, stake: true, payout: true, currency: true },
      }),
      this.prisma.gameResult.findMany({ where: { userId }, select: { id: true } }),
      this.prisma.crashBet.findMany({ where: { userId }, select: { id: true } }),
    ]);
    const wallet = wallets[0] ?? null;
    const currency = wallet?.currency ?? deposits[0]?.currency ?? bets[0]?.currency ?? 'BDT';
    const totalDeposited = deposits.reduce((s, t) => s + Math.max(0, t.amount), 0);
    const totalWithdrawn = withdrawals
      .filter((t) => t.status === 'COMPLETED')
      .reduce((s, t) => s + Math.abs(t.amount), 0);
    const settled = bets.filter((b) => b.status === 'SETTLED');
    return {
      wallet: wallet
        ? { availableBalance: wallet.availableBalance, lockedBalance: wallet.lockedBalance, currency: wallet.currency }
        : null,
      totalDeposited,
      totalWithdrawn,
      pendingWithdrawals: withdrawals.filter((t) => t.status === 'PENDING' || t.status === 'PROCESSING').length,
      totalBets: bets.length,
      settledBets: settled.length,
      totalWins: settled.filter((b) => b.result === 'WIN').length,
      totalLosses: settled.filter((b) => b.result === 'LOSS').length,
      totalStaked: bets.reduce((s, b) => s + b.stake, 0),
      totalPayout: settled.reduce((s, b) => s + (b.payout ?? 0), 0),
      totalGames: games.length,
      totalCrashBets: crashBets.length,
      currency,
    };
  }

  async listGames(auth: AuthenticatedUser, options: { limit?: number; page?: number; search?: string } = {}) {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
    const page = Math.max(options.page ?? 1, 1);
    const where: Record<string, unknown> = { userId: auth.id };
    if (options.search?.trim()) where['gameSlug'] = { contains: options.search.trim(), mode: 'insensitive' };
    const rows = await this.prisma.gameResult.findMany({
      where: where as never,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return {
      items: rows.map((r) => ({
        id: r.id,
        gameSlug: r.gameSlug,
        score: r.score,
        outcome: r.outcome,
        message: ((r.meta as unknown as { message?: string } | null) ?? null)?.message ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      page,
      limit,
    };
  }

  async listCrash(auth: AuthenticatedUser, options: { limit?: number; page?: number } = {}) {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 50);
    const page = Math.max(options.page ?? 1, 1);
    const rows = await this.prisma.crashBet.findMany({
      where: { userId: auth.id },
      orderBy: { placedAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: { round: { select: { roundNumber: true, crashMultiplier: true } }, settlement: true },
    });
    return {
      items: rows.map((b) => {
        const r = b as unknown as {
          id: string; stake: number; currency: string; status: string;
          cashoutMultiplier: number | null; payout: number | null;
          placedAt: Date; cashoutAt: Date | null; settledAt: Date | null;
          round: { roundNumber: number; crashMultiplier: number | null };
          settlement: { result: string } | null;
        };
        return {
          id: r.id, roundId: b.roundId, roundNumber: r.round.roundNumber,
          crashMultiplier: r.round.crashMultiplier, stake: r.stake, currency: r.currency,
          status: r.status, cashoutMultiplier: r.cashoutMultiplier, payout: r.payout,
          result: r.settlement?.result ?? null,
          placedAt: r.placedAt.toISOString(),
          cashoutAt: r.cashoutAt?.toISOString() ?? null,
          settledAt: r.settledAt?.toISOString() ?? null,
        };
      }),
      page,
      limit,
    };
  }

  async listActivity(
    auth: AuthenticatedUser,
    query: { type?: string; status?: string; range?: string; limit?: number; page?: number; search?: string },
  ): Promise<{ items: ActivityItemView[]; page: number; limit: number }> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), 50);
    const page = Math.max(query.page ?? 1, 1);
    const type = query.type ?? 'ALL';
    const status = query.status ?? 'ALL';
    const range = query.range ?? 'ALL';
    const search = query.search?.trim().toLowerCase() ?? '';
    const now = new Date();
    let since: Date | null = null;
    let until: Date | null = null;
    if (range === 'TODAY') since = startOfDay(now);
    else if (range === 'YESTERDAY') {
      const s = startOfDay(now);
      s.setDate(s.getDate() - 1);
      since = s;
      until = startOfDay(now);
    } else if (range === 'LAST_7_DAYS') since = new Date(now.getTime() - 7 * 86400_000);
    else if (range === 'LAST_30_DAYS') since = new Date(now.getTime() - 30 * 86400_000);
    const inRange = (d: Date): boolean => {
      if (since && d < since) return false;
      if (until && d >= until) return false;
      return true;
    };
    const want = (k: string): boolean => type === 'ALL' || type === k;
    const items: ActivityItemView[] = [];
    if (want('DEPOSIT') || want('WITHDRAWAL') || want('WALLET')) {
      const txs = await this.prisma.walletTransaction.findMany({
        where: { userId: auth.id }, orderBy: { createdAt: 'desc' }, take: 60,
      });
      for (const t of txs) {
        const kind: ActivityItemView['kind'] =
          t.type === 'DEPOSIT' ? 'DEPOSIT' : t.type === 'WITHDRAWAL' ? 'WITHDRAWAL' : 'WALLET';
        if (!want(kind)) continue;
        if (!inRange(t.createdAt)) continue;
        items.push({
          id: `tx-${t.id}`, kind,
          title: t.type === 'DEPOSIT' ? 'Deposit' : t.type === 'WITHDRAWAL' ? 'Withdrawal' : `Wallet ${t.type.replace(/_/g, ' ')}`,
          subtitle: t.reference ? `Ref ${t.reference}` : null,
          amount: t.amount, currency: t.currency, status: t.status,
          createdAt: t.createdAt.toISOString(), refId: t.id,
        });
      }
    }
    if (want('SPORTS')) {
      const bets = await this.prisma.bet.findMany({
        where: { userId: auth.id }, orderBy: { createdAt: 'desc' }, take: 60, include: { selections: true },
      });
      for (const b of bets) {
        if (!inRange(b.createdAt)) continue;
        const sel = (b as unknown as { selections: { eventName: string; selectionName: string }[] }).selections[0];
        items.push({
          id: `bet-${b.id}`, kind: 'SPORTS',
          title: sel ? `${sel.eventName} - ${sel.selectionName}` : 'Sports bet',
          subtitle: `Stake ${b.stake} / Potential ${b.potentialPayout}`,
          amount: -Math.abs(b.stake), currency: b.currency,
          status: b.status === 'SETTLED' ? (b.result ?? 'SETTLED') : b.status,
          createdAt: b.createdAt.toISOString(), refId: b.id,
        });
      }
    }
    if (want('GAMES')) {
      const games = await this.prisma.gameResult.findMany({
        where: { userId: auth.id }, orderBy: { createdAt: 'desc' }, take: 60,
      });
      for (const g of games) {
        if (!inRange(g.createdAt)) continue;
        items.push({
          id: `game-${g.id}`, kind: 'GAMES', title: g.gameSlug,
          subtitle: `Score ${g.score} / ${g.outcome}`,
          amount: null, currency: null, status: g.outcome,
          createdAt: g.createdAt.toISOString(), refId: g.id,
        });
      }
    }
    if (want('CRASH')) {
      const crash = await this.prisma.crashBet.findMany({
        where: { userId: auth.id }, orderBy: { placedAt: 'desc' }, take: 60,
        include: { round: { select: { roundNumber: true } } },
      });
      for (const b of crash) {
        if (!inRange(b.placedAt)) continue;
        const rn = (b as unknown as { round: { roundNumber: number } }).round.roundNumber;
        items.push({
          id: `crash-${b.id}`, kind: 'CRASH', title: `Royale Fly / Round ${rn}`,
          subtitle: b.cashoutMultiplier != null ? `Cash out ${b.cashoutMultiplier}x` : 'Crash bet',
          amount: b.payout != null && b.payout > 0 ? b.payout : -Math.abs(b.stake),
          currency: b.currency, status: b.status,
          createdAt: b.placedAt.toISOString(), refId: b.id,
        });
      }
    }
    if (want('PROFILE') || type === 'ALL') {
      const logs = await this.prisma.auditLog.findMany({
        where: { actorId: auth.id, action: 'USER_PROFILE_UPDATED' },
        orderBy: { createdAt: 'desc' }, take: 20,
      });
      for (const l of logs) {
        if (!inRange(l.createdAt)) continue;
        items.push({
          id: `profile-${l.id}`, kind: 'PROFILE', title: 'Profile updated',
          subtitle: null, amount: null, currency: null, status: 'COMPLETED',
          createdAt: l.createdAt.toISOString(), refId: null,
        });
      }
    }
    const norm = (s: string): string => {
      const u = s.toUpperCase();
      if (u === 'WIN' || u === 'WON' || u === 'CASHED_OUT') return 'WON';
      if (u === 'LOSS' || u === 'LOST') return 'LOST';
      return u;
    };
    let filtered = items.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
    if (status !== 'ALL') filtered = filtered.filter((i) => norm(i.status) === norm(status));
    if (search) {
      filtered = filtered.filter(
        (i) =>
          i.title.toLowerCase().includes(search) ||
          (i.subtitle ?? '').toLowerCase().includes(search) ||
          (i.refId ?? '').toLowerCase().includes(search),
      );
    }
    const start = (page - 1) * limit;
    return { items: filtered.slice(start, start + limit), page, limit };
  }
}
