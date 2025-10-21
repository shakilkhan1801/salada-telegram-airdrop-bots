import { storage } from '../storage';
import { logger } from './logger';
import fs from 'fs-extra';
import path from 'path';
import { config } from '../config';

interface ErrorLogEntry {
  id?: string;
  timestamp: string;
  level: string;
  message: string;
  stack?: string;
  context?: Record<string, any>;
  raw: Record<string, any>;
  createdAt: string;
}

const MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024; // 1MB
const ERROR_LOG_COLLECTION = 'error_logs';

export class DatabaseErrorLogger {
  private static instance: DatabaseErrorLogger;
  private isInitialized = false;

  private constructor() {}

  static getInstance(): DatabaseErrorLogger {
    if (!DatabaseErrorLogger.instance) {
      DatabaseErrorLogger.instance = new DatabaseErrorLogger();
    }
    return DatabaseErrorLogger.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Create indexes for better query performance
      const inst = (storage as any).getStorageInstance?.();
      if (inst?.db) {
        await inst.db.collection(ERROR_LOG_COLLECTION).createIndex({ timestamp: -1 });
        await inst.db.collection(ERROR_LOG_COLLECTION).createIndex({ level: 1 });
        await inst.db.collection(ERROR_LOG_COLLECTION).createIndex({ createdAt: -1 });
        logger.info('Database error logger initialized with indexes');
      }

      this.isInitialized = true;

      // Start periodic cleanup
      this.startPeriodicCleanup();
    } catch (error) {
      logger.error('Failed to initialize database error logger', { error: (error as any)?.message });
    }
  }

  async logError(data: Record<string, any>): Promise<void> {
    try {
      const entry: ErrorLogEntry = {
        id: `err_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
        timestamp: data.timestamp || new Date().toISOString(),
        level: 'error',
        message: data.message || data.msg || '',
        stack: data.stack || data.error?.stack || '',
        context: {
          traceId: data.trace_id || data.traceId || data.context?.traceId,
          userId: data.userId || data.user_id || data.context?.userId,
          ...data.context,
        },
        raw: data,
        createdAt: new Date().toISOString(),
      };

      // Save to database
      await storage.set(ERROR_LOG_COLLECTION, entry, entry.id);

      // Check and rotate if needed
      await this.checkAndRotate();
    } catch (error) {
      // Don't log errors about logging to avoid infinite loops
      console.error('Failed to log error to database:', (error as any)?.message);
    }
  }

  private async checkAndRotate(): Promise<void> {
    try {
      // Get log file size
      const logFilePath = path.resolve(config.paths.logs, 'error.log');
      const exists = await fs.pathExists(logFilePath);
      
      if (!exists) return;

      const stats = await fs.stat(logFilePath);
      
      if (stats.size >= MAX_LOG_SIZE_BYTES) {
        logger.info(`Error log file size (${stats.size} bytes) exceeds 1MB limit, rotating...`);
        
        // Get all entries sorted by timestamp (oldest first)
        const allEntries = await storage.findByQuery<ErrorLogEntry>(
          ERROR_LOG_COLLECTION,
          {},
          { sort: { timestamp: 1 } }
        );

        // Calculate how many to delete (delete oldest 50% to make room)
        const deleteCount = Math.floor(allEntries.length * 0.5);
        
        if (deleteCount > 0) {
          const entriesToDelete = allEntries.slice(0, deleteCount);
          
          for (const entry of entriesToDelete) {
            if (entry.id) {
              await storage.delete(ERROR_LOG_COLLECTION, entry.id);
            }
          }
          
          logger.info(`Rotated error logs: deleted ${deleteCount} oldest entries from database`);
        }

        // Also truncate the file to newest entries only
        await this.truncateLogFile(logFilePath);
      }
    } catch (error) {
      logger.error('Failed to rotate error logs', { error: (error as any)?.message });
    }
  }

  private async truncateLogFile(filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const lines = content.split(/\r?\n/).filter(Boolean);
      
      // Keep only the newest 50% of lines
      const keepCount = Math.floor(lines.length * 0.5);
      const newContent = lines.slice(-keepCount).join('\n') + '\n';
      
      await fs.writeFile(filePath, newContent, 'utf8');
      logger.info(`Truncated error.log file, kept ${keepCount} newest entries`);
    } catch (error) {
      logger.error('Failed to truncate log file', { error: (error as any)?.message });
    }
  }

  private startPeriodicCleanup(): void {
    // Check every 5 minutes
    setInterval(() => {
      void this.checkAndRotate();
    }, 5 * 60 * 1000);
  }

  async getErrors(options: {
    limit?: number;
    search?: string;
    since?: Date;
  } = {}): Promise<{ entries: ErrorLogEntry[]; total: number }> {
    try {
      const limit = Math.min(options.limit || 200, 500);
      const query: any = {};

      if (options.search) {
        const searchRegex = { $regex: options.search, $options: 'i' };
        query.$or = [
          { message: searchRegex },
          { stack: searchRegex },
          { 'context.traceId': searchRegex },
        ];
      }

      if (options.since) {
        query.timestamp = { $gte: options.since.toISOString() };
      }

      const total = await storage.countDocuments(ERROR_LOG_COLLECTION, query);
      const entries = await storage.findByQuery<ErrorLogEntry>(
        ERROR_LOG_COLLECTION,
        query,
        { sort: { timestamp: -1 }, limit }
      );

      return { entries, total };
    } catch (error) {
      logger.error('Failed to fetch errors from database', { error: (error as any)?.message });
      return { entries: [], total: 0 };
    }
  }

  async deleteErrors(ids: string[]): Promise<number> {
    try {
      let deleted = 0;
      for (const id of ids) {
        const success = await storage.delete(ERROR_LOG_COLLECTION, id);
        if (success) deleted++;
      }
      return deleted;
    } catch (error) {
      logger.error('Failed to delete errors from database', { error: (error as any)?.message });
      return 0;
    }
  }

  async clearAllErrors(): Promise<number> {
    try {
      const all = await storage.findByQuery<ErrorLogEntry>(ERROR_LOG_COLLECTION, {});
      let deleted = 0;
      for (const entry of all) {
        if (entry.id) {
          const success = await storage.delete(ERROR_LOG_COLLECTION, entry.id);
          if (success) deleted++;
        }
      }
      logger.info(`Cleared ${deleted} error logs from database`);
      return deleted;
    } catch (error) {
      logger.error('Failed to clear error logs', { error: (error as any)?.message });
      return 0;
    }
  }
}

// Export singleton instance
export const databaseErrorLogger = DatabaseErrorLogger.getInstance();
