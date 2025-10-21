import { Logger } from '../../services/logger';
import { storage } from '../../storage';
import { User } from '../../types';
import { DateUtils } from '../utils/date.utils';
import { MemoryManager } from '../../services/memory-manager.service';
import { PointsService } from './points.service';

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  name: string;
  points: number;
  referralCount?: number;
  accountAge?: number;
  lastActivity?: Date;
  isActive?: boolean;
}

export enum LeaderboardType {
  POINTS = 'points',
  REFERRALS = 'referrals',
  WEEKLY_POINTS = 'weekly_points',
  MONTHLY_POINTS = 'monthly_points',
  NEW_USERS = 'new_users'
}

export interface PointsLeaderboardDetailedEntry {
  rank: number;
  userId: string;
  firstName: string;
  totalEarned: number;
  currentBalance: number;
  totalSpent: number;
  walletAddress?: string;
}

export interface ReferralLeaderboardDetailedEntry {
  rank: number;
  userId: string;
  firstName: string;
  totalReferrals: number;
  activeReferrals: number;
  walletAddress?: string;
}

export class LeaderboardService {
  private static readonly logger = Logger.getInstance();

  static async generatePointsLeaderboard(limit: number = 10): Promise<LeaderboardEntry[]> {
    try {
      const cache = MemoryManager.getInstance().getOrCreateCache<string, LeaderboardEntry[]>(
        'leaderboard:points',
        'Top points leaderboard cache',
        { max: 50, ttl: 30_000 }
      );
      const cacheKey = `points:${limit}`;
      const cached = cache.get(cacheKey);
      if (cached) return cached;

      const users = await storage.findByQuery<User>('users', { points: { $gt: 0 } }, {
        sort: { points: -1 },
        limit,
        projection: { telegramId: 1, firstName: 1, lastName: 1, username: 1, points: 1, lastActivity: 1, isActive: 1 }
      });

      const entries = users.map((user, index) => ({
        rank: index + 1,
        userId: user.telegramId,
        name: this.formatUserName(user),
        points: user.points || 0,
        accountAge: DateUtils.getUserAccountAge(user),
        lastActivity: (user as any).lastActivity ? DateUtils.parseUserDate((user as any).lastActivity) : undefined,
        isActive: (user as any).isActive
      }));

      cache.set(cacheKey, entries);
      return entries;
    } catch (error) {
      this.logger.error('Error generating points leaderboard:', error);
      return [];
    }
  }

  static async generateReferralLeaderboard(limit: number = 10): Promise<LeaderboardEntry[]> {
    try {
      const cache = MemoryManager.getInstance().getOrCreateCache<string, LeaderboardEntry[]>(
        'leaderboard:referrals',
        'Top referral leaderboard cache',
        { max: 50, ttl: 30_000 }
      );
      const cacheKey = `referrals:${limit}`;
      const cached = cache.get(cacheKey);
      if (cached) return cached;

      const users = await storage.findByQuery<User>('users', { referralCount: { $gt: 0 } }, {
        sort: { referralCount: -1 },
        limit,
        projection: { telegramId: 1, firstName: 1, lastName: 1, username: 1, points: 1, referralCount: 1, lastActivity: 1, isActive: 1 }
      });

      const entries = users.map((user, index) => ({
        rank: index + 1,
        userId: user.telegramId,
        name: this.formatUserName(user),
        points: user.points || 0,
        referralCount: (user as any).referralCount || 0,
        accountAge: DateUtils.getUserAccountAge(user),
        lastActivity: (user as any).lastActivity ? DateUtils.parseUserDate((user as any).lastActivity) : undefined,
        isActive: (user as any).isActive
      }));

      cache.set(cacheKey, entries);
      return entries;
    } catch (error) {
      this.logger.error('Error generating referral leaderboard:', error);
      return [];
    }
  }

