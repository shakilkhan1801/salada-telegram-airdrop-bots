import { config as dotenvConfig } from 'dotenv';
import { config as dotenvSafeConfig } from 'dotenv-safe';
import * as path from 'path';
import * as crypto from 'crypto';

// Load env with safety check
try {
  dotenvSafeConfig({ allowEmptyValues: true, example: path.resolve(process.cwd(), '.env.example') });
} catch {
  // Fallback to standard dotenv if example not present
  dotenvConfig();
}

interface AppConfig {
  environment: string;
  isDev: boolean;
  isProd: boolean;
  admin: AdminConfig;
  bot: BotConfig;
  storage: StorageConfig;
  security: SecurityConfig;
  captcha: CaptchaConfig;
  task: TaskConfig;
  points: PointsConfig;
  referral: ReferralConfig;
  wallet: WalletConfig;
  notifications: NotificationConfig;
  server: ServerConfig;
  logging: LoggingConfig;
  rateLimit: RateLimitConfig;
  paths: PathConfig;
  jwt: JwtConfig;
}

interface AdminConfig {
  adminIds: string[];
  superAdmins: string[];
  key: string;
  panelUrl: string;
  port?: number;
  corsOrigins?: string[];
  trustProxy?: boolean;
}

interface BotConfig {
  token: string;
  name: string;
  username: string;
  requiredChannelId: string;
  withdrawAlertChannelId: string;
  supportUsername: string;
  status: boolean;
  maintenanceMode: boolean;
  webhookUrl?: string;
  useWebhook: boolean;
  referralBonus: number;
  referralWelcomeBonus: number;
  referralWelcomeBonusEnabled: boolean;
  dailyBonus: number;
  captchaReward: number;
  website?: string;
  minWithdrawal: number;
  walletConnectionBonus: number;
  pointToTokenRatio: number;
}

interface StorageConfig {
  source: 'file' | 'mongodb';
  file: {
    basePath: string;
    batchSize: number;
  };
  mongodb: {
    url: string;
    database: string;
    username?: string;
    password?: string;
  };
}

interface SecurityConfig {
  adminJwtSecret: string;
  refreshTokenSecret: string;
  enableMultiAccountDetection: boolean;
  enableDeviceFingerprinting: boolean;
  enableThreatAnalysis: boolean;
  blockHighRiskUsers: boolean;
  deviceFingerprintingEnabled: boolean;
  strictDeviceChecking: boolean;
  permanentDeviceBinding: boolean;
  bypassDetectionEnabled: boolean;
  autoBlockViolations: boolean;
  ipTrackingEnabled: boolean;
  maxUsersPerIp: number;
  maxDevicesPerUser: number;
  similarityThreshold: number;
  rapidRegistrationLimit: number;
  rapidRegistrationWindowHours: number;
  adminNotificationsEnabled: boolean;
  deviceCleanupDays: number;
  multiAccountDetectionEnabled: boolean;
  detectionSensitivity: number;
  crossReferenceDetection: boolean;
  behavioralPatternDetection: boolean;
  whitelistIps: string[];
  blacklistIps: string[];
  blockThreshold: number;
  flagThreshold: number;
  multiAccountThreshold: number;
  deviceCollisionThreshold: number;
  fingerprintSalt: string;
  fingerprintEncryptionKey: string;
  botDetectionThreshold: number;
}

interface CaptchaConfig {
  miniappEnabled: boolean;
  svgEnabled: boolean;
  requireAtLeastOne: boolean;
  forExistingUsers: boolean;
  geoBlocking: {
    enabled: boolean;
    blockedCountries: string[];
    allowedCountries: string[];
    suspiciousCountries: string[];
  };
  riskThresholds: {
    low: number;
    medium: number;
    high: number;
    critical: number;
  };
  sessionTimeout: number;
  maxAttempts: number;
}

