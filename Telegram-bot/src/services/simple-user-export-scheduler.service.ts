import { Logger } from './logger';
import { UserDataExportService } from './user-data-export.service';

/**
 * Simplified User Data Export Scheduler
 * Supports minute, hour, and exact time scheduling
 */
export class SimpleUserExportScheduler {
  private static instance: SimpleUserExportScheduler;
  private readonly logger = Logger.getInstance();
  private readonly exportService = UserDataExportService.getInstance();
  private intervalId?: NodeJS.Timeout;
  private timeoutId?: NodeJS.Timeout;
  private isRunning = false;
  private lastExportTime?: Date;

  private constructor() {}

  static getInstance(): SimpleUserExportScheduler {
    if (!SimpleUserExportScheduler.instance) {
      SimpleUserExportScheduler.instance = new SimpleUserExportScheduler();
    }
    return SimpleUserExportScheduler.instance;
  }

  /**
   * Start the scheduler based on environment settings
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      this.logger.info('📊 User export scheduler is already running');
      return;
    }

    const enabled = process.env.ENABLE_USER_DATA_EXPORT !== 'false';
    if (!enabled) {
      this.logger.info('📊 User data export is disabled via environment');
      return;
    }

    const adminChatId = process.env.ADMIN_CHAT_ID || process.env.ADMIN_TELEGRAM_ID;
    const botToken = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;

    if (!adminChatId || !botToken) {
      this.logger.error('❌ Missing ADMIN_CHAT_ID or bot token (TELEGRAM_BOT_TOKEN/BOT_TOKEN)');
      return;
    }

    // Get export interval from environment
    const intervalConfig = process.env.USER_DATA_EXPORT_INTERVAL || 
                         process.env.USER_DATA_EXPORT_INTERVAL_HOURS || '1h';

    // Parse the interval configuration
    const { interval, unit, exactTime } = this.parseInterval(intervalConfig);

    this.logger.info('🚀 Starting simplified user export scheduler', {
      interval,
      unit,
      exactTime,
      adminChatId
    });

    // Run on startup if configured
    if (process.env.USER_DATA_EXPORT_RUN_ON_START === 'true') {
      this.logger.info('📤 Running initial export on startup...');
      await this.runExport();
    }

    // Set up the appropriate scheduler
    if (exactTime) {
      this.scheduleExactTime(exactTime);
    } else {
      this.scheduleInterval(interval, unit);
    }

    this.isRunning = true;
  }

  /**
   * Stop the scheduler
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = undefined;
    }
    this.isRunning = false;
    this.logger.info('🛑 User export scheduler stopped');
  }

  /**
   * Parse interval configuration
   * Supports: "1m", "5m", "1h", "6h", "HH:MM" (exact time)
   */
  private parseInterval(config: string): { 
    interval: number; 
    unit: 'minute' | 'hour' | 'day'; 
    exactTime?: string 
  } {
    // Check for exact time format (HH:MM)
    if (config.includes(':')) {
      return { interval: 0, unit: 'day', exactTime: config };
    }

    // Parse interval with unit
    const match = config.match(/^(\d+)([mhd]?)$/i);
    if (!match) {
      // Default to 1 hour if parsing fails
      this.logger.warn('⚠️ Invalid interval format, defaulting to 1 hour', { config });
      return { interval: 1, unit: 'hour' };
    }

    const interval = parseInt(match[1]);
    const unitChar = (match[2] || 'h').toLowerCase();
    
    let unit: 'minute' | 'hour' | 'day';
    switch (unitChar) {
      case 'm':
        unit = 'minute';
        break;
      case 'd':
        unit = 'day';
        break;
      case 'h':
      default:
        unit = 'hour';
        break;
    }

    return { interval, unit };
  }

