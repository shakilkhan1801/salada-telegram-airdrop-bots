import { AsyncJobQueueService } from './async-job-queue.service';
import { WorkerThreadManager } from './worker-thread-manager.service';
import { JobSchedulerService } from './job-scheduler.service';
import { Logger } from './logger';
import { EventEmitter } from 'events';

// Import existing services for integration
import { StorageManager } from '../storage';
import { BroadcastQueueService } from './broadcast-queue.service';
import { TaskSubmissionService } from './task-submission.service';
import SessionSchedulerService from './session/session-scheduler.service';
import UnifiedSecurityEngine from '../security/unified-security-engine';


export interface AsyncProcessingStats {
  jobQueues: {
    total: number;
    active: number;
    completed: number;
    failed: number;
  };
  workerThreads: {
    total: number;
    active: number;
    performance: {
      averageTaskTime: number;
      successRate: number;
    };
  };
  scheduledJobs: {
    total: number;
    active: number;
    recentExecutions: number;
  };
  integration: {
    servicesConnected: number;
    eventsProcessed: number;
    lastHealthCheck: Date;
  };
}

export interface ProcessingTask {
  id: string;
  type: 'security_analysis' | 'security_batch_analysis' | 'data_migration' | 'cache_optimization' | 'cleanup' | 'broadcast' | 'broadcast_delivery' | 'notification_batch' | 'queue_optimization' | 'analytics';
  priority: 'low' | 'medium' | 'high' | 'critical';
  data: any;
  options?: {
    timeout?: number;
    retries?: number;
    useWorkerThread?: boolean;
  };
}

/**
 * Async Processing Integration Service
 * Coordinates job queues, worker threads, and job scheduling
 * Integrates with existing services to move heavy operations to background
 */
export class AsyncProcessingIntegrationService extends EventEmitter {
  private static instance: AsyncProcessingIntegrationService;
  private readonly logger = Logger.getInstance();
  private readonly jobQueue = AsyncJobQueueService.getInstance();
  private readonly workerManager = WorkerThreadManager.getInstance();
  private readonly jobScheduler = JobSchedulerService.getInstance();
  
  private readonly storageManager = StorageManager.getInstance();
  private readonly broadcastService = BroadcastQueueService.getInstance();
  private readonly taskSubmissionService = TaskSubmissionService.getInstance();
  private readonly sessionScheduler = SessionSchedulerService;
  private readonly securityEngine = UnifiedSecurityEngine.getInstance();
  
  private isInitialized = false;
  private eventsProcessed = 0;
  private connectedServices = 0;
  private lastHealthCheck = new Date();
  
  // Preserve original broadcast executor so we can call real delivery and get accurate metrics
  private originalExecuteBroadcast?: (broadcast: any) => Promise<any>;
  
  // High queue log rate-limiting / noise control
  private lastHighQueueLogAt = 0;
  
  // Worker processors for different job types
  private workerProcessors = new Map<string, Function>();

  private constructor() {
    super();
    this.setupWorkerProcessors();
  }

  static getInstance(): AsyncProcessingIntegrationService {
    if (!AsyncProcessingIntegrationService.instance) {
      AsyncProcessingIntegrationService.instance = new AsyncProcessingIntegrationService();
    }
    return AsyncProcessingIntegrationService.instance;
  }

  /**
   * Initialize the async processing integration
   */
  async initialize(): Promise<void> {
    try {
      this.logger.info('🚀 Initializing Async Processing Integration...');

      // Initialize core async services
      await this.jobQueue.initialize();
      await this.workerManager.initialize();
      await this.jobScheduler.initialize();

      // Setup job queue workers
      await this.setupJobQueueWorkers();

      // Integrate with existing services
      await this.integrateWithExistingServices();

      // Setup event listeners
      this.setupEventListeners();

      // Start monitoring
      this.startMonitoring();

      this.isInitialized = true;
      this.logger.info('✅ Async Processing Integration initialized successfully', {
        jobQueues: (await this.jobQueue.getAllQueueStats()),
        workerThreads: this.workerManager.getQueueStats(),
        scheduledJobs: this.jobScheduler.getJobStatistics()
      });

    } catch (error) {
      this.logger.error('❌ Failed to initialize Async Processing Integration:', error);
      throw error;
    }
  }

