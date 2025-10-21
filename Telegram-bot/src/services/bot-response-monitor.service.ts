import { storage } from '../storage';
import { logger } from './logger';
import EventEmitter from 'events';

interface ResponseLogEntry {
  id: string;
  timestamp: string;
  command: string;
  action: string; // e.g., 'button_click', 'command', 'callback'
  responseTime: number;
  userId: string;
  username?: string;
  success: boolean;
  error?: string;
  metadata?: Record<string, any>;
}

interface ResponseRecord {
  id: string;
  command: string;
  action: string;
  maxResponseTime: number;
  avgResponseTime: number;
  minResponseTime: number;
  lastResponseTime: number;
  count: number;
  lastOccurrence: string;
  updatedAt: string;
}

const LIVE_LOG_COLLECTION = 'bot_response_live_logs';
const RECORDS_COLLECTION = 'bot_response_records';
const MAX_LIVE_LOG_SIZE_BYTES = 5 * 1024; // 5KB
const MAX_RECORDS_SIZE_BYTES = 5 * 1024; // 5KB

// Performance & Safety Configuration
const CONFIG = {
  ENABLED: process.env.BOT_MONITORING_ENABLED !== 'false', // Can disable in production if needed
  SAMPLING_RATE: parseFloat(process.env.BOT_MONITORING_SAMPLE_RATE || '1.0'), // 1.0 = 100%, 0.1 = 10%
  BATCH_SIZE: parseInt(process.env.BOT_MONITORING_BATCH_SIZE || '10', 10), // Process in batches
  BATCH_INTERVAL_MS: parseInt(process.env.BOT_MONITORING_BATCH_INTERVAL || '5000', 10), // 5 seconds
  MAX_QUEUE_SIZE: parseInt(process.env.BOT_MONITORING_MAX_QUEUE || '1000', 10), // Drop if exceeded
  ROTATION_CHECK_INTERVAL: 5 * 60 * 1000, // 5 minutes (not every request!)
  CIRCUIT_BREAKER_THRESHOLD: 10, // Failures before disabling
  CIRCUIT_BREAKER_TIMEOUT: 60 * 1000, // 1 minute cooldown
};

export class BotResponseMonitor extends EventEmitter {
  private static instance: BotResponseMonitor;
  private isInitialized = false;
  private writeQueue: ResponseLogEntry[] = [];
  private recordUpdateQueue: Map<string, ResponseLogEntry> = new Map();
  private batchProcessor: NodeJS.Timeout | null = null;
  private lastRotationCheck = Date.now();
  private failureCount = 0;
  private circuitBreakerOpen = false;
  private circuitBreakerTimeout: NodeJS.Timeout | null = null;
  private droppedCount = 0;

  private constructor() {
    super();
  }

  static getInstance(): BotResponseMonitor {
    if (!BotResponseMonitor.instance) {
      BotResponseMonitor.instance = new BotResponseMonitor();
    }
    return BotResponseMonitor.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    if (!CONFIG.ENABLED) {
      logger.info('Bot response monitoring is disabled');
      return;
    }

    try {
      // Create indexes
      const inst = (storage as any).getStorageInstance?.();
      if (inst?.db) {
        await inst.db.collection(LIVE_LOG_COLLECTION).createIndex({ timestamp: -1 });
        await inst.db.collection(RECORDS_COLLECTION).createIndex({ command: 1, action: 1 });
        await inst.db.collection(RECORDS_COLLECTION).createIndex({ maxResponseTime: -1 });
        logger.info('Bot response monitor initialized', {
          samplingRate: CONFIG.SAMPLING_RATE,
          batchSize: CONFIG.BATCH_SIZE,
          maxQueueSize: CONFIG.MAX_QUEUE_SIZE,
        });
      }

      this.isInitialized = true;

      // Start batch processor
      this.startBatchProcessor();

      // Start periodic cleanup
      this.startPeriodicCleanup();
    } catch (error) {
      logger.error('Failed to initialize bot response monitor', { error: (error as any)?.message });
      this.handleFailure();
    }
  }

