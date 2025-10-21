import * as fs from 'fs-extra';
import * as path from 'path';
import { uuidv4 } from '../services/uuid';
import { createLogger } from '../services/logger';
import { MemoryManager, ManagedCache } from '../services/memory-manager.service';

const logger = createLogger('AtomicOperations');

interface AtomicWriteOptions {
  spaces?: number;
  createBackup?: boolean;
  lockTimeout?: number;
  retryAttempts?: number;
  retryDelay?: number;
}

interface Transaction {
  id: string;
  operations: TransactionOperation[];
  createdAt: Date;
}

interface TransactionOperation {
  type: 'write' | 'delete' | 'rename';
  originalPath: string;
  backupPath?: string;
  tempPath?: string;
  data?: any;
  completed: boolean;
}

export class AtomicFileOperations {
  private static instance: AtomicFileOperations;
  private lockMap: ManagedCache<string, Promise<void>>;
  private activeTransactions: ManagedCache<string, Transaction>;
  private memoryManager = MemoryManager.getInstance();

  private constructor() {
    // Initialize managed caches to prevent unbounded growth
    this.lockMap = this.memoryManager.createCache<string, Promise<void>>(
      'atomic-ops-locks',
      'File operation locks cache',
      {
        max: 1000, // Limit concurrent locks
        ttl: 30 * 1000 // 30 second TTL for stale locks
      }
    );
    
    this.activeTransactions = this.memoryManager.createCache<string, Transaction>(
      'atomic-ops-transactions',
      'Active file transactions cache',
      {
        max: 100, // Limit concurrent transactions
        ttl: 5 * 60 * 1000 // 5 minute TTL for stale transactions
      }
    );
  }

  public static getInstance(): AtomicFileOperations {
    if (!AtomicFileOperations.instance) {
      AtomicFileOperations.instance = new AtomicFileOperations();
    }
    return AtomicFileOperations.instance;
  }

  /**
   * Atomically write JSON data to a file
   * Uses temp file + rename pattern to ensure atomicity
   */
  public async writeJsonAtomic(
    filePath: string, 
    data: any, 
    options: AtomicWriteOptions = {}
  ): Promise<boolean> {
    const lockKey = this.getLockKey(filePath);
    
    // Acquire file lock
    await this.acquireLock(lockKey, options.lockTimeout || 5000);
    
    try {
      return await this._writeJsonAtomicInternal(filePath, data, options);
    } finally {
      this.releaseLock(lockKey);
    }
  }

  /**
   * Synchronous version of atomic write
   */
  public writeJsonAtomicSync(
    filePath: string,
    data: any,
    options: AtomicWriteOptions = {}
  ): boolean {
    try {
      const tempPath = this.getTempPath(filePath);
      const backupPath = options.createBackup ? this.getBackupPath(filePath) : null;

      // Create backup if requested and file exists
      if (backupPath && fs.existsSync(filePath)) {
        fs.copyFileSync(filePath, backupPath);
        logger.debug(`Created backup: ${backupPath}`);
      }

      // Ensure directory exists
      fs.ensureDirSync(path.dirname(filePath));
      fs.ensureDirSync(path.dirname(tempPath));

      // Write to temp file
      fs.writeJsonSync(tempPath, data, { spaces: options.spaces || 2 });

      // Atomic rename
      fs.renameSync(tempPath, filePath);

      logger.debug(`Atomically wrote file: ${filePath}`);
      return true;

    } catch (error) {
      logger.error(`Atomic write failed for ${filePath}:`, error);
      return false;
    }
  }

  /**
   * Begin a transaction for multiple file operations
   */
  public beginTransaction(): string {
    const transactionId = uuidv4();
    const transaction: Transaction = {
      id: transactionId,
      operations: [],
      createdAt: new Date()
    };
    
    this.activeTransactions.set(transactionId, transaction);
    logger.debug(`Started transaction: ${transactionId}`);
    return transactionId;
  }

  /**
   * Add a write operation to the transaction
   */
  public addTransactionWrite(
    transactionId: string,
    filePath: string,
    data: any,
    options: AtomicWriteOptions = {}
  ): boolean {
    const transaction = this.activeTransactions.get(transactionId);
    if (!transaction) {
      logger.error(`Transaction not found: ${transactionId}`);
      return false;
    }

    const operation: TransactionOperation = {
      type: 'write',
      originalPath: filePath,
      tempPath: this.getTempPath(filePath),
      backupPath: options.createBackup ? this.getBackupPath(filePath) : undefined,
      data,
      completed: false
    };

    transaction.operations.push(operation);
    return true;
  }

