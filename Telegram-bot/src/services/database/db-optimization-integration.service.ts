import { logger } from '../logger';
import { storage } from '../../storage';
import { dbOptimizer } from './db-optimizer.service';
import { queryPerformanceMonitor, QueryTracker } from './query-performance-monitor.service';
import { EventEmitter } from 'events';

interface OptimizationReport {
  timestamp: string;
  storageType: string;
  overallHealthScore: number;
  caching: {
    hitRate: number;
    recommendations: string[];
  };
  indexing: {
    status: string;
    suggestions: any[];
  };
  connections: {
    utilization: string;
    recommendations: string[];
  };
  performance: {
    avgQueryTime: string;
    slowQueries: number;
    errorRate: string;
  };
  actionItems: Array<{
    priority: 'high' | 'medium' | 'low';
    action: string;
    estimatedImpact: string;
  }>;
}

/**
 * Database Optimization Integration Service
 * Coordinates database optimization with external monitoring and performance tracking
 */
export class DatabaseOptimizationIntegration extends EventEmitter {
  private static instance: DatabaseOptimizationIntegration;
  private isInitialized = false;
  private optimizationInterval: NodeJS.Timeout | null = null;
  private reportingInterval: NodeJS.Timeout | null = null;

  private constructor() {
    super();
  }

  public static getInstance(): DatabaseOptimizationIntegration {
    if (!DatabaseOptimizationIntegration.instance) {
      DatabaseOptimizationIntegration.instance = new DatabaseOptimizationIntegration();
    }
    return DatabaseOptimizationIntegration.instance;
  }

  /**
   * Initialize database optimization integration
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Database optimization integration already initialized');
      return;
    }

    try {
      logger.info('Initializing Database Optimization Integration...');
      
      // Ensure storage is initialized first
      if (!storage.isReady()) {
        await storage.initialize();
      }

      // Initialize optimal database indexes
      await dbOptimizer.ensureOptimalIndexes();
      
      // Warm up caches with frequently accessed data
      await dbOptimizer.warmUpCaches();
      
      // Set up cross-service event listeners
      this.setupEventListeners();
      
      // Start periodic optimization tasks
      this.startOptimizationTasks();
      
      // Start reporting and monitoring
      this.startReporting();
      
      this.isInitialized = true;
      logger.info('✅ Database Optimization Integration initialized successfully');
      
    } catch (error) {
      logger.error('Failed to initialize Database Optimization Integration:', error);
      throw error;
    }
  }

  /**
   * Set up event listeners between optimization services
   */
  private setupEventListeners(): void {
    // Listen to database optimizer events
    dbOptimizer.on('healthCheckFailed', (event) => {
      logger.warn('Database health check failed', event);
      this.emit('connectionIssue', event);
    });

    dbOptimizer.on('metric', (metric) => {
      // Forward important metrics to external monitoring systems
      if (metric.type === 'error' || (metric.type === 'query' && metric.duration > 1000)) {
        this.emit('performanceAlert', metric);
      }
    });

    // Listen to performance monitor events if available
    if (queryPerformanceMonitor && typeof queryPerformanceMonitor.on === 'function') {
      queryPerformanceMonitor.on('slowQuery', (details) => {
        logger.warn('Slow query detected', {
          queryType: details.queryType,
          duration: details.duration
        });
      });

      queryPerformanceMonitor.on('criticalSlowQuery', (details) => {
        logger.error('CRITICAL SLOW QUERY DETECTED', {
          queryType: details.queryType,
          collection: details.collection,
          duration: details.duration,
          parameters: details.parameters
        });
        
        // Emit alert for external monitoring systems
        this.emit('criticalPerformanceIssue', details);
      });
    }

    logger.debug('Database optimization event listeners configured');
  }

  /**
   * Start periodic optimization tasks
   */
  private startOptimizationTasks(): void {
    // Run optimization analysis every 15 minutes
    this.optimizationInterval = setInterval(async () => {
      await this.runPeriodicOptimization();
    }, 15 * 60 * 1000);

    logger.info('Periodic database optimization tasks started');
  }

  /**
   * Start performance reporting
   */
  private startReporting(): void {
    // Generate comprehensive reports every hour
    this.reportingInterval = setInterval(() => {
      this.generateOptimizationReport();
    }, 60 * 60 * 1000);

    logger.info('Database optimization reporting started');
  }