  static async generatePointsLeaderboardDetailed(limit: number = 10): Promise<PointsLeaderboardDetailedEntry[]> {
    try {
      const cache = MemoryManager.getInstance().getOrCreateCache<string, PointsLeaderboardDetailedEntry[]>(
        'leaderboard:points:detailed',
        'Points leaderboard detailed cache',
        { max: 50, ttl: 60 * 60 * 1000 }
      );
      const cacheKey = `points:detailed:${limit}`;
      const cached = cache.get(cacheKey);
      if (cached) return cached;

      // Prefer users sorted by totalEarned if available; fallback to points
      let candidates: User[] = [];
      try {
        candidates = await storage.findByQuery<User>('users', { totalEarned: { $gt: 0 } as any }, {
          sort: { totalEarned: -1 } as any,
          limit: Math.max(30, limit * 3),
          projection: { telegramId: 1, firstName: 1, totalEarned: 1, points: 1, walletAddress: 1 }
        });
      } catch {}

      if (!candidates || candidates.length === 0) {
        candidates = await storage.findByQuery<User>('users', { points: { $gt: 0 } }, {
          sort: { points: -1 },
          limit: Math.max(50, limit * 5),
          projection: { telegramId: 1, firstName: 1, points: 1, walletAddress: 1 }
        });
      }

      const enriched = await Promise.all(candidates.map(async (user) => {
        const stats = await PointsService.getUserPointStats(user.telegramId);
        return {
          userId: user.telegramId,
          firstName: user.firstName || `User ${user.telegramId}`,
          totalEarned: stats.totalEarned || 0,
          currentBalance: stats.currentBalance || 0,
          totalSpent: stats.totalSpent || 0,
          walletAddress: (user as any).walletAddress || undefined
        } as Omit<PointsLeaderboardDetailedEntry, 'rank'>;
      }));

      const sorted = enriched.sort((a, b) => (b.totalEarned || 0) - (a.totalEarned || 0)).slice(0, limit);
      const entries = sorted.map((e, idx) => ({ rank: idx + 1, ...e }));

      cache.set(cacheKey, entries);
      return entries;
    } catch (error) {
      this.logger.error('Error generating detailed points leaderboard:', error);
      return [];
    }
  }

  static async generateReferralLeaderboardDetailed(limit: number = 10): Promise<ReferralLeaderboardDetailedEntry[]> {
    try {
      const cache = MemoryManager.getInstance().getOrCreateCache<string, ReferralLeaderboardDetailedEntry[]>(
        'leaderboard:referrals:detailed',
        'Referral leaderboard detailed cache',
        { max: 50, ttl: 60 * 60 * 1000 }
      );
      const cacheKey = `referrals:detailed:${limit}`;
      const cached = cache.get(cacheKey);
      if (cached) return cached;

      const primary = await storage.findByQuery<User>('users', { totalReferrals: { $gt: 0 } as any }, {
        sort: { totalReferrals: -1 } as any,
        limit,
        projection: { telegramId: 1, firstName: 1, totalReferrals: 1, walletAddress: 1 }
      }).catch(() => [] as any[]);

      let users: any[] = primary as any[];
      if (users.length < limit) {
        const fallback = await storage.findByQuery<User>('users', { referralCount: { $gt: 0 } as any }, {
          sort: { referralCount: -1 } as any,
          limit,
          projection: { telegramId: 1, firstName: 1, referralCount: 1, walletAddress: 1 }
        }).catch(() => [] as any[]);
        const seen = new Set(users.map(u => (u as any).telegramId));
        for (const u of fallback) {
          if (!seen.has((u as any).telegramId)) users.push(u);
          if (users.length >= limit) break;
        }
      }

      users = users.slice(0, limit);

      const windowDays = 3;
      const cutoffIso = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

      const detailed = await Promise.all(users.map(async (user: any, index: number) => {
        const totalReferrals = (user as any).totalReferrals ?? (user as any).referralCount ?? 0;
        const activeReferrals = await storage.countDocuments('users', {
          referredBy: user.telegramId,
          $or: [
            { lastActiveAt: { $gte: cutoffIso } },
            { lastActivity: { $gte: cutoffIso } },
            { lastActive: { $gte: cutoffIso } }
          ]
        });
        return {
          rank: index + 1,
          userId: user.telegramId,
          firstName: user.firstName || `User ${user.telegramId}`,
          totalReferrals,
          activeReferrals,
          walletAddress: (user as any).walletAddress || undefined
        } as ReferralLeaderboardDetailedEntry;
      }));

      detailed.sort((a, b) => b.totalReferrals - a.totalReferrals);
      const entries = detailed.slice(0, limit).map((e, idx) => ({ ...e, rank: idx + 1 }));

      cache.set(cacheKey, entries);
      return entries;
    } catch (error) {
      this.logger.error('Error generating detailed referral leaderboard:', error);
      return [];
    }
  }

