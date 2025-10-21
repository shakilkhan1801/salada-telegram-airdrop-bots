import { Logger } from '../../services/logger';
import { storage } from '../../storage';
import { User, PointTransaction } from '../../types';
import { UserValidationService } from './user-validation.service';

/**
 * Point transaction types
 */
export enum PointTransactionType {
  EARNED = 'earned',
  SPENT = 'spent',
  BONUS = 'bonus',
  PENALTY = 'penalty',
  REFUND = 'refund',
  ADMIN_ADJUSTMENT = 'admin_adjustment'
}

/**
 * Point earning categories
 */
export enum PointEarningCategory {
  TASK_COMPLETION = 'task_completion',
  DAILY_BONUS = 'daily_bonus',
  REFERRAL_BONUS = 'referral_bonus',
  WALLET_CONNECTION = 'wallet_connection',
  SOCIAL_ENGAGEMENT = 'social_engagement',
  MILESTONE_REWARD = 'milestone_reward',
  ADMIN_REWARD = 'admin_reward',
  EVENT_PARTICIPATION = 'event_participation',
  BONUS = 'bonus'
}

/**
 * Interface for point transaction metadata
 */
interface PointTransactionMetadata {
  category?: PointEarningCategory;
  taskId?: string;
  referrerId?: string;
  walletAddress?: string;
  adminId?: string;
  eventId?: string;
  milestone?: string;
  multiplier?: number;
  originalAmount?: number;
  [key: string]: any;
}

/**
 * Shared points management service to eliminate duplicate points logic
 * across all bot handlers
 */
export class PointsService {
  private static readonly logger = Logger.getInstance();