  /**
   * Process a task asynchronously
   */
  async processTask(task: ProcessingTask): Promise<string> {
    if (!this.isInitialized) {
      throw new Error('Async Processing Integration not initialized');
    }

    const queueName = this.getQueueForTaskType(task.type);
    const priority = this.getPriorityValue(task.priority);

    try {
      let jobId: string;

      // Determine processing method based on task type and options
      if (task.options?.useWorkerThread && this.shouldUseWorkerThread(task.type)) {
        // Use worker thread for CPU-intensive tasks
        jobId = await this.processWithWorkerThread(task);
      } else {
        // Use job queue for I/O bound tasks
        jobId = await this.jobQueue.addJob(queueName, {
          type: task.type,
          payload: task.data,
          priority,
          attempts: task.options?.retries || 3,
          metadata: {
            taskId: task.id,
            processedAt: new Date().toISOString()
          }
        });
      }

      this.logger.debug(`📤 Task ${task.id} queued for processing`, {
        taskType: task.type,
        priority: task.priority,
        queueName,
        jobId
      });

      this.eventsProcessed++;
      this.emit('taskQueued', { task, jobId });

      return jobId;
    } catch (error) {
      this.logger.error(`❌ Failed to process task ${task.id}:`, error);
      throw error;
    }
  }

  /**
   * Process multiple tasks in batch
   */
  async processBatchTasks(tasks: ProcessingTask[]): Promise<string[]> {
    const jobIds: string[] = [];
    
    // Group tasks by queue for efficient batch processing
    const tasksByQueue = this.groupTasksByQueue(tasks);
    
    for (const [queueName, queueTasks] of tasksByQueue) {
      const jobData = queueTasks.map(task => ({
        type: task.type,
        payload: task.data,
        priority: this.getPriorityValue(task.priority),
        attempts: task.options?.retries || 3,
        metadata: {
          taskId: task.id,
          batchProcessing: true,
          processedAt: new Date().toISOString()
        }
      }));

      const batchJobIds = await this.jobQueue.addBulkJobs(queueName, jobData);
      jobIds.push(...batchJobIds);
    }

    this.logger.info(`📦 Batch processed ${tasks.length} tasks`, {
      totalJobs: jobIds.length,
      queues: Array.from(tasksByQueue.keys())
    });

    this.eventsProcessed += tasks.length;
    this.emit('batchTasksQueued', { tasks, jobIds });

    return jobIds;
  }

  /**
   * Get processing statistics
   */
  async getProcessingStats(): Promise<AsyncProcessingStats> {
    const queueStats = await this.jobQueue.getAllQueueStats();
    const workerStats = this.workerManager.getQueueStats();
    const schedulerStats = this.jobScheduler.getJobStatistics();

    const totalJobs = Object.values(queueStats).reduce((sum, stats) => 
      sum + stats.waiting + stats.active + stats.completed + stats.failed, 0
    );
    const activeJobs = Object.values(queueStats).reduce((sum, stats) => 
      sum + stats.active, 0
    );
    const completedJobs = Object.values(queueStats).reduce((sum, stats) => 
      sum + stats.completed, 0
    );
    const failedJobs = Object.values(queueStats).reduce((sum, stats) => 
      sum + stats.failed, 0
    );

    return {
      jobQueues: {
        total: totalJobs,
        active: activeJobs,
        completed: completedJobs,
        failed: failedJobs
      },
      workerThreads: {
        total: workerStats.workers.total,
        active: workerStats.workers.active,
        performance: workerStats.performance
      },
      scheduledJobs: {
        total: schedulerStats.totalJobs,
        active: schedulerStats.activeJobs,
        recentExecutions: schedulerStats.totalExecutions
      },
      integration: {
        servicesConnected: this.connectedServices,
        eventsProcessed: this.eventsProcessed,
        lastHealthCheck: this.lastHealthCheck
      }
    };
  }

