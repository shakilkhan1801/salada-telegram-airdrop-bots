import { User } from '../types/user.types';
import { logger } from '../services/logger';

/**
 * UserFactory - Optimized user data structure creation
 * 
 * PROFESSIONAL SOLUTION - Efficient fingerprint system for multi-user detection
 * Based on analysis of proven detection methods without over-engineering.
 * 
 * Key Features:
 * - Efficient fingerprint structure (no data redundancy)
 * - Comprehensive device detection capability
 * - Optimized storage usage
 * - Professional multi-account detection
 * - Clean and maintainable code structure
 */
export class UserFactory {
  /**
   * Generate a unique referral code for the user
   */
  private static generateReferralCode(userId: string): string {
    return `REF${userId}${Math.random().toString(36).substr(2, 3).toUpperCase()}`;
  }

  /**
   * Get current timestamp in ISO format
   */
  private static getCurrentTimestamp(): string {
    return new Date().toISOString();
  }

  /**
   * Create a comprehensive user data structure
   * This is the SINGLE source of truth for user creation
   */
  static createUserData(userData: Partial<User> = {}): User {
    const userId = userData.telegramId || userData.id || '';
    
    if (!userId) {
      logger.error('UserFactory: No userId provided');
      throw new Error('userId is required for user creation');
    }

    const currentTime = this.getCurrentTimestamp();
    
    // Ensure a non-empty, unique referral code to satisfy the Mongo unique index
    const initialReferralCode =
      (typeof userData.referralCode === 'string' && userData.referralCode.trim().length > 0)
        ? userData.referralCode
        : this.generateReferralCode(userId.toString());

    // COMPLETE USER DATA STRUCTURE - Single source of truth
    const defaultUserData: User = {
      // === BASIC IDENTIFICATION ===
      id: userId.toString(),
      telegramId: userId.toString(),
      username: userData.username || undefined,
      firstName: userData.firstName || undefined,  // No fallback - use actual Telegram data
      lastName: userData.lastName || undefined,
      languageCode: userData.languageCode || 'en',
      
      // === REQUIRED FIELDS ===
      isPremium: userData.isPremium || false,
      points: userData.points || 0,
      totalEarned: userData.totalEarned || 0,
      isBlocked: userData.isBlocked || false,
      blockedUntil: userData.blockedUntil || undefined,
      isVerified: userData.isVerified || false,
      svgCaptchaVerified: userData.svgCaptchaVerified || false,
      vpnDetected: userData.vpnDetected || false,
      proxyDetected: userData.proxyDetected || false,
      torDetected: userData.torDetected || false,
      networkRiskFactors: userData.networkRiskFactors || [],
      registeredAt: userData.registeredAt || currentTime,
      lastActiveAt: userData.lastActiveAt || currentTime,
      updatedAt: userData.updatedAt || currentTime,
      riskScore: userData.riskScore || 0,
      overallThreatLevel: userData.overallThreatLevel || 'low',
      multiAccountDetected: userData.multiAccountDetected || false,
      automationDetected: userData.automationDetected || false,
      botScore: userData.botScore || 0,
      referralCode: initialReferralCode,
      totalReferrals: userData.totalReferrals || 0,
      activeReferrals: userData.activeReferrals || 0,
      referralBonusActivated: userData.referralBonusActivated || false,
      completedTasks: userData.completedTasks || [],
      tasksCompleted: userData.tasksCompleted || 0,
      taskCompletionStatus: userData.taskCompletionStatus || {},
      dailyTasksCompleted: userData.dailyTasksCompleted || {},
      pointsHistory: userData.pointsHistory || [],
      withdrawalHistory: userData.withdrawalHistory || [],
      suspiciousActivity: userData.suspiciousActivity || [],
      securityEvents: userData.securityEvents || [],
      metadata: userData.metadata || this.createDefaultMetadata(),
      
      // === ADDITIONAL OPTIONAL FIELDS ===
      isTaskBanned: userData.isTaskBanned || false,
      taskBanUntil: userData.taskBanUntil || undefined,
      isReferralBanned: userData.isReferralBanned || false,
      referralBanUntil: userData.referralBanUntil || undefined,
      firstSeen: userData.firstSeen || currentTime,
      miniappVerified: userData.miniappVerified || false,
      miniappVerifiedAt: userData.miniappVerifiedAt || undefined,
      svgCaptchaVerifiedAt: userData.svgCaptchaVerifiedAt || undefined,
      associatedFingerprintHash: userData.associatedFingerprintHash || undefined,
      fingerprint: userData.fingerprint || undefined,
      walletAddress: userData.walletAddress || undefined,
      retweetLink: userData.retweetLink || undefined,
      claimed: userData.claimed || false,
      claimTimestamp: userData.claimTimestamp || undefined,
      transactionHash: userData.transactionHash || undefined,
      nonce: userData.nonce || 0,
      lastClaimedPoints: userData.lastClaimedPoints || 0,
      totalClaimedPoints: userData.totalClaimedPoints || 0,
      previousWallet: userData.previousWallet || undefined,
      referrerId: userData.referrerId || undefined,
      referredBy: userData.referredBy || undefined,
      referrals: userData.referrals || [],
      completedTaskCount: userData.completedTaskCount || 0,
      lastTaskCompletedAt: userData.lastTaskCompletedAt || undefined,
      qrCodeGeneratedToday: userData.qrCodeGeneratedToday || 0,
      lastQrCodeDate: userData.lastQrCodeDate || undefined,
      currentQrCodeExpiry: userData.currentQrCodeExpiry || undefined,
      qrCodeSessionTopic: userData.qrCodeSessionTopic || undefined,
      awaitingTaskSubmission: userData.awaitingTaskSubmission || undefined
    };

    logger.info(`UserFactory: Created user data structure for ${userId}`, {
      userId,
      hasReferral: !!defaultUserData.referredBy,
      referralCode: defaultUserData.referralCode
    });

    // Remove null/undefined values to optimize storage
    return this.removeNullValues(defaultUserData);
  }