interface TaskConfig {
  autoApproveSubmissions: boolean;
  dailyTaskResetInterval: string; // Supports: 1m, 59m, 1h, 24h, 1d, 7d
}

interface PointsConfig {
  minWithdraw: number;
  conversionRate: number;
  channelJoin: number;
  twitterFollow: number;
  retweet: number;
  instagramFollow: number;
  perMonth: number;
  perReferral: number;
  premiumMember: number;
  requireChannelJoinForWithdrawal: boolean;
  transfer: {
    enabled: boolean;
    minAmount: number;
    maxAmount: number;
    maxDailyAmount: number;
    feePercentage: number;
    dailyLimit: number;
    requireConfirmation: boolean;
  };
}

interface ReferralConfig {
  codeLength: number;
  taskThreshold: number;
}

interface WalletConfig {
  projectId: string;
  privateKey: string;
  tokenContractAddress: string;
  claimContractAddress: string;
  rpcUrl: string;
  chainId: number;
  explorerUrl: string;
  tokenSymbol: string;
  tokenDecimals: number;
  apps: Record<string, boolean>;
  qrCode: {
    expirySeconds: number;
    dailyLimit: number;
  };
  walletConnect: {
    approvalTimeoutMs: number;
    connectionExpiryMs: number;
    maxRetryAttempts: number;
    retryDelayMs: number;
  };
  withdrawMode?: 'claim' | 'server';
  claimFunctionSignature?: string;
  claimArgsTemplate?: string;
  confirmationsToWait?: number;
  claimSignerPrivateKey?: string;
}

interface NotificationConfig {
  transactionSent: boolean;
  transactionPending: boolean;
  withdrawSuccess: boolean;
  withdrawFailed: boolean;
  walletConnected: boolean;
  walletDisconnected: boolean;
  referrerNotification: boolean;
}

interface ServerConfig {
  ports: {
    admin: number;
    api: number;
    miniapp: number;
    webhook: number;
  };
  urls: {
    frontend: string;
    adminPanel: string;
    miniapp: string;
    ngrok?: string;
  };
  publicUrl?: string;
}

interface LoggingConfig {
  level: string;
  fileEnabled: boolean;
  filePath: string;
  rotationDays: number;
}

interface RateLimitConfig {
  enabled: boolean;
  windowMs: number;
  maxRequests: number;
}

interface PathConfig {
  root: string;
  src: string;
  data: string;
  logs: string;
  assets: string;
}

interface JwtConfig {
  secret: string;
  adminExpiresIn: string;
  refreshSecret: string;
  refreshExpiresIn: string;
}

const parseBoolean = (value: string | undefined, defaultValue = false): boolean => {
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true';
};

const parseNumber = (value: string | undefined, defaultValue = 0): number => {
  if (!value) return defaultValue;
  const parsed = Number(value);
  return isNaN(parsed) ? defaultValue : parsed;
};

const parseArray = (value: string | undefined, defaultValue: string[] = []): string[] => {
  if (!value) return defaultValue;
  return value.split(',').map(item => item.trim()).filter(Boolean);
};

const validateRequiredEnvVars = (): void => {
  if ((process.env.NODE_ENV || '').toLowerCase() === 'test') {
    process.env.BOT_TOKEN = process.env.BOT_TOKEN || 'TEST_BOT_TOKEN';
    return;
  }
  const required = ['BOT_TOKEN'];
  const missing = required.filter(envVar => !process.env[envVar]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing.join(', '));
    console.error('Please check your .env file and ensure all required variables are set.');
    console.error('📋 Copy .env.example to .env and configure the required values.');
    process.exit(1);
  }
};

