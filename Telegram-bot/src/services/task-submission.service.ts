import * as fs from 'fs';
import * as path from 'path';
import { Context } from 'telegraf';
import { Logger } from './logger';
import { TaskSubmission, TaskSubmissionStatus, TelegramVerificationResult } from '../types/task-submission.types';
import { Task } from '../types/task.types';
import { MongoStorage } from '../storage/implementations/mongodb-storage';
import { TaskManager } from './task-manager.service';
import { PointsService, PointEarningCategory } from '../shared';
import { writeJsonSafe, atomicOps } from '../utils/atomic-operations';
import { safeRegex } from './validation.service';
import { getTaskManagerConfig } from './task-config.service';
import { getConfig } from '../config';
import { parseDuration, hasIntervalPassed } from '../utils/time-utils';

export class TaskSubmissionService {
  private static instance: TaskSubmissionService;
  private readonly logger = Logger.getInstance();
  private readonly dataDir = path.join(process.cwd(), 'data');
  private readonly submissionsFile = path.join(this.dataDir, 'task_submissions.json');
  private readonly storage = new MongoStorage();
  private readonly taskManager = TaskManager.getInstance(getTaskManagerConfig());

  private constructor() {
    this.initializeAsync();
  }

  public static getInstance(): TaskSubmissionService {
    if (!TaskSubmissionService.instance) {
      TaskSubmissionService.instance = new TaskSubmissionService();
    }
    return TaskSubmissionService.instance;
  }

  private async initializeAsync(): Promise<void> {
    try {
      await this.ensureDataDir();
      // Run migration only after storage is fully initialized
      await this.migrateTaskCompletionStatus();
    } catch (error) {
      this.logger.error('Failed to initialize TaskSubmissionService:', error);
    }
  }

  private async ensureDataDir(): Promise<void> {
    // Initialize storage for user data management and wait for completion
    await this.storage.initialize();
  }

  private ensureFileWithStructure(filePath: string, fileName: string, expectedStructure: any): void {
    if (!fs.existsSync(filePath)) {
      // File doesn't exist, create with correct structure
      // SECURITY FIX: Use atomic write to prevent task data corruption
      const success = atomicOps.writeJsonAtomicSync(filePath, expectedStructure, {
        createBackup: true,
        spaces: 2
      });
      
      if (!success) {
        throw new Error(`Failed to atomically initialize ${fileName}`);
      }
      console.log(`Initialized ${fileName} with proper data structure`);
    } else {
      // File exists, validate structure
      try {
        const existingData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        const expectedType = Array.isArray(expectedStructure) ? 'array' : 'object';
        const actualType = Array.isArray(existingData) ? 'array' : 'object';
        
        if (expectedType !== actualType) {
          console.warn(`Data structure mismatch in ${fileName}: expected ${expectedType}, got ${actualType}. Fixing...`);
          
          // Only fix if the existing data is empty to avoid data loss
          if ((actualType === 'object' && Object.keys(existingData).length === 0) ||
              (actualType === 'array' && existingData.length === 0)) {
            // SECURITY FIX: Use atomic write to prevent task data corruption
      const success = atomicOps.writeJsonAtomicSync(filePath, expectedStructure, {
        createBackup: true,
        spaces: 2
      });
      
      if (!success) {
        throw new Error(`Failed to atomically initialize ${fileName}`);
      }
            console.log(`Fixed ${fileName}: corrected data structure from ${actualType} to ${expectedType}`);
          } else {
            console.warn(`${fileName} has existing data with wrong structure. Manual review needed.`);
          }
        }
      } catch (error) {
        console.error(`Error validating ${fileName}:`, error);
        // If file is corrupted, recreate it
        // SECURITY FIX: Use atomic write to prevent task data corruption
      const success = atomicOps.writeJsonAtomicSync(filePath, expectedStructure, {
        createBackup: true,
        spaces: 2
      });
      
      if (!success) {
        throw new Error(`Failed to atomically initialize ${fileName}`);
      }
        console.log(`Recreated corrupted ${fileName}`);
      }
    }
  }

