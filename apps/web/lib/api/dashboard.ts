import { authFetch } from './client';

export interface DashboardOverview {
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
    totalEstimatedUsd: number; // in cents
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
  trading: {
    openOrdersCount: number;
    activePositionsCount: number;
    virtualBalance: number;
    unrealizedPnl: number;
    totalOrders: number;
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
  activity: {
    id: string;
    kind: 'SPORTS' | 'GAMES' | 'CRASH' | 'DEPOSIT' | 'WITHDRAWAL' | 'WALLET' | 'PROFILE';
    title: string;
    subtitle: string | null;
    amount: number | null;
    currency: string | null;
    status: string;
    createdAt: string;
    refId: string | null;
  }[];
}

export async function getDashboardOverview(): Promise<DashboardOverview> {
  return authFetch<DashboardOverview>('/dashboard/overview');
}
