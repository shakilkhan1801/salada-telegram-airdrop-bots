import { LRUCache } from 'lru-cache';
import { EventEmitter } from 'events';
import { logger } from '../logger';
import { storage } from '../../storage';

import { performance } from 'perf_hooks';
import crypto from 'crypto';

interface CacheConfig {
  name: string;
  maxSize: number;
  ttl: number;
  updateAgeOnGet: boolean;
  allowStale: boolean;
  staleWhileRevalidate?: number;
}

interface CacheMetrics {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  evictions: number;
  errors: number;
  avgHitTime: number;
  avgMissTime: number;
  totalMemoryUsage: number;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number;
  accessCount: number;
  lastAccessed: number;
  size: number;
  key: string;
}

interface CacheStrategy {
  level: 'memory' | 'storage';
  priority: number;
  ttl: number;
  maxSize?: number;
}

/**
 * Enhanced Multi-Level Database Cache Service
 * Provides intelligent caching with memory and storage-level caching
 */
export class EnhancedDatabaseCache extends EventEmitter {
  private static instance: EnhancedDatabaseCache;
  
  // Multi-level cache system
  private memoryCache: Map<string, LRUCache<string, CacheEntry<any>>> = new Map();

  private cacheMetrics: Map<string, CacheMetrics> = new Map();
  
  // Cache configurations for different data types
  private readonly cacheConfigs: Record<string, CacheConfig> = {
    // Ultra-fast cache for frequently accessed small data
    hot: {
      name: 'hot',
      maxSize: 500,
      ttl: 2 * 60 * 1000, // 2 minutes
      updateAgeOnGet: true,
      allowStale: false
    },
    
    // User data cache - medium size, moderate TTL
    user: {
      name: 'user',
      maxSize: 2000,
      ttl: 5 * 60 * 1000, // 5 minutes
      updateAgeOnGet: true,
      allowStale: true,
      staleWhileRevalidate: 30 * 1000 // 30 seconds
    },
    
    // Task data cache - smaller, longer TTL since tasks change less
    task: {
      name: 'task',
      maxSize: 300,
      ttl: 15 * 60 * 1000, // 15 minutes
      updateAgeOnGet: true,
      allowStale: true,
      staleWhileRevalidate: 60 * 1000 // 1 minute
    },
    
    // Security data cache - medium TTL, security-focused
    security: {
      name: 'security',
      maxSize: 1000,
      ttl: 10 * 60 * 1000, // 10 minutes
      updateAgeOnGet: false, // Don't update age on security checks
      allowStale: false // Never serve stale security data
    },
    
    // Device fingerprint cache - larger, longer TTL
    device: {
      name: 'device',
      maxSize: 3000,
      ttl: 30 * 60 * 1000, // 30 minutes
      updateAgeOnGet: true,
      allowStale: true,
      staleWhileRevalidate: 2 * 60 * 1000 // 2 minutes
    },
    
    // Query result cache - large, variable TTL
    query: {
      name: 'query',
      maxSize: 1000,
      ttl: 5 * 60 * 1000, // 5 minutes
      updateAgeOnGet: true,
      allowStale: true,
      staleWhileRevalidate: 60 * 1000 // 1 minute
    }
  };

  // Cache strategies for different operations
  private readonly cacheStrategies: Record<string, CacheStrategy[]> = {
    // Hot data - memory only with very fast access
    getUserById: [
      { level: 'memory', priority: 1, ttl: 5 * 60 * 1000 }
    ],
    
    // User search - memory for performance
    getUserByUsername: [
      { level: 'memory', priority: 1, ttl: 5 * 60 * 1000 }
    ],
    
    // Tasks - memory with longer TTL
    getAllTasks: [
      { level: 'memory', priority: 1, ttl: 10 * 60 * 1000 }
    ],
    
    // Security events - memory only for fast access, short TTL
    getSecurityEvents: [
      { level: 'memory', priority: 1, ttl: 5 * 60 * 1000 }
    ],
    
    // Device fingerprints - all levels for reliability
    getDeviceFingerprints: [
      { level: 'memory', priority: 1, ttl: 10 * 60 * 1000 },
      { level: 'storage', priority: 2, ttl: 60 * 60 * 1000 }
    ]
  };

  private constructor() {
    super();
    this.initializeCaches();
    this.startCacheMonitoring();
  }

  public static getInstance(): EnhancedDatabaseCache {
    if (!EnhancedDatabaseCache.instance) {
      EnhancedDatabaseCache.instance = new EnhancedDatabaseCache();
    }
    return EnhancedDatabaseCache.instance;
  }

