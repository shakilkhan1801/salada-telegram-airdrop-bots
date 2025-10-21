/**
 * Enterprise Rate Limiting Service
 * 
 * Provides IPv6-safe rate limiting with comprehensive security monitoring,
 * configurable policies, and production-grade logging for large-scale applications.
 * 
 * @version 1.0.0
 * @author Security Team
 * @since 2024
 */

import { Request, Response, NextFunction } from 'express';
import rateLimit, { 
  RateLimitRequestHandler, 
  Options as RateLimitOptions,
  ipKeyGenerator
} from 'express-rate-limit';
import { logger } from '../logger';

/**
 * Rate limiting policy configuration interface
 */
export interface RateLimitPolicyConfig {
  /** Policy identifier */
  id: string;
  /** Policy name for logging */
  name: string;
  /** Time window in milliseconds */
  windowMs: number;
  /** Maximum requests per window */
  maxRequests: number;
  /** Skip successful requests in counting */
  skipSuccessfulRequests?: boolean;
  /** Skip failed requests in counting */
  skipFailedRequests?: boolean;
  /** Custom message for rate limit exceeded */
  message?: string;
  /** Status code to return when rate limited */
  statusCode?: number;
  /** Headers to include in rate limit response */
  standardHeaders?: boolean;
  /** Include legacy X-RateLimit headers */
  legacyHeaders?: boolean;
}

/**
 * Advanced security configuration
 */
export interface SecurityConfig {
  /** Enable IPv6 support */
  enableIPv6: boolean;
  /** Trust proxy configuration */
  trustProxy: boolean;
  /** Enable device fingerprinting */
  enableFingerprinting: boolean;
  /** Skip rate limiting for whitelisted IPs */
  whitelist: string[];
  /** Additional security headers */
  securityHeaders: boolean;
  /** Log security events */
  enableSecurityLogging: boolean;
}

/**
 * Rate limiting metrics interface
 */
export interface RateLimitMetrics {
  totalRequests: number;
  blockedRequests: number;
  ipv4Requests: number;
  ipv6Requests: number;
  fingerprintedRequests: number;
  whitelistedRequests: number;
  timestamp: Date;
}

/**
 * Enterprise Rate Limiting Service
 * 
 * Handles rate limiting with IPv6 support, security monitoring,
 * and comprehensive logging for production environments.
 */
export class RateLimitingService {
  private static instance: RateLimitingService;
  private metrics: RateLimitMetrics;
  private activePolicies: Map<string, RateLimitRequestHandler>;
  private securityConfig: SecurityConfig;

  private constructor() {
    this.metrics = {
      totalRequests: 0,
      blockedRequests: 0,
      ipv4Requests: 0,
      ipv6Requests: 0,
      fingerprintedRequests: 0,
      whitelistedRequests: 0,
      timestamp: new Date()
    };
    
    this.activePolicies = new Map();
    this.securityConfig = {
      enableIPv6: true,
      trustProxy: true,
      enableFingerprinting: true,
      whitelist: [],
      securityHeaders: true,
      enableSecurityLogging: true
    };

    logger.info('🛡️  Enterprise Rate Limiting Service initialized', {
      component: 'RateLimitingService',
      ipv6Support: this.securityConfig.enableIPv6,
      fingerprinting: this.securityConfig.enableFingerprinting
    });
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): RateLimitingService {
    if (!RateLimitingService.instance) {
      RateLimitingService.instance = new RateLimitingService();
    }
    return RateLimitingService.instance;
  }

  /**
   * Update security configuration
   */
  public updateSecurityConfig(config: Partial<SecurityConfig>): void {
    this.securityConfig = { ...this.securityConfig, ...config };
    logger.info('🔒 Security configuration updated', {
      component: 'RateLimitingService',
      config: this.securityConfig
    });
  }

