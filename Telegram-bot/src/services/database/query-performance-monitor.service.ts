import { EventEmitter } from 'events';
import { logger } from '../logger';
import { storage } from '../../storage';
import { performance } from 'perf_hooks';
import { LRUCache } from 'lru-cache';

interface QueryExecutionDetails {
  queryId: string;
  queryType: string;
  collection: string;
  parameters: any;
  duration: number;
  timestamp: number;
  stackTrace?: string;
  resultCount?: number;
  cacheHit: boolean;
  errorMessage?: string;
  userId?: string;
  clientInfo?: any;
}

interface QueryPerformanceMetrics {
  queryType: string;
  collection: string;
  totalExecutions: number;
  totalDuration: number;
  avgDuration: number;
  minDuration: number;
  maxDuration: number;
  errorCount: number;
  cacheHitRate: number;
  p95Duration: number;
  p99Duration: number;
  lastExecuted: number;
}

interface SlowQueryAlert {
  queryId: string;
  queryType: string;
  collection: string;
  duration: number;
  threshold: number;
  timestamp: number;
  frequency: number;
  isRecurring: boolean;
}

interface QueryRecommendation {
  queryType: string;
  collection: string;
  issue: string;
  recommendation: string;
  impact: 'high' | 'medium' | 'low';
  estimatedImprovement: string;
}

/**
 * Advanced Query Performance Monitor
 * Tracks, analyzes, and provides insights about database query performance
 */
export class QueryPerformanceMonitor extends EventEmitter {
  private static instance: QueryPerformanceMonitor;
  
  // Query execution tracking
  private queryExecutions: LRUCache<string, QueryExecutionDetails>;
  private performanceMetrics: Map<string, QueryPerformanceMetrics> = new Map();
  private slowQueryAlerts: Map<string, SlowQueryAlert> = new Map();
  
  // Performance thresholds (in milliseconds)
  private readonly performanceThresholds = {
    slow: 100,      // Queries taking > 100ms are considered slow
    critical: 500,  // Queries taking > 500ms are critical
    timeout: 5000   // Queries taking > 5s should be investigated
  };

  // Query pattern detection
  private queryPatterns: Map<string, {
    pattern: string;
    frequency: number;
    avgDuration: number;
    lastSeen: number;
  }> = new Map();

  // Real-time monitoring
  private monitoringInterval: NodeJS.Timeout | null = null;
  private alertingEnabled = true;

  // Statistics collection
  private dailyStats = {
    totalQueries: 0,
    slowQueries: 0,
    errorQueries: 0,
    cacheHits: 0,
    avgResponseTime: 0
  };

  private constructor() {
    super();
    
    // Initialize query execution cache
    this.queryExecutions = new LRUCache({
      max: 10000, // Keep last 10k queries
      ttl: 24 * 60 * 60 * 1000, // 24 hours
      updateAgeOnGet: false
    });

    this.startPerformanceMonitoring();
  }

  public static getInstance(): QueryPerformanceMonitor {
    if (!QueryPerformanceMonitor.instance) {
      QueryPerformanceMonitor.instance = new QueryPerformanceMonitor();
    }
    return QueryPerformanceMonitor.instance;
  }

  /**
   * Track a query execution with detailed metrics
   */
  trackQuery(
    queryType: string,
    collection: string,
    parameters: any = {},
    userId?: string,
    clientInfo?: any
  ): QueryTracker {
    const queryId = this.generateQueryId();
    const startTime = performance.now();
    const timestamp = Date.now();

    return new QueryTracker(
      queryId,
      queryType,
      collection,
      parameters,
      startTime,
      timestamp,
      userId,
      clientInfo,
      this
    );
  }

  /**
   * Record completed query execution
   */
  recordQueryExecution(details: QueryExecutionDetails): void {
    // Store execution details
    this.queryExecutions.set(details.queryId, details);
    
    // Update performance metrics
    this.updatePerformanceMetrics(details);
    
    // Check for slow queries
    this.checkSlowQuery(details);
    
    // Update daily statistics
    this.updateDailyStats(details);
    
    // Update query patterns
    this.updateQueryPatterns(details);
    
    // Emit events for real-time monitoring
    this.emit('queryExecuted', details);
    
    if (details.duration > this.performanceThresholds.slow) {
      this.emit('slowQuery', details);
    }
    
    if (details.errorMessage) {
      this.emit('queryError', details);
    }
  }