  /**
   * Setup job queue workers for different queue types
   */
  private async setupJobQueueWorkers(): Promise<void> {
    const queueConfigs = [
      { name: 'security', processor: 'processSecurityJob', concurrency: 2 },
      { name: 'cleanup', processor: 'processCleanupJob', concurrency: 3 },
      { name: 'broadcast', processor: 'processBroadcastJob', concurrency: 5 },
      { name: 'data_processing', processor: 'processDataJob', concurrency: 3 },
      { name: 'analytics', processor: 'processAnalyticsJob', concurrency: 2 },
      { name: 'cache_optimization', processor: 'processCacheJob', concurrency: 4 },
      { name: 'admin_reports', processor: 'processAdminReportJob', concurrency: 2 }
    ];

    for (const config of queueConfigs) {
      const processor = this.workerProcessors.get(config.processor);
      if (processor) {
        await this.jobQueue.createWorker(config.name, processor.bind(this), {
          concurrency: config.concurrency
        });
        this.logger.debug(`👷 Worker created for queue '${config.name}'`);
      }
    }
  }

  /**
   * Setup worker processors for different job types
   */
  private setupWorkerProcessors(): void {
    this.workerProcessors.set('processSecurityJob', this.processSecurityJob);
    this.workerProcessors.set('processCleanupJob', this.processCleanupJob);
    this.workerProcessors.set('processBroadcastJob', this.processBroadcastJob);
    this.workerProcessors.set('processDataJob', this.processDataJob);
    this.workerProcessors.set('processAnalyticsJob', this.processAnalyticsJob);
    this.workerProcessors.set('processCacheJob', this.processCacheJob);
    this.workerProcessors.set('processAdminReportJob', this.processAdminReportJob);
  }

  /**
   * Security job processor
   */
  private async processSecurityJob(job: any): Promise<any> {
    const { type, payload } = job.data;
    
    try {
      switch (type) {
        case 'security_analysis':
          return await this.performSecurityAnalysis(payload);
        case 'security_batch_analysis':
          return await this.performSecurityBatchAnalysis(payload);
        case 'threat_detection':
          return await this.performThreatDetection(payload);
        case 'device_fingerprint_analysis':
          return await this.performDeviceFingerprintAnalysis(payload);
        default:
          throw new Error(`Unknown security job type: ${type}`);
      }
    } catch (error) {
      this.logger.error(`Security job failed:`, error);
      throw error;
    }
  }

  /**
   * Cleanup job processor
   */
  private async processCleanupJob(job: any): Promise<any> {
    const { type, payload } = job.data;
    
    try {
      switch (type) {
        case 'session_cleanup':
          return await this.performSessionCleanup(payload);
        case 'file_cleanup':
          return await this.performFileCleanup(payload);
        case 'cache_cleanup':
          return await this.performCacheCleanup(payload);
        default:
          throw new Error(`Unknown cleanup job type: ${type}`);
      }
    } catch (error) {
      this.logger.error(`Cleanup job failed:`, error);
      throw error;
    }
  }

  /**
   * Broadcast job processor
   */
  private async processBroadcastJob(job: any): Promise<any> {
    const { type, payload } = job.data;
    
    try {
      switch (type) {
        case 'broadcast_delivery':
          return await this.performBroadcastDelivery(payload);
        case 'notification_batch':
          return await this.performNotificationBatch(payload);
        case 'queue_optimization':
          return await this.performBroadcastQueueOptimization(payload);
        default:
          throw new Error(`Unknown broadcast job type: ${type}`);
      }
    } catch (error) {
      this.logger.error(`Broadcast job failed:`, error);
      throw error;
    }
  }