  /**
   * Commit all operations in a transaction
   */
  public async commitTransaction(transactionId: string): Promise<boolean> {
    const transaction = this.activeTransactions.get(transactionId);
    if (!transaction) {
      logger.error(`Transaction not found: ${transactionId}`);
      return false;
    }

    try {
      // Execute all operations
      for (const operation of transaction.operations) {
        await this.executeTransactionOperation(operation);
      }

      // Transaction completed successfully
      this.activeTransactions.delete(transactionId);
      logger.info(`Transaction committed successfully: ${transactionId}`);
      return true;

    } catch (error) {
      logger.error(`Transaction commit failed: ${transactionId}`, error);
      await this.rollbackTransaction(transactionId);
      return false;
    }
  }

  /**
   * Rollback a transaction by restoring backups
   */
  public async rollbackTransaction(transactionId: string): Promise<void> {
    const transaction = this.activeTransactions.get(transactionId);
    if (!transaction) {
      logger.warn(`Cannot rollback - transaction not found: ${transactionId}`);
      return;
    }

    logger.warn(`Rolling back transaction: ${transactionId}`);

    for (const operation of transaction.operations) {
      if (operation.completed && operation.backupPath) {
        try {
          if (await fs.pathExists(operation.backupPath)) {
            await fs.copy(operation.backupPath, operation.originalPath);
            await fs.remove(operation.backupPath);
            logger.debug(`Restored backup for: ${operation.originalPath}`);
          }
        } catch (error) {
          logger.error(`Failed to restore backup for ${operation.originalPath}:`, error);
        }
      }

      // Clean up temp files
      if (operation.tempPath) {
        try {
          await fs.remove(operation.tempPath);
        } catch (error) {
          // Ignore cleanup errors
        }
      }
    }

    this.activeTransactions.delete(transactionId);
    logger.warn(`Transaction rolled back: ${transactionId}`);
  }

  /**
   * Safely update user data with atomic operations and backup
   */
  public async safeUserDataUpdate(
    userId: string,
    filePath: string,
    updateFn: (userData: any) => any
  ): Promise<boolean> {
    const lockKey = this.getLockKey(filePath);
    
    await this.acquireLock(lockKey);
    
    try {
      // Read existing data
      let userData = {};
      if (await fs.pathExists(filePath)) {
        userData = await fs.readJson(filePath);
      }

      // Apply update function
      const updatedData = updateFn(userData);

      // Atomic write with backup
      return await this.writeJsonAtomic(filePath, updatedData, {
        createBackup: true,
        spaces: 2
      });

    } catch (error) {
      logger.error(`Safe user data update failed for ${userId}:`, error);
      return false;
    } finally {
      this.releaseLock(lockKey);
    }
  }

  /**
   * Batch atomic operations for multiple files
   */
  public async batchAtomicWrites(
    operations: Array<{ filePath: string; data: any; options?: AtomicWriteOptions }>
  ): Promise<boolean[]> {
    const results: boolean[] = [];
    
    // Execute all operations in parallel
    const promises = operations.map(async (op) => {
      return await this.writeJsonAtomic(op.filePath, op.data, op.options);
    });

    try {
      const batchResults = await Promise.allSettled(promises);
      
      for (const result of batchResults) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          results.push(false);
          logger.error('Batch operation failed:', result.reason);
        }
      }

