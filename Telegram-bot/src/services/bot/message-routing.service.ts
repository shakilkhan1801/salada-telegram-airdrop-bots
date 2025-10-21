import { Context, Telegraf } from 'telegraf';
import { Logger } from '../logger';
import { StorageManager } from '../../storage';
import { IMessageRoutingService } from '../../interfaces/bot-services.interface';
import { MenuHandler } from '../../bot/handlers/menu-handler';
import { TaskHandler } from '../../bot/handlers/task-handler';
import { WalletHandler } from '../../bot/handlers/wallet-handler';
import { ReferralHandler } from '../../bot/handlers/referral-handler';
import { PointsHandler } from '../../bot/handlers/points-handler';

export class MessageRoutingService implements IMessageRoutingService {
  private readonly logger = Logger.getInstance();
  private readonly storage = StorageManager.getInstance();
  
  // Handlers - TODO: These should be injected via DI container when they're also refactored
  private readonly menuHandler = new MenuHandler();
  private readonly taskHandler = new TaskHandler();
  private readonly walletHandler = new WalletHandler();
  private readonly referralHandler = new ReferralHandler();
  private readonly pointsHandler = new PointsHandler();

  async setupHandlers(bot: Telegraf): Promise<void> {
    // This would set up all message routing handlers
    // For now, this is not needed as the routing is handled in TelegramBot
  }

  async handleCallback(ctx: Context): Promise<void> {
    const rawData = ctx.callbackQuery && 'data' in ctx.callbackQuery ? (ctx.callbackQuery as any).data : undefined;
    const callbackData = typeof rawData === 'string' ? rawData : String(rawData || '');
    void ctx.answerCbQuery().catch(() => {});
    
    try {
      if (callbackData?.startsWith('menu_') || callbackData?.startsWith('support_')) {
        await this.menuHandler.handleCallback(ctx);
      } else if (callbackData?.startsWith('task_')) {
        await this.taskHandler.handleCallback(ctx);
      } else if (callbackData?.startsWith('wallet_') || callbackData?.startsWith('transfer_')) {
        await this.walletHandler.handleCallback(ctx);
      } else if (callbackData?.startsWith('referral_')) {
        await this.referralHandler.handleCallback(ctx);
      } else if (callbackData?.startsWith('points_')) {
        await this.pointsHandler.handleCallback(ctx);
      } else {
        this.logger.warn('Unrecognized callback query in message routing:', callbackData);
        try {
          await ctx.answerCbQuery('❌ Invalid action. Please try again.');
        } catch (error: any) {
          this.logger.debug('Could not answer callback query:', error);
        }
      }
    } catch (error) {
      this.logger.error('Error handling callback in message routing:', error);
      try {
        await ctx.answerCbQuery('❌ An error occurred. Please try again.');
      } catch (answerError: any) {
        this.logger.debug('Could not answer callback query after error:', answerError);
      }
    }
  }

  async handleTextMessage(ctx: Context): Promise<void> {
    const text = ctx.message && 'text' in ctx.message ? (ctx.message as any).text as string : undefined;
    if (!text) return;

    const userId = ctx.from?.id?.toString();
    if (!userId) return;

    try {
      // First check if user is in ticket creation mode
      const isInTicketMode = await this.storage.get('ticket_creation', userId);
      if (isInTicketMode) {
        await this.menuHandler.handleTicketMessage(ctx, text);
        return;
      }

      const lowerText = text.toLowerCase();

      // Handle common text responses
      if (lowerText.includes('menu') || text === '📋') {
        await this.menuHandler.showMainMenu(ctx);
      } else if (lowerText.includes('points') || text === '💰') {
        await this.pointsHandler.showPoints(ctx);
      } else if (lowerText.includes('tasks') || text === '📝') {
        await this.taskHandler.showTasks(ctx);
      } else if (lowerText.includes('wallet') || text === '👛') {
        await this.walletHandler.showWallet(ctx);
      } else if (lowerText.includes('referral') || text === '👥') {
        await this.referralHandler.showReferrals(ctx);
      } else if (lowerText.includes('help') || text === '❓') {
        await this.menuHandler.showHelp(ctx);
      } else if (lowerText.includes('support') || text === '💬') {
        await this.menuHandler.showSupport(ctx);
      } else {
        // Unknown text: delete user message, reply at most once per 5 minutes
        try {
          // Delete the incoming message to keep chat clean (ignore errors)
          // @ts-ignore
          await (ctx as any).deleteMessage?.();
        } catch (e) {
          this.logger.debug('Could not delete user message', e);
        }

        try {
          const user = await this.storage.getUser(userId);
          const lastShown = user?.lastUnknownHelpAt ? new Date(user.lastUnknownHelpAt).getTime() : 0;
          const cooldownMs = 5 * 60 * 1000; // 5 minutes
          if (Date.now() - lastShown >= cooldownMs) {
            await ctx.reply(
              '❓ I didn\'t understand that command. Use /menu to see available options.',
              { link_preview_options: { is_disabled: true } }
            );
            if (user) {
              await this.storage.updateUser(userId, { lastUnknownHelpAt: new Date().toISOString() } as any);
            }
          }

          // Spam control: warn then freeze
          const windowMs = Number(process.env.SPAM_WINDOW_MS || '60000');
          const warnThreshold = Number(process.env.SPAM_WARN_THRESHOLD || '5');
          const freezeThreshold = Number(process.env.SPAM_FREEZE_THRESHOLD || '8');
          const freezeMinutes = Number(process.env.SPAM_FREEZE_MINUTES || '10');
          const warnCooldownMs = Number(process.env.SPAM_WARNING_COOLDOWN_MS || '300000');

          const now = Date.now();
          let spamWindowStart = user?.spamWindowStart ? new Date(user.spamWindowStart).getTime() : 0;
          let spamCount = Number(user?.spamCount || 0);
          if (now - spamWindowStart > windowMs) {
            spamWindowStart = now;
            spamCount = 0;
          }
          spamCount += 1;

          const updates: any = { spamWindowStart: new Date(spamWindowStart).toISOString(), spamCount };

          const lastWarnAt = user?.lastSpamWarningAt ? new Date(user.lastSpamWarningAt).getTime() : 0;
          const canWarn = now - lastWarnAt >= warnCooldownMs;

          if (spamCount === warnThreshold && canWarn) {
            await ctx.reply('⚠️ Please slow down. Sending too many messages may freeze your account for 10 minutes.');
            updates.lastSpamWarningAt = new Date().toISOString();
          }

          if (spamCount >= freezeThreshold) {
            const durationMs = Math.max(1, freezeMinutes) * 60 * 1000;
            await this.storage.addUserBlock(userId, 'spam_freeze', durationMs);
          }

          if (user) {
            await this.storage.updateUser(userId, updates);
          }
        } catch (err) {
          this.logger.error('Unknown message handling failed', err);
        }
      }
    } catch (error) {
      this.logger.error('Error handling text message:', error);
      await ctx.reply('❌ An error occurred processing your message. Please try again.');
    }
  }

  async handleWebAppData(ctx: Context): Promise<void> {
    // This would handle web app data - for now delegated to the main bot
    this.logger.info('Web app data received - delegating to main handler');
  }

  async handleDocumentUpload(ctx: Context): Promise<void> {
    // This would handle document uploads
    this.logger.info('Document upload received');
    await ctx.reply('📄 Document received. File upload processing is not yet implemented.');
  }

  async handlePhotoUpload(ctx: Context): Promise<void> {
    // This would handle photo uploads
    this.logger.info('Photo upload received');
    await ctx.reply('📷 Photo received. Image upload processing is not yet implemented.');
  }
}