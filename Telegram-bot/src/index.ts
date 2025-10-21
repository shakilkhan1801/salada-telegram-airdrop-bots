// Crypto polyfill for Node.js environment
import { Crypto } from '@peculiar/webcrypto';

// Set up global crypto polyfill
if (typeof globalThis.crypto === 'undefined') {
    globalThis.crypto = new Crypto();
}

import 'reflect-metadata';
import { Logger } from './services/logger';
import { getConfig } from './config';
import { storage } from './storage';
import { initializeSecurity } from './security';
import { createAdminServer, AdminServer } from './admin/server';
import { TelegramBot } from './bot/telegram-bot';
import MiniAppCaptchaServer from './miniapp-captcha/server';
import { BroadcastQueueService } from './services/broadcast-queue.service';
import { DeviceManagementService } from './services/device-management.service';
import { ErrorHandlerService } from './services/error-handler.service';
import { MemoryManager } from './services/memory-manager.service';
import SessionSchedulerService from './services/session/session-scheduler.service';
import { dbOptimizationIntegration } from './services/database/db-optimization-integration.service';
import { AsyncProcessingIntegrationService } from './services/async-processing-integration.service';
import SimpleUserExportScheduler from './services/simple-user-export-scheduler.service';
import { MaintenanceMiddleware } from './bot/middleware/maintenance.middleware';

// Initialize logger
const logger = Logger.getInstance();

/**
 * Health check result interface defining the structure of health monitoring data.
 * Used by the healthCheck method to provide comprehensive system status.
 */
interface HealthCheckResult {
  server: {
    status: 'healthy' | 'unhealthy';
    uptime: number;
    memory: NodeJS.MemoryUsage;
  };
  storage: {
    status: 'healthy' | 'unhealthy' | 'unknown';
    error?: string;
  };
  miniAppServer?: {
    status: 'healthy' | 'unhealthy';
    port?: number;
  };
  adminServer?: {
    status: 'healthy' | 'unhealthy';
    port?: number;
  };
  telegramBot?: {
    status: 'healthy' | 'unhealthy';
  };
}

/**
 * Configuration options for the MainServer instance.
 * Controls which services are started and their configuration.
 * 
 * @example
 * ```typescript
 * const options: ServerOptions = {
 *   startAdmin: true,
 *   startBot: false,
 *   adminPort: 3002,
 *   corsOrigins: ['http://localhost:3000']
 * };
 * ```
 */
export interface ServerOptions {
  startAdmin?: boolean;
  startBot?: boolean;
  startMiniApp?: boolean;
  adminPort?: number;
  miniAppPort?: number;
  corsOrigins?: string[];
}

/**
 * Main server class that orchestrates all services for the Telegram Airdrop Bot.
 * Manages initialization, startup, and shutdown of admin server, Telegram bot,
 * MiniApp server, and all supporting services.
 * 
 * @example
 * ```typescript
 * const server = new MainServer({
 *   startAdmin: true,
 *   startBot: true,
 *   adminPort: 3002
 * });
 * await server.initialize();
 * await server.start();
 * ```
 */
export class MainServer {
  // SECURITY FIX: Proper server typing for type safety
  private adminServer?: AdminServer;
  private telegramBot?: TelegramBot;
  private miniAppServer?: MiniAppCaptchaServer;
  private broadcastService?: BroadcastQueueService;
  private deviceManagementService?: DeviceManagementService;
  private errorHandlerService?: ErrorHandlerService;
  private memoryManager?: MemoryManager;
  private dbOptimization = dbOptimizationIntegration;
  private asyncProcessingService?: AsyncProcessingIntegrationService;
  private config = getConfig();
  private isInitialized = false;

  constructor(private options: ServerOptions = {}) {
    this.setupDefaults();
  }

  /**
   * Sets up default configuration options for the server.
   * Merges provided options with system defaults.
   * 
   * @private
   * @returns {void}
   */
  private setupDefaults() {
    this.options = {
      startAdmin: true,
      startBot: true,
      startMiniApp: true,
      adminPort: this.config.server.ports.admin || 3002,
      miniAppPort: this.config.server.ports.api || 3001,
      corsOrigins: this.config.admin?.corsOrigins || ['http://localhost:3000', 'http://localhost:5173'],
      ...this.options
    };
  }