  static async getUserPointsRank(userId: string): Promise<number> {
    try {
      // Build top-100 by Total Earned (cached) and find exact rank within 1..100
      const top = await this.generatePointsLeaderboardDetailed(100);
      const idx = top.findIndex(e => e.userId === userId);
      if (idx >= 0) return idx + 1;

      // If not in top-100, return 101 (represents 100+)
      return 101;
    } catch (error) {
      this.logger.error('Error getting user points rank:', error);
      return 101;
    }
  }

  static async getUserReferralRank(userId: string): Promise<number> {
    try {
      const user = await storage.get<User>('users', userId) || await storage.findByQuery<User>('users', { telegramId: userId }, { limit: 1 }).then(r => r[0]);
      if (!user) return 0;
      const total = (user as any).totalReferrals ?? (user as any).referralCount ?? 0;
      const higherCount = await storage.countDocuments('users', { $or: [ { totalReferrals: { $gt: total } as any }, { referralCount: { $gt: total } as any } ] });
      return higherCount + 1;
    } catch (error) {
      this.logger.error('Error getting user referral rank:', error);
      return 0;
    }
  }

  static async generateCombinedLeaderboard(limit: number = 10): Promise<{ points: LeaderboardEntry[]; referrals: LeaderboardEntry[]; newUsers: LeaderboardEntry[]; }> {
    try {
      const [pointsLeaderboard, referralLeaderboard] = await Promise.all([
        this.generatePointsLeaderboard(limit),
        this.generateReferralLeaderboard(limit)
      ]);

      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const users = await storage.findByQuery<User>('users', { isActive: true, registeredAt: { $gte: thirtyDaysAgo } }, {
        sort: { points: -1 },
        limit,
        projection: { telegramId: 1, firstName: 1, lastName: 1, username: 1, points: 1, lastActivity: 1, isActive: 1, registeredAt: 1 }
      });
      const newUsers = users.map((user, index) => ({
        rank: index + 1,
        userId: user.telegramId,
        name: this.formatUserName(user),
        points: user.points || 0,
        accountAge: DateUtils.getUserAccountAge(user),
        lastActivity: (user as any).lastActivity ? DateUtils.parseUserDate((user as any).lastActivity) : undefined,
        isActive: (user as any).isActive
      }));

      return { points: pointsLeaderboard, referrals: referralLeaderboard, newUsers };
    } catch (error) {
      this.logger.error('Error generating combined leaderboard:', error);
      return { points: [], referrals: [], newUsers: [] };
    }
  }

