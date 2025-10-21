/**
 * ═══════════════════════════════════════════════════════════════════════
 *                   ADVANCED MULTI-LAYER CACHING SERVICE
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * Implements a sophisticated 3-tier caching strategy for million-user scale:
 * 
 * Layer 1: In-Memory LRU Cache (fastest, ~1ms)
 * Layer 2: Redis Cache (fast, ~5-10ms)
 * Layer 3: MongoDB (slow, ~50-200ms)
 * 
 * Features:
 * - Automatic cache warming
 * - Cache invalidation strategies
 * - Read-through and write-through caching
 * - Cache stampede prevention
 * - Intelligent TTL management
 * - Performance metrics tracking
 */

import { LRUCache } from 'lru-cache';
import Redis from 'ioredis';
import { Logger } from './logger';
import { getConfig } from '../config';

const logger = Logger.getInstance();
const config = getConfig();

interface CacheOptions {
  ttl?: number;           // Time to live in seconds
  useRedis?: boolean;     // Use Redis layer
  useMemory?: boolean;    // Use memory layer
  compress?: boolean;     // Compress data in Redis
}

interface CacheStats {
  memoryHits: number;
  memoryMisses: number;
  redisHits: number;
  redisMisses: number;
  dbHits: number;
  totalRequests: number;
  hitRate: number;
  avgResponseTime: number;
}

export class AdvancedCacheService {
  private static instance: AdvancedCacheService;
  
  // Layer 1: In-Memory LRU Caches
  private userCache: LRUCache<string, any>;
  private taskCache: LRUCache<string, any>;
  private sessionCache: LRUCache<string, any>;
  private referralCache: LRUCache<string, any>;
  
  // Layer 2: Redis Client
  private redis: Redis | null = null;
  private redisEnabled: boolean = false;
  
  // Statistics
  private stats: CacheStats = {
    memoryHits: 0,
    memoryMisses: 0,
    redisHits: 0,
    redisMisses: 0,
    dbHits: 0,
    totalRequests: 0,
    hitRate: 0,
    avgResponseTime: 0,
  };
  
  // Performance tracking
  private responseTimes: number[] = [];
  private readonly maxResponseTimes = 1000;
  
  // Cache stampede prevention
  private pendingFetches: Map<string, Promise<any>> = new Map();

  private constructor() {
    // Initialize in-memory caches
    this.userCache = new LRUCache({
      max: parseInt(process.env.USER_CACHE_SIZE || '500000'),
      ttl: parseInt(process.env.USER_CACHE_TTL_MS || '600000'),
      updateAgeOnGet: true,
      updateAgeOnHas: false,
    });

    this.taskCache = new LRUCache({
      max: 10000,
      ttl: 600000, // 10 minutes
      updateAgeOnGet: true,
    });

    this.sessionCache = new LRUCache({
      max: 500000,
      ttl: 900000, // 15 minutes
      updateAgeOnGet: true,
    });

    this.referralCache = new LRUCache({
      max: 50000,
      ttl: 300000, // 5 minutes
      updateAgeOnGet: true,
    });

    // Initialize Redis if available
    this.initializeRedis();
    
    // Start metrics collection
    this.startMetricsCollection();
    
    logger.info('✅ Advanced Caching Service initialized', {
      userCacheSize: this.userCache.max,
      taskCacheSize: this.taskCache.max,
      sessionCacheSize: this.sessionCache.max,
      redisEnabled: this.redisEnabled,
    });
  }

  static getInstance(): AdvancedCacheService {
    if (!AdvancedCacheService.instance) {
      AdvancedCacheService.instance = new AdvancedCacheService();
    }
    return AdvancedCacheService.instance;
  }

