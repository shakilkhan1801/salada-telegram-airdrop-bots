import { Logger } from '../logger';
import sessionSecurityService from './session-security-service';
import EnhancedSessionSecurityService from './enhanced-session-security.service';

/**
 * Unified Session Scheduler Service
 * Handles periodic session cleanup, security maintenance, and monitoring
 * Consolidates functionality from SessionCleanupScheduler and SessionSecuritySchedulerService
 */
type MaintenanceStats = {
  totalCleanupRuns: number;
  totalSecurityRuns: number;
  totalSessionsCleaned: number;
  totalViolationsProcessed: number;
};

export class SessionSchedulerService {
  private static instance: SessionSchedulerService;
  private readonly logger = Logger.getInstance();
  private readonly enhancedSecurity = EnhancedSessionSecurityService;
  
  private maintenanceIntervalId: NodeJS.Timeout | null = null;
  private readonly MAINTENANCE_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
  private readonly ENABLE_AUTOMATIC_MAINTENANCE = true;
  
  private lastCleanupRun?: string;
  private lastSecurityMaintenanceRun?: string;
  private maintenanceStats: MaintenanceStats = {
    totalCleanupRuns: 0,
    totalSecurityRuns: 0,
    totalSessionsCleaned: 0,
    totalViolationsProcessed: 0
  };
  
  private lastError?: string;
  
  private constructor() {}

  public static getInstance(): SessionSchedulerService {
    if (!SessionSchedulerService.instance) {
      SessionSchedulerService.instance = new SessionSchedulerService();
    }
    return SessionSchedulerService.instance;
  }

  /**
   * Start the unified session scheduler
   */
  public start(): void {
    if (this.maintenanceIntervalId) {
      this.logger.warn('Session scheduler already running');
      return;
    }

    if (!this.ENABLE_AUTOMATIC_MAINTENANCE) {
      this.logger.info('Automatic session maintenance disabled');
      return;
    }

    this.logger.info('Starting unified session scheduler', {
      intervalMs: this.MAINTENANCE_INTERVAL_MS,
      features: ['session cleanup', 'security maintenance']
    });

    // Schedule periodic maintenance (delay initial run to ensure storage is ready)
    setTimeout(() => {
      this.runFullMaintenance();
    }, 5000); // 5 second delay

    // Schedule periodic maintenance
    this.maintenanceIntervalId = setInterval(() => {
      this.runFullMaintenance();
    }, this.MAINTENANCE_INTERVAL_MS);
  }

  /**
   * Stop the session scheduler
   */
  public stop(): void {
    if (this.maintenanceIntervalId) {
      clearInterval(this.maintenanceIntervalId);
      this.maintenanceIntervalId = null;
      this.logger.info('Session scheduler stopped');
    }
  }

  /**
   * Manually trigger full maintenance (cleanup + security)
   */
  public async runMaintenanceManually(): Promise<{
    cleanup: { cleaned: number; timestamp: string };
    security: any;
  }> {
    this.logger.info('Manual session maintenance triggered');
    return await this.runFullMaintenance();
  }

  /**
   * Manually trigger only session cleanup
   */
  public async runCleanupOnly(): Promise<{ cleaned: number; timestamp: string }> {
    this.logger.info('Manual session cleanup triggered');
    return await this.performSessionCleanup();
  }

  /**
   * Manually trigger only security maintenance
   */
  public async runSecurityMaintenanceOnly(): Promise<any> {
    this.logger.info('Manual security maintenance triggered');
    return await this.performSecurityMaintenance();
  }

  /**
   * Get comprehensive scheduler status
   */
  public getStatus(): { 
    running: boolean; 
    intervalMs: number; 
    lastCleanupRun?: string;
    lastSecurityRun?: string;
    nextRun?: string;
    statistics: MaintenanceStats;
  } {
    return {
      running: this.maintenanceIntervalId !== null,
      intervalMs: this.MAINTENANCE_INTERVAL_MS,
      lastCleanupRun: this.lastCleanupRun,
      lastSecurityRun: this.lastSecurityMaintenanceRun,
      nextRun: this.maintenanceIntervalId ? 
        new Date(Date.now() + this.MAINTENANCE_INTERVAL_MS).toISOString() : 
        undefined,
      statistics: { ...this.maintenanceStats }
    };
  }

  /**
   * Get maintenance statistics
   */
  public getStatistics(): MaintenanceStats {
    return { ...this.maintenanceStats };
  }

  /**
   * Reset maintenance statistics
   */
  public resetStatistics(): void {
    this.maintenanceStats = {
      totalCleanupRuns: 0,
      totalSecurityRuns: 0,
      totalSessionsCleaned: 0,
      totalViolationsProcessed: 0
    };
    this.logger.info('Session scheduler statistics reset');
  }

  // ========================================================================
  // PRIVATE METHODS
  // ========================================================================

