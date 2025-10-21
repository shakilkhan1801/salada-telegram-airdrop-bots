import { BaseStorage } from './base-storage';
import { MongoStorage } from './implementations/mongodb-storage';
import { StorageAdapter, StorageStats, CleanupResult } from '../types';
import { config } from '../config';
import { logger } from '../services/logger';
import { TaskManager } from '../services/task-manager.service';
import { getTaskManagerConfig } from '../services/task-config.service';
import { Task, TaskFilter } from '../types/task.types';
import { MemoryManager } from '../services/memory-manager.service';

class StorageManager {
  private storage: BaseStorage | null = null;
  private isInitialized = false;
  private taskManager: TaskManager | null = null;
  private memoryManager = MemoryManager.getInstance();
  private keepAliveIntervalId?: string;

  async initialize(): Promise<void> {
    try {
      logger.info(`Initializing storage: ${config.storage.source.toUpperCase()}`);
      
      logger.info('🚀 Initializing MongoDB storage...');
      this.storage = new MongoStorage();
      logger.info('🍃 Using MongoDB storage');

      if (this.storage) {
        await this.storage.initialize();
      }
      
      // Initialize TaskManager
      const taskConfig = getTaskManagerConfig();
      this.taskManager = TaskManager.getInstance(taskConfig);
      await this.taskManager.initialize();
      
      this.isInitialized = true;
      this.startKeepAlive();
      
      logger.info(`✅ Storage initialized successfully (${config.storage.source})`);
    } catch (error) {
      logger.error(`❌ Failed to initialize storage: ${error}`);
      
      throw error;
    }
  }

  private ensureInitialized(): void {
    if (!this.isInitialized || !this.storage) {
      throw new Error('Storage not initialized. Call initialize() first.');
    }
  }

  async get<T>(collection: string, id?: string): Promise<T | null> {
    this.ensureInitialized();
    return await this.storage!.get<T>(collection, id);
  }

