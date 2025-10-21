import { Request, Response, NextFunction } from 'express';
import { Logger } from '../services/logger';

interface PerformanceMetrics {
  requestCount: number;
  averageResponseTime: number;
  slowRequests: number;
  errorCount: number;
  lastReset: Date;
  endpoints: Map<string, {
    count: number;
    totalTime: number;
    maxTime: number;
    minTime: number;
    errors: number;
  }>;
}

/**
 * Performance monitoring middleware for Express applications
 * Tracks request metrics, response times, and endpoint performance
 */
class PerformanceMonitor {
  private static instance: PerformanceMonitor;
  private readonly logger = Logger.getInstance();
  private metrics: PerformanceMetrics;
  private readonly SLOW_REQUEST_THRESHOLD = 1000; // ms
  private readonly METRICS_RESET_INTERVAL = 60 * 60 * 1000; // 1 hour

  private constructor() {
    this.metrics = {
      requestCount: 0,
      averageResponseTime: 0,
      slowRequests: 0,
      errorCount: 0,
      lastReset: new Date(),
      endpoints: new Map()
    };

    // Reset metrics periodically
    setInterval(() => {
      this.resetMetrics();
    }, this.METRICS_RESET_INTERVAL);
  }

  public static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor();
    }
    return PerformanceMonitor.instance;
  }

  /**
   * Express middleware for performance monitoring
   */
  public middleware() {
    return (req: Request, res: Response, next: NextFunction) => {
      const startTime = Date.now();
      const endpoint = `${req.method} ${req.route?.path || req.path}`;

      // Track request start
      this.metrics.requestCount++;

      // Handle response completion
      res.on('finish', () => {
        const responseTime = Date.now() - startTime;
        const isError = res.statusCode >= 400;

        this.updateMetrics(endpoint, responseTime, isError);

        // Log slow requests
        if (responseTime > this.SLOW_REQUEST_THRESHOLD) {
          this.logger.warn('Slow request detected', {
            endpoint,
            responseTime,
            statusCode: res.statusCode,
            method: req.method,
            path: req.path
          });
        }
      });

      next();
    };
  }

  /**
   * Update performance metrics
   */
  private updateMetrics(endpoint: string, responseTime: number, isError: boolean): void {
    // Update global metrics
    if (isError) {
      this.metrics.errorCount++;
    }

    if (responseTime > this.SLOW_REQUEST_THRESHOLD) {
      this.metrics.slowRequests++;
    }

    // Update endpoint-specific metrics
    let endpointMetrics = this.metrics.endpoints.get(endpoint);
    if (!endpointMetrics) {
      endpointMetrics = {
        count: 0,
        totalTime: 0,
        maxTime: 0,
        minTime: Infinity,
        errors: 0
      };
      this.metrics.endpoints.set(endpoint, endpointMetrics);
    }

    endpointMetrics.count++;
    endpointMetrics.totalTime += responseTime;
    endpointMetrics.maxTime = Math.max(endpointMetrics.maxTime, responseTime);
    endpointMetrics.minTime = Math.min(endpointMetrics.minTime, responseTime);
    
    if (isError) {
      endpointMetrics.errors++;
    }

    // Update global average response time
    this.calculateAverageResponseTime();
  }

  /**
   * Calculate average response time across all requests
   */
  private calculateAverageResponseTime(): void {
    let totalTime = 0;
    let totalCount = 0;

    for (const metrics of this.metrics.endpoints.values()) {
      totalTime += metrics.totalTime;
      totalCount += metrics.count;
    }

    this.metrics.averageResponseTime = totalCount > 0 ? totalTime / totalCount : 0;
  }

  /**
   * Get current performance metrics
   */
  public getMetrics(): PerformanceMetrics & {
    endpointsArray: Array<{
      endpoint: string;
      count: number;
      averageTime: number;
      maxTime: number;
      minTime: number;
      errorRate: number;
    }>;
  } {
    const endpointsArray = Array.from(this.metrics.endpoints.entries()).map(([endpoint, metrics]) => ({
      endpoint,
      count: metrics.count,
      averageTime: metrics.count > 0 ? metrics.totalTime / metrics.count : 0,
      maxTime: metrics.maxTime,
      minTime: metrics.minTime === Infinity ? 0 : metrics.minTime,
      errorRate: metrics.count > 0 ? (metrics.errors / metrics.count) * 100 : 0
    }));

    return {
      ...this.metrics,
      endpointsArray
    };
  }

  /**
   * Reset all metrics
   */
  private resetMetrics(): void {
    this.logger.info('Resetting performance metrics', this.getMetrics());
    
    this.metrics = {
      requestCount: 0,
      averageResponseTime: 0,
      slowRequests: 0,
      errorCount: 0,
      lastReset: new Date(),
      endpoints: new Map()
    };
  }

  /**
   * Get performance summary for health checks
   */
  public getPerformanceSummary(): {
    status: 'healthy' | 'degraded' | 'unhealthy';
    metrics: {
      requestCount: number;
      averageResponseTime: number;
      slowRequestPercentage: number;
      errorRate: number;
    };
  } {
    const slowRequestPercentage = this.metrics.requestCount > 0 
      ? (this.metrics.slowRequests / this.metrics.requestCount) * 100 
      : 0;
    
    const errorRate = this.metrics.requestCount > 0 
      ? (this.metrics.errorCount / this.metrics.requestCount) * 100 
      : 0;

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    
    if (errorRate > 10 || slowRequestPercentage > 25) {
      status = 'unhealthy';
    } else if (errorRate > 5 || slowRequestPercentage > 10) {
      status = 'degraded';
    }

    return {
      status,
      metrics: {
        requestCount: this.metrics.requestCount,
        averageResponseTime: Math.round(this.metrics.averageResponseTime),
        slowRequestPercentage: Math.round(slowRequestPercentage * 100) / 100,
        errorRate: Math.round(errorRate * 100) / 100
      }
    };
  }
}

export default PerformanceMonitor;