  /**
   * Run full maintenance cycle (cleanup + security)
   */
  private async runFullMaintenance(): Promise<{
    cleanup: { cleaned: number; timestamp: string };
    security: any;
  }> {
    const results = {
      cleanup: { cleaned: 0, timestamp: '' },
      security: null
    };

    try {
      this.logger.debug('Starting full session maintenance cycle');

      // 1. Session Cleanup
      results.cleanup = await this.performSessionCleanup();

      // 2. Security Maintenance
      results.security = await this.performSecurityMaintenance();

      this.logger.info('Full session maintenance cycle completed', {
        sessionsCleaned: results.cleanup.cleaned,
        securityMaintenanceCompleted: !!results.security,
        timestamp: new Date().toISOString()
      });

    } catch (error: any) {
      this.lastError = error.message;
      this.logger.error('Full session maintenance cycle failed:', error);
      throw error;
    }

    return results;
  }

  /**
   * Perform session cleanup
   */
  private async performSessionCleanup(): Promise<{ cleaned: number; timestamp: string }> {
    try {
      this.logger.debug('Starting session cleanup');
      
      const timestamp = new Date().toISOString();
      this.lastCleanupRun = timestamp;
      this.maintenanceStats.totalCleanupRuns++;

      // Clean up expired sessions
      const cleanedCount = await sessionSecurityService.cleanupExpiredSessions();
      this.maintenanceStats.totalSessionsCleaned += cleanedCount;

      if (cleanedCount > 0) {
        this.logger.info('Session cleanup completed', {
          expiredSessionsCleaned: cleanedCount,
          timestamp
        });
      } else {
        this.logger.debug('Session cleanup completed - no expired sessions found');
      }

      return { cleaned: cleanedCount, timestamp };

    } catch (error: any) {
      this.logger.error('Session cleanup failed:', error);
      throw error;
    }
  }

  /**
   * Perform security maintenance
   */
  private async performSecurityMaintenance(): Promise<any> {
    try {
      this.logger.debug('Starting security maintenance');
      
      const timestamp = new Date().toISOString();
      this.lastSecurityMaintenanceRun = timestamp;
      this.maintenanceStats.totalSecurityRuns++;
      
      const results = await this.enhancedSecurity.performSecurityMaintenance();
      
      // Update statistics
      if (results.securityViolationsProcessed) {
        this.maintenanceStats.totalViolationsProcessed += results.securityViolationsProcessed;
      }
      
      this.logger.info('Security maintenance completed successfully', {
        ...results,
        timestamp
      });

      // Alert if significant security issues were found
      if (results.securityViolationsProcessed > 0 || results.suspiciousSessionsInvestigated > 5) {
        this.logger.warn('Significant security issues detected during maintenance', {
          violations: results.securityViolationsProcessed,
          suspiciousSessions: results.suspiciousSessionsInvestigated,
          timestamp
        });
      }

      return results;

    } catch (error: any) {
      this.logger.error('Security maintenance failed:', error);
      throw error;
    }
  }

  /**
   * Health check for the scheduler service
   */
  public healthCheck(): {
    healthy: boolean;
    issues: string[];
    lastRuns: {
      cleanup?: string;
      security?: string;
    };
    statistics: MaintenanceStats;
  } {
    const issues: string[] = [];
    const now = Date.now();
    const maxGapMs = this.MAINTENANCE_INTERVAL_MS * 2; // 30 minutes

    // Check if cleanup is running regularly
    if (this.lastCleanupRun) {
      const lastCleanupTime = new Date(this.lastCleanupRun).getTime();
      if (now - lastCleanupTime > maxGapMs) {
        issues.push('Session cleanup has not run recently');
      }
    } else if (this.maintenanceIntervalId) {
      issues.push('Session cleanup has never run');
    }

    // Check if security maintenance is running regularly
    if (this.lastSecurityMaintenanceRun) {
      const lastSecurityTime = new Date(this.lastSecurityMaintenanceRun).getTime();
      if (now - lastSecurityTime > maxGapMs) {
        issues.push('Security maintenance has not run recently');
      }
    } else if (this.maintenanceIntervalId) {
      issues.push('Security maintenance has never run');
    }

    // Check for recent errors
    if (this.lastError) {
      issues.push(`Recent error: ${this.lastError}`);
    }

    // Check if scheduler should be running but isn't
    if (this.ENABLE_AUTOMATIC_MAINTENANCE && !this.maintenanceIntervalId) {
      issues.push('Scheduler is not running but should be');
    }

    return {
      healthy: issues.length === 0,
      issues,
      lastRuns: {
        cleanup: this.lastCleanupRun,
        security: this.lastSecurityMaintenanceRun
      },
      statistics: { ...this.maintenanceStats }
    };
  }
}

// Export singleton instance
export default SessionSchedulerService.getInstance();