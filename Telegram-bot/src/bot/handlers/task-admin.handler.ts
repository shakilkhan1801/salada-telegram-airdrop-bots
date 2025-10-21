import { Context } from 'telegraf';
import { TaskSubmissionService } from '../../services/task-submission.service';
import { TaskManager } from '../../services/task-manager.service';
import { getTaskManagerConfig } from '../../services/task-config.service';
import { Logger } from '../../services/logger';
import { safeRegex } from '../../services/validation.service';
import { CallbackManager } from '../../utils/callback-manager';

export class TaskAdminHandler {
  private readonly submissionService = TaskSubmissionService.getInstance();
  private readonly logger = Logger.getInstance();
  private taskManager: TaskManager;

  constructor() {
    const taskConfig = getTaskManagerConfig();
    this.taskManager = TaskManager.getInstance(taskConfig);
  }

  /**
   * Show pending task submissions for admin review
   */
  async showPendingSubmissions(ctx: Context): Promise<void> {
    try {
      // Note: Permission check is handled by AdminHandler before calling this method
      
      const pendingSubmissions = await this.submissionService.getPendingSubmissions();
      
      if (pendingSubmissions.length === 0) {
        await ctx.reply('✅ No pending submissions to review!', { link_preview_options: { is_disabled: true } });
        return;
      }

      let text = `📋 <b>Pending Task Submissions (${pendingSubmissions.length})</b>\n\n`;
      
      for (const submission of pendingSubmissions.slice(0, 10)) { // Show max 10
        const task = await this.taskManager.getTask(submission.taskId);
        const taskTitle = task?.title || 'Unknown Task';
        
        text += `🔸 <b>Submission ID:</b> ${submission.id}\n`;
        text += `👤 <b>User:</b> @${submission.username || 'N/A'} (${submission.userId})\n`;
        text += `📝 <b>Task:</b> ${taskTitle}\n`;
        text += `💰 <b>Points:</b> ${task?.points || 0}\n`;
        text += `📄 <b>Submission:</b> ${submission.submissionText}\n`;
        text += `📅 <b>Submitted:</b> ${new Date(submission.submittedAt).toLocaleString()}\n`;
        text += `📊 <b>Status:</b> ${submission.status}\n\n`;
        text += `▫️▫️▫️▫️▫️▫️▫️▫️▫️▫️\n\n`;
      }

      if (pendingSubmissions.length > 10) {
        text += `<i>... and ${pendingSubmissions.length - 10} more submissions</i>\n\n`;
      }

      text += '🔽 <b>Commands to review submissions:</b>\n';
      text += '<code>/approve [submission_id] [points] [notes]</code>\n';
      text += '<code>/reject [submission_id] [notes]</code>\n\n';
      text += '<i>Example: /approve sub_1234567890_123456789 75 Verified Twitter follow</i>';

      await ctx.reply(text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });

    } catch (error) {
      this.logger.error('Error showing pending submissions:', error);
      await ctx.reply('❌ Error loading pending submissions.', { link_preview_options: { is_disabled: true } });
    }
  }

  /**
   * Approve a task submission (simplified)
   */
  async approveSubmission(ctx: Context, args: string[]): Promise<void> {
    try {
      // Note: Permission check is handled by AdminHandler before calling this method
      const userId = ctx.from?.id?.toString();
      
      if (args.length < 1) {
        await ctx.reply('❌ Usage: /approve [submission_id]', { link_preview_options: { is_disabled: true } });
        return;
      }

      if (!userId) {
        await ctx.reply('❌ Unable to identify admin user.', { link_preview_options: { is_disabled: true } });
        return;
      }

      const submissionId = args[0];
      const optionalNotes = args.slice(1).join(' ') || 'Approved by admin';

      const submission = await this.submissionService.getSubmissionById(submissionId) ||
                         await this.submissionService.getPendingSubmissions().then(pending =>
                           pending.find(s => s.id === submissionId));
      
      if (!submission) {
        await ctx.reply('❌ Submission not found.');
        return;
      }

      const task = await this.taskManager.getTask(submission.taskId);
      if (!task) {
        await ctx.reply('❌ Task not found.', { link_preview_options: { is_disabled: true } });
        return;
      }

      // Auto-use task points (no need to specify)
      const points = task.points;

      const result = await this.submissionService.reviewSubmission(
        submissionId,
        'approve',
        userId,
        optionalNotes,
        points
      );

      if (result.success) {
        await ctx.reply(
          `✅ <b>Approved!</b>\n\n` +
          `📝 Submission: ${submissionId}\n` +
          `👤 User: @${submission.username}\n` +
          `💰 Points: ${points}\n` +
          `📋 Task: ${task.title}`,
          { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
        );
        
        this.logger.info(`Quick approval: ${submissionId} by admin ${userId} for ${points} points`);
      } else {
        await ctx.reply(`❌ Failed: ${result.message}`);
      }

    } catch (error) {
      this.logger.error('Error in quick approval:', error);
      await ctx.reply('❌ Error processing approval.', { link_preview_options: { is_disabled: true } });
    }
  }

  /**
   * Reject a task submission (simplified)
   */
  async rejectSubmission(ctx: Context, args: string[]): Promise<void> {
    try {
      // Note: Permission check is handled by AdminHandler before calling this method
      const userId = ctx.from?.id?.toString();
      
      if (args.length < 1) {
        await ctx.reply('❌ Usage: /reject [submission_id]', { link_preview_options: { is_disabled: true } });
        return;
      }

      if (!userId) {
        await ctx.reply('❌ Unable to identify admin user.', { link_preview_options: { is_disabled: true } });
        return;
      }

      const submissionId = args[0];
      const optionalReason = args.slice(1).join(' ') || 'Does not meet requirements';

      const submission = await this.submissionService.getSubmissionById(submissionId) ||
                         await this.submissionService.getPendingSubmissions().then(pending =>
                           pending.find(s => s.id === submissionId));
      
      if (!submission) {
        await ctx.reply('❌ Submission not found.');
        return;
      }

      const task = await this.taskManager.getTask(submission.taskId);
      const taskTitle = task?.title || submission.taskId;

      const result = await this.submissionService.reviewSubmission(
        submissionId,
        'reject',
        userId,
        optionalReason
      );

      if (result.success) {
        await ctx.reply(
          `❌ <b>Rejected</b>\n\n` +
          `📝 Submission: ${submissionId}\n` +
          `👤 User: @${submission.username}\n` +
          `📋 Task: ${taskTitle}\n` +
          `💬 Reason: ${optionalReason}`,
          { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }
        );
        
        this.logger.info(`Quick rejection: ${submissionId} by admin ${userId}`);
      } else {
        await ctx.reply(`❌ Failed: ${result.message}`);
      }

    } catch (error) {
      this.logger.error('Error in quick rejection:', error);
      await ctx.reply('❌ Error processing rejection.', { link_preview_options: { is_disabled: true } });
    }
  }

  /**
   * Show quick review interface for large scale operations
   */
  async showQuickReview(ctx: Context, submissionIndex: number = 0): Promise<void> {
    try {
      // Note: Permission check is handled by AdminHandler before calling this method
      
      const pendingSubmissions = await this.submissionService.getPendingSubmissions();
      
      if (pendingSubmissions.length === 0) {
        const noSubmissionsText = '✅ <b>No pending submissions!</b>\n\nAll task submissions have been reviewed.';
        
        if (ctx.callbackQuery) {
          await ctx.editMessageText(noSubmissionsText, {
            reply_markup: {
              inline_keyboard: [[
                { text: 'Back to Tasks', callback_data: 'admin_tasks' }
              ]]
            },
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true }
          });
        } else {
        await ctx.reply(noSubmissionsText, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
        }
        return;
      }

      // Handle index bounds
      if (submissionIndex >= pendingSubmissions.length) {
        submissionIndex = 0; // Loop back to first
      }
      if (submissionIndex < 0) {
        submissionIndex = pendingSubmissions.length - 1; // Go to last
      }

      // Show submission at specified index
      const submission = pendingSubmissions[submissionIndex];
      const task = await this.taskManager.getTask(submission.taskId);
      const submittedDate = new Date(submission.submittedAt);
      
      let text = `🔍 <b>Quick Review</b> (${pendingSubmissions.length} pending)\n\n`;
      text += `📝 <b>ID:</b> <code>${submission.id}</code>\n`;
      text += `👤 <b>User:</b> @${submission.username || 'N/A'}\n`;
      text += `📋 <b>Task:</b> ${task?.title || submission.taskId}\n`;
      text += `💰 <b>Points:</b> ${task?.points || 0}\n`;
      text += `📄 <b>Submission:</b> ${submission.submissionText}\n`;
      text += `📅 <b>Date:</b> ${submittedDate.toLocaleDateString()}\n\n`;
      
      // Validation check
      if (task?.validation?.submissionPattern) {
        const regex = safeRegex(task.validation.submissionPattern);
        if (regex) {
          const isValid = regex.test(submission.submissionText);
          text += `🔍 <b>Format:</b> ${isValid ? '✅ Valid' : '❌ Invalid'}\n\n`;
        } else {
          text += `🔍 <b>Format:</b> ⚠️ Invalid pattern\n\n`;
        }
      }
      
      text += `⚡ <b>Quick Actions:</b>\nUse buttons below or:\n`;
      text += `<code>/approve ${submission.id}</code>\n`;
      text += `<code>/reject ${submission.id}</code>`;

      // Add position indicator and timestamp to make content unique
      const currentTime = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      text += `\n\n📍 <b>Position:</b> ${submissionIndex + 1}/${pendingSubmissions.length} | 🕐 ${currentTime}`;

      const keyboard = CallbackManager.createKeyboard([
        [
          { text: 'APPROVE', action: 'admin_quick_approve', params: { submissionId: submission.id, index: submissionIndex } },
          { text: 'REJECT', action: 'admin_quick_reject', params: { submissionId: submission.id, index: submissionIndex } }
        ],
        [
          { text: 'PREV', action: 'admin_quick_review_prev', params: { index: submissionIndex } },
          { text: 'NEXT', action: 'admin_quick_review_next', params: { index: submissionIndex } }
        ],
        [
          { text: 'STATS', action: 'admin_task_analytics' },
          { text: 'REFRESH', action: 'admin_quick_review', params: { index: submissionIndex } }
        ],
        [
          { text: 'BACK', action: 'admin_tasks' }
        ]
      ]);

      if (ctx.callbackQuery) {
        try {
          await ctx.editMessageText(text, {
            reply_markup: keyboard,
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true }
          });
        } catch (editError: any) {
          // If edit fails due to identical content, force refresh with slight modification
          if (editError.description?.includes('message is not modified')) {
            this.logger.warn('Identical content detected, forcing refresh...');
            const refreshedText = text + `\n\n🔄 <i>Refreshed at ${new Date().toLocaleTimeString()}</i>`;
          await ctx.editMessageText(refreshedText, {
              reply_markup: keyboard,
              parse_mode: 'HTML',
              link_preview_options: { is_disabled: true }
            });
          } else {
            throw editError;
          }
        }
      } else {
        await ctx.reply(text, {
          reply_markup: keyboard,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true }
        });
      }

    } catch (error) {
      this.logger.error('Error showing quick review:', error);
      await ctx.reply('❌ Error loading quick review.', { link_preview_options: { is_disabled: true } });
    }
  }

  /**
   * Show task statistics for admin
   */
  async showTaskStats(ctx: Context): Promise<void> {
    try {
      // Note: Permission check is handled by AdminHandler before calling this method
      
      const pendingSubmissions = await this.submissionService.getPendingSubmissions();
      const allTasks = await this.taskManager.getAllTasks();
      const stats = await this.taskManager.getTaskStats();

      let text = `📊 <b>Task Management Statistics</b>\n\n`;
      
      text += `📋 <b>Tasks Overview:</b>\n`;
      text += `   • Total Tasks: ${stats.total}\n`;
      text += `   • Active Tasks: ${stats.active}\n`;
      text += `   • Daily Tasks: ${stats.daily}\n`;
      text += `   • Permanent Tasks: ${stats.permanent}\n\n`;
      
      text += `📝 <b>Submissions:</b>\n`;
      text += `   • Pending Review: ${pendingSubmissions.length}\n\n`;
      
      text += `💰 <b>Points Distribution:</b>\n`;
      text += `   • Min Points: ${stats.pointsRange.min}\n`;
      text += `   • Max Points: ${stats.pointsRange.max}\n`;
      text += `   • Average Points: ${Math.round(stats.pointsRange.avg)}\n\n`;
      
      text += `📊 <b>Categories:</b>\n`;
      Object.entries(stats.categories).forEach(([category, count]) => {
        text += `   • ${category}: ${count}\n`;
      });

      text += `\n🔧 <b>Admin Commands:</b>\n`;
      text += `<code>/pending</code> - View pending submissions\n`;
      text += `<code>/approve [id] [points] [notes]</code> - Approve submission\n`;
      text += `<code>/reject [id] [notes]</code> - Reject submission\n`;
      text += `<code>/taskstats</code> - View task statistics\n`;

      await ctx.reply(text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });

    } catch (error) {
      this.logger.error('Error showing task stats:', error);
      await ctx.reply('❌ Error loading task statistics.', { link_preview_options: { is_disabled: true } });
    }
  }
}