  /**
   * Track a bot response (NON-BLOCKING)
   * This is the main entry point - must be fast and never throw
   */
  trackResponse(data: {
    command: string;
    action: string;
    responseTime: number;
    userId: string;
    username?: string;
    success?: boolean;
    error?: string;
    metadata?: Record<string, any>;
  }): void {
    // Fast bailout conditions
    if (!CONFIG.ENABLED || !this.isInitialized || this.circuitBreakerOpen) {
      return;
    }

    // Sampling: Only track X% of requests to reduce load
    if (Math.random() > CONFIG.SAMPLING_RATE) {
      return;
    }

    try {
      const entry: ResponseLogEntry = {
        id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        timestamp: new Date().toISOString(),
        command: data.command,
        action: data.action,
        responseTime: data.responseTime,
        userId: data.userId,
        username: data.username,
        success: data.success !== false,
        error: data.error,
        metadata: data.metadata,
      };

      // Check queue size limit
      if (this.writeQueue.length >= CONFIG.MAX_QUEUE_SIZE) {
        // Drop oldest entries to prevent memory issues
        this.writeQueue.shift();
        this.droppedCount++;
        if (this.droppedCount % 100 === 0) {
          logger.warn('Bot monitoring queue full, dropping old entries', {
            dropped: this.droppedCount,
            queueSize: this.writeQueue.length,
          });
        }
      }

      // Add to queue (non-blocking)
      this.writeQueue.push(entry);

      // Store for record aggregation (use latest per command+action)
      const recordKey = `${data.command}_${data.action}`;
      this.recordUpdateQueue.set(recordKey, entry);
    } catch (error) {
      // Never let monitoring break the bot
      // Just count the failure
      this.handleFailure();
    }
  }

  /**
   * Get monitoring health status
   */
  getHealthStatus(): {
    enabled: boolean;
    initialized: boolean;
    circuitBreakerOpen: boolean;
    queueSize: number;
    droppedCount: number;
    failureCount: number;
    samplingRate: number;
  } {
    return {
      enabled: CONFIG.ENABLED,
      initialized: this.isInitialized,
      circuitBreakerOpen: this.circuitBreakerOpen,
      queueSize: this.writeQueue.length,
      droppedCount: this.droppedCount,
      failureCount: this.failureCount,
      samplingRate: CONFIG.SAMPLING_RATE,
    };
  }

  /**
   * Get live logs
   */
  async getLiveLogs(limit: number = 100): Promise<ResponseLogEntry[]> {
    try {
      const logs = await storage.findByQuery<ResponseLogEntry>(
        LIVE_LOG_COLLECTION,
        {},
        { sort: { timestamp: -1 }, limit }
      );
      return logs;
    } catch (error) {
      logger.error('Failed to get live logs', { error: (error as any)?.message });
      return [];
    }
  }

  /**
   * Get records
   */
  async getRecords(options: {
    sortBy?: 'maxResponseTime' | 'avgResponseTime' | 'count';
    limit?: number;
  } = {}): Promise<ResponseRecord[]> {
    try {
      const sortBy = options.sortBy || 'maxResponseTime';
      const limit = options.limit || 100;
      
      const sortField = sortBy === 'maxResponseTime' ? { maxResponseTime: -1 } 
        : sortBy === 'avgResponseTime' ? { avgResponseTime: -1 }
        : { count: -1 };

      const records = await storage.findByQuery<ResponseRecord>(
        RECORDS_COLLECTION,
        {},
        { sort: sortField, limit }
      );
      return records;
    } catch (error) {
      logger.error('Failed to get records', { error: (error as any)?.message });
      return [];
    }
  }

  /**
   * Check and rotate live logs (10KB limit)
   */
  private async checkAndRotateLiveLogs(): Promise<void> {
    try {
      const allLogs = await storage.findByQuery<ResponseLogEntry>(
        LIVE_LOG_COLLECTION,
        {},
        { sort: { timestamp: 1 } } // Oldest first
      );

      if (allLogs.length === 0) return;

      // Estimate size (rough calculation)
      const estimatedSize = Buffer.byteLength(JSON.stringify(allLogs), 'utf8');

      if (estimatedSize > MAX_LIVE_LOG_SIZE_BYTES) {
        // Calculate how many to delete to get under limit
        // Delete oldest entries until size is ~80% of limit
        const targetSize = MAX_LIVE_LOG_SIZE_BYTES * 0.8;
        let currentSize = estimatedSize;
        let deleteCount = 0;

        for (const log of allLogs) {
          if (currentSize <= targetSize) break;
          
          const logSize = Buffer.byteLength(JSON.stringify(log), 'utf8');
          currentSize -= logSize;
          deleteCount++;
        }

        // Delete the oldest entries
        const logsToDelete = allLogs.slice(0, deleteCount);
        
        // Batch delete for performance
        await Promise.all(
          logsToDelete.map(log => storage.delete(LIVE_LOG_COLLECTION, log.id))
        );

        logger.info(`Rotated live logs: deleted ${deleteCount} oldest entries`, {
          oldSize: `${(estimatedSize / 1024).toFixed(2)}KB`,
          newSize: `${(currentSize / 1024).toFixed(2)}KB`,
          remaining: allLogs.length - deleteCount
        });
      }
    } catch (error) {
      logger.error('Failed to rotate live logs', { error: (error as any)?.message });
    }
  }