const validateProductionConfig = (): void => {
  if ((process.env.NODE_ENV || '').toLowerCase() === 'test') {
    return;
  }
  if (process.env.NODE_ENV === 'production') {
    const warnings: string[] = [];
    const errors: string[] = [];

    // Critical production requirements
    if (!process.env.ADMIN_KEY || process.env.ADMIN_KEY.length < 32) {
      errors.push('ADMIN_KEY must be set to a secure random string (32+ characters) in production');
    }

    // JWT Secret validation - CRITICAL SECURITY
    if (!process.env.ADMIN_JWT_SECRET) {
      errors.push('ADMIN_JWT_SECRET must be explicitly set in production (minimum 64 characters)');
    } else {
      const jwtSecret = process.env.ADMIN_JWT_SECRET;
      if (jwtSecret.length < 64) {
        errors.push('ADMIN_JWT_SECRET must be at least 64 characters long for production security');
      }
      if (jwtSecret.includes('default') || jwtSecret.includes('secret') || jwtSecret.includes('admin')) {
        errors.push('ADMIN_JWT_SECRET cannot contain common words like "default", "secret", or "admin"');
      }
      if (!/[A-Z]/.test(jwtSecret) || !/[a-z]/.test(jwtSecret) || !/[0-9]/.test(jwtSecret)) {
        warnings.push('ADMIN_JWT_SECRET should contain uppercase, lowercase, and numeric characters for better entropy');
      }
    }

    if (!process.env.REFRESH_TOKEN_SECRET) {
      errors.push('REFRESH_TOKEN_SECRET must be explicitly set in production (minimum 64 characters)');
    } else {
      const refreshSecret = process.env.REFRESH_TOKEN_SECRET;
      if (refreshSecret.length < 64) {
        errors.push('REFRESH_TOKEN_SECRET must be at least 64 characters long for production security');
      }
      if (refreshSecret.includes('default') || refreshSecret.includes('secret') || refreshSecret.includes('refresh')) {
        errors.push('REFRESH_TOKEN_SECRET cannot contain common words like "default", "secret", or "refresh"');
      }
      if (process.env.ADMIN_JWT_SECRET === process.env.REFRESH_TOKEN_SECRET) {
        errors.push('ADMIN_JWT_SECRET and REFRESH_TOKEN_SECRET must be different for security');
      }
    }



    if (!process.env.WEBHOOK_URL && process.env.NODE_ENV === 'production') {
      warnings.push('WEBHOOK_URL not set. Bot will use polling mode which is less efficient for production.');
    }

    // Wallet configuration for token distributions
    if (!process.env.WALLET_PRIVATE_KEY && !process.env.TOKEN_CONTRACT_ADDRESS) {
      warnings.push('Wallet configuration incomplete. Token distributions will not work.');
    }

    // Security configuration warnings
    if (process.env.AUTO_BLOCK_VIOLATIONS === 'false') {
      warnings.push('AUTO_BLOCK_VIOLATIONS is disabled. Manual moderation required.');
    }

    if (process.env.DEVICE_FINGERPRINTING_ENABLED === 'false') {
      warnings.push('Device fingerprinting is disabled. Multi-account detection may be less effective.');
    }

    // Log warnings and errors
    if (warnings.length > 0) {
      console.warn('⚠️  Production Configuration Warnings:');
      warnings.forEach(warning => console.warn(`   • ${warning}`));
    }

    if (errors.length > 0) {
      console.error('❌ Production Configuration Errors:');
      errors.forEach(error => console.error(`   • ${error}`));
      console.error('\n🔒 These issues must be resolved before running in production.');
      process.exit(1);
    }

    if (warnings.length > 0) {
      console.warn('\n📖 See .env.example for detailed configuration guidance.');
    }
  }
};

const validateDataSourceConfig = (): void => {
  if ((process.env.NODE_ENV || '').toLowerCase() === 'test') {
    process.env.MONGODB_URL = process.env.MONGODB_URL || 'mongodb://localhost:27017/test';
    return;
  }
  if (!process.env.MONGODB_URL && !process.env.MONGODB_HOST) {
    console.error('❌ MONGODB_URL or MONGODB_HOST is required');
    process.exit(1);
  }
};

