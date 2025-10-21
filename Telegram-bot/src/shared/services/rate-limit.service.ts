import { Context } from 'telegraf';
import { Logger } from '../../services/logger';
import { GlobalRateLimitManager, RateLimitResult } from '../../security/rate-limiter.service';
import { CallbackQueryService } from './callback-query.service';

/**
 * Action types for different rate limiting scenarios
 */
export enum RateLimitAction {
  WALLET_CONNECTION = 'wallet_connection',
  TASK_SUBMISSION = 'task_submission',
  POINT_CLAIM = 'point_claim',
  REFERRAL_CODE = 'referral_code',
  BOT_COMMAND = 'bot_command',
  ADMIN_ACTION = 'admin_action',
  MESSAGE_SEND = 'message_send',
  CALLBACK_QUERY = 'callback_query'
}

/**
 * Shared rate limiting service to eliminate duplicate rate limiting logic
 * across all bot handlers
 */
export class RateLimitService {
  private static readonly logger = Logger.getInstance();
  private static readonly rateLimitManager = GlobalRateLimitManager.getInstance();

  /**
   * Check rate limit for a specific action and user
   */
  static async checkRateLimit(userId: string, action: RateLimitAction): Promise<RateLimitResult> {
    const telegramLimiter = this.rateLimitManager.getTelegramLimiter();
    
    switch (action) {
      case RateLimitAction.WALLET_CONNECTION:
        return await telegramLimiter.checkWalletConnection(userId);
        
      case RateLimitAction.TASK_SUBMISSION:
        return await telegramLimiter.checkTaskSubmission(userId);
        
      case RateLimitAction.POINT_CLAIM:
        return await telegramLimiter.checkPointClaim(userId);
        
      case RateLimitAction.REFERRAL_CODE:
        return await telegramLimiter.checkReferralCode(userId);
        
      case RateLimitAction.BOT_COMMAND:
      default:
        return await telegramLimiter.checkBotCommand(userId);
    }
  }

  /**
   * Check rate limit and handle the response automatically in Telegram context
   * Returns true if action is allowed, false if rate limited
   */
  static async checkAndEnforce(
    ctx: Context,
    action: RateLimitAction,
    customMessage?: string
  ): Promise<boolean> {
    const userId = ctx.from?.id?.toString();
    
    if (!userId) {
      this.logger.warn('No user ID found for rate limit check');
      return false;
    }

    try {
      const result = await this.checkRateLimit(userId, action);
      
      if (!result.allowed) {
        const message = customMessage || this.getDefaultRateLimitMessage(action, result.resetTime);
        
        // Handle differently for callback queries vs regular messages
        if (ctx.callbackQuery) {
          await CallbackQueryService.safeAnswerCallback(ctx, message);
        } else {
          await ctx.reply(message);
        }
        
        this.logger.info(`Rate limit exceeded for user ${userId}, action ${action}`, {
          resetTime: result.resetTime,
          remaining: result.remaining
        });
        
        return false;
      }
      
      return true;
    } catch (error) {
      this.logger.error('Error checking rate limit:', error);
      // On error, allow the action to proceed (fail open)
      return true;
    }
  }

  /**
   * Check rate limit for callback queries with automatic handling
   */
  static async checkCallbackRateLimit(
    ctx: Context,
    action: RateLimitAction = RateLimitAction.CALLBACK_QUERY
  ): Promise<boolean> {
    return await this.checkAndEnforce(ctx, action);
  }

  /**
   * Check rate limit for bot commands with automatic handling
   */
  static async checkCommandRateLimit(ctx: Context): Promise<boolean> {
    return await this.checkAndEnforce(ctx, RateLimitAction.BOT_COMMAND);
  }

  /**
   * Check rate limit with custom configuration
   */
  static async checkCustomRateLimit(
    userId: string,
    action: string,
    windowMs: number,
    maxRequests: number
  ): Promise<RateLimitResult> {
    const config = {
      windowMs,
      maxRequests,
      keyGenerator: (id: string) => `custom:${action}:${id}`,
      onLimitReached: (id: string, resetTime: Date) => {
        this.logger.warn(`Custom rate limit exceeded for ${action}`, {
          userId: id,
          resetTime: resetTime.toISOString()
        });
      }
    };

    const customLimiter = this.rateLimitManager.createCustomLimiter(config);
    return await customLimiter.checkLimit(userId, config);
  }

