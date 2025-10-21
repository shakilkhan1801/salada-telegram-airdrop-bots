import { Context, Scenes } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { Logger } from '../../services/logger';
import { StorageManager } from '../../storage';
import { getConfig } from '../../config';
import { SecurityUtils } from '../../security';
import { 
  UserValidationService, 
  CallbackQueryService, 
  MessageService,
  PointsService,
  PointEarningCategory,
  RateLimitService,
  RateLimitAction,
  LeaderboardService,
  ActionSession
} from '../../shared';
import { referralManager } from '../../services/referral-manager.service';

export class ReferralHandler {
  private readonly logger = Logger.getInstance();
  private readonly storage = StorageManager.getInstance();
  private readonly config = getConfig();
  private static globalBotInstance: any = null;
  private botInstance: any = null;

  /**
   * Set the bot instance for sending notifications (instance + global)
   */
  setBotInstance(botInstance: any): void {
    this.botInstance = botInstance;
    ReferralHandler.globalBotInstance = botInstance;
  }

  /**
   * Static setter so other initializers can configure once
   */
  static setGlobalBotInstance(botInstance: any): void {
    ReferralHandler.globalBotInstance = botInstance;
  }

  private hasLockedReferralCode(user: any): boolean {
    const locked = !!(user?.metadata?.customFields?.referralCodeLocked);
    return locked && typeof user.referralCode === 'string' && user.referralCode.length > 0;
  }

  private buildReferralLink(user: any): string {
    const botUsername = this.config.bot.username;
    if (this.hasLockedReferralCode(user)) {
      return `https://t.me/${botUsername}?start=${user.referralCode}`;
    }
    return `https://t.me/${botUsername}?start=${user.telegramId || user.id}`;
  }

  async showReferrals(ctx: Context): Promise<void> {
    try {
      const user = await UserValidationService.validateUser(ctx);
      if (!user) return;

      // Always fetch fresh user data to ensure we have the latest referral code
      const freshUser = await this.storage.getUser(user.telegramId) || user;
      
      const referralData = await this.getReferralData(freshUser.telegramId);
      const referralText = this.getReferralText(freshUser, referralData);
      const keyboard = this.getReferralKeyboard(freshUser);

      await MessageService.editOrReply(ctx, referralText, {
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });

    } catch (error) {
      this.logger.error('Error showing referrals:', error);
      await ctx.reply('❌ Error loading referral information.');
    }
  }

