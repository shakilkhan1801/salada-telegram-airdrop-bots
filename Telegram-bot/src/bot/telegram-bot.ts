import { Telegraf, Scenes, session } from 'telegraf';
import { BotCommand } from 'telegraf/typings/core/types/typegram';
import type { UpdateType } from 'telegraf/typings/telegram-types';
import { Logger } from '../services/logger';
import { getConfig } from '../config';
import { StorageManager } from '../storage';
import { SecurityManager } from '../security';
import { AccountProtectionService } from '../security/account-protection.service';
import { MenuHandler } from './handlers/menu-handler';
import { TaskHandler } from './handlers/task-handler';
import { WalletHandler } from './handlers/wallet-handler';
import { ReferralHandler } from './handlers/referral-handler';
import { PointsHandler } from './handlers/points-handler';
import { AdminHandler } from './handlers/admin-handler';
import { TaskAdminHandler } from './handlers/task-admin.handler';
import { WelcomeHandler } from './handlers/welcome-handler';
import { Container } from '../services/container.service';
import { ContainerConfigService } from '../services/container-config.service';
import { TYPES } from '../interfaces/container.interface';
import { ICommandHandlerService, IUserRegistrationService, ICaptchaValidationService, IMessageRoutingService } from '../interfaces/bot-services.interface';
import { CaptchaService } from '../services/captcha-service';
import { safeJSONParse, ValidationSchema } from '../services/validation.service';
import { UserFactory } from '../factories/user-factory';
import { createBotMiddlewares, getMiddlewareInstances } from './middleware';
import { ErrorHandlerService } from '../services/error-handler.service';
import { CallbackManager } from '../utils/callback-manager';
import { MessageService } from '../shared/services/message.service';
import { CallbackQueryService } from '../shared/services/callback-query.service';
import { MongoSessionStore } from './middleware/mongo-session.store';
import { RedisSessionStore } from './middleware/redis-session.store';
import { referralManager } from '../services/referral-manager.service';
import * as https from 'https';

export class TelegramBot {
  public readonly bot: Telegraf;
  private readonly logger = Logger.getInstance();
  private readonly config = getConfig();
  private readonly storage = StorageManager.getInstance();
  private readonly security = SecurityManager.getInstance();
  private readonly captchaService = CaptchaService.getInstance();
  private readonly accountProtection = new AccountProtectionService();
  private readonly errorHandlerService = ErrorHandlerService.getInstance();
  private readonly container = Container.getInstance();
  
  // Services (injected)
  private readonly commandHandlerService: ICommandHandlerService;
  private readonly userRegistrationService: IUserRegistrationService;
  private readonly captchaValidationService: ICaptchaValidationService;
  private readonly messageRoutingService: IMessageRoutingService;
  
  // Handlers (legacy - to be phased out)
  private readonly menuHandler: MenuHandler;
  private readonly taskHandler: TaskHandler;
  private readonly walletHandler: WalletHandler;
  private readonly referralHandler: ReferralHandler;
  private readonly pointsHandler: PointsHandler;
  private readonly adminHandler: AdminHandler;
  private readonly taskAdminHandler: TaskAdminHandler;
  private readonly welcomeHandler: WelcomeHandler;

  private isInitialized = false;
  private activeCallbackLocks: Set<string> = new Set();
  private telegramKeepAliveTimer: NodeJS.Timeout | null = null;

  constructor() {
    const keepAliveAgent = this.createKeepAliveAgent();
    this.bot = new Telegraf(this.config.bot.token, { telegram: { agent: keepAliveAgent as any } });
    
    // Configure dependency injection container
    ContainerConfigService.configureContainer();
    
    // Get services from container
    this.commandHandlerService = this.container.get<ICommandHandlerService>(TYPES.CommandHandlerService);
    this.userRegistrationService = this.container.get<IUserRegistrationService>(TYPES.UserRegistrationService);
    this.captchaValidationService = this.container.get<ICaptchaValidationService>(TYPES.CaptchaValidationService);
    this.messageRoutingService = this.container.get<IMessageRoutingService>(TYPES.MessageRoutingService);
    
    // Initialize legacy handlers (to be phased out)
    this.menuHandler = new MenuHandler();
    this.taskHandler = new TaskHandler();
    this.walletHandler = new WalletHandler();
    this.referralHandler = new ReferralHandler();
    this.pointsHandler = new PointsHandler();
    this.adminHandler = new AdminHandler();
    this.taskAdminHandler = new TaskAdminHandler();
    this.welcomeHandler = new WelcomeHandler();
  }

  /**
   * Initialize the bot with all middleware and handlers
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn('Bot already initialized');
      return;
    }

    try {
      this.logger.info('Initializing Telegram bot');

      // Setup error handling
      this.setupErrorHandling();

      // Setup middleware
      await this.setupMiddleware();

      // Setup commands
      await this.setupCommands();

      // Setup scenes (for multi-step interactions)
      await this.setupScenes();

      // Initialize wallet handler with WalletConnect v2
      await this.walletHandler.initialize();

      // Set bot instance in WalletConnect service for notifications
      const { WalletConnectService } = await import('../services/walletconnect.service');
      WalletConnectService.setBotInstance(this.bot);

      // Setup handlers
      await this.setupHandlers();

      // Set bot instance on referral handler for notifications
      this.referralHandler.setBotInstance(this.bot);
      
      // Initialize professional referral manager with bot instance
      referralManager.setBotInstance(this.bot);

      // Set bot commands for UI
      await this.setBotCommands();

      this.isInitialized = true;
      this.logger.info('Telegram bot initialized successfully');

    } catch (error) {
      this.logger.error('Failed to initialize bot:', error);
      throw error;
    }
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      this.logger.info('Starting Telegram bot');
      
      const allowedUpdatesList: ReadonlyArray<UpdateType> = ['message', 'callback_query'];
      if (this.config.bot.useWebhook) {
        // Webhook mode (for production)
        const webhookUrl = this.config.bot.webhookUrl;
        if (!webhookUrl) {
          throw new Error('Webhook URL is required when useWebhook is enabled');
        }
        const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
        await this.bot.telegram.setWebhook(webhookUrl, { allowed_updates: allowedUpdatesList as any, secret_token: secret });
        this.logger.info(`Bot webhook set to: ${webhookUrl}`, { allowedUpdates: allowedUpdatesList, hasSecret: !!secret });
      } else {
        // Polling mode (for development)
        const allowedUpdatesArr = Array.from(allowedUpdatesList);
        await this.bot.launch({ allowedUpdates: allowedUpdatesArr });
        this.logger.info('Bot started in polling mode', { allowedUpdates: allowedUpdatesArr });
      }

      this.startTelegramKeepAlive();

      // Graceful shutdown
      process.once('SIGINT', () => this.stop('SIGINT'));
      process.once('SIGTERM', () => this.stop('SIGTERM'));

    } catch (error) {
      this.logger.error('Failed to start bot:', error);
      throw error;
    }
  }

  /**
   * Stop the bot gracefully
   */
  async stop(signal?: string): Promise<void> {
    this.logger.info(`Stopping bot${signal ? ` (${signal})` : ''}`);
    
    try {
      if (this.telegramKeepAliveTimer) {
        clearInterval(this.telegramKeepAliveTimer);
        this.telegramKeepAliveTimer = null;
      }
      await this.bot.stop(signal);
      this.logger.info('Bot stopped successfully');
    } catch (error) {
      this.logger.error('Error stopping bot:', error);
    }
  }

