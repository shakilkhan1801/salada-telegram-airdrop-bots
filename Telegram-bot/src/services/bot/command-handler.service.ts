import { Context, Telegraf } from 'telegraf';
import { Logger } from '../logger';
import { getConfig } from '../../config';
import { ICommandHandlerService, IUserRegistrationService, ICaptchaValidationService } from '../../interfaces/bot-services.interface';
import { Container } from '../container.service';
import { TYPES } from '../../interfaces/container.interface';
import { IAdminAuthorizationService } from '../../interfaces/admin-services.interface';
import { PointsService, PointEarningCategory } from '../../shared/services/points.service';
import { MenuHandler } from '../../bot/handlers/menu-handler';
import { TaskHandler } from '../../bot/handlers/task-handler';
import { WalletHandler } from '../../bot/handlers/wallet-handler';
import { ReferralHandler } from '../../bot/handlers/referral-handler';
import { PointsHandler } from '../../bot/handlers/points-handler';
import { AdminHandler } from '../../bot/handlers/admin-handler';
import { TaskAdminHandler } from '../../bot/handlers/task-admin.handler';

export class CommandHandlerService implements ICommandHandlerService {
  private readonly logger = Logger.getInstance();
  private readonly container = Container.getInstance();

  // Handlers - TODO: These should be injected through container
  private readonly menuHandler = new MenuHandler();
  private readonly taskHandler = new TaskHandler();
  private readonly walletHandler = new WalletHandler();
  private readonly referralHandler = new ReferralHandler();
  private readonly pointsHandler = new PointsHandler();
  private readonly adminHandler = new AdminHandler();
  private readonly taskAdminHandler = new TaskAdminHandler();

  async setupCommands(bot: Telegraf): Promise<void> {
    // Start command
    bot.start(async (ctx) => {
      await this.handleStart(ctx);
    });

    // Help command
    bot.help(async (ctx) => {
      await this.handleHelp(ctx);
    });

    // Menu command
    bot.command('menu', async (ctx) => {
      await this.handleMenu(ctx);
    });

    // Points command
    bot.command('points', async (ctx) => {
      await this.handlePoints(ctx);
    });

    // Tasks command
    bot.command('tasks', async (ctx) => {
      await this.handleTasks(ctx);
    });

    // Wallet command
    bot.command('wallet', async (ctx) => {
      await this.handleWallet(ctx);
    });

    // Referral command
    bot.command('referrals', async (ctx) => {
      await this.handleReferrals(ctx);
    });

    // Stats command
    bot.command('stats', async (ctx) => {
      await this.handleStats(ctx);
    });

    // Admin commands
    bot.command('admin', async (ctx) => {
      await this.handleAdmin(ctx);
    });

    bot.command('award', async (ctx) => {
      await this.handleAward(ctx);
    });

    // Task admin commands
    bot.command('pending', async (ctx) => {
      await this.taskAdminHandler.showPendingSubmissions(ctx);
    });

    bot.command('approve', async (ctx) => {
      const messageText = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
      const args = messageText ? messageText.split(' ').slice(1) : [];
      await this.taskAdminHandler.approveSubmission(ctx, args);
    });

    bot.command('reject', async (ctx) => {
      const messageText = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
      const args = messageText ? messageText.split(' ').slice(1) : [];
      await this.taskAdminHandler.rejectSubmission(ctx, args);
    });

    bot.command('taskstats', async (ctx) => {
      await this.taskAdminHandler.showTaskStats(ctx);
    });
  }

  async handleStart(ctx: Context): Promise<void> {
    // Show only the final, detailed message for existing users.
    // Run the start flow synchronously so only one message is sent.
    await this.runStartFlow(ctx);
  }

  private async runStartFlow(ctx: Context): Promise<void> {
    const userRegistrationService = this.container.get<IUserRegistrationService>(TYPES.UserRegistrationService);
    const captchaService = this.container.get<ICaptchaValidationService>(TYPES.CaptchaValidationService);
    const config = getConfig();

    const userId = ctx.from?.id?.toString();
    if (!userId) return;

    // Try fast path: session-primed user
    const sess: any = (ctx as any).session;
    let user: any | null = (sess?.user && (sess.user.telegramId === userId || sess.user.id === userId)) ? sess.user : null;

    if (!user) {
      // This logic will be moved to UserRegistrationService
      const { StorageManager } = await import('../../storage');
      const storage = StorageManager.getInstance();
      user = await storage.getUser(userId);
      // Prime session cache for subsequent handlers
      try { if (sess) sess.user = user; } catch {}
    }

    if (!user) {
      // Check if captcha is required for new users (short-circuit if all disabled)
      if (config.captcha?.miniappEnabled || config.captcha?.svgEnabled) {
        if (await captchaService.shouldRequireCaptcha(null, true)) {
          await captchaService.promptForCaptcha(ctx, 'registration');
          return;
        }
      }
      
      // New user registration
      await userRegistrationService.registerNewUser(ctx);
    } else {
      // Check if existing user needs captcha verification (short-circuit if all disabled)
      if (config.captcha?.miniappEnabled || config.captcha?.svgEnabled) {
        if (await captchaService.shouldRequireCaptcha(user, false)) {
          await captchaService.promptForCaptcha(ctx, 'verification');
          return;
        }
      }
      
      // Existing user: show only the detailed main menu overview, fire-and-forget to reduce measured latency
      this.menuHandler.showMainMenu(ctx).catch(err => this.logger.error('showMainMenu failed', err));
    }

    // Don't automatically show main menu for new users
    // They will proceed from welcome screen when ready
  }

