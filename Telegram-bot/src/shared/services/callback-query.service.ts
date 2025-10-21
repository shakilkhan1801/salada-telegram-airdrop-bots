import { Context } from 'telegraf';
import { Logger } from '../../services/logger';
import { nanoid } from '../../services/id';
import { MessageService } from './message.service';

interface ActionSession {
  id: string;
  userId: string;
  action: string;
  createdAt: number;
  expiresAt: number;
  metadata?: Record<string, any>;
}

/**
 * Enhanced callback query handling service with session-based timeout management
 * Eliminates duplicate callback query management logic across all bot handlers
 */
export class CallbackQueryService {
  private static readonly logger = Logger.getInstance();
  private static readonly CALLBACK_TIMEOUT_MS = 60000; // 60 seconds
  private static readonly actionSessions = new Map<string, ActionSession>();
  
  // Navigation actions that don't require strict timeout validation
  private static readonly NAVIGATION_ACTIONS = [
    'menu_main', 'menu_tasks', 'menu_referral', 'menu_wallet', 'menu_help',
    'wallet_show', 'wallet_history', 'wallet_connect', 'wallet_connect_new',
    'wallet_apps_more', 'transfer_history', 'wallet_transfer', 'wallet_withdraw',
    'wallet_disconnect', 'task_list', 'task_history', 'referral_stats', 'back_to_'
  ];

  /**
   * Safely answer callback query with automatic error handling
   * Handles the common "query is too old" error gracefully
   */
  static async safeAnswerCallback(ctx: Context, text?: string): Promise<boolean> {
    if (!ctx.callbackQuery) {
      return false;
    }

    try {
      await ctx.answerCbQuery(text);
      return true;
    } catch (error: any) {
      // Handle common callback query errors
      if (error.message?.includes('query is too old')) {
        this.logger.debug('Callback query too old - ignoring');
        return false;
      }
      
      if (error.message?.includes('query is already answered')) {
        this.logger.debug('Callback query already answered - ignoring');
        return false;
      }

      // Transient network errors: attempt one quick retry and downgrade log severity
      if (this.isTransientNetworkError(error)) {
        try {
          await new Promise((r) => setTimeout(r, 150));
          await ctx.answerCbQuery(text);
          return true;
        } catch (retryErr: any) {
          this.logger.warn('Callback answer retry failed (transient network error)', {
            code: retryErr?.code || retryErr?.errno,
            message: retryErr?.message
          });
          return false;
        }
      }

      // For other errors, log but don't throw
      this.logger.error('Error answering callback query:', {
        message: error?.message,
        code: error?.code || error?.errno
      });
      return false;
    }
  }