  /**
   * Initialize Redis connection
   */
  private initializeRedis(): void {
    try {
      const redisUrl = process.env.REDIS_URL;
      
      if (redisUrl) {
        this.redis = new Redis(redisUrl, {
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
          lazyConnect: false,
          retryStrategy: (times) => {
            if (times > 3) return null;
            return Math.min(times * 100, 2000);
          },
        });

        this.redis.on('connect', () => {
          this.redisEnabled = true;
          logger.info('✅ Redis connected for advanced caching');
        });

        this.redis.on('error', (error) => {
          logger.warn('Redis error, falling back to memory-only cache', { error: error.message });
          this.redisEnabled = false;
        });
      }
    } catch (error) {
      logger.warn('Failed to initialize Redis, using memory-only cache', { error });
    }
  }

  /**
   * Get value from cache with automatic fallback to database
   */
  async get<T>(
    key: string,
    fetchFunction: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const startTime = Date.now();
    this.stats.totalRequests++;

    const cacheType = this.getCacheType(key);
    const memoryCache = this.getMemoryCacheForType(cacheType);

    try {
      // Layer 1: Check in-memory cache
      if (options.useMemory !== false && memoryCache) {
        const memoryValue = memoryCache.get(key);
        if (memoryValue !== undefined) {
          this.stats.memoryHits++;
          this.recordResponseTime(Date.now() - startTime);
          return memoryValue as T;
        }
        this.stats.memoryMisses++;
      }

      // Layer 2: Check Redis cache
      if (options.useRedis !== false && this.redisEnabled && this.redis) {
        const redisValue = await this.redis.get(key);
        if (redisValue) {
          const parsed = JSON.parse(redisValue) as T;
          this.stats.redisHits++;
          
          // Populate memory cache
          if (memoryCache) {
            memoryCache.set(key, parsed);
          }
          
          this.recordResponseTime(Date.now() - startTime);
          return parsed;
        }
        this.stats.redisMisses++;
      }

      // Cache stampede prevention
      const existingFetch = this.pendingFetches.get(key);
      if (existingFetch) {
        return await existingFetch;
      }

      // Layer 3: Fetch from database
      const fetchPromise = this.fetchAndCache(key, fetchFunction, options, memoryCache);
      this.pendingFetches.set(key, fetchPromise);

      try {
        const value = await fetchPromise;
        this.stats.dbHits++;
        this.recordResponseTime(Date.now() - startTime);
        return value;
      } finally {
        this.pendingFetches.delete(key);
      }

    } catch (error) {
      logger.error('Cache get error', { key, error });
      this.recordResponseTime(Date.now() - startTime);
      throw error;
    }
  }

  /**
   * Fetch from database and populate all cache layers
   */
  private async fetchAndCache<T>(
    key: string,
    fetchFunction: () => Promise<T>,
    options: CacheOptions,
    memoryCache: LRUCache<string, any> | null
  ): Promise<T> {
    const value = await fetchFunction();

    // Populate memory cache
    if (options.useMemory !== false && memoryCache && value !== null && value !== undefined) {
      memoryCache.set(key, value);
    }

    // Populate Redis cache
    if (options.useRedis !== false && this.redisEnabled && this.redis && value !== null && value !== undefined) {
      const ttl = options.ttl || 300; // Default 5 minutes
      await this.redis.setex(key, ttl, JSON.stringify(value));
    }

    return value;
  }

  /**
   * Set value in cache
   */
  async set<T>(key: string, value: T, options: CacheOptions = {}): Promise<void> {
    const cacheType = this.getCacheType(key);
    const memoryCache = this.getMemoryCacheForType(cacheType);

    // Update memory cache
    if (options.useMemory !== false && memoryCache) {
      memoryCache.set(key, value);
    }

    // Update Redis cache
    if (options.useRedis !== false && this.redisEnabled && this.redis) {
      const ttl = options.ttl || 300;
      await this.redis.setex(key, ttl, JSON.stringify(value));
    }
  }

  /**
   * Delete value from all cache layers
   */
  async delete(key: string): Promise<void> {
    const cacheType = this.getCacheType(key);
    const memoryCache = this.getMemoryCacheForType(cacheType);

    // Delete from memory
    if (memoryCache) {
      memoryCache.delete(key);
    }

    // Delete from Redis
    if (this.redisEnabled && this.redis) {
      await this.redis.del(key);
    }
  }