  /**
   * Run periodic optimization tasks
   */
  private async runPeriodicOptimization(): Promise<void> {
    try {
      logger.debug('Running periodic database optimization...');
      
      // Get comprehensive optimization report
      const report = dbOptimizer.getOptimizationReport();
      
      // Analyze index needs based on query patterns
      const indexAnalyses = dbOptimizer.analyzeIndexNeeds();
      if (indexAnalyses.length > 0) {
        logger.info(`Database Optimization: ${indexAnalyses.length} index suggestions available`);
      }
      
      // Clear stale caches if memory pressure detected
      if (this.isMemoryPressureDetected(report)) {
        logger.info('Memory pressure detected, clearing stale caches');
        this.clearStaleCaches();
      }
      
      // Log important recommendations
      if (report.recommendations && report.recommendations.length > 0) {
        const highPriorityRecs = report.recommendations.filter((r: { priority: string }) => r.priority === 'high');
        if (highPriorityRecs.length > 0) {
          logger.warn('High priority database optimization recommendations', {
            count: highPriorityRecs.length,
            recommendations: highPriorityRecs.map((r: { action: string }) => r.action)
          });
        }
      }
      
    } catch (error) {
      logger.error('Error during periodic optimization:', error);
    }
  }

  private isMemoryPressureDetected(report: any): boolean {
    // Check various indicators of memory pressure
    const queryReport = report.query;
    if (!queryReport || !queryReport.cacheStatistics) {
      return false;
    }

    const hitRateString = queryReport.cacheStatistics.hitRate;
    const hitRate = parseFloat(hitRateString.replace('%', ''));
    
    // Memory pressure indicators:
    // 1. Low cache hit rate (< 30%)
    // 2. High eviction rate
    // 3. Overall health score < 70
    return hitRate < 30 || 
           report.overallHealthScore < 70 || 
           queryReport.cacheStatistics.evictions > 1000;
  }

  private clearStaleCaches(): void {
    // Clear caches to free up memory during pressure
    logger.info('Clearing stale caches due to memory pressure');
    
    // Clear all caches except hot data which is most frequently accessed
    dbOptimizer.clearCache('user');
    dbOptimizer.clearCache('security');
    dbOptimizer.clearCache('task');
    dbOptimizer.clearCache('device');
  }

  /**
   * Generate comprehensive optimization report
   */
  generateOptimizationReport(): OptimizationReport {
    try {
      const optimizerReport = dbOptimizer.getOptimizationReport();
      const performanceReport = this.getPerformanceMetrics();
      
      // Extract data from the unified optimizer report
      const connectionReport = optimizerReport.connection;
      const queryReport = optimizerReport.query;
      const indexReport = optimizerReport.indexing;
      
      // Calculate overall health score (already calculated in optimizer)
      const overallHealthScore = optimizerReport.overallHealthScore;
      
      // Generate prioritized action items
      const actionItems = optimizerReport.recommendations || [];
      
      const report: OptimizationReport = {
        timestamp: new Date().toISOString(),
        storageType: optimizerReport.storageType,
        overallHealthScore,
        caching: {
          hitRate: parseFloat(queryReport.cacheStatistics.hitRate.replace('%', '')),
          recommendations: this.extractCachingRecommendations(queryReport)
        },
        indexing: {
          status: indexReport.indexAnalysis.length === 0 ? 'optimal' : 'needs_attention',
          suggestions: indexReport.indexAnalysis || []
        },
        connections: {
          utilization: connectionReport.performanceAnalysis.connectionUtilization,
          recommendations: connectionReport.recommendations || []
        },
        performance: {
          avgQueryTime: connectionReport.performanceAnalysis.averageQueryTime,
          slowQueries: this.countSlowQueries(queryReport.queryPatterns),
          errorRate: this.calculateErrorRate(connectionReport)
        },
        actionItems
      };
      
      // Emit report for external monitoring
      this.emit('optimizationReport', report);
      
      // Log summary
      if (overallHealthScore < 80) {
        logger.warn('Database health score below threshold', {
          score: overallHealthScore,
          actionItems: actionItems.length
        });
      } else {
        logger.info('Database optimization report generated', {
          score: overallHealthScore,
          cacheHitRate: report.caching.hitRate
        });
      }
      
      return report;
      
    } catch (error) {
      logger.error('Failed to generate optimization report:', error);
      
      // Return minimal report on error
      return {
        timestamp: new Date().toISOString(),
        storageType: 'unknown',
        overallHealthScore: 0,
        caching: { hitRate: 0, recommendations: ['Error generating cache report'] },
        indexing: { status: 'error', suggestions: [] },
        connections: { utilization: '0%', recommendations: ['Error generating connection report'] },
        performance: { avgQueryTime: '0ms', slowQueries: 0, errorRate: '0%' },
        actionItems: [{ 
          priority: 'high', 
          action: 'Investigate reporting system failure', 
          estimatedImpact: 'Critical - monitoring is compromised' 
        }]
      };
    }
  }