  static async getLeaderboardStats(): Promise<{ totalActiveUsers: number; totalUsersWithPoints: number; totalUsersWithReferrals: number; averagePoints: number; averageReferrals: number; topPointsScore: number; topReferralCount: number; }> {
    try {
      const totalActiveUsers = await storage.countDocuments('users', { isActive: true });
      const totalUsersWithPoints = await storage.countDocuments('users', { isActive: true, points: { $gt: 0 } });
      const totalUsersWithReferrals = await storage.countDocuments('users', { isActive: true, $or: [ { totalReferrals: { $gt: 0 } as any }, { referralCount: { $gt: 0 } as any } ] });

      const topPoints = await storage.findByQuery<User>('users', { isActive: true }, { sort: { points: -1 }, limit: 1, projection: { points: 1 } });
      const topRefByTotal = await storage.findByQuery<User>('users', { isActive: true }, { sort: { totalReferrals: -1 } as any, limit: 1, projection: { totalReferrals: 1 } as any }).catch(() => [] as any[]);
      const topRefByCount = await storage.findByQuery<User>('users', { isActive: true }, { sort: { referralCount: -1 } as any, limit: 1, projection: { referralCount: 1 } as any }).catch(() => [] as any[]);
      const topReferralCount = Math.max(
        (topRefByTotal[0] && (topRefByTotal[0] as any).totalReferrals) || 0,
        (topRefByCount[0] && (topRefByCount[0] as any).referralCount) || 0
      );

      const samplePoints = await storage.findByQuery<User>('users', { isActive: true, points: { $gt: 0 } }, { limit: 1000, projection: { points: 1 } });
      const totalPoints = samplePoints.reduce((s, u) => s + (u.points || 0), 0);
      const avgPoints = samplePoints.length > 0 ? Math.round(totalPoints / samplePoints.length) : 0;

      const sampleRefsTotal = await storage.findByQuery<User>('users', { isActive: true, totalReferrals: { $gt: 0 } as any }, { limit: 1000, projection: { totalReferrals: 1 } as any }).catch(() => [] as any[]);
      const sampleRefsCount = await storage.findByQuery<User>('users', { isActive: true, referralCount: { $gt: 0 } as any }, { limit: 1000, projection: { referralCount: 1 } as any }).catch(() => [] as any[]);
      const totalRefsFromTotal = (sampleRefsTotal as any[]).reduce<number>((s, u: any) => s + (u.totalReferrals || 0), 0);
      const totalRefsFromCount = (sampleRefsCount as any[]).reduce<number>((s, u: any) => s + (u.referralCount || 0), 0);
      const totalRefs = totalRefsFromTotal + totalRefsFromCount;
      const sampleRefUsers = sampleRefsTotal.length + sampleRefsCount.length;
      const avgRefs = sampleRefUsers > 0 ? Math.round(totalRefs / sampleRefUsers) : 0;

      return {
        totalActiveUsers,
        totalUsersWithPoints,
        totalUsersWithReferrals,
        averagePoints: avgPoints,
        averageReferrals: avgRefs,
        topPointsScore: (topPoints[0] && (topPoints[0].points || 0)) || 0,
        topReferralCount
      };
    } catch (error) {
      this.logger.error('Error getting leaderboard stats:', error);
      return {
        totalActiveUsers: 0,
        totalUsersWithPoints: 0,
        totalUsersWithReferrals: 0,
        averagePoints: 0,
        averageReferrals: 0,
        topPointsScore: 0,
        topReferralCount: 0
      };
    }
  }

  static getRankMedal(rank: number): string {
    switch (rank) {
      case 1: return '🥇';
      case 2: return '🥈';
      case 3: return '🥉';
      default: return '🏅';
    }
  }

  static getRankNumberEmoji(rank: number): string {
    switch (rank) {
      case 1: return '1⃣';
      case 2: return '2⃣';
      case 3: return '3⃣';
      case 4: return '4⃣';
      case 5: return '5⃣';
      case 6: return '6⃣';
      case 7: return '7⃣';
      case 8: return '8⃣';
      case 9: return '9⃣';
      case 10: return '🔟';
      default: return `${rank}.`;
    }
  }

