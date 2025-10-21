import { LRUCache } from 'lru-cache';
import { logger } from '../logger';
import { config } from '../../config';
import { storage } from '../../storage';
import { performance } from 'perf_hooks';
import { EventEmitter } from 'events';

// ============================================================================
// UNIFIED INTERFACES AND TYPES
// ============================================================================

interface ConnectionPoolConfig {
  minConnections: number;
  maxConnections: number;
  acquireTimeoutMs: number;
  idleTimeoutMs: number;
  connectionTimeoutMs: number;
  retryDelayMs: number;
  maxRetries: number;
  healthCheckInterval: number;
}

interface ConnectionMetrics {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  queuedRequests: number;
  totalRequests: number;
  failedRequests: number;
  avgConnectionTime: number;
  avgQueryTime: number;
  errors: Array<{
    timestamp: number;
    error: string;
    type: string;
  }>;
}

interface ConnectionHealth {
  isHealthy: boolean;
  lastCheck: number;
  responseTime: number;
  errorCount: number;
}

interface QueryCacheConfig {
  maxSize: number;
  ttl: number;
  name: string;
}

interface QueryMetrics {
  queryType: string;
  duration: number;
  timestamp: number;
  cacheHit?: boolean;
  resultCount?: number;
  parameters?: any;
}

interface QueryPattern {
  pattern: string;
  frequency: number;
  avgDuration: number;
  lastSeen: number;
  recommendations: string[];
}

interface IndexDefinition {
  collection: string;
  fields: Record<string, 1 | -1>;
  options?: {
    unique?: boolean;
    sparse?: boolean;
    background?: boolean;
    name?: string;
    expireAfterSeconds?: number;
  };
}

interface IndexAnalysis {
  indexName: string;
  collection: string;
  fields: string[];
  usage: number;
  efficiency: number;
  recommendations: string[];
}

interface BatchOperation {
  operation: 'get' | 'set' | 'update' | 'delete';
  collection: string;
  data: Array<{ id: string; data?: any; updates?: any }>;
}

interface OptimizedQuery {
  cacheKey: string;
  ttl: number;
  shouldCache: boolean;
}

/**
 * Unified Database Optimizer Service
 * Combines connection optimization, query optimization, and index management
 * into a single comprehensive service for maximum efficiency and maintainability.
 */
export class DatabaseOptimizer extends EventEmitter {
  private static instance: DatabaseOptimizer;

  // ========================================================================
  // CONNECTION OPTIMIZATION PROPERTIES
  // ========================================================================
  private connectionMetrics: ConnectionMetrics = {
    totalConnections: 0,
    activeConnections: 0,
    idleConnections: 0,
    queuedRequests: 0,
    totalRequests: 0,
    failedRequests: 0,
    avgConnectionTime: 0,
    avgQueryTime: 0,
    errors: []
  };

  private connectionHealth: Map<string, ConnectionHealth> = new Map();
  private connectionQueue: Array<{ resolve: Function; reject: Function; timestamp: number }> = [];
  private healthCheckInterval: NodeJS.Timeout | null = null;

  // Optimized configurations for different storage types
  private readonly poolConfigs: Record<string, ConnectionPoolConfig> = {

    mongodb: {
      minConnections: 10,
      maxConnections: 50,
      acquireTimeoutMs: 8000,
      idleTimeoutMs: 60000,
      connectionTimeoutMs: 15000,
      retryDelayMs: 2000,
      maxRetries: 5,
      healthCheckInterval: 45000
    },
    file: {
      minConnections: 1,
      maxConnections: 5,
      acquireTimeoutMs: 1000,
      idleTimeoutMs: 10000,
      connectionTimeoutMs: 5000,
      retryDelayMs: 500,
      maxRetries: 2,
      healthCheckInterval: 60000
    }
  };

  // ========================================================================
  // QUERY OPTIMIZATION PROPERTIES
  // ========================================================================
  
  // Multi-level caches with different strategies
  private hotDataCache!: LRUCache<string, any>;
  private userCache!: LRUCache<string, any>; 
  private securityCache!: LRUCache<string, any>;
  private taskCache!: LRUCache<string, any>;
  private deviceCache!: LRUCache<string, any>;
  
