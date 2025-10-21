import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { EventEmitter } from 'events';
import { Logger } from './logger';
import { nanoid } from './id';
import * as path from 'path';
import * as fs from 'fs';

export interface WorkerTask {
  id: string;
  type: string;
  data: any;
  priority: number;
  createdAt: Date;
  timeout?: number;
}

export interface WorkerResult {
  success: boolean;
  result?: any;
  error?: string;
  duration: number;
  workerId: string;
  memory?: {
    used: number;
    total: number;
  };
}

export interface WorkerMetrics {
  workerId: string;
  workerFile: string;
  isActive: boolean;
  tasksCompleted: number;
  tasksErrors: number;
  averageExecutionTime: number;
  memoryUsage: number;
  createdAt: Date;
  lastTaskAt?: Date;
  uptime: number;
}

export interface PoolConfig {
  minWorkers: number;
  maxWorkers: number;
  maxIdleTime: number; // milliseconds
  taskTimeout: number; // milliseconds
  memoryLimit: number; // MB
  cpuThreshold: number; // percentage
}

/**
 * Advanced Worker Thread Manager for CPU-intensive tasks
 * Provides thread pool management, load balancing, and automatic scaling
 */
export class WorkerThreadManager extends EventEmitter {
  private static instance: WorkerThreadManager;
  private readonly logger = Logger.getInstance();
  private workers = new Map<string, Worker>();
  private workerMetrics = new Map<string, WorkerMetrics>();
  private taskQueue: WorkerTask[] = [];
  private activeWorkers = new Set<string>();
  private workerFiles = new Map<string, string>();
  private isShuttingDown = false;

  // Pool configuration
  private readonly poolConfig: PoolConfig = {
    minWorkers: 2,
    maxWorkers: Math.min(8, require('os').cpus().length),
    maxIdleTime: 30000, // 30 seconds
    taskTimeout: 60000, // 60 seconds
    memoryLimit: 512, // 512MB per worker
    cpuThreshold: 80 // 80% CPU usage threshold
  };

  private monitoringInterval?: NodeJS.Timeout;

  private constructor() {
    super();
    this.setupWorkerFiles();
    this.startMonitoring();
    
    // Handle graceful shutdown
    process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
  }

  static getInstance(): WorkerThreadManager {
    if (!WorkerThreadManager.instance) {
      WorkerThreadManager.instance = new WorkerThreadManager();
    }
    return WorkerThreadManager.instance;
  }

  /**
   * Initialize the worker thread manager
   */
  async initialize(): Promise<void> {
    try {
      // Create initial worker pool
      await this.scaleWorkerPool(this.poolConfig.minWorkers);
      
      this.logger.info('✅ WorkerThreadManager initialized successfully', {
        initialWorkers: this.workers.size,
        maxWorkers: this.poolConfig.maxWorkers,
        availableWorkerTypes: Array.from(this.workerFiles.keys())
      });
    } catch (error) {
      this.logger.error('❌ Failed to initialize WorkerThreadManager:', error);
      throw error;
    }
  }

  /**
   * Execute a task using worker threads
   */
  async executeTask(
    taskType: string,
    taskData: any,
    options: { priority?: number; timeout?: number } = {}
  ): Promise<WorkerResult> {
    const task: WorkerTask = {
      id: nanoid(12),
      type: taskType,
      data: taskData,
      priority: options.priority || 1,
      createdAt: new Date(),
      timeout: options.timeout || this.poolConfig.taskTimeout
    };

    return new Promise((resolve, reject) => {
      const startTime = Date.now();
      
      // Add task to queue with priority sorting
      this.taskQueue.push(task);
      this.taskQueue.sort((a, b) => b.priority - a.priority);

      // Process queue
      this.processQueue();

      // Set up timeout
      const timeoutId = setTimeout(() => {
        this.removeTaskFromQueue(task.id);
        reject(new Error(`Task ${task.id} timed out after ${task.timeout}ms`));
      }, task.timeout);

      // Listen for task completion
      const onTaskComplete = (result: WorkerResult & { taskId: string }) => {
        if (result.taskId === task.id) {
          clearTimeout(timeoutId);
          this.off('taskComplete', onTaskComplete);
          this.off('taskError', onTaskError);
          
          result.duration = Date.now() - startTime;
          resolve(result);
        }
      };

      const onTaskError = (error: Error & { taskId: string }) => {
        if (error.taskId === task.id) {
          clearTimeout(timeoutId);
          this.off('taskComplete', onTaskComplete);
          this.off('taskError', onTaskError);
          
          reject(error);
        }
      };

      this.on('taskComplete', onTaskComplete);
      this.on('taskError', onTaskError);
    });
  }