  private async performBroadcastQueueOptimization(payload: any): Promise<any> {
    try {
      const pending = await this.broadcastService.getQueueStatus();
      const history = await this.broadcastService.getBroadcastHistory(100);

      this.logger.info('Broadcast queue optimization summary', {
        pending: !!pending,
        historyCount: history.length,
        retryFailedRequested: !!payload?.retryFailed,
        optimizeBatchesRequested: !!payload?.optimizeBatches
      });

      return {
        success: true,
        pending: !!pending,
        historyCount: history.length
      };
    } catch (error) {
      this.logger.error('Broadcast queue optimization failed:', error);
      throw error;
    }
  }

  /**
   * Data processing job processor
   */
  private async processDataJob(job: any): Promise<any> {
    const { type, payload } = job.data;
    
    try {
      switch (type) {
        case 'data_migration':
          return await this.performDataMigration(payload);
        case 'data_backup':
          return await this.performDataBackup(payload);
        case 'data_transformation':
          return await this.performDataTransformation(payload);
        default:
          throw new Error(`Unknown data job type: ${type}`);
      }
    } catch (error) {
      this.logger.error(`Data job failed:`, error);
      throw error;
    }
  }

  /**
   * Analytics job processor
   */
  private async processAnalyticsJob(job: any): Promise<any> {
    const { type, payload } = job.data;
    
    try {
      switch (type) {
        case 'performance_analysis':
          return await this.performPerformanceAnalysis(payload);
        case 'user_analytics':
          return await this.performUserAnalytics(payload);
        case 'security_report':
          return await this.generateSecurityReport(payload);
        default:
          throw new Error(`Unknown analytics job type: ${type}`);
      }
    } catch (error) {
      this.logger.error(`Analytics job failed:`, error);
      throw error;
    }
  }

  /**
   * Cache optimization job processor
   */
  private async processCacheJob(job: any): Promise<any> {
    const { type, payload } = job.data;
    
    try {
      switch (type) {
        case 'cache_warming':
          return await this.performCacheWarming(payload);
        case 'cache_optimization':
          return await this.performCacheOptimization(payload);
        default:
          throw new Error(`Unknown cache job type: ${type}`);
      }
    } catch (error) {
      this.logger.error(`Cache job failed:`, error);
      throw error;
    }
  }

  /**
   * Admin report job processor
   */
  private async processAdminReportJob(job: any): Promise<any> {
    const { type, payload } = job.data;
    
    try {
      // Admin reports can be added here in future
      throw new Error(`Admin report job type not implemented: ${type}`);
    } catch (error) {
      this.logger.error(`Admin report job failed:`, error);
      throw error;
    }
  }

  /**
   * Process task using worker thread
   */
  private async processWithWorkerThread(task: ProcessingTask): Promise<string> {
    const workerType = this.getWorkerTypeForTask(task.type);
    
    const result = await this.workerManager.executeTask(workerType, {
      taskType: task.type,
      data: task.data,
      options: task.options
    }, {
      priority: this.getPriorityValue(task.priority),
      timeout: task.options?.timeout
    });

    this.logger.debug(`🔄 Worker thread task completed`, {
      taskId: task.id,
      workerType,
      success: result.success,
      duration: result.duration
    });

    return result.workerId;
  }

  /**
   * Integrate with existing services
   */
  private async integrateWithExistingServices(): Promise<void> {
    try {
      // Replace broadcast service interval with job queue
      this.replaceBroadcastProcessing();
      
      // Replace session cleanup with scheduled job
      this.replaceSessionCleanup();
      
      // Move heavy security analysis to background
      this.moveSecurityAnalysisToBackground();
      
      // Move task migrations to background
      this.moveTaskMigrationsToBackground();

      this.connectedServices = 4;
      this.logger.info('🔗 Integrated with existing services', {
        servicesConnected: this.connectedServices
      });
    } catch (error) {
      this.logger.error('❌ Failed to integrate with existing services:', error);
      throw error;
    }
  }

