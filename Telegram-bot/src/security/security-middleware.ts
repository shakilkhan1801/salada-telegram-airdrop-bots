import { 
  SecurityAuditLog, 
  DeviceFingerprint, 
  ThreatAnalysis
} from '../types/security.types';
import { User } from '../types/user.types';
import { Logger } from '../services/logger';
import { getConfig } from '../config';
import { StorageManager } from '../storage';
import { DeviceFingerprintService } from './device-fingerprint.service';
import { unifiedSecurityEngine } from './unified-security-engine';
import { ThreatAnalyzer } from './threat-analyzer.service';
import { TelegramRateLimiter } from './rate-limiter.service';
import { safeJSONParse, ValidationSchema } from '../services/validation.service';

export interface SecurityContext {
  user: User;
  fingerprint: DeviceFingerprint;
  threatAnalysis?: ThreatAnalysis;
  riskScore: number;
  blocked: boolean;
  flagged: boolean;
  warnings: string[];
}

// Internal lightweight event shape for middleware logging
interface SimpleSecurityEvent {
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  userId: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface SecurityMiddlewareOptions {
  enableRateLimit: boolean;
  enableThreatAnalysis: boolean;
  enableMultiAccountDetection: boolean;
  enableDeviceFingerprinting: boolean;
  blockHighRiskUsers: boolean;
  auditAllActions: boolean;
}

export class SecurityMiddleware {
  private readonly logger = Logger.getInstance();
  private readonly config = getConfig();
  private readonly storage = StorageManager.getInstance();
  private readonly fingerprintService = new DeviceFingerprintService();
  private readonly securityEngine = unifiedSecurityEngine;
  private readonly threatAnalyzer = new ThreatAnalyzer();
  private readonly rateLimiter = new TelegramRateLimiter();
  private readonly options: SecurityMiddlewareOptions;

  constructor(options: Partial<SecurityMiddlewareOptions> = {}) {
    this.options = {
      enableRateLimit: true,
      enableThreatAnalysis: true,
      enableMultiAccountDetection: true,
      enableDeviceFingerprinting: true,
      blockHighRiskUsers: true,
      auditAllActions: true,
      ...options
    };
  }

  /**
   * Main security middleware for Telegram bot
   */
  createTelegramMiddleware() {
    return async (ctx: any, next: any) => {
      const startTime = Date.now();
      let nextCalled = false;
      
      try {
        const userId = ctx.from?.id?.toString();
        if (!userId) {
          this.logger.warn('Request without user ID');
          nextCalled = true;
          return next();
        }

        // Create security context
        const securityContext = await this.createSecurityContext(ctx);
        
        // Check if user is blocked
        if (securityContext.blocked) {
          await this.handleBlockedUser(ctx, securityContext);
          return;
        }

        // Rate limiting
        if (this.options.enableRateLimit) {
          const rateLimitResult = await this.rateLimiter.checkBotCommand(userId);
          if (!rateLimitResult.allowed) {
            await this.handleRateLimitExceeded(ctx, rateLimitResult);
            return;
          }
        }

        // Add security context to bot context
        ctx.security = securityContext;

        // Log security event
        if (this.options.auditAllActions) {
          await this.logSecurityEvent({
            type: 'bot_command',
            severity: 'low',
            description: `Bot command: ${ctx.message?.text || ctx.callbackQuery?.data || 'unknown'}`,
            userId,
            timestamp: new Date(),
            metadata: {
              command: ctx.message?.text,
              chatId: ctx.chat?.id,
              riskScore: securityContext.riskScore
            }
          });
        }

        // Proceed to next middleware
        nextCalled = true;
        await next();

        // Post-processing
        await this.postProcessRequest(ctx, securityContext, Date.now() - startTime);

      } catch (error) {
        this.logger.error('Security middleware error:', error);
        
        // Log security incident
        await this.logSecurityEvent({
          type: 'middleware_error',
          severity: 'high',
          description: 'Security middleware encountered an error',
          userId: ctx.from?.id?.toString() || 'unknown',
          timestamp: new Date(),
          metadata: { error: error instanceof Error ? error.message : String(error) }
        });

        // Continue processing only if next() wasn't already called
        if (!nextCalled) {
          await next();
        }
      }
    };
  }

