import { Context, MiddlewareFn } from 'telegraf';
import { Logger } from '../../services/logger';
import { getConfig } from '../../config';

export interface MaintenanceStatus {
  isMaintenanceMode: boolean;
  isBotOffline: boolean;
  expectedDuration?: string;
  reason?: string;
  supportUsername?: string;
}

export class MaintenanceMiddleware {
  private static instance: MaintenanceMiddleware;
  private readonly logger = Logger.getInstance();
  private readonly config = getConfig();
  private lastMaintenanceStatus: boolean = false;
  private lastBotStatus: boolean = true;

  private constructor() {}

  static getInstance(): MaintenanceMiddleware {
    if (!MaintenanceMiddleware.instance) {
      MaintenanceMiddleware.instance = new MaintenanceMiddleware();
    }
    return MaintenanceMiddleware.instance;
  }

  /**
   * Create middleware function for Telegraf
   */
  create(): MiddlewareFn<Context> {
    return async (ctx: Context, next: () => Promise<void>) => {
      const userId = ctx.from?.id?.toString();
      
      // Skip checks for admin users
      if (this.isAdminUser(userId)) {
        return next();
      }

      try {
        // Check for maintenance mode changes and notify if needed
        await this.checkMaintenanceModeChange(ctx);
        
        // Check if bot is turned off
        if (!this.isBotOnline()) {
          await this.sendBotOfflineMessage(ctx);
          return; // Stop processing
        }
        
        // Check if maintenance mode is on
        if (this.isMaintenanceMode()) {
          await this.sendMaintenanceMessage(ctx);
          return; // Stop processing
        }
        
        // All checks passed, proceed
        return next();
      } catch (error) {
        this.logger.error(`Error in maintenance middleware for user ${userId}:`, error);
        // On error, allow request to proceed to avoid blocking all users
        return next();
      }
    };
  }

  /**
   * Check if user is an admin
   */
  private isAdminUser(userId?: string): boolean {
    if (!userId) return false;
    
    const adminIds = this.getAdminIds();
    return adminIds.includes(userId);
  }

  /**
   * Get admin user IDs from config
   */
  private getAdminIds(): string[] {
    const adminIdsStr = process.env.ADMIN_USER_IDS || '';
    return adminIdsStr.split(',').map(id => id.trim()).filter(id => id.length > 0);
  }

  /**
   * Check if bot is online
   */
  private isBotOnline(): boolean {
    return process.env.BOT_STATUS === 'true';
  }

  /**
   * Check if maintenance mode is active
   */
  private isMaintenanceMode(): boolean {
    return process.env.MAINTENANCE_MODE === 'true';
  }

  /**
   * Check for maintenance mode changes and notify users
   */
  private async checkMaintenanceModeChange(ctx: Context): Promise<void> {
    try {
      const currentMaintenanceMode = this.isMaintenanceMode();
      const currentBotStatus = this.isBotOnline();

      // Check for maintenance mode status change
      if (this.lastMaintenanceStatus !== currentMaintenanceMode) {
        this.lastMaintenanceStatus = currentMaintenanceMode;
        
        if (currentMaintenanceMode) {
          this.logger.info('🔧 Maintenance mode activated');
        } else {
          this.logger.info('✅ Maintenance mode deactivated');
          // Could potentially notify users that maintenance is over
        }
      }

      // Check for bot status change
      if (this.lastBotStatus !== currentBotStatus) {
        this.lastBotStatus = currentBotStatus;
        
        if (currentBotStatus) {
          this.logger.info('✅ Bot status restored to online');
        } else {
          this.logger.info('🚫 Bot status changed to offline');
        }
      }
    } catch (error) {
      this.logger.error('Error checking maintenance mode change:', error);
    }
  }

  /**
   * Send bot offline message to user
   */
  private async sendBotOfflineMessage(ctx: Context): Promise<void> {
    try {
      const supportUsername = process.env.SUPPORT_USERNAME || 'support';
      const customMessage = process.env.BOT_OFFLINE_MESSAGE;
      const customReason = process.env.BOT_OFFLINE_REASON || 'Administrative maintenance';
      
      const message = customMessage || (
        '🚫 <b>Bot Service Temporarily Unavailable</b>\n\n' +
        'Our bot service is currently offline for maintenance and improvements.\n\n' +
        `🔧 <b>Reason:</b> ${customReason}\n` +
        '⏰ <b>Status:</b> Temporarily disabled\n\n' +
        '✨ We\'re working hard to bring you a better experience!\n' +
        '📱 Please check back in a little while.\n\n' +
        '❓ Have questions? Contact our support team below.'
      );
      
      await ctx.reply(message, { 
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📞 Contact Support', url: `https://t.me/${supportUsername}` }],
            [{ text: '🔄 Try Again', callback_data: 'refresh_status' }]
          ]
        }
      });
      