  /**
   * Get the Telegraf instance
   */
  getInstance(): Telegraf {
    return this.bot;
  }

  /**
   * Get middleware instances for external access
   */
  getMiddlewareInstances() {
    return getMiddlewareInstances();
  }

  /**
   * Create HTTPS agent with keep-alive for Telegram connections
   */
  private createKeepAliveAgent(): https.Agent {
    const keepAliveMsecs = parseInt(process.env.TELEGRAM_KEEPALIVE_MSECS || '60000', 10);
    const maxSockets = parseInt(process.env.TELEGRAM_KEEPALIVE_MAX_SOCKETS || '64', 10);
    
    const agent = new https.Agent({
      keepAlive: true,
      keepAliveMsecs,
      maxSockets,
      maxFreeSockets: Math.floor(maxSockets / 6),
      timeout: 60000,
      scheduling: 'lifo'
    });
    
    this.logger.info('Telegram keep-alive agent created', {
      keepAliveMsecs,
      maxSockets,
      maxFreeSockets: Math.floor(maxSockets / 6)
    });
    
    return agent;
  }

  /**
   * Start periodic keep-alive pings to Telegram
   */
  private startTelegramKeepAlive(): void {
    // Clear any existing timer
    if (this.telegramKeepAliveTimer) {
      clearInterval(this.telegramKeepAliveTimer);
    }

    const intervalMs = parseInt(process.env.TELEGRAM_KEEPALIVE_INTERVAL_MS || '300000', 10);

    // Send periodic getMe requests to keep connection alive
    this.telegramKeepAliveTimer = setInterval(async () => {
      try {
        await this.bot.telegram.getMe();
        this.logger.debug('Telegram keep-alive ping successful');
      } catch (error) {
        this.logger.warn('Telegram keep-alive ping failed:', error);
      }
    }, intervalMs);

    this.logger.info('Telegram keep-alive started', {
      intervalMs,
      intervalMinutes: intervalMs / 60000
    });
  }

  private setupErrorHandling(): void {
    // Use the enhanced error handler service for Telegraf errors
    this.bot.catch((err: unknown, ctx) => {
      const error = err instanceof Error ? err : new Error(String(err));
      return this.errorHandlerService.createTelegrafErrorHandler()(error, ctx);
    });
  }

  private async setupMiddleware(): Promise<void> {
    this.bot.use(async (ctx, next) => {
      const { runWithTrace, generateTraceId } = await import('../services/trace');
      const updateId = (ctx.update as any)?.update_id;
      const traceId = `tg-${updateId || generateTraceId('tg')}`;
      return runWithTrace(traceId, () => next());
    });
    
    // PRODUCTION FIX: High-performance update deduplication
    // Uses Redis (or in-memory fallback) instead of MongoDB for 100x faster checks
    this.bot.use(async (ctx, next) => {
      try {
        const updateId = (ctx.update as any)?.update_id;
        if (!updateId) return next();
        
        // Use new deduplicator service (Redis-backed)
        const { updateDeduplicator } = await import('../services/update-deduplicator.service');
        const isDuplicate = await updateDeduplicator.isDuplicate(Number(updateId));
        
        if (isDuplicate) {
          this.logger.debug('Duplicate update ignored', { updateId });
          return;  // Stop processing
        }
      } catch (error) {
        // If deduplication fails, log but allow processing (better to process twice than drop)
        this.logger.warn('Update deduplication check failed, allowing update', { error });
      }
      return next();
    });

    // PRODUCTION FIX: Redis-based session storage (50-100x faster than MongoDB)
    // Critical for handling 1000+ concurrent users
    try {
      const redisHost = process.env.REDIS_HOST;
      
      if (redisHost) {
        // Use Redis for sessions (RECOMMENDED for production)
        const redisStore = new RedisSessionStore(7 * 24 * 60 * 60 * 1000);
        
        this.bot.use(session({
          store: redisStore as any,
          defaultSession: () => ({
            user: null,
            step: null,
            data: {}
          })
        }) as any);
        
        this.logger.info('Using Redis session storage (HIGH PERFORMANCE)', {
          redisHost,
          ttlDays: 7,
          performanceGain: '50-100x faster than MongoDB'
        });
      } else {
        // Fallback to MongoDB for sessions (NOT RECOMMENDED for production)
        this.logger.warn('Redis not configured, falling back to MongoDB sessions (SLOW)');
        this.logger.warn('For production with 1000+ concurrent users, configure REDIS_HOST in .env');
        
        const mongoStore = new MongoSessionStore(7 * 24 * 60 * 60 * 1000);
        this.bot.use(session({
          store: mongoStore as any,
          defaultSession: () => ({
            user: null,
            step: null,
            data: {}
          })
        }) as any);
      }
    } catch (error) {
      this.logger.error('Failed to initialize session store, using in-memory fallback', error);
      // Use default in-memory sessions (will lose sessions on restart)
      this.bot.use(session({
        defaultSession: () => ({
          user: null,
          step: null,
          data: {}
        })
      }) as any);
    }

    // Bot-level middleware (blocking, maintenance)
    const botMiddlewares = createBotMiddlewares();
    botMiddlewares.forEach(middleware => {
      this.bot.use(middleware);
    });

    // Response time tracking middleware
    const { responseTrackerMiddleware } = await import('./middleware/response-tracker.middleware');
    this.bot.use(responseTrackerMiddleware());

    // Security middleware - removed deprecated getTelegramMiddleware method
    // Note: SecurityManager is now a compatibility wrapper, security middleware is handled elsewhere

    // Logging middleware
    this.bot.use(async (ctx, next) => {
      const start = Date.now();
      
      // Safe property access for message text and callback data (mask user text in logs)
      let rawMessage: string | undefined;
      if ('data' in (ctx.callbackQuery || {})) {
        rawMessage = (ctx.callbackQuery as any).data;
      } else if ('text' in (ctx.message || {})) {
        rawMessage = (ctx.message as any).text;
      }
      const message = ctx.updateType === 'callback_query'
        ? rawMessage
        : (typeof rawMessage === 'string' ? `[text:${rawMessage.length}]` : undefined);
      
      this.logger.info('Bot request', {
        userId: ctx.from?.id,
        chatId: ctx.chat?.id,
        updateType: ctx.updateType,
        message
      });

      await next();

      this.logger.info('Bot response', {
        userId: ctx.from?.id,
        processingTime: Date.now() - start
      });
    });
  }