const generateSecureKey = (name: string, minLength = 64): string => {
  // Generate cryptographically secure 256-bit (32 byte) key, encoded as hex (64 characters)
  const keyBytes = Math.max(32, Math.ceil(minLength / 2)); // Ensure at least 32 bytes (256 bits)
  const key = crypto.randomBytes(keyBytes).toString('hex');
  
  console.error(`❌ CRITICAL SECURITY WARNING: No ${name} environment variable set!`);
  console.error(`❌ Auto-generated key: ${key}`);
  console.error(`❌ This key is NOT secure for production!`);
  console.error(`❌ Set ${name} environment variable with a secure key before production use!`);
  console.error(`❌ Minimum recommended length: ${minLength} characters`);
  
  // In development, log the key for convenience, but make it clear it's insecure
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`⚠️  Development mode: Using auto-generated ${name}`);
    console.warn(`⚠️  Add to .env file: ${name}=${key}`);
  }
  
  return key;
};

// Enhanced JWT secret validation
const validateJWTSecrets = (): void => {
  if ((process.env.NODE_ENV || '').toLowerCase() === 'test') {
    process.env.ADMIN_JWT_SECRET = process.env.ADMIN_JWT_SECRET || 'TEST_ADMIN_JWT_SECRET_TEST_ADMIN_JWT_SECRET_TEST_ADMIN_JWT_SECRET_';
    process.env.REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'TEST_REFRESH_TOKEN_SECRET_TEST_REFRESH_TOKEN_SECRET_TEST_REFRESH_';
    return;
  }
  const jwtSecret = process.env.ADMIN_JWT_SECRET;
  const refreshSecret = process.env.REFRESH_TOKEN_SECRET;
  
  if (jwtSecret) {
    if (jwtSecret.length < 64) {
      console.error(`❌ ADMIN_JWT_SECRET too short (${jwtSecret.length} chars). Minimum: 64 characters.`);
      process.exit(1);
    }
    
    const weakPatterns = ['default', 'admin', 'secret', 'jwt', 'token', '123456', 'password'];
    const hasWeakPattern = weakPatterns.some(pattern => 
      jwtSecret.toLowerCase().includes(pattern.toLowerCase())
    );
    
    if (hasWeakPattern) {
      console.error('❌ ADMIN_JWT_SECRET contains weak patterns. Use a cryptographically secure random key.');
      process.exit(1);
    }
  }
  
  if (refreshSecret) {
    if (refreshSecret.length < 64) {
      console.error(`❌ REFRESH_TOKEN_SECRET too short (${refreshSecret.length} chars). Minimum: 64 characters.`);
      process.exit(1);
    }
    
    if (jwtSecret === refreshSecret) {
      console.error('❌ ADMIN_JWT_SECRET and REFRESH_TOKEN_SECRET must be different!');
      process.exit(1);
    }
  }
};

// Secret rotation utilities
export interface SecretRotationConfig {
  currentSecret: string;
  previousSecret?: string;
  rotationDate?: string;
  nextRotationDue?: string;
}

export const rotateSecrets = (): { adminJwtSecret: string; refreshTokenSecret: string } => {
  const newAdminSecret = crypto.randomBytes(32).toString('hex');
  const newRefreshSecret = crypto.randomBytes(32).toString('hex');
  
  console.log('🔄 JWT Secrets Rotation Generated:');
  console.log('Add these to your environment variables:');
  console.log(`ADMIN_JWT_SECRET=${newAdminSecret}`);
  console.log(`REFRESH_TOKEN_SECRET=${newRefreshSecret}`);
  console.log('');
  console.log('⚠️  After updating environment variables:');
  console.log('1. Restart all application instances');
  console.log('2. All existing tokens will be invalidated');
  console.log('3. Users will need to re-authenticate');
  console.log('4. Update monitoring and backup systems');
  
  return {
    adminJwtSecret: newAdminSecret,
    refreshTokenSecret: newRefreshSecret
  };
};

