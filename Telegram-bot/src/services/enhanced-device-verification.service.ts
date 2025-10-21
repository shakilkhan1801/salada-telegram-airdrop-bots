import crypto from 'crypto';
import { Logger } from './logger';
import { getConfig } from '../config';
import { StorageManager } from '../storage';
import { DeviceCacheService } from './device-cache.service';

export interface DeviceVerificationResult {
  status: 'instant_allow' | 'instant_block' | 'pending_verification' | 'blocked';
  reason: string;
  confidence: number;
  processingTime: number;
  cached: boolean;
  jobId?: string;
  similarDevices?: any[];
}

export interface DeviceFingerprintData {
  hash: string;
  userId: string;
  components: Record<string, any>;
  metadata?: Record<string, any>;
}

export interface SimilaritySearchJob {
  fingerprint: DeviceFingerprintData;
  threshold: number;
  userId: string;
  timestamp: number;
}

export class EnhancedDeviceVerificationService {
  private readonly logger = Logger.getInstance();
  private readonly config = getConfig();
  private readonly storage = StorageManager.getInstance();
  private readonly cache = DeviceCacheService.getInstance(); // OPTIMIZATION: Add cache

  private readonly CACHE_TTL = {
    EXACT_HASH: 3600,
    BLOCK_LIST: 1800,
    SIMILARITY_RESULT: 300,
    USER_DEVICE_COUNT: 600,
  };

  private readonly INSTANT_RESPONSE_TIMEOUT = 50;
  private readonly MAX_SIMILARITY_BATCH = 100; // OPTIMIZATION: Reduced from 1000 to 100
  
  private isInitialized = false;

  constructor() {
    // Warm up cache on initialization
    this.initializeCache().catch(err => {
      this.logger.error('Failed to warm up cache:', err);
    });
  }
  
  /**
   * Initialize and warm up the cache with recent devices
   * OPTIMIZATION: Preload frequently accessed data
   */
  private async initializeCache(): Promise<void> {
    if (this.isInitialized) return;
    
    try {
      this.logger.info('Warming up device fingerprint cache...');
      const recentDevices = await this.storage.getRecentDeviceFingerprints(30); // Last 30 days
      await this.cache.warmUpCache(recentDevices);
      this.isInitialized = true;
      this.logger.info('Cache warm-up completed', this.cache.getCacheStats());
    } catch (error) {
      this.logger.error('Cache initialization failed:', error);
    }
  }

  async verifyDeviceFingerprint(
    fingerprint: DeviceFingerprintData
  ): Promise<DeviceVerificationResult> {
    const startTime = Date.now();
    const { hash, userId } = fingerprint;

    try {
      const exactMatch = await this.checkExactHashMatch(hash);
      if (exactMatch.found) {
        const processingTime = Date.now() - startTime;

        if (exactMatch.blocked) {
          return {
            status: 'instant_block',
            reason: 'Device hash found in block list',
            confidence: 1.0,
            processingTime,
            cached: exactMatch.cached,
          };
        }

        if (exactMatch.existingUser && exactMatch.existingUser !== userId) {
          return {
            status: 'instant_block',
            reason: 'Device already registered to different user',
            confidence: 1.0,
            processingTime,
            cached: exactMatch.cached,
            similarDevices: [exactMatch.deviceData],
          };
        }

        return {
          status: 'instant_allow',
          reason: 'Device hash verified and allowed',
          confidence: 1.0,
          processingTime,
          cached: exactMatch.cached,
        };
      }

      const userDeviceCount = await this.getUserDeviceCount(userId);
      const maxDevicesPerUser = this.config.security.maxDevicesPerUser || 3;

      if (userDeviceCount >= maxDevicesPerUser) {
        return {
          status: 'instant_block',
          reason: `User exceeded maximum devices limit (${maxDevicesPerUser})`,
          confidence: 0.9,
          processingTime: Date.now() - startTime,
          cached: false,
        };
      }

      const jobId = await this.queueSimilaritySearch(fingerprint);
      await this.cacheDeviceFingerprint(fingerprint);

      const processingTime = Date.now() - startTime;

      return {
        status: 'pending_verification',
        reason: 'New device - background verification queued',
        confidence: 0.7,
        processingTime,
        cached: false,
        jobId,
      };
    } catch (error) {
      this.logger.error('Device verification error:', error);

      return {
        status: 'pending_verification',
        reason: 'Verification service error - defaulting to pending',
        confidence: 0.5,
        processingTime: Date.now() - startTime,
        cached: false,
      };
    }
  }

