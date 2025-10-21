import { Logger } from './logger';

/**
 * Device Cache Service - In-Memory Cache for Ultra-Fast Lookups
 * 
 * This service provides O(1) lookup time for device fingerprints
 * Performance: < 1ms vs database lookup 10-100ms
 */
export class DeviceCacheService {
  private static instance: DeviceCacheService;
  private readonly logger = Logger.getInstance();
  
  // Main cache: deviceHash -> userId
  private deviceHashCache: Map<string, {
    userId: string;
    timestamp: number;
    usageCount: number;
  }> = new Map();
  
  // Canvas fingerprint cache: canvasHash -> array of userIds
  private canvasHashCache: Map<string, {
    userIds: string[];
    timestamp: number;
  }> = new Map();
  
  // Screen resolution cache: resolution -> array of deviceHashes
  private screenResolutionCache: Map<string, {
    deviceHashes: string[];
    timestamp: number;
  }> = new Map();
  
  // Recently checked devices (negative cache to avoid repeated DB queries)
  private recentlyCheckedNotFound: Set<string> = new Set();
  
  private readonly CACHE_TTL = 30 * 60 * 1000; // 30 minutes
  private readonly MAX_CACHE_SIZE = 10000; // Max 10k entries
  private readonly MAX_CANVAS_CACHE_SIZE = 5000;
  private readonly MAX_SCREEN_CACHE_SIZE = 1000;
  private readonly NOT_FOUND_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  
  // Statistics
  private stats = {
    hits: 0,
    misses: 0,
    evictions: 0,
    insertions: 0
  };
  
  private constructor() {
    // Start cleanup interval
    setInterval(() => this.cleanupExpiredEntries(), 10 * 60 * 1000); // Every 10 minutes
    this.logger.info('DeviceCacheService initialized');
  }
  
  static getInstance(): DeviceCacheService {
    if (!DeviceCacheService.instance) {
      DeviceCacheService.instance = new DeviceCacheService();
    }
    return DeviceCacheService.instance;
  }
  
  /**
   * Get cached device by hash - O(1) operation
   */
  getCachedDevice(hash: string): string | null {
    const cached = this.deviceHashCache.get(hash);
    
    if (!cached) {
      this.stats.misses++;
      return null;
    }
    
    // Check TTL
    if (Date.now() - cached.timestamp > this.CACHE_TTL) {
      this.deviceHashCache.delete(hash);
      this.stats.misses++;
      return null;
    }
    
    // Update usage count
    cached.usageCount++;
    this.stats.hits++;
    
    return cached.userId;
  }
  
  /**
   * Cache a device hash -> userId mapping
   */
  cacheDevice(hash: string, userId: string): void {
    // Implement LRU eviction if cache is full
    if (this.deviceHashCache.size >= this.MAX_CACHE_SIZE) {
      this.evictLeastRecentlyUsed();
    }
    
    this.deviceHashCache.set(hash, {
      userId,
      timestamp: Date.now(),
      usageCount: 1
    });
    
    this.stats.insertions++;
    
    // Remove from not-found cache if present
    this.recentlyCheckedNotFound.delete(hash);
  }
  