  /**
   * Replace broadcast queue processing with job queue
   */
  private replaceBroadcastProcessing(): void {
    // Preserve original executor
    const originalExecuteBroadcast = (this.broadcastService as any).executeBroadcast?.bind(this.broadcastService);
    this.originalExecuteBroadcast = originalExecuteBroadcast;

    if (!originalExecuteBroadcast) {
      this.logger.warn('Broadcast service executeBroadcast not found; cannot integrate async processing');
      return;
    }

    // Gate async override behind environment flag. By default, keep synchronous behavior
    const enableAsync = String(process.env.ENABLE_ASYNC_BROADCAST || '').toLowerCase() === 'true';

    if (enableAsync) {
      this.logger.info('Async broadcast delivery enabled (ENABLE_ASYNC_BROADCAST=true)');
      (this.broadcastService as any).executeBroadcast = async (broadcast: any) => {
        // Enqueue a background job that will call the preserved original executor
        return await this.processTask({
          id: broadcast.id,
          type: 'broadcast_delivery',
          priority: 'high',
          data: broadcast
        });
      };
    } else {
      // Keep original behavior to ensure real delivery and accurate metrics
      this.logger.info('Async broadcast delivery disabled; using synchronous broadcast execution');
      (this.broadcastService as any).executeBroadcast = async (broadcast: any) => {
        return await originalExecuteBroadcast(broadcast);
      };
    }
  }

  /**
   * Replace session cleanup with scheduled job
   */
  private replaceSessionCleanup(): void {
    // Session cleanup is now handled by scheduled jobs
    this.logger.info('Session cleanup moved to scheduled jobs');
  }

  /**
   * Move security analysis to background processing
   */
  private moveSecurityAnalysisToBackground(): void {
    // Integration with security engine to use background processing
    const originalAnalyzeUser = (this.securityEngine as any).analyzeUser?.bind(this.securityEngine);
    
    if (originalAnalyzeUser) {
      (this.securityEngine as any).analyzeUserAsync = async (userData: any) => {
        return await this.processTask({
          id: `security-${userData.userId}-${Date.now()}`,
          type: 'security_analysis',
          priority: 'medium',
          data: userData,
          options: { useWorkerThread: true }
        });
      };
    }
  }

  /**
   * Move task migrations to background
   */
  private moveTaskMigrationsToBackground(): void {
    // Override task migration to use background processing
    const originalMigrate = (this.taskSubmissionService as any).migrateTaskCompletionStatus?.bind(this.taskSubmissionService);
    
    if (originalMigrate) {
      (this.taskSubmissionService as any).migrateTaskCompletionStatusAsync = async () => {
        return await this.processTask({
          id: `migration-${Date.now()}`,
          type: 'data_migration',
          priority: 'low',
          data: { operation: 'task_completion_migration' }
        });
      };
    }
  }

  /**
   * Setup event listeners for monitoring and coordination
   */
  private setupEventListeners(): void {
    this.on('taskQueued', (data) => {
      this.logger.debug('Task queued for processing', data);
    });

    this.on('batchTasksQueued', (data) => {
      this.logger.info('Batch tasks queued for processing', {
        count: data.tasks.length,
        jobIds: data.jobIds.length
      });
    });
  }

  /**
   * Start monitoring and health checks
   */
  private startMonitoring(): void {
    // Periodic health checks and optimization
    setInterval(async () => {
      try {
        await this.performHealthCheck();
        await this.optimizeProcessing();
      } catch (error) {
        this.logger.error('Monitoring cycle failed:', error);
      }
    }, 60000); // Every minute
  }

  /**
   * Perform health check
   */
  private async performHealthCheck(): Promise<void> {
    this.lastHealthCheck = new Date();
    
    const stats = await this.getProcessingStats();
    
    // Log health status
    this.logger.debug('Async processing health check', {
      jobQueues: stats.jobQueues,
      workerThreads: stats.workerThreads,
      scheduledJobs: stats.scheduledJobs
    });

    // Check for issues and emit alerts
    if (stats.jobQueues.failed > stats.jobQueues.completed * 0.1) {
      this.emit('highFailureRate', { failureRate: stats.jobQueues.failed / stats.jobQueues.completed });
    }

    if (stats.workerThreads.performance.successRate < 0.9) {
      this.emit('lowSuccessRate', { successRate: stats.workerThreads.performance.successRate });
    }
  }

