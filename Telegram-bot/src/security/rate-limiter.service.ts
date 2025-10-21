import { Logger } from '../services/logger';
import { getConfig } from '../config';
import { MemoryManager, ManagedCache } from '../services/memory-manager.service';
import { StorageManager } from '../storage';

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator: (identifier: string) => string;
  skipIf?: (identifier: string) => boolean;
  onLimitReached?: (identifier: string, resetTime: Date) => void;
}

export interface RateLimitResult {
  allowed: boolean;
  resetTime: Date;
  remaining: number;
  total: number;
}

export interface RateLimitStore {
  get(key: string): Promise<{ count: number; resetTime: number } | null>;
  set(key: string, value: { count: number; resetTime: number }): Promise<void>;
  increment(key: string, windowMs?: number): Promise<{ count: number; resetTime: number }>;
  cleanup(): Promise<void>;
}

export class MemoryRateLimitStore implements RateLimitStore {
  private store: ManagedCache<string, { count: number; resetTime: number }>;
  private memoryManager = MemoryManager.getInstance();
  private cleanupIntervalId: string;

  constructor() {
    this.store = this.memoryManager.getOrCreateCache<string, { count: number; resetTime: number }>(
      'rate-limit-store',
      'Rate limiting cache with automatic cleanup',
      {
        max: 10000,
        ttl: 5 * 60 * 1000
      }
    );

    this.cleanupIntervalId = this.memoryManager.getOrCreateManagedInterval(
      'rate-limit-cleanup',
      'Rate limit cache cleanup',
      () => this.cleanup(),
      60 * 1000
    );
  }

  async get(key: string): Promise<{ count: number; resetTime: number } | null> {
    const entry = this.store.get(key);
    if (!entry || entry.resetTime < Date.now()) {
      return null;
    }
    return entry;
  }

  async set(key: string, value: { count: number; resetTime: number }): Promise<void> {
    this.store.set(key, value);
  }

  async increment(key: string, windowMs: number = 60000): Promise<{ count: number; resetTime: number }> {
    const existing = await this.get(key);
    const now = Date.now();

    if (existing && existing.resetTime > now) {
      const updated = { count: existing.count + 1, resetTime: existing.resetTime };
      this.store.set(key, updated);
      return updated;
    } else {
      const newEntry = { count: 1, resetTime: now + windowMs };
      this.store.set(key, newEntry);
      return newEntry;
    }
  }

  async cleanup(): Promise<void> {
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetTime < now) {
        this.store.delete(key);
      }
    }
  }

  destroy(): void {
    this.memoryManager.clearManagedInterval(this.cleanupIntervalId);
    this.memoryManager.clearManagedCache('rate-limit-store');
  }
}

export class MongoRateLimitStore implements RateLimitStore {
  private coll: any;
  private inited = false;
  private logger = Logger.getInstance();

  private async ensureInit() {
    if (this.inited) return;
    const storage = StorageManager.getInstance().getStorageInstance() as any;
    if (!storage || typeof storage.getRawCollection !== 'function') {
      throw new Error('Mongo storage not available for rate limiting');
    }
    this.coll = storage.getRawCollection('rate_limits');
    try {
      await this.coll.createIndex({ key: 1 }, { unique: true });
      await this.coll.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    } catch (e) {
      // ignore
    }
    this.inited = true;
  }

  async get(key: string): Promise<{ count: number; resetTime: number } | null> {
    await this.ensureInit();
    const doc = await this.coll.findOne({ key }, { projection: { count: 1, resetTime: 1 } });
    if (!doc) return null;
    const now = Date.now();
    if (typeof doc.resetTime === 'number') {
      if (doc.resetTime < now) return null;
      return { count: doc.count || 0, resetTime: doc.resetTime };
    }
    const rt = new Date(doc.resetTime).getTime();
    if (rt < now) return null;
    return { count: doc.count || 0, resetTime: rt };
  }

  async set(key: string, value: { count: number; resetTime: number }): Promise<void> {
    await this.ensureInit();
    await this.coll.updateOne(
      { key },
      { $set: { count: value.count, resetTime: value.resetTime, expiresAt: new Date(value.resetTime) } },
      { upsert: true }
    );
  }

  async increment(key: string, windowMs: number = 60000): Promise<{ count: number; resetTime: number }> {
    await this.ensureInit();
    const now = Date.now();
    const resetTime = now + windowMs;
    const res = await this.coll.findOneAndUpdate(
      { key },
      [
        {
          $set: {
            count: {
              $cond: [ { $and: [ { $gt: ['$resetTime', now] } ] }, { $add: ['$count', 1] }, 1 ]
            },
            resetTime: {
              $cond: [ { $and: [ { $gt: ['$resetTime', now] } ] }, '$resetTime', resetTime ]
            },
            expiresAt: {
              $toDate: {
                $cond: [ { $and: [ { $gt: ['$resetTime', now] } ] }, '$resetTime', resetTime ]
              }
            }
          }
        }
      ],
      { upsert: true, returnDocument: 'after' }
    );
    const doc = res?.value || { count: 1, resetTime };
    const rt = typeof doc.resetTime === 'number' ? doc.resetTime : new Date(doc.resetTime).getTime();
    return { count: doc.count || 1, resetTime: rt };
  }

