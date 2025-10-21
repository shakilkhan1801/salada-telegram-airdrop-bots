import { Context } from 'telegraf';
import { Logger } from '../../services/logger';
import { storage } from '../../storage';
import { User } from '../../types';

/**
 * Shared user validation service to eliminate duplicate user validation logic
 * across all handlers
 */
export class UserValidationService {
  private static readonly logger = Logger.getInstance();

  /**
   * Validate user exists and return user data, or null if not found
   * Handles error messaging automatically if user not found
   */
  static async validateUser(ctx: Context): Promise<User | null> {
    const userId = ctx.from?.id?.toString();
    
    if (!userId) {
      await this.handleInvalidUser(ctx, 'Unable to identify user');
      return null;
    }

    try {
      // Fast path: use session cache if available and matches
      const sess: any = (ctx as any).session;
      if (sess?.user && (sess.user.telegramId === userId || sess.user.id === userId)) {
        return sess.user as User;
      }

      const user = await storage.getUser(userId);
      
      if (!user) {
        await this.handleInvalidUser(ctx, 'User not found. Please use /start to register.');
        return null;
      }

      // Cache in session for subsequent handlers in the same conversation
      try {
        if (sess) {
          sess.user = user;
        }
      } catch {}

      return user;
    } catch (error) {
      this.logger.error('Error validating user:', error);
      await this.handleInvalidUser(ctx, 'Error accessing user data. Please try again.');
      return null;
    }
  }

  /**
   * Require user to exist - throws error if user not found
   * Use this when user existence is mandatory for the operation
   */
  static async requireUser(ctx: Context): Promise<User> {
    const user = await this.validateUser(ctx);
    
    if (!user) {
      throw new Error('User validation failed - operation cannot continue');
    }

    return user;
  }

  /**
   * Check if user is active and handle inactive users
   */
  static async validateActiveUser(ctx: Context): Promise<User | null> {
    const user = await this.validateUser(ctx);
    
    if (!user) {
      return null;
    }

    const isActive = this.isUserActive(user);
    if (!isActive) {
      await ctx.reply('⚠️ Your account is currently inactive. Please contact support if you believe this is an error.');
      return null;
    }

    return user;
  }

  /**
   * Validate user and check if they have completed onboarding
   */
  static async validateOnboardedUser(ctx: Context): Promise<User | null> {
    const user = await this.validateActiveUser(ctx);
    
    if (!user) {
      return null;
    }

    const onboarded = this.hasCompletedOnboarding(user);
    if (!onboarded) {
      await ctx.reply('👋 Please complete your onboarding first by using /start');
      return null;
    }

    return user;
  }

  static invalidateSessionUser(ctx: Context): void {
    try {
      const sess: any = (ctx as any).session;
      if (sess && sess.user) {
        sess.user = undefined;
      }
    } catch {}
  }

  /**
   * Get user ID from context with validation
   */
  static getUserId(ctx: Context): string | null {
    const userId = ctx.from?.id?.toString();
    
    if (!userId) {
      this.logger.warn('Unable to extract user ID from context');
      return null;
    }

    return userId;
  }

  /**
   * Get user ID from context - throws if not found
   */
  static requireUserId(ctx: Context): string {
    const userId = this.getUserId(ctx);
    
    if (!userId) {
      throw new Error('User ID is required but not found in context');
    }

    return userId;
  }

  /**
   * Check if user exists without loading full user data
   * Useful for lightweight existence checks
   */
  static async userExists(userId: string): Promise<boolean> {
    try {
      const user = await storage.getUser(userId);
      return !!user;
    } catch (error) {
      this.logger.error('Error checking user existence:', error);
      return false;
    }
  }

  /**
   * Validate user and ensure they have required permissions
   */
  static async validateUserWithPermission(ctx: Context, requiredPermission: string): Promise<User | null> {
    const user = await this.validateOnboardedUser(ctx);
    
    if (!user) {
      return null;
    }

    // Check if user has required permission (extend this logic as needed)
    const role = (user as any).role as string | undefined;
    if (role === 'admin') {
      return user; // Admins have all permissions
    }

    const permissions: string[] = Array.isArray((user as any).permissions)
      ? (user as any).permissions
      : [];

    if (!permissions.includes(requiredPermission)) {
      await ctx.reply('❌ You do not have permission to perform this action.');
      return null;
    }

    return user;
  }

  /**
   * Validate admin user
   */
  static async validateAdminUser(ctx: Context): Promise<User | null> {
    const user = await this.validateOnboardedUser(ctx);
    
    if (!user) {
      return null;
    }

    const role = (user as any).role as string | undefined;
    if (role !== 'admin') {
      await ctx.reply('🚫 This action requires admin privileges.');
      return null;
    }

    return user;
  }

  /**
   * Update user last activity timestamp
   */
  static async updateUserActivity(userId: string): Promise<void> {
    try {
      await storage.updateUser(userId, {
        lastActivity: new Date()
      });
    } catch (error) {
      this.logger.error('Error updating user activity:', error);
      // Don't throw - this is a non-critical operation
    }
  }

  /**
   * Handle invalid user cases consistently
   */
  private static async handleInvalidUser(ctx: Context, message: string): Promise<void> {
    try {
      await ctx.reply(`❌ ${message}`);
    } catch (error) {
      this.logger.error('Error sending invalid user message:', error);
    }
  }

  /**
   * Batch validate multiple users
   */
  static async validateUsers(userIds: string[]): Promise<Map<string, User | null>> {
    const results = new Map<string, User | null>();

    const validationPromises = userIds.map(async (userId) => {
      try {
        const user = await storage.getUser(userId);
        results.set(userId, user);
      } catch (error) {
        this.logger.error(`Error validating user ${userId}:`, error);
        results.set(userId, null);
      }
    });

    await Promise.all(validationPromises);
    return results;
  }

  /**
   * Get user stats for validation purposes
   */
  static async getUserValidationStats(): Promise<{
    totalUsers: number;
    activeUsers: number;
    inactiveUsers: number;
    onboardedUsers: number;
  }> {
    try {
      const allUsers = await storage.getAllUsers();
      
      const stats = {
        totalUsers: allUsers.length,
        activeUsers: allUsers.filter(u => this.isUserActive(u)).length,
        inactiveUsers: allUsers.filter(u => !this.isUserActive(u)).length,
        onboardedUsers: allUsers.filter(u => this.hasCompletedOnboarding(u)).length
      };

      return stats;
    } catch (error) {
      this.logger.error('Error getting user validation stats:', error);
      return {
        totalUsers: 0,
        activeUsers: 0,
        inactiveUsers: 0,
        onboardedUsers: 0
      };
    }
  }
  // Helpers to derive state from available fields, keeping TS-safe
  private static isUserActive(user: User): boolean {
    const anyUser = user as any;
    if (typeof anyUser.isActive === 'boolean') return anyUser.isActive;
    // Fallback: active if not blocked
    return !user.isBlocked;
  }

  private static hasCompletedOnboarding(user: User): boolean {
    const anyUser = user as any;
    if (typeof anyUser.hasCompletedOnboarding === 'boolean') return anyUser.hasCompletedOnboarding;
    // Fallback heuristic: consider onboarding complete if registeredAt exists
    return Boolean(user.registeredAt);
  }
}
