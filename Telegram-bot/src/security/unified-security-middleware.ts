/**
 * Unified Security Middleware
 * 
 * Modern security middleware that uses the UnifiedSecurityEngine for comprehensive
 * security analysis and decision making. This replaces the fragmented middleware
 * approach with a single, coordinated security layer.
 */

import { Request, Response, NextFunction } from 'express';
import { Context as TelegramContext } from 'telegraf';
import { Logger } from '../services/logger';
import { getConfig } from '../config';
import { StorageManager } from '../storage';
import { User } from '../types/user.types';
import { unifiedSecurityEngine, type UnifiedSecurityAnalysis } from './unified-security-engine';
import { DeviceFingerprintService, type EnhancedDeviceData } from './device-fingerprint.service';
import { RateLimiter } from './rate-limiter.service';

// Enhanced security context with unified analysis
export interface UnifiedSecurityContext {
  user: User;
  analysis: UnifiedSecurityAnalysis;
  requestMetadata: {
    ipAddress?: string;
    userAgent?: string;
    timestamp: string;
    endpoint?: string;
    method?: string;
  };
  decision: {
    allowed: boolean;
    action: 'allow' | 'block' | 'challenge' | 'monitor' | 'throttle';
    reason: string;
    confidence: number;
  };
  monitoring: {
    logLevel: 'debug' | 'info' | 'warn' | 'error';
    alertRequired: boolean;
    followUpActions: string[];
  };
}

export interface UnifiedSecurityOptions {
  // Core detection toggles
  multiAccountDetection: boolean;
  behavioralAnalysis: boolean;
  deviceFingerprinting: boolean;
  networkAnalysis: boolean;
  threatPatternRecognition: boolean;
  
  // Security thresholds
  riskScoreThreshold: number;
  autoBlockThreshold: number;
  challengeThreshold: number;
  
  // Response options
  blockHighRiskUsers: boolean;
  requireChallenges: boolean;
  enableThrottling: boolean;
  auditAllActivity: boolean;
  
  // Rate limiting
  enableRateLimit: boolean;
  rateLimitRules: {
    requests: number;
    windowMs: number;
    skipSuccessfulRequests?: boolean;
  };
}

/**
 * Unified Security Middleware Class
 * Provides comprehensive security analysis and enforcement
 */
export class UnifiedSecurityMiddleware {
  private readonly logger = Logger.getInstance();
  private readonly config = getConfig();
  private readonly storage = StorageManager.getInstance();
  private readonly fingerprintService = new DeviceFingerprintService();
  private readonly rateLimiter = new RateLimiter();
  private readonly options: UnifiedSecurityOptions;

  constructor(options: Partial<UnifiedSecurityOptions> = {}) {
    this.options = {
      // Default configuration
      multiAccountDetection: true,
      behavioralAnalysis: true,
      deviceFingerprinting: true,
      networkAnalysis: true,
      threatPatternRecognition: true,
      
      riskScoreThreshold: 0.6,
      autoBlockThreshold: 0.8,
      challengeThreshold: 0.5,
      
      blockHighRiskUsers: true,
      requireChallenges: true,
      enableThrottling: true,
      auditAllActivity: false,
      
      enableRateLimit: true,
      rateLimitRules: {
        requests: 100,
        windowMs: 15 * 60 * 1000, // 15 minutes
        skipSuccessfulRequests: true
      },
      
      ...options
    };
  }