  async showReferralStats(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      const analytics = await this.getReferralAnalytics(userId);
      const statsText = this.getReferralStatsText(analytics);
      const keyboard = this.getReferralStatsKeyboard();

      await MessageService.editOrReply(ctx, statsText, {
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });

    } catch (error) {
      this.logger.error('Error showing referral stats:', error);
      await ctx.reply('❌ Error loading referral statistics.');
    }
  }

  private async showGenerateReferralCodeConfirm(ctx: Context): Promise<void> {
    const user = await UserValidationService.validateUser(ctx);
    if (!user) return;

    if (this.hasLockedReferralCode(user)) {
      await MessageService.editOrReply(ctx, '❌ You have already generated a referral code. It cannot be changed again.', {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: 'Back to Referrals', callback_data: 'referral_show' }]] }
      });
      return;
    }

    const sessionId = CallbackQueryService.createActionSession(user.telegramId, 'referral_generate_session', 60000);

    const text = [
      '⚠️ <b>Confirm Code Change</b>\n',
      'You can generate a new referral code only once.\n',
      'After changing, your old referral link will no longer work and cannot be restored.',
    ].join('\n');

    const keyboard: InlineKeyboardMarkup = {
      inline_keyboard: [
        [
          { text: 'Yes, change my code', callback_data: CallbackQueryService.createCallbackDataWithSession('referral_generate_session', sessionId) },
          { text: 'Cancel', callback_data: 'referral_show' }
        ]
      ]
    };

    await MessageService.editOrReply(ctx, text, { parse_mode: 'HTML', reply_markup: keyboard });
  }

  async generateReferralCode(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      if (!(await RateLimitService.checkAndEnforce(ctx, RateLimitAction.REFERRAL_CODE))) {
        return;
      }

      const user = await UserValidationService.validateUser(ctx);
      if (!user) return;

      if (this.hasLockedReferralCode(user)) {
        await CallbackQueryService.safeAnswerCallback(ctx, '❌ Code already generated');
        await ctx.reply('❌ You have already generated a referral code. It cannot be changed again.');
        return;
      }

      const newCode = await this.generateUniqueReferralCode();

      await this.storage.updateUser(userId, {
        referralCode: newCode,
        metadata: {
          ...user.metadata,
          customFields: {
            ...(user.metadata?.customFields || {}),
            referralCodeLocked: true,
            referralCodeGeneratedAt: new Date().toISOString()
          }
        }
      });

      // Fetch the updated user data from database to ensure we have the latest referral code
      const updatedUser = await this.storage.getUser(userId);
      const link = this.buildReferralLink(updatedUser || { ...user, referralCode: newCode, metadata: { ...(user.metadata || {}), customFields: { ...(user.metadata?.customFields || {}), referralCodeLocked: true } } });

      await ctx.reply(
        '✅ <b>New Referral Code Generated!</b>\n\n' +
        `🎫 Your Code: <code>${newCode}</code>\n` +
        `🔗 Your Link: <code>${link}</code>\n\n` +
        'Share it with friends to earn bonuses.',
        { parse_mode: 'HTML' }
      );

      this.logger.info('New referral code generated', { userId, newCode });

    } catch (error) {
      this.logger.error('Error generating referral code:', error);
      await ctx.answerCbQuery('❌ Error generating referral code');
    }
  }

  async processReferralBonus(referrerId: string, newUserId: string): Promise<void> {
    // Delegate to professional referral manager
    await referralManager.processReferralBonus(referrerId, newUserId, {
      notificationType: 'simple'
    });
  }
  
  private async processReferralBonusLegacy(referrerId: string, newUserId: string): Promise<void> {
    try {
      this.logger.info('DEBUG: Starting referral bonus processing', { referrerId, newUserId });
      
      const referrer = await this.storage.getUser(referrerId);
      const newUser = await this.storage.getUser(newUserId);

      this.logger.info('DEBUG: Fetched users for bonus processing', {
        referrerId,
        newUserId,
        referrerFound: !!referrer,
        newUserFound: !!newUser,
        referrerName: referrer?.firstName,
        newUserName: newUser?.firstName
      });

      if (!referrer || !newUser) {
        this.logger.error('Referrer or new user not found', { referrerId, newUserId });
        return;
      }

      const bonus = this.config.bot.referralBonus;
      const welcomeBonus = Math.floor(bonus * 0.5);

      this.logger.info('DEBUG: Awarding referral bonus to referrer', {
        referrerId,
        bonus,
        currentPoints: referrer.points || 0
      });

      const referrerPointsResult = await PointsService.awardPoints(
        referrerId,
        bonus,
        `Referral bonus for inviting user ${newUserId}`,
        PointEarningCategory.REFERRAL_BONUS,
        { referredUserId: newUserId }
      );

      this.logger.info('DEBUG: Referrer points awarded', {
        referrerId,
        success: referrerPointsResult.success,
        newBalance: referrerPointsResult.newBalance,
        error: referrerPointsResult.error
      });

      this.logger.info('DEBUG: Updating referrer totalReferrals', {
        referrerId,
        currentTotal: referrer.totalReferrals || 0,
        newTotal: (referrer.totalReferrals || 0) + 1
      });

      const updateResult = await this.storage.updateUser(referrerId, {
        totalReferrals: (referrer.totalReferrals || 0) + 1
      });

      this.logger.info('DEBUG: Referrer update result', {
        referrerId,
        updateSuccess: updateResult
      });

      this.logger.info('DEBUG: Awarding welcome bonus to new user', {
        newUserId,
        welcomeBonus,
        currentPoints: newUser.points || 0
      });

      const newUserPointsResult = await PointsService.awardPoints(
        newUserId,
        welcomeBonus,
        'Welcome bonus for joining via referral',
        PointEarningCategory.BONUS
      );

      this.logger.info('DEBUG: New user points awarded', {
        newUserId,
        success: newUserPointsResult.success,
        newBalance: newUserPointsResult.newBalance,
        error: newUserPointsResult.error
      });

      const referralRecord = {
        id: `ref_${Date.now()}_${referrerId}`,
        referrerId,
        referredUserId: newUserId,
        referralCode: referrer.referralCode,
        joinedAt: new Date(),
        bonusAwarded: bonus,
        isActive: true
      };

      this.logger.info('DEBUG: Saving referral record', { referralRecord });
      const recordSaved = await this.storage.saveReferralRecord(referralRecord);
      this.logger.info('DEBUG: Referral record save result', { success: recordSaved });

      try {
        if (!this.config.notifications.referrerNotification) {
          this.logger.debug('Referrer notification disabled by config');
        } else {
          const bot = this.botInstance || ReferralHandler.globalBotInstance;
          if (bot) {
            await bot.telegram.sendMessage(
              referrerId,
              '🎉 <b>New Referral!</b>\n\n' +
              `👤 ${newUser.firstName} joined using your code!\n` +
              `💰 You earned ${bonus} points\n` +
              `👥 Total Referrals: ${(referrer.totalReferrals || 0) + 1}\n\n` +
              'Keep sharing to earn more rewards!',
              { parse_mode: 'HTML' }
            );
            this.logger.info('DEBUG: Referrer notification sent successfully', { referrerId });
          } else {
            this.logger.warn('Bot instance not available - skipping referrer notification', { referrerId });
          }
        }
      } catch (error) {
        this.logger.error('Failed to notify referrer:', error);
      }

      this.logger.info('Referral bonus processed successfully', { referrerId, newUserId, bonus, welcomeBonus });

    } catch (error) {
      this.logger.error('Error processing referral bonus:', error);
    }
  }

  async handleCallback(ctx: Context): Promise<void> {
    const data = (ctx.callbackQuery as any)?.data as string | undefined;
    if (!data) return;

    const callbackData = CallbackQueryService.parseCallbackDataWithSession(ctx);

    if (callbackData.action && callbackData.sessionId) {
      await CallbackQueryService.handleCallbackWithSession(
        ctx,
        callbackData.sessionId,
        async (ctx, session) => {
          await this.handleSessionAction(ctx, session, callbackData);
        },
        '⏰ Referral action has expired. Please try again.'
      );
      return;
    }

    await this.handleLegacyCallback(ctx, data);
  }

  private async handleSessionAction(
    ctx: Context, 
    session: ActionSession, 
    callbackData: { action?: string; sessionId?: string; params?: string[] }
  ): Promise<void> {
    switch (callbackData.action) {
      case 'referral_generate_session':
        this.logger.debug('Processing referral code generation with session validation', {
          sessionId: session.id,
          userId: session.userId
        });
        await this.generateReferralCode(ctx);
        break;
      case 'referral_code_input_session':
        this.logger.debug('Processing referral code input with session validation', {
          sessionId: session.id,
          userId: session.userId
        });
        await (ctx as any).scene.enter('referral_input');
        break;
      default:
        this.logger.warn('Unknown session action:', callbackData.action);
        await CallbackQueryService.safeAnswerCallback(ctx, '❌ Unknown action');
    }
  }

  private async handleLegacyCallback(ctx: Context, data: string): Promise<void> {
    if (data === 'referral_show') {
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.showReferrals(ctx);
      }, true);
    } else if (data === 'referral_stats') {
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.showReferralStats(ctx);
      }, true);
    } else if (data === 'referral_generate') {
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.showGenerateReferralCodeConfirm(ctx);
      }, true);
    } else if (data === 'referral_share') {
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.showShareOptions(ctx);
      }, true);
    } else if (data === 'referral_code_input') {
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await (ctx as any).scene.enter('referral_input');
      }, true);
    } else if (data === 'referral_leaderboard') {
      await CallbackQueryService.handleRateLimitedCallback(ctx, async (ctx) => {
        await this.showReferralLeaderboard(ctx);
      }, 600);
    }
  }

  getReferralInputScene(): Scenes.BaseScene<any> {
    const scene = new Scenes.BaseScene<any>('referral_input');

    scene.enter(async (ctx) => {
      await ctx.reply(
        '🎫 <b>Enter Referral Code</b>\n\n' +
        'Please send the referral code you received from a friend:\n\n' +
        '📝 Format: 6-12 alphanumeric characters\n' +
        '⚠️ You can only use one referral code per account\n\n' +
        'Send /cancel to abort.',
        { parse_mode: 'HTML' }
      );
    });

    // Leave scene on navigation
    scene.action('referral_show', async (ctx: any) => {
      try { await ctx.answerCbQuery().catch(() => {}); } catch {}
      try { await ctx.scene.leave(); } catch {}
      await this.showReferrals(ctx);
    });
    scene.action('referral_stats', async (ctx: any) => {
      try { await ctx.answerCbQuery().catch(() => {}); } catch {}
      try { await ctx.scene.leave(); } catch {}
      await this.showReferralStats(ctx);
    });
    scene.action('referral_share', async (ctx: any) => {
      try { await ctx.answerCbQuery().catch(() => {}); } catch {}
      try { await ctx.scene.leave(); } catch {}
      await this.showShareOptions(ctx);
    });
    scene.action('referral_generate', async (ctx: any) => {
      try { await ctx.answerCbQuery().catch(() => {}); } catch {}
      try { await ctx.scene.leave(); } catch {}
      await this.showGenerateReferralCodeConfirm(ctx);
    });
    scene.action('menu_main', async (ctx: any) => {
      try { await ctx.answerCbQuery().catch(() => {}); } catch {}
      try { await ctx.scene.leave(); } catch {}
      const { MenuHandler } = await import('./menu-handler');
      await new MenuHandler().showMainMenu(ctx);
    });
    scene.action('menu_tasks', async (ctx: any) => {
      try { await ctx.answerCbQuery().catch(() => {}); } catch {}
      try { await ctx.scene.leave(); } catch {}
      const { TaskHandler } = await import('./task-handler');
      await new TaskHandler().showTasks(ctx);
    });

    scene.on('text', async (ctx) => {
      const code = ctx.message.text.trim();
      if (code === '/cancel') {
        await ctx.reply('❌ Referral code entry cancelled.');
        return ctx.scene.leave();
      }
      await this.processReferralCodeEntry(ctx, code);
      return ctx.scene.leave();
    });

    scene.command('cancel', async (ctx) => {
      await ctx.reply('❌ Referral code entry cancelled.');
      return ctx.scene.leave();
    });

    return scene;
  }

  private async processReferralCodeEntry(ctx: Context, code: string): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      const user = await this.storage.getUser(userId);
      if (!user) {
        await ctx.reply('❌ User not found.');
        return;
      }

      if (user.referredBy) {
        await ctx.reply('❌ You have already used a referral code.');
        return;
      }

      const validation = SecurityUtils.validateReferralCode(code);
      if (!validation.isValid) {
        await ctx.reply(`❌ Invalid referral code: ${validation.error}`);
        return;
      }

      let referrer = await this.storage.getUserByReferralCode(validation.sanitizedCode!);
      if (!referrer && /^\d+$/.test(validation.sanitizedCode!)) {
        const candidate = await this.storage.getUser(validation.sanitizedCode!);
        if (candidate && !this.hasLockedReferralCode(candidate)) {
          referrer = candidate;
        }
      }

      if (!referrer) {
        await ctx.reply('❌ Referral code not found or expired.');
        return;
      }

      if (referrer.telegramId === userId) {
        await ctx.reply('❌ You cannot use your own referral code.');
        return;
      }

      await this.storage.updateUser(userId, {
        referredBy: referrer.telegramId
      });

      await this.processReferralBonus(referrer.telegramId, userId);

      const welcomeBonus = this.config.bot.referralWelcomeBonusEnabled 
        ? this.config.bot.referralWelcomeBonus 
        : 0;
      
      await ctx.reply(
        '✅ <b>Referral Code Applied!</b>\n\n' +
        `👤 Referred by: ${referrer.firstName}\n` +
        (welcomeBonus > 0 ? `💰 Welcome bonus: ${welcomeBonus} points\n\n` : '\n') +
        '🎉 Thank you for joining through a referral!',
        { parse_mode: 'HTML' }
      );

    } catch (error) {
      this.logger.error('Error processing referral code entry:', error);
      await ctx.reply('❌ Error processing referral code. Please try again.');
    }
  }

  private async showShareOptions(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      // Always fetch fresh user data to ensure we have the latest referral code
      const user = await this.storage.getUser(userId);
      if (!user) {
        await ctx.reply('❌ User not found.');
        return;
      }

      const referralLink = this.buildReferralLink(user);

      const shareText =
        `🚀 Join the airdrop and earn points!\n\n` +
        `💰 Complete tasks and earn rewards\n` +
        `👥 Invite friends for bonus points\n` +
        `🎯 Connect wallet for future airdrops\n\n` +
        `Use my referral link: ${referralLink}`;

      const shareOptions: InlineKeyboardMarkup = {
        inline_keyboard: [
          [
            {
              text: 'Share via Telegram',
              url: `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent(shareText)}`
            }
          ],
          [
            { text: 'Back to Referrals', callback_data: 'referral_show' }
          ]
        ]
      };

      await ctx.reply(
        '📤 <b>Share Your Referral</b>\n\n' +
        `🔗 Your Link: <code>${referralLink}</code>`,
        {
          parse_mode: 'HTML',
          reply_markup: shareOptions
        }
      );

    } catch (error) {
      this.logger.error('Error showing share options:', error);
      await ctx.reply('❌ Error loading share options.');
    }
  }

  private async showReferralLeaderboard(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      const leaderboard = await LeaderboardService.generateReferralLeaderboardDetailed(10);
      const userRank = userId ? await LeaderboardService.getUserReferralRank(userId) : 0;

      const leaderboardTextBase = LeaderboardService.formatReferralLeaderboardDetailed(
        leaderboard,
        '🏆 Referral Leaderboard'
      );
      const rankLabel = userRank > 0 && userRank <= 100 ? `#${userRank}` : '#100+';
      const leaderboardText = userRank > 0
        ? `${leaderboardTextBase}\n\n📊 Your Rank: ${rankLabel}`
        : leaderboardTextBase;

      const keyboard: InlineKeyboardMarkup = {
        inline_keyboard: [
          [{ text: 'Refresh', callback_data: 'referral_leaderboard' }],
          [{ text: 'Back to Referrals', callback_data: 'referral_show' }]
        ]
      };

      await MessageService.editOrReply(ctx, leaderboardText, {
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });

    } catch (error) {
      this.logger.error('Error showing referral leaderboard:', error);
      await CallbackQueryService.safeAnswerCallback(ctx, '❌ Error loading leaderboard');
    }
  }

  private async getReferralData(userId: string): Promise<{
    referrals: any[];
    totalEarned: number;
    activeReferrals: number;
    recentReferrals: any[];
  }> {
    try {
      const sevenDaysAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      const recentReferrals = await this.storage.findByQuery<any>('users', { referredBy: userId }, {
        sort: { joinedAt: -1, registeredAt: -1 },
        limit: 5,
        projection: { firstName: 1, joinedAt: 1, registeredAt: 1, firstSeen: 1 }
      });

      const referrals = await this.storage.findByQuery<any>('users', { referredBy: userId }, {
        projection: { telegramId: 1, firstName: 1, lastActiveAt: 1, lastActivity: 1, lastActive: 1, joinedAt: 1, registeredAt: 1, firstSeen: 1 }
      });

      const totalEarned = referrals.length * this.config.bot.referralBonus;

      const activeReferrals = await this.storage.countDocuments('users', {
        referredBy: userId,
        $or: [
          { lastActiveAt: { $gte: sevenDaysAgoIso } },
          { lastActivity: { $gte: sevenDaysAgoIso } },
          { lastActive: { $gte: sevenDaysAgoIso } }
        ]
      });

      return { referrals, totalEarned, activeReferrals, recentReferrals };
    } catch (error) {
      this.logger.error('Error getting referral data:', error);
      return { referrals: [], totalEarned: 0, activeReferrals: 0, recentReferrals: [] };
    }
  }

  private async getReferralAnalytics(userId: string): Promise<any> {
    try {
      const referralData = await this.getReferralData(userId);
      const referrals = referralData.referrals;

      const totalReferrals = referrals.length;
      const activeReferrals = referralData.activeReferrals;
      const totalEarned = referralData.totalEarned;

      const monthlyData = this.calculateMonthlyReferrals(referrals);
      const qualityScore = this.calculateReferralQuality(referrals);

      return {
        userId,
        totalReferrals,
        activeReferrals,
        totalEarned,
        monthlyReferrals: monthlyData,
        averageReferralsPerMonth: this.calculateAverageReferralsPerMonth(referrals),
        qualityScore,
        topReferralDay: this.findTopReferralDay(referrals),
        generatedAt: new Date()
      };
    } catch (error) {
      this.logger.error('Error getting referral analytics:', error);
      throw error;
    }
  }

  private getReferralText(user: any, data: any): string {
    const referralLink = this.buildReferralLink(user);

    return `
👥 <b>Referral Program</b>

📊 <b>Your Statistics:</b>
👥 Total Referrals: <b>${user.totalReferrals || 0}</b>
⚡ Active Referrals: <b>${data.activeReferrals || 0}</b>
💰 Total Earned: <b>${data.totalEarned.toLocaleString()}</b> points

🔗 <b>Referral Link:</b>
<code>${referralLink}</code>

💡 <b>How it works:</b>
• Share your referral link with friends
• They join using your link
• You earn ${this.config.bot.referralBonus} points per referral
• They get a welcome bonus too!

🚀 <b>Referral Bonuses:</b>
• Each referral: <b>${this.config.bot.referralBonus}</b> points
${this.config.bot.referralWelcomeBonusEnabled 
  ? `• Their welcome bonus: <b>${this.config.bot.referralWelcomeBonus}</b> points\n`
  : ''}• Special milestone rewards available!

${data.recentReferrals.length > 0 
  ? `\n🆕 <b>Recent Referrals:</b>\n${data.recentReferrals.map((ref: any) => {
      const joinedAtDate = ref.joinedAt 
        ? (typeof ref.joinedAt === 'string' ? new Date(ref.joinedAt) : ref.joinedAt)
        : (ref.firstSeen 
            ? (typeof ref.firstSeen === 'string' ? new Date(ref.firstSeen) : ref.firstSeen)
            : new Date());
      return `• ${ref.firstName} (${joinedAtDate.toLocaleDateString()})`;
    }).join('\n')}`
  : '\n📝 No referrals yet. Start sharing to earn bonuses!'}
    `.trim();
  }

  private getReferralKeyboard(user: any): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: 'Statistics', callback_data: 'referral_stats' },
          { text: 'New Code', callback_data: 'referral_generate' }
        ],
        [
          { text: 'Leaderboard', callback_data: 'referral_leaderboard' }
        ],
        [
          { text: 'Main Menu', callback_data: 'menu_main' }
        ]
      ]
    };
  }

  private getReferralStatsText(analytics: any): string {
    return `
📊 <b>Detailed Referral Statistics</b>

📈 <b>Overview:</b>
👥 Total Referrals: <b>${analytics.totalReferrals}</b>
⚡ Active Referrals: <b>${analytics.activeReferrals}</b>
💰 Total Earned: <b>${analytics.totalEarned.toLocaleString()}</b> points
⭐ Quality Score: <b>${(analytics.qualityScore * 100).toFixed(1)}%</b>

📅 <b>Monthly Performance:</b>
📊 Average per Month: <b>${analytics.averageReferralsPerMonth.toFixed(1)}</b>
🔥 Best Day: <b>${analytics.topReferralDay?.date || 'N/A'}</b> (${analytics.topReferralDay?.count || 0} referrals)

${analytics.monthlyReferrals.length > 0 
  ? `\n📆 <b>Recent Months:</b>\n${analytics.monthlyReferrals.slice(0, 3).map((m: { month: number; year: number; count: number }) => `• ${m.month}/${m.year}: ${m.count} referrals`).join('\n')}`
  : ''}

🎯 <b>Tips to Improve:</b>
• Share in multiple social platforms
• Explain the benefits clearly
• Follow up with friends
• Share during peak hours

💎 <b>Milestone Rewards:</b>
• 10 referrals: ${this.config.bot.referralBonus * 2} bonus points
• 25 referrals: ${this.config.bot.referralBonus * 5} bonus points
• 50 referrals: ${this.config.bot.referralBonus * 10} bonus points
    `.trim();
  }

  private getReferralStatsKeyboard(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: 'Share Now', callback_data: 'referral_share' },
          { text: 'Leaderboard', callback_data: 'referral_leaderboard' }
        ],
        [
          { text: 'Back to Referrals', callback_data: 'referral_show' }
        ]
      ]
    };
  }

  private async generateUniqueReferralCode(): Promise<string> {
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      const code = SecurityUtils.generateSecureToken(this.config.referral.codeLength || 8).toUpperCase();
      const existingUser = await this.storage.getUserByReferralCode(code);
      if (!existingUser) return code;
      attempts++;
    }
    const timestamp = Date.now().toString(36).toUpperCase();
    return `REF${timestamp}`;
  }

  private calculateMonthlyReferrals(referrals: any[]): Array<{ month: number; year: number; count: number }> {
    const monthlyData = new Map<string, number>();

    referrals.forEach(referral => {
      const joinedAtDate = referral.joinedAt 
        ? (typeof referral.joinedAt === 'string' ? new Date(referral.joinedAt) : referral.joinedAt)
        : (referral.firstSeen 
            ? (typeof referral.firstSeen === 'string' ? new Date(referral.firstSeen) : referral.firstSeen)
            : new Date());
      const key = `${joinedAtDate.getFullYear()}-${joinedAtDate.getMonth()}`;
      monthlyData.set(key, (monthlyData.get(key) || 0) + 1);
    });

    return Array.from(monthlyData.entries())
      .map(([key, count]) => {
        const [year, month] = key.split('-').map(Number);
        return { month: month + 1, year, count };
      })
      .sort((a, b) => b.year - a.year || b.month - a.month);
  }

  private calculateAverageReferralsPerMonth(referrals: any[]): number {
    if (!referrals || referrals.length === 0) return 0;

    const firstReferralDate = referrals.reduce((earliest: Date, r: any) => {
      const d = r.joinedAt
        ? (typeof r.joinedAt === 'string' ? new Date(r.joinedAt) : r.joinedAt)
        : (r.firstSeen
            ? (typeof r.firstSeen === 'string' ? new Date(r.firstSeen) : r.firstSeen)
            : new Date());
      return d < earliest ? d : earliest;
    }, new Date());

    const months = Math.max(1, (Date.now() - firstReferralDate.getTime()) / (1000 * 60 * 60 * 24 * 30));
    return referrals.length / months;
  }

  private calculateReferralQuality(referrals: any[]): number {
    if (referrals.length === 0) return 0;
    let qualityScore = 0;

    referrals.forEach(referral => {
      qualityScore += 0.3;
      if (referral.points > 0) qualityScore += 0.3;
      try {
        const lastActiveDate = referral.lastActive 
          ? (typeof referral.lastActive === 'string' ? new Date(referral.lastActive) : referral.lastActive)
          : (referral.lastActivity 
              ? (typeof referral.lastActivity === 'string' ? new Date(referral.lastActivity) : referral.lastActivity)
              : new Date(0));
        const daysSinceActive = (Date.now() - lastActiveDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSinceActive <= 7) qualityScore += 0.4;
      } catch {}
    });

    return Math.min(qualityScore / referrals.length, 1.0);
  }

  private findTopReferralDay(referrals: any[]): { date: string; count: number } | null {
    if (referrals.length === 0) return null;

    const dailyCount = new Map<string, number>();
    referrals.forEach(referral => {
      const date = new Date(referral.joinedAt || referral.firstSeen || Date.now()).toDateString();
      dailyCount.set(date, (dailyCount.get(date) || 0) + 1);
    });

    let topDate = '';
    let topCount = 0;
    for (const [date, count] of dailyCount.entries()) {
      if (count > topCount) { topCount = count; topDate = date; }
    }

    return topCount > 0 ? { date: topDate, count: topCount } : null;
  }
}