  /**
   * Create comprehensive security context for a user
   */
  async createSecurityContext(ctx: any): Promise<SecurityContext> {
    const userId = ctx.from.id.toString();
    
    try {
      // Get user from storage - handle new users gracefully
      const user = await this.storage.getUser(userId);
      if (!user) {
        // For new users, create a basic security context without throwing error
        return this.createNewUserSecurityContext(ctx);
      }

      // DISABLED: No fingerprinting in security middleware
      // Device fingerprinting is now ONLY handled in miniapp routes during captcha completion
      let fingerprint: DeviceFingerprint;
      
      // Always use minimal fingerprint for all bot interactions
      // Real fingerprinting only happens in miniapp-routes.ts during captcha completion
      fingerprint = this.createMinimalFingerprint(userId);

      let threatAnalysis: ThreatAnalysis | undefined;
      let riskScore = 0;

      // Perform threat analysis
      if (this.options.enableThreatAnalysis) {
        threatAnalysis = await this.performThreatAnalysis(user, fingerprint);
        riskScore = threatAnalysis.overallRiskScore;
      }

      // Check if user is blocked in storage
      const isBlockedInStorage = await this.storage.isUserBlocked(userId);
      
      // Determine if user should be blocked or flagged
      const blocked = isBlockedInStorage || this.shouldBlockUser(riskScore, threatAnalysis);
      const flagged = this.shouldFlagUser(riskScore, threatAnalysis);

      // Generate warnings
      const warnings = this.generateWarnings(threatAnalysis);

      return {
        user,
        fingerprint,
        threatAnalysis,
        riskScore,
        blocked,
        flagged,
        warnings
      };

    } catch (error) {
      this.logger.error('Failed to create security context:', error);
      
      // Return safe fallback context
      return {
        user: await this.storage.getUser(userId) || this.createGuestUser(userId),
        fingerprint: this.createMinimalFingerprint(userId),
        riskScore: 0.5, // Medium risk for unknown cases
        blocked: false,
        flagged: true, // Flag for manual review
        warnings: ['Security context creation failed']
      };
    }
  }

  /**
   * Enhanced security check for high-value operations
   */
  async checkHighValueOperation(
    userId: string,
    operation: string,
    value?: number
  ): Promise<{
    allowed: boolean;
    reason?: string;
    additionalVerificationRequired?: boolean;
    cooldownMs?: number;
  }> {
    try {
      const user = await this.storage.getUser(userId);
      if (!user) {
        return { allowed: false, reason: 'User not found' };
      }

      // Check rate limits for specific operations
      let rateLimitResult;
      switch (operation) {
        case 'wallet_connection':
          rateLimitResult = await this.rateLimiter.checkWalletConnection(userId);
          break;
        case 'point_claim':
          rateLimitResult = await this.rateLimiter.checkPointClaim(userId);
          break;
        case 'task_submission':
          rateLimitResult = await this.rateLimiter.checkTaskSubmission(userId);
          break;
        default:
          rateLimitResult = await this.rateLimiter.checkBotCommand(userId);
      }

      if (!rateLimitResult.allowed) {
        return {
          allowed: false,
          reason: 'Rate limit exceeded',
          cooldownMs: rateLimitResult.resetTime.getTime() - Date.now()
        };
      }

      // Get user's current risk score
      const deviceFingerprints = await this.storage.getDeviceFingerprints(userId);
      const latestFingerprint = deviceFingerprints[0];
      
      if (latestFingerprint) {
        const relatedUsers = await this.findRelatedUsers(userId);
        const relatedFingerprints = await this.getRelatedFingerprints(relatedUsers);
        
        const threatAnalysis = await this.threatAnalyzer.analyzeUser(
          user,
          latestFingerprint,
          relatedUsers,
          relatedFingerprints
        );

        // Check threat level for high-value operations
        if (threatAnalysis.overallRiskScore >= 0.7) {
          return {
            allowed: false,
            reason: 'High security risk detected',
            additionalVerificationRequired: true
          };
        }

        if (threatAnalysis.overallRiskScore >= 0.5) {
          return {
            allowed: true,
            additionalVerificationRequired: true
          };
        }
      }

      // Check value-based limits
      if (value !== undefined) {
        const valueLimit = this.getValueLimit(user, operation);
        if (value > valueLimit) {
          return {
            allowed: false,
            reason: `Value exceeds limit (${valueLimit})`,
            additionalVerificationRequired: true
          };
        }
      }

      return { allowed: true };

    } catch (error) {
      this.logger.error('High-value operation check failed:', error);
      return {
        allowed: false,
        reason: 'Security check failed',
        additionalVerificationRequired: true
      };
    }
  }