  /**
   * Check and rotate records (10KB limit)
   */
  private async checkAndRotateRecords(): Promise<void> {
    try {
      const allRecords = await storage.findByQuery<ResponseRecord>(
        RECORDS_COLLECTION,
        {},
        { sort: { updatedAt: 1 } } // Oldest updated first
      );

      if (allRecords.length === 0) return;

      // Estimate size
      const estimatedSize = Buffer.byteLength(JSON.stringify(allRecords), 'utf8');

      if (estimatedSize > MAX_RECORDS_SIZE_BYTES) {
        // Calculate how many to delete to get under limit
        const targetSize = MAX_RECORDS_SIZE_BYTES * 0.8;
        let currentSize = estimatedSize;
        let deleteCount = 0;

        for (const record of allRecords) {
          if (currentSize <= targetSize) break;
          
          const recordSize = Buffer.byteLength(JSON.stringify(record), 'utf8');
          currentSize -= recordSize;
          deleteCount++;
        }

        // Delete the oldest records
        const recordsToDelete = allRecords.slice(0, deleteCount);
        
        // Batch delete for performance
        await Promise.all(
          recordsToDelete.map(record => storage.delete(RECORDS_COLLECTION, record.id))
        );

        logger.info(`Rotated records: deleted ${deleteCount} oldest records`, {
          oldSize: `${(estimatedSize / 1024).toFixed(2)}KB`,
          newSize: `${(currentSize / 1024).toFixed(2)}KB`,
          remaining: allRecords.length - deleteCount
        });
      }
    } catch (error) {
      logger.error('Failed to rotate records', { error: (error as any)?.message });
    }
  }

  /**
   * Batch processor for async writes
   */
  private startBatchProcessor(): void {
    this.batchProcessor = setInterval(() => {
      void this.processBatch();
    }, CONFIG.BATCH_INTERVAL_MS);
  }

  /**
   * Process queued entries in batch
   */
  private async processBatch(): Promise<void> {
    if (this.circuitBreakerOpen || this.writeQueue.length === 0) {
      return;
    }

    try {
      // Take batch from queue
      const batch = this.writeQueue.splice(0, Math.min(CONFIG.BATCH_SIZE, this.writeQueue.length));
      const recordUpdates = new Map(this.recordUpdateQueue);
      this.recordUpdateQueue.clear();

      // Write logs in batch
      const logWrites = batch.map(entry => 
        storage.set(LIVE_LOG_COLLECTION, entry, entry.id).catch(err => {
          logger.error('Failed to write log entry', { error: err.message });
        })
      );

      // Update records in batch
      const recordWrites = Array.from(recordUpdates.values()).map(entry =>
        this.updateRecordAsync({
          command: entry.command,
          action: entry.action,
          responseTime: entry.responseTime,
        }).catch(err => {
          logger.error('Failed to update record', { error: err.message });
        })
      );

      // Execute all writes concurrently
      await Promise.all([...logWrites, ...recordWrites]);

      // Check rotation more frequently (every 30 seconds or if queue is large)
      const now = Date.now();
      const shouldCheckRotation = 
        now - this.lastRotationCheck > 30000 || // Every 30 seconds
        this.writeQueue.length > CONFIG.MAX_QUEUE_SIZE * 0.5; // Or if queue is 50% full

      if (shouldCheckRotation) {
        this.lastRotationCheck = now;
        // Run rotation checks in background
        void this.checkAndRotateLiveLogs();
        void this.checkAndRotateRecords();
      }

      // Reset failure count on success
      this.failureCount = 0;
    } catch (error) {
      logger.error('Batch processing failed', { error: (error as any)?.message });
      this.handleFailure();
    }
  }

  /**
   * Handle monitoring failures with circuit breaker
   */
  private handleFailure(): void {
    this.failureCount++;

    if (this.failureCount >= CONFIG.CIRCUIT_BREAKER_THRESHOLD) {
      this.circuitBreakerOpen = true;
      logger.error('Bot monitoring circuit breaker opened - too many failures', {
        failureCount: this.failureCount,
      });

      // Auto-reset after timeout
      if (this.circuitBreakerTimeout) {
        clearTimeout(this.circuitBreakerTimeout);
      }
      this.circuitBreakerTimeout = setTimeout(() => {
        this.circuitBreakerOpen = false;
        this.failureCount = 0;
        logger.info('Bot monitoring circuit breaker reset');
      }, CONFIG.CIRCUIT_BREAKER_TIMEOUT);
    }
  }