  private initializeCaches(): void {
    // Initialize memory caches
    for (const [name, config] of Object.entries(this.cacheConfigs)) {
      const cache = new LRUCache<string, CacheEntry<any>>({
        max: config.maxSize,
        ttl: config.ttl,
        updateAgeOnGet: config.updateAgeOnGet,
        allowStale: config.allowStale,
        // staleWhileRevalidate is not supported by the installed lru-cache typings; omit to satisfy types
        dispose: (value: CacheEntry<any>, key: string) => {
          this.recordMetric(name, 'eviction');
          this.emit('cacheEviction', { cache: name, key, size: value.size });
        }
      } as any);
      
      this.memoryCache.set(name, cache);
      
      // Initialize metrics
      this.cacheMetrics.set(name, {
        hits: 0,
        misses: 0,
        sets: 0,
        deletes: 0,
        evictions: 0,
        errors: 0,
        avgHitTime: 0,
        avgMissTime: 0,
        totalMemoryUsage: 0
      });
    }
    

    
    logger.info('Enhanced database cache system initialized');
  }



  /**
   * Get value from cache with multi-level fallback
   */
  async get<T>(cacheType: string, key: string, operation?: string): Promise<T | null> {
    const startTime = performance.now();
    const fullKey = this.generateCacheKey(cacheType, key);
    
    try {
      // Determine cache strategy
      const strategies = operation ? this.cacheStrategies[operation] : [
        { level: 'memory' as const, priority: 1, ttl: this.cacheConfigs[cacheType]?.ttl || 300000 }
      ];
      
      // Try each cache level in priority order
      for (const strategy of strategies.sort((a, b) => a.priority - b.priority)) {
        const result = await this.getFromCacheLevel<T>(cacheType, fullKey, strategy.level);
        
        if (result !== null) {
          // Found in cache - update metrics and return
          const duration = performance.now() - startTime;
          this.recordMetric(cacheType, 'hit', duration);
          
          // Promote to higher cache levels if found in lower level
          if (strategy.priority > 1) {
            await this.promoteToHigherLevels(cacheType, fullKey, result, strategies, strategy.priority);
          }
          
          return result;
        }
      }
      
      // Cache miss
      const duration = performance.now() - startTime;
      this.recordMetric(cacheType, 'miss', duration);
      return null;
      
    } catch (error: any) {
      this.recordMetric(cacheType, 'error');
      logger.error(`Cache get error for ${cacheType}:${key}:`, error);
      return null;
    }
  }

  /**
   * Set value in cache with multi-level distribution
   */
  async set<T>(cacheType: string, key: string, value: T, operation?: string, customTTL?: number): Promise<boolean> {
    const fullKey = this.generateCacheKey(cacheType, key);
    const dataSize = this.calculateDataSize(value);
    
    try {
      // Determine cache strategy
      const strategies = operation ? this.cacheStrategies[operation] : [
        { level: 'memory' as const, priority: 1, ttl: customTTL || this.cacheConfigs[cacheType]?.ttl || 300000 }
      ];
      
      let success = false;
      
      // Set in all appropriate cache levels
      for (const strategy of strategies) {
        const levelSuccess = await this.setInCacheLevel(
          cacheType,
          fullKey,
          value,
          strategy.level,
          strategy.ttl,
          dataSize
        );
        
        if (levelSuccess) {
          success = true;
        }
      }
      
      if (success) {
        this.recordMetric(cacheType, 'set');
      }
      
      return success;
      
    } catch (error: any) {
      this.recordMetric(cacheType, 'error');
      logger.error(`Cache set error for ${cacheType}:${key}:`, error);
      return false;
    }
  }

  /**
   * Delete from all cache levels
   */
  async delete(cacheType: string, key: string): Promise<boolean> {
    const fullKey = this.generateCacheKey(cacheType, key);
    let success = false;
    
    try {
      // Delete from memory cache
      const memoryCache = this.memoryCache.get(cacheType);
      if (memoryCache && memoryCache.has(fullKey)) {
        memoryCache.delete(fullKey);
        success = true;
      }
      

      
      if (success) {
        this.recordMetric(cacheType, 'delete');
      }
      
      return success;
      
    } catch (error: any) {
      this.recordMetric(cacheType, 'error');
      logger.error(`Cache delete error for ${cacheType}:${key}:`, error);
      return false;
    }
  }