  /**
   * Initializes all services in the correct order.
   * This method must be called before starting the server.
   * 
   * @async
   * @returns {Promise<void>} Promise that resolves when all services are initialized
   * @throws {Error} If any service fails to initialize
   * 
   * @example
   * ```typescript
   * const server = new MainServer();
   * await server.initialize();
   * ```
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Main server already initialized');
      return;
    }

    try {
      logger.info('🚀 Starting Telegram Airdrop Bot Pro...');
      logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

      // Initialize core services
      logger.info('📊 Initializing storage...');
      await storage.initialize();

      // Initialize or retrieve bot start time for persistent uptime tracking
      try {
        const systemConfig = await storage.get<any>('system_config', 'global');
        if (!systemConfig?.botStartTime) {
          // First time starting - save the start time
          const startTime = new Date().toISOString();
          await storage.set('system_config', { 
            ...systemConfig, 
            id: 'global', 
            botStartTime: startTime 
          }, 'global');
          logger.info(`🕐 Bot start time initialized: ${startTime}`);
        } else {
          logger.info(`🕐 Bot start time loaded: ${systemConfig.botStartTime}`);
        }
      } catch (e) {
        logger.warn('Failed to initialize bot start time, will use process uptime');
      }

      // Load persisted system settings before starting any services
      try {
        const persisted = await storage.get<any>('system_config', 'global');
        if (persisted && typeof persisted === 'object') {
          logger.info('🔧 Applying persisted system settings');
          const cfg = (await import('./config')).config as any;
          const env = process.env as any;
          const s = persisted || {};
          // Points / Withdraw
          if (s.points?.minWithdraw !== undefined) { cfg.points.minWithdraw = Number(s.points.minWithdraw); env.MIN_WITHDRAW_POINTS = String(cfg.points.minWithdraw); }
          if (s.points?.conversionRate !== undefined) { cfg.points.conversionRate = Number(s.points.conversionRate); env.POINTS_TO_TOKEN_CONVERSION_RATE = String(cfg.points.conversionRate); }
          if (s.points?.instagramFollow !== undefined) { cfg.points.instagramFollow = Number(s.points.instagramFollow); env.POINTS_INSTAGRAM_FOLLOW = String(cfg.points.instagramFollow); }
          if (s.points?.requireChannelJoinForWithdrawal !== undefined) { cfg.points.requireChannelJoinForWithdrawal = !!s.points.requireChannelJoinForWithdrawal; env.WITHDRAW_REQUIRE_CHANNEL_JOIN = String(cfg.points.requireChannelJoinForWithdrawal); }
          // Bot settings (channel IDs, etc.)
          if (s.bot?.requiredChannelId !== undefined) { cfg.bot.requiredChannelId = String(s.bot.requiredChannelId); env.REQUIRED_CHANNEL_ID = String(s.bot.requiredChannelId); }
          if (s.bot?.withdrawAlertChannelId !== undefined) { cfg.bot.withdrawAlertChannelId = String(s.bot.withdrawAlertChannelId); env.WITHDRAW_ALERT_CHANNEL_ID = String(s.bot.withdrawAlertChannelId); }
          // Transfer
          if (s.points?.transfer) {
            const tr = s.points.transfer;
            if (tr.enabled !== undefined) { cfg.points.transfer.enabled = !!tr.enabled; env.TRANSFER_ENABLED = String(cfg.points.transfer.enabled); }
            if (tr.minAmount !== undefined) { cfg.points.transfer.minAmount = Number(tr.minAmount); env.TRANSFER_MIN_POINTS = String(cfg.points.transfer.minAmount); }
            if (tr.maxAmount !== undefined) { cfg.points.transfer.maxAmount = Number(tr.maxAmount); env.TRANSFER_MAX_POINTS = String(cfg.points.transfer.maxAmount); }
            if (tr.maxDailyAmount !== undefined) { cfg.points.transfer.maxDailyAmount = Number(tr.maxDailyAmount); env.TRANSFER_MAX_DAILY_POINTS = String(cfg.points.transfer.maxDailyAmount); }
            if (tr.feePercentage !== undefined) { cfg.points.transfer.feePercentage = Number(tr.feePercentage); env.TRANSFER_FEE_PERCENTAGE = String(cfg.points.transfer.feePercentage); }
            if (tr.dailyLimit !== undefined) { cfg.points.transfer.dailyLimit = Number(tr.dailyLimit); env.TRANSFER_DAILY_LIMIT = String(cfg.points.transfer.dailyLimit); }
            if (tr.requireConfirmation !== undefined) { cfg.points.transfer.requireConfirmation = !!tr.requireConfirmation; env.TRANSFER_REQUIRE_CONFIRMATION = String(cfg.points.transfer.requireConfirmation); }
          }
          // Tasks
          if (s.task?.autoApproveSubmissions !== undefined) { cfg.task.autoApproveSubmissions = !!s.task.autoApproveSubmissions; env.AUTO_APPROVE_SUBMISSIONS = String(cfg.task.autoApproveSubmissions); }
          // Wallet support
          if (s.wallet?.apps) {
            cfg.wallet.apps = { ...cfg.wallet.apps, ...s.wallet.apps };
            for (const [k,v] of Object.entries(s.wallet.apps)) env['SHOW_' + String(k).toUpperCase() + '_WALLET'] = String(!!v);
          }
          // Captcha (safe subset)
          if (s.captcha) {
            const cp = s.captcha;
            if (cp.miniappEnabled !== undefined) { cfg.captcha.miniappEnabled = !!cp.miniappEnabled; env.MINIAPP_CAPTCHA_ENABLED = String(cfg.captcha.miniappEnabled); }
            if (cp.svgEnabled !== undefined) { cfg.captcha.svgEnabled = !!cp.svgEnabled; env.SVG_CAPTCHA_ENABLED = String(cfg.captcha.svgEnabled); }
            if (cp.requireAtLeastOne !== undefined) { cfg.captcha.requireAtLeastOne = !!cp.requireAtLeastOne; env.REQUIRE_AT_LEAST_ONE_CAPTCHA = String(cfg.captcha.requireAtLeastOne); }
            if (cp.forExistingUsers !== undefined) { cfg.captcha.forExistingUsers = !!cp.forExistingUsers; env.CAPTCHA_FOR_EXISTING_USERS = String(cfg.captcha.forExistingUsers); }
            if (cp.sessionTimeout !== undefined) { cfg.captcha.sessionTimeout = Number(cp.sessionTimeout); env.CAPTCHA_SESSION_TIMEOUT = String(cfg.captcha.sessionTimeout); }
            if (cp.maxAttempts !== undefined) { cfg.captcha.maxAttempts = Number(cp.maxAttempts); env.CAPTCHA_MAX_ATTEMPTS = String(cfg.captcha.maxAttempts); }
          }
          // Wallet config (safe fields only)
          if (s.walletConfig) {
            const w = s.walletConfig;
            if (w.chainId !== undefined) { cfg.wallet.chainId = Number(w.chainId); env.CHAIN_ID = String(cfg.wallet.chainId); }
            if (w.rpcUrl !== undefined) { cfg.wallet.rpcUrl = String(w.rpcUrl); env.RPC_URL = cfg.wallet.rpcUrl; }
            if (w.explorerUrl !== undefined) { cfg.wallet.explorerUrl = String(w.explorerUrl); env.EXPLORER_URL = cfg.wallet.explorerUrl; }
            if (w.confirmationsToWait !== undefined) { cfg.wallet.confirmationsToWait = Number(w.confirmationsToWait); env.WITHDRAW_CONFIRMATIONS = String(cfg.wallet.confirmationsToWait); }
            if (w.tokenContractAddress !== undefined) { cfg.wallet.tokenContractAddress = String(w.tokenContractAddress); env.TOKEN_CONTRACT_ADDRESS = cfg.wallet.tokenContractAddress; }
            if (w.claimContractAddress !== undefined) { cfg.wallet.claimContractAddress = String(w.claimContractAddress); env.CLAIM_CONTRACT_ADDRESS = cfg.wallet.claimContractAddress; }
            if (w.tokenSymbol !== undefined) { cfg.wallet.tokenSymbol = String(w.tokenSymbol); env.TOKEN_SYMBOL = cfg.wallet.tokenSymbol; }
            if (w.tokenDecimals !== undefined) { cfg.wallet.tokenDecimals = Number(w.tokenDecimals); env.TOKEN_DECIMALS = String(cfg.wallet.tokenDecimals); }
          }
          // Auto user data export
          if (s.userDataExport) {
            const u = s.userDataExport;
            if (u.enabled !== undefined) env.ENABLE_USER_DATA_EXPORT = String(!!u.enabled);
            if (u.interval !== undefined) env.USER_DATA_EXPORT_INTERVAL = String(u.interval);
            if (u.runOnStart !== undefined) env.USER_DATA_EXPORT_RUN_ON_START = String(!!u.runOnStart);
          }
          // Bot status (persisted)
          if (s.botStatus) {
            const mm = MaintenanceMiddleware.getInstance();
            await mm.setMaintenanceMode(!!s.botStatus.isMaintenanceMode, s.botStatus.expectedDuration, s.botStatus.reason);
            if (typeof s.botStatus.isBotOffline === 'boolean') {
              await mm.setBotStatus(!s.botStatus.isBotOffline);
            }
          }
          // Bot config (alert channels)
          if (s.bot?.withdrawAlertChannelId !== undefined) {
            cfg.bot.withdrawAlertChannelId = String(s.bot.withdrawAlertChannelId);
            env.WITHDRAW_ALERT_CHANNEL_ID = cfg.bot.withdrawAlertChannelId;
          }
          // Referral settings
          if (s.referral) {
            const ref = s.referral;
            if (ref.referralBonus !== undefined) { cfg.bot.referralBonus = Number(ref.referralBonus); env.REFERRAL_BONUS = String(cfg.bot.referralBonus); }
            if (ref.referralWelcomeBonus !== undefined) { cfg.bot.referralWelcomeBonus = Number(ref.referralWelcomeBonus); env.REFERRAL_WELCOME_BONUS = String(cfg.bot.referralWelcomeBonus); }
            if (ref.referralWelcomeBonusEnabled !== undefined) { cfg.bot.referralWelcomeBonusEnabled = !!ref.referralWelcomeBonusEnabled; env.REFERRAL_WELCOME_BONUS_ENABLED = String(cfg.bot.referralWelcomeBonusEnabled); }
            if (ref.codeLength !== undefined) { cfg.referral.codeLength = Number(ref.codeLength); env.REFERRAL_CODE_LENGTH = String(cfg.referral.codeLength); }
            if (ref.taskThreshold !== undefined) { cfg.referral.taskThreshold = Number(ref.taskThreshold); env.REFERRAL_TASK_THRESHOLD = String(cfg.referral.taskThreshold); }
          }
        }
      } catch (e) {
        logger.warn('No persisted system settings found or failed to apply');
      }

      logger.info('🔒 Initializing security system...');
      await initializeSecurity();

      // Initialize database optimization services
      logger.info('⚡ Initializing database optimization...');
      await this.dbOptimization.initialize();

      // Initialize database error logger
      logger.info('📋 Initializing database error logger...');
      const { databaseErrorLogger } = await import('./services/database-error-logger.service');
      await databaseErrorLogger.initialize();

      // Initialize bot response monitor
      logger.info('📊 Initializing bot response monitor...');
      const { botResponseMonitor } = await import('./services/bot-response-monitor.service');
      await botResponseMonitor.initialize();

      // Initialize async processing services
      if (process.env.FEATURE_BACKGROUND_JOBS === 'true') {
        logger.info('🔄 Initializing async processing...');
        this.asyncProcessingService = AsyncProcessingIntegrationService.getInstance();
        await this.asyncProcessingService.initialize();
      } else {
        logger.info('⏭️ Skipping async processing (disabled in config)');
      }

      // Initialize simple user export scheduler
      if (process.env.ENABLE_USER_DATA_EXPORT === 'true') {
        logger.info('📊 Initializing user data export scheduler...');
        await SimpleUserExportScheduler.start();
      }

      // Initialize session security scheduler
      logger.info('🔐 Starting session security scheduler...');
      SessionSchedulerService.start();

      // Initialize memory manager early
      logger.info('🧠 Initializing memory manager...');
      this.memoryManager = MemoryManager.getInstance();
      await this.memoryManager.initialize({
        enableMonitoring: true,
        monitoringInterval: 60000, // 1 minute
        enableLRUCaches: true,
        enableGarbageCollection: true,
        alertThresholds: {
          warning: 256, // 256MB
          critical: 400  // 400MB
        }
      });

      // Initialize error handler service
      logger.info('⚠️ Initializing error handler...');
      this.errorHandlerService = ErrorHandlerService.getInstance();
      await this.errorHandlerService.initialize();

      // Initialize device management service
      logger.info('🔧 Initializing device management...');
      this.deviceManagementService = DeviceManagementService.getInstance();
      await this.deviceManagementService.initialize();

      // Initialize broadcast queue service
      logger.info('📤 Initializing broadcast queue...');
      this.broadcastService = BroadcastQueueService.getInstance();

      // Initialize miniapp server
      if (this.options.startMiniApp) {
        logger.info('📱 Initializing MiniApp server...');
        // Use MiniAppCaptchaServer which now includes both captcha and HTTP API routes
        this.miniAppServer = new MiniAppCaptchaServer(this.options.miniAppPort);
      }

      // Initialize admin server
      if (this.options.startAdmin) {
        logger.info('🖥️  Initializing admin server...');
        this.adminServer = createAdminServer({
          port: this.options.adminPort,
          corsOrigins: this.options.corsOrigins
        });
        await this.adminServer.initialize();
      }

      // Initialize Telegram bot
      if (this.options.startBot) {
        logger.info('🤖 Initializing Telegram bot...');
        this.telegramBot = new TelegramBot();
        await this.telegramBot.initialize();
        
        // Initialize broadcast service with bot instance
        if (this.broadcastService && this.telegramBot.bot) {
          await this.broadcastService.initialize(this.telegramBot.bot);
        }
      }

      this.isInitialized = true;
      logger.info('✅ Main server initialized successfully');
    } catch (error) {
      logger.error('❌ Failed to initialize main server:', error);
      throw error;
    }
  }

  /**
   * Starts all initialized services concurrently.
   * Services are started in parallel for optimal performance.
   * 
   * @async
   * @returns {Promise<void>} Promise that resolves when all services are started
   * @throws {Error} If any service fails to start
   * 
   * @example
   * ```typescript
   * const server = new MainServer();
   * await server.start(); // This will initialize first if needed
   * ```
   */
  async start(): Promise<void> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    try {
      // PRODUCTION FIX: Optimized webhook handler for high throughput
      if (this.adminServer && this.telegramBot && this.config.bot.useWebhook) {
        const app = this.adminServer.getApp();
        const log = Logger.getInstance();
        const webhookTimeout = parseInt(process.env.WEBHOOK_RESPONSE_TIMEOUT_MS || '25000');
        
        app.post('/webhook', async (req, res): Promise<void> => {
          try {
            // Step 1: Validate webhook secret (< 1ms)
            const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
            const got = (req.headers['x-telegram-bot-api-secret-token'] as string | undefined) || '';
            if (expected && got !== expected) {
              log.warn('Webhook authentication failed');
              try { res.status(401).end(); } catch {}
              return;
            }
            
            // Step 2: CRITICAL - Immediately acknowledge (< 50ms)
            // This prevents Telegram from retrying the webhook
            res.status(200).json({ ok: true });
            
            // Step 3: Extract update info
            const update = req.body;
            const updateId = update.update_id;
            
            if (!updateId) {
              log.warn('Webhook received update without ID');
              return;
            }
            
            // Step 4: Process update with timeout protection (async, non-blocking)
            // NOTE: Deduplication is handled in bot middleware (telegram-bot.ts)
            // Don't check here to avoid double-checking
            Promise.race([
              this.telegramBot!.getInstance().handleUpdate(update),
              new Promise((_, reject) => 
                setTimeout(() => reject(new Error('Webhook processing timeout')), webhookTimeout)
              )
            ]).catch((err) => {
              log.error('Webhook update processing error', { 
                updateId,
                error: (err as any)?.message || String(err),
                timeout: err.message === 'Webhook processing timeout'
              });
            });
            
          } catch (e) {
            log.error('Webhook handler critical error', e);
            try { res.status(500).end(); } catch {}
          }
        });
        
        log.info('Production-grade webhook handler initialized', {
          timeout: webhookTimeout,
          deduplication: 'Bot middleware',
          fastAck: true
        });
      }
      const startPromises: Promise<void>[] = [];

      // Start miniapp server
      if (this.miniAppServer) {
        logger.info('📱 Starting MiniApp server...');
        startPromises.push(this.miniAppServer.start());
      }

      // Start admin server
      if (this.adminServer) {
        logger.info('🖥️  Starting admin server...');
        startPromises.push(this.adminServer.start());
      }

      // Start Telegram bot
      if (this.telegramBot) {
        logger.info('🤖 Starting Telegram bot...');
        startPromises.push(this.telegramBot.start());
      }

      // Wait for all services to start
      await Promise.all(startPromises);

      // Log startup success
      this.logStartupSuccess();

      // Setup graceful shutdown
      this.setupGracefulShutdown();

    } catch (error) {
      logger.error('❌ Failed to start services:', error);
      throw error;
    }
  }

  /**
   * Gracefully stops all running services.
   * Services are stopped in parallel with proper cleanup.
   * 
   * @async
   * @returns {Promise<void>} Promise that resolves when all services are stopped
   * @throws {Error} If any service fails to stop gracefully
   * 
   * @example
   * ```typescript
   * await server.stop();
   * ```
   */
  async stop(): Promise<void> {
    logger.info('🔄 Stopping services...');

    try {
      // SECURITY FIX: Proper promise typing for service shutdown
      const stopPromises: Promise<void>[] = [];

      // Stop miniapp server
      if (this.miniAppServer) {
        logger.info('🛑 Stopping MiniApp server...');
        stopPromises.push(this.miniAppServer.stop());
      }

      // Stop admin server
      if (this.adminServer) {
        logger.info('🛑 Stopping admin server...');
        stopPromises.push(this.adminServer.stop());
      }

      // Stop broadcast service
      if (this.broadcastService) {
        logger.info('🛑 Stopping broadcast service...');
        stopPromises.push(this.broadcastService.stop());
      }

      // Stop device management service
      if (this.deviceManagementService) {
        logger.info('🛑 Stopping device management...');
        stopPromises.push(this.deviceManagementService.stop());
      }

      // Stop Telegram bot
      if (this.telegramBot) {
        logger.info('🛑 Stopping Telegram bot...');
        stopPromises.push(this.telegramBot.stop());
      }

      // Stop memory manager
      if (this.memoryManager) {
        logger.info('🛑 Stopping memory manager...');
        stopPromises.push(this.memoryManager.stop());
      }

      // Stop database optimization
      if (this.dbOptimization) {
        logger.info('🛑 Stopping database optimization...');
        stopPromises.push(this.dbOptimization.shutdown());
      }

      // Stop async processing services
      if (this.asyncProcessingService) {
        logger.info('🛑 Stopping async processing...');
        stopPromises.push(this.asyncProcessingService.shutdown());
      }

      // Stop session security scheduler
      logger.info('🛑 Stopping session security scheduler...');
      SessionSchedulerService.stop();

      // Wait for all services to stop
      await Promise.all(stopPromises);

      // Close storage
      logger.info('📊 Closing storage...');
      await storage.close();
      
      // Windows-specific: Kill any remaining processes on ports
      if (process.platform === 'win32') {
        logger.info('🧹 Cleaning up Windows ports...');
        const { exec } = await import('child_process');
        const ports = [
          this.options.adminPort,
          this.options.miniAppPort
        ].filter(Boolean) as number[];
        
        for (const port of ports) {
          await new Promise<void>((resolve) => {
            exec(`netstat -ano | findstr :${port}`, (error, stdout) => {
              if (!error && stdout) {
                const lines = stdout.trim().split('\n');
                const pids = new Set<string>();
                
                lines.forEach(line => {
                  const parts = line.trim().split(/\s+/);
                  const pid = parts[parts.length - 1];
                  if (pid && pid !== '0' && pid !== process.pid.toString()) {
                    pids.add(pid);
                  }
                });
                
                pids.forEach(pid => {
                  try {
                    process.kill(parseInt(pid), 'SIGKILL');
                    logger.info(`Killed process ${pid} on port ${port}`);
                  } catch (e) {
                    // Process might have already exited
                  }
                });
              }
              resolve();
            });
          });
        }
      }

      logger.info('✅ All services stopped successfully');
    } catch (error) {
      logger.error('❌ Error during service shutdown:', error);
      throw error;
    }
  }

  /**
   * Logs detailed startup information including service status and configuration.
   * Provides comprehensive overview of running services and their endpoints.
   * 
   * @private
   * @returns {void}
   */
  private logStartupSuccess() {
    logger.info('🎉 Telegram Airdrop Bot Pro started successfully!');
    logger.info('');
    logger.info('📋 Service Status:');
    
    if (this.miniAppServer) {
      logger.info(`   📱 MiniApp Captcha: http://localhost:${this.options.miniAppPort}`);
      logger.info(`   🔗 Captcha API: http://localhost:${this.options.miniAppPort}/api/captcha`);
      logger.info(`   🔗 MiniApp API: http://localhost:${this.options.miniAppPort}/api/miniapp`);
    }
    
    if (this.adminServer) {
      const adminOptions = this.adminServer.getOptions();
      logger.info(`   🖥️  Admin Panel: http://localhost:${adminOptions.port}/admin`);
      logger.info(`   🔗 Admin API: http://localhost:${adminOptions.port}/api`);
    }
    
    if (this.telegramBot) {
      logger.info('   🤖 Telegram Bot: Running');
    }
    
    if (this.broadcastService) {
      logger.info('   📤 Broadcast Queue: Active');
    }
    
    if (this.deviceManagementService) {
      logger.info('   🔧 Device Management: Active');
    }
    
    if (this.memoryManager) {
      logger.info('   🧠 Memory Manager: Active');
    }
    
    if (this.dbOptimization) {
      logger.info('   ⚡ Database Optimization: Active');
    }
    
    if (this.asyncProcessingService) {
      logger.info('   🔄 Async Processing: Active');
    }

    logger.info(`   📊 Storage: ${this.config.storage.source}`);
    logger.info(`   🔒 Security: Enabled`);
    logger.info(`   🛡️ Spam Control: window=${process.env.SPAM_WINDOW_MS || '60000'}ms, warn=${process.env.SPAM_WARN_THRESHOLD || '5'}, freeze=${process.env.SPAM_FREEZE_THRESHOLD || '8'} for ${process.env.SPAM_FREEZE_MINUTES || '10'}m, warnCooldown=${process.env.SPAM_WARNING_COOLDOWN_MS || '300000'}ms`);
    logger.info('');
    
    logger.info('🔧 Configuration:');
    logger.info(`   Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`   Node Version: ${process.version}`);
    logger.info(`   Memory Usage: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`);
    logger.info('');
    
    logger.info('📖 Documentation: Check DEVELOPMENT_GUIDE.md for more information');
    logger.info('🐛 Issues: Report bugs and feature requests on GitHub');
  }

  /**
   * Sets up graceful shutdown handlers for various process signals.
   * Handles SIGTERM, SIGINT, SIGUSR2, unhandled rejections, and uncaught exceptions.
   * 
   * @private
   * @returns {void}
   */
  private setupGracefulShutdown() {
    let isShuttingDown = false;
    let shutdownTimeout: NodeJS.Timeout | null = null;
    
    const gracefulShutdown = async (signal: string) => {
      // Prevent multiple shutdown attempts
      if (isShuttingDown) {
        logger.warn(`Already shutting down, ignoring ${signal}`);
        return;
      }
      
      isShuttingDown = true;
      logger.info(`${signal} received. Starting graceful shutdown...`);
      
      // Windows-specific: Set forced exit timeout
      if (process.platform === 'win32') {
        shutdownTimeout = setTimeout(() => {
          logger.error('Graceful shutdown timed out, forcing exit...');
          // Force exit on Windows
          process.exit(1);
        }, 10000); // 10 seconds timeout
      }
      
      try {
        await this.stop();
        logger.info('Graceful shutdown completed');
        
        if (shutdownTimeout) {
          clearTimeout(shutdownTimeout);
        }
        
        // Windows-specific: Clean up handles before exit
        if (process.platform === 'win32') {
          // Clear all active handles
          const activeHandles = (process as any)._getActiveHandles?.();
          if (activeHandles) {
            activeHandles.forEach((handle: any) => {
              if (handle.unref) {
                handle.unref();
              }
            });
          }
          
          // Short delay for Windows cleanup
          setTimeout(() => {
            process.exit(0);
          }, 100).unref();
        } else {
          process.exit(0);
        }
      } catch (error) {
        logger.error('Error during graceful shutdown:', error);
        
        if (shutdownTimeout) {
          clearTimeout(shutdownTimeout);
        }
        
        process.exit(1);
      }
    };

    // Handle different termination signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    
    // Windows-specific signals
    if (process.platform === 'win32') {
      process.on('SIGBREAK', () => gracefulShutdown('SIGBREAK')); // Ctrl+Break on Windows
    } else {
      process.on('SIGUSR2', () => gracefulShutdown('SIGUSR2')); // nodemon restart on Unix
    }

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.warn('Unhandled Rejection', { promise, reason });
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      gracefulShutdown('Uncaught Exception');
    });
  }

  /**
   * Gets comprehensive server statistics and runtime information.
   * 
   * @returns {object} Object containing uptime, memory usage, CPU usage, service status, and configuration
   * 
   * @example
   * ```typescript
   * const stats = server.getStats();
   * console.log(`Uptime: ${stats.uptime} seconds`);
   * console.log(`Memory: ${stats.memoryUsage.rss} bytes`);
   * ```
   */
  getStats() {
    const stats = {
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      isInitialized: this.isInitialized,
      services: {
        adminServer: !!this.adminServer,
        telegramBot: !!this.telegramBot,
        miniAppServer: !!this.miniAppServer
      },
      config: {
        environment: process.env.NODE_ENV || 'development',
        nodeVersion: process.version,
        storage: this.config.storage.source,
        adminPort: this.options.adminPort
      }
    };

    if (this.adminServer && typeof this.adminServer.getServerStats === 'function') {
      stats.services = {
        ...stats.services,
        ...this.adminServer.getServerStats()
      };
    }

    return stats;
  }

  /**
   * Performs comprehensive health check of all services.
   * Tests connectivity and status of storage, servers, and bot.
   * 
   * @async
   * @returns {Promise<HealthCheckResult>} Detailed health status of all services
   * 
   * @example
   * ```typescript
   * const health = await server.healthCheck();
   * if (health.server.status === 'healthy') {
   *   console.log('Server is running normally');
   * }
   * ```
   */
  async healthCheck(): Promise<HealthCheckResult> {
    // SECURITY FIX: Proper return type for health monitoring
    const checks: HealthCheckResult = {
      server: {
        status: this.isInitialized ? 'healthy' : 'unhealthy',
        uptime: process.uptime(),
        memory: process.memoryUsage()
      },
      storage: {
        status: 'unknown'
      }
    };

    try {
      // Check storage connection
      const healthCheck = await storage.healthCheck(); healthCheck.status === "healthy";
      checks.storage.status = 'healthy';
    } catch (error) {
      checks.storage.status = 'unhealthy';
      checks.storage.error = error instanceof Error ? error.message : 'Unknown error';
    }

    // Check miniapp server
    if (this.miniAppServer) {
      checks.miniAppServer = {
        status: 'healthy',
        port: this.options.miniAppPort
      };
    }

    // Check admin server
    if (this.adminServer) {
      checks.adminServer = {
        status: this.adminServer.isServerInitialized() ? 'healthy' : 'unhealthy',
        port: this.options.adminPort
      };
    }

    // Check Telegram bot
    if (this.telegramBot) {
      checks.telegramBot = {
        status: 'healthy' // TelegramBot would need a health check method
      };
    }

    return checks;
  }

  /**
   * Gets the MiniApp server instance.
   * 
   * @returns {MiniAppCaptchaServer | undefined} MiniApp server instance if initialized, undefined otherwise
   * 
   * @example
   * ```typescript
   * const miniApp = server.getMiniAppServer();
   * if (miniApp) {
   *   console.log('MiniApp server is available');
   * }
   * ```
   */
  getMiniAppServer() {
    return this.miniAppServer;
  }

  /**
   * Gets the admin server instance.
   * 
   * @returns {AdminServer | undefined} Admin server instance if initialized, undefined otherwise
   * 
   * @example
   * ```typescript
   * const admin = server.getAdminServer();
   * if (admin) {
   *   const options = admin.getOptions();
   *   console.log(`Admin running on port ${options.port}`);
   * }
   * ```
   */
  getAdminServer() {
    return this.adminServer;
  }

  /**
   * Gets the Telegram bot instance.
   * 
   * @returns {TelegramBot | undefined} Telegram bot instance if initialized, undefined otherwise
   * 
   * @example
   * ```typescript
   * const bot = server.getTelegramBot();
   * if (bot && bot.bot) {
   *   await bot.bot.telegram.sendMessage(chatId, 'Hello!');
   * }
   * ```
   */
  getTelegramBot() {
    return this.telegramBot;
  }

  /**
   * Gets the broadcast queue service instance.
   * 
   * @returns {BroadcastQueueService | undefined} Broadcast service instance if initialized, undefined otherwise
   * 
   * @example
   * ```typescript
   * const broadcast = server.getBroadcastService();
   * if (broadcast) {
   *   await broadcast.queueMessage('Hello everyone!', 'all');
   * }
   * ```
   */
  getBroadcastService() {
    return this.broadcastService;
  }

  /**
   * Gets the device management service instance.
   * 
   * @returns {DeviceManagementService | undefined} Device management service if initialized, undefined otherwise
   * 
   * @example
   * ```typescript
   * const deviceMgr = server.getDeviceManagementService();
   * if (deviceMgr) {
   *   const devices = await deviceMgr.getActiveDevices();
   * }
   * ```
   */
  getDeviceManagementService() {
    return this.deviceManagementService;
  }

  /**
   * Gets the error handler service instance.
   * 
   * @returns {ErrorHandlerService | undefined} Error handler service if initialized, undefined otherwise
   * 
   * @example
   * ```typescript
   * const errorHandler = server.getErrorHandlerService();
   * if (errorHandler) {
   *   errorHandler.handleError(new Error('Test error'));
   * }
   * ```
   */
  getErrorHandlerService() {
    return this.errorHandlerService;
  }

  /**
   * Gets the memory manager service instance.
   * 
   * @returns {MemoryManager | undefined} Memory manager instance if initialized, undefined otherwise
   * 
   * @example
   * ```typescript
   * const memoryMgr = server.getMemoryManager();
   * if (memoryMgr) {
   *   const stats = memoryMgr.getMemoryStats();
   *   console.log(`Memory usage: ${stats.used}MB`);
   * }
   * ```
   */
  getMemoryManager() {
    return this.memoryManager;
  }

  /**
   * Gets the database optimization service instance.
   * 
   * @returns {object} Database optimization service instance
   * 
   * @example
   * ```typescript
   * const dbOpt = server.getDatabaseOptimization();
   * const stats = await dbOpt.getOptimizationStats();
   * ```
   */
  getDatabaseOptimization() {
    return this.dbOptimization;
  }

  /**
   * Gets the async processing service instance.
   * 
   * @returns {AsyncProcessingIntegrationService | undefined} Async processing service if initialized, undefined otherwise
   * 
   * @example
   * ```typescript
   * const asyncService = server.getAsyncProcessingService();
   * if (asyncService) {
   *   const jobId = await asyncService.queueJob('processData', { data: 'test' });
   * }
   * ```
   */
  getAsyncProcessingService() {
    return this.asyncProcessingService;
  }

  /**
   * Checks if the server has been initialized.
   * 
   * @returns {boolean} True if server is initialized, false otherwise
   * 
   * @example
   * ```typescript
   * if (server.isServerInitialized()) {
   *   console.log('Server is ready to start');
   * }
   * ```
   */
  isServerInitialized() {
    return this.isInitialized;
  }
}

// Create main server instance
let mainServerInstance: MainServer | null = null;

/**
 * Creates a singleton MainServer instance with the specified options.
 * Ensures only one server instance exists throughout the application lifecycle.
 * 
 * @param {ServerOptions} [options] - Configuration options for the server
 * @returns {MainServer} The MainServer singleton instance
 * 
 * @example
 * ```typescript
 * const server = createMainServer({
 *   startAdmin: true,
 *   adminPort: 3002
 * });
 * ```
 */
export function createMainServer(options?: ServerOptions): MainServer {
  if (!mainServerInstance) {
    mainServerInstance = new MainServer(options);
  }
  return mainServerInstance;
}

/**
 * Gets the existing MainServer singleton instance.
 * 
 * @returns {MainServer} The MainServer instance
 * @throws {Error} If no server instance has been created yet
 * 
 * @example
 * ```typescript
 * // After createMainServer() has been called
 * const server = getMainServer();
 * await server.start();
 * ```
 */
export function getMainServer(): MainServer {
  if (!mainServerInstance) {
    throw new Error('Main server not created. Call createMainServer() first.');
  }
  return mainServerInstance;
}

/**
 * Default export of the MainServer class.
 * Main orchestrator for the Telegram Airdrop Bot system.
 */
export default MainServer;

// CLI entry point
if (require.main === module) {
  const startServer = async () => {
    try {
      // Parse command line arguments
      const args = process.argv.slice(2);
      const options: ServerOptions = {};

      // Parse CLI options
      if (args.includes('--admin-only')) {
        options.startAdmin = true;
        options.startBot = false;
        options.startMiniApp = false;
      } else if (args.includes('--bot-only')) {
        options.startAdmin = false;
        options.startBot = true;
        options.startMiniApp = false;
      } else if (args.includes('--miniapp-only')) {
        options.startAdmin = false;
        options.startBot = false;
        options.startMiniApp = true;
      }

      const portIndex = args.indexOf('--port');
      if (portIndex !== -1 && args[portIndex + 1]) {
        options.adminPort = parseInt(args[portIndex + 1]);
      }
      
      const miniAppPortIndex = args.indexOf('--miniapp-port');
      if (miniAppPortIndex !== -1 && args[miniAppPortIndex + 1]) {
        options.miniAppPort = parseInt(args[miniAppPortIndex + 1]);
      }

      // Create and start server
      const server = createMainServer(options);
      await server.start();
      
    } catch (error) {
      logger.error('❌ Failed to start server:', error);
      process.exit(1);
    }
  };

  startServer();
}