  /**
   * Optimize processing based on current load
   */
  private async optimizeProcessing(): Promise<void> {
    const stats = await this.getProcessingStats();
    
    // Noise control settings
    const suppressLogs = String(process.env.SUPPRESS_QUEUE_LOAD_LOGS || '').toLowerCase() === 'true';
    const factor = Number(process.env.HIGH_QUEUE_LOAD_FACTOR || 4); // default higher than previous 2
    const minIntervalMs = Number(process.env.HIGH_QUEUE_LOG_MIN_INTERVAL_MS || 300000); // 5 minutes

    // Auto-scaling logic for job queues
    if (!suppressLogs) {
      const threshold = stats.workerThreads.total * (isNaN(factor) ? 4 : Math.max(1, factor));
      const now = Date.now();
      if (stats.jobQueues.active > threshold) {
        // rate-limit log
        if (now - this.lastHighQueueLogAt > (isNaN(minIntervalMs) ? 300000 : Math.max(60000, minIntervalMs))) {
          this.logger.info('High queue load detected, optimization recommended');
          this.lastHighQueueLogAt = now;
        } else {
          this.logger.debug('High queue load detected (suppressed by rate limit)');
        }
        this.emit('highQueueLoad', stats);
      }
    }
    
    // Worker thread optimization
    if (stats.workerThreads.performance.averageTaskTime > 300000) { // 5 minutes
      this.logger.warn('Slow worker performance detected');
      this.emit('slowWorkerPerformance', stats);
    }
  }

  // Job processing implementations

  private async performSecurityAnalysis(payload: any): Promise<any> {
    // Delegate to security engine
    return await this.securityEngine.analyzeUser(
      payload.user,
      payload.deviceData,
      payload.behaviorData,
      payload.ipAddress
    );
  }

  private async performSecurityBatchAnalysis(payload: any): Promise<any> {
    try {
      // Batch security analysis for multiple users
      const users = payload.users || [];
      const results = [];
      
      for (const user of users) {
        try {
          const analysis = await this.securityEngine.analyzeUser(
            user,
            user.deviceData,
            user.behaviorData,
            user.ipAddress
          );
          results.push({
            userId: user.telegramId || user.id,
            analysis,
            status: 'completed'
          });
        } catch (error) {
          this.logger.error(`Failed to analyze user ${user.telegramId || user.id}:`, error);
          results.push({
            userId: user.telegramId || user.id,
            error: error.message,
            status: 'failed'
          });
        }
      }
      
      return {
        processed: results.length,
        successful: results.filter(r => r.status === 'completed').length,
        failed: results.filter(r => r.status === 'failed').length,
        results
      };
    } catch (error) {
      this.logger.error('Security batch analysis failed:', error);
      return {
        processed: 0,
        successful: 0,
        failed: payload.users?.length || 0,
        error: error.message
      };
    }
  }

  private async performThreatDetection(payload: any): Promise<any> {
    // Implement threat detection logic
    return { threats: [], riskScore: 0, analyzed: true };
  }

  private async performDeviceFingerprintAnalysis(payload: any): Promise<any> {
    // Implement device fingerprint analysis
    return { fingerprint: payload.fingerprint, suspicious: false, score: 0 };
  }

  private async performSessionCleanup(payload: any): Promise<any> {
    // Implement session cleanup
    const result = await SessionSchedulerService.runCleanupOnly();
    const cleanedCount = result.cleaned;
    return { cleanedSessions: cleanedCount };
  }

  private async performFileCleanup(payload: any): Promise<any> {
    // Implement file cleanup
    return { filesRemoved: 0, spaceSaved: 0 };
  }