  async cleanup(): Promise<void> {
    await this.ensureInit();
    try { await this.coll.deleteMany({ expiresAt: { $lt: new Date() } }); } catch {}
  }
}

export class RateLimiter {
  private readonly logger = Logger.getInstance();
  private readonly config = getConfig();
  private readonly store: RateLimitStore;

  constructor(store?: RateLimitStore) {
    this.store = store || new MemoryRateLimitStore();
  }

  async checkLimit(
    identifier: string,
    config: RateLimitConfig
  ): Promise<RateLimitResult> {
    const key = config.keyGenerator(identifier);

    if (config.skipIf && config.skipIf(identifier)) {
      return {
        allowed: true,
        resetTime: new Date(Date.now() + config.windowMs),
        remaining: config.maxRequests,
        total: config.maxRequests
      };
    }

    try {
      const current = await this.store.increment(key, config.windowMs);
      const allowed = current.count <= config.maxRequests;
      const resetTime = new Date(current.resetTime);

      if (!allowed && config.onLimitReached) {
        config.onLimitReached(identifier, resetTime);
      }

      return {
        allowed,
        resetTime,
        remaining: Math.max(0, config.maxRequests - current.count),
        total: config.maxRequests
      };
    } catch (error) {
      this.logger.error('Rate limit check failed:', error);
      return {
        allowed: false,
        resetTime: new Date(Date.now() + config.windowMs),
        remaining: 0,
        total: config.maxRequests
      };
    }
  }

  static createPresets() {
    return {
      botCommands: (store?: RateLimitStore) => new RateLimiter(store),
      taskSubmissions: (store?: RateLimitStore) => new RateLimiter(store),
      walletConnections: (store?: RateLimitStore) => new RateLimiter(store),
      referralCodes: (store?: RateLimitStore) => new RateLimiter(store),
      pointClaims: (store?: RateLimitStore) => new RateLimiter(store),
      adminActions: (store?: RateLimitStore) => new RateLimiter(store)
    };
  }

  static getConfigs(): Record<string, RateLimitConfig> {
    return {
      botCommands: {
        windowMs: 60 * 1000,
        maxRequests: 10,
        keyGenerator: (userId: string) => `bot_commands:${userId}`,
        onLimitReached: (userId, resetTime) => {
          Logger.getInstance().warn('Bot command rate limit reached', {
            userId,
            resetTime: resetTime.toISOString()
          });
        }
      },
      taskSubmissions: {
        windowMs: 60 * 60 * 1000,
        maxRequests: 3,
        keyGenerator: (userId: string) => `task_submissions:${userId}`,
        onLimitReached: (userId, resetTime) => {
          Logger.getInstance().warn('Task submission rate limit reached', {
            userId,
            resetTime: resetTime.toISOString()
          });
        }
      },
      walletConnections: {
        windowMs: 24 * 60 * 60 * 1000,
        maxRequests: 5,
        keyGenerator: (userId: string) => `wallet_connections:${userId}`,
        onLimitReached: (userId, resetTime) => {
          Logger.getInstance().warn('Wallet connection rate limit reached', {
            userId,
            resetTime: resetTime.toISOString()
          });
        }
      },
      referralCodes: {
        windowMs: 60 * 60 * 1000,
        maxRequests: 1,
        keyGenerator: (userId: string) => `referral_codes:${userId}`,
        onLimitReached: (userId, resetTime) => {
          Logger.getInstance().warn('Referral code rate limit reached', {
            userId,
            resetTime: resetTime.toISOString()
          });
        }
      },
      pointClaims: {
        windowMs: 60 * 60 * 1000,
        maxRequests: 20,
        keyGenerator: (userId: string) => `point_claims:${userId}`,
        onLimitReached: (userId, resetTime) => {
          Logger.getInstance().warn('Point claim rate limit reached', {
            userId,
            resetTime: resetTime.toISOString()
          });
        }
      },
      adminActions: {
        windowMs: 60 * 1000,
        maxRequests: 100,
        keyGenerator: (adminId: string) => `admin_actions:${adminId}`,
        skipIf: (adminId: string) => {
          const config = getConfig();
          return config.admin.superAdmins?.includes(adminId) || false;
        }
      }
    };
  }
}

export class HTTPRateLimitMiddleware {
  private readonly rateLimiter: RateLimiter;
  private readonly config: RateLimitConfig;

  constructor(rateLimiter: RateLimiter, config: RateLimitConfig) {
    this.rateLimiter = rateLimiter;
    this.config = config;
  }

  middleware() {
    return async (req: any, res: any, next: any) => {
      const identifier = this.extractIdentifier(req);
      const result = await this.rateLimiter.checkLimit(identifier, this.config);

      res.set({
        'X-RateLimit-Limit': this.config.maxRequests.toString(),
        'X-RateLimit-Remaining': result.remaining.toString(),
        'X-RateLimit-Reset': result.resetTime.toISOString()
      });

      if (!result.allowed) {
        return res.status(429).json({
          error: 'Rate limit exceeded',
          resetTime: result.resetTime.toISOString(),
          remaining: result.remaining
        });
      }

      next();
    };
  }

