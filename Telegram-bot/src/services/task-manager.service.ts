import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';
import { Task, TaskFilter } from '../types/task.types';
import { getDefaultTasks } from '../bot/handlers/default-tasks';
import { MemoryManager } from './memory-manager.service';
import { MongoStorage } from '../storage/implementations/mongodb-storage';
import { getConfig } from '../config';

export interface TaskManagerConfig {
  runtimeTasksPath: string;
  enableAutoBackup: boolean;
  backupInterval?: number; // minutes
}

export class TaskManager {
  private static instance: TaskManager;
  private readonly logger = Logger.getInstance();
  private readonly memoryManager = MemoryManager.getInstance();
  private config: TaskManagerConfig;
  private tasksCache: any;
  private lastSync: Date = new Date();
  private backupTimerId?: string;
  private storage: MongoStorage | null = null;
  private useMongoDb: boolean = false;

  private constructor(config: TaskManagerConfig) {
    this.config = config;
    // Initialize managed LRU cache for tasks (no TTL for active task system)
    this.tasksCache = this.memoryManager.createCache<string, Task>(
      'task-cache',
      'Task manager cache',
      { max: 10000 } // Max 10000 tasks, no TTL
    );
    
    // Check if we should use MongoDB for tasks
    const appConfig = getConfig();
    this.useMongoDb = appConfig.storage.source === 'mongodb';
    if (this.useMongoDb) {
      this.storage = new MongoStorage();
    }
  }

  public static getInstance(config?: TaskManagerConfig): TaskManager {
    if (!TaskManager.instance) {
      if (!config) {
        throw new Error('TaskManager config required for first initialization');
      }
      TaskManager.instance = new TaskManager(config);
    }
    return TaskManager.instance;
  }

  /**
   * Initialize task system - load defaults and sync to runtime
   */
  public async initialize(): Promise<void> {
    try {
      this.logger.info('Initializing Task Manager...');
      
      // Initialize MongoDB storage if needed
      if (this.useMongoDb && this.storage) {
        await this.storage.initialize();
        this.logger.info('Using MongoDB for task storage');
      } else {
        // Ensure directories exist for file-based storage
        await this.ensureDirectories();
        this.logger.info('Using file-based task storage');
      }
      
      // Load default tasks from TypeScript module
      const defaultTasks = getDefaultTasks();
      this.logger.info(`Loaded ${Object.keys(defaultTasks).length} default tasks`);
      
      // Load runtime tasks (from MongoDB or file)
      const runtimeTasks = await this.loadRuntimeTasks();
      this.logger.info(`Found ${Object.keys(runtimeTasks).length} runtime tasks`);
      
      // Merge and validate tasks
      const mergedTasks = this.mergeTasks(defaultTasks, runtimeTasks);
      const validatedTasks = this.validateTasks(mergedTasks);
      
      // Save merged tasks to runtime (MongoDB or file)
      await this.saveRuntimeTasks(validatedTasks);
      
      // Update cache
      this.updateCache(validatedTasks);
      
      // Setup auto-backup if enabled (only for file-based storage)
      if (!this.useMongoDb && this.config.enableAutoBackup) {
        this.setupAutoBackup();
      }
      
      this.logger.info(`Task Manager initialized with ${this.tasksCache.size} active tasks`);
      
    } catch (error) {
      this.logger.error('Failed to initialize Task Manager:', error);
      throw error;
    }
  }

  /**
   * Get all tasks
   */
  public async getAllTasks(): Promise<Task[]> {
    return Array.from(this.tasksCache.values());
  }

  /**
   * Get tasks with filter
   */
  public async getFilteredTasks(filter: TaskFilter): Promise<Task[]> {
    const allTasks = await this.getAllTasks();
    
    return allTasks.filter(task => {
      if (filter.category && task.category !== filter.category) return false;
      if (filter.type && task.type !== filter.type) return false;
      if (filter.isActive !== undefined && task.isActive !== filter.isActive) return false;
      if (filter.isDaily !== undefined && task.isDaily !== filter.isDaily) return false;
      if (filter.minPoints && task.points < filter.minPoints) return false;
      if (filter.maxPoints && task.points > filter.maxPoints) return false;
      if (filter.verificationMethod && task.verificationMethod !== filter.verificationMethod) return false;
      if (filter.hasRequirements !== undefined) {
        const hasReq = task.requirements && Object.keys(task.requirements).length > 0;
        if (hasReq !== filter.hasRequirements) return false;
      }
      if (filter.search) {
        const searchLower = filter.search.toLowerCase();
        const titleMatch = task.title.toLowerCase().includes(searchLower);
        const descMatch = task.description.toLowerCase().includes(searchLower);
        if (!titleMatch && !descMatch) return false;
      }
      
      return true;
    });
  }

  /**
   * Get task by ID
   */
  public async getTask(taskId: string): Promise<Task | null> {
    return this.tasksCache.get(taskId) || null;
  }