  async set<T>(collection: string, data: T, id?: string): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.set<T>(collection, data, id);
  }

  async update<T>(collection: string, updates: Partial<T>, id?: string): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.update<T>(collection, updates, id);
  }

  async delete(collection: string, id?: string): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.delete(collection, id);
  }

  async exists(collection: string, id?: string): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.exists(collection, id);
  }

  async list(collection?: string): Promise<string[]> {
    this.ensureInitialized();
    return await this.storage!.list(collection);
  }

  async countDocuments(collection: string, query: any = {}): Promise<number> {
    this.ensureInitialized();
    const s: any = this.storage! as any;
    if (typeof s.count === 'function') {
      return await s.count(collection, query);
    }
    return 0;
  }

  async findByQuery<T = any>(collection: string, query: any, options?: any): Promise<T[]> {
    this.ensureInitialized();
    const s: any = this.storage! as any;
    if (typeof s.findByQuery === 'function') {
      return await s.findByQuery(collection, query, options) as T[];
    }
    return [];
  }

  async aggregate<T = any>(collection: string, pipeline: any[]): Promise<T[]> {
    this.ensureInitialized();
    const s: any = this.storage! as any;
    if (typeof s.aggregate === 'function') {
      return (await s.aggregate(collection, pipeline)) as T[];
    }
    return [];
  }

  async backup(backupPath?: string): Promise<string> {
    this.ensureInitialized();
    return await this.storage!.backup(backupPath);
  }

  async restore(backupPath: string): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.restore(backupPath);
  }

  async getStats(): Promise<StorageStats> {
    this.ensureInitialized();
    return await this.storage!.getStats();
  }

  async cleanup(): Promise<CleanupResult> {
    this.ensureInitialized();
    return await this.storage!.cleanup();
  }

  async close(): Promise<void> {
    if (this.storage) {
      await this.storage.close();
      this.storage = null;
    }

    this.stopKeepAlive();
    
    if (this.taskManager) {
      this.taskManager.destroy();
      this.taskManager = null;
    }
    
    this.isInitialized = false;
    logger.info('Storage manager closed');
  }

  private startKeepAlive(): void {
    if (this.keepAliveIntervalId || !this.storage) {
      return;
    }

    const intervalMs = Number(process.env.STORAGE_KEEPALIVE_INTERVAL_MS || '240000');

    this.keepAliveIntervalId = this.memoryManager.getOrCreateManagedInterval(
      'storage-keepalive',
      'Storage connection keep-alive ping',
      async () => {
        if (!this.storage) {
          return;
        }

        try {
          const storageAny = this.storage as any;
          if (typeof storageAny.healthCheck === 'function') {
            await storageAny.healthCheck();
          } else {
            await this.storage.get('system_config', '__keepalive__');
          }
        } catch (error) {
          logger.warn('Storage keep-alive ping failed', {
            error: (error as any)?.message || String(error)
          });
        }
      },
      intervalMs
    );

    logger.debug('Storage keep-alive interval started', { intervalMs });
  }

  private stopKeepAlive(): void {
    if (!this.keepAliveIntervalId) {
      return;
    }

    this.memoryManager.clearManagedInterval(this.keepAliveIntervalId);
    logger.debug('Storage keep-alive interval stopped');
    this.keepAliveIntervalId = undefined;
  }

  getStorageType(): string {
    return config.storage.source;
  }

  getConnectionStatus(): 'connected' | 'disconnected' | 'error' {
    if (!this.storage) return 'disconnected';
    return this.storage.getConnectionStatus();
  }

  async markProcessedUpdate(updateId: number, ttlSeconds: number = 900): Promise<boolean> {
    this.ensureInitialized();
    const s: any = this.storage as any;
    if (typeof s.tryMarkProcessedUpdate === 'function') {
      return await s.tryMarkProcessedUpdate(updateId, ttlSeconds);
    }
    return true;
  }

  isReady(): boolean {
    return this.isInitialized && this.storage?.isReady() === true;
  }

  getStorageInstance(): BaseStorage | null {
    return this.storage;
  }

  async healthCheck(): Promise<{
    status: 'healthy' | 'unhealthy';
    type: string;
    connectionStatus: string;
    message: string;
  }> {
    try {
      if (!this.isInitialized || !this.storage) {
        return {
          status: 'unhealthy',
          type: 'unknown',
          connectionStatus: 'disconnected',
          message: 'Storage not initialized',
        };
      }

      const connectionStatus = this.storage.getConnectionStatus();
      const storageType = this.getStorageType();
      
      if (connectionStatus === 'connected') {
        const testKey = `health_check_${Date.now()}`;
        const testData = { test: true, timestamp: new Date().toISOString() };
        
        const setSuccess = await this.storage.set('health_check', testData, testKey);
        if (!setSuccess) {
          throw new Error('Failed to write test data');
        }
        
        const getData = await this.storage.get<typeof testData>('health_check', testKey);
        if (!getData || getData.test !== true) {
          throw new Error('Failed to read test data');
        }
        
        await this.storage.delete('health_check', testKey);
        
        return {
          status: 'healthy',
          type: storageType,
          connectionStatus,
          message: 'Storage is working correctly',
        };
      } else {
        return {
          status: 'unhealthy',
          type: storageType,
          connectionStatus,
          message: `Storage connection status: ${connectionStatus}`,
        };
      }
    } catch (error) {
      return {
        status: 'unhealthy',
        type: this.getStorageType(),
        connectionStatus: 'error',
        message: `Storage health check failed: ${error}`,
      };
    }
  }

  async createDefaultData(): Promise<void> {
    this.ensureInitialized();
    
    try {
      // TaskManager handles default tasks initialization automatically
      // We just need to ensure it's initialized
      if (this.taskManager) {
        logger.info('Tasks initialized via TaskManager');
      } else {
        // Fallback: create basic tasks
        const defaultTasks = await this.get('tasks');
        if (!defaultTasks) {
          logger.info('Creating fallback tasks...');
          await this.initializeDefaultTasks();
        }
      }

      const defaultSettings = await this.get('admin_settings');
      if (!defaultSettings) {
        logger.info('Creating default admin settings...');
        await this.initializeDefaultSettings();
      }

      logger.info('Default data initialization completed');
    } catch (error) {
      logger.error('Failed to create default data:', error);
    }
  }

  private async initializeDefaultTasks(): Promise<void> {
    const defaultTasks = {
      tele_join_channel: {
        id: 'tele_join_channel',
        title: 'Join Our Telegram Channel',
        description: 'Join our official Telegram channel to stay updated',
        category: 'tele_social',
        type: 'telegram_join',
        points: 50,
        icon: '📢',
        verificationMethod: 'telegram_api',
        isActive: true,
        isDaily: false,
        completionCount: 0,
        buttons: [
          {
            text: '📢 Join Channel',
            action: 'open_url',
            url: config.bot.requiredChannelId.startsWith('@') 
              ? `https://t.me/${config.bot.requiredChannelId.substring(1)}`
              : config.bot.requiredChannelId,
            style: 'primary',
          },
          {
            text: '✅ Verify',
            action: 'verify',
            callback: 'task_verify_tele_join_channel',
            style: 'success',
          },
        ],
        order: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {
          channelId: config.bot.requiredChannelId,
          requiredAction: 'join',
          verificationInstructions: 'Click Join Channel, then click Verify',
          successMessage: '🎉 Great! You joined our channel and earned points!',
          failureMessage: '❌ Please join the channel first before verifying.',
        },
      },
    };

    await this.set('tasks', defaultTasks);
  }

  private async initializeDefaultSettings(): Promise<void> {
    const defaultSettings = {
      bot_settings: {
        maintenance_mode: false,
        new_user_registration: true,
        task_system_enabled: true,
        referral_system_enabled: true,
        wallet_system_enabled: true,
        captcha_required: true,
      },
      security_settings: {
        device_fingerprinting: true,
        multi_account_detection: true,
        auto_block_violations: true,
        admin_notifications: true,
      },
      point_settings: {
        min_withdrawal: config.points.minWithdraw,
        conversion_rate: config.points.conversionRate,
        daily_bonus_enabled: true,
        referral_bonus_enabled: true,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    await this.set('admin_settings', defaultSettings);
  }

  async migrateFromStorage(sourceType: 'file' | 'mongodb'): Promise<{
    success: boolean;
    migratedCollections: number;
    totalRecords: number;
    errors: string[];
  }> {
    throw new Error('Storage migration is no longer supported.');
  }

  /**
   * Static method to get the singleton instance
   * @returns StorageManager instance
   */
  static getInstance(): StorageManager {
    return storage;
  }

  // User management methods
  async getUser(userId: string): Promise<any | null> {
    this.ensureInitialized();
    return await this.storage!.getUser(userId);
  }

  async getUserByReferralCode(referralCode: string): Promise<any | null> {
    this.ensureInitialized();
    return await this.storage!.getUserByReferralCode(referralCode);
  }

  async saveUser(userId: string, userData: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.saveUser(userId, userData);
  }

  async createUser(userData: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.createUser(userData);
  }

  async updateUser(userId: string, updates: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.updateUser(userId, updates);
  }

  async getUserByUsername(username: string): Promise<any | null> {
    this.ensureInitialized();
    const s: any = this.storage! as any;
    if (typeof s.getUserByUsername === 'function') {
      return await s.getUserByUsername(username);
    }
    const results = await this.findByQuery('users', { username });
    return results.length > 0 ? results[0] : null;
  }

  // Additional methods needed by handlers
  async getAllUsers(): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getAllUsers();
  }

  async getAllTasks(): Promise<Task[]> {
    this.ensureInitialized();
    if (this.taskManager) {
      return await this.taskManager.getAllTasks();
    }
    // Fallback to storage for backward compatibility
    return await this.storage!.getAllTasks();
  }

  async getTask(taskId: string): Promise<Task | null> {
    this.ensureInitialized();
    if (this.taskManager) {
      return await this.taskManager.getTask(taskId);
    }
    // Fallback to storage
    if (typeof this.storage!.getTask === 'function') {
      return await this.storage!.getTask(taskId);
    }
    // Final fallback: get from all tasks
    const tasks = await this.getAllTasks();
    return tasks.find(task => task.id === taskId) || null;
  }

  async getFilteredTasks(filter: TaskFilter): Promise<Task[]> {
    this.ensureInitialized();
    if (this.taskManager) {
      return await this.taskManager.getFilteredTasks(filter);
    }
    // Simple fallback filtering
    const allTasks = await this.getAllTasks();
    return allTasks.filter(task => {
      if (filter.isActive !== undefined && task.isActive !== filter.isActive) return false;
      if (filter.category && task.category !== filter.category) return false;
      return true;
    });
  }

  async saveTask(task: Task): Promise<boolean> {
    this.ensureInitialized();
    if (this.taskManager) {
      await this.taskManager.saveTask(task);
      return true;
    }
    // Fallback to direct storage save
    return await this.set('tasks', { [task.id]: task });
  }

  async removeTask(taskId: string): Promise<boolean> {
    this.ensureInitialized();
    if (this.taskManager) {
      return await this.taskManager.removeTask(taskId);
    }
    // Fallback: not supported without TaskManager
    logger.warn('Task removal not supported without TaskManager');
    return false;
  }

  async refreshTasks(): Promise<void> {
    this.ensureInitialized();
    if (this.taskManager) {
      await this.taskManager.refresh();
    }
  }

  async getTaskStats(): Promise<any> {
    this.ensureInitialized();
    if (this.taskManager) {
      return await this.taskManager.getTaskStats();
    }
    // Simple fallback stats
    const tasks = await this.getAllTasks();
    return {
      total: tasks.length,
      active: tasks.filter(t => t.isActive).length,
      inactive: tasks.filter(t => !t.isActive).length
    };
  }

  async createTaskBackup(): Promise<string> {
    this.ensureInitialized();
    if (this.taskManager) {
      return await this.taskManager.createBackup();
    }
    throw new Error('Task backup not supported without TaskManager');
  }

  getTaskManager(): TaskManager | null {
    return this.taskManager;
  }

  async getAllTaskSubmissions(): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getAllTaskSubmissions();
  }

  async getTaskSubmissions(taskId: string): Promise<any[]> {
    this.ensureInitialized();
    if (typeof this.storage!.getTaskSubmissions === 'function') {
      return await this.storage!.getTaskSubmissions(taskId);
    }
    // Fallback: get all submissions and filter by task if needed
    const allSubmissions = await this.getAllTaskSubmissions();
    return allSubmissions.filter(submission => submission.taskId === taskId);
  }

  async getTaskSubmissionsByUser(userId: string): Promise<any[]> {
    this.ensureInitialized();
    // Get all submissions and filter by user
    const allSubmissions = await this.getAllTaskSubmissions();
    return allSubmissions.filter(submission => submission.userId === userId);
  }

  async getPointTransactions(userId: string): Promise<any[]> {
    this.ensureInitialized();
    // If storage doesn't have this method, return empty array for now
    if (typeof this.storage!.getPointTransactions === 'function') {
      return await this.storage!.getPointTransactions(userId);
    }
    return [];
  }

  async savePointTransaction(transaction: any): Promise<boolean> {
    this.ensureInitialized();
    if (typeof this.storage!.savePointTransaction === 'function') {
      return await this.storage!.savePointTransaction(transaction);
    }
    // Fallback: log the transaction but return true to not break the flow
    console.log('Point transaction saved (fallback):', transaction);
    return true;
  }

  // Device fingerprint methods
  async getDeviceFingerprints(userId: string): Promise<any[]> {
    this.ensureInitialized();
    if (typeof this.storage!.getDeviceFingerprints === 'function') {
      return await this.storage!.getDeviceFingerprints(userId);
    }
    return [];
  }

  async saveDeviceFingerprint(userId: string, fingerprint: any): Promise<boolean> {
    this.ensureInitialized();
    if (typeof this.storage!.saveDeviceFingerprint === 'function') {
      return await this.storage!.saveDeviceFingerprint(userId, fingerprint);
    }
    return true;
  }

  // Security audit log methods
  async saveSecurityAuditLog(logEntry: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.saveSecurityAuditLog(logEntry);
  }

  async getSecurityAuditLogs(filters: any): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getSecurityAuditLogs(filters);
  }

  // Admin user management methods
  async getAdminUser(id: string): Promise<any | null> {
    this.ensureInitialized();
    return await this.storage!.getAdminUser(id);
  }

  async updateAdminUser(id: string, updates: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.updateAdminUser(id, updates);
  }

  async createAdminUser(userData: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.createAdminUser(userData);
  }

  async listAdminUsers(): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.listAdminUsers();
  }

  // Security event methods
  async logSecurityEvent(event: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.logSecurityEvent(event);
  }


  // Connection management
  async disconnect(): Promise<void> {
    this.ensureInitialized();
    if (typeof this.storage!.disconnect === 'function') {
      await this.storage!.disconnect();
    }
    await this.close();
  }

  // Backup methods
  async backupData(): Promise<any> {
    this.ensureInitialized();
    if (typeof this.storage!.backupData === 'function') {
      return await this.storage!.backupData();
    }
    return await this.backup();
  }

  // ============= Wallet Connection Methods =============
  async saveWalletConnection(connection: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.saveWalletConnection(connection);
  }

  async getWalletConnections(userId: string): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getWalletConnections(userId);
  }

  async deactivateWalletConnectionByTopic(topic: string): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.deactivateWalletConnectionByTopic(topic);
  }

  async getWalletConnectionByTopic(topic: string): Promise<any | null> {
    this.ensureInitialized();
    const s: any = this.storage! as any;
    if (typeof s.getWalletConnectionByTopic === 'function') {
      return await s.getWalletConnectionByTopic(topic);
    }
    return null;
  }

  async getExpiredWalletConnections(now: number): Promise<any[]> {
    this.ensureInitialized();
    const s: any = this.storage! as any;
    if (typeof s.getExpiredWalletConnections === 'function') {
      return await s.getExpiredWalletConnections(now);
    }
    return [];
  }

  async getUserByWallet(walletAddress: string): Promise<any | null> {
    this.ensureInitialized();
    if (typeof this.storage!.getUserByWallet === 'function') {
      return await this.storage!.getUserByWallet(walletAddress);
    }
    // Fallback: search through all users
    const allUsers = await this.getAllUsers();
    return allUsers.find(user => user.walletAddress === walletAddress) || null;
  }

  async getWithdrawalRecords(userId: string): Promise<any[]> {
    this.ensureInitialized();
    if (typeof this.storage!.getWithdrawalRecords === 'function') {
      return await this.storage!.getWithdrawalRecords(userId);
    }
    return [];
  }

  async saveWithdrawalRecord(record: any): Promise<boolean> {
    this.ensureInitialized();
    if (typeof this.storage!.saveWithdrawalRecord === 'function') {
      return await this.storage!.saveWithdrawalRecord(record);
    }
    return false;
  }


  // ============= WalletConnect Session Methods =============
  async saveWalletConnectRequest(request: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.saveWalletConnectRequest(request);
  }

  async updateWalletConnectRequest(requestId: string, updates: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.updateWalletConnectRequest(requestId, updates);
  }

  async getWalletConnectRequest(requestId: string): Promise<any | null> {
    this.ensureInitialized();
    return await this.storage!.getWalletConnectRequest(requestId);
  }

  async getExpiredWalletConnectRequests(timestamp: number): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getExpiredWalletConnectRequests(timestamp);
  }

  async deleteWalletConnectRequest(requestId: string): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.deleteWalletConnectRequest(requestId);
  }

  // ============= QR Code Session Methods =============
  async saveQRCodeSession(session: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.saveQRCodeSession(session);
  }

  async getQRCodeSession(sessionId: string): Promise<any | null> {
    this.ensureInitialized();
    return await this.storage!.getQRCodeSession(sessionId);
  }

  async updateQRCodeSession(sessionId: string, updates: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.updateQRCodeSession(sessionId, updates);
  }

  async getQRCodeSessionsByUser(userId: string): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getQRCodeSessionsByUser(userId);
  }

  async getQRCodeSessionsByDate(userId: string, date: Date): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getQRCodeSessionsByDate(userId, date);
  }

  async getExpiredQRCodeSessions(timestamp: number): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getExpiredQRCodeSessions(timestamp);
  }

  async deleteQRCodeSession(sessionId: string): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.deleteQRCodeSession(sessionId);
  }

  async getAllQRCodeSessions(): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getAllQRCodeSessions();
  }

  // ============= Referral Record Methods =============
  async saveReferralRecord(referralData: any): Promise<boolean> {
    this.ensureInitialized();
    if (typeof this.storage!.saveReferralRecord === 'function') {
      return await this.storage!.saveReferralRecord(referralData);
    }
    // Fallback: log but don't break the flow
    console.log('Referral record saved (fallback):', referralData);
    return true;
  }

  async getReferralRecords(userId?: string): Promise<any[]> {
    this.ensureInitialized();
    if (typeof this.storage!.getReferralRecords === 'function') {
      return await this.storage!.getReferralRecords(userId);
    }
    return [];
  }

  // ============= Security & CAPTCHA Methods =============
  async getBlockedIPs(): Promise<string[]> {
    this.ensureInitialized();
    return await this.storage!.getBlockedIPs();
  }

  async addBlockedIP(ip: string, reason: string, duration: number): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.addBlockedIP(ip, reason, duration);
  }

  async getRecentCaptchaAttempts(ip: string, timeWindow: number): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getRecentCaptchaAttempts(ip, timeWindow);
  }

  async getUserBlocks(userId: string): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getUserBlocks(userId);
  }

  async addUserBlock(userId: string, type: string, duration: number): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.addUserBlock(userId, type, duration);
  }

  async getRecentCaptchaSessions(timeWindow: number): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getRecentCaptchaSessions(timeWindow);
  }

  async saveSecurityIncident(incident: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.saveSecurityIncident(incident);
  }

  async getCaptchaSession(sessionId: string): Promise<any | null> {
    this.ensureInitialized();
    return await this.storage!.getCaptchaSession(sessionId);
  }

  async saveCaptchaSession(session: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.saveCaptchaSession(session);
  }

  async saveCaptchaResult(userId: string, result: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.saveCaptchaResult(userId, result);
  }

  async updateSecurityMetrics(userId: string, metrics: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.updateSecurityMetrics(userId, metrics);
  }

  async updateUserSuccessRate(userId: string, confidence: number): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.updateUserSuccessRate(userId, confidence);
  }

  async getRecentCaptchaFailures(userId: string, timeWindow: number): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getRecentCaptchaFailures(userId, timeWindow);
  }

  async getRecentCaptchaFailuresByIP(ip: string, timeWindow: number): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getRecentCaptchaFailuresByIP(ip, timeWindow);
  }

  async getCaptchaStats(): Promise<any> {
    this.ensureInitialized();
    return await this.storage!.getCaptchaStats();
  }

  async cleanExpiredCaptchaSessions(): Promise<void> {
    this.ensureInitialized();
    return await this.storage!.cleanExpiredCaptchaSessions();
  }

  // ============= Enhanced Device Fingerprinting Methods =============
  async saveEnhancedDeviceFingerprint(fingerprint: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.saveEnhancedDeviceFingerprint(fingerprint);
  }

  async getEnhancedDeviceFingerprint(deviceHash: string): Promise<any | null> {
    this.ensureInitialized();
    return await this.storage!.getEnhancedDeviceFingerprint(deviceHash);
  }

  async updateEnhancedDeviceFingerprint(deviceHash: string, updates: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.updateEnhancedDeviceFingerprint(deviceHash, updates);
  }

  async getAllDeviceFingerprints(): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getAllDeviceFingerprints();
  }

  async getDeviceFingerprintsByUser(userId: string): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getDeviceFingerprintsByUser(userId);
  }

  async findSimilarDeviceFingerprints(fingerprint: any, threshold: number): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.findSimilarDeviceFingerprints(fingerprint, threshold);
  }

  // ============= Device Ban Methods =============
  async saveBannedDevice(banRecord: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.saveBannedDevice(banRecord);
  }

  async getBannedDevice(deviceHash: string): Promise<any | null> {
    this.ensureInitialized();
    return await this.storage!.getBannedDevice(deviceHash);
  }

  async removeBannedDevice(deviceHash: string): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.removeBannedDevice(deviceHash);
  }

  async getAllBannedDevices(): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getAllBannedDevices();
  }

  async getBannedDevicesByUser(userId: string): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getBannedDevicesByUser(userId);
  }

  // ============= Location Tracking Methods =============
  async saveLocationData(userId: string, locationData: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.saveLocationData(userId, locationData);
  }

  async getLocationHistory(userId: string): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getLocationHistory(userId);
  }

  async getUserLocationHistory(userId: string): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getUserLocationHistory(userId);
  }

  async updateLocationHistory(userId: string, locationData: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.updateLocationHistory(userId, locationData);
  }

  async getRecentLocationData(userId: string, timeWindow: number): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getRecentLocationData(userId, timeWindow);
  }

  async saveGeolocationValidation(userId: string, validation: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.saveGeolocationValidation(userId, validation);
  }

  async updateUserLocationConsistency(userId: string, consistency: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.updateUserLocationConsistency(userId, consistency);
  }

  async getUserLocationConsistency(userId: string): Promise<any | null> {
    this.ensureInitialized();
    return await this.storage!.getUserLocationConsistency(userId);
  }

  async trackLocationChange(userId: string, oldLocation: any, newLocation: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.trackLocationChange(userId, oldLocation, newLocation);
  }

  async detectImpossibleMovement(userId: string, newLocation: any): Promise<{detected: boolean; evidence: any}> {
    this.ensureInitialized();
    return await this.storage!.detectImpossibleMovement(userId, newLocation);
  }

  async detectDeviceCollisions(deviceHash: string): Promise<{collisions: any[]; users: string[]}> {
    this.ensureInitialized();
    return await this.storage!.detectDeviceCollisions(deviceHash);
  }

  async getUsersByIP(ipAddress: string): Promise<string[]> {
    this.ensureInitialized();
    return await this.storage!.getUsersByIP(ipAddress);
  }

  // ============= Multi-Account Detection Methods =============
  async getDevicesByHash(deviceHash: string): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getDevicesByHash(deviceHash);
  }

  async getUsersByCanvasFingerprint(canvasFingerprint: string): Promise<string[]> {
    this.ensureInitialized();
    return await this.storage!.getUsersByCanvasFingerprint(canvasFingerprint);
  }

  async getUsersByHardwareSignature(hardwareSignature: string): Promise<string[]> {
    this.ensureInitialized();
    return await this.storage!.getUsersByHardwareSignature(hardwareSignature);
  }

  async getLocationValidationHistory(userId: string): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getLocationValidationHistory(userId);
  }

  // ============= Enhanced Security Event Methods =============
  async saveEnhancedSecurityEvent(event: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.saveEnhancedSecurityEvent(event);
  }

  async getSecurityEventsByDevice(deviceHash: string): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getSecurityEventsByDevice(deviceHash);
  }

  async getSecurityEventsByLocation(ip: string): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getSecurityEventsByLocation(ip);
  }

  // ============= Multi-Account Violation Methods =============
  async saveMultiAccountViolation(violation: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.saveMultiAccountViolation(violation);
  }

  async storeMultiAccountViolation(detection: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.storeMultiAccountViolation(detection);
  }

  async getMultiAccountViolations(userId: string): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getMultiAccountViolations(userId);
  }

  async getAllMultiAccountViolations(): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getAllMultiAccountViolations();
  }

  // ============= User Block Methods =============
  async blockUser(userId: string, blockData: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.blockUser(userId, blockData);
  }

  async unblockUser(userId: string, reason: string): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.unblockUser(userId, reason);
  }

  async isUserBlocked(userId: string): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.isUserBlocked(userId);
  }

  // ============= Device Binding Methods =============
  async saveDeviceBinding(userId: string, deviceHash: string, metadata: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.saveDeviceBinding(userId, deviceHash, metadata);
  }

  async getDeviceBindings(userId: string): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getDeviceBindings(userId);
  }

  async removeDeviceBinding(userId: string, deviceHash: string): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.removeDeviceBinding(userId, deviceHash);
  }

  async isDeviceBound(deviceHash: string): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.isDeviceBound(deviceHash);
  }

  // ============= Enhanced Captcha Session Methods =============
  async saveEnhancedCaptchaSession(session: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.saveEnhancedCaptchaSession(session);
  }

  async getEnhancedCaptchaSession(sessionId: string): Promise<any | null> {
    this.ensureInitialized();
    return await this.storage!.getEnhancedCaptchaSession(sessionId);
  }

  async updateEnhancedCaptchaSession(sessionId: string, updates: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.updateEnhancedCaptchaSession(sessionId, updates);
  }

  async getCaptchaSessionsByDevice(deviceHash: string): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getCaptchaSessionsByDevice(deviceHash);
  }

  // ============= Risk Assessment Methods =============
  async saveRiskAssessment(userId: string, assessment: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.saveRiskAssessment(userId, assessment);
  }

  async getRiskAssessment(userId: string): Promise<any | null> {
    this.ensureInitialized();
    return await this.storage!.getRiskAssessment(userId);
  }

  async updateUserRiskScore(userId: string, riskScore: number): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.updateUserRiskScore(userId, riskScore);
  }

  // ============= Privacy-First Fingerprint Storage Methods =============
  async storeSecureHashes(userId: string, hashes: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.storeSecureHashes(userId, hashes);
  }

  async storeEncryptedFingerprint(userId: string, encrypted: any, ttl: number): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.storeEncryptedFingerprint(userId, encrypted, ttl);
  }

  async findByDeviceSignature(deviceSignature: string): Promise<Array<{userId: string, hashes: any}>> {
    this.ensureInitialized();
    return await this.storage!.findByDeviceSignature(deviceSignature);
  }

  async findByCombinedHash(combinedHash: string): Promise<Array<{userId: string, hashes: any}>> {
    this.ensureInitialized();
    return await this.storage!.findByCombinedHash(combinedHash);
  }

  async getAllUserHashes(): Promise<Array<{userId: string, hashes: any}>> {
    this.ensureInitialized();
    return await this.storage!.getAllUserHashes();
  }

  async deleteExpiredEncryptedData(userId: string): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.deleteExpiredEncryptedData(userId);
  }

  // ============= Suspicious Activity Methods =============
  async saveSuspiciousActivity(activity: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.saveSuspiciousActivity(activity);
  }

  // ============= Simple Device Hash Storage Methods =============
  async storeUserDeviceHash(userId: string, deviceHash: string): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.storeUserDeviceHash(userId, deviceHash);
  }

  async getUsersByDeviceHash(deviceHash: string): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getUsersByDeviceHash(deviceHash);
  }

  // ============= Transfer System Methods =============
  async saveTransferRecord(transfer: any): Promise<boolean> {
    this.ensureInitialized();
    return await this.storage!.saveTransferRecord(transfer);
  }

  async getTransferRecords(userId: string): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getTransferRecords(userId);
  }

  async getTransferHistoryBySender(senderId: string): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getTransferHistoryBySender(senderId);
  }

  async getTransferHistoryByReceiver(receiverId: string): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getTransferHistoryByReceiver(receiverId);
  }

  async getDailyTransferCount(userId: string, date: Date): Promise<number> {
    this.ensureInitialized();
    return await this.storage!.getDailyTransferCount(userId, date);
  }

  async getDailyTransferAmount(userId: string, date: Date): Promise<number> {
    this.ensureInitialized();
    return await this.storage!.getDailyTransferAmount(userId, date);
  }

  async getTransferByHash(hash: string): Promise<any | null> {
    this.ensureInitialized();
    return await this.storage!.getTransferByHash(hash);
  }

  // Data path methods
  getDataPath(): string {
    this.ensureInitialized();
    return this.storage!.getDataPath();
  }

  // ============================================
  // PERFORMANCE OPTIMIZATION: Indexed Query Methods
  // ============================================
  
  /**
   * Find devices by canvas fingerprint (indexed query - OPTIMIZED)
   * Uses index on components.rendering.canvasFingerprint
   * Performance: O(log n) vs O(n)
   */
  async findDevicesByCanvas(canvasHash: string): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.findDevicesByCanvas(canvasHash);
  }
  
  /**
   * Find devices by screen resolution (indexed query - OPTIMIZED)
   * Uses index on components.hardware.screenResolution
   * Performance: O(log n) vs O(n)
   */
  async findDevicesByScreenResolution(screenResolution: string): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.findDevicesByScreenResolution(screenResolution);
  }
  
  /**
   * Find devices by WebGL renderer (indexed query - OPTIMIZED)
   */
  async findDevicesByWebGLRenderer(webglRenderer: string): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.findDevicesByWebGLRenderer(webglRenderer);
  }
  
  /**
   * Get recent device fingerprints (for cache warming)
   * Uses index on registeredAt
   */
  async getRecentDeviceFingerprints(days: number): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getRecentDeviceFingerprints(days);
  }
  
  /**
   * Find users registered recently (indexed by registeredAt - OPTIMIZED)
   */
  async getUsersRegisteredRecently(timeWindow: number): Promise<any[]> {
    this.ensureInitialized();
    return await this.storage!.getUsersRegisteredRecently(timeWindow);
  }
  
  /**
   * Count devices by canvas fingerprint (for duplicate detection)
   */
  async countDevicesByCanvas(canvasHash: string): Promise<number> {
    this.ensureInitialized();
    return await this.storage!.countDevicesByCanvas(canvasHash);
  }
  
  /**
   * Batch get device fingerprints by hashes (optimized for multiple lookups)
   */
  async batchGetDeviceFingerprints(hashes: string[]): Promise<Map<string, any>> {
    this.ensureInitialized();
    return await this.storage!.batchGetDeviceFingerprints(hashes);
  }
}

