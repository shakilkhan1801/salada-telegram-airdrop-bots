import { Context } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { Logger } from '../../services/logger';
import { StorageManager } from '../../storage';
import { getConfig } from '../../config';
import { TaskHandler } from './task-handler';
import { WalletConnectService } from '../../services/walletconnect.service';
import { 
  UserValidationService, 
  CallbackQueryService, 
  MessageService,
  DateUtils,
  LeaderboardService,
  LeaderboardType,
  PointsService
} from '../../shared';

export class MenuHandler {
  private readonly logger = Logger.getInstance();
  private readonly storage = StorageManager.getInstance();
  private readonly config = getConfig();

  private buildReferralLink(user: any): string {
    const botUsername = this.config.bot.username;
    const locked = !!(user?.metadata?.customFields?.referralCodeLocked) && typeof user.referralCode === 'string' && user.referralCode.length > 0;
    return locked ? `https://t.me/${botUsername}?start=${user.referralCode}` : `https://t.me/${botUsername}?start=${user.telegramId || user.id}`;
  }

  /**
   * Show main menu with all available options
   */
  async showMainMenu(ctx: Context): Promise<void> {
    try {
      const user = await UserValidationService.validateUser(ctx);
      if (!user) return;

      // Always fetch fresh user data to ensure we have the latest referral code
      const freshUser = await this.storage.getUser(user.telegramId) || user;
      
      // Derive wallet connection display based on active WalletConnect session
      let displayUser = freshUser;
      try {
        const userId = freshUser.telegramId;
        const connections = await this.storage.getWalletConnections(userId);
        const wcConn = connections.find((c: any) => c.walletConnectSession);
        if (wcConn && wcConn.walletConnectSession) {
          const now = Date.now();
          const expiresAt = wcConn.expiresAt ? new Date(wcConn.expiresAt).getTime() : 0;
          const wcActive = WalletConnectService.getInstance().isSessionActive(wcConn.walletConnectSession.topic);
          const isActive = wcConn.isActive && wcActive && expiresAt > now;
          if (!isActive) {
            displayUser = { ...freshUser, walletAddress: undefined };
          }
        }
      } catch {}

      const menuText = this.getMainMenuText(displayUser);
      const keyboard = this.getMainMenuKeyboard();

      await MessageService.editOrReply(ctx, menuText, {
        reply_markup: keyboard,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true }
      });

    } catch (error) {
      this.logger.error('Error showing main menu:', error);
      await ctx.reply('❌ Error loading menu. Please try again.');
    }
  }

  /**
   * Show help information
   */
  async showHelp(ctx: Context): Promise<void> {
    try {
      const helpText = this.getHelpText();
      const keyboard = this.getHelpKeyboard();

      await ctx.reply(helpText, {
        reply_markup: keyboard,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true }
      });

    } catch (error) {
      this.logger.error('Error showing help:', error);
      await ctx.reply('❌ Error loading help. Please try again.');
    }
  }

  /**
   * Show user profile and statistics
   */
  async showProfile(ctx: Context): Promise<void> {
    try {
      const user = await UserValidationService.validateUser(ctx);
      if (!user) return;

      // Always fetch fresh user data to ensure we have the latest referral code
      const freshUser = await this.storage.getUser(user.telegramId) || user;
      
      const stats = await PointsService.getUserPointStats(freshUser.telegramId);
      const profileText = this.getProfileText(freshUser, stats);
      const keyboard = this.getProfileKeyboard();

      await MessageService.editOrReply(ctx, profileText, {
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });

    } catch (error) {
      this.logger.error('Error showing profile:', error);
      await ctx.reply('❌ Error loading profile. Please try again.');
    }
  }

  /**
   * Show leaderboard
   */
  async showLeaderboard(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      const leaderboard = await LeaderboardService.generatePointsLeaderboardDetailed(10);
      const userRank = await LeaderboardService.getUserPointsRank(userId);

      const leaderboardTextBase = LeaderboardService.formatPointsLeaderboardDetailed(
        leaderboard,
        '🏆 Leaderboard - Top 10'
      );
      const rankLabel = userRank > 0 && userRank <= 100 ? `#${userRank}` : '#100+';
      const leaderboardText = userRank > 0
        ? `${leaderboardTextBase}\n\n📊 Your Rank: ${rankLabel}`
        : leaderboardTextBase;
      const keyboard = this.getLeaderboardKeyboard();

      await MessageService.editOrReply(ctx, leaderboardText, {
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });

    } catch (error) {
      this.logger.error('Error showing leaderboard:', error);
      await ctx.reply('❌ Error loading leaderboard. Please try again.');
    }
  }

  /**
   * Show support system
   */
  async showSupport(ctx: Context): Promise<void> {
    try {
      const user = await UserValidationService.validateUser(ctx);
      if (!user) return;

      const supportText = this.getSupportText(user);
      const keyboard = this.getSupportKeyboard(user);

      await MessageService.editOrReply(ctx, supportText, {
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });

    } catch (error) {
      this.logger.error('Error showing support:', error);
      await ctx.reply('❌ Error loading support system. Please try again.');
    }
  }

  /**
   * Handle callback queries for menu navigation
   */
  async handleCallback(ctx: Context): Promise<void> {
    const data = CallbackQueryService.getCallbackData(ctx);
    if (!data) return;

    switch (data) {
      case 'menu_main':
        await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
          await this.showMainMenu(ctx);
        }, true);
        break;
      case 'menu_tasks':
        {
          const taskHandler = new TaskHandler();
          await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
            await taskHandler.showTasks(ctx);
          }, true);
        }
        break;
      case 'menu_profile':
        await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
          await this.showProfile(ctx);
        }, true);
        break;
      case 'menu_leaderboard':
        await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
          await this.showLeaderboard(ctx);
        }, true);
        break;
      case 'menu_support':
        await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
          try {
            const userId = ctx.from?.id?.toString();
            if (userId) {
              await this.storage.delete('ticket_creation', userId);
            }
          } catch {}
          await this.showSupport(ctx);
        }, true);
        break;
      case 'support_create_ticket':
        await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
          await this.createSupportTicket(ctx);
        }, true);
        break;
      case 'support_ticket_cat_account':
      case 'support_ticket_cat_technical':
      case 'support_ticket_cat_ban':
      case 'support_ticket_cat_business':
        await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
          const data = CallbackQueryService.getCallbackData(ctx) || '';
          const category = data.replace('support_ticket_cat_', '');
          await this.startTicketForCategory(ctx, category);
        }, true);
        break;
      case 'menu_help':
        await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
          await this.showHelp(ctx);
        }, true);
        break;
      case 'menu_close':
        await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
          await this.closeMenu(ctx);
        }, true);
        break;
      default:
        this.logger.warn('Unknown menu callback:', data);
    }
  }

  private getMainMenuText(user: any): string {
    const joinedAtDate = DateUtils.parseUserJoinDate(user);
    const daysSinceJoin = DateUtils.calculateDaysSince(joinedAtDate);

    const withdrawThreshold = this.config.points?.minWithdraw || this.config.bot?.minWithdrawal || 0;
    const currentPoints = user.points || 0;
    const toGoal = Math.max(0, withdrawThreshold - currentPoints);

    const progressPct = withdrawThreshold > 0 ? Math.min(1, currentPoints / withdrawThreshold) : 1;
    const blocks = 5; // 100% represented by 5 emoji blocks
    const filled = Math.max(0, Math.min(blocks, Math.round(progressPct * blocks)));
    const emojiBar = '🟩'.repeat(filled) + '⬜'.repeat(blocks - filled);
    const pct = Math.round(progressPct * 100);

    const tokenRate = (this.config.points?.conversionRate ?? this.config.bot?.pointToTokenRatio ?? 0) as number;
    const tokenSymbol = this.config.wallet?.tokenSymbol || 'TOKEN';
    const tokenEst = tokenRate ? (currentPoints * tokenRate) : 0;

    const walletConnected = user.walletAddress 
      ? `✅ ${user.walletName || user.peerName || 'WalletConnect'}` 
      : '❌ Not Connected';
    const accountStatus = (user.isActive !== false) ? '✅ Active' : '❌ Inactive';

    const referralLink = this.buildReferralLink(user);

    return `
🚀 <b>Welcome, ${user.firstName}!</b>

💰 <b>Account Overview</b>
💎 Balance: <b>${currentPoints.toLocaleString()}</b> points  
👥 Referrals Earned: <b>${user.totalReferrals || 0}</b>  
📅 Member Since: <b>${daysSinceJoin}</b> ${daysSinceJoin === 1 ? 'day' : 'days'}  
✅ Tasks Completed: <b>${(user.completedTasks?.length || 0) + Object.keys(user.dailyTasksCompleted || {}).length}</b>  
🔐 Account Status: <b>${accountStatus}</b>  
👛 Wallet: <b>${walletConnected}</b>

🎯 <b>Withdrawal Progress</b>
🎁 Goal: <b>${withdrawThreshold.toLocaleString()}</b> points  
🔄 Remaining: <b>${toGoal.toLocaleString()}</b> points  
📊 Progress: ${emojiBar} <b>${pct}%</b>  

💎 <b>Token Value</b>
✨ <b>${currentPoints.toLocaleString()}</b> pts ≈ <b>${tokenEst.toFixed(4)} ${tokenSymbol}</b>  
${tokenRate > 0 ? `📈 Rate: <b>1 pt = ${tokenRate} ${tokenSymbol}</b>` : ''} 

🔗 <b>Your Referral</b>
📎 Link: <code>${referralLink}</code> 

<i>💡 Tip: Complete tasks, invite friends, and connect your wallet to maximize your earnings!</i>
`.trim();
 }

  private getMainMenuKeyboard(): InlineKeyboardMarkup {
    const keyboard = [
      [
        { text: 'Tasks', callback_data: 'menu_tasks' },
        { text: 'Points', callback_data: 'points_show' }
      ],
      [
        { text: 'Wallet', callback_data: 'wallet_show' },
        { text: 'Referrals', callback_data: 'referral_show' }
      ],
      [
        { text: 'Profile', callback_data: 'menu_profile' },
        { text: 'Leaderboard', callback_data: 'menu_leaderboard' }
      ],
      [
        { text: 'Support', callback_data: 'menu_support' },
        { text: 'Help', callback_data: 'menu_help' }
      ]
    ];
    
    // Mini App functionality removed
    
    return {
      inline_keyboard: keyboard
    };
  }

  private getHelpText(): string {
    const withdrawChannel = this.config.bot.withdrawAlertChannelId 
      ? `${this.config.bot.withdrawAlertChannelId}` 
      : 'Coming soon';
    
    return `
❓ <b>Help & Information</b>

<b>🎯 What is Salada Protocol?</b>
Earn points by completing tasks and referring friends. Convert your points to tokens and withdraw them to your wallet.

<b>💰 How to Earn?</b>
• Complete tasks: ${this.config.bot.dailyBonus}+ points daily
• Refer friends: ${this.config.bot.referralBonus} points per referral
• Special events & bonuses

<b>👛 Withdraw Tokens?</b>
1. Connect your wallet
2. Reach minimum threshold
3. Click withdraw - tokens sent automatically on blockchain

<b>🔒 Security</b>
• One wallet per user (wallet lock)
• Multi-account detection
• Your keys stay in your wallet

<b>🔗 Quick Commands</b>
/menu - Main menu
/tasks - Available tasks
/wallet - Wallet & withdrawals
/referrals - Referral stats

<b>📞 Support & Links</b>
Contact: ${this.config.bot.supportUsername || '@support'}
Website: ${this.config.bot.website || 'https://app.salada.fun'}
Tracker: ${withdrawChannel}

<i>💡 Tip: Invite friends to earn faster!</i>
    `.trim();
  }

  private getHelpKeyboard(): InlineKeyboardMarkup {
    const keyboard: any[][] = [
      [{ text: 'Main Menu', callback_data: 'menu_main' }]
    ];

    // Add support button if username is configured
    if (this.config.bot.supportUsername) {
      keyboard.unshift([
        { text: 'Contact Support', url: `https://t.me/${this.config.bot.supportUsername}` }
      ]);
    }

    // Add website button if configured
    if (this.config.bot.website) {
      keyboard.unshift([
        { text: 'Visit Website', url: this.config.bot.website }
      ]);
    }

    return { inline_keyboard: keyboard };
  }

  private getProfileText(user: any, stats: any): string {
    const joinedAtDate = DateUtils.parseUserJoinDate(user);
    const lastActiveDate = DateUtils.parseUserDate(user.lastActive || user.lastActivity || new Date());
    const joinDate = DateUtils.formatUserDate(joinedAtDate);
    const lastActive = DateUtils.formatUserDate(lastActiveDate);

    const totalEarned = (stats?.totalEarned ?? 0);
    const tasksCompleted = (user.completedTasks?.length || 0) + Object.keys(user.dailyTasksCompleted || {}).length;

    return `
👤 <b>Your Profile</b>

<b>📋 Basic Info:</b>
• Name: ${user.firstName || 'Not set'} ${user.lastName || ''}
• Username: ${user.username ? '@' + user.username : 'Not set'}
• User ID: <code>${user.telegramId || 'Unknown'}</code>

<b>📊 Statistics:</b>
• Current Points: <b>${(user.points || 0).toLocaleString()}</b>
• Total Earned: <b>${(totalEarned || 0).toLocaleString()}</b>
• Tasks Completed: <b>${tasksCompleted}</b>
• Total Referrals: <b>${user.totalReferrals || 0}</b>

<b>📅 Activity:</b>
• Joined: ${joinDate || 'Unknown'}
• Last Active: ${lastActive || 'Unknown'}
• Account Status: ${(user.isActive !== false) ? '✅ Active' : '❌ Inactive'}

<b>🎫 Referral Info:</b>
• Referral Link: <code>${this.buildReferralLink(user)}</code>
• Referred By: ${user.referredBy ? 'Yes' : 'No'}

<b>👛 Wallet:</b>
• Connected: ${user.walletAddress ? '✅ Yes' : '❌ No'}
${user.walletAddress ? `• Address: <code>${user.walletAddress.substring(0, 10)}...${user.walletAddress.substring(-8)}</code>` : ''}
    `.trim();
  }

  private getProfileKeyboard(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: 'View Tasks', callback_data: 'menu_tasks' },
          { text: 'My Referrals', callback_data: 'referral_show' }
        ],
        [
          { text: 'Wallet Settings', callback_data: 'wallet_show' },
          { text: 'Detailed Stats', callback_data: 'points_stats' }
        ],
        [
          { text: 'Main Menu', callback_data: 'menu_main' }
        ]
      ]
    };
  }



  private getLeaderboardKeyboard(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: 'Refresh', callback_data: 'menu_leaderboard' },
          { text: 'My Profile', callback_data: 'menu_profile' }
        ],
        [
          { text: 'Main Menu', callback_data: 'menu_main' }
        ]
      ]
    };
  }

  private getTicketCategories(): Array<{ code: string; label: string }> {
    return [
      { code: 'technical', label: 'Bot Technical Issues (bugs/errors)' },
      { code: 'ban', label: 'Multi-Account or Ban Related' },
      { code: 'business', label: 'Business & Project Requests' }
    ];
  }

  private getCategoryLabel(code: string): string {
    const found = this.getTicketCategories().find(c => c.code === code);
    return found ? found.label : code;
  }

  private getCategorySelectionKeyboard(): InlineKeyboardMarkup {
    const rows = this.getTicketCategories().map(c => ([{ text: c.label, callback_data: `support_ticket_cat_${c.code}` }]));
    rows.push([{ text: 'Cancel', callback_data: 'menu_support' }]);
    return { inline_keyboard: rows };
  }

  private async startTicketForCategory(ctx: Context, category: string): Promise<void> {
    try {
      const user = await UserValidationService.validateUser(ctx);
      if (!user) return;

      const canCreate = await this.checkDailyTicketLimitByCategory(user.telegramId, category);
      if (!canCreate) {
        await ctx.reply(`⏰ You can only create 1 ticket per day for this category ("${this.getCategoryLabel(category)}"). Please try again tomorrow.`);
        return;
      }

      await this.storage.set('ticket_creation', {
        userId: user.telegramId,
        startedAt: new Date(),
        category,
        categoryLabel: this.getCategoryLabel(category)
      }, user.telegramId);

      const categoryDescriptions: Record<string, string> = {
        'technical': '🛠️ Technical issues, bugs, errors, or performance problems',
        'ban': '⚠️ Account restrictions, ban appeals, or policy violation concerns', 
        'business': '💼 Bot purchase inquiries, partnerships, collaborations, or custom development requests'
      };

      const categoryDesc = categoryDescriptions[category] || '';

      await ctx.reply(
        '🎫 <b>Create Support Ticket</b>\n\n' +
        `📂 <b>Category:</b> ${this.getCategoryLabel(category)}\n` +
        `${categoryDesc}\n\n` +
        '📝 <b>Describe your request with details:</b>\n' +
        '• Be specific about your issue or request\n' +
        '• Include relevant information or screenshots if needed\n\n' +
        '📤 <b>Send your message:</b>',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [[{ text: 'Cancel', callback_data: 'menu_support' }]]
          }
        }
      );
    } catch (error) {
      this.logger.error('Error starting ticket for category:', error);
      await ctx.reply('❌ Error starting ticket. Please try again.');
    }
  }

  /**
   * Create support ticket
   */
  async createSupportTicket(ctx: Context): Promise<void> {
    try {
      const user = await UserValidationService.validateUser(ctx);
      if (!user) return;

      await ctx.reply(
        '🎫 <b>Create Support Ticket</b>\n\n' +
        'Please select a category for your ticket:\n\n' +
        '1️⃣ <b>Bot Technical Issues</b>\n' +
        '   🛠️ Bugs, errors, crashes, performance problems\n\n' +
        '2️⃣ <b>Multi-Account or Ban Related</b>\n' +
        '   ⚠️ Account restrictions, ban appeals, policy violations\n\n' +
        '3️⃣ <b>Business & Project Requests</b>\n' +
        '   💼 Bot purchase, partnerships, collaborations, custom development',
        {
          parse_mode: 'HTML',
          reply_markup: this.getCategorySelectionKeyboard()
        }
      );
    } catch (error) {
      this.logger.error('Error creating support ticket:', error);
      await ctx.reply('❌ Error creating support ticket. Please try again.');
    }
  }

  /**
   * Handle ticket message submission
   */
  async handleTicketMessage(ctx: Context, message: string): Promise<void> {
    try {
      const user = await UserValidationService.validateUser(ctx);
      if (!user) return;

      const ticketData = await this.storage.get<{ userId: string; startedAt: any; category?: string; categoryLabel?: string }>('ticket_creation', user.telegramId);
      if (!ticketData) {
        return; // User not in ticket creation mode
      }

      const category = (ticketData.category as string) || 'general';
      const categoryLabel = this.getCategoryLabel(category);

      const canCreate = await this.checkDailyTicketLimitByCategory(user.telegramId, category);
      if (!canCreate) {
        await ctx.reply(`⏰ You have already created a ticket today for the category "${categoryLabel}". Please try again tomorrow.`);
        await this.storage.delete('ticket_creation', user.telegramId);
        return;
      }

      // Create ticket
      const ticket = {
        id: `ticket_${category}_${user.telegramId}_${Date.now()}`,
        userId: user.telegramId,
        username: user.username || 'Unknown',
        firstName: user.firstName || 'User',
        message: message.trim(),
        status: 'open',
        createdAt: new Date(),
        type: 'support_ticket',
        category,
        categoryLabel
      };

      await this.saveTicketToStorage(ticket);

      await this.storage.delete('ticket_creation', user.telegramId);

      await this.incrementDailyTicketCount(user.telegramId, category);

      await ctx.reply(
        '✅ <b>Support Ticket Created</b>\n\n' +
        `🎫 Ticket ID: <code>${ticket.id}</code>\n` +
        `📂 Category: <b>${categoryLabel}</b>\n` +
        '📧 Message: Your request has been submitted successfully.\n\n' +
        '⏰ Our support team will review your ticket and respond soon.',
        { parse_mode: 'HTML' }
      );

      await this.showSupport(ctx);

    } catch (error) {
      this.logger.error('Error handling ticket message:', error);
      await ctx.reply('❌ Error submitting your ticket. Please try again.');
    }
  }

  private async checkDailyTicketLimitByCategory(userId: string, category: string): Promise<boolean> {
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const query = { type: 'support_ticket', userId, category, createdAt: { $gte: cutoff } } as any;
      const storageAny = this.storage as any;
      const count = typeof storageAny.count === 'function'
        ? await storageAny.count('messages', query)
        : (typeof storageAny.countDocuments === 'function' ? await storageAny.countDocuments('messages', query) : 0);
      return (count || 0) === 0;
    } catch (error) {
      this.logger.error('Error checking daily ticket limit by category:', error);
      return true; // Allow in case of error
    }
  }

  private async incrementDailyTicketCount(userId: string, category: string): Promise<void> {
    try {
      const today = new Date().toISOString().split('T')[0];
      const collection = 'daily_ticket_counters';
      const id = `${category}_${userId}_${today}`;
      const existing = (await this.storage.get(collection, id) as { count: number } | null) || { count: 0 };
      const updated = { ...existing, count: (existing.count || 0) + 1 } as any;
      await this.storage.set(collection, updated, id);
    } catch (error) {
      this.logger.error('Error incrementing daily ticket count:', error);
    }
  }

  private async saveTicketToStorage(ticket: any): Promise<void> {
    try {
      await this.storage.set('messages', ticket, ticket.id);

      this.logger.info('Support ticket saved:', {
        ticketId: ticket.id,
        userId: ticket.userId,
        messageLength: ticket.message.length
      });
    } catch (error) {
      this.logger.error('Error saving ticket to storage:', error);
      throw error;
    }
  }

  private getSupportText(user: any): string {
    return `
💬 <b>Support Center</b>

Welcome to our support system! We're here to help you with any questions or issues.

👤 <b>Your Account:</b>
• User ID: ${user.telegramId}
• Username: ${user.username || 'Not set'}
• Status: Active

🎫 <b>Support Options:</b>
• Create a support ticket (1 per category per day)
• Get help with common issues
• Report bugs or problems

⏰ <b>Response Time:</b>
Our team typically responds within 24 hours.
    `.trim();
  }

  private getSupportKeyboard(user: any): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: 'Create Ticket', callback_data: 'support_create_ticket' }
        ],
        [
          { text: 'FAQ', callback_data: 'menu_help' },
          { text: 'Refresh', callback_data: 'menu_support' }
        ],
        [
          { text: 'Main Menu', callback_data: 'menu_main' }
        ]
      ]
    };
  }

  private async getRecentAnnouncements(): Promise<any[]> {
    // Deprecated - kept for backward compatibility
    return [];
  }

  private getAnnouncementText(announcements: any[]): string {
    // Deprecated - kept for backward compatibility
    return 'Support system active.';
  }

  private getAnnouncementKeyboard(): InlineKeyboardMarkup {
    // Deprecated - kept for backward compatibility
    return {
      inline_keyboard: [
        [{ text: 'Main Menu', callback_data: 'menu_main' }]
      ]
    };
  }

  private async closeMenu(ctx: Context): Promise<void> {
    try {
      if (ctx.callbackQuery && ctx.callbackQuery.message) {
        await ctx.deleteMessage();
      }
    } catch (error) {
      // Ignore deletion errors (message might be too old)
      this.logger.debug('Could not delete menu message:', error);
    }
  }
}