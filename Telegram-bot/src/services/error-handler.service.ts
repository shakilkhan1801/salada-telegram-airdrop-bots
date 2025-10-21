import { Logger } from './logger';
import { Context, Telegraf } from 'telegraf';

export interface ErrorHandlerConfig {
  enableUncaughtExceptionHandler: boolean;
  enableUnhandledRejectionHandler: boolean;
  enableTimeoutWrapper: boolean;
  defaultTimeoutMs: number;
  walletConnectErrorFiltering: boolean;
  enableCallbackQueryAgeCheck: boolean;
  maxCallbackQueryAge: number; // milliseconds
}

export interface TimeoutError extends Error {
  name: 'TimeoutError';
  isTimeout: boolean;
}

export class ErrorHandlerService {
  private static instance: ErrorHandlerService;
  private readonly logger = Logger.getInstance();
  private config: ErrorHandlerConfig = {
    enableUncaughtExceptionHandler: true,
    enableUnhandledRejectionHandler: true,
    enableTimeoutWrapper: true,
    defaultTimeoutMs: 30000,
    walletConnectErrorFiltering: true,
    enableCallbackQueryAgeCheck: true,
    maxCallbackQueryAge: 60000 // 60 seconds
  };

  private constructor() {}

  static getInstance(): ErrorHandlerService {
    if (!ErrorHandlerService.instance) {
      ErrorHandlerService.instance = new ErrorHandlerService();
    }
    return ErrorHandlerService.instance;
  }

  /**
   * Initialize error handler service
   */
  async initialize(config?: Partial<ErrorHandlerConfig>): Promise<void> {
    try {
      if (config) {
        this.config = { ...this.config, ...config };
      }

      this.setupGlobalErrorHandlers();
      this.makeTimeoutGloballyAvailable();

      this.logger.info('✅ Error handler service initialized');
    } catch (error) {
      this.logger.error('❌ Failed to initialize error handler service:', error);
      throw error;
    }
  }

  /**
   * Setup global error handlers for uncaught exceptions and unhandled rejections
   */
  private setupGlobalErrorHandlers(): void {
    if (this.config.enableUncaughtExceptionHandler) {
      process.on('uncaughtException', (error) => {
        this.logger.error('🚨 Uncaught Exception:', error);
        
        // Log additional context
        this.logger.error('Process memory usage:', process.memoryUsage());
        this.logger.error('Process uptime:', process.uptime());
        
        // Don't exit the process in production, just log the error
        if (process.env.NODE_ENV === 'production') {
          this.logger.error('⚠️ Continuing operation after uncaught exception (production mode)');
        } else {
          this.logger.error('💀 Process will exit due to uncaught exception (development mode)');
          process.exit(1);
        }
      });
    }

    if (this.config.enableUnhandledRejectionHandler) {
      process.on('unhandledRejection', (reason, promise) => {
        // Filter out expected WalletConnect errors
        if (this.config.walletConnectErrorFiltering && this.isExpectedWalletConnectError(reason)) {
          this.logWalletConnectWarning(reason);
          return;
        }

        this.logger.error('🚨 Unhandled Rejection at:', promise);
        this.logger.error('Reason:', reason);
        
        // Don't exit the process, just log the error
        if (process.env.NODE_ENV !== 'production') {
          this.logger.warn('⚠️ Unhandled rejection in development mode - consider fixing this');
        }
      });
    }
  }

  /**
   * Check if error is an expected WalletConnect error that should be filtered
   */
  private isExpectedWalletConnectError(reason: any): boolean {
    if (!reason || typeof reason !== 'object') {
      return false;
    }

    const message = reason.message || '';
    
    // Common expected WalletConnect errors
    const expectedPatterns = [
      'Request expired',
      'Proposal expired',
      'Session expired',
      'User disapproved',
      'User rejected',
      'Connection timeout',
      'QR code expired'
    ];

    return expectedPatterns.some(pattern => 
      message.toLowerCase().includes(pattern.toLowerCase())
    );
  }

  /**
   * Log WalletConnect warning for expected errors
   */
  private logWalletConnectWarning(reason: any): void {
    const message = reason?.message || 'Unknown WalletConnect error';
    
    if (message.includes('Request expired')) {
      this.logger.warn('⏰ WalletConnect request expired - user took too long to respond');
    } else if (message.includes('Proposal expired')) {
      this.logger.warn('⏰ WalletConnect proposal expired - QR code timed out');
    } else if (message.includes('User disapproved') || message.includes('User rejected')) {
      this.logger.warn('👤 WalletConnect request rejected by user');
    } else {
      this.logger.warn(`⚠️ Expected WalletConnect error: ${message}`);
    }
  }