      this.logger.info(`Bot offline message sent to user ${ctx.from?.id}`);
    } catch (error) {
      this.logger.error('Failed to send bot offline message:', error);
    }
  }

  /**
   * Send maintenance mode message to user
   */
  private async sendMaintenanceMessage(ctx: Context): Promise<void> {
    try {
      const supportUsername = process.env.SUPPORT_USERNAME || 'support';
      const expectedDuration = process.env.MAINTENANCE_DURATION || '15-30 minutes';
      const customMessage = process.env.MAINTENANCE_MESSAGE;
      const maintenanceReason = process.env.MAINTENANCE_REASON || 'System improvements and bug fixes';
      
      const message = customMessage || (
        '🔧 <b>Maintenance Mode - We\'ll Be Right Back!</b>\n\n' +
        '🚧 Our bot is currently undergoing scheduled maintenance to serve you better.\n\n' +
        `⏰ <b>Expected Duration:</b> ${expectedDuration}\n` +
        `🛠 <b>What we\'re doing:</b> ${maintenanceReason}\n\n` +
        '✨ <b>What\'s coming:</b>\n' +
        '• Enhanced performance\n' +
        '• New features and improvements\n' +
        '• Bug fixes and optimizations\n\n' +
        '😊 Thank you for your patience! We\'ll be back online shortly.\n\n' +
        '🚨 <b>Urgent matters?</b> Contact our support team below.'
      );
      
      await ctx.reply(message, { 
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [{ text: '📞 Contact Support', url: `https://t.me/${supportUsername}` }],
            [{ text: '🔔 Get Notified', callback_data: 'notify_maintenance' }],
            [{ text: '🔄 Check Status', callback_data: 'check_maintenance_status' }]
          ]
        }
      });
      
      this.logger.info(`Maintenance message sent to user ${ctx.from?.id}`);
    } catch (error) {
      this.logger.error('Failed to send maintenance message:', error);
    }
  }

  /**
   * Get current maintenance status
   */
  getMaintenanceStatus(): MaintenanceStatus {
    return {
      isMaintenanceMode: this.isMaintenanceMode(),
      isBotOffline: !this.isBotOnline(),
      expectedDuration: process.env.MAINTENANCE_DURATION,
      reason: process.env.MAINTENANCE_REASON,
      supportUsername: process.env.SUPPORT_USERNAME
    };
  }

  /**
   * Set maintenance mode
   */
  async setMaintenanceMode(enabled: boolean, duration?: string, reason?: string): Promise<void> {
    try {
      // Note: In a production environment, you'd want to update the .env file
      // or use a configuration management system
      process.env.MAINTENANCE_MODE = enabled ? 'true' : 'false';
      
      if (duration) {
        process.env.MAINTENANCE_DURATION = duration;
      }
      
      if (reason) {
        process.env.MAINTENANCE_REASON = reason;
      }

      this.logger.info(`🔧 Maintenance mode ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      this.logger.error('Failed to set maintenance mode:', error);
      throw error;
    }
  }

  /**
   * Set bot status
   */
  async setBotStatus(online: boolean): Promise<void> {
    try {
      // Note: In a production environment, you'd want to update the .env file
      // or use a configuration management system
      process.env.BOT_STATUS = online ? 'true' : 'false';

      this.logger.info(`🤖 Bot status set to ${online ? 'online' : 'offline'}`);
    } catch (error) {
      this.logger.error('Failed to set bot status:', error);
      throw error;
    }
  }

  /**
   * Handle maintenance and status callback queries
   */
  async handleMaintenanceCallbacks(ctx: Context): Promise<void> {
    try {
      if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) return;
      
      const data = ctx.callbackQuery.data;
      const userId = ctx.from?.id?.toString();
      
      switch (data) {
        case 'notify_maintenance':
          await ctx.answerCbQuery('✅ You will be notified when maintenance is complete! 🔔');
          if (userId) {
            this.logger.info(`📋 User ${userId} requested maintenance completion notification`);
            // TODO: Add user to notification list in storage
          }
          break;
          
        case 'check_maintenance_status':
          const maintenanceStatus = this.getMaintenanceStatus();
          let statusMessage: string;
          
          if (!maintenanceStatus.isBotOffline && !maintenanceStatus.isMaintenanceMode) {
            statusMessage = '✅ Great news! The bot is back online and ready to use!';
            await ctx.answerCbQuery(statusMessage);
            await ctx.editMessageText(
              '✨ <b>Bot is Back Online!</b>\n\n' +
              '🎉 Maintenance has been completed successfully.\n' +
              '✅ All systems are operational and ready to serve you.\n\n' +
              '🚀 You can now use all bot features normally.\n' +
              'Thank you for your patience!',
              {
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🏠 Go to Main Menu', callback_data: 'menu_main' }]
                  ]
                }
              }
            );
          } else {
            const reason = maintenanceStatus.isMaintenanceMode ? 'maintenance mode' : 'bot offline';
            const duration = maintenanceStatus.expectedDuration || 'unknown';
            statusMessage = `⏰ Still in ${reason}. Expected duration: ${duration}`;
            await ctx.answerCbQuery(statusMessage);
          }
          break;
          
        case 'refresh_status':
          const botStatus = this.isBotOnline();
          const maintenanceMode = this.isMaintenanceMode();
          
          if (botStatus && !maintenanceMode) {
            await ctx.answerCbQuery('✅ Bot is now online! You can use it normally.');
            await ctx.editMessageText(
              '✨ <b>Bot Status: Online</b>\n\n' +
              '✅ The bot is now fully operational!\n' +
              '🚀 All features are available and ready to use.\n\n' +
              'Welcome back! 🎉',
              {
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '🏠 Go to Main Menu', callback_data: 'menu_main' }]
                  ]
                }
              }
            );
          } else if (!botStatus) {
            await ctx.answerCbQuery('⚠️ Bot is still offline. Please try again later.');
          } else if (maintenanceMode) {
            await ctx.answerCbQuery('🔧 Still in maintenance mode. Please wait a bit more.');
          }
          break;
          
        default:
          break;
      }
    } catch (error) {
      this.logger.error('Error handling maintenance callbacks:', error);
      try {
        await ctx.answerCbQuery('⚠️ Error checking status. Please try again.');
      } catch {}
    }
  }
}