  /**
   * Real-time security monitoring
   */
  async monitorRealTimeActivity(
    userId: string,
    activity: {
      type: string;
      data: any;
      timestamp: Date;
    }
  ): Promise<{
    alerts: SimpleSecurityEvent[];
    actionRequired: boolean;
    recommendedActions: string[];
  }> {
    const alerts: SimpleSecurityEvent[] = [];
    let actionRequired = false;
    const recommendedActions: string[] = [];

    try {
      // Create security event
      const securityEvent: SimpleSecurityEvent = {
        type: activity.type,
        severity: this.assessActivitySeverity(activity),
        description: `Real-time activity: ${activity.type}`,
        userId,
        timestamp: activity.timestamp,
        metadata: activity.data
      };

      // Real-time threat analysis
      const realTimeAnalysis = await this.threatAnalyzer.monitorRealTime(userId, securityEvent);
      
      if (realTimeAnalysis.immediateThreats.length > 0) {
        alerts.push({
          type: 'immediate_threat_detected',
          severity: 'high',
          description: `Immediate threats detected: ${realTimeAnalysis.immediateThreats.length}`,
          userId,
          timestamp: new Date(),
          metadata: { threats: realTimeAnalysis.immediateThreats }
        });
      }

      if (realTimeAnalysis.shouldBlock) {
        actionRequired = true;
        recommendedActions.push('block_user');
        
        // Update user status
        await this.updateUserSecurityStatus(userId, {
          blocked: true,
          reason: 'Real-time threat detection',
          blockedAt: new Date()
        });
      }

      if (realTimeAnalysis.shouldFlag) {
        recommendedActions.push('flag_for_review');
        
        // Update user status
        await this.updateUserSecurityStatus(userId, {
          flagged: true,
          reason: 'Real-time threat detection',
          flaggedAt: new Date()
        });
      }

      // Log all real-time events
      await this.logSecurityEvent(securityEvent);

    } catch (error) {
      this.logger.error('Real-time monitoring failed:', error);
      
      alerts.push({
        type: 'monitoring_error',
        severity: 'medium',
        description: 'Real-time monitoring encountered an error',
        userId,
        timestamp: new Date(),
        metadata: { error: error instanceof Error ? error.message : String(error) }
      });
    }

    return {
      alerts,
      actionRequired,
      recommendedActions
    };
  }

  /**
   * Batch security analysis for admin panel
   */
  async performBatchAnalysis(
    userIds: string[]
  ): Promise<{
    analyses: Array<{ userId: string; analysis: ThreatAnalysis }>;
    summary: {
      totalUsers: number;
      highRiskUsers: number;
      blockedUsers: number;
      flaggedUsers: number;
      suspiciousClusters: number;
    };
    recommendations: string[];
  }> {
    const analyses: Array<{ userId: string; analysis: ThreatAnalysis }> = [];
    let highRiskUsers = 0;
    let blockedUsers = 0;
    let flaggedUsers = 0;

    try {
      // Get all users and fingerprints
      const users = await Promise.all(
        userIds.map(id => this.storage.getUser(id))
      );
      const validUsers = users.filter(Boolean) as User[];

      const allFingerprints = await Promise.all(
        validUsers.map(user => 
          this.storage.getDeviceFingerprints(user.telegramId)
            .then(fps => fps[0]) // Get latest fingerprint
        )
      );
      const validFingerprints = allFingerprints.filter(Boolean) as DeviceFingerprint[];

      // Perform batch threat analysis
      const batchResult = await this.threatAnalyzer.analyzeBatch(validUsers, validFingerprints);
      
      // Process individual analyses
      for (const analysis of batchResult.individualAnalyses) {
        analyses.push({ userId: analysis.userId, analysis });
        
        if (analysis.overallRiskScore >= 0.7) highRiskUsers++;
        if (this.shouldBlockUser(analysis.overallRiskScore, analysis)) blockedUsers++;
        if (this.shouldFlagUser(analysis.overallRiskScore, analysis)) flaggedUsers++;
      }

      // Generate recommendations
      const recommendations = this.generateBatchRecommendations(batchResult);

      return {
        analyses,
        summary: {
          totalUsers: validUsers.length,
          highRiskUsers,
          blockedUsers,
          flaggedUsers,
          suspiciousClusters: batchResult.clusterThreats.length
        },
        recommendations
      };

    } catch (error) {
      this.logger.error('Batch analysis failed:', error);
      throw error;
    }
  }