      return results;
    } catch (error) {
      logger.error('Batch atomic writes failed:', error);
      return operations.map(() => false);
    }
  }

  /**
   * Recovery function to find and clean up orphaned temp files
   */
  public async cleanupTempFiles(baseDir: string): Promise<void> {
    try {
      const tempPattern = /\.tmp\.\d+$/;
      const backupPattern = /\.backup\.\d+$/;
      
      const cleanup = async (dir: string) => {
        if (!(await fs.pathExists(dir))) return;
        
        const entries = await fs.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          
          if (entry.isDirectory()) {
            await cleanup(fullPath);
          } else if (tempPattern.test(entry.name) || backupPattern.test(entry.name)) {
            // Check if file is older than 1 hour
            const stats = await fs.stat(fullPath);
            const ageMs = Date.now() - stats.mtime.getTime();
            
            if (ageMs > 3600000) { // 1 hour
              await fs.remove(fullPath);
              logger.debug(`Cleaned up old temp file: ${fullPath}`);
            }
          }
        }
      };

      await cleanup(baseDir);
      logger.info(`Temp file cleanup completed for: ${baseDir}`);
    } catch (error) {
      logger.error('Temp file cleanup failed:', error);
    }
  }

  // Private helper methods

  private async _writeJsonAtomicInternal(
    filePath: string,
    data: any,
    options: AtomicWriteOptions
  ): Promise<boolean> {
    let retryCount = 0;
    const maxRetries = options.retryAttempts || 3;
    const retryDelay = options.retryDelay || 100;

    while (retryCount <= maxRetries) {
      try {
        const tempPath = this.getTempPath(filePath);
        const backupPath = options.createBackup ? this.getBackupPath(filePath) : null;

        // Create backup if requested and file exists
        if (backupPath && (await fs.pathExists(filePath))) {
          await fs.copy(filePath, backupPath);
          logger.debug(`Created backup: ${backupPath}`);
        }

        // Ensure directories exist
        await fs.ensureDir(path.dirname(filePath));
        await fs.ensureDir(path.dirname(tempPath));

        // Write to temp file
        await fs.writeJson(tempPath, data, { spaces: options.spaces || 2 });

        // Verify temp file was written correctly
        const tempData = await fs.readJson(tempPath);
        if (JSON.stringify(tempData) !== JSON.stringify(data)) {
          throw new Error('Temp file verification failed');
        }

        // Atomic rename
        await fs.rename(tempPath, filePath);

        logger.debug(`Atomically wrote file: ${filePath}`);
        return true;

      } catch (error) {
        retryCount++;
        logger.warn(`Atomic write attempt ${retryCount} failed for ${filePath}:`, error);
        
        if (retryCount <= maxRetries) {
          await this.sleep(retryDelay * retryCount);
        }
      }
    }

    logger.error(`All atomic write attempts failed for ${filePath}`);
    return false;
  }

  private async executeTransactionOperation(operation: TransactionOperation): Promise<void> {
    if (operation.type === 'write') {
      // Create backup if specified
      if (operation.backupPath && (await fs.pathExists(operation.originalPath))) {
        await fs.copy(operation.originalPath, operation.backupPath);
      }

      // Write to temp file first
      if (operation.tempPath) {
        await fs.ensureDir(path.dirname(operation.tempPath));
        await fs.writeJson(operation.tempPath, operation.data, { spaces: 2 });

        // Atomic rename
        await fs.rename(operation.tempPath, operation.originalPath);
      }

      operation.completed = true;
    }
  }

  private getLockKey(filePath: string): string {
    return path.resolve(filePath);
  }

  private async acquireLock(lockKey: string, timeout: number = 5000): Promise<void> {
    const existingLock = this.lockMap.get(lockKey);
    if (existingLock) {
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => reject(new Error(`Lock timeout for ${lockKey}`)), timeout);
      });

      await Promise.race([existingLock, timeoutPromise]);
    }

    let resolveLock: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      resolveLock = resolve;
    });

    this.lockMap.set(lockKey, lockPromise);
  }

  private releaseLock(lockKey: string): void {
    const lock = this.lockMap.get(lockKey);
    if (lock) {
      this.lockMap.delete(lockKey);
      // The promise resolves automatically when deleted
    }
  }

  /**
   * Cleanup resources when shutting down
   */
  public destroy(): void {
    this.memoryManager.clearManagedCache('atomic-ops-locks');
    this.memoryManager.clearManagedCache('atomic-ops-transactions');
  }

  private getTempPath(filePath: string): string {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const basename = path.basename(filePath, ext);
    return path.join(dir, `${basename}.tmp.${Date.now()}${ext}`);
  }

  private getBackupPath(filePath: string): string {
    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const basename = path.basename(filePath, ext);
    return path.join(dir, `${basename}.backup.${Date.now()}${ext}`);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Export singleton instance
export const atomicOps = AtomicFileOperations.getInstance();

// Export helper functions for common operations
export async function writeJsonSafe(
  filePath: string,
  data: any,
  options: AtomicWriteOptions = {}
): Promise<boolean> {
  return await atomicOps.writeJsonAtomic(filePath, data, options);
}

export function writeJsonSafeSync(
  filePath: string,
  data: any,
  options: AtomicWriteOptions = {}
): boolean {
  return atomicOps.writeJsonAtomicSync(filePath, data, options);
}

export async function safeUserUpdate(
  userId: string,
  filePath: string,
  updateFn: (userData: any) => any
): Promise<boolean> {
  return await atomicOps.safeUserDataUpdate(userId, filePath, updateFn);
}

// Point transaction helpers for critical user data
export class PointsTransaction {
  private transactionId: string;
  private atomic: AtomicFileOperations;
  
  constructor() {
    this.atomic = AtomicFileOperations.getInstance();
    this.transactionId = this.atomic.beginTransaction();
  }

  addPointsUpdate(userId: string, filePath: string, pointsDelta: number): boolean {
    return this.atomic.addTransactionWrite(
      this.transactionId,
      filePath,
      { pointsDelta, timestamp: new Date().toISOString() },
      { createBackup: true }
    );
  }

  async commit(): Promise<boolean> {
    return await this.atomic.commitTransaction(this.transactionId);
  }

  async rollback(): Promise<void> {
    await this.atomic.rollbackTransaction(this.transactionId);
  }
}

export default atomicOps;