  /**
   * Clear specific cache type
   */
  clear(cacheType: string): void {
    try {
      const memoryCache = this.memoryCache.get(cacheType);
      if (memoryCache) {
        memoryCache.clear();
        logger.info(`Cleared ${cacheType} cache`);
      }
      
      // Clear metrics
      const metrics = this.cacheMetrics.get(cacheType);
      if (metrics) {
        Object.keys(metrics).forEach(key => {
          (metrics as any)[key] = 0;
        });
      }
      
    } catch (error) {
      logger.error(`Error clearing ${cacheType} cache:`, error);
    }
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    for (const cacheType of this.memoryCache.keys()) {
      this.clear(cacheType);
    }
    logger.info('All caches cleared');
  }

  private async getFromCacheLevel<T>(cacheType: string, key: string, level: 'memory' | 'storage'): Promise<T | null> {
    switch (level) {
      case 'memory':
        const memoryCache = this.memoryCache.get(cacheType);
        if (memoryCache) {
          const entry = memoryCache.get(key);
          if (entry) {
            entry.accessCount++;
            entry.lastAccessed = Date.now();
            return entry.data;
          }
        }
        return null;
        

        
      case 'storage':
        // Storage-level caching would be implemented here
        // For now, return null as this is a complex implementation
        return null;
        
      default:
        return null;
    }
  }

  private async setInCacheLevel<T>(
    cacheType: string,
    key: string,
    value: T,
    level: 'memory' | 'storage',
    ttl: number,
    dataSize: number
  ): Promise<boolean> {
    const timestamp = Date.now();
    
    switch (level) {
      case 'memory':
        const memoryCache = this.memoryCache.get(cacheType);
        if (memoryCache) {
          const entry: CacheEntry<T> = {
            data: value,
            timestamp,
            ttl,
            accessCount: 0,
            lastAccessed: timestamp,
            size: dataSize,
            key
          };
          memoryCache.set(key, entry);
          return true;
        }
        return false;
        

        
      case 'storage':
        // Storage-level caching implementation
        return false;
        
      default:
        return false;
    }
  }

  private async promoteToHigherLevels<T>(
    cacheType: string,
    key: string,
    value: T,
    strategies: CacheStrategy[],
    currentPriority: number
  ): Promise<void> {
    const higherLevelStrategies = strategies.filter(s => s.priority < currentPriority);
    
    for (const strategy of higherLevelStrategies) {
      await this.setInCacheLevel(
        cacheType,
        key,
        value,
        strategy.level,
        strategy.ttl,
        this.calculateDataSize(value)
      );
    }
  }

  private generateCacheKey(cacheType: string, key: string): string {
    // Generate deterministic cache key with namespace
    const namespace = `db_cache:${cacheType}`;
    const hash = crypto.createHash('sha256').update(key).digest('hex').substring(0, 16);
    return `${namespace}:${hash}:${key}`;
  }

  private calculateDataSize(data: any): number {
    try {
      return JSON.stringify(data).length;
    } catch {
      return 0;
    }
  }

  private recordMetric(cacheType: string, metricType: 'hit' | 'miss' | 'set' | 'delete' | 'eviction' | 'error', duration?: number): void {
    const metrics = this.cacheMetrics.get(cacheType);
    if (!metrics) return;
    
    switch (metricType) {
      case 'hit':
        metrics.hits++;
        if (duration) {
          metrics.avgHitTime = (metrics.avgHitTime + duration) / 2;
        }
        break;
      case 'miss':
        metrics.misses++;
        if (duration) {
          metrics.avgMissTime = (metrics.avgMissTime + duration) / 2;
        }
        break;
      case 'set':
        metrics.sets++;
        break;
      case 'delete':
        metrics.deletes++;
        break;
      case 'eviction':
        metrics.evictions++;
        break;
      case 'error':
        metrics.errors++;
        break;
    }
  }

  private startCacheMonitoring(): void {
    // Monitor cache performance every minute
    setInterval(() => {
      this.generateCacheReport();
    }, 60 * 1000);

    // Cleanup stale data every 5 minutes
    setInterval(() => {
      this.cleanupStaleData();
    }, 5 * 60 * 1000);

    logger.info('Cache monitoring started');
  }