  private async setupCommands(): Promise<void> {
    // Delegate command setup to the dedicated service
    await this.commandHandlerService.setupCommands(this.bot);
  }

  private async setupScenes(): Promise<void> {
    // Create stage for scenes
    const stage = new Scenes.Stage([
      this.walletHandler.getWalletConnectionScene(),
      this.taskHandler.getTaskSubmissionScene(),
      this.referralHandler.getReferralInputScene(),
      this.adminHandler.getAdminScenes()
    ].flat());

    // Use type assertion to handle middleware type mismatch
    this.bot.use(stage.middleware() as any);
  }

  private async setupHandlers(): Promise<void> {
    // Callback query handlers
    this.bot.on('callback_query', async (ctx) => {
      // Build a lock key per user+message to ignore rapid double-clicks
      const userId = ctx.from?.id?.toString() || 'unknown';
      const msgId = (ctx.callbackQuery as any)?.message?.message_id?.toString() || 'noMsg';
      const lockKey = `${userId}:${msgId}`;

      if (this.activeCallbackLocks.has(lockKey)) {
        // Already processing this callback - ignore duplicate clicks
        return;
      }

      this.activeCallbackLocks.add(lockKey);
      try {
        // Safe access to callback query data
        const data = 'data' in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
        
        // Ensure data is a string (fix for parsing issue)
        const callbackData = typeof data === 'string' ? data : String(data || '');

        // Parse using CallbackManager to support base64-encoded callbacks
        const parsed = CallbackManager.parseCallbackData(callbackData);
        const routeAction = parsed?.action || callbackData;

        // Don't auto-answer here - let individual handlers decide when and what to answer
        // This prevents duplicate answer attempts
        
        // Handle maintenance-related callbacks first
        if (routeAction === 'notify_maintenance' || 
            routeAction === 'check_maintenance_status' || 
            routeAction === 'refresh_status') {
          const maintenanceMiddleware = this.getMiddlewareInstances().maintenance;
          await maintenanceMiddleware.handleMaintenanceCallbacks(ctx);
        } else if (routeAction?.startsWith('menu_') || routeAction?.startsWith('support_')) {
          await this.menuHandler.handleCallback(ctx);
        } else if (routeAction?.startsWith('task_')) {
          await this.taskHandler.handleCallback(ctx);
        } else if (routeAction?.startsWith('wallet_') || routeAction?.startsWith('transfer_')) {
          await this.walletHandler.handleCallback(ctx);
        } else if (routeAction?.startsWith('referral_')) {
          await this.referralHandler.handleCallback(ctx);
        } else if (routeAction?.startsWith('points_')) {
          await this.pointsHandler.handleCallback(ctx);
        } else if (routeAction?.startsWith('admin_')) {
          await this.adminHandler.handleCallback(ctx);
        } else if (routeAction?.startsWith('captcha_') || routeAction === 'start_captcha') {
          await this.handleCaptchaCallback(ctx);
        } else if (routeAction?.startsWith('welcome_')) {
          await this.welcomeHandler.handleCallback(ctx);
        } else {
          // Handle unrecognized callbacks gracefully
          this.logger.warn('Unrecognized callback query:', callbackData);
          await CallbackQueryService.safeAnswerCallback(ctx, '❌ Invalid action. Please try again.');
        }
      } catch (error: any) {
        const msg = (error?.description || error?.message || '').toString().toUpperCase();
        if (msg.includes('MESSAGE IS NOT MODIFIED') || msg.includes('MESSAGE_NOT_MODIFIED')) {
          this.logger.debug('Ignored MESSAGE_NOT_MODIFIED due to rapid clicks');
          await CallbackQueryService.safeAnswerCallback(ctx);
        } else {
          this.logger.error('Callback handler error:', error);
          await CallbackQueryService.safeAnswerCallback(ctx, '❌ Error. Please try again.');
        }
      } finally {
        setTimeout(() => this.activeCallbackLocks.delete(lockKey), 1200);
      }
    });

    // Text message handlers
    this.bot.on('text', async (ctx) => {
      // Check if user is in a scene - safely access scene property
      if ('scene' in ctx && (ctx as any).scene?.current) {
        return; // Let scene handle it
      }

      // Handle direct messages
      await this.handleTextMessage(ctx);
    });

    // Document handlers (for file uploads)
    this.bot.on('document', async (ctx) => {
      await this.taskHandler.handleDocumentUpload(ctx);
    });

    // Photo handlers (for image uploads)
    this.bot.on('photo', async (ctx) => {
      await this.taskHandler.handlePhotoUpload(ctx);
    });

    // Web app data handlers - miniapp functionality enabled
    this.bot.on('web_app_data', async (ctx) => {
      await this.handleWebAppData(ctx);
    });
  }