  private generateQueryId(): string {
    return `query_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private updatePerformanceMetrics(details: QueryExecutionDetails): void {
    const key = `${details.queryType}:${details.collection}`;
    const existing = this.performanceMetrics.get(key);
    
    if (existing) {
      // Update existing metrics
      existing.totalExecutions++;
      existing.totalDuration += details.duration;
      existing.avgDuration = existing.totalDuration / existing.totalExecutions;
      existing.minDuration = Math.min(existing.minDuration, details.duration);
      existing.maxDuration = Math.max(existing.maxDuration, details.duration);
      existing.lastExecuted = details.timestamp;
      
      if (details.errorMessage) {
        existing.errorCount++;
      }
      
      if (details.cacheHit) {
        // Update cache hit rate
        const totalCacheableQueries = existing.totalExecutions;
        const cacheHits = Math.floor(existing.cacheHitRate * totalCacheableQueries) + 1;
        existing.cacheHitRate = cacheHits / totalCacheableQueries;
      }
      
      // Update percentiles (simplified calculation)
      this.updatePercentiles(existing, details.duration);
    } else {
      // Create new metrics entry
      this.performanceMetrics.set(key, {
        queryType: details.queryType,
        collection: details.collection,
        totalExecutions: 1,
        totalDuration: details.duration,
        avgDuration: details.duration,
        minDuration: details.duration,
        maxDuration: details.duration,
        errorCount: details.errorMessage ? 1 : 0,
        cacheHitRate: details.cacheHit ? 1 : 0,
        p95Duration: details.duration,
        p99Duration: details.duration,
        lastExecuted: details.timestamp
      });
    }
  }

  private updatePercentiles(metrics: QueryPerformanceMetrics, duration: number): void {
    // Simplified percentile calculation
    // In a real implementation, you'd maintain a sorted array or use a proper percentile library
    
    if (duration > metrics.p95Duration) {
      metrics.p95Duration = duration;
    }
    
    if (duration > metrics.p99Duration) {
      metrics.p99Duration = duration;
    }
  }

  private checkSlowQuery(details: QueryExecutionDetails): void {
    if (details.duration > this.performanceThresholds.slow) {
      const alertKey = `${details.queryType}:${details.collection}`;
      const existing = this.slowQueryAlerts.get(alertKey);
      
      if (existing) {
        existing.frequency++;
        existing.isRecurring = existing.frequency > 5;
        if (details.duration > existing.duration) {
          existing.duration = details.duration;
          existing.queryId = details.queryId;
        }
        existing.timestamp = details.timestamp;
      } else {
        this.slowQueryAlerts.set(alertKey, {
          queryId: details.queryId,
          queryType: details.queryType,
          collection: details.collection,
          duration: details.duration,
          threshold: this.performanceThresholds.slow,
          timestamp: details.timestamp,
          frequency: 1,
          isRecurring: false
        });
      }
      
      // Generate alert if enabled
      if (this.alertingEnabled && details.duration > this.performanceThresholds.critical) {
        this.generatePerformanceAlert(details);
      }
    }
  }

  private generatePerformanceAlert(details: QueryExecutionDetails): void {
    logger.warn('CRITICAL SLOW QUERY DETECTED', {
      queryId: details.queryId,
      queryType: details.queryType,
      collection: details.collection,
      duration: details.duration,
      threshold: this.performanceThresholds.critical,
      parameters: details.parameters,
      userId: details.userId
    });
    
    this.emit('criticalSlowQuery', details);
  }

  private updateDailyStats(details: QueryExecutionDetails): void {
    this.dailyStats.totalQueries++;
    
    if (details.duration > this.performanceThresholds.slow) {
      this.dailyStats.slowQueries++;
    }
    
    if (details.errorMessage) {
      this.dailyStats.errorQueries++;
    }
    
    if (details.cacheHit) {
      this.dailyStats.cacheHits++;
    }
    
    // Update average response time
    const totalResponseTime = this.dailyStats.avgResponseTime * (this.dailyStats.totalQueries - 1);
    this.dailyStats.avgResponseTime = (totalResponseTime + details.duration) / this.dailyStats.totalQueries;
  }

  private updateQueryPatterns(details: QueryExecutionDetails): void {
    const patternKey = this.generatePatternKey(details);
    const existing = this.queryPatterns.get(patternKey);
    
    if (existing) {
      existing.frequency++;
      existing.avgDuration = (existing.avgDuration + details.duration) / 2;
      existing.lastSeen = details.timestamp;
    } else {
      this.queryPatterns.set(patternKey, {
        pattern: patternKey,
        frequency: 1,
        avgDuration: details.duration,
        lastSeen: details.timestamp
      });
    }
  }

  private generatePatternKey(details: QueryExecutionDetails): string {
    // Generate a pattern key that identifies similar queries
    const paramTypes = Object.keys(details.parameters).sort().join(',');
    return `${details.queryType}:${details.collection}:${paramTypes}`;
  }

  private startPerformanceMonitoring(): void {
    // Monitor performance every minute
    this.monitoringInterval = setInterval(() => {
      this.performPerformanceAnalysis();
    }, 60 * 1000);

    // Clean up old data every hour
    setInterval(() => {
      this.cleanupOldData();
    }, 60 * 60 * 1000);

    // Reset daily stats every day
    setInterval(() => {
      this.resetDailyStats();
    }, 24 * 60 * 60 * 1000);

    logger.info('Query performance monitoring started');
  }

  private performPerformanceAnalysis(): void {
    // Analyze current performance and generate recommendations
    const slowQueries = this.getSlowQueries(10);
    const frequentQueries = this.getFrequentQueries(10);
    
    if (slowQueries.length > 0) {
      logger.info(`Performance Analysis: ${slowQueries.length} slow query types detected`);
    }
    
    // Generate recommendations
    const recommendations = this.generateRecommendations();
    if (recommendations.length > 0) {
      logger.info(`Generated ${recommendations.length} performance recommendations`);
      this.emit('recommendations', recommendations);
    }
    
    // Emit performance summary
    this.emit('performanceSummary', {
      totalQueries: this.dailyStats.totalQueries,
      slowQueries: this.dailyStats.slowQueries,
      errorRate: this.dailyStats.totalQueries > 0 
        ? (this.dailyStats.errorQueries / this.dailyStats.totalQueries * 100).toFixed(2) + '%'
        : '0%',
      cacheHitRate: this.dailyStats.totalQueries > 0 
        ? (this.dailyStats.cacheHits / this.dailyStats.totalQueries * 100).toFixed(2) + '%'
        : '0%',
      avgResponseTime: this.dailyStats.avgResponseTime.toFixed(2) + 'ms'
    });
  }

  private cleanupOldData(): void {
    const cutoff = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago
    
    // Clean old query patterns
    for (const [key, pattern] of this.queryPatterns.entries()) {
      if (pattern.lastSeen < cutoff) {
        this.queryPatterns.delete(key);
      }
    }
    
    // Clean old slow query alerts
    for (const [key, alert] of this.slowQueryAlerts.entries()) {
      if (alert.timestamp < cutoff) {
        this.slowQueryAlerts.delete(key);
      }
    }
    
    logger.debug('Cleaned up old performance monitoring data');
  }

  private resetDailyStats(): void {
    logger.info('Daily Query Stats', { ...this.dailyStats });
    
    this.dailyStats = {
      totalQueries: 0,
      slowQueries: 0,
      errorQueries: 0,
      cacheHits: 0,
      avgResponseTime: 0
    };
  }

  /**
   * Get slow queries sorted by duration
   */
  getSlowQueries(limit: number = 20): QueryPerformanceMetrics[] {
    return Array.from(this.performanceMetrics.values())
      .filter(metrics => metrics.avgDuration > this.performanceThresholds.slow)
      .sort((a, b) => b.avgDuration - a.avgDuration)
      .slice(0, limit);
  }

  /**
   * Get frequently executed queries
   */
  getFrequentQueries(limit: number = 20): QueryPerformanceMetrics[] {
    return Array.from(this.performanceMetrics.values())
      .sort((a, b) => b.totalExecutions - a.totalExecutions)
      .slice(0, limit);
  }

  /**
   * Get queries with high error rates
   */
  getErrorProneQueries(limit: number = 10): QueryPerformanceMetrics[] {
    return Array.from(this.performanceMetrics.values())
      .filter(metrics => metrics.errorCount > 0)
      .sort((a, b) => {
        const errorRateA = a.errorCount / a.totalExecutions;
        const errorRateB = b.errorCount / b.totalExecutions;
        return errorRateB - errorRateA;
      })
      .slice(0, limit);
  }

  /**
   * Generate performance recommendations
   */
  generateRecommendations(): QueryRecommendation[] {
    const recommendations: QueryRecommendation[] = [];
    
    // Analyze slow queries
    const slowQueries = this.getSlowQueries(10);
    for (const query of slowQueries) {
      if (query.avgDuration > this.performanceThresholds.critical) {
        recommendations.push({
          queryType: query.queryType,
          collection: query.collection,
          issue: `Very slow average response time: ${query.avgDuration.toFixed(2)}ms`,
          recommendation: 'Consider adding indexes, optimizing query structure, or implementing caching',
          impact: 'high',
          estimatedImprovement: `${Math.floor(query.avgDuration * 0.7)}ms potential reduction`
        });
      }
    }
    
    // Analyze frequent slow queries
    const frequentQueries = this.getFrequentQueries(10);
    for (const query of frequentQueries) {
      if (query.totalExecutions > 1000 && query.avgDuration > 50) {
        recommendations.push({
          queryType: query.queryType,
          collection: query.collection,
          issue: `High-frequency query with moderate latency: ${query.totalExecutions} executions, ${query.avgDuration.toFixed(2)}ms avg`,
          recommendation: 'High impact caching candidate - consider implementing query result caching',
          impact: 'medium',
          estimatedImprovement: `${query.totalExecutions * query.avgDuration * 0.8}ms total time saved`
        });
      }
    }
    
    // Analyze error-prone queries
    const errorQueries = this.getErrorProneQueries(5);
    for (const query of errorQueries) {
      const errorRate = (query.errorCount / query.totalExecutions) * 100;
      if (errorRate > 5) {
        recommendations.push({
          queryType: query.queryType,
          collection: query.collection,
          issue: `High error rate: ${errorRate.toFixed(1)}% of executions fail`,
          recommendation: 'Investigate query parameters, add proper validation, and improve error handling',
          impact: 'high',
          estimatedImprovement: `${query.errorCount} fewer errors with proper handling`
        });
      }
    }
    
    // Analyze cache opportunities
    for (const [key, metrics] of this.performanceMetrics.entries()) {
      if (metrics.totalExecutions > 100 && metrics.cacheHitRate < 0.3) {
        recommendations.push({
          queryType: metrics.queryType,
          collection: metrics.collection,
          issue: `Low cache hit rate: ${(metrics.cacheHitRate * 100).toFixed(1)}%`,
          recommendation: 'Implement or improve caching strategy for this query pattern',
          impact: 'medium',
          estimatedImprovement: `${((1 - metrics.cacheHitRate) * metrics.totalExecutions * 0.7).toFixed(0)} cache hits potential`
        });
      }
    }
    
    return recommendations.sort((a, b) => {
      const impactWeight = { high: 3, medium: 2, low: 1 };
      return impactWeight[b.impact] - impactWeight[a.impact];
    });
  }

  /**
   * Get comprehensive performance report
   */
  getPerformanceReport(): any {
    const slowQueries = this.getSlowQueries(10);
    const frequentQueries = this.getFrequentQueries(10);
    const errorQueries = this.getErrorProneQueries(5);
    const recommendations = this.generateRecommendations();
    
    // Calculate overall health score (0-100)
    const avgResponseTime = this.dailyStats.avgResponseTime;
    const errorRate = this.dailyStats.totalQueries > 0 
      ? (this.dailyStats.errorQueries / this.dailyStats.totalQueries)
      : 0;
    const slowQueryRate = this.dailyStats.totalQueries > 0 
      ? (this.dailyStats.slowQueries / this.dailyStats.totalQueries)
      : 0;
    
    let healthScore = 100;
    healthScore -= Math.min(avgResponseTime / 10, 40); // Penalize slow responses
    healthScore -= errorRate * 100 * 2; // Heavily penalize errors
    healthScore -= slowQueryRate * 100; // Penalize slow queries
    healthScore = Math.max(0, Math.floor(healthScore));
    
    return {
      healthScore,
      summary: {
        totalQueries: this.dailyStats.totalQueries,
        avgResponseTime: this.dailyStats.avgResponseTime.toFixed(2) + 'ms',
        errorRate: (errorRate * 100).toFixed(2) + '%',
        cacheHitRate: this.dailyStats.totalQueries > 0 
          ? (this.dailyStats.cacheHits / this.dailyStats.totalQueries * 100).toFixed(2) + '%'
          : '0%',
        slowQueryRate: (slowQueryRate * 100).toFixed(2) + '%'
      },
      slowQueries: slowQueries.slice(0, 5),
      frequentQueries: frequentQueries.slice(0, 5),
      errorProneQueries: errorQueries,
      recommendations: recommendations.slice(0, 5),
      queryPatterns: Array.from(this.queryPatterns.values())
        .sort((a, b) => b.frequency - a.frequency)
        .slice(0, 10)
    };
  }

  /**
   * Enable or disable alerting
   */
  setAlerting(enabled: boolean): void {
    this.alertingEnabled = enabled;
    logger.info(`Query performance alerting ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Clear all performance data
   */
  clearPerformanceData(): void {
    this.queryExecutions.clear();
    this.performanceMetrics.clear();
    this.slowQueryAlerts.clear();
    this.queryPatterns.clear();
    this.resetDailyStats();
    
    logger.info('Query performance data cleared');
  }

  /**
   * Shutdown monitoring
   */
  shutdown(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    
    logger.info('Query performance monitoring shutdown');
  }
}

/**
 * Query Tracker - tracks individual query execution
 */
export class QueryTracker {
  constructor(
    private queryId: string,
    private queryType: string,
    private collection: string,
    private parameters: any,
    private startTime: number,
    private timestamp: number,
    private userId?: string,
    private clientInfo?: any,
    private monitor?: QueryPerformanceMonitor
  ) {}

