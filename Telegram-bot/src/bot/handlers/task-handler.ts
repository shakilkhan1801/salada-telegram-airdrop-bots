import { Context, Scenes } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { Logger } from '../../services/logger';
import { StorageManager } from '../../storage';
import { TaskSubmissionService } from '../../services/task-submission.service';
import { getConfig } from '../../config';
import { Task } from '../../types/task.types';
import { TaskManager } from '../../services/task-manager.service';
import { getTaskManagerConfig } from '../../services/task-config.service';
import { 
  UserValidationService, 
  CallbackQueryService, 
  MessageService,
  DateUtils,
  PointsService,
  PointTransactionType,
  PointEarningCategory,
  ActionSession,
  RateLimitService,
  RateLimitAction
} from '../../shared';
import { parseDuration, hasIntervalPassed, formatDuration } from '../../utils/time-utils';

export class TaskHandler {
  private readonly logger = Logger.getInstance();
  private readonly storage = StorageManager.getInstance();
  private readonly submissionService = TaskSubmissionService.getInstance();
  private readonly config = getConfig();
  private taskManager: TaskManager;

  constructor() {
    // Initialize TaskManager
    const taskConfig = getTaskManagerConfig();
    this.taskManager = TaskManager.getInstance(taskConfig);
  }

  /**
   * Show available tasks
   */
  async showTasks(ctx: Context): Promise<void> {
    try {
      // Only acknowledge callback queries to avoid visible toast; no loading message in chat
      if (ctx.callbackQuery) {
        void ctx.answerCbQuery().catch(() => {});
      }

      // Defer all heavy work (including user validation) so the handler returns quickly
      setTimeout(() => {
        (async () => {
          try { (await import('../../shared')).UserValidationService.invalidateSessionUser(ctx); } catch {}
          const user = await UserValidationService.validateUser(ctx);
          if (!user) {
            await MessageService.editOrReply(ctx, '❌ Error loading tasks. Please try again.', { parse_mode: 'HTML', link_preview_options: { is_disabled: true } }).catch(() => {});
            return;
          }

          const [tasks, userStats] = await Promise.all([
            this.taskManager.getAllTasks(),
            this.submissionService.getUserStats(user.telegramId, { preloadUser: user, includeAllSubmissions: true })
          ]);

          const availableTasks = tasks.filter(task => task.isActive);
          const submissions = (userStats && (userStats as any).submissions) || [];
          const completedArray: string[] = Array.isArray(userStats?.completedTasks) ? (userStats!.completedTasks as string[]) : [];
          const completedSet: Set<string> = new Set<string>(completedArray);

          const taskText = this.getTaskListText(availableTasks, user, userStats);
          const keyboard = await this.getTaskListKeyboard(availableTasks, user, submissions, completedSet);

          MessageService.editOrReply(ctx, taskText, {
            reply_markup: keyboard,
            parse_mode: 'HTML'
          }).catch(() => {});
        })().catch(err => this.logger.error('showTasks deferred error:', err));
      }, 0);
    } catch (error) {
      this.logger.error('Error showing tasks:', error);
      await ctx.reply('❌ Error loading tasks. Please try again.');
    }
  }