  /**
   * Create user data for Telegram Bot Registration
   */
  static createTelegramBotUser(userData: {
    telegramId: string;
    username?: string;
    firstName: string;
    lastName?: string;
    referredByCode?: string;
    languageCode?: string;
  }): User {
    const { referredByCode, ...rest } = userData;
    return this.createUserData({
      ...rest,
      telegramId: userData.telegramId,
      referredBy: referredByCode
    });
  }

  /**
   * Create user data for CAPTCHA completion flow
   */
  static createCaptchaUser(userData: {
    telegramId: string;
    firstName?: string;
    username?: string;
    languageCode?: string;
    ipAddress?: string;
    referredBy?: string | null;
  }): User {
    return this.createUserData({
      ...userData,
      firstName: userData.firstName,  // Use actual Telegram firstName
      miniappVerified: false,
      referredBy: userData.referredBy || undefined
    });
  }

  /**
   * Create user data with fingerprint verification flow
   */
  static createFingerprintUser(userData: {
    telegramId: string;
    firstName?: string;
    username?: string;
    lastName?: string;
    languageCode?: string;
    fingerprint?: any;
    ipAddress?: string;
    referredBy?: string | null;
  }): User {
    const { fingerprint, ...rest } = userData;
    return this.createUserData({
      ...rest,
      firstName: userData.firstName,  // Use actual Telegram firstName
      username: userData.username,
      lastName: userData.lastName,
      languageCode: userData.languageCode,
      fingerprint: fingerprint ?? undefined,
      referredBy: userData.referredBy || undefined
    });
  }

  /**
   * Create user data for Admin creation
   */
  static createAdminUser(userData: {
    telegramId: string;
    username?: string;
    firstName: string;
    lastName?: string;
    points?: number;
  }): User {
    return this.createUserData({
      ...userData,
      points: userData.points || 0
    });
  }

  /**
   * Update existing user data with new fields (for migrations)
   */
  static updateUserStructure(existingUser: any): User {
    logger.info(`UserFactory: Updating user structure for ${existingUser.id || existingUser.telegramId}`);
    
    // Merge existing data with complete structure
    return this.createUserData(existingUser);
  }

