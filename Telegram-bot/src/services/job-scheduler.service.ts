import { AsyncJobQueueService, JobData } from './async-job-queue.service';
import { WorkerThreadManager } from './worker-thread-manager.service';
import { Logger } from './logger';
import * as cron from 'node-cron';
import { nanoid } from './id';

export interface ScheduledJob {
  id: string;
  name: string;
  cronExpression: string;
  queueName: string;
  jobType: string;
  jobData: any;
  priority: number;
  enabled: boolean;
  lastRun?: Date;
  nextRun?: Date;
  runCount: number;
  errorCount: number;
  averageRunTime: number;
  createdAt: Date;
}

export interface JobTemplate {
  name: string;
  description: string;
  queueName: string;
  jobType: string;
  defaultData: any;
  defaultPriority: number;
  estimatedRunTime: number;
  dependencies?: string[];
  retryPolicy?: {
    attempts: number;
    backoff: 'exponential' | 'fixed';
    delay: number;
  };
}

export interface JobExecution {
  id: string;
  jobId: string;
  startedAt: Date;
  completedAt?: Date;
  duration?: number;
  success: boolean;
  result?: any;
  error?: string;
  queueName: string;
  workerId?: string;
}

/**
 * Job Scheduler Service for managing periodic tasks, job templates,
 * and coordinating between job queues and worker threads
 */
export class JobSchedulerService {
  private static instance: JobSchedulerService;
  private readonly logger = Logger.getInstance();
  private readonly jobQueue = AsyncJobQueueService.getInstance();
  private readonly workerManager = WorkerThreadManager.getInstance();
  
  private scheduledJobs = new Map<string, ScheduledJob>();
  private cronTasks = new Map<string, cron.ScheduledTask>();
  private jobTemplates = new Map<string, JobTemplate>();
  private jobExecutions: JobExecution[] = [];
  private isRunning = false;

  // Job templates for common tasks
  private readonly defaultTemplates: JobTemplate[] = [
    {
      name: 'security_analysis_batch',
      description: 'Batch security analysis of user activities',
      queueName: 'security',
      jobType: 'security_batch_analysis',
      defaultData: { batchSize: 50, analysisType: 'comprehensive' },
      defaultPriority: 8,
      estimatedRunTime: 300000, // 5 minutes
      retryPolicy: { attempts: 3, backoff: 'exponential', delay: 2000 }
    },
    {
      name: 'session_cleanup',
      description: 'Clean up expired sessions and temporary data',
      queueName: 'cleanup',
      jobType: 'session_cleanup',
      defaultData: { expiredBefore: 24 * 60 * 60 * 1000 }, // 24 hours
      defaultPriority: 4,
      estimatedRunTime: 60000, // 1 minute
      retryPolicy: { attempts: 2, backoff: 'fixed', delay: 5000 }
    },
    {
      name: 'cache_warming',
      description: 'Warm up frequently accessed cache entries',
      queueName: 'cache_optimization',
      jobType: 'cache_warming',
      defaultData: { cacheTypes: ['hot', 'user', 'task'] },
      defaultPriority: 6,
      estimatedRunTime: 120000, // 2 minutes
      retryPolicy: { attempts: 2, backoff: 'exponential', delay: 3000 }
    },
    {
      name: 'data_backup',
      description: 'Create incremental backups of critical data',
      queueName: 'data_processing',
      jobType: 'data_backup',
      defaultData: { incrementalOnly: true, compression: true },
      defaultPriority: 7,
      estimatedRunTime: 600000, // 10 minutes
      retryPolicy: { attempts: 3, backoff: 'exponential', delay: 5000 }
    },
    {
      name: 'performance_analysis',
      description: 'Analyze system performance metrics and generate reports',
      queueName: 'analytics',
      jobType: 'performance_analysis',
      defaultData: { timeRange: '24h', includeDetails: true },
      defaultPriority: 5,
      estimatedRunTime: 180000, // 3 minutes
      retryPolicy: { attempts: 2, backoff: 'fixed', delay: 10000 }
    },
    {
      name: 'task_migration_cleanup',
      description: 'Clean up completed task migrations and optimize data',
      queueName: 'data_processing',
      jobType: 'migration_cleanup',
      defaultData: { olderThan: 7 * 24 * 60 * 60 * 1000 }, // 7 days
      defaultPriority: 3,
      estimatedRunTime: 240000, // 4 minutes
      retryPolicy: { attempts: 2, backoff: 'exponential', delay: 3000 }
    },
    {
      name: 'security_report_generation',
      description: 'Generate daily security analysis reports',
      queueName: 'analytics',
      jobType: 'security_report',
      defaultData: { reportType: 'daily', includeCharts: true },
      defaultPriority: 6,
      estimatedRunTime: 300000, // 5 minutes
      retryPolicy: { attempts: 3, backoff: 'exponential', delay: 5000 }
    },
    {
      name: 'broadcast_queue_optimization',
      description: 'Optimize broadcast delivery queues and retry failed sends',
      queueName: 'broadcast',
      jobType: 'queue_optimization',
      defaultData: { retryFailed: true, optimizeBatches: true },
      defaultPriority: 7,
      estimatedRunTime: 120000, // 2 minutes
      retryPolicy: { attempts: 2, backoff: 'fixed', delay: 2000 }
    }
  ];