export const storage = new StorageManager();
export { StorageManager };
export default storage;

/**
 * Create and return a storage instance
 * @returns BaseStorage instance
 */
export const createStorage = (): BaseStorage => {
  const instance = StorageManager.getInstance();
  const storageInstance = instance.getStorageInstance();
  
  if (!storageInstance) {
    // Auto-initialize if not already done
    if (!instance.isReady()) {
      console.warn('Storage not initialized, attempting auto-initialization...');
      // Return a proxy that will initialize on first method call
      return createStorageProxy(instance);
    }
    throw new Error('Storage instance not available.');
  }
  
  return storageInstance;
};

/**
 * Create a storage proxy that auto-initializes on first method call
 */
function createStorageProxy(manager: StorageManager): BaseStorage {
  return new Proxy({} as BaseStorage, {
    get(target: any, prop: string | symbol) {
      return async (...args: any[]) => {
        // Initialize storage if not ready
        if (!manager.isReady()) {
          await manager.initialize();
        }
        
        const storage = manager.getStorageInstance();
        if (!storage || typeof storage[prop as keyof BaseStorage] !== 'function') {
          throw new Error(`Method ${String(prop)} not found on storage instance`);
        }
        
        return (storage[prop as keyof BaseStorage] as Function).apply(storage, args);
      };
    }
  });
}

export { MongoStorage, BaseStorage };
export type { StorageAdapter };