  /**
   * Cache canvas fingerprint -> userIds mapping
   */
  cacheCanvasHash(canvasHash: string, userId: string): void {
    if (!canvasHash) return;
    
    // Check cache size
    if (this.canvasHashCache.size >= this.MAX_CANVAS_CACHE_SIZE) {
      // Remove oldest entry
      const firstKey = this.canvasHashCache.keys().next().value;
      this.canvasHashCache.delete(firstKey);
    }
    
    const existing = this.canvasHashCache.get(canvasHash);
    
    if (existing) {
      if (!existing.userIds.includes(userId)) {
        existing.userIds.push(userId);
      }
      existing.timestamp = Date.now();
    } else {
      this.canvasHashCache.set(canvasHash, {
        userIds: [userId],
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Get cached users by canvas fingerprint
   */
  getCachedCanvasUsers(canvasHash: string): string[] | null {
    if (!canvasHash) return null;
    
    const cached = this.canvasHashCache.get(canvasHash);
    
    if (!cached) {
      return null;
    }
    
    // Check TTL
    if (Date.now() - cached.timestamp > this.CACHE_TTL) {
      this.canvasHashCache.delete(canvasHash);
      return null;
    }
    
    return cached.userIds;
  }
  
  /**
   * Cache screen resolution -> device hashes mapping
   */
  cacheScreenResolution(screenResolution: string, deviceHash: string): void {
    if (!screenResolution) return;
    
    // Check cache size
    if (this.screenResolutionCache.size >= this.MAX_SCREEN_CACHE_SIZE) {
      const firstKey = this.screenResolutionCache.keys().next().value;
      this.screenResolutionCache.delete(firstKey);
    }
    
    const existing = this.screenResolutionCache.get(screenResolution);
    
    if (existing) {
      if (!existing.deviceHashes.includes(deviceHash)) {
        existing.deviceHashes.push(deviceHash);
      }
      existing.timestamp = Date.now();
    } else {
      this.screenResolutionCache.set(screenResolution, {
        deviceHashes: [deviceHash],
        timestamp: Date.now()
      });
    }
  }
  
  /**
   * Get cached device hashes by screen resolution
   */
  getCachedScreenDevices(screenResolution: string): string[] | null {
    if (!screenResolution) return null;
    
    const cached = this.screenResolutionCache.get(screenResolution);
    
    if (!cached) {
      return null;
    }
    
    // Check TTL
    if (Date.now() - cached.timestamp > this.CACHE_TTL) {
      this.screenResolutionCache.delete(screenResolution);
      return null;
    }
    
    return cached.deviceHashes;
  }
  
  /**
   * Mark a hash as recently checked but not found (negative cache)
   */
  markNotFound(hash: string): void {
    this.recentlyCheckedNotFound.add(hash);
    
    // Auto-cleanup after TTL
    setTimeout(() => {
      this.recentlyCheckedNotFound.delete(hash);
    }, this.NOT_FOUND_CACHE_TTL);
  }
  
  /**
   * Check if hash was recently checked and not found
   */
  wasRecentlyNotFound(hash: string): boolean {
    return this.recentlyCheckedNotFound.has(hash);
  }
  
  /**
   * Evict least recently used entries
   */
  private evictLeastRecentlyUsed(): void {
    let minUsageCount = Infinity;
    let lruKey: string | null = null;
    
    // Find entry with minimum usage count
    for (const [key, value] of this.deviceHashCache.entries()) {
      if (value.usageCount < minUsageCount) {
        minUsageCount = value.usageCount;
        lruKey = key;
      }
    }
    
    if (lruKey) {
      this.deviceHashCache.delete(lruKey);
      this.stats.evictions++;
    }
  }
  
  /**
   * Clean up expired entries
   */
  private cleanupExpiredEntries(): void {
    const now = Date.now();
    let cleaned = 0;
    
    // Clean device hash cache
    for (const [key, value] of this.deviceHashCache.entries()) {
      if (now - value.timestamp > this.CACHE_TTL) {
        this.deviceHashCache.delete(key);
        cleaned++;
      }
    }
    
    // Clean canvas hash cache
    for (const [key, value] of this.canvasHashCache.entries()) {
      if (now - value.timestamp > this.CACHE_TTL) {
        this.canvasHashCache.delete(key);
        cleaned++;
      }
    }
    
    // Clean screen resolution cache
    for (const [key, value] of this.screenResolutionCache.entries()) {
      if (now - value.timestamp > this.CACHE_TTL) {
        this.screenResolutionCache.delete(key);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      this.logger.info(`Cleaned up ${cleaned} expired cache entries`);
    }
  }
  
  /**
   * Warm up cache with recent devices
   */
  async warmUpCache(recentDevices: Array<{
    hash: string;
    userId: string;
    components?: {
      rendering?: { canvasFingerprint?: string };
      hardware?: { screenResolution?: string };
    };
  }>): Promise<void> {
    this.logger.info(`Warming up cache with ${recentDevices.length} recent devices...`);
    
    for (const device of recentDevices) {
      // Cache device hash
      this.cacheDevice(device.hash, device.userId);
      
      // Cache canvas fingerprint
      const canvasHash = device.components?.rendering?.canvasFingerprint;
      if (canvasHash) {
        this.cacheCanvasHash(canvasHash, device.userId);
      }
      
      // Cache screen resolution
      const screenRes = device.components?.hardware?.screenResolution;
      if (screenRes) {
        this.cacheScreenResolution(screenRes, device.hash);
      }
    }
    
    this.logger.info('Cache warm-up completed', this.getCacheStats());
  }
  
  /**
   * Clear all caches
   */
  clearCache(): void {
    this.deviceHashCache.clear();
    this.canvasHashCache.clear();
    this.screenResolutionCache.clear();
    this.recentlyCheckedNotFound.clear();
    
    // Reset stats
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      insertions: 0
    };
    
    this.logger.info('All caches cleared');
  }
  
  /**
   * Get cache statistics
   */
  getCacheStats(): {
    deviceCacheSize: number;
    canvasCacheSize: number;
    screenCacheSize: number;
    notFoundCacheSize: number;
    hits: number;
    misses: number;
    hitRate: number;
    evictions: number;
    insertions: number;
  } {
    const totalLookups = this.stats.hits + this.stats.misses;
    const hitRate = totalLookups > 0 ? this.stats.hits / totalLookups : 0;
    
    return {
      deviceCacheSize: this.deviceHashCache.size,
      canvasCacheSize: this.canvasHashCache.size,
      screenCacheSize: this.screenResolutionCache.size,
      notFoundCacheSize: this.recentlyCheckedNotFound.size,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hitRate: Math.round(hitRate * 100) / 100,
      evictions: this.stats.evictions,
      insertions: this.stats.insertions
    };
  }
  
  /**
   * Get memory usage estimate (approximate)
   */
  getMemoryUsageEstimate(): {
    deviceCache: string;
    canvasCache: string;
    screenCache: string;
    total: string;
  } {
    // Rough estimate: each entry ~100-200 bytes
    const deviceMemory = this.deviceHashCache.size * 150;
    const canvasMemory = this.canvasHashCache.size * 200;
    const screenMemory = this.screenResolutionCache.size * 150;
    const totalMemory = deviceMemory + canvasMemory + screenMemory;
    
    const formatBytes = (bytes: number): string => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    };
    
    return {
      deviceCache: formatBytes(deviceMemory),
      canvasCache: formatBytes(canvasMemory),
      screenCache: formatBytes(screenMemory),
      total: formatBytes(totalMemory)
    };
  }
}