  private constructor() {
    this.initializeJobTemplates();
  }

  static getInstance(): JobSchedulerService {
    if (!JobSchedulerService.instance) {
      JobSchedulerService.instance = new JobSchedulerService();
    }
    return JobSchedulerService.instance;
  }

  /**
   * Initialize the job scheduler service
   */
  async initialize(): Promise<void> {
    try {
      // Initialize job templates
      this.initializeJobTemplates();
      
      // Create default scheduled jobs
      await this.createDefaultScheduledJobs();
      
      this.isRunning = true;
      
      this.logger.info('✅ JobSchedulerService initialized successfully', {
        scheduledJobs: this.scheduledJobs.size,
        jobTemplates: this.jobTemplates.size
      });
    } catch (error) {
      this.logger.error('❌ Failed to initialize JobSchedulerService:', error);
      throw error;
    }
  }

  /**
   * Schedule a new job with cron expression
   */
  async scheduleJob(jobConfig: Omit<ScheduledJob, 'id' | 'runCount' | 'errorCount' | 'averageRunTime' | 'createdAt'>): Promise<string> {
    const jobId = nanoid(12);
    
    const scheduledJob: ScheduledJob = {
      id: jobId,
      runCount: 0,
      errorCount: 0,
      averageRunTime: 0,
      createdAt: new Date(),
      ...jobConfig
    };

    // Validate cron expression
    if (!cron.validate(jobConfig.cronExpression)) {
      throw new Error(`Invalid cron expression: ${jobConfig.cronExpression}`);
    }

    // Create cron task
    const task = cron.schedule(jobConfig.cronExpression, async () => {
      await this.executeScheduledJob(jobId);
    }, {
      
      timezone: 'UTC'
    });

    this.scheduledJobs.set(jobId, scheduledJob);
    this.cronTasks.set(jobId, task);

    this.logger.info(`📅 Scheduled job '${jobConfig.name}' created`, {
      jobId,
      cronExpression: jobConfig.cronExpression,
      enabled: jobConfig.enabled
    });

    return jobId;
  }