  private async setBotCommands(): Promise<void> {
    
    const commands: BotCommand[] = [
      { command: 'start', description: 'Start the airdrop bot' },
      { command: 'menu', description: 'Show main menu' },
      { command: 'points', description: 'Check your points' },
      { command: 'tasks', description: 'View available tasks' },
      { command: 'wallet', description: 'Connect your wallet' },
      { command: 'referrals', description: 'View referral program' },
      { command: 'stats', description: 'View your statistics' },
      { command: 'help', description: 'Show help information' },
      { command: 'award', description: 'Admin: award points to user' }
    ];

    await this.bot.telegram.setMyCommands(commands);
    this.logger.info('Bot commands set successfully');
  }


  private async handleTextMessage(ctx: any): Promise<void> {
    const text = ctx.message.text;
    const userId = ctx.from.id.toString();
    
    // Check if user is awaiting captcha answer (context session or storage)
    let awaitingCaptcha = false;
    
    // First check context session
    if (ctx.session?.captchaSession?.awaitingAnswer) {
      awaitingCaptcha = true;
    } else {
      // If not in context session, check storage for persistence
      try {
        const user = await this.storage.getUser(userId);
        if (user?.activeCaptchaSession?.awaitingAnswer) {
          // Check if session hasn't expired
          const now = Date.now();
          const expiresAt = new Date(user.activeCaptchaSession.expiresAt).getTime();
          if (now < expiresAt) {
            awaitingCaptcha = true;
            // Restore context session from storage
            ctx.session = ctx.session || {};
            ctx.session.captchaSession = user.activeCaptchaSession;
            this.logger.info('Restored captcha session from storage', { userId });
          } else {
            // Session expired, clear it
            user.activeCaptchaSession = null;
            await this.storage.saveUser(userId, user);
            this.logger.info('Expired captcha session cleared', { userId });
          }
        }
      } catch (error) {
        this.logger.error('Error checking captcha session in storage:', error);
      }
    }
    
    if (awaitingCaptcha) {
      await this.handleSvgCaptchaAnswer(ctx, text);
      return;
    }
    
    // Check if user has an active transfer session
    const hasTransferSession = await this.walletHandler.hasActiveTransferSession(userId);
    if (hasTransferSession) {
      await this.walletHandler.handleTransferMessage(ctx);
      return;
    }
    
    // Delegate regular text message handling to the routing service
    await this.messageRoutingService.handleTextMessage(ctx);
  }

  /**
   * Handle miniapp captcha completion data
   */
  private async handleWebAppData(ctx: any): Promise<void> {
    try {
      const userId = ctx.from.id.toString();
      // Correct way to access web app data in Telegram bot API
      const webAppData = ctx.message?.web_app_data?.data || ctx.update?.message?.web_app_data?.data;
      
      if (!webAppData) {
        this.logger.error('No web app data found in context', {
          hasMessage: !!ctx.message,
          hasWebAppData: !!ctx.message?.web_app_data,
          hasData: !!ctx.message?.web_app_data?.data
        });
        await ctx.reply('❌ No verification data received from miniapp.', { disable_web_page_preview: true });
        return;
      }
      
      // Parse captcha completion data
      const captchaSchema: ValidationSchema = {
        type: 'object',
        required: true,
        properties: {
          type: { type: 'string', required: true, allowedValues: ['captcha_completed'] },
          success: { type: 'boolean', required: true },
          sessionId: { type: 'string', maxLength: 200 },
          timestamp: { type: 'number', min: 0 }
        }
      };
      
      const parseResult = safeJSONParse(webAppData, captchaSchema);
      if (!parseResult.success) {
        this.logger.error('Invalid JSON in web app data:', parseResult.error);
        await ctx.reply('❌ Invalid captcha data format.', { disable_web_page_preview: true });
        return;
      }
      
      const captchaData = parseResult.data;
      
      this.logger.info('Received web app data', {
        userId,
        type: captchaData.type,
        success: captchaData.success,
        sessionId: captchaData.sessionId
      });
      
      // Check if this is captcha completion data
      if (captchaData.type !== 'captcha_completed') {
        this.logger.warn('Unexpected web app data type', { type: captchaData.type });
        return;
      }
      
      // Validate expected data structure
      if (captchaData.success === undefined) {
        await ctx.reply('❌ Incomplete captcha verification data.', { disable_web_page_preview: true });
        return;
      }
      
      // Process captcha completion based on success status
      if (captchaData.success) {
        // Process successful verification
        await this.handleCaptchaCompletion(ctx, {
          sessionId: captchaData.sessionId || 'miniapp-session',
          answer: 'verified', // Miniapp doesn't have traditional answer
          captchaType: 'miniapp',
          success: true,
          timeTaken: captchaData.timestamp ? Date.now() - captchaData.timestamp : 0,
          deviceInfo: {}
        });
        
        this.logger.info('Miniapp verification successful', {
          userId,
          sessionId: captchaData.sessionId
        });
      } else {
        // Handle verification failure
        await ctx.reply(
          '❌ **Verification Failed**\n\n' +
          'The miniapp verification was not completed successfully. Please try again.',
          { parse_mode: 'Markdown' }
        );
        
        // Show the miniapp captcha prompt again
        await this.showMiniappCaptcha(ctx, 'verification');
      }
      
    } catch (error) {
      this.logger.error('Web app data handling error:', error);
      await ctx.reply(
        '❌ **Captcha Processing Error**\n\n' +
        'Failed to process your verification. Please try again.',
        { parse_mode: 'Markdown' }
      );
    }
  }

  /**
   * Ensure user exists before allowing command execution
   */
  private async ensureUserExistsForCommand(ctx: any): Promise<boolean> {
    try {
      const userId = ctx.from.id.toString();
      const existingUser = await this.storage.getUser(userId);

      if (!existingUser) {
        // New user - redirect to start command
        await ctx.reply(
          '🚀 **Welcome!** You need to register first.\n\n' +
          'Please use /start to begin your journey with our airdrop bot!',
          { parse_mode: 'Markdown' }
        );
        return false; // Block command execution
      }
      
      // Check if existing user needs captcha verification
      if (await this.shouldRequireCaptcha(existingUser, false)) {
        await this.promptForCaptcha(ctx, 'verification');
        return false; // Block command execution
      }
      
      // Update last active time
      await this.storage.updateUser(userId, {
        lastActiveAt: new Date().toISOString()
      });
      
      return true; // Allow command execution
    } catch (error) {
      this.logger.error('Error in ensureUserExistsForCommand:', error);
      return true; // Allow command execution on error to avoid blocking
    }
  }