  /**
   * Execute multiple tasks in parallel with concurrency control
   */
  async executeBatchTasks(
    tasks: Array<{ type: string; data: any; priority?: number }>,
    concurrency: number = 3
  ): Promise<WorkerResult[]> {
    const results: WorkerResult[] = [];
    const executing: Promise<WorkerResult>[] = [];

    for (const task of tasks) {
      const taskPromise = this.executeTask(task.type, task.data, {
        priority: task.priority
      });

      executing.push(taskPromise);
      
      if (executing.length >= concurrency) {
        const completed = await Promise.race(executing);
        results.push(completed);
        executing.splice(executing.findIndex(p => p === Promise.resolve(completed)), 1);
      }
    }

    // Wait for remaining tasks
    const remainingResults = await Promise.all(executing);
    results.push(...remainingResults);

    return results;
  }

  /**
   * Get worker metrics and statistics
   */
  getWorkerMetrics(): WorkerMetrics[] {
    return Array.from(this.workerMetrics.values()).map(metrics => ({
      ...metrics,
      uptime: Date.now() - metrics.createdAt.getTime(),
      memoryUsage: this.getWorkerMemoryUsage(metrics.workerId)
    }));
  }

  /**
   * Get queue statistics
   */
  getQueueStats(): {
    pending: number;
    processing: number;
    workers: {
      total: number;
      active: number;
      idle: number;
    };
    performance: {
      averageTaskTime: number;
      successRate: number;
    };
  } {
    const totalTasks = Array.from(this.workerMetrics.values())
      .reduce((sum, metrics) => sum + metrics.tasksCompleted, 0);
    
    const totalErrors = Array.from(this.workerMetrics.values())
      .reduce((sum, metrics) => sum + metrics.tasksErrors, 0);
    
    const averageTaskTime = Array.from(this.workerMetrics.values())
      .reduce((sum, metrics) => sum + metrics.averageExecutionTime, 0) / this.workerMetrics.size;

    return {
      pending: this.taskQueue.length,
      processing: this.activeWorkers.size,
      workers: {
        total: this.workers.size,
        active: this.activeWorkers.size,
        idle: this.workers.size - this.activeWorkers.size
      },
      performance: {
        averageTaskTime: averageTaskTime || 0,
        successRate: totalTasks > 0 ? (totalTasks - totalErrors) / totalTasks * 100 : 0
      }
    };
  }

  /**
   * Scale worker pool based on demand
   */
  async scaleWorkerPool(targetSize: number): Promise<void> {
    const currentSize = this.workers.size;
    
    if (targetSize > currentSize) {
      // Add workers
      const workersToAdd = Math.min(targetSize - currentSize, this.poolConfig.maxWorkers - currentSize);
      for (let i = 0; i < workersToAdd; i++) {
        await this.createWorker();
      }
    } else if (targetSize < currentSize) {
      // Remove workers
      const workersToRemove = currentSize - Math.max(targetSize, this.poolConfig.minWorkers);
      await this.removeIdleWorkers(workersToRemove);
    }
  }

  /**
   * Process the task queue
   */
  private async processQueue(): Promise<void> {
    while (this.taskQueue.length > 0 && !this.isShuttingDown) {
      const availableWorker = this.getAvailableWorker();
      
      if (!availableWorker) {
        // Try to scale up if under max limit
        if (this.workers.size < this.poolConfig.maxWorkers) {
          await this.createWorker();
          continue;
        }
        break; // No available workers and can't create more
      }

      const task = this.taskQueue.shift()!;
      await this.assignTaskToWorker(availableWorker, task);
    }
  }

  /**
   * Get an available worker for task assignment
   */
  private getAvailableWorker(): string | null {
    for (const [workerId] of this.workers) {
      if (!this.activeWorkers.has(workerId)) {
        return workerId;
      }
    }
    return null;
  }

  /**
   * Assign a task to a specific worker
   */
  private async assignTaskToWorker(workerId: string, task: WorkerTask): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    this.activeWorkers.add(workerId);
    const startTime = Date.now();