  /**
   * Real-time Telegram verification
   */
  public async verifyTelegramMembership(ctx: Context, channelId: string): Promise<TelegramVerificationResult> {
    try {
      const userId = ctx.from?.id;
      if (!userId) {
        return {
          success: false,
          userId: '',
          channelId,
          memberStatus: 'left',
          error: 'User ID not found'
        };
      }

      const chatMember = await ctx.telegram.getChatMember(channelId, userId);
      
      const result: TelegramVerificationResult = {
        success: true,
        userId: userId.toString(),
        channelId,
        memberStatus: chatMember.status as any,
        isPremium: ctx.from?.is_premium || false
      };

      // Check if user is actually a member (not left or kicked)
      if (['member', 'administrator', 'creator'].includes(chatMember.status)) {
        result.success = true;
      } else {
        result.success = false;
        result.error = `User is ${chatMember.status}`;
      }

      this.logger.info(`Telegram verification for user ${userId}: ${result.success ? 'SUCCESS' : 'FAILED'} - ${result.memberStatus}`);
      
      return result;
    } catch (error) {
      this.logger.error('Error verifying Telegram membership:', error);
      return {
        success: false,
        userId: ctx.from?.id?.toString() || '',
        channelId,
        memberStatus: 'left',
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Submit a task for review
   */
  public async submitTask(
    userId: string, 
    username: string | undefined, 
    taskId: string, 
    submissionText: string, 
    taskConfig: Task
  ): Promise<{ success: boolean; submissionId?: string; message: string }> {
    try {
      const submissionId = `sub_${Date.now()}_${userId}`;
      
      // OPTIMIZATION FIX: Use task's own autoApprove flag instead of global config
      // because admin panel updates task directly, not the runtime config object
      const requiresSubmission = (taskConfig.validation?.submissionRequired === true) || (taskConfig.verificationMethod === 'user_submission');
      
      // Use task's validation.autoApprove flag directly (updated by admin panel)
      const autoApprove = requiresSubmission ? (taskConfig.validation?.autoApprove === true) : false;
      
      this.logger.debug('Task submission auto-approve check', {
        taskId: taskConfig.id,
        requiresSubmission,
        taskAutoApprove: taskConfig.validation?.autoApprove,
        reviewRequired: taskConfig.validation?.reviewRequired,
        finalDecision: autoApprove
      });

      const submission: TaskSubmission = {
        id: submissionId,
        userId,
        username,
        taskId,
        submissionText,
        submissionType: this.detectSubmissionType(submissionText),
        status: autoApprove ? 'approved' : 'pending',
        submittedAt: new Date().toISOString(),
        metadata: {
          submissionMethod: 'direct',
          autoValidated: autoApprove,
          reviewPriority: 'normal',
          customData: {
            taskTitle: taskConfig.title,
            taskPoints: taskConfig.points
          }
        }
      };

      // Validate submission format
      if (taskConfig.validation?.submissionPattern) {
        const regex = safeRegex(taskConfig.validation.submissionPattern);
        if (!regex) {
          this.logger.error('Invalid submission pattern in task config:', taskConfig.validation.submissionPattern);
          return {
            success: false,
            message: '❌ Task configuration error. Please contact admin.'
          };
        }
        
        if (!regex.test(submissionText)) {
          return {
            success: false,
            message: `❌ Invalid format. Expected: ${taskConfig.validation.submissionExample || 'Valid URL'}`
          };
        }
      }

      // Check for duplicate submissions in MongoDB
      const existingSubmission = await this.storage.findByQuery<TaskSubmission>('task_submissions', {
        userId,
        taskId,
        status: { $ne: 'rejected' }
      });
      
      if (existingSubmission.length > 0) {
        return {
          success: false,
          message: '❌ You have already submitted this task. Please wait for review.'
        };
      }

      if (autoApprove) {
        const user = await this.storage.getUser(userId);
        const record = {
          taskTitle: taskConfig.title,
          submissionText,
          status: 'approved' as const
        };
        if (user) {
          const history = Array.isArray(user.submissionHistory) ? user.submissionHistory : [];
          await this.storage.updateUser(userId, { submissionHistory: [...history, record] });
        }
        await this.completeTask(userId, username, taskId, taskConfig.points, 'auto_approved', submission);
        
        return {
          success: true,
          submissionId,
          message: `✅ Task completed automatically! You earned ${taskConfig.points} points!`
        };
      } else {
        await this.storage.set('task_submissions', submission, submissionId);
        const user = await this.storage.getUser(userId);
        if (user) {
          const task = await this.taskManager.getTask(taskId);
          const taskType = task?.type || taskId;
          const history = Array.isArray(user.submissionHistory) ? user.submissionHistory : [];
          const record = {
            taskTitle: task?.title || taskId,
            submissionText,
            status: 'pending' as const
          };
          await this.storage.updateUser(userId, {
            taskCompletionStatus: {
              ...user.taskCompletionStatus,
              [taskType]: 'Pending'
            },
            submissionHistory: [...history, record]
          });
        }
        
        return {
          success: true,
          submissionId,
          message: `✅ Task submitted for review! You will be notified when it's approved.`
        };
      }
    } catch (error) {
      this.logger.error('Error submitting task:', error);
      return {
        success: false,
        message: '❌ Failed to submit task. Please try again.'
      };
    }
  }

  /**
   * Complete a task
   */
  public async completeTask(
    userId: string,
    username: string | undefined,
    taskId: string,
    points: number,
    verificationMethod: string,
    submission?: TaskSubmission,
    verificationData?: any
  ): Promise<boolean> {
    try {
      // Get task information to extract task type
      const task = await this.taskManager.getTask(taskId);
      if (!task) {
        this.logger.error(`Task ${taskId} not found`);
        return false;
      }
      
      const taskType = task.type; // Use task type instead of task ID
      
      // Check if task is already completed
      const user = await this.storage.getUser(userId);
      if (!user) {
        this.logger.error(`User ${userId} not found`);
        return false;
      }

      // Check for duplicate completions
      if (task.isDaily) {
        const config = getConfig();
        const resetIntervalStr = config.task.dailyTaskResetInterval || '24h';
        const parsedInterval = parseDuration(resetIntervalStr);
        const defaultInterval = 24 * 60 * 60 * 1000;
        const resetIntervalMs = typeof parsedInterval === 'number' && parsedInterval > 0
          ? parsedInterval
          : defaultInterval;
  
        const dailyCompletions = user.dailyTasksCompleted || {};
        const completionDates = Object.keys(dailyCompletions).sort().reverse();
        const latestCompletionKey = completionDates[0];
        const lastCompletionTime = latestCompletionKey ? dailyCompletions[latestCompletionKey] : undefined;
  
        if (lastCompletionTime && !hasIntervalPassed(lastCompletionTime, resetIntervalMs)) {
          this.logger.warn(`User ${userId} attempted daily task ${taskId} before reset interval elapsed`, {
            resetInterval: resetIntervalStr,
            lastCompletionTime
          });
          return false;
        }
      } else {
        // For non-daily tasks, check permanent completion status
        if (user.taskCompletionStatus && 
            (user.taskCompletionStatus[taskId] === 'Completed' || 
             user.taskCompletionStatus[taskType] === 'Completed')) {
          this.logger.warn(`User ${userId} already completed task ${taskId} (${taskType})`);
          return false;
        }
      }

      const category = (task.isDaily && task.type === 'daily_bonus') 
        ? PointEarningCategory.DAILY_BONUS 
        : PointEarningCategory.TASK_COMPLETION;

      const award = await PointsService.awardPoints(
        userId,
        points,
        `Task completion: ${task.title}`,
        category,
        { taskId, taskType, verificationMethod, submissionId: submission?.id }
      );

      if (!award.success) {
        this.logger.error(`Failed to award points for task ${taskId} to user ${userId}`);
        return false;
      }

      // Update user's task completion status and other fields
      const updates: any = {
        tasksCompleted: (user.tasksCompleted || 0) + 1,
        lastTaskCompletedAt: new Date().toISOString()
      };

      // ✅ For non-daily tasks: update permanent completion status
      // ✅ For daily tasks: DO NOT update taskCompletionStatus (only dailyTasksCompleted)
      if (!task.isDaily) {
        updates.taskCompletionStatus = {
          ...user.taskCompletionStatus,
          [taskType]: 'Completed' // Store by task type for permanent tasks only
        };
      }

      // Handle daily tasks - record completion timestamp
          // Handle daily tasks - record completion timestamp
          if (task.isDaily) {
            const todayDate = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
            const completionTime = new Date().toISOString();
            updates.dailyTasksCompleted = {
              ...user.dailyTasksCompleted,
              [todayDate]: completionTime
            };
            
            this.logger.info(`Daily task completed - will reset based on DAILY_TASK_RESET_INTERVAL`, {
              userId,
              taskId,
              completionTime,
              resetInterval: getConfig().task.dailyTaskResetInterval
            });
          }

      // Add to completed tasks array if not already there (use task type)
      // But don't add daily tasks to permanently completed array since they can be repeated
      if (!task.isDaily && (!user.completedTasks || !user.completedTasks.includes(taskType))) {
        updates.completedTasks = [...(user.completedTasks || []), taskType];
      }

      const success = await this.storage.updateUser(userId, updates);
      
      if (success) {
        this.logger.info(`Task completed - User: ${userId}, Task: ${taskId} (${taskType}), Points: ${points}`);
        try {
          await this.storage.increment('tasks', taskId, 'completionCount', 1);
        } catch (e) {
          this.logger.error('Error incrementing task completionCount:', e);
        }
      }
      
      return success;
    } catch (error) {
      this.logger.error('Error completing task:', error);
      return false;
    }
  }

  /**
   * Admin: Review and approve/reject submission
   */
  public async reviewSubmission(
    submissionId: string, 
    action: 'approve' | 'reject', 
    reviewedBy: string, 
    notes?: string,
    pointsAwarded?: number
  ): Promise<{ success: boolean; message: string }> {
    try {
      // Get submission from MongoDB
      const submission = await this.storage.get<TaskSubmission>('task_submissions', submissionId);
      
      if (!submission) {
        return { success: false, message: 'Submission not found' };
      }

      // Update submission
      const updatedSubmission: TaskSubmission = {
        ...submission,
        status: action === 'approve' ? 'approved' : 'rejected',
        reviewedAt: new Date().toISOString(),
        reviewedBy,
        reviewNotes: notes,
        pointsAwarded: pointsAwarded || 0
      };

      const user = await this.storage.getUser(submission.userId);
      const task = await this.taskManager.getTask(submission.taskId);
      const taskType = task?.type || submission.taskId;
      const title = task?.title || submission.taskId;

      // Update minimal submissionHistory with status
      if (user) {
        const history = Array.isArray(user.submissionHistory) ? user.submissionHistory : [];
        let idx = -1;
        for (let i = history.length - 1; i >= 0; i--) {
          const r: any = history[i];
          if (r && r.taskTitle === title && r.submissionText === submission.submissionText) {
            idx = i;
            break;
          }
        }
        const statusValue = action === 'approve' ? 'approved' : 'rejected';
        if (idx >= 0) {
          history[idx] = { ...history[idx], status: statusValue };
        } else {
          history.push({ taskTitle: title, submissionText: submission.submissionText, status: statusValue });
        }
        await this.storage.updateUser(submission.userId, { submissionHistory: history });
      }

      if (action === 'approve' && pointsAwarded && pointsAwarded > 0) {
        await this.completeTask(
          submission.userId,
          submission.username,
          submission.taskId,
          pointsAwarded,
          'manual_review',
          submission
        );
      } else if (action === 'reject') {
        if (user) {
          await this.storage.updateUser(submission.userId, {
            taskCompletionStatus: {
              ...user.taskCompletionStatus,
              [taskType]: 'Rejected'
            }
          });
        }
      }

      await this.storage.delete('task_submissions', submissionId);

      this.logger.info(`Submission ${submissionId} ${action}ed by ${reviewedBy}`);
      
      return {
        success: true,
        message: `Submission ${action}ed successfully`
      };
    } catch (error) {
      this.logger.error('Error reviewing submission:', error);
      return { success: false, message: 'Failed to review submission' };
    }
  }

  /**
   * Migrate existing task completion status from task IDs to task types
   */
  public async migrateTaskCompletionStatus(): Promise<void> {
    try {
      // Check if storage is initialized (avoid accessing protected members directly)
      const storageReady = (this.storage as any)?.isInitialized === true;
      if (!storageReady) {
        this.logger.warn('Storage not initialized, skipping migration');
        return;
      }
      
      this.logger.info('Starting migration of task completion status from IDs to types...');
      
      // Get all users
      const allUsers = await this.storage.getAllUsers();
      if (!Array.isArray(allUsers)) {
        this.logger.warn('No users found or invalid users array');
        return;
      }
      
      let migratedCount = 0;
      
      for (const user of allUsers) {
        if (!user.taskCompletionStatus) continue;
        
        let needsUpdate = false;
        const newTaskCompletionStatus = { ...user.taskCompletionStatus };
        
        for (const [key, status] of Object.entries(user.taskCompletionStatus)) {
          // Check if key is a task ID (starts with 'task_') instead of a task type
          if (key.startsWith('task_')) {
            try {
              // Get task to find its type
              const task = await this.taskManager.getTask(key);
              if (task && task.type) {
                // Add the entry with task type as key
                newTaskCompletionStatus[task.type] = status;
                // Remove the old entry with task ID
                delete newTaskCompletionStatus[key];
                needsUpdate = true;
                this.logger.info(`Migrated ${key} -> ${task.type} for user ${user.telegramId}`);
              } else {
                this.logger.warn(`Task ${key} not found, keeping as is for user ${user.telegramId}`);
              }
            } catch (error) {
              this.logger.error(`Error migrating task ${key} for user ${user.telegramId}:`, error);
            }
          }
        }
        
        if (needsUpdate) {
          await this.storage.updateUser(user.telegramId, {
            taskCompletionStatus: newTaskCompletionStatus
          });
          migratedCount++;
        }
      }
      
      this.logger.info(`Migration completed. Updated ${migratedCount} users.`);
    } catch (error) {
      this.logger.error('Error during task completion status migration:', error);
    }
  }

  /**
   * Get user's task statistics
   */
  public async getUserStats(userId: string, opts?: { preloadUser?: any; includeAllSubmissions?: boolean }): Promise<any> {
    try {
      const user = opts?.preloadUser || await this.storage.getUser(userId);
      if (!user) {
        return {
          userId,
          totalTasksCompleted: 0,
          totalPointsEarned: 0,
          completedTasks: [],
          taskCompletionStatus: {},
          submissions: [],
          pendingSubmissions: [],
          failedTasks: [],
          dailyCheckInStreak: 0,
          referralCount: 0,
          isPremiumMember: false,
          joinedChannels: []
        };
      }

      // Fetch submissions once and derive pending from it
      const subs = await this.getUserSubmissions(userId);

      // Get last daily check-in from dailyTasksCompleted
      const dailyTasks = user.dailyTasksCompleted || {};
      const lastCheckIn = Object.values(dailyTasks).length > 0 ? 
        Object.values(dailyTasks).sort().pop() : null;

      const stats: any = {
        userId,
        totalTasksCompleted: user.tasksCompleted || 0,
        totalPointsEarned: user.points || 0,
        completedTasks: user.completedTasks || [],
        taskCompletionStatus: user.taskCompletionStatus || {},
        pendingSubmissions: subs.filter(s => s.status === 'pending'),
        failedTasks: Object.entries(user.taskCompletionStatus || {}).filter(([_, status]) => status === 'Rejected').map(([taskId, _]) => taskId),
        dailyCheckInStreak: Object.keys(dailyTasks).length,
        lastCheckIn: lastCheckIn,
        dailyTasksCompleted: dailyTasks,
        referralCount: user.totalReferrals || 0,
        isPremiumMember: user.isPremium || false,
        joinedChannels: []
      };

      if (opts?.includeAllSubmissions) {
        stats.submissions = subs;
      }

      return stats;
    } catch (error) {
      this.logger.error('Error getting user stats:', error);
      return null;
    }
  }

  /**
   * Check if user has completed a task
   */
      public async hasUserCompletedTask(userId: string, taskId: string): Promise<boolean> {
        try {
          const user = await this.storage.getUser(userId);
          if (!user) return false;
          
          // Get task information to check by task type as well
          const task = await this.taskManager.getTask(taskId);
          if (!task) return false;
          
          // ✅ For daily tasks: Check if reset interval has passed
          if (task.isDaily) {
            const config = getConfig();
            const resetIntervalStr = config.task.dailyTaskResetInterval || '24h';
            let resetIntervalMs = parseDuration(resetIntervalStr);
  
            if (!resetIntervalMs || resetIntervalMs <= 0) {
              this.logger.warn(`Invalid DAILY_TASK_RESET_INTERVAL: ${resetIntervalStr}, using 24h`);
              resetIntervalMs = 24 * 60 * 60 * 1000;
            }
            
            // Get last completion time from dailyTasksCompleted
            // Format: { 'YYYY-MM-DD': 'ISO timestamp' } or just check most recent
            const dailyCompletions = user.dailyTasksCompleted || {};
            const completionDates = Object.keys(dailyCompletions).sort().reverse();
            
            if (completionDates.length === 0) {
              return false; // Never completed
            }
            
            // Get the most recent completion timestamp
            const lastDate = completionDates[0];
            const lastCompletionTime = dailyCompletions[lastDate];
            
            // Check if the reset interval has passed
            return !hasIntervalPassed(lastCompletionTime, resetIntervalMs);
          }
          
          // ✅ For non-daily tasks: check permanent completion status
          return user.taskCompletionStatus && 
                 (user.taskCompletionStatus[taskId] === 'Completed' || 
                  user.taskCompletionStatus[task.type] === 'Completed');
        } catch (error) {
          this.logger.error('Error checking task completion:', error);
          return false;
        }
      }

  /**
   * Get pending submissions for admin review
   */
  public async getPendingSubmissions(): Promise<TaskSubmission[]> {
    try {
      return await this.storage.findByQuery<TaskSubmission>('task_submissions', {
        status: { $in: ['pending', 'under_review'] }
      });
    } catch (error) {
      this.logger.error('Error getting pending submissions:', error);
      return [];
    }
  }

  /**
   * Get all submissions by user
   */
  public async getUserSubmissions(userId: string): Promise<TaskSubmission[]> {
    try {
      return await this.storage.findByQuery<TaskSubmission>('task_submissions', { userId });
    } catch (error) {
      this.logger.error('Error getting user submissions:', error);
      return [];
    }
  }

  public async getSubmissionById(submissionId: string): Promise<TaskSubmission | null> {
    try {
      return await this.storage.get<TaskSubmission>('task_submissions', submissionId);
    } catch (error) {
      this.logger.error('Error getting submission by id:', error);
      return null;
    }
  }

  // Private helper methods
  private detectSubmissionType(text: string): 'text' | 'url' | 'screenshot' | 'video' | 'other' {
    if (text.match(/^https?:\/\//)) {
      return 'url';
    }
    return 'text';
  }
}