  /**
   * Show specific task details
   */
  async showTaskDetails(ctx: Context, taskId: string): Promise<void> {
    try {
      const user = await UserValidationService.validateUser(ctx);
      if (!user) return;
      const task = await this.taskManager.getTask(taskId);
      if (!task) {
        await CallbackQueryService.safeAnswerCallback(ctx, '❌ Task not found');
        return;
      }
      const submissions = await this.submissionService.getUserSubmissions(user.telegramId);
      const taskText = await this.getTaskDetailText(task, user, submissions);
      const keyboard = await this.getTaskDetailKeyboard(task, user, submissions);
      await MessageService.editOrReply(ctx, taskText, {
        reply_markup: keyboard,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true }
      });
    } catch (error) {
      this.logger.error('Error showing task details:', error);
      await CallbackQueryService.safeAnswerCallback(ctx, '❌ Error loading task details');
    }
  }

  /**
   * Handle task completion/verification
   */
  async completeTask(ctx: Context, taskId: string): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      const username = ctx.from?.username;
      if (!userId) return;

      const task = await this.taskManager.getTask(taskId);
      if (!task) {
        await ctx.answerCbQuery('❌ Task not found');
        return;
      }

      // Check if user already completed this task
      if (await this.submissionService.hasUserCompletedTask(userId, taskId)) {
        await ctx.answerCbQuery('✅ You have already completed this task!');
        return;
      }

      // Lightweight rate-limit to avoid double click/race conditions
      await RateLimitService.checkAndEnforce(ctx, RateLimitAction.TASK_SUBMISSION);

      let success = false;
      let message = '';

      // Handle different verification methods
      switch (task.verificationMethod) {
        case 'telegram_api':
          success = await this.verifyTelegramTask(ctx, task);
          message = success ? task.metadata?.successMessage || 'Task completed!' : 
                           task.metadata?.failureMessage || 'Please complete the requirements first.';
          break;

        case 'telegram_premium':
          success = await this.verifyPremiumTask(ctx, task);
          message = success ? task.metadata?.successMessage || 'Premium status verified!' : 
                           task.metadata?.failureMessage || 'This task is only for Telegram Premium members.';
          break;

        case 'referral_count':
          success = await this.verifyReferralTask(ctx, task, userId);
          message = success ? task.metadata?.successMessage || 'Referral task completed!' : 
                           task.metadata?.failureMessage || 'You need more referrals to complete this task.';
          break;

        case 'time_based':
          // Extra guard for daily tasks to prevent rapid double-claim
          const allowed = await RateLimitService.checkAndEnforce(ctx, RateLimitAction.POINT_CLAIM);
          if (!allowed) {
            success = false;
            message = 'Daily bonus already claimed recently.';
            break;
          }
          success = await this.verifyTimeBasedTask(ctx, task, userId);
          message = success ? task.metadata?.successMessage || 'Daily task completed!' : 
                           task.metadata?.failureMessage || 'You have already completed this today.';
          break;

        default:
          message = '❌ Invalid task verification method.';
      }

      // Complete task if successful
      if (success) {
        const completed = await this.submissionService.completeTask(
          userId, 
          username, 
          taskId, 
          task.points, 
          task.verificationMethod
        );

        if (completed) {
          // Points are already awarded in submissionService.completeTask; avoid double-award

          // Send success message to chat for better visibility
          await ctx.reply(`✅ ${message}`);
          await CallbackQueryService.safeAnswerCallback(ctx, `✅ Task completed!`);
          
          // Invalidate session cache and return to tasks list to show updated status
          try { (await import('../../shared')).UserValidationService.invalidateSessionUser(ctx); } catch {}
          await this.showTasks(ctx);
        } else {
          await ctx.reply('❌ Failed to complete task. Please try again.');
          await CallbackQueryService.safeAnswerCallback(ctx, '❌ Failed to complete task.');
        }
      } else {
        // Referral task: show concise toast instead of spamming chat and provide remaining count
        if (task.verificationMethod === 'referral_count') {
          try {
            const requiredReferrals = task.metadata?.requiredReferrals || 3;
            const user = await this.storage.getUser(userId);
            const userReferrals = (user && (user as any).referralCount) || 0;
            const remaining = Math.max(0, requiredReferrals - userReferrals);
            const base = remaining > 0
              ? `Invite ${remaining} more ${remaining === 1 ? 'friend' : 'friends'} to complete this task.`
              : `Invite ${requiredReferrals} friends to complete this task.`;
            const hint = 'Tap Get Referral Link to share.';
            await CallbackQueryService.safeAnswerCallback(ctx, `❌ ${base} ${hint}`);
          } catch {
            // Fallback toast
            await CallbackQueryService.safeAnswerCallback(ctx, '❌ Invite 3 friends to complete this task. Tap Get Referral Link to share.');
          }
          return;
        } else if (task.verificationMethod === 'telegram_premium') {
          // Show premium-only failure as a short toast
          const trimmed = (message || 'This task is only available for Telegram Premium members.').trim();
          const toast = trimmed.startsWith('❌') ? trimmed : `❌ ${trimmed}`;
          await CallbackQueryService.safeAnswerCallback(ctx, toast);
          return;
        } else if (task.verificationMethod === 'telegram_api') {
          // Channel join verification failed: show short toast instead of chat spam
          const trimmed = (message || 'Please join our channel first, then click Check & Complete.').trim();
          const toast = trimmed.startsWith('❌') ? trimmed : `❌ ${trimmed}`;
          await CallbackQueryService.safeAnswerCallback(ctx, toast);
          return;
        }

        // Other tasks: send failure message to chat (avoid double emoji), plus a short toast
        const trimmed = (message || '').trim();
        const chatMsg = trimmed.startsWith('❌') ? trimmed : `❌ ${trimmed}`;
        await ctx.reply(chatMsg);
        await CallbackQueryService.safeAnswerCallback(ctx, `❌ Task failed`);
      }

    } catch (error) {
      this.logger.error('Error completing task:', error);
      await CallbackQueryService.safeAnswerCallback(ctx, '❌ Error completing task. Please try again.');
    }
  }

  /**
   * Handle task submission for social media tasks
   */
  async submitTask(ctx: Context, taskId: string): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      const username = ctx.from?.username;
      if (!userId) return;

      const task = await this.taskManager.getTask(taskId);
      if (!task) {
        await CallbackQueryService.safeAnswerCallback(ctx, '❌ Task not found');
        return;
      }

      // Check if user already completed this task
      if (await this.submissionService.hasUserCompletedTask(userId, taskId)) {
        await CallbackQueryService.safeAnswerCallback(ctx, '✅ You have already completed this task!');
        return;
      }

      // Start submission scene
      await (ctx as any).scene.enter('task_submission', { taskId, task });

    } catch (error) {
      this.logger.error('Error starting task submission:', error);
      await CallbackQueryService.safeAnswerCallback(ctx, '❌ Error starting submission. Please try again.');
    }
  }

  /**
   * Verify Telegram-based tasks (channel join, group join)
   */
  private async verifyTelegramTask(ctx: Context, task: Task): Promise<boolean> {
    try {
      const channelId = task.metadata?.channelId || process.env.TASK_TELEGRAM_CHANNEL_ID;
      if (!channelId) {
        this.logger.error('Channel ID not configured for Telegram task');
        return false;
      }

      const verification = await this.submissionService.verifyTelegramMembership(ctx, channelId);
      return verification.success;
    } catch (error) {
      this.logger.error('Error verifying Telegram task:', error);
      return false;
    }
  }

  /**
   * Verify Telegram Premium status
   */
  private async verifyPremiumTask(ctx: Context, task: Task): Promise<boolean> {
    return ctx.from?.is_premium === true;
  }

  /**
   * Verify referral count
   */
  private async verifyReferralTask(ctx: Context, task: Task, userId: string): Promise<boolean> {
    try {
      const user = await this.storage.getUser(userId);
      if (!user) return false;

      const requiredReferrals = task.metadata?.requiredReferrals || 3;
      const userReferrals = user.referralCount || 0;

      return userReferrals >= requiredReferrals;
    } catch (error) {
      this.logger.error('Error verifying referral task:', error);
      return false;
    }
  }

  /**
   * Verify time-based tasks (daily check-in)
   */
  private async verifyTimeBasedTask(ctx: Context, task: Task, userId: string): Promise<boolean> {
    try {
      if (!task.isDaily) return true;

      const userStats = await this.submissionService.getUserStats(userId);
      const cooldownState = this.getDailyTaskCooldownState(userStats?.dailyTasksCompleted);

      return !cooldownState.inCooldown;
    } catch (error) {
      this.logger.error('Error verifying time-based task:', error);
      return false;
    }
  }

  /**
   * Generate task list text
   */
  private getTaskListText(tasks: Task[], user: any, userStats?: any): string {
    const totalTasks = tasks.length;
    // Count completed tasks from taskCompletionStatus (includes both daily and non-daily)
    const taskCompletionStatus = userStats?.taskCompletionStatus || {};
    const completedCount = Object.values(taskCompletionStatus).filter(status => status === 'Completed').length;
    const availableTasks = totalTasks - completedCount;
    const totalPoints = userStats?.totalPointsEarned || user?.points || 0;
    
    return `
<b>🎯 Tasks Hub (${totalTasks} total)</b>

💰 <b>Your Progress:</b>
✅ Completed: ${completedCount} tasks
⏳ Available: ${availableTasks} tasks  
🏆 Points Earned: ${totalPoints.toLocaleString()}

🚀 <b>Complete tasks to earn more points and climb the leaderboard!</b>
📊 Each task shows points value and current status below.
    `.trim();
  }

  /**
   * Generate task list keyboard
   */
  private async getTaskListKeyboard(tasks: Task[], user: any, submissions: any[], completedSet: Set<string>): Promise<InlineKeyboardMarkup> {
    const keyboard: any[][] = [];
    const taskButtons: any[] = [];
    const completionMap: Record<string, string> = (user?.taskCompletionStatus || {}) as any;
    const dailyCooldownState = this.getDailyTaskCooldownState(user?.dailyTasksCompleted);

    for (const task of tasks) {
      const shortTitle = task.title.length > 15 ? `${task.title.substring(0, 15)}...` : task.title;
      const submission = submissions.find((s: any) => s.userId === user.telegramId && s.taskId === task.id);

      let isCompleted = completedSet.has(task.type) || completionMap[task.type] === 'Completed' || (submission && submission.status === 'approved');
      let isPending = submission && submission.status === 'pending';
      let isRejected = submission && submission.status === 'rejected';

      if (task.isDaily && dailyCooldownState.inCooldown) {
        isCompleted = true;
        isPending = false;
        isRejected = false;
      }

      let buttonText: string;
      if (isCompleted) {
        buttonText = `✅ ${shortTitle} | 💰${task.points}`;
      } else if (isPending) {
        buttonText = `⏳ ${shortTitle} | 💰${task.points}`;
      } else if (isRejected) {
        buttonText = `❌ ${shortTitle} | 💰${task.points}`;
      } else {
        buttonText = `${this.getTaskTypeIcon(task.type)} ${shortTitle} | 💰${task.points}`;
      }

      taskButtons.push({
        text: buttonText,
        callback_data: `task_details_${task.id}`
      });
    }
    for (let i = 0; i < taskButtons.length; i += 2) {
      const row = [taskButtons[i]];
      if (i + 1 < taskButtons.length) {
        row.push(taskButtons[i + 1]);
      }
      keyboard.push(row);
    }
    keyboard.push([
      { text: '🔄 Refresh', callback_data: 'menu_tasks' }
    ]);
    keyboard.push([
      { text: '✅ Completed', callback_data: 'task_completed' },
      { text: '⏰ Pending', callback_data: 'task_pending' }
    ]);
    keyboard.push([
      { text: '🏠 Main Menu', callback_data: 'menu_main' }
    ]);
    return { inline_keyboard: keyboard };
  }

  /**
   * Generate task detail text
   */
  private async getTaskDetailText(task: Task, user: any, submissions: any[]): Promise<string> {
    const icon = this.getTaskTypeIcon(task.type);
    const submission = submissions.find((s: any) => s.userId === user.telegramId && s.taskId === task.id);
    let statusText = '⏳ Available';
    let isCompleted = false;
    let cooldownInfo = '';

    const completionMap: Record<string, string> = (user?.taskCompletionStatus || {}) as any;
    if (completionMap[task.type] === 'Completed') {
      statusText = '✅ Completed';
      isCompleted = true;
    }

    if (!isCompleted && submission) {
      if (submission.status === 'approved') {
        statusText = '✅ Completed';
        isCompleted = true;
      } else if (submission.status === 'pending') {
        statusText = '⏳ Pending Review';
      } else if (submission.status === 'rejected') {
        statusText = '❌ Rejected';
      }
    }

    if (task.isDaily) {
      const cooldownState = this.getDailyTaskCooldownState(user?.dailyTasksCompleted);
      if (cooldownState.inCooldown) {
        statusText = '✅ Claimed';
        isCompleted = true;

        const cooldownParts: string[] = [];
        if (cooldownState.timeRemainingMs > 0) {
          cooldownParts.push(`in ${formatDuration(cooldownState.timeRemainingMs)}`);
        }
        if (cooldownState.nextAvailableAt) {
          const nextDate = DateUtils.parseUserDate(cooldownState.nextAvailableAt);
          cooldownParts.push(DateUtils.formatUserDate(nextDate));
        }
        if (cooldownParts.length > 0) {
          cooldownInfo = `\n⏳ <b>Next available:</b> ${cooldownParts.join(' • ')}`;
        }
      } else {
        statusText = '⏳ Available';
      }
    }

    let text = `${icon} <b>${task.title}</b>\n\n`;
    text += `📝 <b>Description:</b>\n${task.description}\n\n`;
    text += `💰 <b>Reward:</b> ${task.points} points\n`;
    text += `🔧 <b>Type:</b> ${this.getTaskTypeText(task.type)}\n`;
    text += `📊 <b>Status:</b> ${statusText}\n`;
    if (cooldownInfo) {
      text += `${cooldownInfo}\n`;
    }
    if (task.validation?.submissionRequired) {
      text += `\n📝 <b>Submission Required:</b>\n`;
      text += `${task.validation.submissionInstructions || 'Please submit the required information.'}\n`;
      if (task.validation.submissionExample) {
        text += `\n<i>Example: ${task.validation.submissionExample}</i>\n`;
      }
    }
    if (task.requirements) {
      text += `\n📋 <b>Requirements:</b>\n`;
      if (task.requirements.verificationRequired) {
        text += `• Real-time verification required\n`;
      }
      if (task.requirements.premiumRequired) {
        text += `• Telegram Premium membership required\n`;
      }
    }
    if (isCompleted) {
      const completionMessage = task.isDaily ? 'You have claimed this reward!' : 'You have completed this task!';
      text += `\n✅ <b>${completionMessage}</b>`;
    }
    return text.trim();
  }

  /**
   * Generate task detail keyboard with session-based timeout for sensitive actions
   */
  private async getTaskDetailKeyboard(task: Task, user: any, submissions: any[]): Promise<InlineKeyboardMarkup> {
    const keyboard: any[][] = [];
    const submission = submissions.find((s: any) => s.userId === user.telegramId && s.taskId === task.id);
    const completionMap: Record<string, string> = (user?.taskCompletionStatus || {}) as any;
    let isCompleted = (submission && submission.status === 'approved') || completionMap[task.type] === 'Completed';

    const dailyCooldownState = task.isDaily ? this.getDailyTaskCooldownState(user?.dailyTasksCompleted) : null;
    if (dailyCooldownState?.inCooldown) {
      isCompleted = true;
    }

    if (!isCompleted) {
      task.buttons.forEach(button => {
        if (button.action === 'open_url' && button.url) {
          keyboard.push([{ text: button.text, url: button.url }]);
        } else if (button.action === 'complete') {
          const sessionId = CallbackQueryService.createActionSession(
            user.telegramId,
            `task_complete_${task.id}`,
            300000,
            { taskId: task.id, action: 'complete' }
          );
          keyboard.push([{
            text: button.text,
            callback_data: CallbackQueryService.createCallbackDataWithSession(
              'task_complete_session',
              sessionId,
              [task.id]
            )
          }]);
        } else if (button.action === 'submit') {
          const sessionId = CallbackQueryService.createActionSession(
            user.telegramId,
            `task_submit_${task.id}`,
            300000,
            { taskId: task.id, action: 'submit' }
          );
          keyboard.push([{
            text: button.text,
            callback_data: CallbackQueryService.createCallbackDataWithSession(
              'task_submit_session',
              sessionId,
              [task.id]
            )
          }]);
        }
      });
    }
    keyboard.push([
      { text: '← Back to Tasks', callback_data: 'menu_tasks' },
      { text: '🏠 Main Menu', callback_data: 'menu_main' }
    ]);
    return { inline_keyboard: keyboard };
  }

  private getDailyTaskCooldownState(dailyTasksCompleted?: Record<string, string> | null) {
    const resetIntervalStr = this.config.task.dailyTaskResetInterval || '24h';
    const parsedInterval = parseDuration(resetIntervalStr);
    const intervalMs = typeof parsedInterval === 'number' && parsedInterval > 0
      ? parsedInterval
      : 24 * 60 * 60 * 1000;

    const values = dailyTasksCompleted && typeof dailyTasksCompleted === 'object'
      ? Object.values(dailyTasksCompleted)
      : [];
    const timestamps = values
      .filter((value): value is string => typeof value === 'string')
      .sort();
    const lastCompletionTime = timestamps.length > 0 ? timestamps[timestamps.length - 1] : undefined;

    if (!lastCompletionTime) {
      return {
        inCooldown: false,
        lastCompletionTime: undefined,
        nextAvailableAt: undefined,
        intervalMs,
        resetInterval: resetIntervalStr,
        timeRemainingMs: 0
      };
    }

    const intervalPassed = hasIntervalPassed(lastCompletionTime, intervalMs);
    const lastCompletionMs = new Date(lastCompletionTime).getTime();
    const isValidTimestamp = !Number.isNaN(lastCompletionMs);
    const nextAvailableAt = isValidTimestamp ? new Date(lastCompletionMs + intervalMs).toISOString() : undefined;
    const timeRemainingMs = (!intervalPassed && isValidTimestamp)
      ? Math.max(0, (lastCompletionMs + intervalMs) - Date.now())
      : 0;

    return {
      inCooldown: !intervalPassed,
      lastCompletionTime,
      nextAvailableAt,
      intervalMs,
      resetInterval: resetIntervalStr,
      timeRemainingMs
    };
  }

  /**
   * Get task type icon
   */
  private getTaskTypeIcon(type: string): string {
    const icons: Record<string, string> = {
      telegram_join: '📢',
      twitter_follow: '🐦',
      twitter_retweet: '🔄',
      instagram_follow: '📷',
      youtube_subscribe: '📺',
      daily_bonus: '📅',
      referral_invite: '👥',
      premium_check: '⭐',
      custom: '📚'
    };
    return icons[type] || '📝';
  }

  /**
   * Get task type text
   */
  private getTaskTypeText(type: string): string {
    const types: Record<string, string> = {
      telegram_join: 'Telegram',
      twitter_follow: 'Twitter Follow',
      twitter_retweet: 'Twitter Retweet',
      instagram_follow: 'Instagram',
      youtube_subscribe: 'YouTube',
      daily_bonus: 'Daily',
      referral_invite: 'Referral',
      premium_check: 'Premium',
      custom: 'Social Media'
    };
    return types[type] || 'General';
  }

  /**
   * Get task submission scene for bot registration
   */
  getTaskSubmissionScene(): any {
    // Create a simple scene for task submission
    const scene = new Scenes.BaseScene<any>('task_submission');
    
    scene.enter(async (ctx: any) => {
      const { taskId, task } = ctx.scene?.state as { taskId: string; task: Task };
      
      await ctx.reply(
        `📝 <b>Submit Task: ${task.title}</b>\n\n` +
        `${task.validation?.submissionInstructions || '🔗 Please submit the required information for verification.'}\n\n` +
        `${task.validation?.submissionExample ? `💡 <b>Example:</b> <code>${task.validation.submissionExample}</code>\n\n` : ''}` +
        `📤 <b>Send your submission link:</b>`,
        { 
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
          reply_markup: {
            inline_keyboard: [[
              { text: '❌ Cancel', callback_data: `task_details_${taskId}` }
            ]]
          }
        }
      );
    });

    // Leave the submission room on navigation
    scene.action(/task_details_(.+)/, async (ctx: any) => {
      try { await ctx.answerCbQuery().catch(() => {}); } catch {}
      const match = (ctx as any).match;
      const taskId = Array.isArray(match) && match[1] ? match[1] : (ctx.scene?.state as any)?.taskId;
      try { await ctx.scene.leave(); } catch {}
      await this.showTaskDetails(ctx, taskId);
    });
    scene.action('menu_tasks', async (ctx: any) => {
      try { await ctx.answerCbQuery().catch(() => {}); } catch {}
      try { await ctx.scene.leave(); } catch {}
      await this.showTasks(ctx);
    });
    scene.action('menu_main', async (ctx: any) => {
      try { await ctx.answerCbQuery().catch(() => {}); } catch {}
      try { await ctx.scene.leave(); } catch {}
      const { MenuHandler } = await import('./menu-handler');
      await new MenuHandler().showMainMenu(ctx);
    });
    
    scene.on('text', async (ctx: any) => {
      const { taskId, task } = ctx.scene?.state as { taskId: string; task: Task };
      const submissionText = ctx.message.text;
      const userId = ctx.from?.id?.toString();
      const username = ctx.from?.username;

      if (!userId) {
        await ctx.reply('❌ Error: User ID not found');
        return ctx.scene?.leave();
      }

      const result = await this.submissionService.submitTask(userId, username, taskId, submissionText, task);

      await ctx.reply(result.message, { link_preview_options: { is_disabled: true } });
      await ctx.scene?.leave();

      // Invalidate session cache so fresh user state is fetched for status badges
      try { (await import('../../shared')).UserValidationService.invalidateSessionUser(ctx); } catch {}

      // Return to tasks list to show updated status
      await this.showTasks(ctx);
    });
    
    return scene;
  }

  /**
   * Handle callback queries for task actions with enhanced session-based timeout
   */
  async handleCallback(ctx: Context): Promise<void> {
    const data = (ctx.callbackQuery as any)?.data as string | undefined;
    if (!data) return;

    // Parse callback data to detect session-based callbacks
    const callbackData = CallbackQueryService.parseCallbackDataWithSession(ctx);
    
    // Handle session-based callbacks for sensitive actions
    if (callbackData.action && callbackData.sessionId) {
      await CallbackQueryService.handleCallbackWithSession(
        ctx,
        callbackData.sessionId,
        async (ctx, session) => {
          await this.handleSessionAction(ctx, session, callbackData);
        },
        '⏰ Task action has expired. Please try again.'
      );
      return;
    }

    // Handle legacy callback data format and navigation actions
    await this.handleLegacyCallback(ctx, data);
  }

  /**
   * Handle session-based task actions
   */
  private async handleSessionAction(
    ctx: Context, 
    session: ActionSession, 
    callbackData: { action?: string; sessionId?: string; params?: string[] }
  ): Promise<void> {
    const taskId = callbackData.params?.[0] || session.metadata?.taskId;
    if (!taskId) {
      await CallbackQueryService.safeAnswerCallback(ctx, '❌ Invalid task data');
      return;
    }

    switch (callbackData.action) {
      case 'task_complete_session':
        this.logger.debug('Processing task completion with session validation', {
          taskId,
          sessionId: session.id,
          userId: session.userId
        });
        await this.completeTask(ctx, taskId);
        break;
        
      case 'task_submit_session':
        this.logger.debug('Processing task submission with session validation', {
          taskId,
          sessionId: session.id,
          userId: session.userId
        });
        await this.submitTask(ctx, taskId);
        break;
        
      default:
        this.logger.warn('Unknown session action:', callbackData.action);
        await CallbackQueryService.safeAnswerCallback(ctx, '❌ Unknown action');
    }
  }

  /**
   * Handle legacy callback data format for backward compatibility
   */
  private async handleLegacyCallback(ctx: Context, data: string): Promise<void> {
    if (data === 'menu_tasks') {
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.showTasks(ctx);
      }, true);
    } else if (data.startsWith('task_details_')) {
      const taskId = data.replace('task_details_', '');
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.showTaskDetails(ctx, taskId);
      }, true);
    } else if (data.startsWith('task_complete_')) {
      const taskId = data.replace('task_complete_', '');
      await CallbackQueryService.handleCallbackWithTimeout(ctx, async (ctx) => {
        await this.completeTask(ctx, taskId);
      }, undefined, true);
    } else if (data.startsWith('task_submit_')) {
      const taskId = data.replace('task_submit_', '');
      // Enter scene immediately (not deferred) to avoid user message arriving before scene starts
      await CallbackQueryService.handleCallbackWithTimeout(ctx, async (ctx) => {
        await this.submitTask(ctx, taskId);
      }, undefined, true);
    } else if (data === 'task_completed') {
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.showCompletedTasks(ctx);
      }, true);
    } else if (data === 'task_pending') {
      await CallbackQueryService.handleDeferredNavigation(ctx, '', async (ctx) => {
        await this.showPendingTasks(ctx);
      }, true);
    }
  }

  /**
   * Show completed tasks
   */
  private async showCompletedTasks(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      const userStats = await this.submissionService.getUserStats(userId);
      const allTasks = await this.taskManager.getAllTasks();

      const completedTypes: string[] = Array.isArray(userStats?.completedTasks) ? userStats!.completedTasks as string[] : [];
      const completedSet = new Set<string>(completedTypes);

      // Build completed list by matching types to tasks
      const completedList: { title: string; points: number }[] = [];
      for (const t of allTasks) {
        if (completedSet.has(t.type) && !t.isDaily) {
          completedList.push({ title: t.title, points: t.points });
        }
      }

      const dailyMap = (userStats && (userStats as any).dailyTasksCompleted) || {};
      const dailyState = this.getDailyTaskCooldownState(dailyMap);
      if (dailyState.inCooldown) {
        const dailyTask = allTasks.find(tt => tt.type === 'daily_bonus');
        if (dailyTask) {
          completedList.push({ title: `${dailyTask.title} (claimed)`, points: dailyTask.points });
        }
      }

      // Also include admin-approved submissions (fallback in case user state isn't updated yet)
      try {
        const subs = await this.submissionService.getUserSubmissions(userId);
        for (const s of subs.filter(x => x.status === 'approved')) {
          const t = allTasks.find(tt => tt.id === s.taskId);
          if (t && !completedList.some(c => c.title.startsWith(t.title))) {
            completedList.push({ title: t.title, points: t.points });
          }
        }
      } catch {}

      let text = `✅ <b>Completed Tasks</b>\n\n`;

      if (completedList.length === 0) {
        text += '😔 You haven\'t completed any tasks yet.\n\n';
        text += 'Click "← Back to Tasks" to see available tasks.';
      } else {
        text += `🎉 You have completed <b>${completedList.length}</b> tasks!\n`;
        text += `💰 Total points earned: <b>${userStats.totalPointsEarned}</b>\n\n`;
        for (const item of completedList) {
          text += `✅ ${item.title} - ${item.points} points\n`;
        }
      }

      await MessageService.safeEditMessage(ctx, text, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '← Back to Tasks', callback_data: 'menu_tasks' },
            { text: '🏠 Main Menu', callback_data: 'menu_main' }
          ]]
        }
      });
    } catch (error) {
      this.logger.error('Error showing completed tasks:', error);
      await CallbackQueryService.safeAnswerCallback(ctx, '❌ Error loading completed tasks');
    }
  }

  /**
   * Show pending tasks
   */
  private async showPendingTasks(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) return;

      const submissions = await this.submissionService.getUserSubmissions(userId);
      const pendingSubmissions = submissions.filter(s => s.status === 'pending' || s.status === 'under_review');
      
      let text = `⏰ <b>Pending Tasks</b>\n\n`;
      
      if (pendingSubmissions.length === 0) {
        text += '📋 No pending submissions.\n\n';
        text += 'All your submissions have been processed or you haven\'t submitted any tasks yet.';
      } else {
        text += `📋 You have <b>${pendingSubmissions.length}</b> pending submissions:\n\n`;
        
        for (const submission of pendingSubmissions) {
          const task = await this.taskManager.getTask(submission.taskId);
          if (task) {
            const statusText = submission.status === 'pending' ? '⏳ Pending Review' : '👀 Under Review';
            text += `${statusText} ${task.title}\n`;
            text += `   Submitted: ${DateUtils.formatUserDate(DateUtils.parseUserDate(submission.submittedAt))}\n\n`;
          }
        }
        
        text += '⏱️ Please wait for admin review. You will be notified when your submissions are processed.';
      }

      await MessageService.safeEditMessage(ctx, text, {
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [[
            { text: '← Back to Tasks', callback_data: 'menu_tasks' },
            { text: '🏠 Main Menu', callback_data: 'menu_main' }
          ]]
        }
      });
    } catch (error) {
      this.logger.error('Error showing pending tasks:', error);
      await CallbackQueryService.safeAnswerCallback(ctx, '❌ Error loading pending tasks');
    }
  }

  async handleDocumentUpload(ctx: Context): Promise<void> {
    try {
      await ctx.reply('📄 Document uploads are not supported yet. Please submit text or links only.');
    } catch (error) {
      this.logger.error('Error handling document upload:', error);
    }
  }

  async handlePhotoUpload(ctx: Context): Promise<void> {
    try {
      await ctx.reply('📷 Photo uploads are not supported yet. Please submit text or links only.');
    } catch (error) {
      this.logger.error('Error handling photo upload:', error);
    }
  }

}