  /**
   * Make timeout wrapper function globally available
   */
  private makeTimeoutGloballyAvailable(): void {
    if (this.config.enableTimeoutWrapper) {
      (global as any).withTimeout = this.withTimeout.bind(this);
      this.logger.debug('✅ Global withTimeout function available');
    }
  }

  /**
   * Wrap promise with timeout
   */
  withTimeout<T>(promise: Promise<T>, timeoutMs?: number): Promise<T> {
    const timeout = timeoutMs || this.config.defaultTimeoutMs;
    
    return Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        setTimeout(() => {
          const timeoutError = new Error(`Operation timed out after ${timeout}ms`) as TimeoutError;
          timeoutError.name = 'TimeoutError';
          timeoutError.isTimeout = true;
          reject(timeoutError);
        }, timeout);
      })
    ]);
  }

  /**
   * Create Telegraf error handler
   */
  createTelegrafErrorHandler(): (err: Error, ctx: Context) => Promise<void> {
    return async (err: Error, ctx: Context) => {
      try {
        this.logger.error(`🤖 Bot error for ${ctx.updateType}:`, err);

        // Check if the error should be ignored
        if (this.shouldIgnoreError(err)) {
          this.logger.debug('🔇 Ignoring expected error to prevent spam');
          return;
        }

        // Handle callback query if applicable
        if (ctx.callbackQuery) {
          await this.handleCallbackQueryError(ctx, err);
        }

        // Send error message to user for unexpected errors
        if (!this.isTimeoutError(err) && !this.isWalletConnectError(err)) {
          await this.sendUserErrorMessage(ctx);
        }

      } catch (replyError) {
        this.logger.error('❌ Failed to handle bot error:', replyError);
      }
    };
  }

  /**
   * Handle callback query errors with age checking
   */
  private async handleCallbackQueryError(ctx: Context, err: Error): Promise<void> {
    if (!ctx.callbackQuery) {
      return;
    }

    if (this.config.enableCallbackQueryAgeCheck) {
      const callbackAge = Date.now() - (ctx.callbackQuery.message!.date * 1000);
      
      if (callbackAge > this.config.maxCallbackQueryAge) {
        this.logger.debug(`🕒 Callback query too old (${callbackAge}ms), skipping answerCbQuery`);
        return;
      }
    }

    try {
      await this.withTimeout(
        ctx.answerCbQuery('An error occurred. Please try again.'),
        3000
      );
    } catch (cbError) {
      this.logger.warn('⚠️ Failed to answer callback query:', cbError);
    }
  }

  /**
   * Send error message to user
   */
  private async sendUserErrorMessage(ctx: Context): Promise<void> {
    try {
      await this.withTimeout(
        ctx.reply('❌ An error occurred. Please try again later.', {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Main Menu', callback_data: 'main_menu' }]
            ]
          }
        }),
        5000
      );
    } catch (replyError) {
      this.logger.warn('⚠️ Failed to send error reply to user:', replyError);
    }
  }

  /**
   * Check if error should be ignored
   */
  private shouldIgnoreError(err: Error): boolean {
    if (!err.message) {
      return false;
    }

    const message = err.message.toLowerCase();

    // Ignore common expected errors
    const ignoredPatterns = [
      'query is too old',
      'promise timed out',
      'timeout',
      'user disapproved',
      'user rejected'
    ];

    return ignoredPatterns.some(pattern => message.includes(pattern));
  }

  /**
   * Check if error is a timeout error
   */
  private isTimeoutError(err: Error): boolean {
    return err.name === 'TimeoutError' || 
           err.constructor.name === 'TimeoutError' ||
           (err as any).isTimeout === true;
  }

  /**
   * Check if error is WalletConnect related
   */
  private isWalletConnectError(err: Error): boolean {
    if (!err.message) {
      return false;
    }

    const walletConnectPatterns = [
      'walletconnect',
      'wallet connect',
      'user disapproved',
      'user rejected'
    ];

    return walletConnectPatterns.some(pattern => 
      err.message.toLowerCase().includes(pattern)
    );
  }

  /**
   * Update configuration
   */
  updateConfig(newConfig: Partial<ErrorHandlerConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info('✅ Error handler configuration updated');
  }

  /**
   * Get current configuration
   */
  getConfig(): ErrorHandlerConfig {
    return { ...this.config };
  }

  /**
   * Get error statistics
   */
  getErrorStats(): {
    uncaughtExceptions: number;
    unhandledRejections: number;
    botErrors: number;
    timeoutErrors: number;
    walletConnectErrors: number;
  } {
    // This would require implementing error counting
    // For now, return placeholder stats
    return {
      uncaughtExceptions: 0,
      unhandledRejections: 0,
      botErrors: 0,
      timeoutErrors: 0,
      walletConnectErrors: 0
    };
  }
}