import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { AuthenticatedUser } from '../../common/types/authenticated-user';

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
          id: `crash-${b.id}`, kind: 'CRASH', title: `Sky Rocket / Round ${rn}`,
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
