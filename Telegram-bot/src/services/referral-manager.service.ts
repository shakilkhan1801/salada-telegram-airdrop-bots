/**
 * Professional Referral Manager Service
 * Enterprise-grade referral system with persistence, recovery, and analytics
 */

import { Context } from 'telegraf';
import { Logger } from './logger';
import { StorageManager } from '../storage';
import { getConfig } from '../config';
import { PointsService, PointEarningCategory } from '../shared';

interface ReferralSession {
  userId: string;
  referralCode?: string;
  referrerId?: string;
  timestamp: number;
  source: 'start_command' | 'captcha' | 'manual';
  processed: boolean;
}

interface ReferralBonus {
  referrerId: string;
  newUserId: string;
  bonusAmount: number;
  welcomeBonus: number;
  processed: boolean;
  processingAttempts: number;
  lastAttempt?: Date;
  error?: string;
}

interface ReferralNotification {
  type: 'simple' | 'detailed' | 'custom';
  message?: string;
  includeStats?: boolean;
  includeTips?: boolean;
}

export class ReferralManagerService {
  private static instance: ReferralManagerService;
  private readonly logger = Logger.getInstance();
  private readonly storage = StorageManager.getInstance();
  private readonly config = getConfig();
  
  // In-memory session storage with TTL
  private referralSessions = new Map<string, ReferralSession>();
  private pendingBonuses = new Map<string, ReferralBonus>();
  private processingQueue: string[] = [];
  private isProcessing = false;
  
  // Bot instance for notifications
  private botInstance: any = null;

  private constructor() {
    // Cleanup expired sessions every 5 minutes
    setInterval(() => this.cleanupExpiredSessions(), 5 * 60 * 1000);
    
    // Process pending bonuses queue every 10 seconds
    setInterval(() => this.processPendingBonuses(), 10 * 1000);
  }

  static getInstance(): ReferralManagerService {
    if (!ReferralManagerService.instance) {
      ReferralManagerService.instance = new ReferralManagerService();
    }
    return ReferralManagerService.instance;
  }

  /**
   * Set bot instance for notifications
   */
  setBotInstance(bot: any): void {
    this.botInstance = bot;
    this.logger.info('ReferralManager: Bot instance configured');
  }

  /**
   * Extract referral code from context (works with or without captcha)
   */
  extractReferralCode(ctx: Context): string | null {
    try {
      // Extract from start parameter (Telegram deep link)
      const startPayload = (ctx as any).startPayload as string | undefined;
      
      this.logger.info('ReferralManager: Extracting referral code', {
        startPayload,
        hasMessage: !!(ctx.message),
        messageText: ctx.message && 'text' in ctx.message ? (ctx.message as any).text : undefined
      });
      
      if (startPayload) {
        // Support legacy "ref_" prefix
        if (startPayload.startsWith('ref_')) {
          const code = startPayload.substring(4);
          this.logger.info('ReferralManager: Found ref_ prefixed code', { code });
          return code;
        }
        
        // Accept plain alphanumeric, underscore and hyphen payloads
        if (/^[A-Za-z0-9_-]+$/.test(startPayload)) {
          this.logger.info('ReferralManager: Found plain payload code', { code: startPayload });
          return startPayload;
        }
      }
      
      // Extract from message text (e.g., "/start <payload>" or "/start ref_<code>")
      const message = ctx.message && 'text' in ctx.message ? (ctx.message as any).text : undefined;
      if (message) {
        // Prefer explicit ref_ pattern first
        let match = message.match(/start\s+ref_([A-Za-z0-9_-]+)/i);
        if (match) {
          this.logger.info('ReferralManager: Found ref_ pattern in message', { code: match[1] });
          return match[1];
        }
        
        // Fallback: any safe payload
        match = message.match(/start\s+([A-Za-z0-9_-]+)/i);
        if (match) {
          this.logger.info('ReferralManager: Found plain pattern in message', { code: match[1] });
          return match[1];
        }
      }
      
      this.logger.info('ReferralManager: No referral code found');
      return null;
    } catch (error) {
      this.logger.error('ReferralManager: Error extracting referral code', error);
      return null;
    }
  }