  /**
   * Create IPv6-safe key generator with enterprise features
   */
  private createSecureKeyGenerator(policyId: string) {
    return (req: Request): string => {
      try {
        // Track request metrics
        this.metrics.totalRequests++;

        // Get client IP using IPv6-safe method
        const clientIP = this.extractClientIP(req);
        
        // Determine IP version for metrics
        const isIPv6 = this.isIPv6Address(clientIP);
        if (isIPv6) {
          this.metrics.ipv6Requests++;
        } else {
          this.metrics.ipv4Requests++;
        }

        // Check whitelist
        if (this.isWhitelisted(clientIP)) {
          this.metrics.whitelistedRequests++;
          logger.debug('🟢 Whitelisted IP detected', {
            component: 'RateLimitingService',
            policy: policyId,
            ip: clientIP,
            ipVersion: isIPv6 ? 'IPv6' : 'IPv4'
          });
        }

        // Create composite key for advanced rate limiting
        let rateLimitKey = '';

        if (this.securityConfig.enableFingerprinting) {
          // Use device fingerprinting for additional security
          const fingerprint = this.generateDeviceFingerprint(req);
          this.metrics.fingerprintedRequests++;
          rateLimitKey = `${clientIP}:${fingerprint}`;
        } else {
          // Use IPv6-safe IP key generator with extracted IP
          rateLimitKey = clientIP;
        }

        // Log security events if enabled
        if (this.securityConfig.enableSecurityLogging) {
          logger.debug('🔍 Rate limit key generated', {
            component: 'RateLimitingService',
            policy: policyId,
            ip: clientIP,
            ipVersion: isIPv6 ? 'IPv6' : 'IPv4',
            hasFingerprint: this.securityConfig.enableFingerprinting,
            userAgent: req.headers['user-agent']?.substring(0, 100)
          });
        }

        return rateLimitKey;
      } catch (error) {
        logger.error('❌ Error in rate limit key generation', {
          component: 'RateLimitingService',
          policy: policyId,
          error: error instanceof Error ? error.message : 'Unknown error',
          userAgent: req.headers['user-agent']?.substring(0, 100)
        });
        
        // Fallback to basic IP extraction
        const fallbackIP = req.ip || req.connection?.remoteAddress || 'unknown';
        return fallbackIP;
      }
    };
  }

  /**
   * Extract client IP with IPv6 support
   */
  private extractClientIP(req: Request): string {
    // Handle forwarded headers for proxy environments
    if (this.securityConfig.trustProxy) {
      const forwarded = req.headers['x-forwarded-for'];
      if (forwarded) {
        const ips = Array.isArray(forwarded) ? forwarded[0] : forwarded;
        return ips.split(',')[0].trim();
      }

      // Check other proxy headers
      const realIP = req.headers['x-real-ip'];
      if (realIP) {
        return Array.isArray(realIP) ? realIP[0] : realIP;
      }
    }

    // Fallback to connection IP
    return req.connection?.remoteAddress || req.socket?.remoteAddress || req.ip || 'unknown';
  }

  /**
   * Check if IP address is IPv6
   */
  private isIPv6Address(ip: string): boolean {
    // IPv6 addresses contain colons
    return ip.includes(':');
  }

  /**
   * Check if IP is whitelisted
   */
  private isWhitelisted(ip: string): boolean {
    return this.securityConfig.whitelist.includes(ip) || 
           this.securityConfig.whitelist.includes('*') ||
           ip === '127.0.0.1' || 
           ip === '::1';
  }

  /**
   * Generate device fingerprint for additional security
   */
  private generateDeviceFingerprint(req: Request): string {
    const components = [
      req.headers['user-agent'] || '',
      req.headers['accept-language'] || '',
      req.headers['accept-encoding'] || '',
      req.headers['accept'] || ''
    ];

    // Create a simple hash of the fingerprint components
    const fingerprint = Buffer.from(components.join('|')).toString('base64').substring(0, 8);
    return fingerprint;
  }

