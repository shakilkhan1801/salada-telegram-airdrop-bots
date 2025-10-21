import { Context, MiddlewareFn } from 'telegraf';
import { Logger } from '../../services/logger';
import { StorageManager } from '../../storage';

export interface BlockedUser {
  isBlocked: boolean;
  blockedUntil?: string; // ISO date string for temporary blocks
  blockReason?: string;
  blockedAt?: string;
}

export class BlockingMiddleware {
  private static instance: BlockingMiddleware;
  private readonly logger = Logger.getInstance();
  private readonly storage = StorageManager.getInstance();
  private userCache = new Map<string, { user: any; e: number }>();
  private registryCache = new Map<string, { blocked: boolean; e: number }>();

  private constructor() {}

  private async getCachedUser(userId: string): Promise<any> {
    const now = Date.now();
    const cached = this.userCache.get(userId);
    if (cached && cached.e > now) return cached.user;
    const user = await this.storage.getUser(userId);
    this.userCache.set(userId, { user, e: now + 15000 });
    return user;
  }

  private async isUserBlockedInRegistry(userId: string): Promise<boolean> {
    const now = Date.now();
    const cached = this.registryCache.get(userId);
    if (cached && cached.e > now) return cached.blocked;
    const blocked = await this.storage.isUserBlocked(userId);
    this.registryCache.set(userId, { blocked, e: now + 15000 });
    return blocked;
  }

  static getInstance(): BlockingMiddleware {
    if (!BlockingMiddleware.instance) {
      BlockingMiddleware.instance = new BlockingMiddleware();
    }
    return BlockingMiddleware.instance;
  }

  /**
   * Clear cache for a specific user - useful when unblocking
   */
  clearUserCache(userId: string): void {
    this.userCache.delete(userId);
    this.registryCache.delete(userId);
    this.logger.info(`Cleared blocking middleware cache for user ${userId}`);
  }

  /**
   * Create middleware function for Telegraf
   */
  create(): MiddlewareFn<Context> {
    return async (ctx: Context, next: () => Promise<void>) => {
      const userId = ctx.from?.id?.toString();
      
      // Only check for users who have an ID (i.e., not channel posts, etc.)
      if (!userId) {
        return next();
      }

      try {
        const user = await this.getCachedUser(userId);

        if (user && this.isUserBlocked(user)) {
          if (this.isTemporaryBlock(user) && this.hasBlockExpired(user)) {
            await this.unblockUser(userId, user);
            // Do not send any notification on auto-expiry
          } else {
            this.logBlockedAttempt(userId, this.isTemporaryBlock(user));
            if (!user.blockNotified) {
              await this.sendBlockNotification(ctx, userId, user.blockReason);
              try {
                await this.storage.updateUser(userId, { blockNotified: true, blockNotifiedAt: new Date().toISOString() });
              } catch {}
            }
            return;
          }
        }

        // If user doc is absent or not marked blocked but registry shows ban, notify once via banned_users
        if (!user || !this.isUserBlocked(user)) {
          const blockedInRegistry = await this.isUserBlockedInRegistry(userId);
          if (blockedInRegistry) {
            this.logBlockedAttempt(userId, false);
            try {
              const bans = await (this.storage as any).findByQuery('banned_users', { userId });
              const first = Array.isArray(bans) ? bans[0] : null;
              if (!first?.notified) {
                await this.sendBlockNotification(ctx, userId, (first as any)?.reason);
                if (first?.id) {
                  await (this.storage as any).update('banned_users', { notified: true, notifiedAt: new Date().toISOString() }, first.id);
                }
              }
            } catch {}
            return;
          }
        }

        // If admin unblocked and a pending notification exists, send once
        try {
          const freshUser = user || await this.getCachedUser(userId);
          if (freshUser?.unblockNotifyPending) {
            await this.sendUnblockNotification(ctx, userId);
            await this.storage.updateUser(userId, { unblockNotifyPending: false, lastActiveAt: new Date().toISOString() });
          }
        } catch {}

        return next();
      } catch (error) {
        this.logger.error(`Error in blocking middleware for user ${userId}:`, error);
        // On error, allow request to proceed to avoid blocking all users
        return next();
      }
    };
  }