  private async performCacheCleanup(payload: any): Promise<any> {
    // Implement cache cleanup
    return { cacheEntriesRemoved: 0, memoryFreed: 0 };
  }

  private async performBroadcastDelivery(payload: any): Promise<any> {
    // Call preserved original broadcast executor to actually deliver messages
    try {
      if (!this.originalExecuteBroadcast) {
        this.logger.warn('Original broadcast executor not available; falling back to no-op result');
        return { success: false, successCount: 0, failureCount: payload?.targetUsers?.length || 0, duration: 0 };
      }
      const result = await this.originalExecuteBroadcast(payload);
      // Expecting BroadcastResult shape
      return result;
    } catch (error: any) {
      this.logger.error('Broadcast delivery via async processing failed:', error?.message || error);
      return { success: false, successCount: 0, failureCount: payload?.targetUsers?.length || 0, duration: 0, error: error?.message || String(error) };
    }
  }

  private async performNotificationBatch(payload: any): Promise<any> {
    // Implement notification batch processing
    return { notificationsSent: payload.notifications?.length || 0 };
  }

  private async performDataMigration(payload: any): Promise<any> {
    // Implement data migration
    if (payload.operation === 'task_completion_migration') {
      await this.taskSubmissionService.migrateTaskCompletionStatus();
      return { migrated: true };
    }
    return { migrated: false };
  }

  private async performDataBackup(payload: any): Promise<any> {
    try {
      // Get storage instance
      const storage = require('../storage').StorageManager.getInstance();
      
      // Check if backup already exists for today to prevent duplicates
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
      const backupId = `scheduled-backup-${today}`;
      
      // Check if we already created a backup today
      const existingBackup = await storage.get('scheduled-backups', backupId).catch(() => null);
      if (existingBackup) {
        this.logger.info('Scheduled backup already exists for today, skipping duplicate', { backupId });
        return { 
          backupCreated: false, 
          skipped: true,
          reason: 'Backup already exists for today',
          existingBackup: existingBackup.path 
        };
      }
      
      // Perform actual backup only if payload indicates it should be done
      if (payload.incrementalOnly === true) {
        const backupPath = await storage.backupData();
        const backupSize = require('fs').statSync(backupPath).size;
        
        // Record that we created a backup today
        await storage.set('scheduled-backups', {
          id: backupId,
          path: backupPath,
          timestamp: new Date().toISOString(),
          size: backupSize,
          type: 'scheduled'
        }, backupId);
        
        this.logger.info('Scheduled data backup completed', { 
          backupPath, 
          size: backupSize,
          backupId 
        });
        
        return { 
          backupCreated: true, 
          path: backupPath,
          size: backupSize,
          backupId
        };
      } else {
        this.logger.info('Scheduled backup skipped (not incremental mode)');
        return { backupCreated: false, skipped: true, reason: 'Not incremental mode' };
      }
    } catch (error) {
      this.logger.error('Scheduled backup failed:', error);
      throw error;
    }
  }

  private async performDataTransformation(payload: any): Promise<any> {
    // Implement data transformation
    return { transformed: true, records: 0 };
  }

  private async performPerformanceAnalysis(payload: any): Promise<any> {
    // Implement performance analysis
    return { metrics: {}, analyzed: true };
  }

  private async performUserAnalytics(payload: any): Promise<any> {
    // Implement user analytics
    return { analytics: {}, processed: true };
  }

  private async generateSecurityReport(payload: any): Promise<any> {
    // Implement security report generation
    return { report: {}, generated: true };
  }

  private async performCacheWarming(payload: any): Promise<any> {
    try {
      const { LeaderboardService } = require('../shared');
      await LeaderboardService.generatePointsLeaderboardDetailed(10);
      await LeaderboardService.generateReferralLeaderboardDetailed(10);
      return { warmed: (payload.cacheTypes?.length || 0) + 2 };
    } catch (error) {
      this.logger.error('Cache warming failed:', error);
      return { warmed: payload.cacheTypes?.length || 0 };
    }
  }