  /**
   * Execute a scheduled job
   */
  private async executeScheduledJob(jobId: string): Promise<void> {
    const job = this.scheduledJobs.get(jobId);
    if (!job || !job.enabled) return;

    const execution: JobExecution = {
      id: nanoid(12),
      jobId,
      startedAt: new Date(),
      success: false,
      queueName: job.queueName
    };

    try {
      this.logger.info(`🎯 Executing scheduled job '${job.name}'`, { jobId });

      const startTime = Date.now();

      // Create job data with enhanced metadata
      const jobData: Omit<JobData, 'id'> = {
        type: job.jobType,
        payload: {
          ...job.jobData,
          scheduledJobId: jobId,
          executionId: execution.id
        },
        priority: job.priority,
        metadata: {
          scheduledJob: true,
          jobName: job.name,
          cronExpression: job.cronExpression,
          executionCount: job.runCount + 1
        }
      };

      // Add job to appropriate queue
      const enqueuedJobId = await this.jobQueue.addJob(job.queueName, jobData);

      // Wait for job completion (with timeout)
      const result = await this.waitForJobCompletion(job.queueName, enqueuedJobId, 600000); // 10 minute timeout

      const duration = Date.now() - startTime;

      // Update execution record
      execution.completedAt = new Date();
      execution.duration = duration;
      execution.success = result.success;
      execution.result = result.result;
      execution.error = result.error;

      // Update scheduled job statistics
      job.lastRun = new Date();
      job.runCount += 1;
      
      if (!result.success) {
        job.errorCount += 1;
      }
      
      // Update average run time
      job.averageRunTime = ((job.averageRunTime * (job.runCount - 1)) + duration) / job.runCount;

      this.scheduledJobs.set(jobId, job);
      this.jobExecutions.push(execution);

      // Keep only last 100 executions
      if (this.jobExecutions.length > 100) {
        this.jobExecutions = this.jobExecutions.slice(-100);
      }

      this.logger.info(`✅ Scheduled job '${job.name}' completed`, {
        jobId,
        duration,
        success: result.success
      });

    } catch (error) {
      execution.completedAt = new Date();
      execution.duration = Date.now() - execution.startedAt.getTime();
      execution.success = false;
      execution.error = error instanceof Error ? error.message : 'Unknown error';

      job.errorCount += 1;
      this.scheduledJobs.set(jobId, job);
      this.jobExecutions.push(execution);

      this.logger.error(`❌ Scheduled job '${job.name}' failed:`, error);
    }
  }

  /**
   * Execute a job immediately (one-time execution)
   */
  async executeJobNow(templateName: string, customData?: any, options: { priority?: number; timeout?: number } = {}): Promise<string> {
    const template = this.jobTemplates.get(templateName);
    if (!template) {
      throw new Error(`Job template '${templateName}' not found`);
    }

    const jobData: Omit<JobData, 'id'> = {
      type: template.jobType,
      payload: {
        ...template.defaultData,
        ...customData,
        immediateExecution: true
      },
      priority: options.priority || template.defaultPriority,
      metadata: {
        templateName,
        immediateExecution: true,
        timeout: options.timeout
      }
    };

    const jobId = await this.jobQueue.addJob(template.queueName, jobData);

    this.logger.info(`⚡ Immediate job execution queued`, {
      templateName,
      jobId,
      queueName: template.queueName
    });

    return jobId;
  }

  /**
   * Pause a scheduled job
   */
  async pauseJob(jobId: string): Promise<boolean> {
    const job = this.scheduledJobs.get(jobId);
    const task = this.cronTasks.get(jobId);
    
    if (!job || !task) return false;

    job.enabled = false;
    task.stop();
    
    this.scheduledJobs.set(jobId, job);

    this.logger.info(`⏸️ Scheduled job '${job.name}' paused`, { jobId });
    return true;
  }

  /**
   * Resume a scheduled job
   */
  async resumeJob(jobId: string): Promise<boolean> {
    const job = this.scheduledJobs.get(jobId);
    const task = this.cronTasks.get(jobId);
    
    if (!job || !task) return false;

    job.enabled = true;
    task.start();
    
    this.scheduledJobs.set(jobId, job);

    this.logger.info(`▶️ Scheduled job '${job.name}' resumed`, { jobId });
    return true;
  }