  private static isTransientNetworkError(error: any): boolean {
    const code = (error?.code || error?.errno || '').toString();
    const msg = (error?.message || '').toString();
    const transientCodes = ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'ECONNABORTED', 'ENOTFOUND'];
    if (transientCodes.some(c => code.includes(c))) return true;
    if (msg.includes('FetchError') || msg.includes('socket hang up') || msg.includes('read ECONNRESET') || msg.includes('network')) return true;
    return false;
  }

  /**
   * Answer callback query with a notification message
   */
  static async answerWithNotification(ctx: Context, text: string): Promise<boolean> {
    return await this.safeAnswerCallback(ctx, text);
  }

  /**
   * Answer callback query with an alert
   */
  static async answerWithAlert(ctx: Context, text: string): Promise<boolean> {
    if (!ctx.callbackQuery) {
      return false;
    }

    try {
      await ctx.answerCbQuery(text, { show_alert: true });
      return true;
    } catch (error: any) {
      return await this.handleCallbackError(error);
    }
  }

  /**
   * Create action session with unique identifier for timeout tracking
   */
  static createActionSession(
    userId: string,
    action: string,
    timeoutMs = this.CALLBACK_TIMEOUT_MS,
    metadata?: Record<string, any>
  ): string {
    const sessionId = nanoid();
    const now = Date.now();
    
    const session: ActionSession = {
      id: sessionId,
      userId,
      action,
      createdAt: now,
      expiresAt: now + timeoutMs,
      metadata
    };

    this.actionSessions.set(sessionId, session);
    
    // Auto cleanup after expiry + buffer
    setTimeout(() => {
      this.actionSessions.delete(sessionId);
    }, timeoutMs + 30000); // 30 second buffer for cleanup

    this.logger.debug('Action session created', {
      sessionId,
      userId,
      action,
      expiresAt: new Date(session.expiresAt).toISOString()
    });

    return sessionId;
  }

  /**
   * Validate action session by session ID
   */
  static isActionSessionValid(sessionId: string): boolean {
    const session = this.actionSessions.get(sessionId);
    
    if (!session) {
      this.logger.debug('Action session not found', { sessionId });
      return false;
    }

    const now = Date.now();
    const isValid = now <= session.expiresAt;

    if (!isValid) {
      this.logger.debug('Action session expired', {
        sessionId,
        action: session.action,
        createdAt: new Date(session.createdAt).toISOString(),
        expiresAt: new Date(session.expiresAt).toISOString(),
        ageSeconds: Math.floor((now - session.createdAt) / 1000)
      });
      
      // Remove expired session
      this.actionSessions.delete(sessionId);
    }

    return isValid;
  }

  /**
   * Check if callback query is too old (legacy method for backward compatibility)
   * Now enhanced with navigation action detection
   */
  static isCallbackValid(ctx: Context, skipNavigationCheck = false): boolean {
    if (!ctx.callbackQuery) {
      return false;
    }

    // Skip timeout validation for navigation actions unless explicitly requested
    if (!skipNavigationCheck) {
      const data = this.getCallbackData(ctx);
      if (data && this.isNavigationAction(data)) {
        this.logger.debug('Navigation action detected, skipping timeout validation', { action: data });
        return true;
      }
    }

    // Determine a reasonable query timestamp
    // Telegram callback queries don't include a 'date' field; fall back to message.date or now
    const msgDateSec = (ctx as any).callbackQuery?.message?.date;
    const queryTime = typeof msgDateSec === 'number' ? msgDateSec * 1000 : Date.now();
    const currentTime = Date.now();
    const age = currentTime - queryTime;
    
    // Safe debug logging with validation
    try {
      this.logger.debug('Callback validation:', {
        queryTime: new Date(queryTime).toISOString(),
        currentTime: new Date(currentTime).toISOString(),
        ageSeconds: Math.floor(age / 1000),
        timeoutSeconds: Math.floor(this.CALLBACK_TIMEOUT_MS / 1000),
        isValid: age <= this.CALLBACK_TIMEOUT_MS
      });
    } catch (error) {
      this.logger.debug('Debug logging failed:', { queryTime, currentTime, age });
    }

    return age <= this.CALLBACK_TIMEOUT_MS;
  }

  /**
   * Check if action is a navigation action
   */
  static isNavigationAction(action: string): boolean {
    return this.NAVIGATION_ACTIONS.some(navAction => 
      action === navAction || action.startsWith(navAction)
    );
  }

  /**
   * Handle callback with session validation
   */
  static async handleCallbackWithSession(
    ctx: Context,
    sessionId: string,
    handler: (ctx: Context, session: ActionSession) => Promise<void>,
    expiredMessage = '⏰ This action has expired. Please try again.'
  ): Promise<boolean> {
    if (!ctx.callbackQuery) {
      return false;
    }

    // Validate session
    if (!this.isActionSessionValid(sessionId)) {
      void this.safeAnswerCallback(ctx, expiredMessage);
      return false;
    }

    const session = this.actionSessions.get(sessionId);
    if (!session) {
      void this.safeAnswerCallback(ctx, expiredMessage);
      return false;
    }

    // Verify user
    const userId = ctx.from?.id?.toString();
    if (userId !== session.userId) {
      void this.safeAnswerCallback(ctx, '❌ Unauthorized action');
      return false;
    }

    try {
      // For task completion/submission sessions, do not ack immediately so handler can show a message.
      const action = session.action || '';
      const shouldFastAck = !(action.startsWith('task_complete_') || action.startsWith('task_submit_'));
      if (shouldFastAck) {
        // Fire-and-forget acknowledgment to avoid blocking on network
        void this.safeAnswerCallback(ctx);
      }
      
      // Execute handler
      await handler(ctx, session);
      
      return true;
    } catch (error) {
      this.logger.error('Error in session callback handler:', error);
      void this.safeAnswerCallback(ctx, '❌ An error occurred. Please try again.');
      return false;
    }
  }

  /**
   * Handle callback query with enhanced timeout validation
   */
  static async handleCallbackWithTimeout(
    ctx: Context,
    handler: (ctx: Context) => Promise<void>,
    timeoutMessage = '⏰ This action has expired. Please try again.',
    skipTimeoutValidation = false,
    ackImmediately = true
  ): Promise<boolean> {
    if (!ctx.callbackQuery) {
      return false;
    }
    if (!skipTimeoutValidation && !this.isCallbackValid(ctx)) {
      void this.safeAnswerCallback(ctx, timeoutMessage);
      return false;
    }
    // Fire-and-forget acknowledgment to avoid blocking on network
    if (ackImmediately) {
      void this.safeAnswerCallback(ctx);
    }
    const started = Date.now();
    try {
      await handler(ctx);
      const duration = Date.now() - started;
      this.logger.info('callback_handled', { userId: ctx.from?.id, durationMs: duration });
      return true;
    } catch (error) {
      this.logger.error('Error in callback handler:', error);
      void this.safeAnswerCallback(ctx, '❌ An error occurred. Please try again.');
      return false;
    }
  }

  /**
   * Handle callback by acknowledging immediately, showing a lightweight placeholder,
   * and deferring heavy work to the next tick so the measured handler duration is minimal.
   */
  static async handleDeferredNavigation(
    ctx: Context,
    ackText: string,
    handler: (ctx: Context) => Promise<void>,
    skipTimeoutValidation = true
  ): Promise<boolean> {
    return await this.handleCallbackWithTimeout(
      ctx,
      async (ctx) => {
        const msg = ackText && ackText.length > 0 ? ackText : '⏳ Processing...';
        void this.safeAnswerCallback(ctx, msg);
        setTimeout(() => {
          handler(ctx).catch((error) => {
            this.logger.error('Deferred navigation handler error:', error);
          });
        }, 0);
      },
      undefined,
      skipTimeoutValidation,
      false
    );
  }

  /**
   * Extract callback data from context safely
   */
  static getCallbackData(ctx: Context): string | null {
    if (!ctx.callbackQuery || !('data' in ctx.callbackQuery)) {
      return null;
    }

    return ctx.callbackQuery.data || null;
  }

  /**
   * Parse callback data with a separator (e.g., "action:param1:param2")
   */
  static parseCallbackData(ctx: Context, separator = ':'): string[] | null {
    const data = this.getCallbackData(ctx);
    
    if (!data) {
      return null;
    }

    return data.split(separator);
  }

  /**
   * Create callback data string with validation
   */
  static createCallbackData(parts: string[], separator = ':'): string {
    // Validate parts
    const cleanParts = parts.map(part => {
      if (typeof part !== 'string') {
        return String(part);
      }
      // Remove separator characters to prevent parsing issues
      return part.replace(new RegExp(separator, 'g'), '_');
    });

    return cleanParts.join(separator);
  }

  /**
   * Create callback data with session ID for timeout-sensitive actions
   */
  static createCallbackDataWithSession(
    action: string, 
    sessionId: string, 
    params?: string[], 
    separator = ':'
  ): string {
    const parts = [action, sessionId];
    if (params) {
      parts.push(...params);
    }
    return this.createCallbackData(parts, separator);
  }

  /**
   * Parse callback data with session information
   */
  static parseCallbackDataWithSession(ctx: Context, separator = ':'):{
    action?: string;
    sessionId?: string;
    params?: string[];
  } {
    const data = this.getCallbackData(ctx);
    
    if (!data) {
      return {};
    }

    const parts = data.split(separator);
    
    return {
      action: parts[0],
      sessionId: parts[1],
      params: parts.slice(2)
    };
  }

  /**
   * Get action session by ID
   */
  static getActionSession(sessionId: string): ActionSession | null {
    return this.actionSessions.get(sessionId) || null;
  }

  /**
   * Handle rate-limited callback queries
   */
  static async handleRateLimitedCallback(
    ctx: Context,
    handler: (ctx: Context) => Promise<void>,
    rateLimitMs = 1000
  ): Promise<boolean> {
    const userId = ctx.from?.id?.toString();
    
    if (!userId) {
      return false;
    }

    // Simple in-memory rate limiting for callbacks
    const now = Date.now();
    const lastCall = this.lastCallbackTimes.get(userId) || 0;
    
    if (now - lastCall < rateLimitMs) {
      await this.safeAnswerCallback(ctx, '⏰ Please wait before clicking again.');
      return false;
    }

    this.lastCallbackTimes.set(userId, now);
    
    return await this.handleCallbackWithTimeout(ctx, handler);
  }

  /**
   * Validate callback query has required data structure
   */
  static validateCallbackData(
    ctx: Context,
    expectedParts: number,
    separator = ':'
  ): { valid: boolean; parts?: string[] } {
    const parts = this.parseCallbackData(ctx, separator);
    
    if (!parts || parts.length !== expectedParts) {
      return { valid: false };
    }

    return { valid: true, parts };
  }

  /**
   * Handle callback with data validation
   */
  static async handleValidatedCallback(
    ctx: Context,
    expectedParts: number,
    handler: (ctx: Context, parts: string[]) => Promise<void>,
    separator = ':',
    invalidMessage = '❌ Invalid action data. Please try again.'
  ): Promise<boolean> {
    const validation = this.validateCallbackData(ctx, expectedParts, separator);
    
    if (!validation.valid || !validation.parts) {
      await this.safeAnswerCallback(ctx, invalidMessage);
      return false;
    }

    return await this.handleCallbackWithTimeout(ctx, async (ctx) => {
      await handler(ctx, validation.parts!);
    });
  }

  /**
   * Get callback query message ID safely
   */
  static getCallbackMessageId(ctx: Context): number | null {
    if (!ctx.callbackQuery || !ctx.callbackQuery.message) {
      return null;
    }

    return ctx.callbackQuery.message.message_id;
  }

  /**
   * Handle common callback errors consistently
   */
  private static async handleCallbackError(error: any): Promise<boolean> {
    if (error.message?.includes('query is too old')) {
      this.logger.debug('Callback query too old - ignoring');
      return false;
    }
    
    if (error.message?.includes('query is already answered')) {
      this.logger.debug('Callback query already answered - ignoring');
      return false;
    }

    this.logger.error('Callback query error:', error);
    return false;
  }

  /**
   * Clear old callback rate limit entries periodically
   */
  static cleanupRateLimitCache(): void {
    const now = Date.now();
    const tenMinutesAgo = now - 10 * 60 * 1000;

    for (const [userId, lastTime] of this.lastCallbackTimes.entries()) {
      if (lastTime < tenMinutesAgo) {
        this.lastCallbackTimes.delete(userId);
      }
    }
  }

  /**
   * Cleanup expired action sessions
   */
  static cleanupExpiredSessions(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [sessionId, session] of this.actionSessions.entries()) {
      if (now > session.expiresAt) {
        this.actionSessions.delete(sessionId);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      this.logger.debug(`Cleaned up ${cleanedCount} expired action sessions`);
    }
  }

  /**
   * Get session statistics for monitoring
   */
  static getSessionStats(): {
    totalSessions: number;
    activeSessions: number;
    expiredSessions: number;
    sessionsByAction: Record<string, number>;
  } {
    const now = Date.now();
    let activeSessions = 0;
    let expiredSessions = 0;
    const sessionsByAction: Record<string, number> = {};

    for (const session of this.actionSessions.values()) {
      if (now <= session.expiresAt) {
        activeSessions++;
      } else {
        expiredSessions++;
      }

      sessionsByAction[session.action] = (sessionsByAction[session.action] || 0) + 1;
    }

    return {
      totalSessions: this.actionSessions.size,
      activeSessions,
      expiredSessions,
      sessionsByAction
    };
  }

  // Private static storage for rate limiting
  private static lastCallbackTimes = new Map<string, number>();

  // Initialize cleanup intervals
  static {
    // Clean up rate limit cache every 10 minutes
    setInterval(() => {
      CallbackQueryService.cleanupRateLimitCache();
    }, 10 * 60 * 1000);

    // Clean up expired action sessions every 5 minutes
    setInterval(() => {
      CallbackQueryService.cleanupExpiredSessions();
    }, 5 * 60 * 1000);
  }
}

export { ActionSession };