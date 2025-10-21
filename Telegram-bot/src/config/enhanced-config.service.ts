import { config as dotenvConfig } from 'dotenv';
import * as path from 'path';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { Logger } from '../services/logger';
import Joi from 'joi';

/**
 * Enhanced Configuration Service with feature flags, validation, and environment management
 */
export class EnhancedConfigService {
  private static instance: EnhancedConfigService;
  private logger = Logger.getInstance();
  private _config: any = null;
  private _featureFlags: FeatureFlags = {};
  private _validationSchema: Joi.ObjectSchema | null = null;

  private constructor() {
    this.loadEnvironmentFiles();
    this.initializeValidationSchema();
  }

  static getInstance(): EnhancedConfigService {
    if (!EnhancedConfigService.instance) {
      EnhancedConfigService.instance = new EnhancedConfigService();
    }
    return EnhancedConfigService.instance;
  }

  /**
   * Load environment files based on NODE_ENV and hierarchy
   */
  private loadEnvironmentFiles(): void {
    const environment = process.env.NODE_ENV || 'development';
    const envFiles = [
      '.env',
      `.env.${environment}`,
      `.env.${environment}.local`,
      '.env.local'
    ];

    const rootDir = path.resolve(__dirname, '../..');
    
    for (const envFile of envFiles) {
      const filePath = path.join(rootDir, envFile);
      if (fs.existsSync(filePath)) {
        this.logger.info(`Loading environment file: ${envFile}`);
        dotenvConfig({ path: filePath, override: false });
      }
    }
  }

