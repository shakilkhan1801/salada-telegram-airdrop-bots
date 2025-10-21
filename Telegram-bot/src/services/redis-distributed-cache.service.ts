import Redis from 'ioredis';
import { Logger } from './logger';

/**
 * Redis Distributed Cache Service (L2 Cache Layer)
 * 
 * This provides a shared cache layer across multiple bot instances.
 * Works together with the existing LRU memory cache (L1) for optimal performance.
 * 
 * Cache Hierarchy:
 * L1: Memory (LRU) - 50k users, < 1ms latency, per-instance
 * L2: Redis - unlimited users, 1-2ms latency, shared across instances
 * L3: MongoDB - all users, 50-100ms latency, persistent storage
 */
export class RedisDistributedCacheService {
  private static instance: RedisDistributedCacheService;
  private redis: Redis | null = null;
  private logger = Logger.getInstance();
  private isAvailable = false;
  private readonly DEFAULT_TTL = 300; // 5 minutes

  private constructor() {
    this.initialize();
  }

  static getInstance(): RedisDistributedCacheService {
    if (!RedisDistributedCacheService.instance) {
      RedisDistributedCacheService.instance = new RedisDistributedCacheService();
    }
    return RedisDistributedCacheService.instance;
  }

  private async initialize(): Promise<void> {
    const redisHost = process.env.REDIS_HOST;
    const redisPort = parseInt(process.env.REDIS_PORT || '6379');
    const redisPassword = process.env.REDIS_PASSWORD;
    const redisUsername = process.env.REDIS_USERNAME || 'default';
    const redisUrl = process.env.REDIS_URL;

    if (!redisHost && !redisUrl) {
      this.logger.warn('Redis not configured for distributed cache. Using memory-only cache.');
      return;
    }

    try {
      // Support both URL and individual config
      if (redisUrl) {
        this.redis = new Redis(redisUrl, {
          lazyConnect: true,
          maxRetriesPerRequest: 2,
          enableOfflineQueue: false,
          retryStrategy: (times: number) => {
            if (times > 3) {
              this.logger.error('Redis connection failed after 3 retries');
              return null;
            }
            return Math.min(times * 200, 1000);
          }
        });
      } else {
        this.redis = new Redis({
          host: redisHost,
          port: redisPort,
          password: redisPassword,
          username: redisUsername,
          lazyConnect: true,
          maxRetriesPerRequest: 2,
          enableOfflineQueue: false,
          retryStrategy: (times: number) => {
            if (times > 3) {
              this.logger.error('Redis connection failed after 3 retries');
              return null;
            }
            return Math.min(times * 200, 1000);
          }
        });
      }

      await this.redis.connect();
      await this.redis.ping();

      this.isAvailable = true;
      this.logger.info('Redis distributed cache initialized', {
        host: redisHost || 'from URL',
        port: redisPort
      });

      this.redis.on('error', (err) => {
        this.logger.error('Redis cache error', err);
        this.isAvailable = false;
      });

      this.redis.on('connect', () => {
        this.logger.info('Redis cache connection restored');
        this.isAvailable = true;
      });

    } catch (error) {
      this.logger.error('Failed to connect to Redis cache', error);
      this.redis = null;
      this.isAvailable = false;
    }
  }

  /**
   * Get user from distributed cache
   */
  async getUser(userId: string): Promise<any | null> {
    if (!this.isAvailable || !this.redis) return null;

    try {
      const key = `user:${userId}`;
      const cached = await this.redis.get(key);
      
      if (cached) {
        this.logger.debug('Redis cache hit', { userId });
        return JSON.parse(cached);
      }
      
      return null;
    } catch (error) {
      this.logger.error('Redis get error', error);
      return null;
    }
  }

  /**
   * Set user in distributed cache
   */
  async setUser(userId: string, user: any, ttl: number = this.DEFAULT_TTL): Promise<void> {
    if (!this.isAvailable || !this.redis) return;

    try {
      const key = `user:${userId}`;
      await this.redis.setex(key, ttl, JSON.stringify(user));
      this.logger.debug('Redis cache set', { userId, ttl });
    } catch (error) {
      this.logger.error('Redis set error', error);
    }
  }

  /**
   * Invalidate user cache
   */
  async invalidateUser(userId: string): Promise<void> {
    if (!this.isAvailable || !this.redis) return;

    try {
      const key = `user:${userId}`;
      await this.redis.del(key);
      this.logger.debug('Redis cache invalidated', { userId });
    } catch (error) {
      this.logger.error('Redis invalidate error', error);
    }
  }

  /**
   * Invalidate multiple users
   */
  async invalidateUsers(userIds: string[]): Promise<void> {
    if (!this.isAvailable || !this.redis || userIds.length === 0) return;

    try {
      const keys = userIds.map(id => `user:${id}`);
      await this.redis.del(...keys);
      this.logger.debug('Redis cache bulk invalidated', { count: userIds.length });
    } catch (error) {
      this.logger.error('Redis bulk invalidate error', error);
    }
  }

  /**
   * Generic get from cache
   */
  async get(key: string): Promise<any | null> {
    if (!this.isAvailable || !this.redis) return null;

    try {
      const cached = await this.redis.get(key);
      return cached ? JSON.parse(cached) : null;
    } catch (error) {
      this.logger.error('Redis get error', { key, error });
      return null;
    }
  }

  /**
   * Generic set to cache
   */
  async set(key: string, value: any, ttl: number = this.DEFAULT_TTL): Promise<void> {
    if (!this.isAvailable || !this.redis) return;

    try {
      await this.redis.setex(key, ttl, JSON.stringify(value));
    } catch (error) {
      this.logger.error('Redis set error', { key, error });
    }
  }

  /**
   * Delete from cache
   */
  async del(key: string): Promise<void> {
    if (!this.isAvailable || !this.redis) return;

    try {
      await this.redis.del(key);
    } catch (error) {
      this.logger.error('Redis del error', { key, error });
    }
  }

  /**
   * Check if Redis is available
   */
  isHealthy(): boolean {
    return this.isAvailable;
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    available: boolean;
    keyCount: number;
    memoryUsed: string;
  }> {
    if (!this.isAvailable || !this.redis) {
      return {
        available: false,
        keyCount: 0,
        memoryUsed: '0'
      };
    }

    try {
      const info = await this.redis.info('stats');
      const memory = await this.redis.info('memory');
      
      // Parse key count from stats
      const keyCountMatch = info.match(/keys=(\d+)/);
      const keyCount = keyCountMatch ? parseInt(keyCountMatch[1]) : 0;
      
      // Parse memory usage
      const memoryMatch = memory.match(/used_memory_human:([^\r\n]+)/);
      const memoryUsed = memoryMatch ? memoryMatch[1].trim() : '0';

      return {
        available: true,
        keyCount,
        memoryUsed
      };
    } catch (error) {
      this.logger.error('Redis stats error', error);
      return {
        available: false,
        keyCount: 0,
        memoryUsed: '0'
      };
    }
  }

  /**
   * Cleanup resources
   */
  async dispose(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
      this.redis = null;
    }
    this.isAvailable = false;
    this.logger.info('Redis distributed cache disposed');
  }
}

// Export singleton instance
export const redisCache = RedisDistributedCacheService.getInstance();