  /**
   * Store referral session for later processing
   */
  async storeReferralSession(
    userId: string, 
    referralCode: string | null,
    source: 'start_command' | 'captcha' | 'manual' = 'start_command'
  ): Promise<void> {
    if (!referralCode) return;
    
    try {
      // Resolve referral code to get referrer ID
      const referrerId = await this.resolveReferralCode(referralCode);
      
      const session: ReferralSession = {
        userId,
        referralCode,
        referrerId: referrerId || undefined,
        timestamp: Date.now(),
        source,
        processed: false
      };
      
      // Store in memory
      this.referralSessions.set(userId, session);
      
      // Also store in database for persistence
      const user = await this.storage.getUser(userId);
      if (user) {
        user.metadata = user.metadata || {};
        user.metadata.pendingReferral = {
          code: referralCode,
          referrerId,
          timestamp: session.timestamp,
          source
        };
        await this.storage.updateUser(userId, { metadata: user.metadata });
      }
      
      this.logger.info('ReferralManager: Stored referral session', {
        userId,
        referralCode,
        referrerId,
        source
      });
    } catch (error) {
      this.logger.error('ReferralManager: Failed to store referral session', error);
    }
  }

  /**
   * Get stored referral session
   */
  async getReferralSession(userId: string): Promise<ReferralSession | null> {
    // First check memory
    const memorySession = this.referralSessions.get(userId);
    if (memorySession && !memorySession.processed) {
      return memorySession;
    }
    
    // Fallback to database
    const user = await this.storage.getUser(userId);
    if (user?.metadata?.pendingReferral) {
      const dbSession = user.metadata.pendingReferral;
      return {
        userId,
        referralCode: dbSession.code,
        referrerId: dbSession.referrerId,
        timestamp: dbSession.timestamp,
        source: dbSession.source || 'start_command',
        processed: false
      };
    }
    
    return null;
  }

  /**
   * Clear referral session after processing
   */
  async clearReferralSession(userId: string): Promise<void> {
    // Clear from memory
    this.referralSessions.delete(userId);
    
    // Clear from database
    const user = await this.storage.getUser(userId);
    if (user?.metadata?.pendingReferral) {
      delete user.metadata.pendingReferral;
      await this.storage.updateUser(userId, { metadata: user.metadata });
    }
  }

  /**
   * Resolve referral code to user ID
   */
  async resolveReferralCode(code: string): Promise<string | null> {
    if (!code) return null;
    
    try {
      this.logger.info('ReferralManager: Resolving referral code', { code });
      
      // First try to find user by referral code (custom codes)
      const byCode = await this.storage.getUserByReferralCode(code);
      if (byCode) {
        this.logger.info('ReferralManager: Found referrer by referral code', {
          code,
          referrerId: byCode.telegramId || byCode.id,
          referrerName: byCode.firstName
        });
        return byCode.telegramId || null;
      }
      
      // If not found by referral code, try to find by numeric user ID (legacy)
      if (/^\d+$/.test(code)) {
        this.logger.info('ReferralManager: Trying numeric user ID lookup', { code });
        const byId = await this.storage.getUser(code);
        if (!byId) {
          this.logger.info('ReferralManager: No user found with numeric ID', { code });
          return null;
        }
        
        // Check if user has locked custom referral code
        const locked = !!(byId.metadata?.customFields?.referralCodeLocked) &&
          typeof byId.referralCode === 'string' && byId.referralCode.length > 0;
        if (locked) {
          this.logger.info('ReferralManager: Numeric link blocked - user has locked custom code', {
            code,
            userId: byId.telegramId || byId.id,
            customCode: byId.referralCode
          });
          return null;
        }
        
        this.logger.info('ReferralManager: Found referrer by numeric ID', {
          code,
          referrerId: byId.telegramId || byId.id,
          referrerName: byId.firstName
        });
        return byId.telegramId || byId.id || null;
      }
      
      this.logger.info('ReferralManager: Code format not recognized', { code });
      return null;
    } catch (error) {
      this.logger.error('ReferralManager: Failed to resolve referral code', error);
      return null;
    }
  }