  /**
   * Initialize comprehensive validation schema
   */
  private initializeValidationSchema(): void {
    this._validationSchema = Joi.object({
      // Core application settings
      NODE_ENV: Joi.string().valid('development', 'staging', 'production', 'test').default('development'),
      PORT: Joi.number().port().default(3001),
      ADMIN_PORT: Joi.number().port().default(3002),
      
      // Required secrets (strict validation in production)
      BOT_TOKEN: Joi.string().required().messages({
        'any.required': 'BOT_TOKEN is required'
      }),
      
      ADMIN_JWT_SECRET: Joi.when('NODE_ENV', {
        is: 'production',
        then: Joi.string().min(64).required().pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).messages({
          'string.min': 'ADMIN_JWT_SECRET must be at least 64 characters in production',
          'string.pattern.base': 'ADMIN_JWT_SECRET must contain uppercase, lowercase, and numeric characters',
          'any.required': 'ADMIN_JWT_SECRET is required in production'
        }),
        otherwise: Joi.string().min(32).default(() => this.generateSecureKey('ADMIN_JWT_SECRET', 64))
      }),

      REFRESH_TOKEN_SECRET: Joi.when('NODE_ENV', {
        is: 'production',
        then: Joi.string().min(64).required().invalid(Joi.ref('ADMIN_JWT_SECRET')).messages({
          'string.min': 'REFRESH_TOKEN_SECRET must be at least 64 characters in production',
          'any.invalid': 'REFRESH_TOKEN_SECRET must be different from ADMIN_JWT_SECRET',
          'any.required': 'REFRESH_TOKEN_SECRET is required in production'
        }),
        otherwise: Joi.string().min(32).default(() => this.generateSecureKey('REFRESH_TOKEN_SECRET', 64))
      }),

      // Database configuration
      DATA_SOURCE: Joi.string().valid('file', 'mongodb').default('mongodb'),

      // MongoDB configuration (required when DATA_SOURCE=mongodb)
      MONGODB_URL: Joi.when('DATA_SOURCE', {
        is: 'mongodb',
        then: Joi.string().uri().required(),
        otherwise: Joi.string().uri().optional()
      }),
      MONGODB_DATABASE: Joi.string().default('telegram_airdrop_bot'),

      // Security settings with enhanced validation
      ENABLE_DEVICE_FINGERPRINTING: Joi.boolean().default(true),
      ENABLE_MULTI_ACCOUNT_DETECTION: Joi.boolean().default(true),
      AUTO_BLOCK_VIOLATIONS: Joi.boolean().default(true),
      MAX_USERS_PER_IP: Joi.number().min(1).max(10).default(1),
      RATE_LIMIT_ENABLED: Joi.boolean().default(true),
      RATE_LIMIT_WINDOW_MS: Joi.number().min(1000).max(3600000).default(60000),
      RATE_LIMIT_MAX_REQUESTS: Joi.number().min(1).max(10000).default(100),

      // Feature flags
      FEATURE_WALLET_CONNECT: Joi.boolean().default(true),
      FEATURE_POINTS_TRANSFER: Joi.boolean().default(true),
      FEATURE_ADVANCED_ANALYTICS: Joi.boolean().default(false),
      FEATURE_BULK_OPERATIONS: Joi.boolean().default(true),
      FEATURE_EXPORT_DATA: Joi.boolean().default(true),
      FEATURE_REAL_TIME_NOTIFICATIONS: Joi.boolean().default(false),
      FEATURE_TELEGRAM_MINI_APP: Joi.boolean().default(true),
      FEATURE_CAPTCHA_VALIDATION: Joi.boolean().default(true),
      FEATURE_GEO_BLOCKING: Joi.boolean().default(true),
      FEATURE_DEVICE_MANAGEMENT: Joi.boolean().default(true),

      // Performance settings
      MEMORY_LIMIT_MB: Joi.number().min(128).max(8192).default(512),
      CACHE_TTL_SECONDS: Joi.number().min(60).max(86400).default(3600),
      WORKER_THREADS: Joi.number().min(1).max(16).default(4),
      CLEANUP_INTERVAL_MS: Joi.number().min(60000).max(3600000).default(300000),

      // Monitoring and observability
      ENABLE_METRICS: Joi.boolean().default(false),
      ENABLE_HEALTH_CHECKS: Joi.boolean().default(true),
      ENABLE_PERFORMANCE_MONITORING: Joi.boolean().default(false),
      SENTRY_DSN: Joi.string().uri().allow('').default(''),
      LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug', 'verbose').default('info'),

      // External integrations
      SLACK_WEBHOOK_URL: Joi.string().uri().allow('').default(''),
      DISCORD_WEBHOOK_URL: Joi.string().uri().allow('').default(''),
      WEBHOOK_SECRET: Joi.string().allow('').default(''),

      // Business logic settings
      MIN_WITHDRAWAL_POINTS: Joi.number().min(1).default(100),
      REFERRAL_BONUS_POINTS: Joi.number().min(0).default(25),
      DAILY_BONUS_POINTS: Joi.number().min(0).default(10),
      POINT_TO_TOKEN_RATIO: Joi.number().min(0).default(0.001),
    });
  }

  /**
   * Validate and load configuration
   */
  async loadConfig(): Promise<void> {
    try {
      const { error, value } = this._validationSchema!.validate(process.env, {
        allowUnknown: true,
        stripUnknown: false,
        abortEarly: false
      });

      if (error) {
        const errors = error.details.map(detail => ({
          key: detail.path.join('.'),
          message: detail.message,
          value: detail.context?.value
        }));

        this.logger.error('Configuration validation failed:', errors);
        
        // In production, fail fast
        if (process.env.NODE_ENV === 'production') {
          this.logger.error('❌ Production deployment cannot continue with invalid configuration');
          process.exit(1);
        } else {
          this.logger.warn('⚠️ Development mode: Continuing with validation warnings');
        }
      }

      this._config = this.transformValidatedConfig(value);
      this.loadFeatureFlags();
      this.validateEnvironmentSpecificRequirements();
      
      this.logger.info('✅ Configuration loaded and validated successfully', {
        environment: this._config.environment,
        featureFlags: Object.keys(this._featureFlags).length
      });

    } catch (error) {
      this.logger.error('Failed to load configuration:', error);
      throw error;
    }
  }

  /**
   * Transform validated configuration into structured format
   */
  private transformValidatedConfig(validatedEnv: any): EnhancedAppConfig {
    return {
      // Core application
      environment: validatedEnv.NODE_ENV,
      isDev: validatedEnv.NODE_ENV === 'development',
      isStaging: validatedEnv.NODE_ENV === 'staging',
      isProd: validatedEnv.NODE_ENV === 'production',
      isTest: validatedEnv.NODE_ENV === 'test',

      // Server configuration
      server: {
        port: validatedEnv.PORT,
        adminPort: validatedEnv.ADMIN_PORT,
        host: validatedEnv.HOST || '0.0.0.0',
        publicUrl: validatedEnv.PUBLIC_URL || `http://localhost:${validatedEnv.PORT}`,
        adminUrl: validatedEnv.ADMIN_URL || `http://localhost:${validatedEnv.ADMIN_PORT}`,
        trustProxy: this.parseBoolean(validatedEnv.TRUST_PROXY, false),
        timeout: this.parseNumber(validatedEnv.SERVER_TIMEOUT, 30000),
        keepAliveTimeout: this.parseNumber(validatedEnv.KEEP_ALIVE_TIMEOUT, 5000)
      },

      // Database configuration
      database: {
        source: 'mongodb',
        mongodb: {
          url: validatedEnv.MONGODB_URL,
          database: validatedEnv.MONGODB_DATABASE,
          maxPoolSize: this.parseNumber(validatedEnv.MONGODB_MAX_POOL_SIZE, 10),
          minPoolSize: this.parseNumber(validatedEnv.MONGODB_MIN_POOL_SIZE, 1),
          maxIdleTimeMS: this.parseNumber(validatedEnv.MONGODB_MAX_IDLE_TIME_MS, 30000),
          serverSelectionTimeoutMS: this.parseNumber(validatedEnv.MONGODB_SERVER_SELECTION_TIMEOUT_MS, 5000)
        }
      },

      // Security configuration
      security: {
        jwtSecret: validatedEnv.ADMIN_JWT_SECRET,
        refreshTokenSecret: validatedEnv.REFRESH_TOKEN_SECRET,
        jwtExpiresIn: validatedEnv.JWT_EXPIRES_IN || '24h',
        refreshTokenExpiresIn: validatedEnv.REFRESH_TOKEN_EXPIRES_IN || '7d',
        passwordSaltRounds: this.parseNumber(validatedEnv.PASSWORD_SALT_ROUNDS, 12),
        sessionSecret: validatedEnv.SESSION_SECRET || this.generateSecureKey('SESSION_SECRET', 32),
        csrfSecret: validatedEnv.CSRF_SECRET || this.generateSecureKey('CSRF_SECRET', 32),
        encryptionKey: validatedEnv.ENCRYPTION_KEY || this.generateSecureKey('ENCRYPTION_KEY', 32),
        enableDeviceFingerprinting: validatedEnv.ENABLE_DEVICE_FINGERPRINTING,
        enableMultiAccountDetection: validatedEnv.ENABLE_MULTI_ACCOUNT_DETECTION,
        autoBlockViolations: validatedEnv.AUTO_BLOCK_VIOLATIONS,
        maxUsersPerIp: validatedEnv.MAX_USERS_PER_IP,
        maxLoginAttempts: this.parseNumber(validatedEnv.MAX_LOGIN_ATTEMPTS, 5),
        lockoutDurationMinutes: this.parseNumber(validatedEnv.LOCKOUT_DURATION_MINUTES, 15)
      },

      // Rate limiting
      rateLimit: {
        enabled: validatedEnv.RATE_LIMIT_ENABLED,
        windowMs: validatedEnv.RATE_LIMIT_WINDOW_MS,
        maxRequests: validatedEnv.RATE_LIMIT_MAX_REQUESTS,
        skipSuccessfulRequests: this.parseBoolean(validatedEnv.RATE_LIMIT_SKIP_SUCCESSFUL, false),
        skipFailedRequests: this.parseBoolean(validatedEnv.RATE_LIMIT_SKIP_FAILED, false),
        standardHeaders: this.parseBoolean(validatedEnv.RATE_LIMIT_STANDARD_HEADERS, true)
      },

      // Performance settings
      performance: {
        memoryLimitMB: validatedEnv.MEMORY_LIMIT_MB,
        cacheTTLSeconds: validatedEnv.CACHE_TTL_SECONDS,
        workerThreads: validatedEnv.WORKER_THREADS,
        cleanupIntervalMS: validatedEnv.CLEANUP_INTERVAL_MS,
        enableCaching: this.parseBoolean(validatedEnv.ENABLE_CACHING, true),
        enableCompression: this.parseBoolean(validatedEnv.ENABLE_COMPRESSION, true),
        enableEtag: this.parseBoolean(validatedEnv.ENABLE_ETAG, true)
      },

      // Monitoring configuration
      monitoring: {
        enableMetrics: validatedEnv.ENABLE_METRICS,
        enableHealthChecks: validatedEnv.ENABLE_HEALTH_CHECKS,
        enablePerformanceMonitoring: validatedEnv.ENABLE_PERFORMANCE_MONITORING,
        sentryDSN: validatedEnv.SENTRY_DSN,
        metricsPort: this.parseNumber(validatedEnv.METRICS_PORT, 9090),
        healthCheckInterval: this.parseNumber(validatedEnv.HEALTH_CHECK_INTERVAL, 30000)
      },

      // Logging configuration
      logging: {
        level: validatedEnv.LOG_LEVEL,
        enableFile: this.parseBoolean(validatedEnv.LOG_ENABLE_FILE, true),
        enableConsole: this.parseBoolean(validatedEnv.LOG_ENABLE_CONSOLE, true),
        filePath: validatedEnv.LOG_FILE_PATH || './logs',
        maxFiles: this.parseNumber(validatedEnv.LOG_MAX_FILES, 14),
        maxSize: validatedEnv.LOG_MAX_SIZE || '20m',
        enableStructured: this.parseBoolean(validatedEnv.LOG_ENABLE_STRUCTURED, true)
      },

      // External integrations
      integrations: {
        telegram: {
          botToken: validatedEnv.BOT_TOKEN,
          webhookUrl: validatedEnv.WEBHOOK_URL,
          webhookSecret: validatedEnv.WEBHOOK_SECRET,
          useWebhook: this.parseBoolean(validatedEnv.USE_WEBHOOK, false)
        },
        slack: {
          webhookUrl: validatedEnv.SLACK_WEBHOOK_URL,
          channel: validatedEnv.SLACK_CHANNEL || '#general',
          username: validatedEnv.SLACK_USERNAME || 'Airdrop Bot'
        },
        discord: {
          webhookUrl: validatedEnv.DISCORD_WEBHOOK_URL
        }
      },

      // Business configuration
      business: {
        minWithdrawalPoints: validatedEnv.MIN_WITHDRAWAL_POINTS,
        referralBonusPoints: validatedEnv.REFERRAL_BONUS_POINTS,
        dailyBonusPoints: validatedEnv.DAILY_BONUS_POINTS,
        pointToTokenRatio: validatedEnv.POINT_TO_TOKEN_RATIO,
        maxDailyWithdrawals: this.parseNumber(validatedEnv.MAX_DAILY_WITHDRAWALS, 5),
        withdrawalFeePercentage: this.parseNumber(validatedEnv.WITHDRAWAL_FEE_PERCENTAGE, 0),
        enableReferralSystem: this.parseBoolean(validatedEnv.ENABLE_REFERRAL_SYSTEM, true)
      },

      // Feature flags
      features: this._featureFlags
    };
  }

  /**
   * Load and validate feature flags
   */
  private loadFeatureFlags(): void {
    this._featureFlags = {
      walletConnect: this.parseBoolean(process.env.FEATURE_WALLET_CONNECT, true),
      pointsTransfer: this.parseBoolean(process.env.FEATURE_POINTS_TRANSFER, true),
      advancedAnalytics: this.parseBoolean(process.env.FEATURE_ADVANCED_ANALYTICS, false),
      bulkOperations: this.parseBoolean(process.env.FEATURE_BULK_OPERATIONS, true),
      exportData: this.parseBoolean(process.env.FEATURE_EXPORT_DATA, true),
      realTimeNotifications: this.parseBoolean(process.env.FEATURE_REAL_TIME_NOTIFICATIONS, false),
      telegramMiniApp: this.parseBoolean(process.env.FEATURE_TELEGRAM_MINI_APP, true),
      captchaValidation: this.parseBoolean(process.env.FEATURE_CAPTCHA_VALIDATION, true),
      geoBlocking: this.parseBoolean(process.env.FEATURE_GEO_BLOCKING, true),
      deviceManagement: this.parseBoolean(process.env.FEATURE_DEVICE_MANAGEMENT, true),
      apiRateLimiting: this.parseBoolean(process.env.FEATURE_API_RATE_LIMITING, true),
      auditLogging: this.parseBoolean(process.env.FEATURE_AUDIT_LOGGING, true),
      backgroundJobs: this.parseBoolean(process.env.FEATURE_BACKGROUND_JOBS, true),
      webhookSupport: this.parseBoolean(process.env.FEATURE_WEBHOOK_SUPPORT, false),
      multiLanguage: this.parseBoolean(process.env.FEATURE_MULTI_LANGUAGE, false),
      twoFactorAuth: this.parseBoolean(process.env.FEATURE_TWO_FACTOR_AUTH, false)
    };

    // Validate feature flag dependencies
    this.validateFeatureDependencies();
  }

  /**
   * Validate feature flag dependencies
   */
  private validateFeatureDependencies(): void {
    const warnings: string[] = [];

    // Points transfer requires wallet connect
    if (this._featureFlags.pointsTransfer && !this._featureFlags.walletConnect) {
      warnings.push('Points transfer feature requires wallet connect to be enabled');
    }

    // Advanced analytics requires background jobs
    if (this._featureFlags.advancedAnalytics && !this._featureFlags.backgroundJobs) {
      warnings.push('Advanced analytics feature requires background jobs to be enabled');
    }

    // Real-time notifications require webhook support
    if (this._featureFlags.realTimeNotifications && !this._featureFlags.webhookSupport) {
      warnings.push('Real-time notifications require webhook support to be enabled');
    }

    if (warnings.length > 0) {
      this.logger.warn('Feature flag dependency warnings:', warnings);
    }
  }

  /**
   * Validate environment-specific requirements
   */
  private validateEnvironmentSpecificRequirements(): void {
    const environment = this._config.environment;

    if (environment === 'production') {
      this.validateProductionRequirements();
    } else if (environment === 'staging') {
      this.validateStagingRequirements();
    }
  }

  /**
   * Validate production environment requirements
   */
  private validateProductionRequirements(): void {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Required secrets
    const requiredSecrets = [
      'ADMIN_JWT_SECRET',
      'REFRESH_TOKEN_SECRET',
      'BOT_TOKEN'
    ];

    for (const secret of requiredSecrets) {
      if (!process.env[secret]) {
        errors.push(`${secret} is required in production`);
      }
    }

    // Database configuration


    // Security settings
    if (!this._config.security.enableDeviceFingerprinting) {
      warnings.push('Device fingerprinting is disabled in production');
    }

    if (!this._config.security.enableMultiAccountDetection) {
      warnings.push('Multi-account detection is disabled in production');
    }

    // Monitoring
    if (!this._config.monitoring.enableMetrics) {
      warnings.push('Metrics collection is disabled in production');
    }

    if (!this._config.monitoring.sentryDSN) {
      warnings.push('Sentry error tracking is not configured for production');
    }

    // Performance
    if (this._config.performance.memoryLimitMB < 512) {
      warnings.push('Memory limit is set below recommended 512MB for production');
    }

    this.logValidationResults(errors, warnings, 'Production');
  }

  /**
   * Validate staging environment requirements
   */
  private validateStagingRequirements(): void {
    const warnings: string[] = [];

    if (!this._config.monitoring.enableMetrics) {
      warnings.push('Metrics should be enabled in staging for testing');
    }



    this.logValidationResults([], warnings, 'Staging');
  }

  /**
   * Log validation results
   */
  private logValidationResults(errors: string[], warnings: string[], environment: string): void {
    if (errors.length > 0) {
      this.logger.error(`❌ ${environment} configuration errors:`, errors);
      if (environment === 'production') {
        process.exit(1);
      }
    }

    if (warnings.length > 0) {
      this.logger.warn(`⚠️ ${environment} configuration warnings:`, warnings);
    }
  }

  /**
   * Get configuration value by path
   */
  getConfigValue<T = any>(path: string, defaultValue?: T): T {
    const keys = path.split('.');
    let value = this._config;

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return defaultValue as T;
      }
    }

    return value as T;
  }

  /**
   * Check if feature flag is enabled
   */
  isFeatureEnabled(feature: keyof FeatureFlags): boolean {
    return this._featureFlags[feature] || false;
  }

  /**
   * Get all feature flags
   */
  getFeatureFlags(): FeatureFlags {
    return { ...this._featureFlags };
  }

  /**
   * Get full configuration
   */
  getConfig(): EnhancedAppConfig {
    if (!this._config) {
      throw new Error('Configuration not loaded. Call loadConfig() first.');
    }
    return this._config;
  }

  /**
   * Generate cryptographically secure key
   */
  private generateSecureKey(name: string, minLength = 64): string {
    const keyBytes = Math.max(32, Math.ceil(minLength / 2));
    const key = crypto.randomBytes(keyBytes).toString('hex');
    
    if (process.env.NODE_ENV !== 'production') {
      this.logger.warn(`⚠️ Auto-generated ${name}: ${key}`);
      this.logger.warn(`⚠️ Add to .env file: ${name}=${key}`);
    } else {
      this.logger.error(`❌ ${name} not set in production!`);
    }
    
    return key;
  }

  /**
   * Parse boolean value from string
   */
  private parseBoolean(value: string | undefined, defaultValue = false): boolean {
    if (!value) return defaultValue;
    return value.toLowerCase() === 'true';
  }

  /**
   * Parse number value from string
   */
  private parseNumber(value: string | undefined, defaultValue = 0): number {
    if (!value) return defaultValue;
    const parsed = Number(value);
    return isNaN(parsed) ? defaultValue : parsed;
  }

  /**
   * Reload configuration (useful for runtime config updates)
   */
  async reloadConfig(): Promise<void> {
    this.logger.info('Reloading configuration...');
    this._config = null;
    this._featureFlags = {};
    this.loadEnvironmentFiles();
    await this.loadConfig();
    this.logger.info('Configuration reloaded successfully');
  }

  /**
   * Get configuration summary for debugging
   */
  getConfigSummary(): ConfigSummary {
    return {
      environment: this._config.environment,
      databaseSource: this._config.database.source,
      featuresEnabled: Object.entries(this._featureFlags)
        .filter(([_, enabled]) => enabled)
        .map(([feature, _]) => feature),
      securityLevel: this.calculateSecurityLevel(),
      performanceProfile: this.calculatePerformanceProfile()
    };
  }

  /**
   * Calculate security level based on configuration
   */
  private calculateSecurityLevel(): 'low' | 'medium' | 'high' {
    let score = 0;

    if (this._config.security.enableDeviceFingerprinting) score += 1;
    if (this._config.security.enableMultiAccountDetection) score += 1;
    if (this._config.security.autoBlockViolations) score += 1;
    if (this._config.rateLimit.enabled) score += 1;
    if (this._config.security.jwtSecret.length >= 64) score += 1;

    if (score >= 4) return 'high';
    if (score >= 2) return 'medium';
    return 'low';
  }

  /**
   * Calculate performance profile
   */
  private calculatePerformanceProfile(): 'basic' | 'optimized' | 'enterprise' {
    let score = 0;

    if (this._config.performance.enableCaching) score += 1;
    if (this._config.performance.enableCompression) score += 1;
    if (this._config.performance.workerThreads > 2) score += 1;
    if (this._config.performance.memoryLimitMB >= 512) score += 1;
    if (this._config.database.source !== 'file') score += 1;

    if (score >= 4) return 'enterprise';
    if (score >= 2) return 'optimized';
    return 'basic';
  }
}