  static formatLeaderboardText(
    entries: LeaderboardEntry[],
    title: string,
    emptyMessage = 'No entries found'
  ): string {
    if (entries.length === 0) {
      return `<b>${title}</b>\n\n${emptyMessage}`;
    }

    let text = `<b>${title}</b>\n\n`;

    entries.forEach((entry) => {
      const medal = this.getRankMedal(entry.rank);
      const name = entry.name.length > 20 ? entry.name.substring(0, 17) + '...' : entry.name;

      if (entry.referralCount !== undefined) {
        text += `${medal} <b>${entry.rank}.</b> ${name}\n`;
        text += `   💎 ${entry.points} points • 👥 ${entry.referralCount} referrals\n\n`;
      } else {
        text += `${medal} <b>${entry.rank}.</b> ${name}\n`;
        text += `   💎 ${entry.points} points\n\n`;
      }
    });

    return text.trim();
  }

  static formatPointsLeaderboardDetailed(entries: PointsLeaderboardDetailedEntry[], title: string): string {
    if (!entries.length) return `<b>${title}</b>\n\nNo entries found`;

    // Helpers for ASCII-aligned monospace block
    const escapeHtml = (s: string) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const fmtPts = (n: number, width = 4) => {
      const s = String(n);
      return ' '.repeat(Math.max(0, width - s.length)) + s;
    };
    const maskWallet = (addr?: string, keepStart = 6, keepEnd = 4): string => {
      if (!addr) return 'null';
      const s = addr.trim();
      if (!s) return 'null';
      if (s.length <= keepStart + keepEnd + 2) return s;
      return `${s.slice(0, keepStart)}**${s.slice(-keepEnd)}`;
    };
    const pad = (s: string, width: number) => {
      const trimmed = s.length > width ? s.slice(0, width - 1) + '…' : s;
      return trimmed + ' '.repeat(Math.max(0, width - trimmed.length));
    };

    const PTS_W = 4;     // up to 9999
    const WALLET_W = 14; // tune as needed

    const lines = entries.slice(0, 10).map((e) => {
      const pts = fmtPts(e.totalEarned || 0, PTS_W);
      const walletMasked = maskWallet(e.walletAddress);
      const col = pad(walletMasked, WALLET_W);
      return `${pts} | ${col}`;
    }).join('\n');

    const text = `
<b>${title}</b>
<code>Points • Wallet</code>

<pre>${lines}</pre>
`.trim();

    return text;
  }

  static formatReferralLeaderboardDetailed(entries: ReferralLeaderboardDetailedEntry[], title: string): string {
    if (!entries.length) return `<b>${title}</b>\n\nNo entries found`;

    // ASCII monospace layout: Referrals first, then masked wallet
    const fmtNum = (n: number, width = 4) => {
      const s = String(n);
      return ' '.repeat(Math.max(0, width - s.length)) + s;
    };
    const maskWallet = (addr?: string, keepStart = 6, keepEnd = 4): string => {
      if (!addr) return 'null';
      const s = addr.trim();
      if (!s) return 'null';
      if (s.length <= keepStart + keepEnd + 2) return s;
      return `${s.slice(0, keepStart)}**${s.slice(-keepEnd)}`;
    };
    const pad = (s: string, width: number) => {
      const trimmed = s.length > width ? s.slice(0, width - 1) + '…' : s;
      return trimmed + ' '.repeat(Math.max(0, width - trimmed.length));
    };

    const REF_W = 4;      // referrals count width
    const WALLET_W = 14;  // wallet display width

    const lines = entries.slice(0, 10).map(e => {
      const total = fmtNum(e.totalReferrals || 0, REF_W);
      const masked = maskWallet(e.walletAddress);
      const col = pad(masked, WALLET_W);
      return `${total} | ${col}`;
    }).join('\n');

    const text = `
<b>${title}</b>
<code>Referrals • Wallet</code>

<pre>${lines}</pre>
`.trim();

    return text;
  }

  private static formatUserName(user: User): string {
    if (user.firstName && user.lastName) {
      return `${user.firstName} ${user.lastName}`;
    } else if (user.firstName) {
      return user.firstName;
    } else if (user.username) {
      return `@${user.username}`;
    } else {
      return `User ${user.telegramId}`;
    }
  }
}