  /**
   * Process referral bonus with retry mechanism
   */
  async processReferralBonus(
    referrerId: string, 
    newUserId: string,
    options?: {
      immediate?: boolean;
      notificationType?: ReferralNotification['type'];
    }
  ): Promise<boolean> {
    try {
      this.logger.info('ReferralManager: Processing referral bonus', {
        referrerId,
        newUserId,
        immediate: options?.immediate
      });
      
      // Check if already processed
      const referrals = await this.storage.getReferralRecords(referrerId);
      const existingRecord = referrals.find(r => r.referredUserId === newUserId);
      if (existingRecord) {
        this.logger.info('ReferralManager: Referral bonus already processed', {
          referrerId,
          newUserId
        });
        return true;
      }
      
      // Get users
      const referrer = await this.storage.getUser(referrerId);
      const newUser = await this.storage.getUser(newUserId);
      
      if (!referrer || !newUser) {
        this.logger.error('ReferralManager: User not found for referral bonus', {
          referrerId,
          newUserId,
          referrerFound: !!referrer,
          newUserFound: !!newUser
        });
        
        // Queue for retry if users not found
        if (!options?.immediate) {
          await this.queueReferralBonus(referrerId, newUserId);
        }
        return false;
      }
      
      // Calculate bonuses
      const referrerBonus = this.config.bot.referralBonus;
      const welcomeBonusEnabled = this.config.bot.referralWelcomeBonusEnabled;
      const welcomeBonus = welcomeBonusEnabled ? this.config.bot.referralWelcomeBonus : 0;
      
      // Award points to referrer
      const referrerResult = await PointsService.awardPoints(
        referrerId,
        referrerBonus,
        `Referral bonus for inviting ${newUser.firstName || 'user'}`,
        PointEarningCategory.REFERRAL_BONUS,
        { referredUserId: newUserId }
      );
      
      if (!referrerResult.success) {
        this.logger.error('ReferralManager: Failed to award referrer points', {
          referrerId,
          error: referrerResult.error
        });
        
        // Queue for retry
        if (!options?.immediate) {
          await this.queueReferralBonus(referrerId, newUserId);
        }
        return false;
      }
      
      // Update referrer stats
      await this.storage.updateUser(referrerId, {
        totalReferrals: (referrer.totalReferrals || 0) + 1,
        activeReferrals: (referrer.activeReferrals || 0) + 1
      });
      
      // Award welcome bonus to new user (if enabled)
      if (welcomeBonusEnabled && welcomeBonus > 0) {
        await PointsService.awardPoints(
          newUserId,
          welcomeBonus,
          'Welcome bonus for joining via referral',
          PointEarningCategory.BONUS
        );
      }
      
      // Save referral record
      const referralRecord = {
        id: `ref_${Date.now()}_${referrerId}`,
        referrerId,
        referredUserId: newUserId,
        referralCode: referrer.referralCode,
        joinedAt: new Date(),
        bonusAwarded: referrerBonus,
        welcomeBonus,
        isActive: true
      };
      
      await this.storage.saveReferralRecord(referralRecord);
      
      // Send notification
      await this.sendReferralNotification(
        referrerId,
        newUser,
        referrerBonus,
        (referrer.totalReferrals || 0) + 1,
        options?.notificationType || 'simple'
      );
      
      this.logger.info('ReferralManager: Referral bonus processed successfully', {
        referrerId,
        newUserId,
        referrerBonus,
        welcomeBonus
      });
      
      return true;
    } catch (error) {
      this.logger.error('ReferralManager: Error processing referral bonus', error);
      
      // Queue for retry
      if (!options?.immediate) {
        await this.queueReferralBonus(referrerId, newUserId);
      }
      return false;
    }
  }

  /**
   * Queue referral bonus for retry
   */
  private async queueReferralBonus(referrerId: string, newUserId: string): Promise<void> {
    const key = `${referrerId}_${newUserId}`;
    
    if (this.pendingBonuses.has(key)) {
      const existing = this.pendingBonuses.get(key)!;
      existing.processingAttempts++;
      existing.lastAttempt = new Date();
    } else {
      const bonus: ReferralBonus = {
        referrerId,
        newUserId,
        bonusAmount: this.config.bot.referralBonus,
        welcomeBonus: this.config.bot.referralWelcomeBonusEnabled ? this.config.bot.referralWelcomeBonus : 0,
        processed: false,
        processingAttempts: 0
      };
      this.pendingBonuses.set(key, bonus);
      this.processingQueue.push(key);
    }
    
    this.logger.info('ReferralManager: Queued referral bonus for retry', {
      referrerId,
      newUserId
    });
  }