    try {
      this.logger.debug(`🔄 Assigning task ${task.id} to worker ${workerId}`, {
        taskType: task.type,
        priority: task.priority
      });

      // Send task to worker
      worker.postMessage({
        taskId: task.id,
        taskType: task.type,
        taskData: task.data
      });

      // Listen for result
      const onMessage = (result: any) => {
        if (result.taskId === task.id) {
          this.activeWorkers.delete(workerId);
          worker.off('message', onMessage);
          worker.off('error', onError);
          
          // Update metrics
          this.updateWorkerMetrics(workerId, true, Date.now() - startTime);
          
          this.emit('taskComplete', { ...result, taskId: task.id });
          
          // Continue processing queue
          setImmediate(() => this.processQueue());
        }
      };

      const onError = (error: Error) => {
        this.activeWorkers.delete(workerId);
        worker.off('message', onMessage);
        worker.off('error', onError);
        
        // Update metrics
        this.updateWorkerMetrics(workerId, false, Date.now() - startTime);
        
        this.emit('taskError', { ...error, taskId: task.id });
      };

      worker.on('message', onMessage);
      worker.on('error', onError);

    } catch (error) {
      this.activeWorkers.delete(workerId);
      this.logger.error(`❌ Error assigning task to worker ${workerId}:`, error);
    }
  }

  /**
   * Create a new worker
   */
  private async createWorker(): Promise<string> {
    const workerId = `worker-${nanoid(8)}`;
    const workerFile = this.workerFiles.get('security') || path.join(__dirname, '../workers/security-worker.js');
    
    try {
      const opts: any = { workerData: { workerId } };
      if (workerFile.endsWith('.ts')) {
        opts.execArgv = ['-r', 'ts-node/register/transpile-only'];
      }
      const worker = new Worker(workerFile, opts);

      this.workers.set(workerId, worker);
      
      // Initialize worker metrics
      this.workerMetrics.set(workerId, {
        workerId,
        workerFile,
        isActive: true,
        tasksCompleted: 0,
        tasksErrors: 0,
        averageExecutionTime: 0,
        memoryUsage: 0,
        createdAt: new Date(),
        uptime: 0
      });

      // Set up worker event listeners
      this.setupWorkerEventListeners(worker, workerId);

      this.logger.info(`👷 Worker ${workerId} created successfully`);
      return workerId;
    } catch (error) {
      this.logger.error(`❌ Failed to create worker ${workerId}:`, error);
      throw error;
    }
  }

  /**
   * Remove idle workers
   */
  private async removeIdleWorkers(count: number): Promise<void> {
    const idleWorkers = Array.from(this.workers.keys())
      .filter(workerId => !this.activeWorkers.has(workerId))
      .slice(0, count);

    for (const workerId of idleWorkers) {
      await this.terminateWorker(workerId);
    }
  }

  /**
   * Terminate a worker
   */
  private async terminateWorker(workerId: string): Promise<void> {
    const worker = this.workers.get(workerId);
    if (!worker) return;

    try {
      await worker.terminate();
      this.workers.delete(workerId);
      this.workerMetrics.delete(workerId);
      this.activeWorkers.delete(workerId);
      
      this.logger.info(`🛑 Worker ${workerId} terminated`);
    } catch (error) {
      this.logger.error(`❌ Error terminating worker ${workerId}:`, error);
    }
  }

  /**
   * Setup worker event listeners
   */
  private setupWorkerEventListeners(worker: Worker, workerId: string): void {
    worker.on('error', (error) => {
      this.logger.error(`Worker ${workerId} error:`, error);
      this.emit('workerError', { workerId, error });
    });

    worker.on('exit', (code) => {
      if (code !== 0) {
        this.logger.error(`Worker ${workerId} exited with code ${code}`);
      }
      
      // Clean up
      this.workers.delete(workerId);
      this.workerMetrics.delete(workerId);
      this.activeWorkers.delete(workerId);
    });
  }

  /**
   * Update worker metrics
   */
  private updateWorkerMetrics(workerId: string, success: boolean, duration: number): void {
    const metrics = this.workerMetrics.get(workerId);
    if (!metrics) return;

    metrics.tasksCompleted += 1;
    if (!success) {
      metrics.tasksErrors += 1;
    }

    // Update average execution time
    const totalTime = metrics.averageExecutionTime * (metrics.tasksCompleted - 1) + duration;
    metrics.averageExecutionTime = totalTime / metrics.tasksCompleted;
    metrics.lastTaskAt = new Date();

    this.workerMetrics.set(workerId, metrics);
  }

  /**
   * Get worker memory usage
   */
  private getWorkerMemoryUsage(workerId: string): number {
    // This is a placeholder - actual implementation would require
    // communication with the worker to get memory stats
    return 0;
  }

  /**
   * Remove task from queue
   */
  private removeTaskFromQueue(taskId: string): void {
    const index = this.taskQueue.findIndex(task => task.id === taskId);
    if (index !== -1) {
      this.taskQueue.splice(index, 1);
    }
  }

  /**
   * Start monitoring worker performance and health
   */
  private startMonitoring(): void {
    this.monitoringInterval = setInterval(() => {
      this.performHealthCheck();
      this.optimizeWorkerPool();
    }, 30000); // Every 30 seconds
  }

  /**
   * Perform health check on all workers
   */
  private async performHealthCheck(): Promise<void> {
    const stats = this.getQueueStats();
    
    // Log performance metrics
    this.logger.debug('Worker pool health check', {
      pending: stats.pending,
      processing: stats.processing,
      workers: stats.workers,
      performance: stats.performance
    });

    // Check for stuck workers
    const now = Date.now();
    for (const [workerId] of this.activeWorkers) {
      const metrics = this.workerMetrics.get(workerId);
      if (metrics && metrics.lastTaskAt) {
        const timeSinceLastTask = now - metrics.lastTaskAt.getTime();
        if (timeSinceLastTask > this.poolConfig.taskTimeout * 2) {
          this.logger.warn(`Worker ${workerId} appears stuck, restarting...`);
          await this.restartWorker(workerId);
        }
      }
    }
  }

  /**
   * Optimize worker pool based on current load
   */
  private async optimizeWorkerPool(): Promise<void> {
    const stats = this.getQueueStats();
    const queueLoad = stats.pending / this.poolConfig.maxWorkers;
    
    if (queueLoad > 2 && this.workers.size < this.poolConfig.maxWorkers) {
      // High load - scale up
      await this.scaleWorkerPool(Math.min(this.workers.size + 1, this.poolConfig.maxWorkers));
    } else if (queueLoad < 0.5 && this.workers.size > this.poolConfig.minWorkers) {
      // Low load - scale down
      await this.scaleWorkerPool(Math.max(this.workers.size - 1, this.poolConfig.minWorkers));
    }
  }

  /**
   * Restart a worker
   */
  private async restartWorker(workerId: string): Promise<void> {
    await this.terminateWorker(workerId);
    await this.createWorker();
  }

  /**
   * Setup worker files for different task types
   */
  private setupWorkerFiles(): void {
    const jsDir = path.join(__dirname, '../workers');
    const tsDir = path.join(process.cwd(), 'src', 'workers');

    const pick = (name: string) => {
      const js = path.join(jsDir, `${name}.js`);
      const ts = path.join(tsDir, `${name}.ts`);
      if (fs.existsSync(js)) return js;
      if (fs.existsSync(ts)) return ts;
      return js; // default to js path; will fail loudly if missing
    };

    this.workerFiles.set('security', pick('security-worker'));
    this.workerFiles.set('analytics', pick('security-worker'));
    this.workerFiles.set('data_processing', pick('security-worker'));
  }

  /**
   * Graceful shutdown
   */
  private async gracefulShutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) return;
    this.isShuttingDown = true;

    this.logger.info(`🛑 Worker thread manager shutting down (${signal})`);

    // Stop monitoring
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
    }

    // Wait for active tasks to complete (with timeout)
    const shutdownTimeout = 30000; // 30 seconds
    const start = Date.now();
    
    while (this.activeWorkers.size > 0 && (Date.now() - start) < shutdownTimeout) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Terminate all workers
    const terminatePromises = Array.from(this.workers.keys()).map(workerId => 
      this.terminateWorker(workerId)
    );
    
    await Promise.allSettled(terminatePromises);
    
    this.logger.info('✅ Worker thread manager shutdown completed');
  }

  /**
   * Health check
   */
  async healthCheck(): Promise<{
    healthy: boolean;
    workers: number;
    activeWorkers: number;
    queueLength: number;
    performance: any;
  }> {
    try {
      const stats = this.getQueueStats();
      
      return {
        healthy: this.workers.size >= this.poolConfig.minWorkers && !this.isShuttingDown,
        workers: this.workers.size,
        activeWorkers: this.activeWorkers.size,
        queueLength: this.taskQueue.length,
        performance: stats.performance
      };
    } catch (error) {
      this.logger.error('Worker health check failed:', error);
      return {
        healthy: false,
        workers: 0,
        activeWorkers: 0,
        queueLength: 0,
        performance: { averageTaskTime: 0, successRate: 0 }
      };
    }
  }
}

export default WorkerThreadManager.getInstance();