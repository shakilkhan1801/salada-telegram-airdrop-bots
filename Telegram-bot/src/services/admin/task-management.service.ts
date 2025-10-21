import { Context } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { ITaskManagementService, IAdminAuthorizationService, IAdminUIService } from '../../interfaces/admin-services.interface';
import { Logger } from '../logger';
import { StorageManager } from '../../storage';
import { Task, TaskSubmission } from '../../types';
import { TaskManager } from '../task-manager.service';
import { TaskSubmissionService } from '../task-submission.service';
import { getTaskManagerConfig } from '../task-config.service';

/**
 * Service for task management operations
 */
export class TaskManagementService implements ITaskManagementService {
  private readonly logger = Logger.getInstance();
  private readonly storage = StorageManager.getInstance();
  private readonly taskManager: TaskManager;
  private readonly submissionService = TaskSubmissionService.getInstance();
  
  constructor(
    private authService: IAdminAuthorizationService,
    private uiService: IAdminUIService
  ) {
    const taskConfig = getTaskManagerConfig();
    this.taskManager = TaskManager.getInstance(taskConfig);
  }

  /**
   * Show task management interface
   */
  async showTaskManagement(ctx: Context): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx))) {
        return;
      }

      const taskStats = await this.getTaskManagementStats();
      const managementText = this.getTaskManagementText(taskStats);
      const keyboard = this.uiService.getTaskManagementKeyboard();

      if (ctx.callbackQuery) {
        await ctx.editMessageText(managementText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      } else {
        await ctx.reply(managementText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      }
    } catch (error) {
      this.logger.error('Error showing task management:', error);
      await ctx.reply('❌ Error loading task management interface.');
    }
  }

  /**
   * Create new task (guided creation)
   */
  async createTask(ctx: Context): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx))) {
        return;
      }

      await ctx.reply(`
🆕 <b>Create New Task</b>

To create a new task, please provide the following information:

📝 <b>Task Title:</b> A clear, descriptive title
📄 <b>Description:</b> Detailed instructions for users
🏷️ <b>Category:</b> Task category (e.g., social, survey, referral)
💰 <b>Points:</b> Points reward for completion
🎯 <b>Type:</b> Task type (one_time, daily, permanent)
📋 <b>Submission Required:</b> Whether users need to submit proof

<b>Example Format:</b>
<code>/create_task
Title: Follow our Twitter account
Description: Follow @BotTwitter and submit your username
Category: social
Points: 50
Type: one_time
Requires Submission: yes
Instructions: Submit your Twitter username after following</code>

Use the format above or contact a super admin to create tasks through the web panel.
      `, { parse_mode: 'HTML' });

    } catch (error) {
      this.logger.error('Error in createTask:', error);
      await ctx.reply('❌ Error initiating task creation. Please try again.');
    }
  }

  /**
   * Edit existing task
   */
  async editTask(ctx: Context, taskId: string): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx))) {
        return;
      }

      const task = await this.taskManager.getTask(taskId);
      if (!task) {
        await ctx.reply('❌ Task not found.');
        return;
      }

      const taskInfo = this.uiService.formatTaskInfo(task);
      const keyboard = this.uiService.getTaskActionKeyboard(taskId);

      if (ctx.callbackQuery) {
        await ctx.editMessageText(`
📝 <b>Edit Task</b>

${taskInfo}

Choose an action to edit this task:
        `, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      } else {
        await ctx.reply(`
📝 <b>Edit Task</b>

${taskInfo}

Choose an action to edit this task:
        `, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      }
    } catch (error) {
      this.logger.error('Error in editTask:', error);
      await ctx.reply('❌ Error loading task details. Please try again.');
    }
  }

  /**
   * Delete task
   */
  async deleteTask(ctx: Context, taskId: string): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx, true))) { // Require super admin
        return;
      }

      const task = await this.taskManager.getTask(taskId);
      if (!task) {
        await ctx.reply('❌ Task not found.');
        return;
      }

      // Check if task has submissions
      const submissions = await this.getTaskSubmissions(taskId);
      if (submissions.length > 0) {
        await ctx.reply(`
⚠️ <b>Warning</b>

This task has ${submissions.length} submissions. Deleting it will affect user records and statistics.

Are you sure you want to delete task "${task.title}"?

This action cannot be undone.
        `, { parse_mode: 'HTML' });
        return;
      }

      // Soft delete by marking as deleted
      const updates: Partial<Task> & { isDeleted?: boolean; deletedAt?: string; deletedBy?: string } = {
        isActive: false,
        isDeleted: true,
        deletedAt: new Date().toISOString(),
        deletedBy: ctx.from?.id?.toString(),
        updatedAt: new Date().toISOString()
      };

      await this.storage.update('tasks', updates, taskId);

      // Log the deletion action
      await this.logAdminAction(ctx, taskId, 'task_deleted', {
        title: task.title,
        deletedAt: updates.deletedAt,
        deletedBy: updates.deletedBy
      });

      await ctx.reply(`✅ Task "${task.title}" has been deleted.\n⚠️ This action is permanent and cannot be undone.`);
      
      this.logger.info(`Task ${taskId} deleted by admin ${ctx.from?.id}`);
    } catch (error) {
      this.logger.error('Error deleting task:', error);
      await ctx.reply('❌ Error deleting task. Please try again.');
    }
  }

  /**
   * Toggle task active status
   */
  async toggleTaskStatus(ctx: Context, taskId: string): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx))) {
        return;
      }

      const task = await this.taskManager.getTask(taskId);
      if (!task) {
        await ctx.reply('❌ Task not found.');
        return;
      }

      const newStatus = !task.isActive;
      const updates: Partial<Task> = {
        isActive: newStatus,
        updatedAt: new Date().toISOString()
      };

      await this.storage.update('tasks', updates, taskId);

      // Log the status change
      await this.logAdminAction(ctx, taskId, 'task_status_changed', {
        title: task.title,
        previousStatus: task.isActive,
        newStatus,
        changedAt: updates.updatedAt
      });

      const statusText = newStatus ? 'activated' : 'deactivated';
      await ctx.reply(`✅ Task "${task.title}" has been ${statusText}.`);
      
      this.logger.info(`Task ${taskId} ${statusText} by admin ${ctx.from?.id}`);
    } catch (error) {
      this.logger.error('Error toggling task status:', error);
      await ctx.reply('❌ Error updating task status. Please try again.');
    }
  }

  /**
   * Show task submissions
   */
  async showTaskSubmissions(ctx: Context, taskId?: string): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx))) {
        return;
      }

      let submissions: TaskSubmission[];
      let headerText: string;

      if (taskId) {
        submissions = await this.getTaskSubmissions(taskId);
        const task = await this.taskManager.getTask(taskId);
        headerText = `📋 <b>Submissions for "${task?.title || 'Unknown Task'}"</b>`;
      } else {
        submissions = await this.getAllPendingSubmissions();
        headerText = `📋 <b>All Pending Submissions</b>`;
      }

      if (submissions.length === 0) {
        await ctx.reply('✅ No submissions to review!');
        return;
      }

      const submissionsText = await this.buildSubmissionsText(submissions, headerText);
      const keyboard = this.buildSubmissionsKeyboard(submissions.slice(0, 10)); // Show first 10

      if (ctx.callbackQuery) {
        await ctx.editMessageText(submissionsText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      } else {
        await ctx.reply(submissionsText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      }
    } catch (error) {
      this.logger.error('Error showing task submissions:', error);
      await ctx.reply('❌ Error loading submissions. Please try again.');
    }
  }

  /**
   * Approve submission
   */
  async approveSubmission(ctx: Context, submissionId: string): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx))) {
        return;
      }

      const submission = await this.getSubmissionById(submissionId);
      if (!submission) {
        await ctx.reply('❌ Submission not found.');
        return;
      }

      if (submission.status !== 'pending') {
        await ctx.reply(`⚠️ Submission is already ${submission.status}.`);
        return;
      }

      // Get task details for points
      const task = await this.taskManager.getTask(submission.taskId);
      const points = task?.points || 0;

      // Approve the submission via reviewSubmission and award points
      const adminId = ctx.from?.id?.toString() || 'admin';
      await this.submissionService.reviewSubmission(submissionId, 'approve', adminId, undefined, points);

      await ctx.reply(`✅ Submission approved!\n👤 User: ${submission.userId}\n💰 Points awarded: ${points}`);
      
      this.logger.info(`Submission ${submissionId} approved by admin ${ctx.from?.id}`);
    } catch (error) {
      this.logger.error('Error approving submission:', error);
      await ctx.reply('❌ Error approving submission. Please try again.');
    }
  }

  /**
   * Reject submission
   */
  async rejectSubmission(ctx: Context, submissionId: string, reason?: string): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx))) {
        return;
      }

      const submission = await this.getSubmissionById(submissionId);
      if (!submission) {
        await ctx.reply('❌ Submission not found.');
        return;
      }

      if (submission.status !== 'pending') {
        await ctx.reply(`⚠️ Submission is already ${submission.status}.`);
        return;
      }

      // Reject the submission via reviewSubmission
      const adminId = ctx.from?.id?.toString() || 'admin';
      await this.submissionService.reviewSubmission(submissionId, 'reject', adminId, reason || 'Submission did not meet requirements');

      await ctx.reply(`❌ Submission rejected.\n👤 User: ${submission.userId}\n📝 Reason: ${reason || 'Did not meet requirements'}`);
      
      this.logger.info(`Submission ${submissionId} rejected by admin ${ctx.from?.id}`, { reason });
    } catch (error) {
      this.logger.error('Error rejecting submission:', error);
      await ctx.reply('❌ Error rejecting submission. Please try again.');
    }
  }

  /**
   * Get task analytics
   */
  async getTaskAnalytics(ctx: Context): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx))) {
        return;
      }

      await ctx.reply('📊 Generating task analytics... This may take a moment.');

      const analytics = await this.generateTaskAnalytics();
      const analyticsText = this.buildAnalyticsText(analytics);

      await ctx.reply(analyticsText, { parse_mode: 'HTML' });
      
      this.logger.info(`Task analytics generated by admin ${ctx.from?.id}`);
    } catch (error) {
      this.logger.error('Error getting task analytics:', error);
      await ctx.reply('❌ Error generating analytics. Please try again.');
    }
  }

  // Private helper methods

  private async getTaskManagementStats(): Promise<any> {
    try {
      const tasks = await this.storage.getAllTasks();
      const submissions = await this.storage.getAllTaskSubmissions();

      const activeTasks = tasks.filter(task => task.isActive).length;
      const inactiveTasks = tasks.filter(task => !task.isActive).length;
      const dailyTasks = tasks.filter(task => task.isDaily).length;
      const oneTimeTasks = tasks.filter(task => !task.isDaily && task.isPermanent !== true).length;

      const pendingSubmissions = submissions.filter(sub => sub.status === 'pending').length;
      const approvedSubmissions = submissions.filter(sub => sub.status === 'approved').length;
      const rejectedSubmissions = submissions.filter(sub => sub.status === 'rejected').length;

      const totalPointsAwarded = submissions
        .filter(sub => sub.status === 'approved')
        .reduce((sum, sub) => sum + (sub.pointsAwarded || 0), 0);

      const avgPointsPerTask = tasks.length > 0 ? 
        Math.round(tasks.reduce((sum, task) => sum + task.points, 0) / tasks.length) : 0;

      const topTasks = tasks
        .sort((a, b) => (b.completionCount || 0) - (a.completionCount || 0))
        .slice(0, 5);

      return {
        tasks: {
          total: tasks.length,
          active: activeTasks,
          inactive: inactiveTasks,
          daily: dailyTasks,
          oneTime: oneTimeTasks,
          avgPoints: avgPointsPerTask
        },
        submissions: {
          pending: pendingSubmissions,
          approved: approvedSubmissions,
          rejected: rejectedSubmissions,
          total: submissions.length,
          approvalRate: submissions.length > 0 ? 
            Math.round((approvedSubmissions / submissions.length) * 100) : 0
        },
        points: {
          totalAwarded: totalPointsAwarded
        },
        topTasks
      };
    } catch (error) {
      this.logger.error('Error getting task management stats:', error);
      return {};
    }
  }

  private getTaskManagementText(stats: any): string {
    return `
🎯 <b>Task Management</b>

📊 <b>Task Overview:</b>
• Total Tasks: <b>${stats.tasks?.total || 0}</b>
• Active Tasks: <b>${stats.tasks?.active || 0}</b>
• Inactive Tasks: <b>${stats.tasks?.inactive || 0}</b>
• Daily Tasks: <b>${stats.tasks?.daily || 0}</b>
• One-time Tasks: <b>${stats.tasks?.oneTime || 0}</b>
• Average Points: <b>${stats.tasks?.avgPoints || 0}</b>

📋 <b>Submissions:</b>
• Pending Review: <b>${stats.submissions?.pending || 0}</b>
• Approved: <b>${stats.submissions?.approved || 0}</b>
• Rejected: <b>${stats.submissions?.rejected || 0}</b>
• Total Submissions: <b>${stats.submissions?.total || 0}</b>
• Approval Rate: <b>${stats.submissions?.approvalRate || 0}%</b>

💰 <b>Points Awarded:</b> <b>${stats.points?.totalAwarded?.toLocaleString() || 0}</b>

🏆 <b>Top Completed Tasks:</b>
${stats.topTasks?.map((task: any, index: number) => 
  `${index + 1}. ${task.title} - ${task.completionCount || 0} completions`
).join('\n') || 'No completed tasks'}

🛠️ <b>Management Actions:</b>
• Create, edit, and manage tasks
• Review and process submissions
• View detailed analytics and reports
• Control task activation and scheduling
    `.trim();
  }

  private async getTaskSubmissions(taskId: string): Promise<TaskSubmission[]> {
    try {
      const allSubmissions = await this.storage.getAllTaskSubmissions();
      return allSubmissions.filter(sub => sub.taskId === taskId);
    } catch (error) {
      this.logger.error('Error getting task submissions:', error);
      return [];
    }
  }

  private async getAllPendingSubmissions(): Promise<TaskSubmission[]> {
    try {
      const allSubmissions = await this.storage.getAllTaskSubmissions();
      return allSubmissions.filter(sub => sub.status === 'pending');
    } catch (error) {
      this.logger.error('Error getting pending submissions:', error);
      return [];
    }
  }

  private async getSubmissionById(submissionId: string): Promise<TaskSubmission | null> {
    try {
      return await this.storage.get('task_submissions', submissionId);
    } catch (error) {
      this.logger.error('Error getting submission by ID:', error);
      return null;
    }
  }

  private async buildSubmissionsText(submissions: TaskSubmission[], headerText: string): Promise<string> {
    let text = `${headerText} (${submissions.length})\n\n`;
    
    for (const submission of submissions.slice(0, 10)) {
      const task = await this.taskManager.getTask(submission.taskId);
      const taskTitle = task?.title || 'Unknown Task';
      
      text += `🔸 <b>ID:</b> ${submission.id}\n`;
      text += `👤 <b>User:</b> ${submission.userId}\n`;
      text += `📝 <b>Task:</b> ${taskTitle}\n`;
      text += `💰 <b>Points:</b> ${task?.points || 0}\n`;
      text += `📄 <b>Submission:</b> ${submission.submissionText?.substring(0, 100)}${submission.submissionText && submission.submissionText.length > 100 ? '...' : ''}\n`;
      text += `📅 <b>Submitted:</b> ${new Date(submission.submittedAt).toLocaleString()}\n`;
      text += `📊 <b>Status:</b> ${submission.status}\n\n`;
      text += `▫️▫️▫️▫️▫️▫️▫️▫️▫️▫️\n\n`;
    }

    if (submissions.length > 10) {
      text += `<i>... and ${submissions.length - 10} more submissions</i>\n\n`;
    }

    return text.trim();
  }

  private buildSubmissionsKeyboard(submissions: TaskSubmission[]): InlineKeyboardMarkup {
    const keyboard = [];
    
    // Submission action buttons
    for (const submission of submissions.slice(0, 5)) {
      if (submission.status === 'pending') {
        keyboard.push([
          {
            text: `✅ Approve ${submission.id.substring(0, 8)}`,
            callback_data: `admin_approve_${submission.id}`
          },
          {
            text: `❌ Reject ${submission.id.substring(0, 8)}`,
            callback_data: `admin_reject_${submission.id}`
          }
        ]);
      }
    }

    // Navigation buttons
    keyboard.push([
      {
        text: 'Analytics',
        callback_data: 'admin_task_analytics'
      },
      {
        text: 'Back',
        callback_data: 'admin_tasks'
      }
    ]);

    return { inline_keyboard: keyboard };
  }

  private async generateTaskAnalytics(): Promise<any> {
    try {
      const tasks = await this.storage.getAllTasks();
      const submissions = await this.storage.getAllTaskSubmissions();
      const users = await this.storage.getAllUsers();

      // Category breakdown
      const categoryStats = tasks.reduce((acc: any, task) => {
        const category = task.category || 'uncategorized';
        if (!acc[category]) {
          acc[category] = { count: 0, totalPoints: 0, submissions: 0, completions: 0 };
        }
        acc[category].count++;
        acc[category].totalPoints += task.points;
        acc[category].submissions += submissions.filter(sub => sub.taskId === task.id).length;
        acc[category].completions += task.completionCount || 0;
        return acc;
      }, {});

      // Time-based analysis
      const last7Days = new Date();
      last7Days.setDate(last7Days.getDate() - 7);
      const recentSubmissions = submissions.filter(sub => new Date(sub.submittedAt) >= last7Days);
      
      // User engagement
      const activeUsers = users.filter(user => {
        const hasRecentSubmission = recentSubmissions.some(sub => sub.userId === user.telegramId);
        return hasRecentSubmission;
      }).length;

      // Performance metrics
      const avgTimeToApproval = this.calculateAverageApprovalTime(submissions);
      
      return {
        categories: categoryStats,
        recentActivity: {
          submissionsLast7Days: recentSubmissions.length,
          activeUsers,
          avgTimeToApproval
        },
        performance: {
          totalCompletions: tasks.reduce((sum, task) => sum + (task.completionCount || 0), 0),
          completionRate: this.calculateCompletionRate(tasks, users),
          topPerformers: this.getTopPerformingTasks(tasks)
        }
      };
    } catch (error) {
      this.logger.error('Error generating task analytics:', error);
      return {};
    }
  }

  private buildAnalyticsText(analytics: any): string {
    const categories = Object.entries(analytics.categories || {});
    const categoryText = categories.map(([cat, data]: [string, any]) => 
      `• ${cat}: ${data.count} tasks, ${data.completions} completions`
    ).join('\n');

    return `
📊 <b>Task Analytics Report</b>

🏷️ <b>Category Breakdown:</b>
${categoryText || 'No categories found'}

📈 <b>Recent Activity (7 days):</b>
• New Submissions: <b>${analytics.recentActivity?.submissionsLast7Days || 0}</b>
• Active Users: <b>${analytics.recentActivity?.activeUsers || 0}</b>
• Avg. Approval Time: <b>${analytics.recentActivity?.avgTimeToApproval || 'N/A'}</b>

🎯 <b>Performance Metrics:</b>
• Total Completions: <b>${analytics.performance?.totalCompletions || 0}</b>
• Task Completion Rate: <b>${analytics.performance?.completionRate || 0}%</b>

🏆 <b>Top Performing Tasks:</b>
${analytics.performance?.topPerformers?.map((task: any, index: number) => 
  `${index + 1}. ${task.title} - ${task.completionCount} completions`
).join('\n') || 'No completed tasks'}

<i>Report generated on ${new Date().toLocaleString()}</i>
    `.trim();
  }

  private calculateAverageApprovalTime(submissions: TaskSubmission[]): string {
    const approvedSubmissions = submissions.filter(sub => 
      sub.status === 'approved' && sub.reviewedAt && sub.submittedAt
    );

    if (approvedSubmissions.length === 0) return 'N/A';

    const totalTime = approvedSubmissions.reduce((sum, sub) => {
      const submittedTime = new Date(sub.submittedAt).getTime();
      const approvedTime = new Date(sub.reviewedAt!).getTime();
      return sum + (approvedTime - submittedTime);
    }, 0);

    const avgTime = totalTime / approvedSubmissions.length;
    const hours = Math.round(avgTime / (1000 * 60 * 60));
    
    return hours < 24 ? `${hours} hours` : `${Math.round(hours / 24)} days`;
  }

  private calculateCompletionRate(tasks: Task[], users: any[]): number {
    if (tasks.length === 0 || users.length === 0) return 0;
    
    const totalPossibleCompletions = tasks.length * users.length;
    const actualCompletions = tasks.reduce((sum, task) => sum + (task.completionCount || 0), 0);
    
    return Math.round((actualCompletions / totalPossibleCompletions) * 100);
  }

  private getTopPerformingTasks(tasks: Task[]): any[] {
    return tasks
      .filter(task => task.completionCount && task.completionCount > 0)
      .sort((a, b) => (b.completionCount || 0) - (a.completionCount || 0))
      .slice(0, 5);
  }

  private async logAdminAction(ctx: Context, taskId: string, action: string, metadata: any): Promise<void> {
    try {
      const adminId = ctx.from?.id?.toString();
      if (!adminId) return;

      const logEntry = {
        id: `admin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        adminId,
        targetTaskId: taskId,
        action,
        metadata,
        timestamp: new Date().toISOString()
      };

      const adminLogs: Record<string, any> = (await this.storage.get('admin_actions')) || {};
      adminLogs[logEntry.id] = logEntry;
      await this.storage.set('admin_actions', adminLogs);
    } catch (error) {
      this.logger.error('Error logging admin action:', error);
    }
  }
}