  /**
   * Block a user permanently or temporarily
   */
  async blockUser(
    userId: string, 
    reason?: string, 
    durationHours?: number
  ): Promise<void> {
    try {
      const user = await this.storage.getUser(userId) || {};
      const now = new Date().toISOString();
      
      const blockedUser = {
        ...user,
        isBlocked: true,
        blockReason: reason,
        blockedAt: now,
        blockedUntil: durationHours ? new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString() : undefined
      };

      await this.storage.updateUser(userId, blockedUser);
      
      const blockType = durationHours ? `temporarily (${durationHours}h)` : 'permanently';
      this.logger.info(`🚫 User ${userId} blocked ${blockType}. Reason: ${reason || 'No reason provided'}`);
    } catch (error) {
      this.logger.error(`Failed to block user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Unblock a user
   */
  async unblockUser(userId: string, existingUser?: any): Promise<void> {
    try {
      const user = existingUser || await this.storage.getUser(userId);
      
      if (!user || !this.isUserBlocked(user)) {
        return; // User is not blocked
      }

      const unblockedUser = {
        ...user,
        isBlocked: false,
      };

      // Remove block-related fields
      delete unblockedUser.blockedUntil;
      delete unblockedUser.blockReason;
      delete unblockedUser.blockedAt;

      await this.storage.updateUser(userId, unblockedUser);
      
      this.logger.info(`✅ User ${userId} unblocked successfully`);
    } catch (error) {
      this.logger.error(`Failed to unblock user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Check if user is blocked
   */
  private isUserBlocked(user: any): boolean {
    return user && user.isBlocked === true;
  }

  /**
   * Check if user has a temporary block
   */
  private isTemporaryBlock(user: any): boolean {
    return user && user.isBlocked && user.blockedUntil;
  }

  /**
   * Check if temporary block has expired
   */
  private hasBlockExpired(user: any): boolean {
    if (!this.isTemporaryBlock(user)) {
      return false;
    }

    const blockedUntilDate = new Date(user.blockedUntil);
    const currentDate = new Date();
    
    return currentDate > blockedUntilDate;
  }

  /**
   * Log blocked user attempt
   */
  private logBlockedAttempt(userId: string, isTemporary: boolean): void {
    const blockType = isTemporary ? 'temporary' : 'permanent';
    this.logger.info(`🚫 Blocked user ${userId} attempted to interact (${blockType} block active)`);
  }

  private async sendBlockNotification(ctx: Context, userId: string, reason?: string): Promise<void> {
    try {
      let text: string;
      const isSpam = (reason || '').toLowerCase().includes('spam');
      if (isSpam) {
        try {
          const user = await this.storage.getUser(userId);
          let minutes = 10;
          if (user?.blockedUntil) {
            const ms = new Date(user.blockedUntil).getTime() - Date.now();
            minutes = Math.max(1, Math.ceil(ms / 60000));
          }
          text = [
            '🚫 Your account has been temporarily frozen for spam.',
            '',
            `⏱ Freeze ends in ~${minutes} minute(s).`,
            'Please avoid sending repeated or irrelevant messages.',
          ].join('\n');
        } catch {
          text = [
            '🚫 Your account has been temporarily frozen for spam.',
            'Please avoid sending repeated or irrelevant messages.'
          ].join('\n');
        }
      } else {
        text = [
          '🚫 Your account has been blocked.',
          '',
          'We detected multiple accounts from your device. You are banned.',
          reason ? `Reason: ${reason}` : undefined
        ].filter(Boolean).join('\n');
      }
      await ctx.telegram.sendMessage(userId, text as any);
    } catch {}
  }

  /**
   * Send unblock notification to user
   */
  private async sendUnblockNotification(ctx: Context, userId: string): Promise<void> {
    try {
      await ctx.telegram.sendMessage(
        userId,
        '✅ Your account has been unblocked.\n\nAccess has been restored. You can continue using the bot.',
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: 'Main Menu', callback_data: 'menu_main' }]
            ]
          }
        } as any
      );

      this.logger.info(`Unblock notification sent to user ${userId}`);
    } catch (error) {
      this.logger.error(`Failed to send unblock notification to user ${userId}:`, error);
    }
  }

  /**
   * Get blocked users list
   */
  async getBlockedUsers(includeExpired: boolean = false): Promise<Array<{userId: string, user: any}>> {
    try {
      const allUsers = await this.storage.getAllUsers();
      const blockedUsers: Array<{userId: string, user: any}> = [];

      for (const [userId, user] of Object.entries(allUsers)) {
        if (this.isUserBlocked(user)) {
          // If not including expired and user has expired block, skip
          if (!includeExpired && this.isTemporaryBlock(user) && this.hasBlockExpired(user)) {
            continue;
          }
          
          blockedUsers.push({ userId, user });
        }
      }

      return blockedUsers;
    } catch (error) {
      this.logger.error('Failed to get blocked users list:', error);
      throw error;
    }
  }

  /**
   * Get user block status
   */
  async getUserBlockStatus(userId: string): Promise<{
    isBlocked: boolean;
    isTemporary: boolean;
    expiresAt?: Date;
    reason?: string;
    blockedAt?: Date;
  }> {
    try {
      const user = await this.storage.getUser(userId);
      
      if (!user || !this.isUserBlocked(user)) {
        return { isBlocked: false, isTemporary: false };
      }

      return {
        isBlocked: true,
        isTemporary: this.isTemporaryBlock(user),
        expiresAt: user.blockedUntil ? new Date(user.blockedUntil) : undefined,
        reason: user.blockReason,
        blockedAt: user.blockedAt ? new Date(user.blockedAt) : undefined
      };
    } catch (error) {
      this.logger.error(`Failed to get block status for user ${userId}:`, error);
      throw error;
    }
  }
}