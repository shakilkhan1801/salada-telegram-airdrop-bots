import { Logger } from './logger';
import { LRUCache } from 'lru-cache';
import * as os from 'os';

/**
 * Configuration options for the MemoryManager.
 * Controls monitoring intervals, thresholds, and feature enablement.
 */
export interface MemoryManagerConfig {
  enableMonitoring: boolean;
  monitoringInterval: number; // ms
  memoryThreshold: number; // MB
  enableLRUCaches: boolean;
  defaultCacheSize: number;
  enableIntervalCleanup: boolean;
  enableGarbageCollection: boolean;
  alertThresholds: {
    warning: number; // MB
    critical: number; // MB
  };
}

/**
 * Memory statistics interface providing comprehensive system memory information.
 * All memory values are in megabytes (MB).
 */
export interface MemoryStats {
  heapUsed: number;
  heapTotal: number;
  external: number;
  rss: number;
  freeMemory: number;
  totalMemory: number;
  cpuUsage: NodeJS.CpuUsage;
  timestamp: Date;
}

/**
 * Interface for intervals managed by the MemoryManager.
 * Provides automatic cleanup and error handling.
 */
export interface ManagedInterval {
  id: string;
  timer: NodeJS.Timeout;
  description: string;
  createdAt: Date;
  lastRun?: Date;
}

/**
 * Interface for LRU caches managed by the MemoryManager.
 * Extends standard LRUCache with management metadata.
 * 
 * @template K - Cache key type
 * @template V - Cache value type
 */
export interface ManagedCache<K extends keyof any, V extends {}> extends LRUCache<K, V> {
  id: string;
  description: string;
  createdAt: Date;
}

/**
 * Memory management service providing LRU caches, interval management,
 * memory monitoring, and automatic cleanup capabilities.
 * 
 * Implements singleton pattern to ensure consistent memory management
 * across the entire application.
 * 
 * @example
 * ```typescript
 * const memoryManager = MemoryManager.getInstance();
 * await memoryManager.initialize({
 *   enableMonitoring: true,
 *   alertThresholds: { warning: 256, critical: 400 }
 * });
 * 
 * const cache = memoryManager.createCache('user-cache', 'User data cache', { max: 1000 });
 * cache.set('user123', userData);
 * ```
 */
export class MemoryManager {
  private static instance: MemoryManager;
  private readonly logger = Logger.getInstance();
  private config: MemoryManagerConfig = {
    enableMonitoring: true,
    monitoringInterval: 60000, // 1 minute
    memoryThreshold: 512, // 512MB
    enableLRUCaches: true,
    defaultCacheSize: 1000,
    enableIntervalCleanup: true,
    enableGarbageCollection: true,
    alertThresholds: {
      warning: 256, // 256MB
      critical: 400  // 400MB
    }
  };

  private monitoringInterval?: NodeJS.Timeout;
  private managedIntervals = new Map<string, ManagedInterval>();
  private managedCaches = new Map<string, ManagedCache<any, any>>();
  private memoryHistory: MemoryStats[] = [];
  private readonly MAX_HISTORY = 100;
  private cleanupHandlersAttached = false;

  private constructor() {}

  /**
   * Gets the singleton MemoryManager instance.
   * 
   * @returns {MemoryManager} The singleton MemoryManager instance
   * 
   * @example
   * ```typescript
   * const memoryManager = MemoryManager.getInstance();
   * ```
   */
  static getInstance(): MemoryManager {
    if (!MemoryManager.instance) {
      MemoryManager.instance = new MemoryManager();
    }
    return MemoryManager.instance;
  }