  /**
   * Award points to a user with automatic transaction logging
   */
  static async awardPoints(
    userId: string,
    amount: number,
    reason: string,
    category: PointEarningCategory = PointEarningCategory.TASK_COMPLETION,
    metadata: PointTransactionMetadata = {}
  ): Promise<{
    success: boolean;
    newBalance: number;
    transaction?: PointTransaction;
    error?: string;
  }> {
    try {
      // Validate amount
      if (amount <= 0) {
        throw new Error('Point amount must be positive');
      }

      // Get current user data
      const user = await storage.getUser(userId);
      if (!user) {
        return {
          success: false,
          newBalance: 0,
          error: 'User not found'
        };
      }

      const currentPoints = user.points || 0;
      const newBalance = currentPoints + amount;

      // Update user points
      await storage.updateUser(userId, {
        points: newBalance,
        lastPointsEarned: new Date()
      });

      // Create transaction record
      const transaction: PointTransaction = {
        id: `tx_${Date.now()}_${userId}_${Math.random().toString(36).substr(2, 9)}`,
        userId,
        amount,
        type: 'earned',
        source: 'system',
        description: reason,
        timestamp: new Date(),
        // createdAt for DB index compatibility
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        createdAt: new Date(),
        metadata: {
          category,
          ...metadata
        }
      };

      // Save transaction
      await storage.savePointTransaction(transaction);

      this.logger.info(`Points awarded: ${amount} to user ${userId}`, {
        reason,
        category,
        newBalance,
        transactionId: transaction.id
      });

      return {
        success: true,
        newBalance,
        transaction
      };
    } catch (error) {
      this.logger.error('Error awarding points:', error);
      return {
        success: false,
        newBalance: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Spend points for a user
   */
  static async spendPoints(
    userId: string,
    amount: number,
    reason: string,
    metadata: PointTransactionMetadata = {}
  ): Promise<{
    success: boolean;
    newBalance: number;
    transaction?: PointTransaction;
    error?: string;
  }> {
    try {
      // Validate amount
      if (amount <= 0) {
        throw new Error('Point amount must be positive');
      }

      // Get current user data
      const user = await storage.getUser(userId);
      if (!user) {
        return {
          success: false,
          newBalance: 0,
          error: 'User not found'
        };
      }

      const currentPoints = user.points || 0;
      
      if (currentPoints < amount) {
        return {
          success: false,
          newBalance: currentPoints,
          error: 'Insufficient points'
        };
      }

      const newBalance = currentPoints - amount;

      // Update user points
      await storage.updateUser(userId, {
        points: newBalance,
        lastPointsSpent: new Date()
      });

      // Create transaction record
      const transaction: PointTransaction = {
        id: `tx_${Date.now()}_${userId}_${Math.random().toString(36).substr(2, 9)}`,
        userId,
        amount: -amount, // Negative for spending
        type: 'spent',
        source: 'system',
        description: reason,
        timestamp: new Date(),
        // createdAt for DB index compatibility
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        createdAt: new Date(),
        metadata
      };

      // Save transaction
      await storage.savePointTransaction(transaction);

      this.logger.info(`Points spent: ${amount} by user ${userId}`, {
        reason,
        newBalance,
        transactionId: transaction.id
      });

      return {
        success: true,
        newBalance,
        transaction
      };
    } catch (error) {
      this.logger.error('Error spending points:', error);
      return {
        success: false,
        newBalance: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Award bonus points with multiplier support
   */
  static async awardBonusPoints(
    userId: string,
    baseAmount: number,
    multiplier: number,
    reason: string,
    category: PointEarningCategory = PointEarningCategory.BONUS,
    metadata: PointTransactionMetadata = {}
  ): Promise<{
    success: boolean;
    newBalance: number;
    bonusAmount: number;
    transaction?: PointTransaction;
    error?: string;
  }> {
    const bonusAmount = Math.floor(baseAmount * multiplier);
    
    const result = await this.awardPoints(userId, bonusAmount, reason, category, {
      ...metadata,
      multiplier,
      originalAmount: baseAmount
    });

    return {
      ...result,
      bonusAmount
    };
  }

  /**
   * Award referral bonus points
   */
  static async awardReferralBonus(
    referrerId: string,
    referredUserId: string,
    bonusAmount: number,
    bonusType: 'signup' | 'task_completion' | 'wallet_connection' = 'signup'
  ): Promise<{
    success: boolean;
    newBalance: number;
    transaction?: PointTransaction;
    error?: string;
  }> {
    const reason = `Referral bonus for ${bonusType.replace('_', ' ')}`;
    
    return await this.awardPoints(
      referrerId,
      bonusAmount,
      reason,
      PointEarningCategory.REFERRAL_BONUS,
      {
        referredUserId,
        bonusType
      }
    );
  }

  /**
   * Create point transaction without changing balance (for tracking)
   */
  static async createTransaction(
    userId: string,
    amount: number,
    type: PointTransaction['type'],
    description: string,
    metadata: PointTransactionMetadata = {}
  ): Promise<PointTransaction | null> {
    try {
      const transaction: PointTransaction = {
        id: `tx_${Date.now()}_${userId}_${Math.random().toString(36).substr(2, 9)}`,
        userId,
        amount,
        type,
        source: 'system',
        description,
        timestamp: new Date(),
        // createdAt for DB index compatibility
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        createdAt: new Date(),
        metadata
      };

      await storage.savePointTransaction(transaction);
      return transaction;
    } catch (error) {
      this.logger.error('Error creating transaction:', error);
      return null;
    }
  }

  /**
   * Get user's point balance
   */
  static async getPointBalance(userId: string): Promise<number> {
    try {
      const user = await storage.getUser(userId);
      return user?.points || 0;
    } catch (error) {
      this.logger.error('Error getting point balance:', error);
      return 0;
    }
  }

  /**
   * Get user's point transaction history
   */
  static async getTransactionHistory(
    userId: string,
    limit: number = 50,
    type?: PointTransactionType
  ): Promise<PointTransaction[]> {
    try {
      const allTransactions = await storage.getPointTransactions(userId);
      
      let filtered = allTransactions;
      if (type) {
        filtered = allTransactions.filter(tx => tx.type === type);
      }
      
      return filtered
        .sort((a: PointTransaction, b: PointTransaction) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
        .slice(0, limit);
    } catch (error) {
      this.logger.error('Error getting transaction history:', error);
      return [];
    }
  }

  /**
   * Get point statistics for a user
   */
  static async getUserPointStats(userId: string): Promise<{
    totalEarned: number;
    totalSpent: number;
    currentBalance: number;
    transactionCount: number;
    lastEarned?: Date;
    lastSpent?: Date;
    topEarningCategory?: PointEarningCategory;
  }> {
    try {
      const user = await storage.getUser(userId);
      const transactions = await this.getTransactionHistory(userId, 1000);
      
      const totalEarned = transactions
        .filter(tx => tx.amount > 0)
        .reduce((sum, tx) => sum + tx.amount, 0);
      
      const totalSpent = Math.abs(transactions
        .filter(tx => tx.amount < 0)
        .reduce((sum, tx) => sum + tx.amount, 0));
      
      const lastEarned = transactions
        .filter(tx => tx.amount > 0)
        .map(tx => new Date(tx.timestamp))
        .sort((a, b) => b.getTime() - a.getTime())[0];
      
      const lastSpent = transactions
        .filter(tx => tx.amount < 0)
        .map(tx => new Date(tx.timestamp))
        .sort((a, b) => b.getTime() - a.getTime())[0];

      // Find top earning category
      const categoryTotals: { [key: string]: number } = {};
      transactions
        .filter(tx => tx.amount > 0 && tx.metadata?.category)
        .forEach(tx => {
          const category = tx.metadata?.category as string;
          categoryTotals[category] = (categoryTotals[category] || 0) + tx.amount;
        });
      
      const categoryKeys = Object.keys(categoryTotals);
      const topEarningCategory = categoryKeys.length
        ? (categoryKeys.reduce((a, b) => categoryTotals[a] > categoryTotals[b] ? a : b) as PointEarningCategory)
        : undefined;

      return {
        totalEarned,
        totalSpent,
        currentBalance: user?.points || 0,
        transactionCount: transactions.length,
        lastEarned,
        lastSpent,
        topEarningCategory
      };
    } catch (error) {
      this.logger.error('Error getting user point stats:', error);
      return {
        totalEarned: 0,
        totalSpent: 0,
        currentBalance: 0,
        transactionCount: 0
      };
    }
  }

  /**
   * Check if user has enough points for an action
   */
  static async hasEnoughPoints(userId: string, requiredAmount: number): Promise<boolean> {
    const balance = await this.getPointBalance(userId);
    return balance >= requiredAmount;
  }

  /**
   * Bulk award points to multiple users
   */
  static async bulkAwardPoints(
    awards: Array<{
      userId: string;
      amount: number;
      reason: string;
      category?: PointEarningCategory;
      metadata?: PointTransactionMetadata;
    }>
  ): Promise<{
    successful: number;
    failed: number;
    results: Array<{
      userId: string;
      success: boolean;
      newBalance: number;
      error?: string;
    }>;
  }> {
    const results = [];
    let successful = 0;
    let failed = 0;

    for (const award of awards) {
      const result = await this.awardPoints(
        award.userId,
        award.amount,
        award.reason,
        award.category,
        award.metadata
      );

      results.push({
        userId: award.userId,
        success: result.success,
        newBalance: result.newBalance,
        error: result.error
      });

      if (result.success) {
        successful++;
      } else {
        failed++;
      }
    }

    this.logger.info(`Bulk points award completed: ${successful} successful, ${failed} failed`);

    return {
      successful,
      failed,
      results
    };
  }

  /**
   * Admin function to adjust points with audit trail
   */
  static async adminAdjustPoints(
    userId: string,
    amount: number, // Can be positive or negative
    reason: string,
    adminId: string
  ): Promise<{
    success: boolean;
    newBalance: number;
    transaction?: PointTransaction;
    error?: string;
  }> {
    try {
      const user = await storage.getUser(userId);
      if (!user) {
        return {
          success: false,
          newBalance: 0,
          error: 'User not found'
        };
      }

      const currentPoints = user.points || 0;
      const newBalance = Math.max(0, currentPoints + amount); // Prevent negative balance

      // Update user points
      await storage.updateUser(userId, {
        points: newBalance
      });

      // Create admin adjustment transaction
      const transactionType: PointTransaction['type'] = amount >= 0 ? 'bonus' : 'penalty';
      const transaction: PointTransaction = {
        id: `tx_${Date.now()}_${userId}_admin_${Math.random().toString(36).substr(2, 9)}`,
        userId,
        amount,
        type: transactionType,
        source: 'admin',
        description: `Admin adjustment: ${reason}`,
        timestamp: new Date(),
        // createdAt for DB index compatibility
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        createdAt: new Date(),
        metadata: {
          adminId,
          category: PointEarningCategory.ADMIN_REWARD,
          originalBalance: currentPoints
        }
      };

      await storage.savePointTransaction(transaction);

      this.logger.warn(`Admin point adjustment: ${amount} for user ${userId}`, {
        adminId,
        reason,
        oldBalance: currentPoints,
        newBalance,
        transactionId: transaction.id
      });

      return {
        success: true,
        newBalance,
        transaction
      };
    } catch (error) {
      this.logger.error('Error in admin point adjustment:', error);
      return {
        success: false,
        newBalance: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Get global point statistics
   */
  static async getGlobalPointStats(): Promise<{
    totalPointsInCirculation: number;
    totalTransactions: number;
    totalUsersWithPoints: number;
    averagePointsPerUser: number;
    topEarners: Array<{ userId: string; points: number; firstName?: string }>;
  }> {
    try {
      const allUsers = await storage.getAllUsers();
      const usersWithPoints = allUsers.filter(user => (user.points || 0) > 0);
      
      const totalPointsInCirculation = usersWithPoints.reduce(
        (sum, user) => sum + (user.points || 0), 0
      );
      
      const topEarners = usersWithPoints
        .sort((a, b) => (b.points || 0) - (a.points || 0))
        .slice(0, 10)
        .map(user => ({
          userId: user.telegramId,
          points: user.points || 0,
          firstName: user.firstName
        }));

      return {
        totalPointsInCirculation,
        totalTransactions: 0, // Would need to implement getAllTransactions
        totalUsersWithPoints: usersWithPoints.length,
        averagePointsPerUser: usersWithPoints.length > 0 ? 
          totalPointsInCirculation / usersWithPoints.length : 0,
        topEarners
      };
    } catch (error) {
      this.logger.error('Error getting global point stats:', error);
      return {
        totalPointsInCirculation: 0,
        totalTransactions: 0,
        totalUsersWithPoints: 0,
        averagePointsPerUser: 0,
        topEarners: []
      };
    }
  }
}