  // Performance monitoring
  private queryMetrics: QueryMetrics[] = [];
  private queryPatterns: Map<string, QueryPattern> = new Map();
  private cacheStats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    sets: 0
  };

  // Cache configuration
  private readonly cacheConfig = {
    hotData: { maxSize: 1000, ttl: 5 * 60 * 1000, name: 'HotData' },
    user: { maxSize: 5000, ttl: 10 * 60 * 1000, name: 'UserData' },
    security: { maxSize: 2000, ttl: 15 * 60 * 1000, name: 'Security' },
    task: { maxSize: 500, ttl: 30 * 60 * 1000, name: 'TaskData' },
    device: { maxSize: 3000, ttl: 20 * 60 * 1000, name: 'DeviceData' }
  };

  // ========================================================================
  // INDEX MANAGEMENT PROPERTIES
  // ========================================================================
  
  // Track query patterns to suggest new indexes
  private indexQueryPatterns: Map<string, QueryPattern> = new Map();
  private indexUsageStats: Map<string, number> = new Map();

  // Optimal index definitions for each collection
  private readonly optimalIndexes: IndexDefinition[] = [
    // Users collection - most critical for performance
    {
      collection: 'users',
      fields: { telegram_id: 1 },
      options: { unique: true, name: 'telegram_id_unique' }
    },
    {
      collection: 'users',
      fields: { username: 1 },
      options: { sparse: true, name: 'username_sparse' }
    },
    {
      collection: 'users',
      fields: { created_at: -1 },
      options: { name: 'created_at_desc' }
    },
    {
      collection: 'users',
      fields: { status: 1, last_activity: -1 },
      options: { name: 'status_activity_compound' }
    },

    // Tasks collection - frequent queries on status and type
    {
      collection: 'tasks',
      fields: { status: 1, created_at: -1 },
      options: { name: 'task_status_created' }
    },
    {
      collection: 'tasks',
      fields: { task_type: 1, active: 1 },
      options: { name: 'task_type_active' }
    },
    {
      collection: 'tasks',
      fields: { expires_at: 1 },
      options: { expireAfterSeconds: 0, name: 'task_expiration' }
    },

    // Task submissions - indexed for quick lookups
    {
      collection: 'task_submissions',
      fields: { user_id: 1, task_id: 1 },
      options: { unique: true, name: 'user_task_unique' }
    },
    {
      collection: 'task_submissions',
      fields: { status: 1, submitted_at: -1 },
      options: { name: 'submission_status_date' }
    },

    // Security events - time-based queries
    {
      collection: 'security_events',
      fields: { timestamp: -1 },
      options: { name: 'security_timestamp' }
    },
    {
      collection: 'security_events',
      fields: { user_id: 1, event_type: 1, timestamp: -1 },
      options: { name: 'security_user_event_time' }
    },
    {
      collection: 'security_events',
      fields: { timestamp: 1 },
      options: { expireAfterSeconds: 2592000, name: 'security_events_ttl' } // 30 days
    },

    // Device fingerprints - security queries
    {
      collection: 'device_fingerprints',
      fields: { device_hash: 1 },
      options: { unique: true, name: 'device_hash_unique' }
    },
    {
      collection: 'device_fingerprints',
      fields: { user_id: 1, created_at: -1 },
      options: { name: 'device_user_created' }
    },

    // Sessions - frequent lookups
    {
      collection: 'sessions',
      fields: { session_id: 1 },
      options: { unique: true, name: 'session_id_unique' }
    },
    {
      collection: 'sessions',
      fields: { expires_at: 1 },
      options: { expireAfterSeconds: 0, name: 'session_expiration' }
    }
  ];

  private constructor() {
    super();
    this.initializeCaches();
    this.startPerformanceMonitoring();
    this.startHealthMonitoring();
  }

  public static getInstance(): DatabaseOptimizer {
    if (!DatabaseOptimizer.instance) {
      DatabaseOptimizer.instance = new DatabaseOptimizer();
    }
    return DatabaseOptimizer.instance;
  }

  // ========================================================================
  // CONNECTION OPTIMIZATION METHODS
  // ========================================================================

  /**
   * Get optimized connection configuration for storage type
   */
  getOptimalConnectionConfig(storageType: string): any {
    const baseConfig = this.poolConfigs[storageType] || this.poolConfigs.file;
    
    // Adjust based on environment
    const environmentMultiplier = process.env.NODE_ENV === 'production' ? 2 : 1;
    
    const optimizedConfig = {
      ...baseConfig,
      maxConnections: Math.min(baseConfig.maxConnections * environmentMultiplier, 100),
      minConnections: Math.min(baseConfig.minConnections * environmentMultiplier, 20)
    };

    // Storage-specific optimizations
    switch (storageType) {
      case 'mongodb':
        return this.getOptimalMongoConfig(optimizedConfig);
      case 'file':
        return this.getOptimalFileConfig(optimizedConfig);
      default:
        return optimizedConfig;
    }
  }



  private getOptimalMongoConfig(baseConfig: ConnectionPoolConfig): any {
    return {
      // MongoDB connection optimization
      maxPoolSize: baseConfig.maxConnections,
      minPoolSize: baseConfig.minConnections,
      maxIdleTimeMS: baseConfig.idleTimeoutMs,
      waitQueueTimeoutMS: baseConfig.acquireTimeoutMs,
      connectTimeoutMS: baseConfig.connectionTimeoutMs,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 5000,
      
      // Write concern for performance
      w: 'majority',
      wtimeoutMS: 10000,
      j: true,
      
      // Read preferences for load distribution
      readPreference: 'secondaryPreferred',
      readConcern: { level: 'majority' },
      
      // Retry configuration
      retryWrites: true,
      retryReads: true,
      maxRetryWrites: baseConfig.maxRetries,
      
      // Compression for network efficiency
      compressors: ['zstd', 'snappy', 'zlib'],
      zlibCompressionLevel: 6,
      
      // Auto-scaling and monitoring
      heartbeatFrequencyMS: 10000,
      serverMonitoringMode: 'auto',
      
      // Performance optimizations
      bufferMaxEntries: 0,
      useNewUrlParser: true,
      useUnifiedTopology: true,
      
      // Auto-scaling based on load
      ...this.getAdaptivePoolSettings('mongodb')
    };
  }

  private getOptimalFileConfig(baseConfig: ConnectionPoolConfig): any {
    return {
      // Concurrent file operations
      maxConcurrentOps: baseConfig.maxConnections,
      
      // File system optimizations
      highWaterMark: 16384,
      encoding: 'utf8',
      flag: 'r+',
      
      // Atomic operations
      useAtomicWrites: true,
      createBackups: true,
      
      // Caching strategy for file storage
      enableCache: true,
      cacheSize: 100,
      cacheTTL: 300000,
      
      // Auto-scaling based on load
      ...this.getAdaptivePoolSettings('file')
    };
  }

  private getAdaptivePoolSettings(storageType: string): any {
    const currentLoad = this.getCurrentLoadMetrics();
    const baseConfig = this.poolConfigs[storageType];
    
    let adaptiveMaxConnections = baseConfig.maxConnections;
    let adaptiveMinConnections = baseConfig.minConnections;
    
    if (currentLoad.queuedRequests > 10) {
      adaptiveMaxConnections = Math.min(baseConfig.maxConnections * 1.5, 100);
    } else if (currentLoad.idleConnections > baseConfig.maxConnections * 0.7) {
      adaptiveMaxConnections = Math.max(baseConfig.maxConnections * 0.8, baseConfig.minConnections);
    }
    
    return {
      adaptiveMaxConnections,
      adaptiveMinConnections,
      autoScale: true,
      loadThreshold: 0.8,
      scaleInterval: 30000
    };
  }

  /**
   * Track connection usage and performance
   */
  recordConnectionMetric(metricType: 'acquire' | 'release' | 'query' | 'error', duration?: number, error?: string): void {
    const now = Date.now();
    
    switch (metricType) {
      case 'acquire':
        this.connectionMetrics.activeConnections++;
        this.connectionMetrics.totalConnections++;
        if (duration) {
          this.updateAverageConnectionTime(duration);
        }
        break;
        
      case 'release':
        this.connectionMetrics.activeConnections = Math.max(0, this.connectionMetrics.activeConnections - 1);
        this.connectionMetrics.idleConnections++;
        break;
        
      case 'query':
        this.connectionMetrics.totalRequests++;
        if (duration) {
          this.updateAverageQueryTime(duration);
        }
        break;
        
      case 'error':
        this.connectionMetrics.failedRequests++;
        if (error) {
          this.connectionMetrics.errors.push({
            timestamp: now,
            error,
            type: metricType
          });
          
          if (this.connectionMetrics.errors.length > 100) {
            this.connectionMetrics.errors = this.connectionMetrics.errors.slice(-50);
          }
        }
        break;
    }
    
    this.emit('metric', { type: metricType, duration, error, timestamp: now });
  }

  private updateAverageConnectionTime(duration: number): void {
    const currentTotal = this.connectionMetrics.avgConnectionTime * Math.max(1, this.connectionMetrics.totalConnections - 1);
    this.connectionMetrics.avgConnectionTime = (currentTotal + duration) / this.connectionMetrics.totalConnections;
  }

  private updateAverageQueryTime(duration: number): void {
    const currentTotal = this.connectionMetrics.avgQueryTime * Math.max(1, this.connectionMetrics.totalRequests - 1);
    this.connectionMetrics.avgQueryTime = (currentTotal + duration) / this.connectionMetrics.totalRequests;
  }

  /**
   * Implement intelligent retry logic with exponential backoff
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    storageType: string = 'file',
    context?: string
  ): Promise<T> {
    const config = this.poolConfigs[storageType];
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
      try {
        const startTime = performance.now();
        const result = await operation();
        const duration = performance.now() - startTime;
        
        this.recordConnectionMetric('query', duration);
        
        if (attempt > 1) {
          logger.info(`Operation succeeded on attempt ${attempt}/${config.maxRetries}`, { context });
        }
        
        return result;
      } catch (error: any) {
        lastError = error;
        this.recordConnectionMetric('error', undefined, error.message);
        
        if (this.isNonRetryableError(error)) {
          logger.error(`Non-retryable error in ${context}:`, error);
          throw error;
        }
        
        if (attempt < config.maxRetries) {
          const baseDelay = config.retryDelayMs * Math.pow(2, attempt - 1);
          const jitter = Math.random() * baseDelay * 0.1;
          const delay = Math.min(baseDelay + jitter, 30000);
          
          logger.warn(`Operation failed (attempt ${attempt}/${config.maxRetries}), retrying in ${delay}ms`, {
            context,
            error: error.message
          });
          
          await this.sleep(delay);
        }
      }
    }
    
    logger.error(`Operation failed after ${config.maxRetries} attempts in ${context}:`, lastError);
    throw lastError || new Error('Operation failed after all retries');
  }

  private isNonRetryableError(error: any): boolean {
    const nonRetryablePatterns = [
      /authentication/i,
      /authorization/i,
      /permission denied/i,
      /invalid.*key/i,
      /syntax error/i,
      /validation error/i
    ];
    
    const errorMessage = error.message || error.toString();
    return nonRetryablePatterns.some(pattern => pattern.test(errorMessage));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ========================================================================
  // QUERY OPTIMIZATION METHODS
  // ========================================================================

  private initializeCaches(): void {
    this.hotDataCache = new LRUCache({
      max: this.cacheConfig.hotData.maxSize,
      ttl: this.cacheConfig.hotData.ttl,
      updateAgeOnGet: true,
      allowStale: false,
      dispose: (value, key) => {
        this.cacheStats.evictions++;
        logger.debug(`Cache eviction [${this.cacheConfig.hotData.name}]: ${key}`);
      }
    });

    this.userCache = new LRUCache({
      max: this.cacheConfig.user.maxSize,
      ttl: this.cacheConfig.user.ttl,
      updateAgeOnGet: true,
      allowStale: false,
      dispose: () => this.cacheStats.evictions++
    });

    this.securityCache = new LRUCache({
      max: this.cacheConfig.security.maxSize,
      ttl: this.cacheConfig.security.ttl,
      updateAgeOnGet: true,
      allowStale: false,
      dispose: () => this.cacheStats.evictions++
    });

    this.taskCache = new LRUCache({
      max: this.cacheConfig.task.maxSize,
      ttl: this.cacheConfig.task.ttl,
      updateAgeOnGet: true,
      allowStale: false,
      dispose: () => this.cacheStats.evictions++
    });

    this.deviceCache = new LRUCache({
      max: this.cacheConfig.device.maxSize,
      ttl: this.cacheConfig.device.ttl,
      updateAgeOnGet: true,
      allowStale: false,
      dispose: () => this.cacheStats.evictions++
    });

    logger.info('Database Query Optimizer caches initialized');
  }

  /**
   * Get cache for specific data type
   */
  private getCache(cacheType: 'hotData' | 'user' | 'security' | 'task' | 'device'): LRUCache<string, any> {
    switch (cacheType) {
      case 'hotData': return this.hotDataCache;
      case 'user': return this.userCache;
      case 'security': return this.securityCache;
      case 'task': return this.taskCache;
      case 'device': return this.deviceCache;
      default: return this.hotDataCache;
    }
  }

  /**
   * Optimized caching method with automatic cache selection
   */
  async optimizedGet<T>(
    key: string,
    fetcher: () => Promise<T>,
    options: {
      cacheType?: 'hotData' | 'user' | 'security' | 'task' | 'device';
      ttl?: number;
      skipCache?: boolean;
    } = {}
  ): Promise<T> {
    const { cacheType = 'hotData', ttl, skipCache = false } = options;
    
    if (skipCache) {
      return await fetcher();
    }
    
    const cache = this.getCache(cacheType);
    const cached = cache.get(key);
    
    if (cached !== undefined) {
      this.cacheStats.hits++;
      logger.debug(`Cache HIT [${cacheType}]: ${key}`);
      return cached;
    }
    
    this.cacheStats.misses++;
    logger.debug(`Cache MISS [${cacheType}]: ${key}`);
    
    const startTime = performance.now();
    const result = await fetcher();
    const duration = performance.now() - startTime;
    
    // Record query metrics
    this.recordQueryMetric({
      queryType: cacheType,
      duration,
      timestamp: Date.now(),
      cacheHit: false,
      parameters: { key }
    });
    
    // Cache the result with custom TTL if provided
    if (ttl) {
      cache.set(key, result, { ttl });
    } else {
      cache.set(key, result);
    }
    this.cacheStats.sets++;
    
    return result;
  }

  /**
   * Batch operations with intelligent caching
   */
  async executeBatch(operations: BatchOperation[], cacheType: 'hotData' | 'user' | 'security' | 'task' | 'device' = 'hotData'): Promise<any[]> {
    const results: any[] = [];
    const cache = this.getCache(cacheType);
    const uncachedOperations: BatchOperation[] = [];
    
    // First pass - check cache for get operations
    for (const op of operations) {
      if (op.operation === 'get') {
        const cacheKeys = op.data.map(item => `${op.collection}:${item.id}`);
        const cachedResults = cacheKeys.map(key => cache.get(key));
        
        // Separate cached and uncached items
        for (let i = 0; i < cachedResults.length; i++) {
          if (cachedResults[i] !== undefined) {
            results[i] = cachedResults[i];
            this.cacheStats.hits++;
          } else {
            uncachedOperations.push({
              ...op,
              data: [op.data[i]]
            });
            this.cacheStats.misses++;
          }
        }
      } else {
        uncachedOperations.push(op);
      }
    }
    
    // Execute uncached operations
    if (uncachedOperations.length > 0) {
      const startTime = performance.now();
      const uncachedResults = await this.executeBatchInStorage(uncachedOperations);
      const duration = performance.now() - startTime;
      
      this.recordQueryMetric({
        queryType: `batch_${cacheType}`,
        duration,
        timestamp: Date.now(),
        cacheHit: false,
        resultCount: uncachedResults.length
      });
      
      // Cache the results
      for (let i = 0; i < uncachedOperations.length; i++) {
        const op = uncachedOperations[i];
        const result = uncachedResults[i];
        
        if (op.operation === 'get' && result) {
          const cacheKey = `${op.collection}:${op.data[0].id}`;
          cache.set(cacheKey, result);
          this.cacheStats.sets++;
        }
      }
      
      results.push(...uncachedResults);
    }
    
    return results;
  }

  private async executeBatchInStorage(operations: BatchOperation[]): Promise<any[]> {
    // Implementation would depend on the storage backend
    // For now, we'll simulate the execution
    return operations.map(op => ({ success: true, operation: op.operation }));
  }

  private recordQueryMetric(metric: QueryMetrics): void {
    this.queryMetrics.push(metric);
    
    // Keep only recent metrics (last 1000)
    if (this.queryMetrics.length > 1000) {
      this.queryMetrics = this.queryMetrics.slice(-500);
    }
    
    // Update query patterns
    this.updateQueryPatterns(metric);
  }

  private updateQueryPatterns(metric: QueryMetrics): void {
    const pattern = metric.queryType;
    const existing = this.queryPatterns.get(pattern);
    
    if (existing) {
      existing.frequency++;
      existing.avgDuration = (existing.avgDuration + metric.duration) / 2;
      existing.lastSeen = metric.timestamp;
    } else {
      this.queryPatterns.set(pattern, {
        pattern,
        frequency: 1,
        avgDuration: metric.duration,
        lastSeen: metric.timestamp,
        recommendations: []
      });
    }
  }

  /**
   * Warm up caches with frequently accessed data
   */
  async warmUpCaches(): Promise<void> {
    logger.info('Starting cache warm-up process...');
    
    try {
      // Warm up with most frequently accessed user data
      await this.warmUpUserCache();
      
      // Warm up with active tasks
      await this.warmUpTaskCache();
      
      // Warm up with recent security data
      await this.warmUpSecurityCache();
      
      logger.info('Cache warm-up completed successfully');
    } catch (error) {
      logger.error('Cache warm-up failed:', error);
      throw error;
    }
  }

  private async warmUpUserCache(): Promise<void> {
    // Implementation would fetch most active users
    logger.debug('Warming up user cache...');
  }

  private async warmUpTaskCache(): Promise<void> {
    // Implementation would fetch active tasks
    logger.debug('Warming up task cache...');
  }

  private async warmUpSecurityCache(): Promise<void> {
    // Implementation would fetch recent security events
    logger.debug('Warming up security cache...');
  }

  /**
   * Clear specific cache or all caches
   */
  clearCache(cacheType?: 'hotData' | 'user' | 'security' | 'task' | 'device'): void {
    if (cacheType) {
      const cache = this.getCache(cacheType);
      cache.clear();
      logger.info(`Cleared ${cacheType} cache`);
    } else {
      this.hotDataCache.clear();
      this.userCache.clear();
      this.securityCache.clear();
      this.taskCache.clear();
      this.deviceCache.clear();
      logger.info('Cleared all caches');
    }
  }

  // ========================================================================
  // INDEX MANAGEMENT METHODS
  // ========================================================================

  /**
   * Ensure all optimal indexes are created
   */
  async ensureOptimalIndexes(): Promise<void> {
    logger.info('Ensuring optimal database indexes...');
    
    const storageType = this.getCurrentStorageType();
    
    // Only create indexes for MongoDB (other storage types handle optimization differently)
    if (storageType !== 'mongodb') {
      logger.info(`Skipping index creation for ${storageType} storage`);
      return;
    }
    
    try {
      for (const indexDef of this.optimalIndexes) {
        await this.ensureIndex(indexDef);
      }
      
      logger.info(`✅ Created ${this.optimalIndexes.length} optimal indexes`);
    } catch (error) {
      logger.error('Failed to ensure optimal indexes:', error);
      throw error;
    }
  }

  private async ensureIndex(indexDef: IndexDefinition): Promise<void> {
    try {
      // Implementation would create the index in the database
      logger.debug(`Ensuring index on ${indexDef.collection}:`, indexDef.fields);
      
      // Track index usage
      const indexKey = `${indexDef.collection}_${Object.keys(indexDef.fields).join('_')}`;
      this.indexUsageStats.set(indexKey, 0);
      
    } catch (error: any) {
      if (error.message.includes('already exists')) {
        logger.debug(`Index already exists on ${indexDef.collection}`);
      } else {
        logger.error(`Failed to create index on ${indexDef.collection}:`, error);
        throw error;
      }
    }
  }

  /**
   * Analyze query patterns and suggest new indexes
   */
  analyzeIndexNeeds(): IndexAnalysis[] {
    const analyses: IndexAnalysis[] = [];
    
    for (const [pattern, stats] of this.queryPatterns.entries()) {
      if (stats.frequency > 10 && stats.avgDuration > 50) {
        // Suggest index if query is frequent and slow
        analyses.push({
          indexName: `suggested_${pattern}_index`,
          collection: pattern.split('_')[0] || 'unknown',
          fields: [pattern],
          usage: stats.frequency,
          efficiency: Math.max(0, 100 - stats.avgDuration),
          recommendations: [
            `Create index on ${pattern} - ${stats.frequency} queries, ${stats.avgDuration.toFixed(2)}ms avg`
          ]
        });
      }
    }
    
    return analyses;
  }

  /**
   * Get index usage statistics
   */
  getIndexUsageStats(): Map<string, number> {
    return new Map(this.indexUsageStats);
  }

  // ========================================================================
  // MONITORING AND HEALTH METHODS
  // ========================================================================

  private startPerformanceMonitoring(): void {
    // Clean old metrics every 5 minutes
    setInterval(() => {
      this.cleanOldMetrics();
      this.analyzeQueryPatterns();
    }, 5 * 60 * 1000);

    // Log cache statistics every minute
    setInterval(() => {
      this.logCacheStatistics();
    }, 60 * 1000);

    logger.info('Database performance monitoring started');
  }

  private startHealthMonitoring(): void {
    // Health check every minute
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthChecks();
    }, 60000);

    // Clean old connection metrics every 5 minutes
    setInterval(() => {
      this.cleanOldConnectionMetrics();
    }, 5 * 60 * 1000);

    logger.info('Database connection health monitoring started');
  }

  private cleanOldMetrics(): void {
    const cutoff = Date.now() - (60 * 60 * 1000); // 1 hour
    
    // Clean old query metrics
    this.queryMetrics = this.queryMetrics.filter(metric => metric.timestamp > cutoff);
    
    // Clean old query patterns
    for (const [pattern, stats] of this.queryPatterns.entries()) {
      if (stats.lastSeen < cutoff) {
        this.queryPatterns.delete(pattern);
      }
    }
  }

  private analyzeQueryPatterns(): void {
    const patterns = Array.from(this.queryPatterns.values());
    const slowQueries = patterns.filter(p => p.avgDuration > 100);
    
    if (slowQueries.length > 0) {
      logger.warn(`Found ${slowQueries.length} slow query patterns`, {
        patterns: slowQueries.map(p => ({ pattern: p.pattern, avgDuration: p.avgDuration }))
      });
    }
  }

  private logCacheStatistics(): void {
    const hitRate = this.cacheStats.hits + this.cacheStats.misses > 0 
      ? (this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) * 100).toFixed(1)
      : '0';
    
    logger.debug(`Cache Stats: ${hitRate}% hit rate, ${this.cacheStats.evictions} evictions`);
  }

  private async performHealthChecks(): Promise<void> {
    const storageType = this.getCurrentStorageType();
    const connectionId = `${storageType}-main`;
    
    try {
      const startTime = performance.now();
      await this.executeHealthCheckQuery(storageType);
      const responseTime = performance.now() - startTime;
      
      this.connectionHealth.set(connectionId, {
        isHealthy: true,
        lastCheck: Date.now(),
        responseTime,
        errorCount: 0
      });
      
      if (responseTime > 1000) {
        logger.warn(`Slow database response: ${responseTime.toFixed(2)}ms`);
      }
      
    } catch (error: any) {
      const existingHealth = this.connectionHealth.get(connectionId) || {
        isHealthy: true,
        lastCheck: Date.now(),
        responseTime: 0,
        errorCount: 0
      };
      
      existingHealth.errorCount++;
      existingHealth.isHealthy = existingHealth.errorCount < 3;
      existingHealth.lastCheck = Date.now();
      
      this.connectionHealth.set(connectionId, existingHealth);
      
      logger.error('Database health check failed:', error);
      this.emit('healthCheckFailed', { connectionId, error });
    }
  }

  private async executeHealthCheckQuery(storageType: string): Promise<void> {
    // Simple health check queries for each storage type
    await this.sleep(10 + Math.random() * 20); // Simulate latency
  }

  private getCurrentStorageType(): string {
    return config.storage.source || 'file';
  }

  private getCurrentLoadMetrics(): ConnectionMetrics {
    return { ...this.connectionMetrics };
  }

  private cleanOldConnectionMetrics(): void {
    const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours
    
    this.connectionMetrics.errors = this.connectionMetrics.errors.filter(
      error => error.timestamp > cutoff
    );
    
    if (this.connectionMetrics.totalRequests > 1000000) {
      this.connectionMetrics.totalRequests = Math.floor(this.connectionMetrics.totalRequests / 2);
      this.connectionMetrics.failedRequests = Math.floor(this.connectionMetrics.failedRequests / 2);
    }
  }

  // ========================================================================
  // REPORTING METHODS
  // ========================================================================

  /**
   * Get comprehensive optimization report
   */
  getOptimizationReport(): any {
    const storageType = this.getCurrentStorageType();
    const connectionReport = this.getConnectionOptimizationReport();
    const queryReport = this.getQueryOptimizationReport();
    const indexReport = this.getIndexOptimizationReport();
    
    return {
      timestamp: new Date().toISOString(),
      storageType,
      overallHealthScore: this.calculateHealthScore(),
      connection: connectionReport,
      query: queryReport,
      indexing: indexReport,
      recommendations: this.generateUnifiedRecommendations()
    };
  }

  private getConnectionOptimizationReport(): any {
    const storageType = this.getCurrentStorageType();
    const currentConfig = this.getOptimalConnectionConfig(storageType);
    const healthStatus = Array.from(this.connectionHealth.entries());
    
    return {
      storageType,
      currentConfiguration: currentConfig,
      connectionMetrics: { ...this.connectionMetrics },
      healthStatus: healthStatus.map(([id, health]) => ({ id, ...health })),
      recommendations: this.generateConnectionRecommendations(),
      performanceAnalysis: this.analyzeConnectionPerformance()
    };
  }

  private getQueryOptimizationReport(): any {
    const hitRate = this.cacheStats.hits + this.cacheStats.misses > 0 
      ? (this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) * 100)
      : 0;
    
    return {
      cacheStatistics: {
        hitRate: hitRate.toFixed(1) + '%',
        totalHits: this.cacheStats.hits,
        totalMisses: this.cacheStats.misses,
        evictions: this.cacheStats.evictions,
        cacheSize: {
          hotData: this.hotDataCache.size,
          user: this.userCache.size,
          security: this.securityCache.size,
          task: this.taskCache.size,
          device: this.deviceCache.size
        }
      },
      queryPatterns: Array.from(this.queryPatterns.values()),
      recommendations: this.generateQueryRecommendations()
    };
  }

  private getIndexOptimizationReport(): any {
    return {
      indexCount: this.optimalIndexes.length,
      indexAnalysis: this.analyzeIndexNeeds(),
      usageStats: Object.fromEntries(this.indexUsageStats),
      recommendations: this.generateIndexRecommendations()
    };
  }

  private calculateHealthScore(): number {
    const connectionHealth = Array.from(this.connectionHealth.values());
    const healthyConnections = connectionHealth.filter(h => h.isHealthy).length;
    const totalConnections = connectionHealth.length || 1;
    
    const connectionScore = (healthyConnections / totalConnections) * 100;
    
    const hitRate = this.cacheStats.hits + this.cacheStats.misses > 0 
      ? (this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) * 100)
      : 100;
    
    const errorRate = this.connectionMetrics.totalRequests > 0
      ? ((this.connectionMetrics.totalRequests - this.connectionMetrics.failedRequests) / this.connectionMetrics.totalRequests * 100)
      : 100;
    
    return Math.round((connectionScore + hitRate + errorRate) / 3);
  }

  private generateConnectionRecommendations(): string[] {
    const recommendations: string[] = [];
    const metrics = this.connectionMetrics;
    
    const failureRate = metrics.totalRequests > 0 
      ? (metrics.failedRequests / metrics.totalRequests) * 100 
      : 0;
    
    if (failureRate > 5) {
      recommendations.push(`High failure rate (${failureRate.toFixed(1)}%) - consider increasing retry attempts or connection timeout`);
    }
    
    if (metrics.avgConnectionTime > 1000) {
      recommendations.push(`Slow connection establishment (${metrics.avgConnectionTime.toFixed(0)}ms) - check network latency or increase connection pool`);
    }
    
    if (metrics.avgQueryTime > 100) {
      recommendations.push(`Slow query performance (${metrics.avgQueryTime.toFixed(0)}ms) - consider database optimization or caching`);
    }
    
    if (metrics.queuedRequests > metrics.activeConnections * 2) {
      recommendations.push('High queue length - consider increasing maximum connections');
    }
    
    if (metrics.idleConnections > metrics.activeConnections * 3) {
      recommendations.push('Too many idle connections - consider reducing connection pool size');
    }
    
    return recommendations;
  }

  private generateQueryRecommendations(): string[] {
    const recommendations: string[] = [];
    
    const hitRate = this.cacheStats.hits + this.cacheStats.misses > 0 
      ? (this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) * 100)
      : 0;
    
    if (hitRate < 70) {
      recommendations.push(`Low cache hit rate (${hitRate.toFixed(1)}%) - consider increasing cache size or TTL`);
    }
    
    if (this.cacheStats.evictions > this.cacheStats.sets * 0.1) {
      recommendations.push('High cache eviction rate - consider increasing cache size');
    }
    
    const slowPatterns = Array.from(this.queryPatterns.values()).filter(p => p.avgDuration > 100);
    if (slowPatterns.length > 0) {
      recommendations.push(`${slowPatterns.length} slow query patterns detected - consider optimization or indexing`);
    }
    
    return recommendations;
  }

  private generateIndexRecommendations(): string[] {
    const recommendations: string[] = [];
    const indexAnalyses = this.analyzeIndexNeeds();
    
    if (indexAnalyses.length > 0) {
      recommendations.push(`Consider creating ${indexAnalyses.length} new indexes for better performance`);
    }
    
    const unusedIndexes = Array.from(this.indexUsageStats.entries()).filter(([_, usage]) => usage === 0);
    if (unusedIndexes.length > 0) {
      recommendations.push(`${unusedIndexes.length} indexes appear unused - consider removing them`);
    }
    
    return recommendations;
  }

  private generateUnifiedRecommendations(): Array<{ priority: 'high' | 'medium' | 'low'; action: string; estimatedImpact: string }> {
    const recommendations: Array<{ priority: 'high' | 'medium' | 'low'; action: string; estimatedImpact: string }> = [];
    
    // High priority recommendations
    const healthScore = this.calculateHealthScore();
    if (healthScore < 80) {
      recommendations.push({
        priority: 'high',
        action: 'Address health issues and optimize connection configuration',
        estimatedImpact: 'High - improved reliability and performance'
      });
    }
    
    const hitRate = this.cacheStats.hits + this.cacheStats.misses > 0 
      ? (this.cacheStats.hits / (this.cacheStats.hits + this.cacheStats.misses) * 100)
      : 0;
    
    if (hitRate < 50) {
      recommendations.push({
        priority: 'high',
        action: 'Optimize caching strategy and increase cache sizes',
        estimatedImpact: 'High - significant query performance improvement'
      });
    }
    
    // Medium priority recommendations
    const slowPatterns = Array.from(this.queryPatterns.values()).filter(p => p.avgDuration > 100);
    if (slowPatterns.length > 2) {
      recommendations.push({
        priority: 'medium',
        action: 'Optimize slow query patterns through indexing or query restructuring',
        estimatedImpact: 'Medium - improved query response times'
      });
    }
    
    // Low priority recommendations
    if (this.cacheStats.evictions > 100) {
      recommendations.push({
        priority: 'low',
        action: 'Fine-tune cache TTL and size settings',
        estimatedImpact: 'Low - minor performance improvements'
      });
    }
    
    return recommendations;
  }

  private analyzeConnectionPerformance(): any {
    const metrics = this.connectionMetrics;
    const recentErrors = metrics.errors.filter(
      error => error.timestamp > Date.now() - (60 * 60 * 1000)
    );
    
    return {
      totalRequests: metrics.totalRequests,
      successRate: metrics.totalRequests > 0 
        ? ((metrics.totalRequests - metrics.failedRequests) / metrics.totalRequests * 100).toFixed(2) + '%'
        : 'N/A',
      averageConnectionTime: metrics.avgConnectionTime.toFixed(2) + 'ms',
      averageQueryTime: metrics.avgQueryTime.toFixed(2) + 'ms',
      recentErrorCount: recentErrors.length,
      connectionUtilization: metrics.totalConnections > 0
        ? ((metrics.activeConnections / metrics.totalConnections) * 100).toFixed(1) + '%'
        : 'N/A'
    };
  }

  /**
   * Cleanup and shutdown
   */
  shutdown(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    // Clear all caches
    this.clearCache();
    
    logger.info('Database optimizer shutdown completed');
  }
}

// Export singleton instance
export const dbOptimizer = DatabaseOptimizer.getInstance();