  async handleHelp(ctx: Context): Promise<void> {
    const userRegistrationService = this.container.get<IUserRegistrationService>(TYPES.UserRegistrationService);
    
    if (await userRegistrationService.ensureUserExistsForCommand(ctx)) {
      await this.menuHandler.showHelp(ctx);
    }
  }

  async handleMenu(ctx: Context): Promise<void> {
    const userRegistrationService = this.container.get<IUserRegistrationService>(TYPES.UserRegistrationService);
    
    if (await userRegistrationService.ensureUserExistsForCommand(ctx)) {
      this.menuHandler.showMainMenu(ctx).catch(err => this.logger.error('showMainMenu failed', err));
    }
  }

  async handlePoints(ctx: Context): Promise<void> {
    const userRegistrationService = this.container.get<IUserRegistrationService>(TYPES.UserRegistrationService);
    
    if (await userRegistrationService.ensureUserExistsForCommand(ctx)) {
      this.pointsHandler.showPoints(ctx).catch(err => this.logger.error('showPoints failed', err));
    }
  }

  async handleTasks(ctx: Context): Promise<void> {
    const userRegistrationService = this.container.get<IUserRegistrationService>(TYPES.UserRegistrationService);
    
    if (await userRegistrationService.ensureUserExistsForCommand(ctx)) {
      this.taskHandler.showTasks(ctx).catch(err => this.logger.error('showTasks failed', err));
    }
  }

  async handleWallet(ctx: Context): Promise<void> {
    const userRegistrationService = this.container.get<IUserRegistrationService>(TYPES.UserRegistrationService);
    
    if (await userRegistrationService.ensureUserExistsForCommand(ctx)) {
      this.walletHandler.showWallet(ctx).catch(err => this.logger.error('showWallet failed', err));
    }
  }

  async handleReferrals(ctx: Context): Promise<void> {
    const userRegistrationService = this.container.get<IUserRegistrationService>(TYPES.UserRegistrationService);
    
    if (await userRegistrationService.ensureUserExistsForCommand(ctx)) {
      this.referralHandler.showReferrals(ctx).catch(err => this.logger.error('showReferrals failed', err));
    }
  }

  async handleStats(ctx: Context): Promise<void> {
    const userRegistrationService = this.container.get<IUserRegistrationService>(TYPES.UserRegistrationService);
    
    if (await userRegistrationService.ensureUserExistsForCommand(ctx)) {
      this.pointsHandler.showStats(ctx).catch(err => this.logger.error('showStats failed', err));
    }
  }

  async handleAdmin(ctx: Context): Promise<void> {
    this.adminHandler.showAdminPanel(ctx).catch(err => this.logger.error('showAdminPanel failed', err));
  }

  private async handleAward(ctx: Context): Promise<void> {
    try {
      const adminAuth = this.container.get<IAdminAuthorizationService>(TYPES.AdminAuthorizationService);
      const callerId = ctx.from?.id?.toString() || '';
      if (!callerId || !adminAuth.isAdmin(callerId)) {
        await ctx.reply('❌ Access denied. Admin only.');
        return;
      }
      const messageText = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
      const args = messageText ? messageText.split(' ').slice(1) : [];
      if (args.length < 2) {
        await ctx.reply('Usage: /award [userId] [amount] [reason]');
        return;
      }
      const targetId = args[0];
      const amount = parseInt(args[1], 10);
      const reason = args.slice(2).join(' ') || 'Admin award';
      if (isNaN(amount) || amount <= 0) {
        await ctx.reply('❌ Amount must be a positive number.');
        return;
      }
      const result = await PointsService.awardPoints(
        targetId,
        amount,
        reason,
        PointEarningCategory.ADMIN_REWARD,
        { adminId: callerId, source: 'admin_award' }
      );
      if (result.success) {
        await ctx.reply(`✅ Awarded ${amount} points to ${targetId}. New balance: ${result.newBalance}`);
      } else {
        await ctx.reply(`❌ Failed to award points: ${result.error || 'Unknown error'}`);
      }
    } catch (error) {
      await ctx.reply('❌ Error processing award.');
    }
  }
}