  private getPerformanceMetrics(): any {
    // Get performance metrics from query performance monitor if available
    if (queryPerformanceMonitor && typeof queryPerformanceMonitor.getPerformanceReport === 'function') {
      return queryPerformanceMonitor.getPerformanceReport();
    }
    
    return {
      healthScore: 100,
      avgQueryTime: 0,
      errorRate: 0
    };
  }

  private extractCachingRecommendations(queryReport: any): string[] {
    const recommendations: string[] = [];
    
    if (queryReport.recommendations) {
      // Filter for cache-related recommendations
      recommendations.push(...queryReport.recommendations);
    }
    
    const hitRate = parseFloat(queryReport.cacheStatistics.hitRate.replace('%', ''));
    if (hitRate < 50) {
      recommendations.push('Consider increasing cache sizes or adjusting TTL values');
    }
    
    if (queryReport.cacheStatistics.evictions > 100) {
      recommendations.push('High cache eviction rate - consider memory optimization');
    }
    
    return recommendations;
  }

  private countSlowQueries(queryPatterns: any[]): number {
    if (!Array.isArray(queryPatterns)) {
      return 0;
    }
    
    return queryPatterns.filter(pattern => pattern.avgDuration > 100).length;
  }

  private calculateErrorRate(connectionReport: any): string {
    const successRate = connectionReport.performanceAnalysis.successRate;
    if (successRate === 'N/A') {
      return '0%';
    }
    
    const successPercent = parseFloat(successRate.replace('%', ''));
    const errorPercent = 100 - successPercent;
    return errorPercent.toFixed(2) + '%';
  }

  /**
   * Force optimization run (for admin/testing purposes)
   */
  async forceOptimizationRun(): Promise<OptimizationReport> {
    logger.info('Manual optimization run triggered');
    await this.runPeriodicOptimization();
    return this.generateOptimizationReport();
  }

  /**
   * Get current optimization status
   */
  getOptimizationStatus(): any {
    return {
      initialized: this.isInitialized,
      optimizationActive: this.optimizationInterval !== null,
      reportingActive: this.reportingInterval !== null,
      lastReport: this.generateOptimizationReport()
    };
  }

  /**
   * Cleanup and shutdown
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down Database Optimization Integration...');
    
    if (this.optimizationInterval) {
      clearInterval(this.optimizationInterval);
      this.optimizationInterval = null;
    }
    
    if (this.reportingInterval) {
      clearInterval(this.reportingInterval);
      this.reportingInterval = null;
    }
    
    // Shutdown the database optimizer
    dbOptimizer.shutdown();
    
    this.isInitialized = false;
    logger.info('Database Optimization Integration shutdown completed');
  }

  /**
   * Health check for the optimization system
   */
  async healthCheck(): Promise<{ status: 'healthy' | 'degraded' | 'unhealthy'; details: any }> {
    try {
      if (!this.isInitialized) {
        return {
          status: 'unhealthy',
          details: { error: 'Integration not initialized' }
        };
      }
      
      const report = dbOptimizer.getOptimizationReport();
      const healthScore = report.overallHealthScore;
      
      let status: 'healthy' | 'degraded' | 'unhealthy';
      if (healthScore >= 80) {
        status = 'healthy';
      } else if (healthScore >= 60) {
        status = 'degraded';
      } else {
        status = 'unhealthy';
      }
      
      return {
        status,
        details: {
          healthScore,
          storageType: report.storageType,
          cacheHitRate: report.query?.cacheStatistics?.hitRate,
          connectionUtilization: report.connection?.performanceAnalysis?.connectionUtilization,
          recommendationCount: report.recommendations?.length || 0
        }
      };
      
    } catch (error) {
      logger.error('Health check failed:', error);
      const message = error instanceof Error ? error.message : String(error);
      return {
        status: 'unhealthy',
        details: { error: message }
      };
    }
  }
}

// Export singleton instance
export const dbOptimizationIntegration = DatabaseOptimizationIntegration.getInstance();
export default dbOptimizationIntegration;