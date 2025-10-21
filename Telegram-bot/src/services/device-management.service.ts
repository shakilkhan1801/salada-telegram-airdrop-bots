import { Logger } from './logger';
import { StorageManager } from '../storage';
import * as cron from 'node-cron';

export interface DeviceCleanupResult {
  filesProcessed: number;
  filesDeleted: number;
  bytesFreed: number;
  errors: string[];
}

export interface DeviceManagementConfig {
  enableWeeklyCleanup: boolean;
  cleanupSchedule: string; // Cron expression
  retentionDays: number;
  enableCleanupLogging: boolean;
}

export class DeviceManagementService {
  private static instance: DeviceManagementService;
  private readonly logger = Logger.getInstance();
  private readonly storage = StorageManager.getInstance();
  private weeklyCleanupTask?: cron.ScheduledTask;
  private config: DeviceManagementConfig = {
    enableWeeklyCleanup: true,
    cleanupSchedule: '0 3 * * 0', // Every Sunday at 3 AM
    retentionDays: 30,
    enableCleanupLogging: true,
  };

  private constructor() {}

  static getInstance(): DeviceManagementService {
    if (!DeviceManagementService.instance) {
      DeviceManagementService.instance = new DeviceManagementService();
    }
    return DeviceManagementService.instance;
  }

  async initialize(config?: Partial<DeviceManagementConfig>): Promise<void> {
    try {
      if (config) this.config = { ...this.config, ...config };
      if (this.config.enableWeeklyCleanup) this.setupWeeklyCleanupTask();
      this.logger.info('✅ Device management service initialized');
    } catch (error) {
      this.logger.error('❌ Failed to initialize device management service:', error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    try {
      if (this.weeklyCleanupTask) {
        this.weeklyCleanupTask.stop();
        this.weeklyCleanupTask = undefined;
      }
      this.logger.info('✅ Device management service stopped');
    } catch (error) {
      this.logger.error('❌ Error stopping device management service:', error);
      throw error;
    }
  }

  private setupWeeklyCleanupTask(): void {
    try {
      this.weeklyCleanupTask = cron.schedule(
        this.config.cleanupSchedule,
        async () => {
          try {
            this.logger.info('🧹 Starting weekly data cleanup...');
            const cleanupResults = await this.performCleanup(this.config.retentionDays);
            this.logger.info('✅ Weekly cleanup completed:', cleanupResults);
          } catch (error) {
            this.logger.error('❌ Error during weekly cleanup:', error);
          }
        },
        { timezone: 'UTC' },
      );
      this.logger.info(`✅ Weekly cleanup task scheduled: ${this.config.cleanupSchedule}`);
    } catch (error) {
      this.logger.error('❌ Failed to setup weekly cleanup task:', error);
      throw error;
    }
  }

  async performCleanup(_retentionDays: number = 30): Promise<DeviceCleanupResult> {
    const result: DeviceCleanupResult = {
      filesProcessed: 0,
      filesDeleted: 0,
      bytesFreed: 0,
      errors: [],
    };

    try {
      const storageResult = await this.storage.cleanup();
      if (this.config.enableCleanupLogging) {
        this.logger.info('🧹 Storage cleanup summary', storageResult);
      }
      return result;
    } catch (error) {
      this.logger.error('❌ Error during storage cleanup:', error);
      result.errors.push(`Cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return result;
    }
  }

  async manualCleanup(retentionDays?: number): Promise<DeviceCleanupResult> {
    this.logger.info(`🧹 Starting manual cleanup (${retentionDays ?? this.config.retentionDays} days retention)`);
    const result = await this.performCleanup(retentionDays);
    this.logger.info('✅ Manual cleanup completed');
    return result;
  }

  async getCleanupStats(): Promise<{
    nextScheduledCleanup?: Date;
    lastCleanupRun?: Date;
    totalDeviceFiles: number;
    oldestDeviceFile?: Date;
    totalStorageUsed: number;
  }> {
    // For MongoDB-backed storage, file-based metrics are not applicable
    return {
      nextScheduledCleanup: this.getNextScheduledCleanup(),
      lastCleanupRun: this.getLastCleanupRun(),
      totalDeviceFiles: 0,
      oldestDeviceFile: undefined,
      totalStorageUsed: 0,
    };
  }

  private getNextScheduledCleanup(): Date | undefined {
    if (!this.weeklyCleanupTask) return undefined;
    const now = new Date();
    const nextSunday = new Date(now);
    nextSunday.setDate(now.getDate() + (7 - now.getDay()));
    nextSunday.setHours(3, 0, 0, 0);
    return nextSunday;
  }

  private getLastCleanupRun(): Date | undefined {
    return undefined;
  }

  updateConfig(newConfig: Partial<DeviceManagementConfig>): void {
    this.config = { ...this.config, ...newConfig };
    if (newConfig.cleanupSchedule && this.weeklyCleanupTask) {
      this.weeklyCleanupTask.stop();
      this.setupWeeklyCleanupTask();
    }
    this.logger.info('✅ Device management configuration updated');
  }
}