  private async processDeviceFingerprint(ctx: any, user: User): Promise<DeviceFingerprint> {
    // RESTRICTED: Only process fingerprints during miniapp captcha completion
    // For all other cases, return minimal fingerprint
    
    const userId = user.telegramId;
    
    // Check if this is actually a miniapp captcha completion with web app data
    if (ctx.message?.web_app_data?.data) {
      const webAppDataSchema: ValidationSchema = {
        type: 'object',
        required: true,
        properties: {
          type: { type: 'string', required: true, allowedValues: ['captcha_completed'] },
          deviceData: { 
            type: 'object', 
            required: true,
            properties: {
              userAgent: { type: 'string', maxLength: 1000 },
              screen: { type: 'object' },
              language: { type: 'string', maxLength: 20 },
              timezone: { type: 'string', maxLength: 100 }
            }
          }
        }
      };
      
      const parseResult = safeJSONParse(ctx.message.web_app_data.data, webAppDataSchema);
      if (parseResult.success && parseResult.data.type === 'captcha_completed' && parseResult.data.deviceData) {
        // This is a real miniapp captcha completion with device data
        // Use the enhanced device data from the miniapp
        const enhancedDeviceData = parseResult.data.deviceData;
        const fingerprint = await this.fingerprintService.generateFingerprint(
          enhancedDeviceData, 
          userId
        );
        await this.storage.saveDeviceFingerprint(userId, fingerprint);
        return fingerprint;
      } else if (!parseResult.success) {
        this.logger.error('Error parsing web app data for fingerprinting:', parseResult.error);
      }
    }
    
    // For all other cases (SVG captcha, regular bot operations, etc.)
    // return minimal fingerprint without calling the full fingerprint service
    return this.createMinimalFingerprint(userId);
  }

  // Removed extractFingerprintComponents as it's no longer needed
  // Fingerprinting now only happens with enhanced device data from miniapp

  private createMinimalFingerprint(userId: string): DeviceFingerprint {
    const now = new Date().toISOString();
    return {
      hash: `minimal_${userId}`,
      userId,
      components: {
        hardware: {
          screenResolution: 'unknown',
          screenColorDepth: 'unknown',
          availableScreenSize: 'unknown',
          timezone: 'unknown',
          timezoneOffset: 0,
          language: 'unknown',
          languages: [],
          platform: 'telegram',
          hardwareConcurrency: 0,
          deviceMemory: 0,
          maxTouchPoints: 0
        },
        browser: {
          userAgent: 'telegram',
          vendor: 'unknown',
          vendorSub: '',
          product: 'unknown',
          productSub: '',
          appName: 'unknown',
          appVersion: 'unknown',
          appCodeName: 'unknown',
          cookieEnabled: true,
          doNotTrack: undefined,
          onLine: true,
          javaEnabled: false,
          mimeTypes: [],
          plugins: []
        },
        rendering: {},
        network: {},
        behavioral: { focusEvents: 0 }
      },
      quality: {
        overall: 0.1,
        hardware: 0.1,
        browser: 0.1,
        rendering: 0.1,
        network: 0.1,
        uniqueness: 0,
        stability: 0.5
      },
      registeredAt: now,
      lastSeenAt: now,
      usageCount: 1,
      isBlocked: false,
      riskScore: 0,
      metadata: {
        collisionCount: 0,
        similarDevices: [],
        riskFactors: [],
        verificationHistory: [{
          timestamp: now,
          action: 'registered',
          reason: 'Minimal fingerprint created by middleware'
        }]
      }
    };
  }