  /**
   * Add or update task (runtime only)
   */
  public async saveTask(task: Task): Promise<void> {
    try {
      // Validate task
      const validationResult = this.validateSingleTask(task);
      if (!validationResult.isValid) {
        throw new Error(`Task validation failed: ${validationResult.errors.join(', ')}`);
      }

      // Preserve isPermanent if task already exists, otherwise mark as temporary
      const existingTask = this.tasksCache.get(task.id);
      if (existingTask) {
        task.isPermanent = existingTask.isPermanent;
      } else {
        task.isPermanent = false;
      }
      
      task.updatedAt = new Date().toISOString();

      // Update cache
      this.tasksCache.set(task.id, task);

      // Save to runtime file
      const allTasks = await this.getAllTasks();
      const tasksObject = this.tasksArrayToObject(allTasks);
      await this.saveRuntimeTasks(tasksObject);

      this.logger.info(`Task saved: ${task.id} - ${task.title} (isPermanent: ${task.isPermanent})`);

    } catch (error) {
      this.logger.error('Error saving task:', error);
      throw error;
    }
  }

  /**
   * Remove task (runtime only, permanent tasks cannot be removed)
   */
  public async removeTask(taskId: string): Promise<boolean> {
    try {
      const task = this.tasksCache.get(taskId);
      if (!task) {
        this.logger.warn(`Task not found for removal: ${taskId}`);
        return false;
      }

      if (task.isPermanent) {
        this.logger.warn(`Cannot remove permanent task: ${taskId}`);
        return false;
      }

      // Remove from cache
      this.tasksCache.delete(taskId);

      // Update runtime file
      const allTasks = await this.getAllTasks();
      const tasksObject = this.tasksArrayToObject(allTasks);
      await this.saveRuntimeTasks(tasksObject);

      this.logger.info(`Task removed: ${taskId}`);
      return true;

    } catch (error) {
      this.logger.error('Error removing task:', error);
      return false;
    }
  }

  /**
   * Refresh tasks from files
   */
  public async refresh(): Promise<void> {
    await this.initialize();
  }

  /**
   * Get task statistics
   */
  public async getTaskStats(): Promise<any> {
    const allTasks = await this.getAllTasks();
    
    const stats = {
      total: allTasks.length,
      active: allTasks.filter(t => t.isActive).length,
      inactive: allTasks.filter(t => !t.isActive).length,
      daily: allTasks.filter(t => t.isDaily).length,
      permanent: allTasks.filter(t => t.isPermanent).length,
      temporary: allTasks.filter(t => !t.isPermanent).length,
      categories: {} as Record<string, number>,
      types: {} as Record<string, number>,
      pointsRange: {
        min: Math.min(...allTasks.map(t => t.points)),
        max: Math.max(...allTasks.map(t => t.points)),
        avg: allTasks.reduce((sum, t) => sum + t.points, 0) / allTasks.length
      }
    };

    // Count by categories and types
    for (const task of allTasks) {
      stats.categories[task.category] = (stats.categories[task.category] || 0) + 1;
      stats.types[task.type] = (stats.types[task.type] || 0) + 1;
    }

    return stats;
  }

