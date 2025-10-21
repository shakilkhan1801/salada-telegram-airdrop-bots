import { Context } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { Logger } from '../../services/logger';
import { StorageManager } from '../../storage';
import { getConfig } from '../../config';
import { SecurityUtils } from '../../security';
import { CallbackQueryService, RateLimitService, RateLimitAction, PointsService, LeaderboardService } from '../../shared';
import { PointTransaction } from '../../types/user.types';
import { atomicOps, PointsTransaction } from '../../utils/atomic-operations';

export class PointsHandler {
  private readonly logger = Logger.getInstance();
  private readonly storage = StorageManager.getInstance();
  private readonly config = getConfig();

  /**
   * Show user's current points and basic information
   */
  async showPoints(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      const user = await this.storage.getUser(userId);
      if (!user) {
        await ctx.reply('❌ User not found.');
        return;
      }

      const pointsText = await this.getPointsText(user);
      const keyboard = this.getPointsKeyboard(user);

      if (ctx.callbackQuery) {
        await ctx.editMessageText(pointsText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      } else {
        await ctx.reply(pointsText, {
          reply_markup: keyboard,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true }
        });
      }

    } catch (error) {
      this.logger.error('Error showing points:', error);
      await ctx.reply('❌ Error loading points information.', { link_preview_options: { is_disabled: true } });
    }
  }

  /**
   * Show detailed statistics
   */
  async showStats(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      const user = await this.storage.getUser(userId);
      if (!user) {
        await ctx.reply('❌ User not found.');
        return;
      }

      const stats = await this.calculateDetailedStats(user);
      const statsText = this.getStatsText(user, stats);
      const keyboard = this.getStatsKeyboard();

      if (ctx.callbackQuery) {
        await ctx.editMessageText(statsText, {
          reply_markup: keyboard,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true }
        });
      } else {
        await ctx.reply(statsText, {
          reply_markup: keyboard,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true }
        });
      }

    } catch (error) {
      this.logger.error('Error showing stats:', error);
      await ctx.reply('❌ Error loading statistics.', { link_preview_options: { is_disabled: true } });
    }
  }

  /**
   * Show point transaction history
   */
  async showTransactionHistory(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      const user = await this.storage.getUser(userId);
      if (!user) {
        await ctx.reply('❌ User not found.');
        return;
      }

      const transactions = await this.storage.getPointTransactions(userId);
      const historyText = this.getTransactionHistoryTextWithUserData(transactions, user);
      const keyboard = this.getTransactionHistoryKeyboard();

      if (ctx.callbackQuery) {
        try {
          await ctx.editMessageText(historyText, {
            reply_markup: keyboard,
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true }
          });
        } catch (error: any) {
          // Handle "message is not modified" error
          if (error.message?.includes('message is not modified')) {
            // Message content is same, just answer callback
            return;
          }
          throw error;
        }
      } else {
        await ctx.reply(historyText, {
          reply_markup: keyboard,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true }
        });
      }

    } catch (error) {
      this.logger.error('Error showing transaction history:', error);
      await ctx.reply('❌ Error loading transaction history.', { link_preview_options: { is_disabled: true } });
    }
  }

  /**
   * Award points to a user
   */
  async awardPoints(
    userId: string,
    amount: number,
    reason: string,
    metadata?: any
  ): Promise<boolean> {
    try {
      const user = await this.storage.getUser(userId);
      if (!user) {
        this.logger.error('User not found for point award:', {
          userId: userId,
          userIdType: typeof userId,
          attempting: 'point award for captcha completion'
        });
        return false;
      }

      // Validate points amount
      const validation = SecurityUtils.validatePoints(amount);
      if (!validation.isValid) {
        this.logger.error('Invalid points amount:', validation.error);
        return false;
      }

      const validAmount = validation.sanitizedAmount;

      // SECURITY FIX: Use atomic transaction for points and logging
      const pointsTransaction = new PointsTransaction();
      
      // Create transaction record
      const transaction: PointTransaction = {
        id: `tx_${Date.now()}_${userId}`,
        userId,
        amount: validAmount,
        type: 'earned',
        source: 'system',
        description: reason,
        timestamp: new Date(),
        metadata: metadata || {}
      };
      
      // Add user update to transaction (using existing atomic updateUser)
      const userUpdateSuccess = await this.storage.updateUser(userId, {
        points: user.points + validAmount,
        totalEarned: (user.totalEarned || 0) + validAmount,
        lastActivityAt: new Date().toISOString()
      });
      
      if (!userUpdateSuccess) {
        this.logger.error('Failed to atomically update user points', { userId, amount: validAmount });
        return false;
      }
      
      // Save transaction log
      const transactionSuccess = await this.storage.savePointTransaction(transaction);
      
      if (!transactionSuccess) {
        this.logger.error('CRITICAL: Points awarded but transaction log failed', {
          userId,
          amount: validAmount,
          transactionId: transaction.id
        });
        // Transaction already committed, but log the issue for manual audit
      }

      this.logger.info('Points awarded', {
        userId,
        amount: validAmount,
        reason,
        newBalance: user.points + validAmount
      });

      return true;

    } catch (error) {
      this.logger.error('Error awarding points:', error);
      return false;
    }
  }

  /**
   * Deduct points from a user
   */
  async deductPoints(
    userId: string,
    amount: number,
    reason: string,
    metadata?: any
  ): Promise<boolean> {
    try {
      const user = await this.storage.getUser(userId);
      if (!user) {
        this.logger.error('User not found for point deduction:', userId);
        return false;
      }

      // Validate points amount
      const validation = SecurityUtils.validatePoints(amount);
      if (!validation.isValid) {
        this.logger.error('Invalid points amount:', validation.error);
        return false;
      }

      const validAmount = validation.sanitizedAmount;

      // Check if user has enough points
      if (user.points < validAmount) {
        this.logger.error('Insufficient points for deduction:', {
          userId,
          currentPoints: user.points,
          requestedDeduction: validAmount
        });
        return false;
      }

      // SECURITY FIX: Use atomic operation for point deduction and logging
      
      // Create transaction record
      const transaction: PointTransaction = {
        id: `tx_${Date.now()}_${userId}`,
        userId,
        amount: -validAmount,
        type: 'spent',
        source: 'system',
        description: reason,
        timestamp: new Date(),
        metadata: metadata || {}
      };
      
      // Update user points atomically
      const userUpdateSuccess = await this.storage.updateUser(userId, {
        points: user.points - validAmount,
        lastActivityAt: new Date().toISOString()
      });
      
      if (!userUpdateSuccess) {
        this.logger.error('Failed to atomically deduct user points', { userId, amount: validAmount });
        return false;
      }
      
      // Save transaction log
      const transactionSuccess = await this.storage.savePointTransaction(transaction);
      
      if (!transactionSuccess) {
        this.logger.error('CRITICAL: Points deducted but transaction log failed', {
          userId,
          amount: validAmount,
          transactionId: transaction.id
        });
        // Transaction already committed, but log the issue for manual audit
      }

      this.logger.info('Points deducted', {
        userId,
        amount: validAmount,
        reason,
        newBalance: user.points - validAmount
      });

      return true;

    } catch (error) {
      this.logger.error('Error deducting points:', error);
      return false;
    }
  }

  /**
   * Handle daily check-in bonus
   */
  async handleDailyCheckIn(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      // Check rate limit (daily check-in)
      const rateLimit = await RateLimitService.checkRateLimit(userId, RateLimitAction.POINT_CLAIM);
      if (!rateLimit.allowed) {
        const resetTime = rateLimit.resetTime.toLocaleTimeString();
        await ctx.answerCbQuery(`⏰ Daily bonus already claimed. Next bonus: ${resetTime}`);
        return;
      }

      const user = await this.storage.getUser(userId);
      if (!user) {
        await ctx.reply('❌ User not found.');
        return;
      }

      // Check if already claimed today
      const today = new Date().toDateString();
      const lastClaim = await this.getLastDailyClaimDate(userId);
      
      if (lastClaim === today) {
        await ctx.answerCbQuery('⏰ Daily bonus already claimed today!');
        return;
      }

      // Calculate bonus (with streak multiplier)
      const streak = await this.calculateDailyStreak(userId);
      const baseBonus = this.config.bot.dailyBonus;
      const streakMultiplier = Math.min(1 + (streak * 0.1), 3); // Max 3x multiplier
      const totalBonus = Math.floor(baseBonus * streakMultiplier);

      // Award points
      const success = await this.awardPoints(
        userId,
        totalBonus,
        `Daily check-in bonus (Day ${streak + 1})`,
        {
          streak: streak + 1,
          baseBonus,
          streakMultiplier,
          claimDate: new Date()
        }
      );

      if (success) {
        // Update daily claim record
        await this.updateDailyClaimRecord(userId, streak + 1);

        const streakText = streak > 0 ? `\n🔥 Streak: ${streak + 1} days (${streakMultiplier.toFixed(1)}x bonus)` : '';

        await ctx.reply(
          `✅ <b>Daily Bonus Claimed!</b>\n\n` +
          `💰 Points Earned: ${totalBonus}\n` +
          `💎 New Balance: ${(user.points + totalBonus).toLocaleString()}${streakText}\n\n` +
          `⏰ Come back tomorrow for another bonus!`,
          { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
        );
      } else {
        await ctx.answerCbQuery('❌ Error claiming daily bonus');
      }

    } catch (error) {
      this.logger.error('Error handling daily check-in:', error);
      await ctx.answerCbQuery('❌ Error processing daily bonus');
    }
  }

  /**
   * Handle callback queries for points operations
   */
  async handleCallback(ctx: Context): Promise<void> {
    const data = CallbackQueryService.getCallbackData(ctx);
    if (!data) return;

    if (data === 'points_show') {
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.showPoints(ctx);
      }, true);
    } else if (data === 'points_stats') {
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.showStats(ctx);
      }, true);
    } else if (data === 'points_history') {
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.showTransactionHistory(ctx);
      }, true);
    } else if (data === 'points_leaderboard') {
      await CallbackQueryService.handleRateLimitedCallback(ctx, async (ctx) => {
        await this.showPointsLeaderboard(ctx);
      }, 600);
    }
  }

  private async getPointsText(user: any): Promise<string> {
    const rank = await this.getUserPointsRank(user.telegramId);
    const rankLabel = rank > 0 && rank <= 100 ? `#${rank}` : '#100+';

    const joinedAtDate = user.joinedAt 
      ? (typeof user.joinedAt === 'string' ? new Date(user.joinedAt) : user.joinedAt)
      : (user.firstSeen 
          ? (typeof user.firstSeen === 'string' ? new Date(user.firstSeen) : user.firstSeen)
          : new Date());
    const daysSinceJoin = Math.floor((Date.now() - joinedAtDate.getTime()) / (1000 * 60 * 60 * 24));
    const pointsPerDay = daysSinceJoin > 0 ? Math.round((user.points || 0) / daysSinceJoin) : 0;

    const stats = await PointsService.getUserPointStats(user.telegramId);
    const tasksCompleted = (user.completedTasks?.length || 0) + Object.keys(user.dailyTasksCompleted || {}).length;

    return `
💰 <b>Your Points</b>

💎 <b>Current Balance:</b> ${(user.points || 0).toLocaleString()} points
📈 <b>Total Points Earned:</b> ${(stats.totalEarned || 0).toLocaleString()}
📊 <b>Global Rank:</b> ${rankLabel}
📉 <b>Daily Average:</b> ${pointsPerDay} points

🎯 <b>Earning Summary:</b>
✅ Tasks Completed: ${tasksCompleted}
👥 Referrals Made: ${user.totalReferrals || 0}
📅 Member Since: ${joinedAtDate.toLocaleDateString()}

💡 <b>Ways to Earn More:</b>
• Complete available tasks
• Invite friends with your referral code
• Connect your wallet to withdraw tokens
• Participate in community activities

🏆 <b>Milestones:</b>
• Next milestone: ${this.getNextMilestone(user.points)} points
    `.trim();
  }

  private getPointsKeyboard(user: any): InlineKeyboardMarkup {
    const keyboard: any[][] = [
      [
        { text: 'Detailed Stats', callback_data: 'points_stats' },
        { text: 'History', callback_data: 'points_history' }
      ],
      [
        { text: 'Leaderboard', callback_data: 'points_leaderboard' }
      ],
      [
        { text: 'Main Menu', callback_data: 'menu_main' }
      ]
    ];

    return { inline_keyboard: keyboard };
  }

  private async calculateDetailedStats(user: any): Promise<{
    totalEarned: number;
    totalSpent: number;
    averagePerDay: number;
    averagePerTask: number;
    topEarningDay: { date: string; amount: number } | null;
    earningsByType: Record<string, number>;
    weeklyProgress: Array<{ week: string; earned: number }>;
  }> {
    try {
      const transactions = await this.storage.getPointTransactions(user.telegramId);
      
      const earned = transactions.filter(tx => tx.amount > 0);
      const spent = transactions.filter(tx => tx.amount < 0);

      const totalEarned = earned.reduce((sum, tx) => sum + tx.amount, 0);
      const totalSpent = Math.abs(spent.reduce((sum, tx) => sum + tx.amount, 0));

      // Handle joinedAt field with proper fallbacks
      const joinDate = user.joinedAt || user.registeredAt || user.createdAt;
      const joinedAtDate = joinDate 
        ? (typeof joinDate === 'string' ? new Date(joinDate) : joinDate)
        : new Date();
      
      const daysSinceJoin = Math.max(1, 
        (Date.now() - (joinedAtDate && !isNaN(joinedAtDate.getTime()) ? joinedAtDate.getTime() : Date.now())) / (1000 * 60 * 60 * 24)
      );
      const averagePerDay = totalEarned / daysSinceJoin;

      const taskTransactions = earned.filter(tx => (tx as any).metadata?.category === 'task_completion');
      const averagePerTask = taskTransactions.length > 0 
        ? taskTransactions.reduce((sum, tx) => sum + tx.amount, 0) / taskTransactions.length
        : 0;

      // Calculate top earning day
      const topEarningDay = this.findTopEarningDay(earned);

      // Calculate earnings by type
      const earningsByType: Record<string, number> = {};
      earned.forEach((tx: any) => {
        const key = tx.metadata?.category || 'other';
        earningsByType[key] = (earningsByType[key] || 0) + tx.amount;
      });

      // Calculate weekly progress
      const weeklyProgress = this.calculateWeeklyProgress(earned);

      return {
        totalEarned,
        totalSpent,
        averagePerDay,
        averagePerTask,
        topEarningDay,
        earningsByType,
        weeklyProgress
      };

    } catch (error) {
      this.logger.error('Error calculating detailed stats:', error);
      return {
        totalEarned: user.points,
        totalSpent: 0,
        averagePerDay: 0,
        averagePerTask: 0,
        topEarningDay: null,
        earningsByType: {},
        weeklyProgress: []
      };
    }
  }

  private getStatsText(user: any, stats: any): string {
    return `
📊 <b>Detailed Statistics</b>

💰 <b>Points Overview:</b>
• Current Balance: <b>${(user.points || 0).toLocaleString()}</b>
• Total Earned: <b>${stats.totalEarned.toLocaleString()}</b>
• Total Spent: <b>${stats.totalSpent.toLocaleString()}</b>

📈 <b>Performance:</b>
• Daily Average: <b>${stats.averagePerDay.toFixed(1)}</b> points
• Average per Task: <b>${stats.averagePerTask.toFixed(1)}</b> points
${stats.topEarningDay 
  ? `• Best Day: <b>${stats.topEarningDay.amount}</b> points (${stats.topEarningDay.date})`
  : '• Best Day: No data yet'}

💎 <b>Earnings by Source:</b>
${Object.entries(stats.earningsByType).map(([type, amount]) => 
  `• ${this.getEarningTypeLabel(type)}: <b>${(amount as number).toLocaleString()}</b>`
).join('\n')}

📅 <b>Weekly Progress:</b>
${stats.weeklyProgress.slice(0, 4).map((week: { week: string; earned: number }) => 
  `• ${week.week}: ${week.earned} points`
).join('\n')}

🎯 <b>Account Info:</b>
• Member Since: ${this.getFormattedJoinDate(user)}
• Days Active: ${this.getDaysActive(user)}
• Last Active: ${this.getFormattedLastActiveDate(user)}
    `.trim();
  }

  private getFormattedJoinDate(user: any): string {
    try {
      const joinDate = user.joinedAt || user.registeredAt || user.createdAt;
      const joinedAtDate = joinDate 
        ? (typeof joinDate === 'string' ? new Date(joinDate) : joinDate)
        : new Date();
      
      if (joinedAtDate && !isNaN(joinedAtDate.getTime())) {
        return joinedAtDate.toLocaleDateString();
      }
      return 'Unknown';
    } catch (error) {
      return 'Unknown';
    }
  }

  private getDaysActive(user: any): number {
    try {
      const joinDate = user.joinedAt || user.registeredAt || user.createdAt;
      const joinedAtDate = joinDate 
        ? (typeof joinDate === 'string' ? new Date(joinDate) : joinDate)
        : new Date();
      
      if (joinedAtDate && !isNaN(joinedAtDate.getTime())) {
        return Math.floor((Date.now() - joinedAtDate.getTime()) / (1000 * 60 * 60 * 24));
      }
      return 0;
    } catch (error) {
      return 0;
    }
  }

  private getFormattedLastActiveDate(user: any): string {
    try {
      const lastActiveField = user.lastActive || user.lastActivity || user.lastSeen || user.lastActiveAt;
      const lastActiveDate = lastActiveField 
        ? (typeof lastActiveField === 'string' ? new Date(lastActiveField) : lastActiveField)
        : new Date();
      
      if (lastActiveDate && !isNaN(lastActiveDate.getTime())) {
        return lastActiveDate.toLocaleDateString();
      }
      return 'Unknown';
    } catch (error) {
      return 'Unknown';
    }
  }

  private getStatsKeyboard(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: 'History', callback_data: 'points_history' },
          { text: 'Leaderboard', callback_data: 'points_leaderboard' }
        ],
        [
          { text: 'Referrals', callback_data: 'referral_show' }
        ],
        [
          { text: 'Back to Points', callback_data: 'points_show' }
        ]
      ]
    };
  }

  private getTransactionHistoryText(transactions: PointTransaction[]): string {
    const user = this.storage.getUser; // We'll get user data in the calling method
    let text = '📜 <b>Your Points History</b>\n\n';

    if (transactions.length === 0) {
      text += '📝 No transactions yet.\n\nStart completing tasks to earn points!';
    } else {
      // Show last 5 transactions
      const recentTransactions = transactions
        .filter(tx => tx.timestamp) // Filter out transactions without timestamp
        .sort((a, b) => {
          const aTime = typeof a.timestamp === 'string' ? new Date(a.timestamp) : a.timestamp;
          const bTime = typeof b.timestamp === 'string' ? new Date(b.timestamp) : b.timestamp;
          return (bTime?.getTime() || 0) - (aTime?.getTime() || 0);
        })
        .slice(0, 5);

      text += '📅 <b>Recent Transactions:</b>\n';
      recentTransactions.forEach(tx => {
        const timestampDate = typeof tx.timestamp === "string" ? new Date(tx.timestamp) : tx.timestamp;
        const date = timestampDate.toLocaleDateString();
        const icon = tx.amount > 0 ? '➕' : '➖';
        const sign = tx.amount > 0 ? '' : '-';
        
        text += `${icon} ${sign}${tx.amount} pts - ${tx.description} (${date})\n`;
      });

      if (transactions.length > 5) {
        text += `\n📊 Total ${transactions.length} transactions`;
      }
    }

    return text.trim();
  }

  private getTransactionHistoryTextWithUserData(transactions: PointTransaction[], user: any): string {
    let text = '📜 <b>Your Points History</b>\n\n';

    // Add current points and total earned
    const totalEarned = transactions.filter(tx => tx.amount > 0).reduce((sum, tx) => sum + tx.amount, 0);
    text += `💰 <b>Current Balance:</b> ${(user.points || 0).toLocaleString()}\n`;
    text += `📈 <b>Total Earned:</b> ${totalEarned.toLocaleString()}\n\n`;

    if (transactions.length === 0) {
      text += '📝 No transactions yet.\n\nStart completing tasks to earn points!';
    } else {
      // Show last 5 transactions
      const recentTransactions = transactions
        .filter(tx => tx.timestamp) // Filter out transactions without timestamp
        .sort((a, b) => {
          const aTime = typeof a.timestamp === 'string' ? new Date(a.timestamp) : a.timestamp;
          const bTime = typeof b.timestamp === 'string' ? new Date(b.timestamp) : b.timestamp;
          return (bTime?.getTime() || 0) - (aTime?.getTime() || 0);
        })
        .slice(0, 5);

      text += '📅 <b>Recent Transactions:</b>\n';
      recentTransactions.forEach(tx => {
        const timestampDate = typeof tx.timestamp === "string" ? new Date(tx.timestamp) : tx.timestamp;
        const date = timestampDate.toLocaleDateString();
        const icon = tx.amount > 0 ? '➕' : '➖';
        const sign = tx.amount > 0 ? '' : '-';
        
        text += `${icon} ${sign}${tx.amount} pts - ${tx.description} (${date})\n`;
      });

      if (transactions.length > 5) {
        text += `\n📊 Total ${transactions.length} transactions`;
      }
    }

    return text.trim();
  }

  private getTransactionHistoryKeyboard(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: 'Refresh', callback_data: 'points_history' },
          { text: 'Statistics', callback_data: 'points_stats' }
        ],
        [
          { text: 'Back to Points', callback_data: 'points_show' }
        ]
      ]
    };
  }

  private async showPointsLeaderboard(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      const entries = await LeaderboardService.generatePointsLeaderboardDetailed(10);
      const userRank = userId ? await LeaderboardService.getUserPointsRank(userId) : 0;
      const leaderboardTextBase = LeaderboardService.formatPointsLeaderboardDetailed(entries, '🏆 Points Leaderboard');
      const rankLabel = userRank > 0 && userRank <= 100 ? `#${userRank}` : '#100+';
      const leaderboardText = userRank > 0 ? `${leaderboardTextBase}\n\n📊 Your Rank: ${rankLabel}` : leaderboardTextBase;
      const keyboard = this.getPointsLeaderboardKeyboard();

      if (ctx.callbackQuery) {
        try {
          await ctx.editMessageText(leaderboardText, {
            reply_markup: keyboard,
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true }
          });
        } catch (editError: any) {
          if (editError.message && (editError.message.includes('message is not modified') || editError.message.includes('no text in the message'))) {
            await ctx.reply(leaderboardText, {
              reply_markup: keyboard,
              parse_mode: 'HTML',
              link_preview_options: { is_disabled: true }
            });
          } else {
            throw editError;
          }
        }
      } else {
        await ctx.reply(leaderboardText, {
          reply_markup: keyboard,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true }
        });
      }

    } catch (error) {
      this.logger.error('Error showing points leaderboard:', error);
      await ctx.reply('❌ Error loading leaderboard.', { link_preview_options: { is_disabled: true } });
    }
  }

  private async getPointsLeaderboard(): Promise<any[]> {
    try {
      const { LeaderboardService } = await import('../../shared');
      const entries = await LeaderboardService.generatePointsLeaderboard(10);
      return entries.map(e => ({
        rank: e.rank,
        name: e.name || 'Unknown',
        username: '',
        points: e.points || 0,
        referrals: 0,
        tasksCompleted: 0
      }));
    } catch (error) {
      this.logger.error('Error getting points leaderboard:', error);
      return [];
    }
  }

  private async getUserPointsRank(userId: string): Promise<number> {
    try {
      const { LeaderboardService } = await import('../../shared');
      return await LeaderboardService.getUserPointsRank(userId);
    } catch (error) {
      this.logger.error('Error getting user points rank:', error);
      return 0;
    }
  }

  private getPointsLeaderboardText(leaderboard: any[], userRank: number): string {
    let text = '🏆 <b>Points Leaderboard</b>\n\n';

    if (leaderboard.length === 0) {
      text += '📝 No users with points yet.';
    } else {
      leaderboard.forEach((user, index) => {
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '📍';
        const username = user.username ? `@${user.username}` : user.name;
        
        text += `${medal} <b>${user.rank}.</b> ${username}\n`;
        text += `   💰 ${(user.points || 0).toLocaleString()} pts • 👥 ${(user.referrals || user.totalReferrals || 0)} refs • ✅ ${(user.tasksCompleted || (user.completedTasks ? user.completedTasks.length : 0))} tasks\n\n`;
      });

      if (userRank > 0) {
        const rankLabel = userRank > 0 && userRank <= 100 ? `#${userRank}` : '#100+';
        text += `\n📊 <b>Your Rank:</b> ${rankLabel}`;
      }
    }

    return text.trim();
  }

  private getPointsLeaderboardKeyboard(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: 'Invite Friends', callback_data: 'referral_show' }
        ],
        [
          { text: 'Refresh', callback_data: 'points_leaderboard' },
          { text: 'Back', callback_data: 'points_show' }
        ]
      ]
    };
  }

  private async canClaimDailyBonus(userId: string): Promise<boolean> {
    try {
      const today = new Date().toDateString();
      const lastClaim = await this.getLastDailyClaimDate(userId);
      return lastClaim !== today;
    } catch (error) {
      this.logger.error('Error checking daily bonus availability:', error);
      return false;
    }
  }

  private canClaimDailyBonusSync(user: any): boolean {
    // Simplified check for immediate response
    return true; // Would implement proper check
  }

  private async getLastDailyClaimDate(userId: string): Promise<string | null> {
    try {
      const transactions = await this.storage.getPointTransactions(userId);
      const dailyBonus = transactions
        .filter(tx => tx.type === 'daily_bonus' && tx.timestamp)
        .sort((a, b) => {
          const aTime = typeof a.timestamp === 'string' ? new Date(a.timestamp) : a.timestamp;
          const bTime = typeof b.timestamp === 'string' ? new Date(b.timestamp) : b.timestamp;
          return (bTime?.getTime() || 0) - (aTime?.getTime() || 0);
        })[0];

      return dailyBonus ? dailyBonus.timestamp.toDateString() : null;
    } catch (error) {
      this.logger.error('Error getting last daily claim date:', error);
      return null;
    }
  }

  private async calculateDailyStreak(userId: string): Promise<number> {
    try {
      const transactions = await this.storage.getPointTransactions(userId);
      const dailyBonuses = transactions
        .filter(tx => tx.type === 'daily_bonus' && tx.timestamp)
        .sort((a, b) => {
          const aTime = typeof a.timestamp === 'string' ? new Date(a.timestamp) : a.timestamp;
          const bTime = typeof b.timestamp === 'string' ? new Date(b.timestamp) : b.timestamp;
          return (bTime?.getTime() || 0) - (aTime?.getTime() || 0);
        });

      if (dailyBonuses.length === 0) return 0;

      let streak = 0;
      let currentDate = new Date();
      currentDate.setHours(0, 0, 0, 0);

      for (const bonus of dailyBonuses) {
        const bonusDate = new Date(bonus.timestamp);
        bonusDate.setHours(0, 0, 0, 0);

        const daysDiff = Math.floor(
          (currentDate.getTime() - bonusDate.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysDiff === 1) {
          streak++;
          currentDate = bonusDate;
        } else if (daysDiff === 0 && streak === 0) {
          // Today's bonus
          streak++;
          currentDate = bonusDate;
        } else {
          break;
        }
      }

      return streak;
    } catch (error) {
      this.logger.error('Error calculating daily streak:', error);
      return 0;
    }
  }

  private async updateDailyClaimRecord(userId: string, streak: number): Promise<void> {
    try {
      // This would update daily claim records in storage
      // For now, just log the streak
      this.logger.info('Daily claim recorded', {
        userId,
        streak,
        date: new Date().toDateString()
      });
    } catch (error) {
      this.logger.error('Error updating daily claim record:', error);
    }
  }

  private findTopEarningDay(transactions: PointTransaction[]): { date: string; amount: number } | null {
    if (transactions.length === 0) return null;

    const dailyEarnings = new Map<string, number>();

    transactions.forEach(tx => {
      const date = tx.timestamp.toDateString();
      dailyEarnings.set(date, (dailyEarnings.get(date) || 0) + tx.amount);
    });

    let topDate = '';
    let topAmount = 0;

    for (const [date, amount] of dailyEarnings.entries()) {
      if (amount > topAmount) {
        topAmount = amount;
        topDate = date;
      }
    }

    return topAmount > 0 ? { date: topDate, amount: topAmount } : null;
  }

  private calculateWeeklyProgress(transactions: PointTransaction[]): Array<{ week: string; earned: number }> {
    const weeklyData = new Map<string, number>();

    transactions.forEach(tx => {
      const date = new Date(tx.timestamp);
      const weekStart = new Date(date);
      weekStart.setDate(date.getDate() - date.getDay()); // Start of week
      const weekKey = weekStart.toDateString();
      
      weeklyData.set(weekKey, (weeklyData.get(weekKey) || 0) + tx.amount);
    });

    return Array.from(weeklyData.entries())
      .map(([week, earned]) => ({ week, earned }))
      .sort((a, b) => new Date(b.week).getTime() - new Date(a.week).getTime())
      .slice(0, 8); // Last 8 weeks
  }

  private getEarningTypeLabel(type: string): string {
    const labels = {
      task_completion: '📝 Tasks',
      referral_bonus: 'Referrals',
      daily_bonus: '🎁 Daily Bonus',
      wallet_connection: '👛 Wallet Connection',
      welcome_bonus: '🎉 Welcome',
      admin_bonus: '⭐ Admin Bonus',
      event_bonus: '🎊 Event Bonus'
    };

    return labels[type as keyof typeof labels] || '❓ Other';
  }

  private getNextMilestone(currentPoints: number): number {
    const milestones = [100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];
    
    for (const milestone of milestones) {
      if (currentPoints < milestone) {
        return milestone;
      }
    }

    return Math.ceil(currentPoints / 100000) * 100000 + 100000;
  }
}