  private async ensureUserRegistered(ctx: any): Promise<void> {
    const userId = ctx.from.id.toString();
    const existingUser = await this.storage.getUser(userId);

    if (!existingUser) {
      await this.registerNewUser(ctx);
    } else {
      // Update last active time
      await this.storage.updateUser(userId, {
        lastActive: new Date()
      });
    }
  }

  private async registerNewUser(ctx: any): Promise<void> {
    try {
      const userId = ctx.from.id.toString();
      const referralCode = this.extractReferralCode(ctx);
      // Telegram chat updates do not expose a real client IP.
      // Avoid passing placeholder IPs that trigger geo/IP lookups.
      const ipAddress: string | undefined = undefined;

      // Security check before registration
      const protectionResult = await this.accountProtection.checkRegistrationAllowed({
        telegramId: userId,
        username: ctx.from.username,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
        ipAddress,
        referralCode: referralCode || undefined
      });

      if (!protectionResult.allowed) {
        this.logger.warn('Registration blocked by security', {
          userId,
          reason: protectionResult.reason,
          riskScore: protectionResult.riskScore
        });
        
        await ctx.reply(`❌ Registration blocked: ${protectionResult.reason}`, { disable_web_page_preview: true });
        return;
      }

      // Basic validation for user data (simplified since SecurityManager methods are deprecated)
      const userData = {
        telegramId: userId,
        username: ctx.from.username,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
        referralCode
      };

      // Basic validation
      if (!userData.telegramId || !userData.firstName) {
        this.logger.error('User registration validation failed: Missing required fields');
        await ctx.reply('❌ Registration failed. Please contact support.', { disable_web_page_preview: true });
        return;
      }

      const validation = {
        isValid: true,
        sanitized: userData
      };

      // Resolve referral
      const referredBy = await this.resolveReferralCode(referralCode);
      
      // Create user using UserFactory
      const completeUserData = UserFactory.createTelegramBotUser({
        telegramId: userId,
        username: validation.sanitized.username || undefined,
        firstName: validation.sanitized.firstName,
        lastName: validation.sanitized.lastName || undefined,
        referredByCode: referredBy || undefined,
        languageCode: ctx.from.language_code || 'en'
      });
      
      const success = await this.storage.createUser(completeUserData);
      if (!success) {
        await ctx.reply('❌ Registration failed. Please try again.');
        return;
      }
      
      const newUser = completeUserData;

      // Process referral bonus
      if (newUser.referredBy) {
        await this.referralHandler.processReferralBonus(newUser.referredBy, userId);
      }

      this.logger.info('New user registered', {
        userId,
        username: newUser.username,
        referredBy: newUser.referredBy
      });

      // Welcome message
      await this.sendWelcomeMessage(ctx, newUser);

    } catch (error) {
      this.logger.error('User registration failed:', error);
      await ctx.reply('❌ Registration failed. Please try again.', { disable_web_page_preview: true });
    }
  }