  private async checkExactHashMatch(hash: string): Promise<{
    found: boolean;
    blocked: boolean;
    existingUser?: string;
    deviceData?: any;
    cached: boolean;
  }> {
    try {
      // OPTIMIZATION Step 1: Check in-memory cache first (< 1ms)
      const cachedUserId = this.cache.getCachedDevice(hash);
      if (cachedUserId) {
        this.logger.debug('Cache HIT for device hash', { hash: hash.substring(0, 8) });
        return {
          found: true,
          blocked: false,
          existingUser: cachedUserId,
          deviceData: { userId: cachedUserId, hash },
          cached: true
        };
      }
      
      // OPTIMIZATION Step 2: Check negative cache (recently checked but not found)
      if (this.cache.wasRecentlyNotFound(hash)) {
        return { found: false, blocked: false, cached: true };
      }
      
      // OPTIMIZATION Step 3: Database lookup with index (< 10ms)
      // This uses the index on deviceFingerprints.hash
      const deviceData = await this.storage.getEnhancedDeviceFingerprint(hash);
      if (deviceData) {
        // Cache for future lookups
        this.cache.cacheDevice(hash, deviceData.userId);
        
        // Also cache canvas fingerprint if available
        const canvasHash = deviceData.components?.rendering?.canvasFingerprint;
        if (canvasHash) {
          this.cache.cacheCanvasHash(canvasHash, deviceData.userId);
        }
        
        return {
          found: true,
          blocked: false,
          existingUser: deviceData.userId,
          deviceData,
          cached: false
        };
      }

      // OPTIMIZATION Step 4: Block list lookup (indexed)
      const banned = await this.storage.getBannedDevice?.(hash);
      if (banned) {
        return { found: true, blocked: true, cached: false };
      }
      
      // Mark as not found in cache to avoid repeated DB queries
      this.cache.markNotFound(hash);

      return { found: false, blocked: false, cached: false };
    } catch (error) {
      this.logger.error('Error in exact hash check:', error);
      return { found: false, blocked: false, cached: false };
    }
  }

  private async getUserDeviceCount(userId: string): Promise<number> {
    try {
      const devices = await this.storage.getDeviceFingerprintsByUser(userId);
      return devices.length;
    } catch (error) {
      this.logger.error('Error getting user device count:', error);
      return 0;
    }
  }