  /**
   * Initializes the memory manager with the specified configuration.
   * Sets up monitoring, cleanup handlers, and internal services.
   * 
   * @param {Partial<MemoryManagerConfig>} [config] - Optional configuration overrides
   * @returns {Promise<void>} Promise that resolves when initialization is complete
   * 
   * @example
   * ```typescript
   * await memoryManager.initialize({
   *   enableMonitoring: true,
   *   monitoringInterval: 60000,
   *   alertThresholds: { warning: 256, critical: 400 }
   * });
   * ```
   */
  async initialize(config?: Partial<MemoryManagerConfig>): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...config };
    }

    if (this.config.enableMonitoring) {
      this.startMonitoring();
    }

    // Set up cleanup on process exit
    this.setupCleanupHandlers();

    this.logger.info('✅ Memory manager initialized', {
      enableMonitoring: this.config.enableMonitoring,
      memoryThreshold: this.config.memoryThreshold,
      enableLRUCaches: this.config.enableLRUCaches
    });
  }

  /**
   * Creates a managed LRU cache with automatic cleanup and monitoring.
   * The cache will be automatically cleaned up when the manager stops.
   * 
   * @template K - Cache key type
   * @template V - Cache value type
   * @param {string} id - Unique identifier for the cache
   * @param {string} description - Human-readable description
   * @param {object} [options] - Cache configuration options
   * @param {number} [options.max] - Maximum number of items in cache
   * @param {number} [options.ttl] - Time to live for cache entries (ms)
   * @param {boolean} [options.allowStale] - Allow returning stale values
   * @returns {ManagedCache<K, V>} The created managed cache instance
   * @throws {Error} If a cache with the same ID already exists
   * 
   * @example
   * ```typescript
   * const userCache = memoryManager.createCache<string, User>(
   *   'users',
   *   'User data cache',
   *   { max: 1000, ttl: 300000 } // 5 minute TTL
   * );
   * userCache.set('user123', userData);
   * ```
   */
createCache<K extends keyof any, V extends {}>(
    id: string,
    description: string,
    options?: {
      max?: number;
      ttl?: number;
      allowStale?: boolean;
    }
  ): ManagedCache<K, V> {
    if (this.managedCaches.has(id)) {
      throw new Error(`Cache with id '${id}' already exists`);
    }

    return this.getOrCreateCache(id, description, options);
  }