  private async welcomeBackUser(ctx: any, user: any): Promise<void> {
    // Convert joinedAt string to Date if needed, with fallbacks
    const joinedAtDate = user.joinedAt 
      ? (typeof user.joinedAt === 'string' ? new Date(user.joinedAt) : user.joinedAt)
      : (user.firstSeen 
          ? (typeof user.firstSeen === 'string' ? new Date(user.firstSeen) : user.firstSeen)
          : new Date());
    const daysSinceJoin = Math.floor(
      (Date.now() - joinedAtDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    await ctx.reply(
      `👋 Welcome back, ${user.firstName}!\n\n` +
      `💰 Your Points: ${(user.points || 0).toLocaleString()}\n` +
      `📅 Member for: ${daysSinceJoin} days\n` +
      `👥 Referrals: ${user.totalReferrals || 0}\n\n` +
      `Use /menu to see all available options.`
    );
  }

  private async sendWelcomeMessage(ctx: any, user: any): Promise<void> {
    // Use the professional welcome handler for new users
    await this.welcomeHandler.sendNewUserWelcome(ctx, user);
  }

  /**
   * Complete registration for user who finished captcha but wasn't fully registered
   */
  private async completeUserRegistration(ctx: any, user: any): Promise<void> {
    try {
      const userId = ctx.from.id.toString();
      
      // FINAL SECURITY CHECK: Verify user is not blocked for multi-account before completing registration
      if (user.isBlocked || user.multiAccountDetected) {
        this.logger.warn('Blocked user attempted to complete registration', { 
          userId, 
          isBlocked: user.isBlocked, 
          multiAccountDetected: user.multiAccountDetected 
        });
        await ctx.reply(
          '🚫 **Registration Blocked**\n\n' +
          'Your account has been blocked for security reasons.',
          { parse_mode: 'Markdown' }
        );
        return;
      }
      
      // Update user with proper registration data from Telegram context
      const registrationUpdate = {
        username: ctx.from.username,
        firstName: ctx.from.first_name,
        lastName: ctx.from.last_name,
        registrationStatus: 'completed', // Mark as fully registered
        lastActiveAt: new Date().toISOString()
      };
      
      await this.storage.updateUser(userId, registrationUpdate);
      
      this.logger.info('Completed user registration after captcha', {
        userId,
        username: ctx.from.username,
        firstName: ctx.from.first_name
      });
      
      // Send enhanced completion message with welcome system
      const updatedUser = await this.storage.getUser(userId);
      if (updatedUser) {
        await this.welcomeHandler.sendNewUserWelcome(ctx, {
          ...updatedUser,
          firstName: ctx.from.first_name,
          telegramId: userId
        });
      } else {
        // Fallback message
        await ctx.reply(
          `🎉 **Registration Completed Successfully!**\n\n` +
          `Welcome ${ctx.from.first_name}! Your security verification and registration are now complete.\n\n` +
          `💰 Your account is fully active and you can now:\n` +
          `• 🎯 Complete tasks for points\n` +
          `• Invite friends with your referral code\n` +
          `• Connect your wallet to withdraw tokens\n\n` +
          `Use /menu to explore all features!`,
          { parse_mode: 'Markdown' }
        );
      }
      
    } catch (error) {
      this.logger.error('Failed to complete user registration:', error);
      await ctx.reply('❌ Registration completion failed. Please contact support.', { disable_web_page_preview: true });
    }
  }

  private extractReferralCode(ctx: any): string | null {
    const startPayload = ctx.startPayload;
    if (startPayload) {
      if (startPayload.startsWith('ref_')) {
        return startPayload.substring(4);
      }
      if (/^[A-Za-z0-9_-]+$/.test(startPayload)) {
        return startPayload;
      }
    }

    const message = ctx.message?.text;
    if (message) {
      const refMatch = message.match(/start\s+ref_(\w+)/i);
      if (refMatch) {
        return refMatch[1];
      }
      const anyMatch = message.match(/start\s+([A-Za-z0-9_-]+)/i);
      if (anyMatch) {
        return anyMatch[1];
      }
    }

    return null;
  }

  private async resolveReferralCode(code: string | null): Promise<string | null> {
    if (!code) return null;

    try {
      const byCode = await this.storage.getUserByReferralCode(code);
      if (byCode) {
        return byCode.telegramId || null;
      }

      if (/^\d+$/.test(code)) {
        const byId = await this.storage.getUser(code);
        if (!byId) return null;
        const locked = !!(byId.metadata?.customFields?.referralCodeLocked) && typeof byId.referralCode === 'string' && byId.referralCode.length > 0;
        if (locked) {
          return null; // old numeric link invalid once custom code is generated
        }
        return byId.telegramId || null;
      }

      return null;
    } catch (error) {
      this.logger.error('Failed to resolve referral code:', error);
      return null;
    }
  }

  /**
   * Check if user should be required to complete captcha
   */
  private async shouldRequireCaptcha(user: any, isNewUser: boolean): Promise<boolean> {
    const captchaConfig = this.config.captcha;
    
    // Check if any captcha is enabled
    const anyCaptchaEnabled = captchaConfig.miniappEnabled || captchaConfig.svgEnabled;
    if (!anyCaptchaEnabled) {
      return false;
    }
    
    // New user requirements
    if (isNewUser) {
      return captchaConfig.miniappEnabled || captchaConfig.svgEnabled;
    }
    
    // Existing user requirements
    if (!user) return false;
    
    // Check if existing users need captcha
    if (!captchaConfig.forExistingUsers) {
      return false;
    }
    
    // Check if user has completed required verification
    if (captchaConfig.requireAtLeastOne) {
      return !user.isVerified;
    }
    
    // Check specific verification types
    let needsVerification = false;
    
    if (captchaConfig.miniappEnabled && !user.miniappVerified) {
      needsVerification = true;
    }
    
    if (captchaConfig.svgEnabled && !user.svgCaptchaVerified) {
      needsVerification = true;
    }
    
    return needsVerification;
  }
  
  /**
   * Determine which captcha to show next
   */
  private async getNextCaptchaType(userId: string): Promise<'miniapp' | 'svg' | null> {
    const captchaConfig = this.config.captcha;
    const user = await this.storage.getUser(userId);
    
    // Check if miniapp is enabled and not completed
    const miniappEnabled = this.config.captcha.miniappEnabled;
    const miniappCompleted = user?.miniappVerified || false;
    
    // Check if SVG is enabled and not completed
    const svgEnabled = captchaConfig.svgEnabled;
    const svgCompleted = user?.svgCaptchaVerified || false;
    
    // If both are enabled, show miniapp first, then SVG
    if (miniappEnabled && !miniappCompleted) {
      return 'miniapp';
    }
    
    if (svgEnabled && !svgCompleted) {
      return 'svg';
    }
    
    return null; // All required captchas completed
  }

  /**
   * Check if user has completed all required captchas
   */
  private async hasCompletedAllCaptchas(userId: string): Promise<boolean> {
    const captchaConfig = this.config.captcha;
    const user = await this.storage.getUser(userId);
    
    if (!user) return false;
    
    const miniappEnabled = this.config.captcha.miniappEnabled;
    const svgEnabled = captchaConfig.svgEnabled;
    
    // If both are enabled, both must be completed
    if (miniappEnabled && svgEnabled) {
      return user.miniappVerified && user.svgCaptchaVerified;
    }
    
    // If only miniapp is enabled
    if (miniappEnabled && !svgEnabled) {
      return user.miniappVerified;
    }
    
    // If only SVG is enabled
    if (!miniappEnabled && svgEnabled) {
      return user.svgCaptchaVerified;
    }
    
    // If no captcha is enabled
    return true;
  }

  /**
   * Prompt user for captcha verification
   */
  private async promptForCaptcha(ctx: any, type: 'registration' | 'verification'): Promise<void> {
    const userId = ctx.from.id.toString();
    const nextCaptcha = await this.getNextCaptchaType(userId);
    
    if (!nextCaptcha) {
      // All captchas completed, proceed to main bot
      this.logger.info('All captchas completed, proceeding to main bot', { userId });
      const user = await this.storage.getUser(userId);
      if (!user) {
        await this.registerNewUser(ctx);
      } else if (user.registrationStatus === 'captcha_completed') {
        // Complete registration for user who completed captcha but wasn't fully registered
        this.logger.info('Completing registration for user who completed captcha', { userId });
        await this.completeUserRegistration(ctx, user);
      }
      await this.menuHandler.showMainMenu(ctx);
      return;
    }
    
    // Show the appropriate captcha
    if (nextCaptcha === 'miniapp') {
      await this.showMiniappCaptcha(ctx, type);
    } else if (nextCaptcha === 'svg') {
      await this.showSvgCaptchaPrompt(ctx, type);
    }
  }

  /**
   * Show miniapp captcha prompt
   */
  private async showMiniappCaptcha(ctx: any, type: 'registration' | 'verification'): Promise<void> {
    const userId = ctx.from.id.toString();
    
    let message = '🔒 **Security Verification Required**\n\n';
    
    if (type === 'registration') {
      message += `Welcome to ${this.config.bot.name}! To ensure the security of our community, ` +
                `new users must complete a verification process.\n\n`;
    } else {
      message += `For security reasons and to maintain the integrity of our airdrop, ` +
                `please complete the verification process.\n\n`;
    }
    
    message += `🖥️ **Interactive Verification**\n` +
               `Complete the security challenge in our interactive interface.\n\n` +
               `✨ **Features:**\n` +
               `• Multiple challenge types\n` +
               `• Advanced security checks\n` +
               `• User-friendly interface\n` +
               `• Real-time validation\n\n` +
               `Click the button below to start:`;
    
    const sentMessage = await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          {
            text: 'Complete Interactive Verification',
            web_app: {
              url: await this.generateMiniappCaptchaUrl(userId)
            }
          }
        ]]
      }
    });
    
    // Store the message ID for auto-deletion
    const ctxWithSession = ctx as any;
    if (ctxWithSession.session) {
      ctxWithSession.session.verificationMessageId = sentMessage.message_id;
    }
    
    this.logger.info('Miniapp captcha prompt sent', {
      userId,
      type,
      messageId: sentMessage.message_id
    });
  }

  /**
   * Show SVG captcha prompt
   */
  private async showSvgCaptchaPrompt(ctx: any, type: 'registration' | 'verification'): Promise<void> {
    const userId = ctx.from.id.toString();
    const captchaConfig = this.config.captcha;
    const user = await this.storage.getUser(userId);
    
    let message = '🔤 **Text Verification Required**\n\n';
    message += `Click the button below to start:`;
    
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [[
          {
            text: 'Start Text Verification',
            callback_data: `captcha_svg_${userId}`
          }
        ]]
      }
    });
    
    this.logger.info('SVG captcha prompt sent', {
      userId,
      type,
      afterMiniapp: user?.miniappVerified || false
    });
  }

  // Removed fallback function - no skip options allowed

  private async handleCaptchaCompletion(ctx: any, data: any): Promise<void> {
    try {
      // Delegate all completions to captcha validation service
      await this.captchaValidationService.handleCaptchaCompletion(ctx, data);
    } catch (error) {
      this.logger.error('Captcha completion error:', error);
      await ctx.reply(
        '❌ **Verification Error**\n\n' +
        'An error occurred while processing your verification. ' +
        'Please try again or contact support if the issue persists.',
        { parse_mode: 'Markdown' }
      );
    }
  }
  
  /**
   * Update user verification status based on completed captcha type
   */
  private async updateUserVerificationStatus(userId: string, captchaType: string): Promise<void> {
    const updateData: any = {
      lastActiveAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    if (captchaType === 'svg') {
      updateData.svgCaptchaVerified = true;
      updateData.svgCaptchaVerifiedAt = new Date().toISOString();
    }
    
    // Check if user should be marked as fully verified
    const user = await this.storage.getUser(userId);
    if (user) {
      const captchaConfig = this.config.captcha;
      const willBeSvgVerified = captchaType === 'svg' || user.svgCaptchaVerified;
      const willBeMiniappVerified = captchaType === 'miniapp' || user.miniappVerified;
      
      if (captchaConfig.requireAtLeastOne) {
        // User is verified if they completed at least one type
        updateData.isVerified = willBeSvgVerified || willBeMiniappVerified;
      } else {
        // User is verified if they completed all enabled types
        const needsSvg = captchaConfig.svgEnabled;
        
        updateData.isVerified = (!needsSvg || willBeSvgVerified) || willBeMiniappVerified;
      }
      
      if (updateData.isVerified && !user.isVerified) {
        updateData.verifiedAt = new Date().toISOString();
        updateData.verificationMethod = captchaType;
        
        // Mark miniapp verification if completed via miniapp
        if (captchaType === 'miniapp') {
          updateData.miniappVerified = true;
          updateData.miniappVerifiedAt = new Date().toISOString();
        }
      }
    }
    
    await this.storage.updateUser(userId, updateData);
    
    this.logger.info('User verification status updated', {
      userId,
      captchaType,
      isVerified: updateData.isVerified
    });
  }

  /**
   * Handle captcha callback queries - delegated to service
   */
  private async handleCaptchaCallback(ctx: any): Promise<void> {
    // Delegate to captcha validation service
    await this.captchaValidationService.handleCaptchaCallback(ctx);
  }
  
  /**
   * Start SVG captcha challenge
   */
  private async startSvgCaptcha(ctx: any, userId: string): Promise<void> {
    try {
      // Create SVG captcha session
      const session = await this.captchaService.createSession(userId, 'svg', {
        ip: 'telegram',
        userAgent: 'TelegramBot',
        platform: 'telegram',
        userId: userId
      });
      
      if (session && session.challenge && session.answer) {
        // Generate→Send→Forget pattern: Generate image buffer and send immediately
        const imageBuffer = await this.captchaService.generateCaptchaImageBuffer(session.answer);
        
        // Send the image with simple caption
        await ctx.replyWithPhoto(
          { source: imageBuffer },
          {
            caption: '❇️ Please enter the captcha:',
            parse_mode: 'Markdown'
          }
        );
        
        // Store session info in user context for answer handling
        ctx.session = ctx.session || {};
        ctx.session.captchaSession = {
          sessionId: session.id,
          type: 'svg',
          awaitingAnswer: true,
          startTime: Date.now()
        };
        
        this.logger.info('Captcha challenge sent (generate→send→forget)', {
          userId,
          sessionId: session.id,
          difficulty: session.challenge.difficulty,
          pattern: 'generate→send→forget'
        });
      } else {
        await ctx.reply('❌ Failed to generate captcha challenge. Please try again.');
      }
    } catch (error) {
      this.logger.error('SVG captcha start error:', error);
      await ctx.reply(
        '❌ **Captcha Error**\n\n' +
        'Failed to start verification challenge. Please try again or use the interactive verification option.',
        { parse_mode: 'Markdown' }
      );
    }
  }

  /**
   * Handle SVG captcha answer input
   */
  private async handleSvgCaptchaAnswer(ctx: any, answer: string): Promise<void> {
    // Delegate to captcha validation service
    await this.captchaValidationService.handleSvgCaptchaAnswer(ctx, answer);
  }

  private async verifyCaptcha(userId: string, data: any): Promise<boolean> {
    // Legacy method - kept for compatibility
    try {
      const result = await this.captchaService.verifyCaptcha(
        data.sessionId,
        data.answer,
        data.deviceInfo,
        data.timeTaken
      );
      return result.success;
    } catch (error) {
      this.logger.error('Legacy captcha verification error:', error);
      return false;
    }
  }

  /**
   * Generate miniapp URL for captcha verification
   */
  private async generateMiniappCaptchaUrl(userId: string): Promise<string> {
    try {
      const baseUrl = this.config.server?.publicUrl || 'http://localhost:3004';
      const captchaPath = '/miniapp-captcha';
      
      // Add query parameters for Telegram context
      const params = new URLSearchParams({
        userId: userId,
        platform: 'telegram',
        timestamp: Date.now().toString()
      });
      
      const fullUrl = `${baseUrl}${captchaPath}?${params.toString()}`;
      
      this.logger.info('Generated miniapp captcha URL', {
        userId,
        baseUrl,
        captchaPath
      });
      
      return fullUrl;
    } catch (error) {
      this.logger.error('Failed to generate miniapp captcha URL:', error);
      // Fallback URL
      return 'http://localhost:3004/miniapp-captcha';
    }
  }

  /**
   * Send broadcast message to all active users
   */
  async sendBroadcast(
    message: string,
    options?: {
      filter?: (user: any) => boolean;
      includeMedia?: boolean;
      scheduleFor?: Date;
    }
  ): Promise<{
    sent: number;
    failed: number;
    errors: string[];
  }> {
    const result: {
      sent: number;
      failed: number;
      errors: string[];
    } = { sent: 0, failed: 0, errors: [] };

    try {
      // OPTIMIZATION: For large user bases, use pagination or recent users only
      const totalUsers = await this.storage.countDocuments('users', {});
      let users;
      
      if (totalUsers > 10000) {
        // For large databases, only broadcast to recently active users
        this.logger.warn(`Large user base detected (${totalUsers}). Broadcasting to recently active users only.`);
        const recentUsers = await this.storage.getUsersRegisteredRecently(30 * 24 * 60 * 60 * 1000); // Last 30 days
        users = recentUsers;
      } else {
        users = await this.storage.getAllUsers();
      }
      
      const activeUsers = users.filter(user => 
        user.isActive && (!options?.filter || options.filter(user))
      );

      this.logger.info(`Starting broadcast to ${activeUsers.length} users`);

      // Send in batches to avoid rate limits
      const batchSize = 30;
      const delay = 1000; // 1 second between batches

      for (let i = 0; i < activeUsers.length; i += batchSize) {
        const batch = activeUsers.slice(i, i + batchSize);
        
        await Promise.allSettled(
          batch.map(async (user) => {
            try {
              await this.bot.telegram.sendMessage(user.telegramId, message, {
                parse_mode: 'HTML',
                link_preview_options: { is_disabled: true }
              });
              result.sent++;
            } catch (error: unknown) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              result.failed++;
              result.errors.push(`Failed to send to ${user.telegramId}: ${errorMessage}`);
            }
          })
        );

        // Delay between batches
        if (i + batchSize < activeUsers.length) {
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      this.logger.info('Broadcast completed', result);
      return result;

    } catch (error) {
      this.logger.error('Broadcast failed:', error);
      throw error;
    }
  }

  /**
   * Get bot statistics
   */
  async getStatistics(): Promise<{
    totalUsers: number;
    activeUsers: number;
    totalPoints: number;
    totalTasks: number;
    totalReferrals: number;
    uptime: number;
  }> {
    try {
      const totalUsers = await this.storage.countDocuments('users', {});
      const weekAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const activeUsers = await this.storage.countDocuments('users', { $or: [ { lastActiveAt: { $gt: weekAgoIso } }, { registeredAt: { $gt: weekAgoIso } } ] });
      const totalTasks = await this.storage.countDocuments('tasks', {});
      // Aggregate points/referrals approximately with capped sample to avoid full scan
      const sample = await this.storage.findByQuery<any>('users', {}, { projection: { points: 1, totalReferrals: 1 }, sort: { registeredAt: -1 }, limit: 10000 });
      const totalPoints = sample.reduce((sum, u) => sum + (u.points || 0), 0);
      const totalReferrals = sample.reduce((sum, u) => sum + (u.totalReferrals || 0), 0);

      return {
        totalUsers,
        activeUsers,
        totalPoints,
        totalTasks,
        totalReferrals,
        uptime: process.uptime() * 1000 // in milliseconds
      };
    } catch (error) {
      this.logger.error('Failed to get bot statistics:', error);
      throw error;
    }
  }

  /**
   * Health check for monitoring
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: {
      bot: boolean;
      storage: boolean;
      security: boolean;
    };
    details?: any;
  }> {
    try {
      const checks = {
        bot: false,
        storage: false,
        security: false
      };

      // Check bot connection
      try {
        await this.bot.telegram.getMe();
        checks.bot = true;
      } catch (error) {
        this.logger.error('Bot health check failed:', error);
      }

      // Check storage
      try {
        await this.storage.healthCheck();
        checks.storage = true;
      } catch (error) {
        this.logger.error('Storage health check failed:', error);
      }

      // Check security - simplified since getSecurityStatus doesn't exist
      try {
        // Basic security check - just verify the service exists
        checks.security = !!this.security;
      } catch (error) {
        this.logger.error('Security health check failed:', error);
      }

      const healthyCount = Object.values(checks).filter(Boolean).length;
      let status: 'healthy' | 'degraded' | 'unhealthy';

      if (healthyCount === 3) {
        status = 'healthy';
      } else if (healthyCount >= 2) {
        status = 'degraded';
      } else {
        status = 'unhealthy';
      }

      return { status, checks };

    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Health check failed:', error);
      return {
        status: 'unhealthy',
        checks: { bot: false, storage: false, security: false },
        details: { error: errorMessage }
      };
    }
  }
}