  /**
   * Update record async (internal use only)
   */
  private async updateRecordAsync(data: {
    command: string;
    action: string;
    responseTime: number;
  }): Promise<void> {
    const recordId = `${data.command}_${data.action}`.replace(/[^a-zA-Z0-9_]/g, '_');
    
    const existing = await storage.get<ResponseRecord>(RECORDS_COLLECTION, recordId);

    if (existing) {
      const newCount = existing.count + 1;
      const newAvg = ((existing.avgResponseTime * existing.count) + data.responseTime) / newCount;
      
      const updated: ResponseRecord = {
        ...existing,
        maxResponseTime: Math.max(existing.maxResponseTime, data.responseTime),
        minResponseTime: Math.min(existing.minResponseTime, data.responseTime),
        avgResponseTime: newAvg,
        lastResponseTime: data.responseTime,
        count: newCount,
        lastOccurrence: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await storage.set(RECORDS_COLLECTION, updated, recordId);
    } else {
      const newRecord: ResponseRecord = {
        id: recordId,
        command: data.command,
        action: data.action,
        maxResponseTime: data.responseTime,
        avgResponseTime: data.responseTime,
        minResponseTime: data.responseTime,
        lastResponseTime: data.responseTime,
        count: 1,
        lastOccurrence: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      await storage.set(RECORDS_COLLECTION, newRecord, recordId);
    }
  }

  /**
   * Periodic cleanup
   */
  private startPeriodicCleanup(): void {
    // Check every 5 minutes (less aggressive)
    setInterval(() => {
      if (!this.circuitBreakerOpen) {
        void this.checkAndRotateLiveLogs();
        void this.checkAndRotateRecords();
      }
    }, CONFIG.ROTATION_CHECK_INTERVAL);
  }

  /**
   * Get statistics
   */
  async getStatistics(): Promise<{
    liveLogsCount: number;
    recordsCount: number;
    slowestCommand: ResponseRecord | null;
    fastestCommand: ResponseRecord | null;
    averageResponseTime: number;
    liveLogsSizeKB: number;
    recordsSizeKB: number;
    liveLogsSizeLimit: string;
    recordsSizeLimit: string;
  }> {
    try {
      const logs = await storage.findByQuery<ResponseLogEntry>(LIVE_LOG_COLLECTION, {});
      const records = await storage.findByQuery<ResponseRecord>(
        RECORDS_COLLECTION,
        {},
        { sort: { maxResponseTime: -1 } }
      );

      const slowestCommand = records[0] || null;
      const fastestCommand = records.length > 0 
        ? records.reduce((min, r) => r.avgResponseTime < min.avgResponseTime ? r : min, records[0])
        : null;

      const avgResponseTime = records.length > 0
        ? records.reduce((sum, r) => sum + r.avgResponseTime, 0) / records.length
        : 0;

      // Calculate file sizes
      const liveLogsSizeBytes = Buffer.byteLength(JSON.stringify(logs), 'utf8');
      const recordsSizeBytes = Buffer.byteLength(JSON.stringify(records), 'utf8');

      return {
        liveLogsCount: logs.length,
        recordsCount: records.length,
        slowestCommand,
        fastestCommand,
        averageResponseTime: Math.round(avgResponseTime),
        liveLogsSizeKB: Math.round(liveLogsSizeBytes / 1024 * 10) / 10, // Round to 1 decimal
        recordsSizeKB: Math.round(recordsSizeBytes / 1024 * 10) / 10,
        liveLogsSizeLimit: `${MAX_LIVE_LOG_SIZE_BYTES / 1024}KB`,
        recordsSizeLimit: `${MAX_RECORDS_SIZE_BYTES / 1024}KB`,
      };
    } catch (error) {
      logger.error('Failed to get statistics', { error: (error as any)?.message });
      return {
        liveLogsCount: 0,
        recordsCount: 0,
        slowestCommand: null,
        fastestCommand: null,
        averageResponseTime: 0,
        liveLogsSizeKB: 0,
        recordsSizeKB: 0,
        liveLogsSizeLimit: `${MAX_LIVE_LOG_SIZE_BYTES / 1024}KB`,
        recordsSizeLimit: `${MAX_RECORDS_SIZE_BYTES / 1024}KB`,
      };
    }
  }

  /**
   * Clear all data (for testing/maintenance)
   */
  async clearAll(): Promise<void> {
    try {
      const logs = await storage.findByQuery<ResponseLogEntry>(LIVE_LOG_COLLECTION, {});
      const records = await storage.findByQuery<ResponseRecord>(RECORDS_COLLECTION, {});

      for (const log of logs) {
        await storage.delete(LIVE_LOG_COLLECTION, log.id);
      }

      for (const record of records) {
        await storage.delete(RECORDS_COLLECTION, record.id);
      }

      logger.info('Cleared all bot response monitor data');
    } catch (error) {
      logger.error('Failed to clear bot response monitor data', { error: (error as any)?.message });
    }
  }
}

export const botResponseMonitor = BotResponseMonitor.getInstance();