getOrCreateCache<K extends keyof any, V extends {}>(
    id: string,
    description: string,
    options?: {
      max?: number;
      ttl?: number;
      allowStale?: boolean;
    }
  ): ManagedCache<K, V> {
    if (this.managedCaches.has(id)) {
      return this.managedCaches.get(id) as ManagedCache<K, V>;
    }

    const requestedMax = options?.max;
    const max = typeof requestedMax === 'number' && requestedMax >= 0 ? requestedMax : this.config.defaultCacheSize;

    const cache = new LRUCache<K, V>({
      max,
      ttl: options?.ttl,
      allowStale: options?.allowStale || false
    }) as ManagedCache<K, V>;

    cache.id = id;
    cache.description = description;
    cache.createdAt = new Date();

    this.managedCaches.set(id, cache);

    this.logger.debug(`✅ Created managed cache: ${id} (${description})`);
    return cache;
  }

  /**
   * Creates a managed interval with automatic cleanup and error handling.
   * The interval will be automatically cleared when the manager stops.
   * 
   * @param {string} id - Unique identifier for the interval
   * @param {string} description - Human-readable description
   * @param {() => void | Promise<void>} callback - Function to execute on interval
   * @param {number} intervalMs - Interval duration in milliseconds
   * @returns {string} The interval ID for later reference
   * @throws {Error} If an interval with the same ID already exists
   * 
   * @example
   * ```typescript
   * const intervalId = memoryManager.createManagedInterval(
   *   'user-cleanup',
   *   'Clean up inactive users',
   *   async () => { await cleanupInactiveUsers(); },
   *   300000 // 5 minutes
   * );
   * ```
   */
  createManagedInterval(
    id: string,
    description: string,
    callback: () => void | Promise<void>,
    intervalMs: number
  ): string {
    if (this.managedIntervals.has(id)) {
      throw new Error(`Interval with id '${id}' already exists`);
    }

    return this.getOrCreateManagedInterval(id, description, callback, intervalMs);
  }

  getOrCreateManagedInterval(
    id: string,
    description: string,
    callback: () => void | Promise<void>,
    intervalMs: number
  ): string {
    if (this.managedIntervals.has(id)) {
      return id; // Return the existing interval ID
    }

    const wrappedCallback = async () => {
      try {
        const managedInterval = this.managedIntervals.get(id);
        if (managedInterval) {
          managedInterval.lastRun = new Date();
        }
        await callback();
      } catch (error) {
        this.logger.error(`Error in managed interval '${id}':`, error);
      }
    };

    const timer = setInterval(wrappedCallback, intervalMs);
    
    const managedInterval: ManagedInterval = {
      id,
      timer,
      description,
      createdAt: new Date()
    };

    this.managedIntervals.set(id, managedInterval);
    this.logger.debug(`✅ Created managed interval: ${id} (${description}, ${intervalMs}ms)`);
    
    return id;
  }

  /**
   * Clears a managed interval by its ID.
   * 
   * @param {string} id - The interval ID to clear
   * @returns {boolean} True if interval was found and cleared, false otherwise
   * 
   * @example
   * ```typescript
   * const success = memoryManager.clearManagedInterval('user-cleanup');
   * if (success) {
   *   console.log('Interval cleared successfully');
   * }
   * ```
   */
  clearManagedInterval(id: string): boolean {
    const managedInterval = this.managedIntervals.get(id);
    if (!managedInterval) {
      return false;
    }

    clearInterval(managedInterval.timer);
    this.managedIntervals.delete(id);
    this.logger.debug(`🗑️ Cleared managed interval: ${id}`);
    
    return true;
  }

  /**
   * Clears a managed cache by its ID and removes it from management.
   * 
   * @param {string} id - The cache ID to clear
   * @returns {boolean} True if cache was found and cleared, false otherwise
   * 
   * @example
   * ```typescript
   * const success = memoryManager.clearManagedCache('user-cache');
   * if (success) {
   *   console.log('Cache cleared successfully');
   * }
   * ```
   */
  clearManagedCache(id: string): boolean {
    const cache = this.managedCaches.get(id);
    if (!cache) {
      return false;
    }

    cache.clear();
    this.managedCaches.delete(id);
    this.logger.debug(`🗑️ Cleared managed cache: ${id}`);
    
    return true;
  }

  /**
   * Gets current system memory statistics.
   * All values are converted to megabytes for easy reading.
   * 
   * @returns {MemoryStats} Current memory usage statistics
   * 
   * @example
   * ```typescript
   * const stats = memoryManager.getMemoryStats();
   * console.log(`Heap used: ${stats.heapUsed}MB`);
   * console.log(`RSS: ${stats.rss}MB`);
   * ```
   */
  getMemoryStats(): MemoryStats {
    const memoryUsage = process.memoryUsage();
    const freeMemory = os.freemem();
    const totalMemory = os.totalmem();
    const cpuUsage = process.cpuUsage();

    return {
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
      external: Math.round(memoryUsage.external / 1024 / 1024),
      rss: Math.round(memoryUsage.rss / 1024 / 1024),
      freeMemory: Math.round(freeMemory / 1024 / 1024),
      totalMemory: Math.round(totalMemory / 1024 / 1024),
      cpuUsage,
      timestamp: new Date()
    };
  }

  /**
   * Analyzes memory usage trends based on historical data.
   * Provides current stats, averages, peaks, and trend direction.
   * 
   * @returns {object} Memory trend analysis including current, average, peak, and trend
   * @returns {MemoryStats} returns.current - Current memory statistics
   * @returns {Partial<MemoryStats>} returns.average - Average memory usage over recent readings
   * @returns {Partial<MemoryStats>} returns.peak - Peak memory usage in history
   * @returns {'increasing' | 'decreasing' | 'stable'} returns.trend - Memory usage trend
   * 
   * @example
   * ```typescript
   * const trends = memoryManager.getMemoryTrends();
   * console.log(`Current: ${trends.current.heapUsed}MB`);
   * console.log(`Trend: ${trends.trend}`);
   * ```
   */
  getMemoryTrends(): {
    current: MemoryStats;
    average: Partial<MemoryStats>;
    peak: Partial<MemoryStats>;
    trend: 'increasing' | 'decreasing' | 'stable';
  } {
    const current = this.getMemoryStats();
    
    if (this.memoryHistory.length === 0) {
      return {
        current,
        average: current,
        peak: current,
        trend: 'stable'
      };
    }

    const recentHistory = this.memoryHistory.slice(-10); // Last 10 readings
    
    const average = {
      heapUsed: Math.round(recentHistory.reduce((sum, stat) => sum + stat.heapUsed, 0) / recentHistory.length),
      rss: Math.round(recentHistory.reduce((sum, stat) => sum + stat.rss, 0) / recentHistory.length)
    };

    const peak = {
      heapUsed: Math.max(...this.memoryHistory.map(stat => stat.heapUsed)),
      rss: Math.max(...this.memoryHistory.map(stat => stat.rss))
    };

    // Determine trend based on last few readings
    const trend = this.calculateMemoryTrend(recentHistory);

    return { current, average, peak, trend };
  }

  /**
   * Forces garbage collection if enabled and available.
   * Requires Node.js to be started with --expose-gc flag.
   * 
   * @returns {boolean} True if garbage collection was forced, false otherwise
   * 
   * @example
   * ```typescript
   * const gcForced = memoryManager.forceGarbageCollection();
   * if (gcForced) {
   *   console.log('Garbage collection completed');
   * }
   * ```
   */
  forceGarbageCollection(): boolean {
    if (this.config.enableGarbageCollection && global.gc) {
      try {
        global.gc();
        this.logger.debug('🗑️ Forced garbage collection');
        return true;
      } catch (error) {
        this.logger.warn('Failed to force garbage collection:', error);
        return false;
      }
    }
    return false;
  }

  /**
   * Performs comprehensive memory cleanup operations.
   * Cleans stale cache entries, forces garbage collection, and reports results.
   * 
   * @async
   * @returns {Promise<object>} Cleanup results
   * @returns {Promise<number>} returns.cachesCleaned - Number of caches that were cleaned
   * @returns {Promise<number>} returns.memoryFreed - Amount of memory freed in MB
   * @returns {Promise<boolean>} returns.gcForced - Whether garbage collection was forced
   * 
   * @example
   * ```typescript
   * const result = await memoryManager.performCleanup();
   * console.log(`Cleaned ${result.cachesCleaned} caches, freed ${result.memoryFreed}MB`);
   * ```
   */
  async performCleanup(): Promise<{
    cachesCleaned: number;
    memoryFreed: number;
    gcForced: boolean;
  }> {
    const beforeStats = this.getMemoryStats();
    let cachesCleaned = 0;

    // Clean up caches that exceed their TTL or are too large
    for (const [id, cache] of this.managedCaches) {
      const sizeBefore = cache.size;
      cache.purgeStale(); // Remove expired entries
      
      if (cache.size < sizeBefore) {
        cachesCleaned++;
        this.logger.debug(`🧹 Cleaned cache ${id}: ${sizeBefore} -> ${cache.size} items`);
      }
    }

    // Force garbage collection
    const gcForced = this.forceGarbageCollection();

    const afterStats = this.getMemoryStats();
    const memoryFreed = beforeStats.heapUsed - afterStats.heapUsed;

    this.logger.info('🧹 Memory cleanup completed', {
      cachesCleaned,
      memoryFreed: `${memoryFreed}MB`,
      gcForced
    });

    return { cachesCleaned, memoryFreed, gcForced };
  }

  /**
   * Gets the current status of all managed resources.
   * Provides comprehensive overview of intervals, caches, and memory stats.
   * 
   * @returns {object} Status of all managed resources
   * @returns {Array} returns.intervals - List of managed intervals with metadata
   * @returns {Array} returns.caches - List of managed caches with sizes and limits
   * @returns {MemoryStats} returns.memoryStats - Current memory statistics
   * 
   * @example
   * ```typescript
   * const status = memoryManager.getResourcesStatus();
   * console.log(`Managing ${status.intervals.length} intervals and ${status.caches.length} caches`);
   * ```
   */
  getResourcesStatus(): {
    intervals: Array<{
      id: string;
      description: string;
      createdAt: Date;
      lastRun?: Date;
    }>;
    caches: Array<{
      id: string;
      description: string;
      size: number;
      max: number;
      createdAt: Date;
    }>;
    memoryStats: MemoryStats;
  } {
    const intervals = Array.from(this.managedIntervals.values()).map(interval => ({
      id: interval.id,
      description: interval.description,
      createdAt: interval.createdAt,
      lastRun: interval.lastRun
    }));

    const caches = Array.from(this.managedCaches.values()).map(cache => ({
      id: cache.id,
      description: cache.description,
      size: cache.size,
      max: cache.max,
      createdAt: cache.createdAt
    }));

    return {
      intervals,
      caches,
      memoryStats: this.getMemoryStats()
    };
  }

  /**
   * Stops all managed resources and performs cleanup.
   * Clears all intervals, caches, and stops monitoring.
   * 
   * @async
   * @returns {Promise<void>} Promise that resolves when cleanup is complete
   * 
   * @example
   * ```typescript
   * await memoryManager.stop();
   * console.log('Memory manager stopped and cleaned up');
   * ```
   */
  async stop(): Promise<void> {
    // Stop monitoring
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
    }

    // Clear all managed intervals
    const intervalIds = Array.from(this.managedIntervals.keys());
    for (const id of intervalIds) {
      this.clearManagedInterval(id);
    }

    // Clear all managed caches
    const cacheIds = Array.from(this.managedCaches.keys());
    for (const id of cacheIds) {
      this.clearManagedCache(id);
    }

    this.logger.info('✅ Memory manager stopped and cleaned up');
  }

  /**
   * Start memory monitoring
   */
  private startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      const stats = this.getMemoryStats();
      
      // Add to history
      this.memoryHistory.push(stats);
      if (this.memoryHistory.length > this.MAX_HISTORY) {
        this.memoryHistory.shift();
      }

      // Check thresholds
      if (stats.heapUsed > this.config.alertThresholds.critical) {
        this.logger.warn('🚨 Critical memory usage detected', {
          heapUsed: `${stats.heapUsed}MB`,
          threshold: `${this.config.alertThresholds.critical}MB`,
          rss: `${stats.rss}MB`
        });
        
        // Auto-cleanup on critical memory usage
        this.performCleanup().catch(error => {
          this.logger.error('Auto-cleanup failed:', error);
        });
        
      } else if (stats.heapUsed > this.config.alertThresholds.warning) {
        this.logger.warn('⚠️ High memory usage detected', {
          heapUsed: `${stats.heapUsed}MB`,
          threshold: `${this.config.alertThresholds.warning}MB`
        });
      }

    }, this.config.monitoringInterval);

    this.logger.info(`✅ Memory monitoring started (${this.config.monitoringInterval}ms interval)`);
  }

  /**
   * Setup cleanup handlers for graceful shutdown
   */
  private setupCleanupHandlers(): void {
    if (this.cleanupHandlersAttached) return;

    const cleanup = async (signal: string) => {
      this.logger.info(`🧹 Memory manager cleanup triggered by ${signal}`);
      await this.stop();
    };

    process.on('SIGTERM', () => cleanup('SIGTERM'));
    process.on('SIGINT', () => cleanup('SIGINT'));
    process.on('SIGUSR2', () => cleanup('SIGUSR2')); // nodemon restart

    this.cleanupHandlersAttached = true;
  }

  /**
   * Calculate memory trend from historical data
   */
  private calculateMemoryTrend(history: MemoryStats[]): 'increasing' | 'decreasing' | 'stable' {
    if (history.length < 3) {
      return 'stable';
    }

    const recent = history.slice(-3);
    const increases = recent.reduce((count, stat, index) => {
      if (index > 0 && stat.heapUsed > recent[index - 1].heapUsed) {
        return count + 1;
      }
      return count;
    }, 0);

    if (increases >= 2) return 'increasing';
    if (increases === 0) return 'decreasing';
    return 'stable';
  }

  /**
   * Replaces an existing unbounded Map with a managed LRU cache.
   * Transfers existing data up to the specified max size and clears the original map.
   * 
   * @template K - Map/Cache key type
   * @template V - Map/Cache value type
   * @param {Map<K, V>} existingMap - The unbounded Map to replace
   * @param {string} id - Unique identifier for the new cache
   * @param {string} description - Human-readable description
   * @param {number} [maxSize=1000] - Maximum size for the new cache
   * @returns {ManagedCache<K, V>} The new managed cache with transferred data
   * 
   * @example
   * ```typescript
   * const oldMap = new Map<string, User>();
   * // ... populate oldMap ...
   * 
   * const newCache = memoryManager.replaceBoundedMap(
   *   oldMap,
   *   'user-cache',
   *   'Migrated user cache',
   *   1000
   * );
   * ```
   */
replaceBoundedMap<K extends keyof any, V extends {}>(
    existingMap: Map<K, V>,
    id: string,
    description: string,
    maxSize: number = 1000
  ): ManagedCache<K, V> {
    const cache = this.createCache<K, V>(id, description, { max: maxSize });
    
    // Transfer existing data (up to max size)
    let transferred = 0;
    for (const [key, value] of existingMap) {
      if (transferred >= maxSize) break;
      cache.set(key, value);
      transferred++;
    }

    existingMap.clear();
    
    this.logger.info(`🔄 Replaced unbounded Map with LRU cache: ${id} (${transferred} items transferred)`);
    return cache;
  }
}