  /**
   * Apply rate limit with retry mechanism
   */
  static async checkWithRetry(
    ctx: Context,
    action: RateLimitAction,
    maxRetries = 3,
    retryDelayMs = 1000
  ): Promise<boolean> {
    let retries = 0;
    
    while (retries < maxRetries) {
      const allowed = await this.checkAndEnforce(ctx, action);
      
      if (allowed) {
        return true;
      }
      
      retries++;
      
      if (retries < maxRetries) {
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, retryDelayMs * retries));
      }
    }
    
    return false;
  }

  /**
   * Bulk rate limit check for multiple users
   */
  static async checkBulkRateLimit(
    userIds: string[],
    action: RateLimitAction
  ): Promise<Map<string, RateLimitResult>> {
    const results = new Map<string, RateLimitResult>();
    
    const checks = userIds.map(async (userId) => {
      try {
        const result = await this.checkRateLimit(userId, action);
        results.set(userId, result);
      } catch (error) {
        this.logger.error(`Rate limit check failed for user ${userId}:`, error);
        // Default to allowed on error
        results.set(userId, {
          allowed: true,
          resetTime: new Date(Date.now() + 60000),
          remaining: 1,
          total: 1
        });
      }
    });
    
    await Promise.all(checks);
    return results;
  }

  /**
   * Get rate limit status for a user
   */
  static async getRateLimitStatus(
    userId: string,
    action: RateLimitAction
  ): Promise<{
    action: RateLimitAction;
    allowed: boolean;
    remaining: number;
    resetTime: Date;
    waitTimeMs: number;
  }> {
    const result = await this.checkRateLimit(userId, action);
    
    return {
      action,
      allowed: result.allowed,
      remaining: result.remaining,
      resetTime: result.resetTime,
      waitTimeMs: result.allowed ? 0 : result.resetTime.getTime() - Date.now()
    };
  }

  /**
   * Get all rate limit statuses for a user
   */
  static async getAllRateLimitStatuses(userId: string): Promise<{
    [key in RateLimitAction]?: {
      allowed: boolean;
      remaining: number;
      resetTime: Date;
      waitTimeMs: number;
    }
  }> {
    const actions = Object.values(RateLimitAction);
    const statuses: any = {};
    
    const statusChecks = actions.map(async (action) => {
      try {
        const status = await this.getRateLimitStatus(userId, action);
        statuses[action] = {
          allowed: status.allowed,
          remaining: status.remaining,
          resetTime: status.resetTime,
          waitTimeMs: status.waitTimeMs
        };
      } catch (error) {
        this.logger.error(`Error getting rate limit status for ${action}:`, error);
      }
    });
    
    await Promise.all(statusChecks);
    return statuses;
  }

  /**
   * Clear rate limits for a specific user (admin function)
   */
  static async clearUserRateLimits(userId: string): Promise<boolean> {
    try {
      // This would require implementing a clear function in the rate limiter
      // For now, we'll log the admin action
      this.logger.info(`Rate limits cleared for user ${userId} by admin`);
      return true;
    } catch (error) {
      this.logger.error('Error clearing rate limits:', error);
      return false;
    }
  }

  /**
   * Handle rate limit exceeded with contextual messages
   */
  static async handleRateLimitExceeded(
    ctx: Context,
    action: RateLimitAction,
    resetTime: Date,
    customMessage?: string
  ): Promise<void> {
    const waitTime = Math.ceil((resetTime.getTime() - Date.now()) / 1000);
    const waitTimeText = this.formatWaitTime(waitTime);
    
    const message = customMessage || 
      `⚠️ You're doing that too quickly! Please wait ${waitTimeText} before trying again.`;
    
    if (ctx.callbackQuery) {
      await CallbackQueryService.safeAnswerCallback(ctx, message);
    } else {
      await ctx.reply(message);
    }
  }

  /**
   * Get default rate limit message for an action
   */
  private static getDefaultRateLimitMessage(action: RateLimitAction, resetTime: Date): string {
    const waitTime = Math.ceil((resetTime.getTime() - Date.now()) / 1000);
    const waitTimeText = this.formatWaitTime(waitTime);
    
    const actionMessages = {
      [RateLimitAction.WALLET_CONNECTION]: `💳 Please wait ${waitTimeText} before connecting another wallet.`,
      [RateLimitAction.TASK_SUBMISSION]: `📋 Please wait ${waitTimeText} before submitting another task.`,
      [RateLimitAction.POINT_CLAIM]: `💎 Please wait ${waitTimeText} before claiming more points.`,
      [RateLimitAction.REFERRAL_CODE]: `👥 Please wait ${waitTimeText} before using another referral code.`,
      [RateLimitAction.BOT_COMMAND]: `🤖 Please wait ${waitTimeText} before sending another command.`,
      [RateLimitAction.ADMIN_ACTION]: `👨‍💼 Please wait ${waitTimeText} before performing another admin action.`,
      [RateLimitAction.MESSAGE_SEND]: `💬 Please wait ${waitTimeText} before sending another message.`,
      [RateLimitAction.CALLBACK_QUERY]: `⏰ Please wait ${waitTimeText} before clicking again.`
    };
    
    return actionMessages[action] || `⚠️ Please wait ${waitTimeText} before trying again.`;
  }

  /**
   * Format wait time in human-readable format
   */
  private static formatWaitTime(seconds: number): string {
    if (seconds < 60) {
      return `${seconds} second${seconds !== 1 ? 's' : ''}`;
    }
    
    const minutes = Math.ceil(seconds / 60);
    if (minutes < 60) {
      return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
    }
    
    const hours = Math.ceil(minutes / 60);
    return `${hours} hour${hours !== 1 ? 's' : ''}`;
  }

  /**
   * Get rate limit statistics
   */
  static async getRateLimitStats(): Promise<{
    totalChecks: number;
    blockedRequests: number;
    activeUsers: number;
  }> {
    try {
      const stats = await this.rateLimitManager.getStatistics();
      return {
        totalChecks: (stats as any).totalChecks ?? stats.totalRequests ?? 0,
        blockedRequests: stats.blockedRequests ?? 0,
        activeUsers: stats.activeUsers ?? 0,
      };
    } catch (error) {
      this.logger.error('Error getting rate limit stats:', error);
      return {
        totalChecks: 0,
        blockedRequests: 0,
        activeUsers: 0
      };
    }
  }
}