  /**
   * Handle rate limit exceeded events
   */
  private createRateLimitHandler(policyId: string, policyName: string) {
    return (req: Request, res: Response) => {
      this.metrics.blockedRequests++;
      
      const clientIP = this.extractClientIP(req);
      const isIPv6 = this.isIPv6Address(clientIP);

      // Log security event
      logger.warn('🚫 Rate limit exceeded', {
        component: 'RateLimitingService',
        policy: policyId,
        policyName,
        ip: clientIP,
        ipVersion: isIPv6 ? 'IPv6' : 'IPv4',
        userAgent: req.headers['user-agent']?.substring(0, 100),
        path: req.path,
        method: req.method
      });

      // Add security headers
      if (this.securityConfig.securityHeaders) {
        res.set({
          'X-Security-Policy': 'rate-limit-enforced',
          'X-Rate-Limit-Policy': policyId,
          'X-Client-IP-Version': isIPv6 ? 'IPv6' : 'IPv4'
        });
      }

      res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: `Too many requests from ${isIPv6 ? 'IPv6' : 'IPv4'} address. Please try again later.`,
        policy: policyName,
        retryAfter: res.get('Retry-After'),
        timestamp: new Date().toISOString()
      });
    };
  }

  /**
   * Create rate limiting middleware with enterprise features
   */
  public createRateLimit(config: RateLimitPolicyConfig): RateLimitRequestHandler {
    const options: Partial<RateLimitOptions> = {
      windowMs: config.windowMs,
      max: config.maxRequests,
      message: config.message || `Rate limit exceeded for policy: ${config.name}`,
      statusCode: config.statusCode || 429,
      standardHeaders: config.standardHeaders !== false,
      legacyHeaders: config.legacyHeaders === true,
      skipSuccessfulRequests: config.skipSuccessfulRequests || false,
      skipFailedRequests: config.skipFailedRequests || false,
      
      // IPv6-safe key generation using built-in helper
      keyGenerator: (req: Request) => {
        try {
          // Extract IP using our secure method
          const clientIP = this.extractClientIP(req);
          
          // Track metrics
          this.metrics.totalRequests++;
          const isIPv6 = this.isIPv6Address(clientIP);
          if (isIPv6) {
            this.metrics.ipv6Requests++;
          } else {
            this.metrics.ipv4Requests++;
          }
          
          // Use express-rate-limit's IPv6-safe helper with extracted IP
          return ipKeyGenerator(clientIP);
        } catch (error) {
          logger.error('❗ Error in IPv6-safe key generation', {
            component: 'RateLimitingService',
            policy: config.id,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
          
          // Fallback to basic IP
          return req.ip || req.connection?.remoteAddress || 'unknown';
        }
      },
      
      // Custom rate limit exceeded handler
      handler: this.createRateLimitHandler(config.id, config.name),

      // Skip function for whitelisted IPs with security logging
      skip: (req: Request) => {
        const clientIP = this.extractClientIP(req);
        const isIPv6 = this.isIPv6Address(clientIP);
        const isWhitelisted = this.isWhitelisted(clientIP);
        
        if (isWhitelisted) {
          this.metrics.whitelistedRequests++;
          if (this.securityConfig.enableSecurityLogging) {
            logger.debug('🟢 Whitelisted IP bypassed rate limiting', {
              component: 'RateLimitingService',
              policy: config.id,
              ip: clientIP,
              ipVersion: isIPv6 ? 'IPv6' : 'IPv4'
            });
          }
        }
        
        return isWhitelisted;
      }
    };

    const rateLimiter = rateLimit(options);
    this.activePolicies.set(config.id, rateLimiter);

    logger.info('✅ Rate limiting policy created', {
      component: 'RateLimitingService',
      policyId: config.id,
      policyName: config.name,
      windowMs: config.windowMs,
      maxRequests: config.maxRequests,
      ipv6Safe: true
    });

    return rateLimiter;
  }

  /**
   * Get predefined rate limiting policies for common use cases
   */
  public getPredefinedPolicies() {
    return {
      // Strict policy for admin endpoints
      adminStrict: {
        id: 'admin-strict',
        name: 'Admin Panel - Strict',
        windowMs: 15 * 60 * 1000, // 15 minutes
        maxRequests: 50,
        skipSuccessfulRequests: true
      } as RateLimitPolicyConfig,

      // Standard policy for API endpoints
      apiStandard: {
        id: 'api-standard',
        name: 'API - Standard',
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 100,
        skipSuccessfulRequests: false
      } as RateLimitPolicyConfig,

      // Lenient policy for public endpoints
      publicLenient: {
        id: 'public-lenient',
        name: 'Public - Lenient',
        windowMs: 60 * 1000, // 1 minute
        maxRequests: 200,
        skipSuccessfulRequests: true
      } as RateLimitPolicyConfig,

      // Ultra-strict policy for authentication endpoints
      authUltraStrict: {
        id: 'auth-ultra-strict',
        name: 'Authentication - Ultra Strict',
        windowMs: 60 * 60 * 1000, // 1 hour
        maxRequests: 5,
        skipSuccessfulRequests: false
      } as RateLimitPolicyConfig
    };
  }

  /**
   * Get current metrics
   */
  public getMetrics(): RateLimitMetrics {
    return { ...this.metrics };
  }

  /**
   * Reset metrics
   */
  public resetMetrics(): void {
    this.metrics = {
      totalRequests: 0,
      blockedRequests: 0,
      ipv4Requests: 0,
      ipv6Requests: 0,
      fingerprintedRequests: 0,
      whitelistedRequests: 0,
      timestamp: new Date()
    };

    logger.info('📊 Rate limiting metrics reset', {
      component: 'RateLimitingService'
    });
  }

  /**
   * Get active policies
   */
  public getActivePolicies(): string[] {
    return Array.from(this.activePolicies.keys());
  }

  /**
   * Remove a rate limiting policy
   */
  public removePolicy(policyId: string): boolean {
    const removed = this.activePolicies.delete(policyId);
    if (removed) {
      logger.info('🗑️  Rate limiting policy removed', {
        component: 'RateLimitingService',
        policyId
      });
    }
    return removed;
  }
}

// Export singleton instance
export const rateLimitingService = RateLimitingService.getInstance();