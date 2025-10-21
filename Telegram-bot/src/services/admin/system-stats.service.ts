import { ethers } from 'ethers';
import { Context } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { ISystemStatsService } from '../../interfaces/admin-services.interface';
import { storage } from '../../storage';
import { Logger } from '../logger';
import { config } from '../../config';

export class SystemStatsService implements ISystemStatsService {
  private readonly logger = Logger.getInstance();

  async getSystemStats(): Promise<any> {
    try {
      const [users, tasks, healthData, submissions, systemConfig] = await Promise.all([
        storage.getAllUsers(),
        storage.getAllTasks(),
        storage.healthCheck(),
        storage.getAllTaskSubmissions().catch(() => []),
        storage.get<any>('system_config', 'global').catch(() => null)
      ]);

      // Calculate persistent uptime from bot start time
      let uptimeSeconds = process.uptime();
      if (systemConfig?.botStartTime) {
        try {
          const startTime = new Date(systemConfig.botStartTime).getTime();
          const currentTime = Date.now();
          uptimeSeconds = (currentTime - startTime) / 1000;
        } catch (e) {
          this.logger.warn('Failed to calculate persistent uptime, using process uptime');
        }
      }

      // Calculate verified users (users marked verified, connected a wallet, or verified via miniapp)
      const verifiedUsers = users.filter((u: any) => {
        const walletConnected = typeof u.walletAddress === 'string' && u.walletAddress.trim() !== '';
        const miniappVerified = u.miniappVerified === true || u.miniappStatus === 'verified';
        return u.isVerified === true || walletConnected || miniappVerified;
      }).length;

      // Calculate pending submissions
      const pendingSubmissions = submissions.filter(s => s.status === 'pending').length;

      // Count blocked users from both users collection and banned_users collection
      const blockedFromUsers = users.filter(u => u.isBlocked).length;
      const bannedUsers = await storage.findByQuery<any>('banned_users', {}, {}).catch(() => []);
      const totalBlocked = blockedFromUsers + bannedUsers.length;

      return {
        users: {
          total: users.length,
          active: users.filter(u => u.isActive).length,
          verified: verifiedUsers,
          withWallet: users.filter(u => u.walletAddress && u.walletAddress.trim() !== '').length,
          blocked: totalBlocked
        },
        tasks: {
          total: tasks.length,
          active: tasks.filter(t => t.isActive).length,
          completed: tasks.reduce((sum, t) => sum + (t.completionCount || 0), 0),
          pending: pendingSubmissions
        },
        system: {
          uptime: uptimeSeconds,
          processUptime: process.uptime(),
          memory: process.memoryUsage(),
          storage: healthData,
          botStartTime: systemConfig?.botStartTime || null
        },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.logger.error('Failed to get system stats:', error);
      throw error;
    }
  }

  getSystemStatsText(stats: any): string {
    return `📊 *System Statistics*

👥 *Users*
• Total: ${stats.users.total}
• Active: ${stats.users.active}
• Verified: ${stats.users.verified}

📋 *Tasks*
• Total: ${stats.tasks.total}
• Active: ${stats.tasks.active}
• Completed: ${stats.tasks.completed}

💾 *System*
• Uptime: ${Math.floor(stats.system.uptime / 3600)}h ${Math.floor((stats.system.uptime % 3600) / 60)}m
• Memory: ${Math.round(stats.system.memory.used / 1024 / 1024)}MB used

🕐 Updated: ${new Date(stats.timestamp).toLocaleString()}`;
  }

  getSystemStatsKeyboard(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: 'Refresh', callback_data: 'admin_stats_refresh' },
          { text: 'Analytics', callback_data: 'admin_analytics' }
        ],
        [
          { text: 'User Stats', callback_data: 'admin_user_stats' },
          { text: 'Task Stats', callback_data: 'admin_task_stats' }
        ],
        [
          { text: 'Security Stats', callback_data: 'admin_security_stats' },
          { text: 'Performance', callback_data: 'admin_performance' }
        ],
        [{ text: 'Back to Admin Panel', callback_data: 'admin_panel' }]
      ]
    };
  }

  async getUserStats(): Promise<any> {
    const users = await storage.getAllUsers();
    const bannedUsers = await storage.findByQuery<any>('banned_users', {}, {}).catch(() => []);
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Count blocked from both sources
    const blockedFromUsers = users.filter(u => u.isBlocked).length;
    const totalBlocked = blockedFromUsers + bannedUsers.length;

    return {
      total: users.length,
      active: users.filter(u => u.isActive).length,
      newToday: users.filter(u => new Date(u.joinedAt) > dayAgo).length,
      newThisWeek: users.filter(u => new Date(u.joinedAt) > weekAgo).length,
      withWallet: users.filter(u => u.walletAddress).length,
      blocked: totalBlocked,
      topByPoints: users
        .sort((a, b) => (b.points || 0) - (a.points || 0))
        .slice(0, 10)
    };
  }

  async getTaskStats(): Promise<any> {
    const tasks = await storage.getAllTasks();
    const submissions = await storage.getAllTaskSubmissions();

    return {
      total: tasks.length,
      active: tasks.filter(t => t.isActive).length,
      totalSubmissions: submissions.length,
      pendingSubmissions: submissions.filter(s => s.status === 'pending').length,
      averageCompletionRate: tasks.length > 0 
        ? tasks.reduce((sum, t) => sum + (t.completionCount || 0), 0) / tasks.length 
        : 0
    };
  }

  async getSecurityStats(): Promise<any> {
    try {
      const logs = await storage.getSecurityAuditLogs({});
      const recentLogs = logs.filter(log => 
        new Date(log.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000)
      );

      // Count blocked users from both collections
      const [users, bannedUsers] = await Promise.all([
        storage.getAllUsers(),
        storage.findByQuery<any>('banned_users', {}, {}).catch(() => [])
      ]);
      const blockedFromUsers = users.filter(u => u.isBlocked).length;
      const totalBlocked = blockedFromUsers + bannedUsers.length;

      return {
        totalEvents: logs.length,
        todayEvents: recentLogs.length,
        suspiciousActivity: recentLogs.filter(log => 
          log.severity === 'high' || log.action.includes('block')
        ).length,
        blockedUsers: totalBlocked
      };
    } catch (error) {
      this.logger.warn('Failed to get security stats:', error);
      return {
        totalEvents: 0,
        todayEvents: 0,
        suspiciousActivity: 0,
        blockedUsers: 0
      };
    }
  }

  async getClaimStats(): Promise<any> {
    try {
      const minWithdrawalPoints = config.points?.minWithdraw ?? 0;
      const conversionRate = config.points?.conversionRate ?? 1;

      const [claimSummary] = await storage.aggregate<any>('withdrawals', [
        { $match: { status: 'completed' } },
        {
          $group: {
            _id: null,
            totalTokens: { $sum: { $ifNull: ['$tokenAmount', 0] } },
            totalPoints: { $sum: { $ifNull: ['$pointsWithdrawn', 0] } },
            minTokens: { $min: { $ifNull: ['$tokenAmount', null] } },
            maxTokens: { $max: { $ifNull: ['$tokenAmount', null] } },
            count: { $sum: 1 },
            uniqueUsers: { $addToSet: '$userId' }
          }
        },
        {
          $project: {
            _id: 0,
            totalTokens: 1,
            totalPoints: 1,
            minTokens: 1,
            maxTokens: 1,
            count: 1,
            uniqueUsersCount: { $size: '$uniqueUsers' }
          }
        }
      ]);

      const trendStart = new Date();
      trendStart.setDate(trendStart.getDate() - 30);
      const claimTrendRaw = await storage.aggregate<any>('withdrawals', [
        { $match: { status: 'completed', processedAt: { $exists: true } } },
        { $addFields: { processedDate: { $toDate: '$processedAt' } } },
        { $match: { processedDate: { $gte: trendStart } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$processedDate' } },
            totalTokens: { $sum: { $ifNull: ['$tokenAmount', 0] } },
            totalClaims: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]);

      const topClaimersRaw = await storage.aggregate<any>('withdrawals', [
        { $match: { status: 'completed', processedAt: { $exists: true } } },
        { $addFields: { processedDate: { $toDate: '$processedAt' } } },
        { $sort: { processedDate: 1 } },
        {
          $group: {
            _id: '$userId',
            totalTokens: { $sum: { $ifNull: ['$tokenAmount', 0] } },
            totalPoints: { $sum: { $ifNull: ['$pointsWithdrawn', 0] } },
            claims: { $sum: 1 },
            lastClaimAt: { $last: '$processedDate' },
            walletAddress: { $last: '$walletAddress' }
          }
        },
        { $sort: { totalTokens: -1 } },
        { $limit: 10 }
      ]);

      const [userSummary] = await storage.aggregate<any>('users', [
        {
          $addFields: {
            walletAddressNormalized: {
              $trim: { input: { $ifNull: ['$walletAddress', ''] } }
            }
          }
        },
        {
          $group: {
            _id: null,
            totalUsers: { $sum: 1 },
            totalPoints: { $sum: { $ifNull: ['$points', 0] } },
            walletUsers: {
              $sum: {
                $cond: [
                  { $ne: ['$walletAddressNormalized', ''] },
                  1,
                  0
                ]
              }
            },
            eligibleUsers: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $ne: ['$walletAddressNormalized', ''] },
                      { $gte: [{ $ifNull: ['$points', 0] }, minWithdrawalPoints] }
                    ]
                  },
                  1,
                  0
                ]
              }
            }
          }
        }
      ]);

      const lastClaimRows = await storage.findByQuery<any>(
        'withdrawals',
        { status: 'completed' },
        { sort: { processedAt: -1 }, limit: 1 }
      );
      const lastClaim = Array.isArray(lastClaimRows) && lastClaimRows.length > 0 ? lastClaimRows[0] : null;

      let contractBalanceTokens: number | null = null;
      let contractBalanceRaw: string | null = null;

      if (config.wallet?.rpcUrl && config.wallet?.tokenContractAddress && config.wallet?.claimContractAddress) {
        try {
          const provider = new ethers.providers.JsonRpcProvider(config.wallet.rpcUrl);
          const tokenContract = new ethers.Contract(
            config.wallet.tokenContractAddress,
            ['function balanceOf(address account) view returns (uint256)'],
            provider
          );
          const balance = await tokenContract.balanceOf(config.wallet.claimContractAddress);
          contractBalanceRaw = balance.toString();
          contractBalanceTokens = parseFloat(ethers.utils.formatUnits(balance, config.wallet.tokenDecimals ?? 18));
        } catch (error) {
          this.logger.warn('Failed to fetch claim contract balance', { error: (error as any)?.message || error });
        }
      }

      const totalClaimedTokens = Number(claimSummary?.totalTokens ?? 0);
      const totalClaimedPoints = Number(claimSummary?.totalPoints ?? 0);
      const totalClaims = Number(claimSummary?.count ?? 0);
      const uniqueClaimers = Number(claimSummary?.uniqueUsersCount ?? 0);
      const minTokensPerClaim =
        claimSummary && claimSummary.minTokens !== undefined && claimSummary.minTokens !== null
          ? Number(claimSummary.minTokens)
          : null;
      const maxTokensPerClaim =
        claimSummary && claimSummary.maxTokens !== undefined && claimSummary.maxTokens !== null
          ? Number(claimSummary.maxTokens)
          : null;
      const averageTokensPerClaim = totalClaims > 0 ? totalClaimedTokens / totalClaims : 0;

      const outstandingPoints = Number(userSummary?.totalPoints ?? 0);
      const outstandingTokens = outstandingPoints * conversionRate;

      const totalAvailableTokens =
        contractBalanceTokens !== null ? contractBalanceTokens + totalClaimedTokens : null;
      const percentClaimed =
        totalAvailableTokens && totalAvailableTokens > 0 ? (totalClaimedTokens / totalAvailableTokens) * 100 : null;
      const percentRemaining = percentClaimed !== null ? Math.max(0, 100 - percentClaimed) : null;

      return {
        tokenSymbol: config.wallet?.tokenSymbol || 'tokens',
        contractBalanceTokens,
        contractBalanceRaw,
        totalClaimedTokens,
        totalClaimedPoints,
        totalClaims,
        uniqueClaimers,
        minTokensPerClaim,
        maxTokensPerClaim,
        averageTokensPerClaim,
        percentClaimed,
        percentRemaining,
        outstandingPoints,
        outstandingTokens,
        minWithdrawalPoints,
        conversionRate,
        totalUsers: Number(userSummary?.totalUsers ?? 0),
        walletUsers: Number(userSummary?.walletUsers ?? 0),
        eligibleUsers: Number(userSummary?.eligibleUsers ?? 0),
        lastClaim: lastClaim
          ? {
              userId: lastClaim.userId,
              walletAddress: lastClaim.walletAddress,
              tokenAmount: Number(lastClaim.tokenAmount ?? 0),
              points: Number(lastClaim.pointsWithdrawn ?? 0),
              transactionHash: lastClaim.transactionHash,
              processedAt:
                lastClaim.processedAt instanceof Date
                  ? lastClaim.processedAt.toISOString()
                  : lastClaim.processedAt,
            }
          : null,
        trend: (claimTrendRaw || []).map((row: any) => ({
          date: row._id,
          totalTokens: Number(row.totalTokens ?? 0),
          totalClaims: Number(row.totalClaims ?? 0),
        })),
        topClaimers: (topClaimersRaw || []).map((row: any) => ({
          userId: row._id,
          totalTokens: Number(row.totalTokens ?? 0),
          totalPoints: Number(row.totalPoints ?? 0),
          totalClaims: Number(row.claims ?? 0),
          walletAddress: row.walletAddress,
          lastClaimAt: row.lastClaimAt instanceof Date ? row.lastClaimAt.toISOString() : row.lastClaimAt,
        })),
      };
    } catch (error) {
      this.logger.error('Failed to get claim stats:', error);
      throw error;
    }
  }

  async getPerformanceMetrics(): Promise<any> {
    return {
      memory: process.memoryUsage(),
      uptime: process.uptime(),
      cpu: process.cpuUsage(),
      version: process.version,
      platform: process.platform
    };
  }
}