  /**
   * Process pending bonuses from queue
   */
  private async processPendingBonuses(): Promise<void> {
    if (this.isProcessing || this.processingQueue.length === 0) return;
    
    this.isProcessing = true;
    
    try {
      const maxRetries = 3;
      const processedKeys: string[] = [];
      
      for (const key of this.processingQueue) {
        const bonus = this.pendingBonuses.get(key);
        if (!bonus) continue;
        
        // Skip if max retries exceeded
        if (bonus.processingAttempts >= maxRetries) {
          this.logger.warn('ReferralManager: Max retries exceeded for bonus', {
            referrerId: bonus.referrerId,
            newUserId: bonus.newUserId,
            attempts: bonus.processingAttempts
          });
          processedKeys.push(key);
          continue;
        }
        
        // Try to process
        const success = await this.processReferralBonus(
          bonus.referrerId,
          bonus.newUserId,
          { immediate: true }
        );
        
        if (success) {
          bonus.processed = true;
          processedKeys.push(key);
        } else {
          bonus.processingAttempts++;
          bonus.lastAttempt = new Date();
        }
      }
      
      // Remove processed items
      for (const key of processedKeys) {
        this.pendingBonuses.delete(key);
        const index = this.processingQueue.indexOf(key);
        if (index > -1) {
          this.processingQueue.splice(index, 1);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Send professional referral notification
   */
  private async sendReferralNotification(
    referrerId: string,
    newUser: any,
    bonusAmount: number,
    totalReferrals: number,
    type: ReferralNotification['type'] = 'simple'
  ): Promise<void> {
    try {
      if (!this.config.notifications.referrerNotification) {
        this.logger.debug('ReferralManager: Referrer notification disabled');
        return;
      }
      
      if (!this.botInstance) {
        this.logger.warn('ReferralManager: Bot instance not available for notification');
        return;
      }
      
      let message: string;
      
      switch (type) {
        case 'simple':
          message = `❇️ New Referral Found`;
          break;
          
        case 'detailed':
          message = `🎉 <b>New Referral Success!</b>\n\n` +
                   `👤 <b>New Member:</b> ${newUser.firstName}\n` +
                   `💰 <b>Bonus Earned:</b> ${bonusAmount} points\n` +
                   `📊 <b>Total Referrals:</b> ${totalReferrals}\n` +
                   `🏆 <b>Rank Progress:</b> ${this.getReferralRank(totalReferrals)}\n\n` +
                   `💡 <b>Tip:</b> Share your code to earn more!`;
          break;
          
        default:
          message = `❇️ New referral: ${newUser.firstName} (+${bonusAmount} pts)`;
      }
      
      await this.botInstance.telegram.sendMessage(referrerId, message, {
        parse_mode: type === 'detailed' ? 'HTML' : undefined
      });
      
      this.logger.info('ReferralManager: Notification sent', {
        referrerId,
        type
      });
    } catch (error) {
      this.logger.error('ReferralManager: Failed to send notification', error);
    }
  }

  /**
   * Get referral rank based on total referrals
   */
  private getReferralRank(totalReferrals: number): string {
    if (totalReferrals >= 100) return '🏆 Diamond Ambassador';
    if (totalReferrals >= 50) return '🥇 Gold Ambassador';
    if (totalReferrals >= 20) return '🥈 Silver Ambassador';
    if (totalReferrals >= 10) return '🥉 Bronze Ambassador';
    if (totalReferrals >= 5) return '⭐ Rising Star';
    return '🌟 Newcomer';
  }

  /**
   * Cleanup expired sessions (older than 24 hours)
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    const expiryTime = 24 * 60 * 60 * 1000; // 24 hours
    
    let cleaned = 0;
    for (const [userId, session] of this.referralSessions.entries()) {
      if (now - session.timestamp > expiryTime) {
        this.referralSessions.delete(userId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.logger.info(`ReferralManager: Cleaned ${cleaned} expired sessions`);
    }
  }

  /**
   * Get referral analytics
   */
  async getReferralAnalytics(referrerId: string): Promise<any> {
    try {
      const referrals = await this.storage.getReferralRecords(referrerId);
      const user = await this.storage.getUser(referrerId);
      
      return {
        totalReferrals: user?.totalReferrals || 0,
        activeReferrals: user?.activeReferrals || 0,
        totalBonusEarned: referrals.reduce((sum, r) => sum + (r.bonusAwarded || 0), 0),
        referralCode: user?.referralCode,
        rank: this.getReferralRank(user?.totalReferrals || 0),
        recentReferrals: referrals.slice(0, 5).map(r => ({
          userId: r.referredUserId,
          joinedAt: r.joinedAt,
          bonus: r.bonusAwarded
        }))
      };
    } catch (error) {
      this.logger.error('ReferralManager: Failed to get analytics', error);
      return null;
    }
  }
}

// Export singleton instance
export const referralManager = ReferralManagerService.getInstance();