  /**
   * Delete a scheduled job
   */
  async deleteJob(jobId: string): Promise<boolean> {
    const job = this.scheduledJobs.get(jobId);
    const task = this.cronTasks.get(jobId);
    
    if (!job || !task) return false;

    task.stop();
    this.scheduledJobs.delete(jobId);
    this.cronTasks.delete(jobId);

    this.logger.info(`🗑️ Scheduled job '${job.name}' deleted`, { jobId });
    return true;
  }

  /**
   * Get job execution history
   */
  getJobExecutions(jobId?: string, limit: number = 50): JobExecution[] {
    let executions = this.jobExecutions;
    
    if (jobId) {
      executions = executions.filter(exec => exec.jobId === jobId);
    }
    
    return executions
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit);
  }

  /**
   * Get scheduled job statistics
   */
  getJobStatistics(): {
    totalJobs: number;
    activeJobs: number;
    totalExecutions: number;
    successfulExecutions: number;
    failedExecutions: number;
    averageExecutionTime: number;
    jobsByQueue: Record<string, number>;
  } {
    const activeJobs = Array.from(this.scheduledJobs.values()).filter(job => job.enabled).length;
    const successfulExecutions = this.jobExecutions.filter(exec => exec.success).length;
    const failedExecutions = this.jobExecutions.filter(exec => !exec.success).length;
    
    const totalDuration = this.jobExecutions
      .filter(exec => exec.duration)
      .reduce((sum, exec) => sum + exec.duration!, 0);
    
    const averageExecutionTime = this.jobExecutions.length > 0 
      ? totalDuration / this.jobExecutions.filter(exec => exec.duration).length 
      : 0;

    const jobsByQueue: Record<string, number> = {};
    for (const job of this.scheduledJobs.values()) {
      jobsByQueue[job.queueName] = (jobsByQueue[job.queueName] || 0) + 1;
    }

    return {
      totalJobs: this.scheduledJobs.size,
      activeJobs,
      totalExecutions: this.jobExecutions.length,
      successfulExecutions,
      failedExecutions,
      averageExecutionTime,
      jobsByQueue
    };
  }

  /**
   * Get all scheduled jobs
   */
  getScheduledJobs(): ScheduledJob[] {
    return Array.from(this.scheduledJobs.values());
  }

  /**
   * Get all job templates
   */
  getJobTemplates(): JobTemplate[] {
    return Array.from(this.jobTemplates.values());
  }

  /**
   * Add or update job template
   */
  setJobTemplate(template: JobTemplate): void {
    this.jobTemplates.set(template.name, template);
    this.logger.info(`📋 Job template '${template.name}' updated`);
  }

  /**
   * Wait for job completion (used internally)
   */
  private async waitForJobCompletion(queueName: string, jobId: string, timeout: number = 300000): Promise<{ success: boolean; result?: any; error?: string }> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      
      const checkInterval = setInterval(async () => {
        try {
          const job = await this.jobQueue.getJob(queueName, jobId);
          
          if (!job) {
            clearInterval(checkInterval);
            resolve({ success: false, error: 'Job not found' });
            return;
          }
          
          if (await job.isCompleted()) {
            clearInterval(checkInterval);
            const result = job.returnvalue;
            resolve({ success: true, result });
            return;
          }
          
          if (await job.isFailed()) {
            clearInterval(checkInterval);
            const error = job.failedReason || 'Job failed';
            resolve({ success: false, error });
            return;
          }
          
          // Check timeout
          if (Date.now() - startTime > timeout) {
            clearInterval(checkInterval);
            resolve({ success: false, error: 'Job execution timeout' });
            return;
          }
          
        } catch (error) {
          clearInterval(checkInterval);
          resolve({ success: false, error: error instanceof Error ? error.message : 'Unknown error' });
        }
      }, 5000); // Check every 5 seconds
    });
  }

  /**
   * Initialize default job templates
   */
  private initializeJobTemplates(): void {
    for (const template of this.defaultTemplates) {
      this.jobTemplates.set(template.name, template);
    }
    
    this.logger.info(`📋 Initialized ${this.defaultTemplates.length} job templates`);
  }

  /**
   * Create default scheduled jobs
   */
  private async createDefaultScheduledJobs(): Promise<void> {
    const defaultJobs = [
      {
        name: 'Hourly Cache Warming',
        cronExpression: '0 */1 * * *', // Every hour
        templateName: 'cache_warming',
        priority: 6,
        enabled: true
      },
      {
        name: 'Daily Session Cleanup',
        cronExpression: '0 2 * * *', // Every day at 2 AM
        templateName: 'session_cleanup',
        priority: 4,
        enabled: true
      },
      {
        name: 'Security Analysis Batch',
        cronExpression: '*/15 * * * *', // Every 15 minutes
        templateName: 'security_analysis_batch',
        priority: 8,
        enabled: true
      },
      {
        name: 'Daily Data Backup',
        cronExpression: '0 3 * * *', // Every day at 3 AM
        templateName: 'data_backup',
        priority: 7,
        enabled: process.env.ENABLE_AUTO_BACKUP !== 'false'  // Respect env variable
      },
      {
        name: 'Performance Analysis',
        cronExpression: '0 */6 * * *', // Every 6 hours
        templateName: 'performance_analysis',
        priority: 5,
        enabled: true
      },
      {
        name: 'Weekly Migration Cleanup',
        cronExpression: '0 4 * * 0', // Every Sunday at 4 AM
        templateName: 'task_migration_cleanup',
        priority: 3,
        enabled: true
      },
      {
        name: 'Daily Security Report',
        cronExpression: '0 1 * * *', // Every day at 1 AM
        templateName: 'security_report_generation',
        priority: 6,
        enabled: true
      },
      {
        name: 'Broadcast Queue Optimization',
        cronExpression: '*/30 * * * *', // Every 30 minutes
        templateName: 'broadcast_queue_optimization',
        priority: 7,
        enabled: true
      }
    ];

    for (const jobConfig of defaultJobs) {
      const template = this.jobTemplates.get(jobConfig.templateName);
      if (!template) continue;

      try {
        await this.scheduleJob({
          name: jobConfig.name,
          cronExpression: jobConfig.cronExpression,
          queueName: template.queueName,
          jobType: template.jobType,
          jobData: template.defaultData,
          priority: jobConfig.priority,
          enabled: jobConfig.enabled
        });
      } catch (error) {
        this.logger.error(`Failed to create default job '${jobConfig.name}':`, error);
      }
    }

    this.logger.info(`📅 Created ${defaultJobs.length} default scheduled jobs`);
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    scheduledJobs: number;
    activeJobs: number;
    recentExecutions: number;
    failedExecutions: number;
  }> {
    try {
      const stats = this.getJobStatistics();
      const recentExecutions = this.jobExecutions.filter(exec => 
        Date.now() - exec.startedAt.getTime() < 24 * 60 * 60 * 1000
      ).length;
      
      return {
        healthy: this.isRunning && stats.activeJobs > 0,
        scheduledJobs: stats.totalJobs,
        activeJobs: stats.activeJobs,
        recentExecutions,
        failedExecutions: stats.failedExecutions
      };
    } catch (error) {
      this.logger.error('Job scheduler health check failed:', error);
      return {
        healthy: false,
        scheduledJobs: 0,
        activeJobs: 0,
        recentExecutions: 0,
        failedExecutions: 0
      };
    }
  }

  /**
   * Shutdown scheduler
   */
  async shutdown(): Promise<void> {
    this.logger.info('🛑 JobSchedulerService shutting down...');
    
    this.isRunning = false;
    
    // Destroy all cron tasks
    for (const task of this.cronTasks.values()) {
      task.stop();
    }
    
    this.cronTasks.clear();
    
    this.logger.info('✅ JobSchedulerService shutdown completed');
  }
}

export default JobSchedulerService.getInstance();