  /**
   * Schedule exports at regular intervals
   */
  private scheduleInterval(interval: number, unit: 'minute' | 'hour' | 'day'): void {
    // Convert to milliseconds
    let milliseconds: number;
    switch (unit) {
      case 'minute':
        milliseconds = interval * 60 * 1000;
        break;
      case 'hour':
        milliseconds = interval * 60 * 60 * 1000;
        break;
      case 'day':
        milliseconds = interval * 24 * 60 * 60 * 1000;
        break;
    }

    // Calculate delay until next interval boundary
    const now = new Date();
    let delay: number;

    if (unit === 'minute') {
      // Wait until the start of the next minute
      const secondsToNextMinute = 60 - now.getSeconds();
      delay = secondsToNextMinute * 1000;
    } else if (unit === 'hour') {
      // Wait until the start of the next hour
      const minutesToNextHour = 60 - now.getMinutes();
      const secondsToNextHour = (minutesToNextHour * 60) - now.getSeconds();
      delay = secondsToNextHour * 1000;
    } else {
      // For days, just start immediately
      delay = 0;
    }

    this.logger.info(`⏰ Scheduling exports every ${interval} ${unit}(s)`, {
      interval,
      unit,
      nextRunIn: `${Math.round(delay / 1000)} seconds`
    });

    // Schedule first run after delay
    if (delay > 0) {
      this.timeoutId = setTimeout(() => {
        this.runExport();
        // Then set up regular interval
        this.intervalId = setInterval(() => this.runExport(), milliseconds);
        this.timeoutId = undefined;
      }, delay);
    } else {
      // Start immediately for day intervals
      this.intervalId = setInterval(() => this.runExport(), milliseconds);
    }
  }

  /**
   * Schedule exports at exact time each day
   */
  private scheduleExactTime(time: string): void {
    const [hours, minutes] = time.split(':').map(n => parseInt(n));
    
    if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
      this.logger.error('❌ Invalid time format, must be HH:MM', { time });
      return;
    }

    this.logger.info(`⏰ Scheduling daily export at ${time}`);

    const checkAndRun = () => {
      const now = new Date();
      if (now.getHours() === hours && now.getMinutes() === minutes) {
        // Check if we haven't already run this minute
        if (!this.lastExportTime || 
            now.getTime() - this.lastExportTime.getTime() > 60000) {
          this.runExport();
        }
      }
    };

    // Check every 30 seconds
    this.intervalId = setInterval(checkAndRun, 30000);
    
    // Also check immediately
    checkAndRun();
  }

  /**
   * Run the export process
   */
  private async runExport(): Promise<void> {
    try {
      this.logger.info('📊 Starting scheduled user data export...');
      this.lastExportTime = new Date();

      const result = await this.exportService.exportAndSendUserData();

      if (result.success) {
        this.logger.info('✅ Scheduled export completed successfully', {
          message: result.message,
          totalUsers: result.stats?.totalUsers,
          nextRun: this.getNextRunTime()
        });
      } else {
        this.logger.error('❌ Scheduled export failed', {
          error: result.message
        });
      }
    } catch (error) {
      this.logger.error('❌ Error during scheduled export:', error);
    }
  }

  /**
   * Get the next scheduled run time
   */
  private getNextRunTime(): string {
    const config = process.env.USER_DATA_EXPORT_INTERVAL || 
                  process.env.USER_DATA_EXPORT_INTERVAL_HOURS || '1h';
    
    const { interval, unit, exactTime } = this.parseInterval(config);
    const now = new Date();

    if (exactTime) {
      const [hours, minutes] = exactTime.split(':').map(n => parseInt(n));
      const next = new Date();
      next.setHours(hours, minutes, 0, 0);
      if (next <= now) {
        next.setDate(next.getDate() + 1);
      }
      return next.toLocaleString();
    }

    let nextTime = new Date(now);
    switch (unit) {
      case 'minute':
        nextTime.setMinutes(nextTime.getMinutes() + interval);
        break;
      case 'hour':
        nextTime.setHours(nextTime.getHours() + interval);
        break;
      case 'day':
        nextTime.setDate(nextTime.getDate() + interval);
        break;
    }

    return nextTime.toLocaleString();
  }

  /**
   * Force an immediate export (for testing)
   */
  async forceExport(): Promise<{ success: boolean; message: string }> {
    this.logger.info('⚡ Force export requested');
    const result = await this.exportService.exportAndSendUserData();
    return result;
  }

  /**
   * Get scheduler status
   */
  getStatus(): { 
    running: boolean; 
    lastExport?: string; 
    nextRun?: string;
    config: string;
  } {
    const config = process.env.USER_DATA_EXPORT_INTERVAL || 
                  process.env.USER_DATA_EXPORT_INTERVAL_HOURS || '1h';

    return {
      running: this.isRunning,
      lastExport: this.lastExportTime?.toLocaleString(),
      nextRun: this.isRunning ? this.getNextRunTime() : undefined,
      config
    };
  }
}

export default SimpleUserExportScheduler.getInstance();