  /**
   * Mark query as completed with results
   */
  complete(resultCount?: number, cacheHit: boolean = false): void {
    if (this.monitor) {
      const duration = performance.now() - this.startTime;
      
      this.monitor.recordQueryExecution({
        queryId: this.queryId,
        queryType: this.queryType,
        collection: this.collection,
        parameters: this.parameters,
        duration,
        timestamp: this.timestamp,
        resultCount,
        cacheHit,
        userId: this.userId,
        clientInfo: this.clientInfo,
        stackTrace: this.captureStackTrace()
      });
    }
  }

  /**
   * Mark query as failed
   */
  fail(error: Error | string): void {
    if (this.monitor) {
      const duration = performance.now() - this.startTime;
      const errorMessage = error instanceof Error ? error.message : error;
      
      this.monitor.recordQueryExecution({
        queryId: this.queryId,
        queryType: this.queryType,
        collection: this.collection,
        parameters: this.parameters,
        duration,
        timestamp: this.timestamp,
        cacheHit: false,
        errorMessage,
        userId: this.userId,
        clientInfo: this.clientInfo,
        stackTrace: this.captureStackTrace()
      });
    }
  }

  private captureStackTrace(): string | undefined {
    try {
      const stack = new Error().stack;
      return stack?.split('\n').slice(2, 8).join('\n'); // Get relevant part of stack trace
    } catch {
      return undefined;
    }
  }
}

// Export singleton instance
export const queryPerformanceMonitor = QueryPerformanceMonitor.getInstance();