validateRequiredEnvVars();
validateDataSourceConfig();
validateJWTSecrets();
validateProductionConfig();

export const config: AppConfig = {
  environment: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') === 'development',
  isProd: (process.env.NODE_ENV || 'development') === 'production',

  admin: {
    adminIds: parseArray(process.env.ADMIN_USER_IDS, ['1064587081']),
    superAdmins: parseArray(process.env.SUPER_ADMIN_USER_IDS, []),
    key: process.env.ADMIN_KEY || generateSecureKey('ADMIN_KEY', 32),
    panelUrl: process.env.ADMIN_PANEL_URL || 'http://localhost:5174',
    corsOrigins: parseArray(process.env.CORS_ORIGINS, ['http://localhost:3000', 'http://localhost:5173', 'https://bot.gamelabs.space']),
    trustProxy: parseBoolean(process.env.TRUST_PROXY, false),
  },

  bot: {
    token: process.env.BOT_TOKEN!,
    name: process.env.BOT_NAME || 'Telegram Airdrop Bot Pro',
    username: process.env.BOT_USERNAME || 'airdrop_bot',
    requiredChannelId: process.env.REQUIRED_CHANNEL_ID || '@yourchannel',
    withdrawAlertChannelId: process.env.WITHDRAW_ALERT_CHANNEL_ID || '',
    supportUsername: process.env.SUPPORT_USERNAME || 'support',
    status: parseBoolean(process.env.BOT_STATUS, true),
    maintenanceMode: parseBoolean(process.env.MAINTENANCE_MODE, false),
    webhookUrl: process.env.WEBHOOK_URL,
    useWebhook: parseBoolean(process.env.USE_WEBHOOK, false),
    referralBonus: parseNumber(process.env.REFERRAL_BONUS, 15),
    referralWelcomeBonus: parseNumber(process.env.REFERRAL_WELCOME_BONUS, 7),
    referralWelcomeBonusEnabled: parseBoolean(process.env.REFERRAL_WELCOME_BONUS_ENABLED, true),
    dailyBonus: parseNumber(process.env.DAILY_BONUS, 10),
    captchaReward: parseNumber(process.env.CAPTCHA_REWARD, 0),
    website: process.env.FRONTEND_URL || process.env.BOT_WEBSITE,
    minWithdrawal: parseNumber(process.env.MIN_WITHDRAWAL, 100),
    walletConnectionBonus: parseNumber(process.env.WALLET_CONNECTION_BONUS, 0),
    pointToTokenRatio: parseNumber(process.env.POINT_TO_TOKEN_RATIO, 0.001),
  },

  storage: {
    source: 'mongodb' as any,
    file: {
      basePath: process.env.FILE_DB_PATH || './data',
      batchSize: parseNumber(process.env.FILE_BATCH_SIZE, 1000),
    },
    mongodb: {
      url: process.env.MONGODB_URL || `mongodb://${process.env.MONGODB_HOST || 'localhost'}:${process.env.MONGODB_PORT || 27017}/${process.env.MONGODB_DATABASE || 'telegram_airdrop_bot'}`,
      database: process.env.MONGODB_DATABASE || 'telegram_airdrop_bot',
      username: process.env.MONGODB_USERNAME,
      password: process.env.MONGODB_PASSWORD,
    },
  },

  security: {
    adminJwtSecret: process.env.ADMIN_JWT_SECRET || generateSecureKey('ADMIN_JWT_SECRET', 64),
    refreshTokenSecret: process.env.REFRESH_TOKEN_SECRET || generateSecureKey('REFRESH_TOKEN_SECRET', 64),
    enableMultiAccountDetection: true,
    enableDeviceFingerprinting: true,
    enableThreatAnalysis: true,
    blockHighRiskUsers: true,
    deviceFingerprintingEnabled: true,
    strictDeviceChecking: true,
    permanentDeviceBinding: true,
    bypassDetectionEnabled: true,
    autoBlockViolations: true,
    ipTrackingEnabled: true,
    maxUsersPerIp: 1,
    maxDevicesPerUser: 1,
    similarityThreshold: 0.8,
    rapidRegistrationLimit: 3,
    rapidRegistrationWindowHours: 24,
    adminNotificationsEnabled: true,
    deviceCleanupDays: 30,
    multiAccountDetectionEnabled: true,
    detectionSensitivity: 7,
    crossReferenceDetection: true,
    behavioralPatternDetection: true,
    whitelistIps: [],
    blacklistIps: parseArray(process.env.BLACKLIST_IPS),
    blockThreshold: parseNumber(process.env.SECURITY_BLOCK_THRESHOLD, 0.8),
    flagThreshold: parseNumber(process.env.SECURITY_FLAG_THRESHOLD, 0.5),
    multiAccountThreshold: parseNumber(process.env.SECURITY_MULTI_ACCOUNT_THRESHOLD, 0.3),
    deviceCollisionThreshold: parseNumber(process.env.SECURITY_DEVICE_COLLISION_THRESHOLD, 0.95),
    fingerprintSalt: process.env.FINGERPRINT_SALT || generateSecureKey('FINGERPRINT_SALT', 32),
    fingerprintEncryptionKey: process.env.FINGERPRINT_ENCRYPTION_KEY || generateSecureKey('FINGERPRINT_ENCRYPTION_KEY', 32),
    botDetectionThreshold: parseNumber(process.env.BOT_DETECTION_THRESHOLD, 0.6),
  },

  captcha: {
    miniappEnabled: parseBoolean(process.env.MINIAPP_CAPTCHA_ENABLED, true),
    svgEnabled: parseBoolean(process.env.SVG_CAPTCHA_ENABLED, true),
    requireAtLeastOne: parseBoolean(process.env.REQUIRE_AT_LEAST_ONE_CAPTCHA, false),
    forExistingUsers: parseBoolean(process.env.CAPTCHA_FOR_EXISTING_USERS, false),
    geoBlocking: {
      enabled: true,
      blockedCountries: parseArray(process.env.BLOCKED_COUNTRIES, ['CN', 'RU', 'IR', 'KP']),
      allowedCountries: parseArray(process.env.ALLOWED_COUNTRIES, []),
      suspiciousCountries: parseArray(process.env.SUSPICIOUS_COUNTRIES, ['VN', 'BD', 'PK', 'IN', 'BR']),
    },
    riskThresholds: {
      low: parseNumber(process.env.CAPTCHA_RISK_LOW, 0.3),
      medium: parseNumber(process.env.CAPTCHA_RISK_MEDIUM, 0.5),
      high: parseNumber(process.env.CAPTCHA_RISK_HIGH, 0.7),
      critical: parseNumber(process.env.CAPTCHA_RISK_CRITICAL, 0.9),
    },
    sessionTimeout: parseNumber(process.env.CAPTCHA_SESSION_TIMEOUT, 300000), // 5 minutes
    maxAttempts: parseNumber(process.env.CAPTCHA_MAX_ATTEMPTS, 3),
  },

  //task: {
    //autoApproveSubmissions: parseBoolean(process.env.AUTO_APPROVE_SUBMISSIONS, false),
  //},


  task: {
    autoApproveSubmissions: parseBoolean(process.env.AUTO_APPROVE_SUBMISSIONS, false),
    dailyTaskResetInterval: process.env.DAILY_TASK_RESET_INTERVAL || '24h', // Supports: 1m, 59m, 1h, 24h, 1d, 7d
  },


  points: {
    minWithdraw: parseNumber(process.env.MIN_WITHDRAW_POINTS, 100),
    conversionRate: parseNumber(process.env.POINTS_TO_TOKEN_CONVERSION_RATE, 0.001),
    channelJoin: parseNumber(process.env.POINTS_CHANNEL_JOIN, 10),
    twitterFollow: parseNumber(process.env.POINTS_TWITTER_FOLLOW, 15),
    retweet: parseNumber(process.env.POINTS_RETWEET, 10),
    instagramFollow: parseNumber(process.env.POINTS_INSTAGRAM_FOLLOW, 10),
    perMonth: parseNumber(process.env.POINTS_PER_MONTH, 10),
    perReferral: parseNumber(process.env.POINTS_PER_REFERRAL, 25),
    premiumMember: parseNumber(process.env.POINTS_PREMIUM_MEMBER, 50),
    requireChannelJoinForWithdrawal: parseBoolean(process.env.WITHDRAW_REQUIRE_CHANNEL_JOIN, false),
    transfer: {
      enabled: parseBoolean(process.env.TRANSFER_ENABLED, true),
      minAmount: parseNumber(process.env.TRANSFER_MIN_POINTS, 50),
      maxAmount: parseNumber(process.env.TRANSFER_MAX_POINTS, 10000),
      maxDailyAmount: parseNumber(process.env.TRANSFER_MAX_DAILY_POINTS, 1000),
      feePercentage: parseNumber(process.env.TRANSFER_FEE_PERCENTAGE, 2),
      dailyLimit: parseNumber(process.env.TRANSFER_DAILY_LIMIT, 1),
      requireConfirmation: parseBoolean(process.env.TRANSFER_REQUIRE_CONFIRMATION, true),
    },
  },

  referral: {
    codeLength: parseNumber(process.env.REFERRAL_CODE_LENGTH, 8),
    taskThreshold: parseNumber(process.env.REFERRAL_TASK_THRESHOLD, 3),
  },

  wallet: {
    projectId: process.env.WALLETCONNECT_PROJECT_ID || '',
    privateKey: process.env.WALLET_PRIVATE_KEY || '',
    tokenContractAddress: process.env.TOKEN_CONTRACT_ADDRESS || '',
    claimContractAddress: process.env.CLAIM_CONTRACT_ADDRESS || process.env.TOKEN_CONTRACT_ADDRESS || '',
    rpcUrl: process.env.RPC_URL || 'https://mainnet.infura.io/v3/your_infura_key',
    chainId: parseNumber(process.env.CHAIN_ID, 1),
    explorerUrl: process.env.EXPLORER_URL || 'https://etherscan.io',
    tokenSymbol: process.env.TOKEN_SYMBOL || 'TOKEN',
    tokenDecimals: parseNumber(process.env.TOKEN_DECIMALS, 18),
    apps: {
      metamask: parseBoolean(process.env.SHOW_METAMASK_WALLET, true),
      trust: parseBoolean(process.env.SHOW_TRUST_WALLET, true),
      coinbase: parseBoolean(process.env.SHOW_COINBASE_WALLET, true),
      rainbow: parseBoolean(process.env.SHOW_RAINBOW_WALLET, true),
      bitget: parseBoolean(process.env.SHOW_BITGET_WALLET, true),
      phantom: parseBoolean(process.env.SHOW_PHANTOM_WALLET, false),
      exodus: parseBoolean(process.env.SHOW_EXODUS_WALLET, false),
      atomic: parseBoolean(process.env.SHOW_ATOMIC_WALLET, false),
      safepal: parseBoolean(process.env.SHOW_SAFEPAL_WALLET, false),
      tokenpocket: parseBoolean(process.env.SHOW_TOKENPOCKET_WALLET, false),
    },
    qrCode: {
      expirySeconds: parseNumber(process.env.QR_CODE_EXPIRY_TIME, 60),
      dailyLimit: parseNumber(process.env.DAILY_QR_LIMIT, 10),
    },
    walletConnect: {
      approvalTimeoutMs: parseNumber(process.env.WALLETCONNECT_APPROVAL_TIMEOUT_MS, 120000), // 2 minutes
      connectionExpiryMs: parseNumber(process.env.WALLETCONNECT_CONNECTION_EXPIRY_MS, 300000), // 5 minutes
      maxRetryAttempts: parseNumber(process.env.WALLETCONNECT_MAX_RETRY_ATTEMPTS, 2),
      retryDelayMs: parseNumber(process.env.WALLETCONNECT_RETRY_DELAY_MS, 3000), // 3 seconds
    },
    withdrawMode: (process.env.WITHDRAW_MODE as any) || 'claim',
    claimFunctionSignature: process.env.CLAIM_FUNCTION_SIGNATURE || 'function claim(uint256 amount, uint256 nonce, bytes signature)',
    claimArgsTemplate: process.env.CLAIM_ARGS_TEMPLATE || 'amount,nonce,signature',
    confirmationsToWait: parseNumber(process.env.WITHDRAW_CONFIRMATIONS, 1),
    claimSignerPrivateKey: process.env.CLAIM_SIGNER_PRIVATE_KEY || process.env.WALLET_PRIVATE_KEY || '',
  },

  notifications: {
    transactionSent: true,
    transactionPending: true,
    withdrawSuccess: true,
    withdrawFailed: true,
    walletConnected: true,
    walletDisconnected: true,
    referrerNotification: parseBoolean(process.env.SHOW_REFERRER_NOTIFICATION, true),
  },

  server: {
    ports: {
      admin: parseNumber(process.env.ADMIN_PORT, 3002),
      api: parseNumber(process.env.API_SERVER_PORT, 3004),
      miniapp: parseNumber(process.env.MINIAPP_PORT, 3001),
      webhook: parseNumber(process.env.WEBHOOK_PORT, 8443),
    },
    urls: {
      frontend: process.env.FRONTEND_URL || 'http://localhost:5174',
      adminPanel: process.env.ADMIN_PANEL_URL || 'http://localhost:5174',
      miniapp: process.env.MINIAPP_URL || process.env.MINIAPP_URL_DEV || 'http://localhost:3001',
      ngrok: process.env.NGROK_URL,
    },
    publicUrl: process.env.PUBLIC_URL || process.env.NGROK_URL || 'http://localhost:3004',
  },

  logging: {
    level: process.env.LOG_LEVEL || 'info',
    fileEnabled: parseBoolean(process.env.LOG_FILE_ENABLED, true),
    filePath: process.env.LOG_FILE_PATH || './logs',
    rotationDays: parseNumber(process.env.LOG_ROTATION_DAYS, 7),
  },

  rateLimit: {
    enabled: true,
    windowMs: 60000,
    maxRequests: 100,
  },

  paths: {
    root: path.resolve(__dirname, '../..'),
    src: path.resolve(__dirname, '..'),
    data: path.resolve(__dirname, '../../data'),
    logs: path.resolve(__dirname, '../../logs'),
    assets: path.resolve(__dirname, '../assets'),
  },

  jwt: {
    secret: process.env.ADMIN_JWT_SECRET || generateSecureKey('ADMIN_JWT_SECRET', 64),
    adminExpiresIn: process.env.JWT_ADMIN_EXPIRES_IN || '24h',
    refreshSecret: process.env.REFRESH_TOKEN_SECRET || generateSecureKey('REFRESH_TOKEN_SECRET', 64),
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },
};

export const isAdmin = (userId: string): boolean => {
  return config.admin.adminIds.includes(userId.toString()) || config.admin.superAdmins.includes(userId.toString());
};

export const getStorageConfig = () => {
  const { source } = config.storage;
  
  if (source === 'mongodb') {
    if ((process.env.NODE_ENV || '').toLowerCase() !== 'production') console.log('🍃 Storage configured: MongoDB Database');
  } else {
    if ((process.env.NODE_ENV || '').toLowerCase() !== 'production') console.log('📁 Storage configured: File System');
  }
  
  return config.storage;
};

/**
 * Get the application configuration
 * @returns Application configuration object
 */
export const getConfig = () => {
  return config;
};

export default config;