  /**
   * Update user with Telegram data from fingerprint if available
   * This fixes users who have correct telegramData in fingerprint but wrong main user fields
   */
  static updateUserWithTelegramData(existingUser: any): { updated: boolean; userData: any } {
    const userId = existingUser.id || existingUser.telegramId || '';
    logger.info(`UserFactory: Checking user ${userId} for Telegram data updates`);
    
    // Check if user has telegramData in fingerprint
    const telegramData = existingUser.fingerprint?.telegramData;
    if (!telegramData) {
      logger.info(`UserFactory: No telegramData found in fingerprint for user ${userId}`);
      return { updated: false, userData: existingUser };
    }
    
    let needsUpdate = false;
    const updates: any = {};
    
    // Check firstName
    if (telegramData.firstName && 
        telegramData.firstName !== existingUser.firstName &&
        telegramData.firstName !== 'New User') {
      updates.firstName = telegramData.firstName;
      needsUpdate = true;
      logger.info(`UserFactory: Updating firstName from '${existingUser.firstName}' to '${telegramData.firstName}' for user ${userId}`);
    }
    
    // Check username
    if (telegramData.username && 
        telegramData.username !== existingUser.username) {
      updates.username = telegramData.username;
      needsUpdate = true;
      logger.info(`UserFactory: Updating username from '${existingUser.username}' to '${telegramData.username}' for user ${userId}`);
    }
    
    // Check lastName
    if (telegramData.lastName && 
        telegramData.lastName !== existingUser.lastName) {
      updates.lastName = telegramData.lastName;
      needsUpdate = true;
      logger.info(`UserFactory: Updating lastName from '${existingUser.lastName}' to '${telegramData.lastName}' for user ${userId}`);
    }
    
    // Check languageCode
    if (telegramData.languageCode && 
        telegramData.languageCode !== existingUser.languageCode) {
      updates.languageCode = telegramData.languageCode;
      needsUpdate = true;
      logger.info(`UserFactory: Updating languageCode from '${existingUser.languageCode}' to '${telegramData.languageCode}' for user ${userId}`);
    }
    
    if (!needsUpdate) {
      logger.info(`UserFactory: No Telegram data updates needed for user ${userId}`);
      return { updated: false, userData: existingUser };
    }
    
    // Apply updates to user data
    const updatedUserData = {
      ...existingUser,
      ...updates,
      updatedAt: this.getCurrentTimestamp()
    };
    
    logger.info(`UserFactory: Applied ${Object.keys(updates).length} Telegram data updates for user ${userId}:`, updates);
    return { updated: true, userData: this.removeNullValues(updatedUserData) };
  }

