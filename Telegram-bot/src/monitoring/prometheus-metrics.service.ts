import { register, collectDefaultMetrics, Counter, Histogram, Gauge, Summary } from 'prom-client';
import { Logger } from '../services/logger';
import { enhancedConfig } from '../config/enhanced-config.service';

/**
 * Enterprise Prometheus Metrics Service for comprehensive monitoring
 * 
 * Includes metrics for:
 * - HTTP requests and performance
 * - Telegram bot operations
 * - Device fingerprint verification
 * - Storage performance (MongoDB)
 * - Background job processing
 * - Security events and violations
 * - System health and resource usage
 */
export class PrometheusMetricsService {
  private static instance: PrometheusMetricsService;
  private logger = Logger.getInstance();
  private isInitialized = false;

  // ============= HTTP & API METRICS =============
  private httpRequestsTotal = new Counter({
    name: 'http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code']
  });

  private httpRequestDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10]
  });

  // ============= TELEGRAM BOT METRICS =============
  private telegramUpdatesTotal = new Counter({
    name: 'telegram_updates_total',
    help: 'Total Telegram updates received',
    labelNames: ['type', 'status']
  });

  private telegramUpdateProcessingTime = new Histogram({
    name: 'telegram_update_processing_seconds',
    help: 'Time taken to process Telegram updates',
    labelNames: ['type', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5, 10, 30]
  });

  private activeUsers = new Gauge({
    name: 'telegram_bot_active_users',
    help: 'Number of active users'
  });

  private totalUsers = new Gauge({
    name: 'telegram_bot_total_users',
    help: 'Total number of registered users'
  });

  private userRegistrationsTotal = new Counter({
    name: 'telegram_bot_user_registrations_total',
    help: 'Total user registrations',
    labelNames: ['status', 'verification_required']
  });

  private pointsAwarded = new Counter({
    name: 'telegram_bot_points_awarded_total',
    help: 'Total points awarded to users',
    labelNames: ['source', 'task_type']
  });

  private tasksCompleted = new Counter({
    name: 'telegram_bot_tasks_completed_total',
    help: 'Total number of completed tasks',
    labelNames: ['task_id', 'task_type', 'verification_method']
  });

  // ============= DEVICE FINGERPRINT METRICS =============
  private deviceFingerprintVerifications = new Counter({
    name: 'device_fingerprint_verifications_total',
    help: 'Total device fingerprint verifications',
    labelNames: ['result', 'method', 'cached']
  });

  private deviceFingerprintVerificationTime = new Histogram({
    name: 'device_fingerprint_verification_seconds',
    help: 'Time taken for device fingerprint verification',
    labelNames: ['result', 'method'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5]
  });

  private similaritySearches = new Counter({
    name: 'device_similarity_searches_total',
    help: 'Total device similarity searches',
    labelNames: ['method', 'found_similar']
  });

  private similaritySearchTime = new Histogram({
    name: 'device_similarity_search_seconds',
    help: 'Time taken for similarity searches',
    labelNames: ['method'],
    buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60]
  });

  private deviceBlocks = new Counter({
    name: 'device_blocks_total',
    help: 'Total device blocks applied',
    labelNames: ['reason', 'automatic']
  });

  // ============= STORAGE PERFORMANCE METRICS =============
  private storageOperations = new Counter({
    name: 'storage_operations_total',
    help: 'Total storage operations',
    labelNames: ['type', 'operation', 'status']
  });

  private storageOperationTime = new Histogram({
    name: 'storage_operation_seconds',
    help: 'Time taken for storage operations',
    labelNames: ['type', 'operation'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5]
  });

  private mongodbConnectionStatus = new Gauge({
    name: 'mongodb_connection_status',
    help: 'MongoDB connection status (1=connected, 0=disconnected)'
  });



  private cacheHitRate = new Gauge({
    name: 'cache_hit_rate',
    help: 'Cache hit rate percentage',
    labelNames: ['cache_type']
  });

  // ============= BACKGROUND JOB METRICS =============
  private backgroundJobsTotal = new Counter({
    name: 'background_jobs_total',
    help: 'Total background jobs processed',
    labelNames: ['queue', 'status']
  });

  private backgroundJobProcessingTime = new Histogram({
    name: 'background_job_processing_seconds',
    help: 'Time taken to process background jobs',
    labelNames: ['queue', 'job_type'],
    buckets: [0.5, 1, 2, 5, 10, 30, 60, 120, 300]
  });

  private queueSize = new Gauge({
    name: 'job_queue_size',
    help: 'Current job queue size',
    labelNames: ['queue', 'status']
  });

  // ============= SECURITY METRICS =============
  private securityEvents = new Counter({
    name: 'security_events_total',
    help: 'Total security events detected',
    labelNames: ['type', 'severity', 'user_blocked']
  });

  private captchaAttempts = new Counter({
    name: 'captcha_attempts_total',
    help: 'Total captcha attempts',
    labelNames: ['type', 'result', 'is_retry']
  });

  private rateLimitHits = new Counter({
    name: 'rate_limit_hits_total',
    help: 'Total rate limit hits',
    labelNames: ['endpoint', 'user_type']
  });

  private multiAccountDetections = new Counter({
    name: 'multi_account_detections_total',
    help: 'Total multi-account detections',
    labelNames: ['confidence_level', 'action_taken']
  });

  // ============= SYSTEM HEALTH METRICS =============
  private memoryUsage = new Gauge({
    name: 'nodejs_memory_usage_bytes',
    help: 'Memory usage in bytes',
    labelNames: ['type']
  });

  private cpuUsage = new Gauge({
    name: 'nodejs_cpu_usage_percent',
    help: 'CPU usage percentage'
  });

  private eventLoopLag = new Histogram({
    name: 'nodejs_eventloop_lag_seconds',
    help: 'Event loop lag in seconds',
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1]
  });

  private uptimeSeconds = new Gauge({
    name: 'nodejs_uptime_seconds',
    help: 'Node.js uptime in seconds'
  });

  private activeConnections = new Gauge({
    name: 'active_connections',
    help: 'Number of active connections',
    labelNames: ['type']
  });

  static getInstance(): PrometheusMetricsService {
    if (!PrometheusMetricsService.instance) {
      PrometheusMetricsService.instance = new PrometheusMetricsService();
    }
    return PrometheusMetricsService.instance;
  }

  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    const config = enhancedConfig.getConfig();
    
    if (!config.monitoring.enableMetrics) {
      this.logger.info('Metrics collection disabled');
      return;
    }

    // Collect default metrics
    collectDefaultMetrics({ register });

    // Start custom metrics collection
    this.startMetricsCollection();

    this.isInitialized = true;
    this.logger.info('✅ Prometheus metrics service initialized');
  }

  private startMetricsCollection(): void {
    setInterval(() => {
      this.updateSystemMetrics();
    }, 30000); // Update every 30 seconds
  }

  private updateSystemMetrics(): void {
    const memoryUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    this.memoryUsage.set({ type: 'rss' }, memoryUsage.rss);
    this.memoryUsage.set({ type: 'heapUsed' }, memoryUsage.heapUsed);
    this.memoryUsage.set({ type: 'heapTotal' }, memoryUsage.heapTotal);
    this.memoryUsage.set({ type: 'external' }, memoryUsage.external);

    // Calculate CPU usage percentage
    const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds
    this.cpuUsage.set(cpuPercent);
  }

  // ============= HTTP & API METRICS METHODS =============
  recordHttpRequest(method: string, route: string, statusCode: number, duration: number): void {
    this.httpRequestsTotal.inc({ method, route, status_code: statusCode });
    this.httpRequestDuration.observe({ method, route, status_code: statusCode }, duration);
  }

  // ============= TELEGRAM BOT METRICS METHODS =============
  recordTelegramUpdate(type: string, status: 'success' | 'failed', processingTime: number): void {
    this.telegramUpdatesTotal.inc({ type, status });
    this.telegramUpdateProcessingTime.observe({ type, status }, processingTime / 1000); // Convert to seconds
  }

  updateActiveUsers(count: number): void {
    this.activeUsers.set(count);
  }

  updateTotalUsers(count: number): void {
    this.totalUsers.set(count);
  }

  recordUserRegistration(status: 'success' | 'failed', verificationRequired: boolean): void {
    this.userRegistrationsTotal.inc({ 
      status, 
      verification_required: verificationRequired ? 'yes' : 'no' 
    });
  }

  recordPointsAwarded(amount: number, source: string, taskType?: string): void {
    this.pointsAwarded.inc({ 
      source, 
      task_type: taskType || 'unknown' 
    }, amount);
  }

  recordTaskCompleted(taskId: string, taskType: string, verificationMethod: string): void {
    this.tasksCompleted.inc({ task_id: taskId, task_type: taskType, verification_method: verificationMethod });
  }

  // ============= DEVICE FINGERPRINT METRICS METHODS =============
  recordDeviceFingerprintVerification(
    result: 'instant_allow' | 'instant_block' | 'pending_verification',
    method: 'exact_hash' | 'similarity_search' | 'background_job',
    cached: boolean,
    duration: number
  ): void {
    this.deviceFingerprintVerifications.inc({ 
      result, 
      method, 
      cached: cached ? 'yes' : 'no' 
    });
    this.deviceFingerprintVerificationTime.observe({ result, method }, duration / 1000);
  }

  recordSimilaritySearch(method: 'indexed' | 'full_scan', foundSimilar: boolean, duration: number): void {
    this.similaritySearches.inc({ 
      method, 
      found_similar: foundSimilar ? 'yes' : 'no' 
    });
    this.similaritySearchTime.observe({ method }, duration / 1000);
  }

  recordDeviceBlock(reason: string, automatic: boolean): void {
    this.deviceBlocks.inc({ 
      reason, 
      automatic: automatic ? 'yes' : 'no' 
    });
  }

  // ============= STORAGE PERFORMANCE METRICS METHODS =============
  recordStorageOperation(
    type: 'mongodb' | 'file',
    operation: 'read' | 'write' | 'update' | 'delete' | 'query',
    status: 'success' | 'failed',
    duration: number
  ): void {
    this.storageOperations.inc({ type, operation, status });
    this.storageOperationTime.observe({ type, operation }, duration / 1000);
  }

  updateMongodbConnectionStatus(connected: boolean): void {
    this.mongodbConnectionStatus.set(connected ? 1 : 0);
  }



  updateCacheHitRate(cacheType: 'memory' | 'storage', hitRate: number): void {
    this.cacheHitRate.set({ cache_type: cacheType }, hitRate);
  }

  // ============= BACKGROUND JOB METRICS METHODS =============
  recordBackgroundJob(
    queue: string,
    jobType: string,
    status: 'completed' | 'failed' | 'stalled',
    processingTime: number
  ): void {
    this.backgroundJobsTotal.inc({ queue, status });
    this.backgroundJobProcessingTime.observe({ queue, job_type: jobType }, processingTime / 1000);
  }

  updateQueueSize(queue: string, waiting: number, active: number, completed: number, failed: number): void {
    this.queueSize.set({ queue, status: 'waiting' }, waiting);
    this.queueSize.set({ queue, status: 'active' }, active);
    this.queueSize.set({ queue, status: 'completed' }, completed);
    this.queueSize.set({ queue, status: 'failed' }, failed);
  }

  // ============= SECURITY METRICS METHODS =============
  recordSecurityEvent(
    type: 'multi_account' | 'device_collision' | 'rate_limit' | 'suspicious_behavior',
    severity: 'low' | 'medium' | 'high' | 'critical',
    userBlocked: boolean
  ): void {
    this.securityEvents.inc({ 
      type, 
      severity, 
      user_blocked: userBlocked ? 'yes' : 'no' 
    });
  }

  recordCaptchaAttempt(
    type: 'miniapp' | 'svg' | 'recaptcha',
    result: 'success' | 'failed' | 'timeout',
    isRetry: boolean
  ): void {
    this.captchaAttempts.inc({ 
      type, 
      result, 
      is_retry: isRetry ? 'yes' : 'no' 
    });
  }

  recordRateLimitHit(endpoint: string, userType: 'authenticated' | 'anonymous' | 'admin'): void {
    this.rateLimitHits.inc({ endpoint, user_type: userType });
  }

  recordMultiAccountDetection(
    confidenceLevel: 'low' | 'medium' | 'high',
    actionTaken: 'none' | 'flagged' | 'blocked' | 'manual_review'
  ): void {
    this.multiAccountDetections.inc({ confidence_level: confidenceLevel, action_taken: actionTaken });
  }

  // ============= SYSTEM HEALTH METRICS METHODS =============
  updateActiveConnections(type: 'http' | 'websocket' | 'database', count: number): void {
    this.activeConnections.set({ type }, count);
  }

  recordEventLoopLag(lagMs: number): void {
    this.eventLoopLag.observe(lagMs / 1000); // Convert to seconds
  }

  updateUptime(): void {
    this.uptimeSeconds.set(process.uptime());
  }

  // ============= ENHANCED MONITORING METHODS =============
  
  /**
   * Record performance-critical operation with detailed metrics
   */
  async measureAsyncOperation<T>(
    operationName: string,
    operation: () => Promise<T>,
    labels: Record<string, string> = {}
  ): Promise<T> {
    const startTime = Date.now();
    let status = 'success';
    let error: Error | null = null;

    try {
      const result = await operation();
      return result;
    } catch (err) {
      status = 'failed';
      error = err as Error;
      throw err;
    } finally {
      const duration = Date.now() - startTime;
      
      // Record operation metrics
      // Custom operation metrics can be recorded with dedicated counters if needed

      // Log slow operations
      if (duration > 1000) {
        this.logger.warn('Slow operation detected', {
          operation: operationName,
          duration,
          status,
          error: error?.message,
          labels,
        });
      }
    }
  }

  /**
   * Create performance summary for dashboard
   */
  async getPerformanceSummary(): Promise<{
    system: {
      uptime: number;
      memoryUsage: NodeJS.MemoryUsage;
      cpuUsage: NodeJS.CpuUsage;
    };
    telegram: {
      totalUsers: number;
      activeUsers: number;
      updatesProcessed: number;
      avgProcessingTime: number;
    };
    security: {
      fingerprintVerifications: number;
      securityEvents: number;
      blockedDevices: number;
    };
    storage: {
      mongoConnected: boolean;
      avgQueryTime: number;
    };
  }> {
    // This would typically query the metrics registry
    // For now, return current state
    return {
      system: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        cpuUsage: process.cpuUsage(),
      },
      telegram: {
        totalUsers: 0, // Would get from gauge
        activeUsers: 0,
        updatesProcessed: 0,
        avgProcessingTime: 0,
      },
      security: {
        fingerprintVerifications: 0,
        securityEvents: 0,
        blockedDevices: 0,
      },
      storage: {
        mongoConnected: false,
        avgQueryTime: 0,
      },
    };
  }

  /**
   * Health check with detailed metrics
   */
  async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    metrics: {
      uptime: number;
      memoryUsage: number;
      cpuUsage: number;
      eventLoopLag: number;
    };
    services: {
      mongodb: boolean;
      telegram: boolean;
    };
    performance: {
      avgHttpResponseTime: number;
      avgUpdateProcessingTime: number;
      avgStorageQueryTime: number;
    };
  }> {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    // Simple health status calculation
    const memoryThreshold = 1024 * 1024 * 1024; // 1GB
    const isMemoryHealthy = memUsage.heapUsed < memoryThreshold;
    
    const status = isMemoryHealthy ? 'healthy' : 'degraded';
    
    return {
      status,
      metrics: {
        uptime: process.uptime(),
        memoryUsage: memUsage.heapUsed / memUsage.heapTotal,
        cpuUsage: (cpuUsage.user + cpuUsage.system) / 1000000,
        eventLoopLag: 0, // Would measure actual lag
      },
      services: {
        mongodb: true, // Would check actual connection
        telegram: true,
      },
      performance: {
        avgHttpResponseTime: 0, // Would calculate from histogram
        avgUpdateProcessingTime: 0,
        avgStorageQueryTime: 0,
      },
    };
  }

  getMetrics(): Promise<string> {
    return register.metrics();
  }

  getContentType(): string {
    return register.contentType;
  }

  async stop(): Promise<void> {
    register.clear();
    this.isInitialized = false;
    this.logger.info('Prometheus metrics service stopped');
  }
}

export const prometheusMetrics = PrometheusMetricsService.getInstance();