  private async queueSimilaritySearch(fingerprint: DeviceFingerprintData): Promise<string> {
    const jobId = `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job: SimilaritySearchJob = {
      fingerprint,
      threshold: this.config.security.similarityThreshold || 0.85,
      userId: fingerprint.userId,
      timestamp: Date.now(),
    };

    setTimeout(() => {
      this.processSimilaritySearch(job).catch(err => {
        this.logger.error('Background similarity search failed:', err);
      });
    }, 1000);

    return jobId;
  }

  private async processSimilaritySearch(job: SimilaritySearchJob): Promise<any> {
    const { fingerprint, threshold, userId } = job;
    const startTime = Date.now();

    try {
      const similarDevices = await this.findSimilarDevicesOptimized(fingerprint, threshold);

      if (similarDevices.length > 0) {
        this.logger.warn(`Similar devices found for user ${userId}`, {
          deviceHash: fingerprint.hash,
          similarCount: similarDevices.length,
          processingTime: Date.now() - startTime,
        });

        const highSimilarity = similarDevices.filter(d => d.similarity > 0.95);
        if (highSimilarity.length > 0) {
          await this.flagSuspiciousDevice(fingerprint, highSimilarity);
        }
      }

      return {
        processed: true,
        similarCount: similarDevices.length,
        processingTime: Date.now() - startTime,
      };
    } catch (error) {
      this.logger.error('Error processing similarity search:', error);
      throw error;
    }
  }

  private async findSimilarDevicesOptimized(
    fingerprint: DeviceFingerprintData,
    threshold: number
  ): Promise<any[]> {
    try {
      // OPTIMIZATION: Multi-level search strategy
      const startTime = Date.now();
      
      // Step 1: Check canvas fingerprint cache (< 1ms)
      const canvasHash = fingerprint.components?.rendering?.canvasFingerprint;
      if (canvasHash) {
        const cachedUsers = this.cache.getCachedCanvasUsers(canvasHash);
        if (cachedUsers && cachedUsers.length > 0) {
          // Filter out current user
          const otherUsers = cachedUsers.filter(uid => uid !== fingerprint.userId);
          if (otherUsers.length > 0) {
            this.logger.info('Canvas cache HIT - similar devices found', {
              count: otherUsers.length,
              time: Date.now() - startTime
            });
            return otherUsers.map(userId => ({
              userId,
              hash: 'from-cache',
              similarity: 1.0 // Exact canvas match
            }));
          }
        }
      }
      
      // Step 2: Indexed canvas fingerprint lookup (< 10ms)
      if (canvasHash) {
        const canvasDevices = await this.storage.findDevicesByCanvas(canvasHash);
        if (canvasDevices.length > 0) {
          const similar = canvasDevices
            .filter(d => d.hash !== fingerprint.hash && d.userId !== fingerprint.userId)
            .slice(0, this.MAX_SIMILARITY_BATCH)
            .map(d => ({ ...d, similarity: 1.0 })); // Exact canvas match
          
          if (similar.length > 0) {
            this.logger.info('Canvas index lookup - similar devices found', {
              count: similar.length,
              time: Date.now() - startTime
            });
            return similar;
          }
        }
      }
      
      // Step 3: Indexed screen resolution lookup (< 20ms)
      const screenRes = fingerprint.components?.hardware?.screenResolution;
      if (screenRes) {
        // Check cache first
        const cachedScreenDevices = this.cache.getCachedScreenDevices(screenRes);
        let candidates: any[];
        
        if (cachedScreenDevices) {
          // Fetch full device data for cached hashes
          const hashes = cachedScreenDevices.slice(0, this.MAX_SIMILARITY_BATCH);
          const deviceMap = await this.storage.batchGetDeviceFingerprints(hashes);
          candidates = Array.from(deviceMap.values());
        } else {
          // Indexed database query
          candidates = await this.storage.findDevicesByScreenResolution(screenRes);
          candidates = candidates.slice(0, this.MAX_SIMILARITY_BATCH);
          
          // Cache screen resolution mapping
          candidates.forEach(c => {
            this.cache.cacheScreenResolution(screenRes, c.hash);
          });
        }
        
        // Calculate similarity only for candidates with same screen resolution
        const similar: any[] = [];
        for (const candidate of candidates) {
          if (candidate.hash !== fingerprint.hash && candidate.userId !== fingerprint.userId) {
            const similarity = this.calculateOptimizedSimilarity(fingerprint, candidate);
            if (similarity >= threshold) {
              similar.push({ ...candidate, similarity });
            }
          }
        }
        
        if (similar.length > 0) {
          this.logger.info('Screen resolution search completed', {
            candidatesChecked: candidates.length,
            similarFound: similar.length,
            time: Date.now() - startTime
          });
          return similar.sort((a, b) => b.similarity - a.similarity);
        }
      }
      
      // Step 4: WebGL renderer lookup (if available)
      const webglRenderer = fingerprint.components?.rendering?.webGLRenderer;
      if (webglRenderer) {
        const webglDevices = await this.storage.findDevicesByWebGLRenderer(webglRenderer);
        if (webglDevices.length > 0) {
          const candidates = webglDevices.slice(0, this.MAX_SIMILARITY_BATCH);
          const similar: any[] = [];
          
          for (const candidate of candidates) {
            if (candidate.hash !== fingerprint.hash && candidate.userId !== fingerprint.userId) {
              const similarity = this.calculateOptimizedSimilarity(fingerprint, candidate);
              if (similarity >= threshold) {
                similar.push({ ...candidate, similarity });
              }
            }
          }
          
          if (similar.length > 0) {
            return similar.sort((a, b) => b.similarity - a.similarity);
          }
        }
      }
      
      // No similar devices found
      this.logger.debug('No similar devices found', {
        userId: fingerprint.userId,
        time: Date.now() - startTime
      });
      
      return [];
    } catch (error) {
      this.logger.error('Error in optimized similarity search:', error);
      return [];
    }
  }

  private buildSearchCriteria(fingerprint: DeviceFingerprintData): any {
    const criteria: any = { $or: [] };

    if (fingerprint.components?.hardware?.screenResolution) {
      criteria.$or.push({
        'components.hardware.screenResolution': fingerprint.components.hardware.screenResolution
      });
    }

    if (fingerprint.components?.rendering?.canvasFingerprint) {
      criteria.$or.push({
        'components.rendering.canvasFingerprint': fingerprint.components.rendering.canvasFingerprint
      });
    }

    if (fingerprint.components?.browser?.userAgent) {
      criteria.$or.push({
        'components.browser.userAgent': fingerprint.components.browser.userAgent
      });
    }

    return criteria.$or.length > 0 ? criteria : {};
  }

  private matchesSearchCriteria(candidate: any, criteria: any): boolean {
    if (!criteria || Object.keys(criteria).length === 0) return true;
    if (Array.isArray(criteria.$or)) {
      return criteria.$or.some((cond: any) => this.matchCondition(candidate, cond));
    }
    return this.matchCondition(candidate, criteria);
  }

  private matchCondition(candidate: any, condition: any): boolean {
    return Object.entries(condition).every(([path, expected]) => {
      return this.getNestedValue(candidate, path) === expected;
    });
  }

  private calculateOptimizedSimilarity(fp1: DeviceFingerprintData, fp2: any): number {
    const weights = {
      canvasFingerprint: 0.4,
      screenResolution: 0.25,
      webGLRenderer: 0.15,
      userAgent: 0.1,
      platform: 0.05,
      hardwareConcurrency: 0.05,
    } as const;

    let totalWeight = 0;
    let matchedWeight = 0;

    Object.entries(weights).forEach(([key, weight]) => {
      totalWeight += weight;
      const val1 = this.getNestedValue(fp1, `components.${key}`);
      const val2 = this.getNestedValue(fp2, `components.${key}`);
      if (val1 && val2 && val1 === val2) matchedWeight += weight;
    });

    return totalWeight > 0 ? matchedWeight / totalWeight : 0;
  }

  private async cacheDeviceFingerprint(fingerprint: DeviceFingerprintData): Promise<void> {
    try {
      await this.storage.saveEnhancedDeviceFingerprint(fingerprint);
    } catch (error) {
      this.logger.error('Error caching device fingerprint:', error);
    }
  }

  private async flagSuspiciousDevice(fingerprint: DeviceFingerprintData, similarDevices: any[]): Promise<void> {
    try {
      const suspiciousActivity = {
        type: 'similar_device_detected',
        userId: fingerprint.userId,
        deviceHash: fingerprint.hash,
        similarDevices: similarDevices.map(d => ({
          hash: d.hash,
          userId: d.userId,
          similarity: d.similarity,
        })),
        timestamp: new Date().toISOString(),
        severity: 'high',
        autoBlock: similarDevices.some(d => d.similarity > 0.98),
      };

      await this.storage.saveSuspiciousActivity(suspiciousActivity);

      if (suspiciousActivity.autoBlock) {
        await this.blockDeviceHash(fingerprint.hash, 'Extremely similar device detected');
      }
    } catch (error) {
      this.logger.error('Error flagging suspicious device:', error);
    }
  }

  private async blockDeviceHash(hash: string, reason: string): Promise<void> {
    try {
      await this.storage.saveBannedDevice({
        hash,
        reason,
        blockedAt: new Date().toISOString(),
        blockedBy: 'automated_system',
      });
      this.logger.warn(`Device hash blocked: ${hash}`, { reason });
    } catch (error) {
      this.logger.error('Error blocking device hash:', error);
    }
  }

  async getCachedSimilarityResult(_deviceHash: string): Promise<any | null> {
    return null;
  }

  private getNestedValue(obj: any, path: string): any {
    return path.split('.').reduce((current, key) => current?.[key], obj);
  }

  async shutdown(): Promise<void> {
    // No external resources to close in in-memory implementation
  }

  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
  }> {
    return { status: 'healthy' };
  }
}