  /**
   * Invalidate cache by pattern
   */
  async invalidatePattern(pattern: string): Promise<void> {
    // Clear matching keys from memory caches
    const caches = [this.userCache, this.taskCache, this.sessionCache, this.referralCache];
    
    for (const cache of caches) {
      const keys = [...cache.keys()];
      const regex = new RegExp(pattern);
      
      for (const key of keys) {
        if (regex.test(key)) {
          cache.delete(key);
        }
      }
    }

    // Clear from Redis
    if (this.redisEnabled && this.redis) {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    }
  }

  /**
   * Get cache type from key
   */
  private getCacheType(key: string): 'user' | 'task' | 'session' | 'referral' | 'other' {
    if (key.startsWith('user:')) return 'user';
    if (key.startsWith('task:')) return 'task';
    if (key.startsWith('session:')) return 'session';
    if (key.startsWith('referral:')) return 'referral';
    return 'other';
  }

  /**
   * Get memory cache for specific type
   */
  private getMemoryCacheForType(type: string): LRUCache<string, any> | null {
    switch (type) {
      case 'user': return this.userCache;
      case 'task': return this.taskCache;
      case 'session': return this.sessionCache;
      case 'referral': return this.referralCache;
      default: return this.userCache; // Default to user cache
    }
  }

  /**
   * Record response time for metrics
   */
  private recordResponseTime(time: number): void {
    this.responseTimes.push(time);
    if (this.responseTimes.length > this.maxResponseTimes) {
      this.responseTimes.shift();
    }
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    setInterval(() => {
      this.updateStats();
    }, 60000); // Update every minute
  }

  /**
   * Update statistics
   */
  private updateStats(): void {
    const totalHits = this.stats.memoryHits + this.stats.redisHits;
    const totalMisses = this.stats.memoryMisses + this.stats.redisMisses + this.stats.dbHits;
    
    this.stats.hitRate = totalHits / (totalHits + totalMisses) || 0;
    this.stats.avgResponseTime = this.responseTimes.length > 0
      ? this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length
      : 0;

    logger.debug('Cache statistics', {
      hitRate: `${(this.stats.hitRate * 100).toFixed(2)}%`,
      avgResponseTime: `${this.stats.avgResponseTime.toFixed(2)}ms`,
      totalRequests: this.stats.totalRequests,
      memoryHits: this.stats.memoryHits,
      redisHits: this.stats.redisHits,
      dbHits: this.stats.dbHits,
    });
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Get cache sizes
   */
  getCacheSizes(): {
    users: number;
    tasks: number;
    sessions: number;
    referrals: number;
  } {
    return {
      users: this.userCache.size,
      tasks: this.taskCache.size,
      sessions: this.sessionCache.size,
      referrals: this.referralCache.size,
    };
  }

  /**
   * Warm up cache with frequently accessed data
   */
  async warmUp(dataFetchers: { key: string; fetcher: () => Promise<any> }[]): Promise<void> {
    logger.info('Starting cache warm-up', { count: dataFetchers.length });
    
    const promises = dataFetchers.map(({ key, fetcher }) =>
      this.get(key, fetcher, { useMemory: true, useRedis: true })
    );

    await Promise.allSettled(promises);
    logger.info('Cache warm-up completed');
  }

  /**
   * Clear all caches
   */
  async clearAll(): Promise<void> {
    this.userCache.clear();
    this.taskCache.clear();
    this.sessionCache.clear();
    this.referralCache.clear();

    if (this.redisEnabled && this.redis) {
      await this.redis.flushdb();
    }

    logger.info('All caches cleared');
  }

  /**
   * Close connections
   */
  async close(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}

// Export singleton instance
export const advancedCache = AdvancedCacheService.getInstance();