  private async performThreatAnalysis(
    user: User, 
    fingerprint: DeviceFingerprint
  ): Promise<ThreatAnalysis> {
    const relatedUsers = await this.findRelatedUsers(user.telegramId);
    const relatedFingerprints = await this.getRelatedFingerprints(relatedUsers);
    
    return this.threatAnalyzer.analyzeUser(
      user,
      fingerprint,
      relatedUsers,
      relatedFingerprints
    );
  }

  private shouldBlockUser(riskScore: number, analysis?: ThreatAnalysis): boolean {
    if (!this.options.blockHighRiskUsers) return false;
    
    // Block based on risk score
    if (riskScore >= this.config.security.blockThreshold) return true;
    
    // Block based on specific threats
    if (analysis?.riskFactors.some(factor => 
      factor.severity === 'critical' && factor.score >= 0.8
    )) return true;
    
    return false;
  }

  private shouldFlagUser(riskScore: number, analysis?: ThreatAnalysis): boolean {
    // Flag based on risk score
    if (riskScore >= this.config.security.flagThreshold) return true;
    
    // Flag based on specific threats
    if (analysis?.riskFactors.some(factor => 
      factor.severity === 'high' && factor.score >= 0.7
    )) return true;
    
    return false;
  }

  private generateWarnings(analysis?: ThreatAnalysis): string[] {
    if (!analysis) return [];
    
    return analysis.riskFactors
      .filter(factor => factor.severity === 'medium' || factor.severity === 'high')
      .map(factor => factor.description);
  }

  private createGuestUser(userId: string): User {
    const now = new Date().toISOString();
    return {
      id: userId,
      telegramId: userId,
      username: `guest_${userId}`,
      firstName: 'Guest',
      lastName: '',
      isPremium: false,
      points: 0,
      totalEarned: 0,
      isBlocked: false,
      isVerified: false,
      svgCaptchaVerified: false,
      referralCode: '',
      totalReferrals: 0,
      activeReferrals: 0,
      referralBonusActivated: false,
      completedTasks: [],
      tasksCompleted: 0,
      taskCompletionStatus: {},
      dailyTasksCompleted: {},
      pointsHistory: [],
      withdrawalHistory: [],
      suspiciousActivity: [],
      securityEvents: [],
      vpnDetected: false,
      proxyDetected: false,
      torDetected: false,
      networkRiskFactors: [],
      registeredAt: now,
      lastActiveAt: now,
      updatedAt: now,
      riskScore: 0,
      overallThreatLevel: 'low',
      multiAccountDetected: false,
      automationDetected: false,
      botScore: 0,
      metadata: {
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
      }
    } as User;
  }

  private async findRelatedUsers(userId: string): Promise<User[]> {
    // Find users with similar characteristics
    // This is a simplified implementation
    const allUsers = await this.storage.getAllUsers();
    return allUsers.filter(user => user.telegramId !== userId).slice(0, 50);
  }

  private async getRelatedFingerprints(users: User[]): Promise<DeviceFingerprint[]> {
    const fingerprints: DeviceFingerprint[] = [];
    
    for (const user of users) {
      const userFingerprints = await this.storage.getDeviceFingerprints(user.telegramId);
      if (userFingerprints.length > 0) {
        fingerprints.push(userFingerprints[0]);
      }
    }
    
    return fingerprints;
  }

  private async handleBlockedUser(ctx: any, securityContext: SecurityContext): Promise<void> {
    await ctx.reply(
      '🚫 Your account has been temporarily suspended due to security concerns. ' +
      'Please contact support if you believe this is an error.'
    );
    
    this.logger.warn('Blocked user attempted access', {
      userId: securityContext.user.telegramId,
      riskScore: securityContext.riskScore,
      warnings: securityContext.warnings
    });
  }

  private async handleRateLimitExceeded(ctx: any, rateLimitResult: any): Promise<void> {
    const resetTime = rateLimitResult.resetTime.toLocaleTimeString();
    await ctx.reply(
      `⏰ Rate limit exceeded. Please try again after ${resetTime}.`
    );
  }