// Type definitions
export interface FeatureFlags {
  walletConnect?: boolean;
  pointsTransfer?: boolean;
  advancedAnalytics?: boolean;
  bulkOperations?: boolean;
  exportData?: boolean;
  realTimeNotifications?: boolean;
  telegramMiniApp?: boolean;
  captchaValidation?: boolean;
  geoBlocking?: boolean;
  deviceManagement?: boolean;
  apiRateLimiting?: boolean;
  auditLogging?: boolean;
  backgroundJobs?: boolean;
  webhookSupport?: boolean;
  multiLanguage?: boolean;
  twoFactorAuth?: boolean;
}

export interface EnhancedAppConfig {
  environment: string;
  isDev: boolean;
  isStaging: boolean;
  isProd: boolean;
  isTest: boolean;
  server: {
    port: number;
    adminPort: number;
    host: string;
    publicUrl: string;
    adminUrl: string;
    trustProxy: boolean;
    timeout: number;
    keepAliveTimeout: number;
  };
  database: {
    source: 'file' | 'mongodb';
    mongodb: {
      url: string;
      database: string;
      maxPoolSize: number;
      minPoolSize: number;
      maxIdleTimeMS: number;
      serverSelectionTimeoutMS: number;
    };
  };
  security: {
    jwtSecret: string;
    refreshTokenSecret: string;
    jwtExpiresIn: string;
    refreshTokenExpiresIn: string;
    passwordSaltRounds: number;
    sessionSecret: string;
    csrfSecret: string;
    encryptionKey: string;
    enableDeviceFingerprinting: boolean;
    enableMultiAccountDetection: boolean;
    autoBlockViolations: boolean;
    maxUsersPerIp: number;
    maxLoginAttempts: number;
    lockoutDurationMinutes: number;
  };
  rateLimit: {
    enabled: boolean;
    windowMs: number;
    maxRequests: number;
    skipSuccessfulRequests: boolean;
    skipFailedRequests: boolean;
    standardHeaders: boolean;
  };
  performance: {
    memoryLimitMB: number;
    cacheTTLSeconds: number;
    workerThreads: number;
    cleanupIntervalMS: number;
    enableCaching: boolean;
    enableCompression: boolean;
    enableEtag: boolean;
  };
  monitoring: {
    enableMetrics: boolean;
    enableHealthChecks: boolean;
    enablePerformanceMonitoring: boolean;
    sentryDSN: string;
    metricsPort: number;
    healthCheckInterval: number;
  };
  logging: {
    level: string;
    enableFile: boolean;
    enableConsole: boolean;
    filePath: string;
    maxFiles: number;
    maxSize: string;
    enableStructured: boolean;
  };
  integrations: {
    telegram: {
      botToken: string;
      webhookUrl: string;
      webhookSecret: string;
      useWebhook: boolean;
    };
    slack: {
      webhookUrl: string;
      channel: string;
      username: string;
    };
    discord: {
      webhookUrl: string;
    };
  };
  business: {
    minWithdrawalPoints: number;
    referralBonusPoints: number;
    dailyBonusPoints: number;
    pointToTokenRatio: number;
    maxDailyWithdrawals: number;
    withdrawalFeePercentage: number;
    enableReferralSystem: boolean;
  };
  features: FeatureFlags;
}

export interface ConfigSummary {
  environment: string;
  databaseSource: string;
  featuresEnabled: string[];
  securityLevel: 'low' | 'medium' | 'high';
  performanceProfile: 'basic' | 'optimized' | 'enterprise';
}

// Singleton instance export
export const enhancedConfig = EnhancedConfigService.getInstance();