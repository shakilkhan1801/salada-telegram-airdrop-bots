import { Telegraf } from 'telegraf';
import { Logger } from '../logger';
import { getConfig } from '../../config';
import { IBotLifecycleService, IBotMiddlewareService, ICommandHandlerService, IMessageRoutingService } from '../../interfaces/bot-services.interface';
import { Container } from '../container.service';
import { TYPES } from '../../interfaces/container.interface';

export class BotLifecycleService implements IBotLifecycleService {
  private readonly bot: Telegraf;
  private readonly logger = Logger.getInstance();
  private readonly config = getConfig();
  private readonly container = Container.getInstance();
  private isInitializedFlag = false;

  constructor() {
    this.bot = new Telegraf(this.config.bot.token);
  }

  async initialize(): Promise<void> {
    if (this.isInitializedFlag) {
      this.logger.warn('Bot already initialized');
      return;
    }

    try {
      this.logger.info('Initializing Telegram bot');

      // Get services from container
      const middlewareService = this.container.get<IBotMiddlewareService>(TYPES.BotMiddlewareService);
      const commandService = this.container.get<ICommandHandlerService>(TYPES.CommandHandlerService);
      const messageService = this.container.get<IMessageRoutingService>(TYPES.MessageRoutingService);

      // Setup error handling
      middlewareService.setupErrorHandling(this.bot);

      // Setup middleware
      await middlewareService.setupMiddleware(this.bot);

      // Setup commands
      await commandService.setupCommands(this.bot);

      // Setup scenes
      await middlewareService.setupScenes(this.bot);

      // Initialize wallet handler with WalletConnect v2
      // Note: This will need to be moved to a proper service later
      const { WalletHandler } = await import('../../bot/handlers/wallet-handler');
      const walletHandler = new WalletHandler();
      await walletHandler.initialize();

      // Set bot instance in WalletConnect service for notifications
      const { WalletConnectService } = await import('../walletconnect.service');
      WalletConnectService.setBotInstance(this.bot);

      // Setup handlers
      await messageService.setupHandlers(this.bot);

      // Set bot commands for UI
      await middlewareService.setBotCommands(this.bot);

      this.isInitializedFlag = true;
      this.logger.info('Telegram bot initialized successfully');

    } catch (error) {
      this.logger.error('Failed to initialize bot:', error);
      throw error;
    }
  }

  async start(): Promise<void> {
    if (!this.isInitializedFlag) {
      await this.initialize();
    }

    try {
      this.logger.info('Starting Telegram bot');
      
      if (this.config.bot.useWebhook) {
        // Webhook mode (for production)
        if (!this.config.bot.webhookUrl) {
          this.logger.error('Webhook mode enabled but webhookUrl is not configured');
          throw new Error('Missing webhookUrl for webhook mode');
        }
        await this.bot.telegram.setWebhook(this.config.bot.webhookUrl as string);
        this.logger.info(`Bot webhook set to: ${this.config.bot.webhookUrl}`);
      } else {
        // Polling mode (for development)
        await this.bot.launch();
        this.logger.info('Bot started in polling mode');
      }

      // Graceful shutdown
      process.once('SIGINT', () => this.stop('SIGINT'));
      process.once('SIGTERM', () => this.stop('SIGTERM'));

    } catch (error) {
      this.logger.error('Failed to start bot:', error);
      throw error;
    }
  }

  async stop(signal?: string): Promise<void> {
    this.logger.info(`Stopping bot${signal ? ` (${signal})` : ''}`);
    
    try {
      await this.bot.stop(signal);
      this.logger.info('Bot stopped successfully');
    } catch (error) {
      this.logger.error('Error stopping bot:', error);
    }
  }

  getInstance(): Telegraf {
    return this.bot;
  }

  isInitialized(): boolean {
    return this.isInitializedFlag;
  }
}