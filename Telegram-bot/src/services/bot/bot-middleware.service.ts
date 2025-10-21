import { Telegraf, Scenes, session } from 'telegraf';
import { BotCommand } from 'telegraf/typings/core/types/typegram';
import { Logger } from '../logger';
import { getConfig } from '../../config';
import { SecurityManager } from '../../security';
import { defaultTelegramSecurityMiddleware } from '../../security/unified-security-middleware';
import { createBotMiddlewares } from '../../bot/middleware';
import { ErrorHandlerService } from '../error-handler.service';
import { IBotMiddlewareService } from '../../interfaces/bot-services.interface';
import { MenuHandler } from '../../bot/handlers/menu-handler';
import { TaskHandler } from '../../bot/handlers/task-handler';
import { WalletHandler } from '../../bot/handlers/wallet-handler';
import { ReferralHandler } from '../../bot/handlers/referral-handler';
import { AdminHandler } from '../../bot/handlers/admin-handler';

export class BotMiddlewareService implements IBotMiddlewareService {
  private readonly logger = Logger.getInstance();
  private readonly config = getConfig();
  private readonly security = SecurityManager.getInstance();
  private readonly errorHandlerService = ErrorHandlerService.getInstance();

  // Handlers - TODO: These should be injected through container
  private readonly menuHandler = new MenuHandler();
  private readonly taskHandler = new TaskHandler();
  private readonly walletHandler = new WalletHandler();
  private readonly referralHandler = new ReferralHandler();
  private readonly adminHandler = new AdminHandler();

  setupErrorHandling(bot: Telegraf): void {
    // Use the enhanced error handler service for Telegraf errors
    const handler = this.errorHandlerService.createTelegrafErrorHandler();
    bot.catch((err, ctx) => handler(err as any, ctx as any));
  }

  async setupMiddleware(bot: Telegraf): Promise<void> {
    // Session middleware for maintaining user state
    bot.use(session({
      defaultSession: () => ({
        user: null,
        step: null,
        data: {}
      })
    }));

    // Bot-level middleware (blocking, maintenance)
    const botMiddlewares = createBotMiddlewares();
    botMiddlewares.forEach(middleware => {
      bot.use(middleware);
    });

    // Security middleware (unified)
    bot.use(defaultTelegramSecurityMiddleware as any);

    // Logging middleware
    bot.use(async (ctx, next) => {
      const start = Date.now();
      
      const messageText = ctx.message && 'text' in ctx.message ? (ctx.message as any).text : undefined;
      const cbData = ctx.callbackQuery && 'data' in ctx.callbackQuery ? (ctx.callbackQuery as any).data : undefined;
      this.logger.info('Bot request', {
        userId: ctx.from?.id,
        chatId: ctx.chat?.id,
        updateType: ctx.updateType,
        message: messageText || cbData
      });

      await next();

      this.logger.info('Bot response', {
        userId: ctx.from?.id,
        processingTime: Date.now() - start
      });
    });
  }

  async setupScenes(bot: Telegraf): Promise<void> {
    // Create stage for scenes
    const stage = new Scenes.Stage([
      this.walletHandler.getWalletConnectionScene(),
      this.taskHandler.getTaskSubmissionScene(),
      this.referralHandler.getReferralInputScene(),
      this.adminHandler.getAdminScenes()
    ].flat());

    bot.use(stage.middleware() as any);
  }

  async setBotCommands(bot: Telegraf): Promise<void> {
    const commands: BotCommand[] = [
      { command: 'start', description: 'Start the airdrop bot' },
      { command: 'menu', description: 'Show main menu' },
      { command: 'points', description: 'Check your points' },
      { command: 'tasks', description: 'View available tasks' },
      { command: 'wallet', description: 'Connect your wallet' },
      { command: 'referrals', description: 'View referral program' },
      { command: 'stats', description: 'View your statistics' },
      { command: 'help', description: 'Show help information' }
    ];

    await bot.telegram.setMyCommands(commands);
    this.logger.info('Bot commands set successfully');
  }
}