  private async logSecurityEvent(event: SimpleSecurityEvent): Promise<void> {
    try {
      // Map internal event to SecurityAuditLog shape
      const severityMap: Record<SimpleSecurityEvent['severity'], 'info' | 'warning' | 'error' | 'critical'> = {
        low: 'info',
        medium: 'warning',
        high: 'error',
        critical: 'critical'
      };

      const auditLog: SecurityAuditLog = {
        id: `log_${Date.now()}_${event.userId}`,
        timestamp: new Date().toISOString(),
        action: 'security_alert',
        performedBy: event.userId,
        targetUserId: event.userId,
        details: {
          reason: event.description,
          automatedAction: false,
          appealable: true
        },
        severity: severityMap[event.severity],
        metadata: { ...(event.metadata || {}), eventType: event.type }
      } as SecurityAuditLog;

      await this.storage.saveSecurityAuditLog(auditLog);
    } catch (error) {
      this.logger.error('Failed to log security event:', error);
    }
  }

  private async postProcessRequest(
    ctx: any, 
    securityContext: SecurityContext, 
    processingTime: number
  ): Promise<void> {
    // Update user last active time
    try {
      await this.storage.updateUser(securityContext.user.telegramId, {
        lastActive: new Date()
      });

      // Log performance metrics
      if (processingTime > 1000) {
        this.logger.warn('Slow security processing', {
          userId: securityContext.user.telegramId,
          processingTime,
          riskScore: securityContext.riskScore
        });
      }
    } catch (error) {
      this.logger.error('Post-processing failed:', error instanceof Error ? error : String(error));
    }
  }

  private assessActivitySeverity(activity: any): 'low' | 'medium' | 'high' | 'critical' {
    const highRiskActivities = ['wallet_connection', 'large_point_claim', 'admin_action'];
    const mediumRiskActivities = ['task_submission', 'referral_code_usage'];
    
    if (highRiskActivities.includes(activity.type)) return 'high';
    if (mediumRiskActivities.includes(activity.type)) return 'medium';
    return 'low';
  }

  private async updateUserSecurityStatus(userId: string, status: any): Promise<void> {
    try {
      // This would update user's security status in storage
      // Implementation depends on how security status is stored
      this.logger.info('Updated user security status', { userId, status });
    } catch (error) {
      this.logger.error('Failed to update user security status:', error);
    }
  }

  private getValueLimit(user: User, operation: string): number {
    const baseLimits = {
      point_claim: 1000,
      wallet_connection: 1,
      task_submission: 100
    };

    // Adjust based on user trust level
    const trustMultiplier = this.getUserTrustMultiplier(user);
    return (baseLimits[operation as keyof typeof baseLimits] || 100) * trustMultiplier;
  }

  private getUserTrustMultiplier(user: User): number {
    try {
      // Calculate trust based on account age and activity
      // Handle different possible field names for registration date
      const registrationDate = (user as any).registeredAt || (user as any).firstSeen || (user as any).joinedAt;
      
      if (!registrationDate) {
        return 1; // Default multiplier if no registration date
      }
      
      const joinedDate = typeof registrationDate === 'string' ? new Date(registrationDate) : registrationDate;
      
      if (isNaN(joinedDate.getTime())) {
        return 1; // Default multiplier if invalid date
      }
      
      const accountAgeDays = (Date.now() - joinedDate.getTime()) / (1000 * 60 * 60 * 24);
      const trustMultiplier = Math.min(1 + (accountAgeDays / 30), 2); // Max 2x for accounts > 30 days
      return trustMultiplier;
    } catch (error) {
      return 1; // Default multiplier on any error
    }
  }

  private generateBatchRecommendations(batchResult: any): string[] {
    const recommendations: string[] = [];
    
    if (batchResult.clusterThreats.length > 0) {
      recommendations.push('Investigate suspicious account clusters');
    }
    
    if (batchResult.emergingPatterns.length > 0) {
      recommendations.push('Review emerging threat patterns');
    }
    
    return recommendations;
  }

  /**
   * Create basic security context for new users during registration process
   */
  private createNewUserSecurityContext(ctx: any): SecurityContext {
    const userId = ctx.from.id.toString();
    
    // Create temporary guest user record
    const guestUser = this.createGuestUser(userId);
    
    // Create minimal device fingerprint
    const fingerprint = this.createMinimalFingerprint(userId);
    
    // Return low-risk security context for new users
    return {
      user: guestUser,
      fingerprint,
      riskScore: 0.1, // Low risk for new users during registration
      blocked: false, // Don't block registration
      flagged: false, // Don't flag registration
      warnings: [] // No warnings during registration
    };
  }
}