  private generateCacheReport(): void {
    const report: any = {
      timestamp: new Date().toISOString(),
      caches: {}
    };

    let totalHits = 0;
    let totalMisses = 0;
    let totalMemoryUsage = 0;

    for (const [cacheType, metrics] of this.cacheMetrics.entries()) {
      const cache = this.memoryCache.get(cacheType);
      const size = cache ? cache.size : 0;
      const hitRate = (metrics.hits + metrics.misses) > 0 
        ? (metrics.hits / (metrics.hits + metrics.misses) * 100).toFixed(2) + '%'
        : '0%';

      report.caches[cacheType] = {
        size,
        hitRate,
        hits: metrics.hits,
        misses: metrics.misses,
        evictions: metrics.evictions,
        errors: metrics.errors,
        avgHitTime: metrics.avgHitTime.toFixed(2) + 'ms',
        avgMissTime: metrics.avgMissTime.toFixed(2) + 'ms'
      };

      totalHits += metrics.hits;
      totalMisses += metrics.misses;
      totalMemoryUsage += metrics.totalMemoryUsage;
    }

    report.overall = {
      totalHitRate: totalHits + totalMisses > 0 
        ? (totalHits / (totalHits + totalMisses) * 100).toFixed(2) + '%'
        : '0%',
      totalMemoryUsage: `${(totalMemoryUsage / 1024 / 1024).toFixed(2)} MB`
    };

    logger.debug('Cache Performance Report', report);
    this.emit('cacheReport', report);
  }

  private cleanupStaleData(): void {
    for (const [cacheType, cache] of this.memoryCache.entries()) {
      let cleanedCount = 0;
      const now = Date.now();

      // Clean entries that are significantly past their TTL
      for (const [key, entry] of cache.entries()) {
        if (now - entry.timestamp > entry.ttl * 2) {
          cache.delete(key);
          cleanedCount++;
        }
      }

      if (cleanedCount > 0) {
        logger.debug(`Cleaned ${cleanedCount} stale entries from ${cacheType} cache`);
      }
    }
  }

  /**
   * Get comprehensive cache statistics
   */
  getCacheStatistics(): any {
    const stats: any = {
      timestamp: new Date().toISOString(),
      caches: {},
      overall: {
        totalHits: 0,
        totalMisses: 0,
        totalSets: 0,
        totalDeletes: 0,
        totalEvictions: 0,
        totalErrors: 0
      }
    };

    for (const [cacheType, metrics] of this.cacheMetrics.entries()) {
      const cache = this.memoryCache.get(cacheType);
      const config = this.cacheConfigs[cacheType];

      stats.caches[cacheType] = {
        config: {
          maxSize: config?.maxSize || 0,
          ttl: config?.ttl || 0,
          name: config?.name || cacheType
        },
        metrics: { ...metrics },
        currentSize: cache ? cache.size : 0,
        hitRate: (metrics.hits + metrics.misses) > 0 
          ? ((metrics.hits / (metrics.hits + metrics.misses)) * 100)
          : 0,
        utilizationRate: config ? ((cache?.size || 0) / config.maxSize * 100) : 0
      };

      // Add to overall stats
      stats.overall.totalHits += metrics.hits;
      stats.overall.totalMisses += metrics.misses;
      stats.overall.totalSets += metrics.sets;
      stats.overall.totalDeletes += metrics.deletes;
      stats.overall.totalEvictions += metrics.evictions;
      stats.overall.totalErrors += metrics.errors;
    }

    // Calculate overall hit rate
    stats.overall.overallHitRate = stats.overall.totalHits + stats.overall.totalMisses > 0
      ? (stats.overall.totalHits / (stats.overall.totalHits + stats.overall.totalMisses) * 100)
      : 0;

    return stats;
  }

  /**
   * Optimize cache configurations based on usage patterns
   */
  optimizeCacheConfigurations(): void {
    for (const [cacheType, metrics] of this.cacheMetrics.entries()) {
      const cache = this.memoryCache.get(cacheType);
      const config = this.cacheConfigs[cacheType];
      
      if (!cache || !config) continue;

      // If hit rate is very low, consider reducing cache size
      const hitRate = (metrics.hits + metrics.misses) > 0 
        ? (metrics.hits / (metrics.hits + metrics.misses))
        : 0;

      if (hitRate < 0.2 && config.maxSize > 100) {
        logger.info(`Low hit rate for ${cacheType} cache (${(hitRate * 100).toFixed(1)}%), consider reducing size`);
      }

      // If cache is always full and evicting frequently, consider increasing size
      if (cache.size >= config.maxSize * 0.9 && metrics.evictions > metrics.sets * 0.3) {
        logger.info(`High eviction rate for ${cacheType} cache, consider increasing size`);
      }
    }
  }

  /**
   * Warm up caches with frequently accessed data
   */
  async warmUp(): Promise<void> {
    logger.info('Starting cache warm-up...');
    
    try {
      // Warm up task cache since tasks don't change often
      // This would integrate with actual storage operations
      
      logger.info('Cache warm-up completed');
    } catch (error) {
      logger.error('Cache warm-up failed:', error);
    }
  }
}

// Export singleton instance
export const enhancedDbCache = EnhancedDatabaseCache.getInstance();