  /**
   * Create backup of current tasks
   */
  public async createBackup(): Promise<string> {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFileName = `tasks-backup-${timestamp}.json`;
      const backupPath = path.join(path.dirname(this.config.runtimeTasksPath), 'backups', backupFileName);

      // Ensure backup directory exists
      const backupDir = path.dirname(backupPath);
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      // Get all tasks
      const allTasks = await this.getAllTasks();
      const tasksObject = this.tasksArrayToObject(allTasks);

      // Add metadata
      const backupData = {
        metadata: {
          createdAt: new Date().toISOString(),
          version: '1.0.0',
          taskCount: allTasks.length
        },
        tasks: tasksObject
      };

      // Write backup file
      fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
      
      this.logger.info(`Task backup created: ${backupPath}`);
      return backupPath;

    } catch (error) {
      this.logger.error('Error creating task backup:', error);
      throw error;
    }
  }

  private async ensureDirectories(): Promise<void> {
    const dirs = [
      path.dirname(this.config.runtimeTasksPath),
      path.join(path.dirname(this.config.runtimeTasksPath), 'backups')
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        this.logger.info(`Created directory: ${dir}`);
      }
    }
  }



  private async loadRuntimeTasks(): Promise<Record<string, Task>> {
    try {
      if (this.useMongoDb && this.storage) {
        // Load tasks from MongoDB
        const tasks = await this.storage.findByQuery<Task>('tasks', {});
        const tasksObject: Record<string, Task> = {};
        for (const task of tasks) {
          tasksObject[task.id] = task;
        }
        return tasksObject;
      } else {
        // Load tasks from file
        if (!fs.existsSync(this.config.runtimeTasksPath)) {
          return {};
        }
        const content = fs.readFileSync(this.config.runtimeTasksPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      this.logger.error('Error loading runtime tasks:', error);
      return {};
    }
  }

  private async saveRuntimeTasks(tasks: Record<string, Task>): Promise<void> {
    try {
      if (this.useMongoDb && this.storage) {
        // Save tasks to MongoDB
        // First, clear existing tasks
        await this.storage.deleteMany('tasks', {});
        
        // Then save all tasks
        for (const [taskId, task] of Object.entries(tasks)) {
          await this.storage.set('tasks', task, taskId);
        }
        this.logger.info(`Saved ${Object.keys(tasks).length} tasks to MongoDB`);
      } else {
        // Save tasks to file
        const content = JSON.stringify(tasks, null, 2);
        fs.writeFileSync(this.config.runtimeTasksPath, content);
        this.logger.info(`Saved ${Object.keys(tasks).length} tasks to file`);
      }
      this.lastSync = new Date();
    } catch (error) {
      this.logger.error('Error saving runtime tasks:', error);
      throw error;
    }
  }

  private mergeTasks(defaultTasks: Record<string, Task>, runtimeTasks: Record<string, Task>): Record<string, Task> {
    const merged: Record<string, Task> = {};
    
    // Start with default tasks structure
    for (const [taskId, defaultTask] of Object.entries(defaultTasks)) {
      const runtimeTask = runtimeTasks[taskId];
      
      if (runtimeTask) {
        // Task exists in runtime - PRIORITIZE RUNTIME VERSION COMPLETELY
        // Do NOT override with default task properties to preserve admin changes
        merged[taskId] = {
          ...runtimeTask,  // Runtime version is the source of truth
          isPermanent: true,  // Mark as permanent since it's in defaults
          id: taskId,  // Ensure ID is correct
        };
        // Only apply defaults for completely missing critical fields
        if (!merged[taskId].createdAt) merged[taskId].createdAt = defaultTask.createdAt;
        if (!merged[taskId].verificationMethod) merged[taskId].verificationMethod = defaultTask.verificationMethod;
      } else {
        // New default task not in runtime yet
        merged[taskId] = { ...defaultTask, isPermanent: true };
      }
    }

    // Add custom runtime tasks that don't exist in defaults
    for (const [taskId, task] of Object.entries(runtimeTasks)) {
      if (!merged[taskId]) {
        task.isPermanent = false;
        merged[taskId] = task;
      }
    }

    this.logger.info(`Task merge completed: ${Object.keys(defaultTasks).length} default + ${Object.keys(runtimeTasks).length} runtime = ${Object.keys(merged).length} total (runtime prioritized)`);
    return merged;
  }

  private validateTasks(tasks: Record<string, Task>): Record<string, Task> {
    const validated: Record<string, Task> = {};
    let validCount = 0;
    let invalidCount = 0;

    for (const [taskId, task] of Object.entries(tasks)) {
      const validation = this.validateSingleTask(task);
      if (validation.isValid) {
        validated[taskId] = task;
        validCount++;
      } else {
        this.logger.warn(`Invalid task removed: ${taskId} - ${validation.errors.join(', ')}`);
        invalidCount++;
      }
    }

    this.logger.info(`Task validation completed: ${validCount} valid, ${invalidCount} invalid`);
    return validated;
  }

  private validateSingleTask(task: Task): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!task.id || task.id.trim() === '') {
      errors.push('Task ID is required');
    }

    if (!task.title || task.title.trim() === '') {
      errors.push('Task title is required');
    }

    if (!task.description || task.description.trim() === '') {
      errors.push('Task description is required');
    }

    if (typeof task.points !== 'number' || task.points < 0) {
      errors.push('Task points must be a positive number');
    }

    if (!task.category || task.category.trim() === '') {
      errors.push('Task category is required');
    }

    if (!task.type || task.type.trim() === '') {
      errors.push('Task type is required');
    }

    if (!task.verificationMethod || task.verificationMethod.trim() === '') {
      errors.push('Task verification method is required');
    }

    if (!Array.isArray(task.buttons) || task.buttons.length === 0) {
      errors.push('Task must have at least one button');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private updateCache(tasks: Record<string, Task>): void {
    this.tasksCache.clear();
    for (const [taskId, task] of Object.entries(tasks)) {
      this.tasksCache.set(taskId, task);
    }
  }

  private tasksArrayToObject(tasks: Task[]): Record<string, Task> {
    const tasksObject: Record<string, Task> = {};
    for (const task of tasks) {
      tasksObject[task.id] = task;
    }
    return tasksObject;
  }

  private setupAutoBackup(): void {
    if (this.backupTimerId) {
      this.memoryManager.clearManagedInterval(this.backupTimerId);
    }

    const interval = (this.config.backupInterval || 60) * 60 * 1000; // Convert to milliseconds
    
    this.backupTimerId = this.memoryManager.createManagedInterval(
      'task-manager-backup',
      'Task manager auto backup',
      async () => {
        try {
          await this.createBackup();
          this.logger.info('Auto backup completed');
        } catch (error) {
          this.logger.error('Auto backup failed:', error);
        }
      },
      interval
    );

    this.logger.info(`Auto backup scheduled every ${this.config.backupInterval || 60} minutes`);
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    if (this.backupTimerId) {
      this.memoryManager.clearManagedInterval(this.backupTimerId);
      this.backupTimerId = undefined;
    }
    
    this.tasksCache.clear();
    this.logger.info('Task Manager destroyed');
  }
}