  /**
   * Express middleware for HTTP requests
   */
  expressMiddleware() {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        // Extract request information
        const ipAddress = req.ip || req.connection.remoteAddress || 'unknown';
        const userAgent = req.get('User-Agent') || 'unknown';
        
        // Get user from request (assumes user is attached by auth middleware)
        const user = (req as any).user;
        if (!user) {
          return next(); // Skip security analysis if no user
        }

        // Rate limiting check
        if (this.options.enableRateLimit) {
          const rlConfig = {
            windowMs: this.options.rateLimitRules.windowMs,
            maxRequests: this.options.rateLimitRules.requests,
            keyGenerator: (id: string) => `http:${req.path}:${id}`
          } as import('./rate-limiter.service').RateLimitConfig;

          const rateLimitResult = await this.rateLimiter.checkLimit(
            user.id,
            rlConfig
          );

          if (!rateLimitResult.allowed) {
            return res.status(429).json({
              error: 'Rate limit exceeded',
              resetTime: rateLimitResult.resetTime.toISOString(),
              remaining: rateLimitResult.remaining
            });
          }
        }

        // Perform unified security analysis
        const securityContext = await this.analyzeRequest({
          user,
          ipAddress,
          userAgent,
          endpoint: req.path,
          method: req.method,
          body: req.body,
          headers: req.headers
        });

        // Apply security decision
        const response = this.applySecurityDecision(securityContext, res);
        if (response) {
          return response; // Request was blocked or challenged
        }

        // Attach security context to request for downstream use
        (req as any).securityContext = securityContext;

        next();

      } catch (error) {
        this.logger.error('Security middleware error:', error);
        next(error);
      }
    };
  }

  /**
   * Telegraf middleware for Telegram bot updates
   */
  telegramMiddleware() {
    return async (ctx: TelegramContext, next: () => Promise<void>) => {
      try {
        // Extract Telegram user and context
        const telegramUser = ctx.from;
        if (!telegramUser) {
          return next(); // Skip if no user info
        }

        // Get full user object (assumes user lookup service)
        const user = await this.getUserById(telegramUser.id.toString());
        if (!user) {
          return next(); // Skip if user not found
        }

        // Extract available device/behavioral data from Telegram context
        const deviceData = this.extractTelegramDeviceData(ctx);
        const behaviorData = this.extractTelegramBehaviorData(ctx);

        // Perform security analysis
        const securityContext = await this.analyzeTelegramUpdate({
          user,
          deviceData,
          behaviorData,
          updateType: ctx.updateType,
          messageType: (ctx.message as any)?.text ? 'text' : 'other'
        });

        // Apply security decision for Telegram
        const shouldBlock = this.applyTelegramSecurityDecision(securityContext, ctx);
        if (shouldBlock) {
          return; // Update was blocked
        }

        // Attach security context for downstream handlers
        (ctx as any).securityContext = securityContext;

        await next();

      } catch (error) {
        this.logger.error('Telegram security middleware error:', error);
        await next(); // Continue on error to prevent bot disruption
      }
    };
  }

  /**
   * Core security analysis for HTTP requests
   */
  private async analyzeRequest(requestData: {
    user: User;
    ipAddress: string;
    userAgent: string;
    endpoint: string;
    method: string;
    body?: any;
    headers?: any;
  }): Promise<UnifiedSecurityContext> {
    
    const { user, ipAddress, userAgent, endpoint, method } = requestData;

    // Create enhanced device data from HTTP request
    const deviceData: EnhancedDeviceData = {
      hardware: {
        screenResolution: requestData.headers?.['x-screen-resolution'] || 'unknown',
        screenColorDepth: `${parseInt(requestData.headers?.['x-color-depth'] || '24')}\-bit`.replace('\\-','-'),
        availableScreenSize: 'unknown',
        timezone: requestData.headers?.['x-timezone'] || 'unknown',
        timezoneOffset: 0,
        language: (requestData.headers?.['accept-language'] || 'unknown').toString(),
        languages: [],
        platform: this.extractPlatformFromUserAgent(userAgent),
        hardwareConcurrency: parseInt(requestData.headers?.['x-hardware-concurrency'] || '1'),
        deviceMemory: 0,
        maxTouchPoints: requestData.headers?.['x-touch-support'] === 'true' ? 1 : 0
      },
      browser: {
        userAgent,
        vendor: 'unknown',
        vendorSub: '',
        product: 'unknown',
        productSub: '',
        appName: 'unknown',
        appVersion: 'unknown',
        appCodeName: 'unknown',
        cookieEnabled: true,
        doNotTrack: requestData.headers?.['dnt'] === '1' ? '1' : undefined,
        onLine: true,
        javaEnabled: false,
        mimeTypes: [],
        plugins: []
      },
      rendering: {
        webGLRenderer: requestData.headers?.['x-webgl-renderer'] || 'unknown',
        audioFingerprint: requestData.headers?.['x-audio-fingerprint'] || 'unknown',
        canvasFingerprint: requestData.headers?.['x-canvas-fingerprint'] || 'unknown'
      },
      network: {
        connection: {
          effectiveType: requestData.headers?.['ect'] || 'unknown',
          downlink: parseFloat(requestData.headers?.['downlink'] || '0'),
          rtt: parseFloat(requestData.headers?.['rtt'] || '0'),
          saveData: false
        },
        webRTCIPs: [],
        dnsOverHttps: false
      },
      behavioral: { focusEvents: 0 },
      sessionData: {
        sessionId: 'http',
        timestamp: Date.now(),
        userAgent,
        referrer: (requestData.headers?.['referer'] || '').toString(),
        url: endpoint
      },
      location: {
        ip: ipAddress,
        country: 'Unknown',
        region: 'Unknown',
        city: 'Unknown',
        timezone: 'UTC',
        isp: 'Unknown',
        proxy: false,
        vpn: false
      } as any
    };

    // Extract behavioral data from request patterns
    const behaviorData = this.extractBehaviorFromRequest(user.id, requestData);

    // Perform unified security analysis
    const analysis = await unifiedSecurityEngine.analyzeUser(
      user,
      deviceData,
      behaviorData,
      ipAddress
    );

    // Create security context
    const securityContext: UnifiedSecurityContext = {
      user,
      analysis,
      requestMetadata: {
        ipAddress,
        userAgent,
        timestamp: new Date().toISOString(),
        endpoint,
        method
      },
      decision: this.makeSecurityDecision(analysis),
      monitoring: this.determineMonitoringLevel(analysis)
    };

    // Log security analysis if required
    await this.logSecurityAnalysis(securityContext);

    return securityContext;
  }

  /**
   * Core security analysis for Telegram updates
   */
  private async analyzeTelegramUpdate(updateData: {
    user: User;
    deviceData?: any;
    behaviorData?: any;
    updateType: string;
    messageType: string;
  }): Promise<UnifiedSecurityContext> {
    
    const { user, deviceData, behaviorData } = updateData;

    // Create minimal device data for Telegram (limited fingerprinting available)
    const enhancedDeviceData: EnhancedDeviceData = {
      hardware: {
        screenResolution: 'unknown',
        screenColorDepth: 'unknown',
        availableScreenSize: 'unknown',
        timezone: 'unknown',
        timezoneOffset: 0,
        language: user.languageCode || 'unknown',
        languages: [],
        platform: 'telegram',
        hardwareConcurrency: 1,
        deviceMemory: 0,
        maxTouchPoints: 0
      },
      browser: {
        userAgent: 'Telegram',
        vendor: 'unknown',
        vendorSub: '',
        product: 'unknown',
        productSub: '',
        appName: 'unknown',
        appVersion: 'unknown',
        appCodeName: 'unknown',
        cookieEnabled: false,
        doNotTrack: undefined,
        onLine: true,
        javaEnabled: false,
        mimeTypes: [],
        plugins: []
      },
      rendering: {},
      network: {},
      behavioral: { focusEvents: 0 },
      sessionData: {
        sessionId: 'telegram',
        timestamp: Date.now(),
        userAgent: 'Telegram',
        referrer: '',
        url: `telegram_${updateData.updateType}`
      }
    };

    // Perform unified security analysis
    const analysis = await unifiedSecurityEngine.analyzeUser(
      user,
      enhancedDeviceData,
      behaviorData
    );

    const securityContext: UnifiedSecurityContext = {
      user,
      analysis,
      requestMetadata: {
        timestamp: new Date().toISOString(),
        endpoint: `telegram_${updateData.updateType}`,
        method: updateData.messageType
      },
      decision: this.makeSecurityDecision(analysis),
      monitoring: this.determineMonitoringLevel(analysis)
    };

    await this.logSecurityAnalysis(securityContext);
    return securityContext;
  }

  /**
   * Make security decision based on analysis
   */
  private makeSecurityDecision(analysis: UnifiedSecurityAnalysis): UnifiedSecurityContext['decision'] {
    const riskScore = analysis.overall.riskScore;
    const threatLevel = analysis.overall.threatLevel;

    if (riskScore >= this.options.autoBlockThreshold || threatLevel === 'critical') {
      return {
        allowed: false,
        action: 'block',
        reason: `High risk detected: ${threatLevel} (${Math.round(riskScore * 100)}% risk score)`,
        confidence: analysis.overall.confidence
      };
    }

    if (riskScore >= this.options.challengeThreshold || threatLevel === 'high') {
      return {
        allowed: true,
        action: 'challenge',
        reason: `Moderate risk detected: requires additional verification`,
        confidence: analysis.overall.confidence
      };
    }

    if (riskScore >= this.options.riskScoreThreshold || threatLevel === 'medium') {
      return {
        allowed: true,
        action: 'monitor',
        reason: `Elevated risk detected: enhanced monitoring enabled`,
        confidence: analysis.overall.confidence
      };
    }

    return {
      allowed: true,
      action: 'allow',
      reason: 'No significant security concerns detected',
      confidence: analysis.overall.confidence
    };
  }

  /**
   * Apply security decision to HTTP response
   */
  private applySecurityDecision(
    context: UnifiedSecurityContext, 
    res: Response
  ): Response | null {
    const { decision, analysis } = context;

    switch (decision.action) {
      case 'block':
        return res.status(403).json({
          error: 'Access denied',
          reason: 'Security violation detected',
          code: 'SECURITY_BLOCK',
          timestamp: new Date().toISOString()
        });

      case 'challenge':
        return res.status(202).json({
          requiresChallenge: true,
          challengeType: 'captcha', // Could be dynamic based on violation type
          reason: 'Additional verification required',
          code: 'SECURITY_CHALLENGE'
        });

      case 'throttle':
        // Add throttling headers but allow request
        res.set({
          'X-RateLimit-Limit': '10',
          'X-RateLimit-Remaining': '5',
          'X-RateLimit-Reset': new Date(Date.now() + 60000).toISOString()
        });
        return null; // Continue processing

      case 'monitor':
        // Add monitoring headers
        res.set({
          'X-Security-Monitor': 'enhanced',
          'X-Security-Score': Math.round(analysis.overall.riskScore * 100).toString()
        });
        return null; // Continue processing

      default:
        return null; // Allow request to proceed
    }
  }

  /**
   * Apply security decision to Telegram update
   */
  private applyTelegramSecurityDecision(
    context: UnifiedSecurityContext,
    ctx: TelegramContext
  ): boolean {
    const { decision, analysis, user } = context;

    switch (decision.action) {
      case 'block':
        // Send security warning to user
        ctx.reply(
          '⚠️ Security Alert: Suspicious activity detected. Your account has been temporarily restricted. ' +
          'Please contact support if you believe this is an error.'
        ).catch(err => this.logger.error('Failed to send security message:', err));
        return true; // Block the update

      case 'challenge':
        // Send challenge to user
        ctx.reply(
          '🔐 Security Verification Required\n\n' +
          'For your account security, please complete verification: /verify'
        ).catch(err => this.logger.error('Failed to send challenge message:', err));
        return true; // Block until challenge completed

      case 'monitor':
        // Enhanced monitoring - log but don't block
        this.logger.warn('Enhanced monitoring active for user:', {
          userId: user.id,
          riskScore: analysis.overall.riskScore,
          threatLevel: analysis.overall.threatLevel
        });
        return false; // Allow update

      default:
        return false; // Allow update
    }
  }

  // Helper methods
  private extractPlatformFromUserAgent(userAgent: string): string {
    if (userAgent.includes('Windows')) return 'Windows';
    if (userAgent.includes('Macintosh')) return 'macOS';
    if (userAgent.includes('Linux')) return 'Linux';
    if (userAgent.includes('Android')) return 'Android';
    if (userAgent.includes('iPhone') || userAgent.includes('iPad')) return 'iOS';
    return 'Unknown';
  }

  private extractBehaviorFromRequest(userId: string, requestData: any): any {
    // Extract behavioral patterns from request timing, frequency, etc.
    // This would integrate with request tracking systems
    return {
      requestTiming: Date.now(),
      endpoint: requestData.endpoint,
      method: requestData.method,
      bodySize: JSON.stringify(requestData.body || {}).length
    };
  }

  private extractTelegramDeviceData(ctx: TelegramContext): any {
    // Extract available device data from Telegram update
    return {
      chatType: ctx.chat?.type,
      messageDate: (ctx.message as any)?.date,
      updateId: ctx.update.update_id
    };
  }

  private extractTelegramBehaviorData(ctx: TelegramContext): any {
    // Extract behavioral patterns from Telegram interaction
    return {
      messageType: ctx.updateType,
      textLength: (ctx.message as any)?.text?.length || 0,
      hasEntities: Boolean((ctx.message as any)?.entities?.length),
      timestamp: Date.now()
    };
  }

  private determineMonitoringLevel(analysis: UnifiedSecurityAnalysis): UnifiedSecurityContext['monitoring'] {
    const { riskScore, threatLevel } = analysis.overall;

    if (threatLevel === 'critical' || riskScore >= 0.9) {
      return {
        logLevel: 'error',
        alertRequired: true,
        followUpActions: ['immediate_review', 'enhanced_monitoring', 'security_team_notification']
      };
    }

    if (threatLevel === 'high' || riskScore >= 0.7) {
      return {
        logLevel: 'warn',
        alertRequired: true,
        followUpActions: ['enhanced_monitoring', 'pattern_analysis']
      };
    }

    if (threatLevel === 'medium' || riskScore >= 0.4) {
      return {
        logLevel: 'info',
        alertRequired: false,
        followUpActions: ['routine_monitoring']
      };
    }

    return {
      logLevel: 'debug',
      alertRequired: false,
      followUpActions: []
    };
  }

  private async logSecurityAnalysis(context: UnifiedSecurityContext): Promise<void> {
    const logData = {
      userId: context.user.id,
      timestamp: context.requestMetadata.timestamp,
      endpoint: context.requestMetadata.endpoint,
      decision: context.decision,
      riskScore: context.analysis.overall.riskScore,
      threatLevel: context.analysis.overall.threatLevel,
      violations: context.analysis.multiAccount.violations.length,
      anomalies: context.analysis.behavioral.anomalies.length,
      deviceCollisions: context.analysis.device.collisions.length,
      threatPatterns: context.analysis.threats.patterns.length
    };

    // Log based on monitoring level
    switch (context.monitoring.logLevel) {
      case 'error':
        this.logger.error('Critical security event:', logData);
        break;
      case 'warn':
        this.logger.warn('High-risk security event:', logData);
        break;
      case 'info':
        this.logger.info('Security event:', logData);
        break;
      case 'debug':
        this.logger.debug('Security check:', logData);
        break;
    }

    // Store detailed analysis if auditing is enabled
    if (this.options.auditAllActivity || context.monitoring.alertRequired) {
      await this.storage.set(
        'security_audit',
        {
          ...logData,
          fullAnalysis: context.analysis,
          requestMetadata: context.requestMetadata
        },
        `${context.user.id}_${Date.now()}`
      );
    }
  }

  private async getUserById(telegramId: string): Promise<User | null> {
    try {
      const user = await this.storage.get('users', telegramId);
      return user as User;
    } catch (error) {
      this.logger.error('Failed to get user:', error);
      return null;
    }
  }
}

// Export middleware factory functions
export const createExpressSecurityMiddleware = (options?: Partial<UnifiedSecurityOptions>) => {
  const middleware = new UnifiedSecurityMiddleware(options);
  return middleware.expressMiddleware();
};

export const createTelegramSecurityMiddleware = (options?: Partial<UnifiedSecurityOptions>) => {
  const middleware = new UnifiedSecurityMiddleware(options);
  return middleware.telegramMiddleware();
};

// Default middleware instances
export const defaultExpressSecurityMiddleware = createExpressSecurityMiddleware();
export const defaultTelegramSecurityMiddleware = createTelegramSecurityMiddleware();

export default UnifiedSecurityMiddleware;