  private async performCacheOptimization(payload: any): Promise<any> {
    // Implement cache optimization
    return { optimized: true };
  }

  // Helper methods

  private getQueueForTaskType(type: ProcessingTask['type']): string {
    const queueMap: Record<ProcessingTask['type'], string> = {
      security_analysis: 'security',
      security_batch_analysis: 'security',
      data_migration: 'data_processing',
      cache_optimization: 'cache_optimization',
      cleanup: 'cleanup',
      broadcast: 'broadcast',
      broadcast_delivery: 'broadcast',
      notification_batch: 'broadcast',
      queue_optimization: 'broadcast',
      analytics: 'analytics'
    };
    
    return queueMap[type] || 'data_processing';
  }

  private getPriorityValue(priority: ProcessingTask['priority']): number {
    const priorityMap = {
      critical: 10,
      high: 7,
      medium: 5,
      low: 2
    };
    
    return priorityMap[priority] || 5;
  }

  private shouldUseWorkerThread(type: ProcessingTask['type']): boolean {
    const workerThreadTasks = ['security_analysis', 'security_batch_analysis', 'analytics'];
    return workerThreadTasks.includes(type);
  }

  private getWorkerTypeForTask(type: ProcessingTask['type']): string {
    if (type === 'security_analysis' || type === 'security_batch_analysis') return 'security';
    if (type === 'analytics') return 'analytics';
    return 'generic';
  }

  private groupTasksByQueue(tasks: ProcessingTask[]): Map<string, ProcessingTask[]> {
    const groups = new Map<string, ProcessingTask[]>();
    
    for (const task of tasks) {
      const queueName = this.getQueueForTaskType(task.type);
      if (!groups.has(queueName)) {
        groups.set(queueName, []);
      }
      groups.get(queueName)!.push(task);
    }
    
    return groups;
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    initialized: boolean;
    services: {
      jobQueue: any;
      workerManager: any;
      jobScheduler: any;
    };
    processing: AsyncProcessingStats;
  }> {
    try {
      const [jobQueueHealth, workerManagerHealth, jobSchedulerHealth] = await Promise.all([
        this.jobQueue.healthCheck(),
        this.workerManager.healthCheck(),
        this.jobScheduler.healthCheck()
      ]);

      const processingStats = await this.getProcessingStats();
      
      const healthy = this.isInitialized && 
        jobQueueHealth.healthy && 
        workerManagerHealth.healthy && 
        jobSchedulerHealth.healthy;

      return {
        healthy,
        initialized: this.isInitialized,
        services: {
          jobQueue: jobQueueHealth,
          workerManager: workerManagerHealth,
          jobScheduler: jobSchedulerHealth
        },
        processing: processingStats
      };
    } catch (error) {
      this.logger.error('Async processing health check failed:', error);
      return {
        healthy: false,
        initialized: false,
        services: {
          jobQueue: { healthy: false },
          workerManager: { healthy: false },
          jobScheduler: { healthy: false }
        },
        processing: {
          jobQueues: { total: 0, active: 0, completed: 0, failed: 0 },
          workerThreads: { total: 0, active: 0, performance: { averageTaskTime: 0, successRate: 0 } },
          scheduledJobs: { total: 0, active: 0, recentExecutions: 0 },
          integration: { servicesConnected: 0, eventsProcessed: 0, lastHealthCheck: new Date() }
        }
      };
    }
  }

  /**
   * Shutdown all async processing components
   */
  async shutdown(): Promise<void> {
    this.logger.info('🛑 Shutting down Async Processing Integration...');
    
    try {
      await Promise.all([
        this.jobScheduler.shutdown(),
        // Job queue and worker manager have their own shutdown handlers
      ]);
      
      this.isInitialized = false;
      this.logger.info('✅ Async Processing Integration shutdown completed');
    } catch (error) {
      this.logger.error('❌ Error during shutdown:', error);
    }
  }
}

// Export instance as default
export default AsyncProcessingIntegrationService.getInstance();