  private extractIdentifier(req: any): string {
    return (
      req.user?.id ||
      req.headers['x-user-id'] ||
      req.ip ||
      'anonymous'
    );
  }
}

export class TelegramRateLimiter {
  private readonly rateLimiters: Record<string, RateLimiter>;
  private readonly configs: Record<string, RateLimitConfig>;
  private readonly logger = Logger.getInstance();

  constructor(store?: RateLimitStore) {
    const presets = RateLimiter.createPresets();
    this.configs = RateLimiter.getConfigs();

    this.rateLimiters = {
      botCommands: presets.botCommands(store),
      taskSubmissions: presets.taskSubmissions(store),
      walletConnections: presets.walletConnections(store),
      referralCodes: presets.referralCodes(store),
      pointClaims: presets.pointClaims(store)
    };
  }

  async checkBotCommand(userId: string): Promise<RateLimitResult> {
    return this.rateLimiters.botCommands.checkLimit(userId, this.configs.botCommands);
  }

  async checkTaskSubmission(userId: string): Promise<RateLimitResult> {
    return this.rateLimiters.taskSubmissions.checkLimit(userId, this.configs.taskSubmissions);
  }

  async checkWalletConnection(userId: string): Promise<RateLimitResult> {
    return this.rateLimiters.walletConnections.checkLimit(userId, this.configs.walletConnections);
  }

  async checkReferralCode(userId: string): Promise<RateLimitResult> {
    return this.rateLimiters.referralCodes.checkLimit(userId, this.configs.referralCodes);
  }

  async checkPointClaim(userId: string): Promise<RateLimitResult> {
    return this.rateLimiters.pointClaims.checkLimit(userId, this.configs.pointClaims);
  }

  createBotMiddleware(limitType: keyof typeof this.rateLimiters) {
    return async (ctx: any, next: any) => {
      const userId = ctx.from?.id?.toString();
      if (!userId) {
        return next();
      }

      const rateLimiter = this.rateLimiters[limitType];
      const config = this.configs[limitType];

      if (!rateLimiter || !config) {
        this.logger.error('Unknown rate limit type:', limitType);
        return next();
      }

      const result = await rateLimiter.checkLimit(userId, config);

      if (!result.allowed) {
        const resetTimeStr = result.resetTime.toLocaleTimeString();
        await ctx.reply(`⚠️ Rate limit exceeded. Please try again after ${resetTimeStr}.`);
        return;
      }

      ctx.rateLimit = result;
      return next();
    };
  }

  async checkDynamicLimit(
    userId: string,
    action: string,
    userRiskScore: number
  ): Promise<RateLimitResult> {
    const baseConfig = this.configs.botCommands;

    const riskMultiplier = Math.max(0.1, 1 - userRiskScore);
    const adjustedMaxRequests = Math.floor(baseConfig.maxRequests * riskMultiplier);

    const dynamicConfig: RateLimitConfig = {
      ...baseConfig,
      maxRequests: adjustedMaxRequests,
      keyGenerator: (id: string) => `dynamic:${action}:${id}`
    };

    return this.rateLimiters.botCommands.checkLimit(userId, dynamicConfig);
  }
}

export class GlobalRateLimitManager {
  private static instance: GlobalRateLimitManager;
  private readonly telegramLimiter: TelegramRateLimiter;
  private readonly logger = Logger.getInstance();

  private constructor() {
    let store: RateLimitStore;
    try {
      const url = process.env.REDIS_URL || process.env.RATE_LIMIT_REDIS_URL;
      if (url) {
        // Dynamically require to avoid hard dependency if unused
        const { RedisRateLimitStore } = require('./redis-rate-limit.store');
        const redisStore = new RedisRateLimitStore(url);
        // Best-effort connect
        if (typeof redisStore.connect === 'function') {
          // Fire and forget; fallback to memory on failure
          redisStore.connect().catch(() => {});
        }
        store = redisStore as RateLimitStore;
      } else {
        store = new MongoRateLimitStore();
      }
    } catch {
      store = new MemoryRateLimitStore();
    }
    this.telegramLimiter = new TelegramRateLimiter(store);
  }

  static getInstance(): GlobalRateLimitManager {
    if (!GlobalRateLimitManager.instance) {
      GlobalRateLimitManager.instance = new GlobalRateLimitManager();
    }
    return GlobalRateLimitManager.instance;
  }

  getTelegramLimiter(): TelegramRateLimiter {
    return this.telegramLimiter;
  }

  createCustomLimiter(config: RateLimitConfig, store?: RateLimitStore): RateLimiter {
    return new RateLimiter(store);
  }

  async getStatistics(): Promise<{
    activeUsers: number;
    totalRequests: number;
    blockedRequests: number;
  }> {
    return {
      activeUsers: 0,
      totalRequests: 0,
      blockedRequests: 0
    };
  }
}