  /**
   * Validate user data structure
   */
  static validateUserData(userData: any): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!userData.id && !userData.telegramId) {
      errors.push('Missing required field: id or telegramId');
    }

    // Allow firstName to be null if we don't have proper Telegram data
    // This is better than using "New User" as a fallback
    if (userData.firstName === 'New User') {
      errors.push('firstName should not be "New User" fallback - use actual Telegram data or null');
    }

    if (!userData.referralCode) {
      errors.push('Missing required field: referralCode');
    }

    if (typeof userData.points !== 'number') {
      errors.push('Invalid field type: points must be a number');
    }

    if (userData.tasksCompleted && typeof userData.tasksCompleted !== 'object') {
      errors.push('Invalid field type: tasksCompleted must be an object');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   * Create default metadata for new users
   */
  private static createDefaultMetadata(): any {
    return {
      createdBy: 'registration',
      registrationFlow: 'standard',
      verificationAttempts: 0,
      deviceChanges: 0,
      ipChanges: 0,
      locationChanges: 0,
      deviceBindingHistory: [],
      locationHistory: [],
      verificationHistory: [],
      riskAssessmentHistory: [],
      customFields: {}
    };
  }

  /**
   * Ultra-efficient data extraction helpers
   */
  private static extractIPAddresses(fingerprintData: any): any[] {
    if (fingerprintData?.ipAddresses) return fingerprintData.ipAddresses.slice(0, 2); // Max 2 IPs
    if (fingerprintData?.network?.ip) return [{ ip: fingerprintData.network.ip, firstSeenAt: new Date().toISOString(), count: 1 }];
    return [];
  }

  private static extractUserAgent(fingerprintData: any): string | null {
    return fingerprintData?.browser?.userAgent || fingerprintData?.userAgent || null;
  }

  private static extractScreenResolution(fingerprintData: any): string | null {
    return fingerprintData?.hardware?.screenResolution || fingerprintData?.screenResolution || null;
  }

  private static extractTimezone(fingerprintData: any): string | null {
    return fingerprintData?.hardware?.timezone || fingerprintData?.timezone || null;
  }

  private static extractCanvasFingerprint(fingerprintData: any): string | null {
    return fingerprintData?.rendering?.canvasFingerprint || fingerprintData?.canvasFingerprint || null;
  }

  private static extractWebGLFingerprint(fingerprintData: any): string | null {
    const webgl = fingerprintData?.rendering?.webGLRenderer || fingerprintData?.webGLRenderer;
    return webgl ? `${webgl}` : null;
  }

  private static extractMouseMovements(fingerprintData: any): number {
    const movements = fingerprintData?.behavioral?.mouseMovementPattern || fingerprintData?.mouseMovements || 0;
    return typeof movements === 'string' ? JSON.parse(movements).length : movements;
  }

  private static extractKeyboardTiming(fingerprintData: any): number {
    return fingerprintData?.behavioral?.keyboardTiming || fingerprintData?.keyboardTiming || 0;
  }

  /**
   * Create optimized fingerprint structure - NO REDUNDANCY
   */
  private static createOptimizedFingerprint(fingerprintData: any, userId: string): any {
    const currentTime = this.getCurrentTimestamp();
    
    // Base structure with only essential fields
    const fingerprint: any = {
      associatedUserId: userId,
      firstSeenAt: currentTime,
      lastUsedAt: currentTime,
      isBlocked: false,
      violationAttempts: 0,
      accessCount: 1
    };
    
    if (!fingerprintData) {
      return fingerprint;
    }

    // Only add fields with actual values (no null/empty values)
    const addIfExists = (key: string, value: any) => {
      if (value !== null && value !== undefined && value !== '' && 
          !(Array.isArray(value) && value.length === 0)) {
        fingerprint[key] = value;
      }
    };

    // Add hash values if they exist
    addIfExists('compositeHash', fingerprintData.compositeHash);
    addIfExists('hardwareHash', fingerprintData.hardwareHash);
    addIfExists('browserHash', fingerprintData.browserHash);
    addIfExists('renderingHash', fingerprintData.renderingHash);
    addIfExists('networkHash', fingerprintData.networkHash);
    
    // Add extracted data only if meaningful
    addIfExists('ipAddresses', this.extractIPAddresses(fingerprintData));
    addIfExists('userAgent', this.extractUserAgent(fingerprintData));
    addIfExists('screenResolution', this.extractScreenResolution(fingerprintData));
    addIfExists('timezone', this.extractTimezone(fingerprintData));
    addIfExists('canvasFingerprint', this.extractCanvasFingerprint(fingerprintData));
    addIfExists('webglFingerprint', this.extractWebGLFingerprint(fingerprintData));
    
    const mouseMovements = this.extractMouseMovements(fingerprintData);
    if (mouseMovements > 0) fingerprint.mouseMovements = mouseMovements;
    
    const keyboardTiming = this.extractKeyboardTiming(fingerprintData);
    if (keyboardTiming > 0) fingerprint.keyboardTiming = keyboardTiming;
    
    // Update timestamps if they exist
    if (fingerprintData.firstSeenAt) {
      fingerprint.firstSeenAt = fingerprintData.firstSeenAt;
    }
    
    if (fingerprintData.accessCount) {
      fingerprint.accessCount = fingerprintData.accessCount + 1;
    }

    return fingerprint;
  }

  /**
   * Remove null, undefined, and empty values to optimize storage
   */
  private static removeNullValues(obj: any): any {
    if (obj === null || obj === undefined) {
      return obj;
    }
    
    if (Array.isArray(obj)) {
      return obj.filter(item => item !== null && item !== undefined)
                .map(item => this.removeNullValues(item));
    }
    
    if (typeof obj === 'object') {
      const cleaned: any = {};
      
      for (const [key, value] of Object.entries(obj)) {
        if (value !== null && value !== undefined && value !== '') {
          if (Array.isArray(value) && value.length === 0) {
            // Skip empty arrays
            continue;
          }
          
          if (typeof value === 'object' && value !== null) {
            const cleanedValue = this.removeNullValues(value);
            if (Object.keys(cleanedValue).length > 0 || Array.isArray(cleanedValue)) {
              cleaned[key] = cleanedValue;
            }
          } else {
            cleaned[key] = value;
          }
        }
      }
      
      return cleaned;
    }
    
    return obj;
  }
}