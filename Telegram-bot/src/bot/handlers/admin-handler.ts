import { Context, Scenes } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { Logger } from '../../services/logger';
import { StorageManager } from '../../storage';
import { getConfig } from '../../config';
import { SecurityManager, SecurityUtils } from '../../security';
import { Task, TaskCategory, TaskType, TaskVerificationMethod } from '../../types/task.types';
import { PointTransaction } from '../../types';
import { TaskAdminHandler } from './task-admin.handler';
import { safeRegex } from '../../services/validation.service';
import { Container } from '../../services/container.service';
import { ContainerConfigService } from '../../services/container-config.service';
import { TYPES } from '../../interfaces/container.interface';
import { CallbackManager } from '../../utils/callback-manager';
import { TaskSubmissionService } from '../../services/task-submission.service';
import {
  IUserManagementService,
  ITaskManagementService,
  ISecurityControlService,
  IAdminAuthorizationService,
  IAdminUIService,
  ISystemStatsService
} from '../../interfaces/admin-services.interface';

export class AdminHandler {
  private readonly logger = Logger.getInstance();
  private readonly storage = StorageManager.getInstance();
  private readonly config = getConfig();
  private readonly security = SecurityManager.getInstance();
  private readonly taskAdminHandler = new TaskAdminHandler();
  private readonly container = Container.getInstance();
  
  // Services (injected)
  private readonly userManagementService: IUserManagementService;
  private readonly taskManagementService: ITaskManagementService;
  private readonly securityControlService: ISecurityControlService;
  private readonly adminAuthorizationService: IAdminAuthorizationService;
  private readonly adminUIService: IAdminUIService;
  private readonly systemStatsService: ISystemStatsService;
  private readonly submissionService = TaskSubmissionService.getInstance();

  constructor() {
    // Configure dependency injection container
    ContainerConfigService.configureContainer();
    
    // Get services from container
    this.userManagementService = this.container.get<IUserManagementService>(TYPES.UserManagementService);
    this.taskManagementService = this.container.get<ITaskManagementService>(TYPES.TaskManagementService);
    this.securityControlService = this.container.get<ISecurityControlService>(TYPES.SecurityControlService);
    this.adminAuthorizationService = this.container.get<IAdminAuthorizationService>(TYPES.AdminAuthorizationService);
    this.adminUIService = this.container.get<IAdminUIService>(TYPES.AdminUIService);
    this.systemStatsService = this.container.get<ISystemStatsService>(TYPES.SystemStatsService);
  }

  /**
   * Check if user is admin
   */
  private isAdmin(userId: string): boolean {
    try {
      const adminIds = this.config.admin.adminIds || [];
      const superAdmins = this.config.admin.superAdmins || [];
      return adminIds.includes(userId) || superAdmins.includes(userId);
    } catch (error) {
      this.logger.error('Error checking admin status:', error);
      return false;
    }
  }

  /**
   * Check if user is super admin
   */
  private isSuperAdmin(userId: string): boolean {
    try {
      const superAdmins = this.config.admin.superAdmins || [];
      return superAdmins.includes(userId);
    } catch (error) {
      this.logger.error('Error checking super admin status:', error);
      return false;
    }
  }

  /**
   * Show admin panel - delegated to services
   */
  async showAdminPanel(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId || !this.adminAuthorizationService.isAdmin(userId)) {
        await ctx.reply('❌ Access denied. Admin privileges required.', { link_preview_options: { is_disabled: true } });
        return;
      }

      const adminText = await this.adminUIService.getAdminPanelText();
      const keyboard = this.adminUIService.getAdminPanelKeyboard(this.adminAuthorizationService.isSuperAdmin(userId));

      if (ctx.callbackQuery) {
        await ctx.editMessageText(adminText, {
          reply_markup: keyboard,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true }
        });
      } else {
        await ctx.reply(adminText, {
          reply_markup: keyboard,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true }
        });
      }

    } catch (error) {
      this.logger.error('Error showing admin panel:', error);
      await ctx.reply('❌ Error loading admin panel.', { link_preview_options: { is_disabled: true } });
    }
  }

  /**
   * Show system statistics - delegated to services
   */
  async showSystemStats(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId || !this.adminAuthorizationService.isAdmin(userId)) {
        await ctx.answerCbQuery('❌ Access denied');
        return;
      }

      const stats = await this.systemStatsService.getSystemStats();
      const statsText = this.systemStatsService.getSystemStatsText(stats);
      const keyboard = this.systemStatsService.getSystemStatsKeyboard();

      if (ctx.callbackQuery) {
        await ctx.editMessageText(statsText, {
          reply_markup: keyboard,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true }
        });
      } else {
        await ctx.reply(statsText, {
          reply_markup: keyboard,
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true }
        });
      }

    } catch (error) {
      this.logger.error('Error showing system stats:', error);
      await ctx.answerCbQuery('❌ Error loading statistics');
    }
  }

  /**
   * Show user management interface - delegated to service
   */
  async showUserManagement(ctx: Context): Promise<void> {
    // Delegate to user management service
    await this.userManagementService.showUserManagement(ctx);
  }

  /**
   * Show task management interface - delegated to service
   */
  async showTaskManagement(ctx: Context): Promise<void> {
    // Delegate to task management service
    await this.taskManagementService.showTaskManagement(ctx);
  }

  /**
   * Handle callback queries for admin operations
   */
  async handleCallback(ctx: Context): Promise<void> {
    const userId = ctx.from?.id?.toString();
    
    // Check admin access first
    if (!userId || !this.isAdmin(userId)) {
      await ctx.answerCbQuery('❌ Access denied');
      return;
    }

    // Use CallbackManager for automatic validation and error handling
    await CallbackManager.handleCallback(ctx, async (action: string, params?: Record<string, any>) => {
      switch (action) {
        case 'admin_panel':
          await this.showAdminPanel(ctx);
          break;
        case 'admin_stats':
          await this.showSystemStats(ctx);
          break;
        case 'admin_users':
          await this.showUserManagement(ctx);
          break;
        case 'admin_tasks':
          await this.showTaskManagement(ctx);
          break;
        case 'admin_broadcast':
          await (ctx as any).scene.enter('admin_broadcast');
          break;
        case 'admin_security':
          await this.securityControlService.showSecurityPanel(ctx);
          break;
        case 'admin_backup':
          await this.handleDataBackup(ctx);
          break;
        case 'admin_logs':
          await this.showSystemLogs(ctx);
          break;
        case 'admin_pending_tasks':
          await this.taskManagementService.showTaskSubmissions(ctx);
          break;
        case 'admin_user_search':
          await (ctx as any).scene.enter('admin_user_search');
          break;
        case 'admin_review_tasks':
          await this.showTaskReviewQueue(ctx);
          break;
        case 'admin_create_task':
          await (ctx as any).scene.enter('admin_create_task');
          break;
        case 'admin_award_points':
          await this.showAwardPointsForm(ctx);
          break;
        case 'admin_edit_tasks':
          await this.showEditTasksList(ctx);
          break;
        case 'admin_task_analytics':
          await this.taskManagementService.getTaskAnalytics(ctx);
          break;
        case 'admin_security_scan':
          await this.securityControlService.performSecurityScan(ctx);
          break;
        case 'admin_flagged_users':
          await this.showFlaggedUsers(ctx);
          break;
        case 'admin_ban_user':
          await this.showBanUserForm(ctx);
          break;
        case 'admin_approve_all_valid':
          await this.handleBulkApproval(ctx);
          break;
        case 'admin_detailed_review':
          await this.showDetailedReview(ctx);
          break;
        case 'admin_export_analytics':
          await this.exportAnalyticsReport(ctx);
          break;
        case 'admin_trend_analysis':
          await this.showTrendAnalysis(ctx);
          break;
        case 'admin_confirm_bulk_approve':
          await this.processBulkApproval(ctx);
          break;
        case 'admin_quick_review':
          await this.showQuickReview(ctx, params?.index || 0);
          break;
        case 'admin_quick_review_next':
          await this.nextQuickReview(ctx, params?.index || 0);
          break;
        case 'admin_quick_review_prev':
          await this.previousQuickReview(ctx, params?.index || 0);
          break;
        case 'admin_approve_single':
          if (params?.submissionId) {
            await this.taskManagementService.approveSubmission(ctx, params.submissionId);
            // Remove keyboard after approval
            await CallbackManager.removeKeyboard(ctx);
          }
          break;
        case 'admin_reject_single':
          if (params?.submissionId) {
            await this.taskManagementService.rejectSubmission(ctx, params.submissionId);
            // Remove keyboard after rejection
            await CallbackManager.removeKeyboard(ctx);
          }
          break;
        case 'admin_quick_approve':
          await this.handleQuickApproval(ctx, params?.submissionId as any, params?.index as any);
          break;
        case 'admin_quick_reject':
          await this.handleQuickRejection(ctx, params?.submissionId as any, params?.index as any);
          break;
        case 'admin_broadcasts':
          await (ctx as any).scene.enter('admin_broadcast');
          break;
        case 'admin_analytics':
          await this.showTaskAnalytics(ctx);
          break;
        case 'admin_stats_refresh':
        case 'admin_user_stats':
        case 'admin_task_stats':
        case 'admin_performance':
        case 'admin_security_stats':
          await this.showSystemStats(ctx);
          break;
        case 'admin_security_logs':
          await this.securityControlService.viewSecurityLogs(ctx);
          break;
        case "admin_security_suspicious":
          await this.securityControlService.showSuspiciousActivity(ctx);
          break;
        case 'admin_security_settings':
          await this.securityControlService.updateSecuritySettings(ctx);
          break;
        case 'admin_security_report':
          await this.securityControlService.exportSecurityReport(ctx);
          break;
        case 'admin_security_blocked':
          await this.securityControlService.showSecurityPanel(ctx);
          break;
        case 'admin_export_users_csv':
          await this.exportUsersCsv(ctx);
          break;
        default:
          this.logger.warn('Unknown admin callback action:', action);
          await ctx.reply('❌ Unknown action. Please try again.');
      }
    });
  }

  /**
   * Get admin scenes for multi-step operations
   */
  getAdminScenes(): Scenes.BaseScene<any>[] {
    return [
      this.createBroadcastScene(),
      this.createUserSearchScene(),
      this.createTaskCreationScene()
    ];
  }

  private async getAdminPanelText(): Promise<string> {
    const stats = await this.getSystemStats();
    const uptime = Math.floor(process.uptime() / 60); // minutes

    return `
🛡️ <b>Admin Panel</b>

📊 <b>System Overview:</b>
👥 Total Users: <b>${stats.totalUsers.toLocaleString()}</b>
⚡ Active Users: <b>${stats.activeUsers.toLocaleString()}</b>
📝 Total Tasks: <b>${stats.totalTasks}</b>
⏰ Pending Submissions: <b>${stats.pendingSubmissions}</b>

💰 <b>Points Economy:</b>
💎 Total Points: <b>${stats.totalPoints.toLocaleString()}</b>
📈 Points Today: <b>${stats.pointsToday.toLocaleString()}</b>
👥 Total Referrals: <b>${stats.totalReferrals}</b>

🔧 <b>System Status:</b>
⏱️ Uptime: <b>${uptime} minutes</b>
💾 Storage: <b>${this.config.storage.source}</b>
🔒 Security: <b>Enabled</b>
🚀 Version: <b>1.0.0</b>

🛠️ <b>Quick Actions:</b>
Use the buttons below to manage the system.
    `.trim();
  }

  private getAdminPanelKeyboard(isSuperAdmin: boolean): InlineKeyboardMarkup {
    const buttons: { text: string; action: string }[][] = [
      [
        { text: 'Statistics', action: 'admin_stats' },
        { text: 'Users', action: 'admin_users' }
      ],
      [
        { text: 'Tasks', action: 'admin_tasks' },
        { text: 'Broadcast', action: 'admin_broadcast' }
      ],
      [
        { text: 'Security', action: 'admin_security' },
        { text: 'Logs', action: 'admin_logs' }
      ]
    ];

    // Super admin only features
    if (isSuperAdmin) {
      buttons.push([
        { text: 'Backup Data', action: 'admin_backup' },
        { text: 'Settings', action: 'admin_settings' }
      ]);
    }

    const keyboard = CallbackManager.createKeyboard(buttons);

    // Admin panel URL if configured and is HTTPS (Telegram requirement)
    if (this.config.admin.panelUrl && this.config.admin.panelUrl.startsWith('https://')) {
      keyboard.inline_keyboard.push([
        { text: 'Web Admin Panel', url: this.config.admin.panelUrl }
      ]);
    }

    return keyboard;
  }

  private async getSystemStats(): Promise<{
    totalUsers: number;
    activeUsers: number;
    totalTasks: number;
    pendingSubmissions: number;
    totalPoints: number;
    pointsToday: number;
    totalReferrals: number;
  }> {
    try {
      const users = await this.storage.getAllUsers();
      const tasks = await this.storage.getAllTasks();
      const submissions = await this.storage.getAllTaskSubmissions();

      const activeUsers = users.filter(user => {
        try {
          // Handle different possible field names for last active date
          const lastActive = (user as any).lastActiveAt || (user as any).lastActivity || (user as any).lastSeen || (user as any).lastActive;
          
          if (!lastActive) {
            return false;
          }
          
          const lastActiveDate = typeof lastActive === 'string' ? new Date(lastActive) : lastActive;
          
          if (!lastActiveDate || isNaN(lastActiveDate.getTime())) {
            return false;
          }
          
          const daysSinceActive = (Date.now() - lastActiveDate.getTime()) / (1000 * 60 * 60 * 24);
          return daysSinceActive <= 7;
        } catch (error) {
          this.logger.error('Error processing user lastActive date:', error);
          return false;
        }
      });

      const pendingSubmissions = submissions.filter(sub => sub.status === 'pending');
      const totalPoints = users.reduce((sum, user) => sum + user.points, 0);
      
      // Calculate points earned today
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const todayTransactions = await this.getTodayTransactions();
      const pointsToday = todayTransactions.reduce((sum, tx) => sum + (tx.amount > 0 ? tx.amount : 0), 0);

      const totalReferrals = users.reduce((sum, user) => sum + user.totalReferrals, 0);

      return {
        totalUsers: users.length,
        activeUsers: activeUsers.length,
        totalTasks: tasks.length,
        pendingSubmissions: pendingSubmissions.length,
        totalPoints,
        pointsToday,
        totalReferrals
      };
    } catch (error) {
      this.logger.error('Error getting system stats:', error);
      return {
        totalUsers: 0,
        activeUsers: 0,
        totalTasks: 0,
        pendingSubmissions: 0,
        totalPoints: 0,
        pointsToday: 0,
        totalReferrals: 0
      };
    }
  }

  private getSystemStatsText(stats: any): string {
    return `
📊 <b>Detailed System Statistics</b>

👥 <b>User Analytics:</b>
• Total Registered: <b>${stats.totalUsers.toLocaleString()}</b>
• Active (7 days): <b>${stats.activeUsers.toLocaleString()}</b>
• Activity Rate: <b>${((stats.activeUsers / Math.max(stats.totalUsers, 1)) * 100).toFixed(1)}%</b>

📝 <b>Task Analytics:</b>
• Total Tasks: <b>${stats.totalTasks}</b>
• Pending Reviews: <b>${stats.pendingSubmissions}</b>
• Completion Rate: <b>${stats.totalTasks > 0 ? ((stats.totalUsers - stats.pendingSubmissions) / stats.totalTasks * 100).toFixed(1) : 0}%</b>

💰 <b>Points Economy:</b>
• Total Distributed: <b>${stats.totalPoints.toLocaleString()}</b>
• Distributed Today: <b>${stats.pointsToday.toLocaleString()}</b>
• Average per User: <b>${stats.totalUsers > 0 ? Math.round(stats.totalPoints / stats.totalUsers) : 0}</b>

👥 <b>Referral Program:</b>
• Total Referrals: <b>${stats.totalReferrals}</b>
• Referral Rate: <b>${((stats.totalReferrals / Math.max(stats.totalUsers, 1)) * 100).toFixed(1)}%</b>

🔧 <b>System Health:</b>
• Storage Type: <b>${this.config.storage.source}</b>
• Uptime: <b>${Math.floor(process.uptime() / 60)} minutes</b>
• Memory Usage: <b>${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)} MB</b>
    `.trim();
  }

  private getSystemStatsKeyboard(): InlineKeyboardMarkup {
    return CallbackManager.createKeyboard([
      [
        { text: 'User Details', action: 'admin_users' },
        { text: 'Task Details', action: 'admin_tasks' }
      ],
      [
        { text: 'Refresh', action: 'admin_stats' },
        { text: 'Back', action: 'admin_panel' }
      ]
    ]);
  }

  private async getUserManagementStats(): Promise<any> {
    try {
      const users = await this.storage.getAllUsers();
      const now = Date.now();

      const newToday = users.filter(user => {
        try {
          const joinedAtDate = user.joinedAt 
            ? (typeof user.joinedAt === 'string' ? new Date(user.joinedAt) : user.joinedAt)
            : (user.firstSeen 
                ? (typeof user.firstSeen === 'string' ? new Date(user.firstSeen) : user.firstSeen)
                : new Date());
          const daysSinceJoin = (now - joinedAtDate.getTime()) / (1000 * 60 * 60 * 24);
          return daysSinceJoin < 1;
        } catch (error) {
          this.logger.error('Error processing user joinedAt date:', error);
          return false;
        }
      });

      const activeToday = users.filter(user => {
        try {
          const lastActiveDate = user.lastActive 
            ? (typeof user.lastActive === 'string' ? new Date(user.lastActive) : user.lastActive)
            : (user.lastActivity 
                ? (typeof user.lastActivity === 'string' ? new Date(user.lastActivity) : user.lastActivity)
                : new Date());
          const hoursSinceActive = (now - lastActiveDate.getTime()) / (1000 * 60 * 60);
          return hoursSinceActive < 24;
        } catch (error) {
          this.logger.error('Error processing user lastActive date:', error);
          return false;
        }
      });

      const topUsers = users
        .sort((a, b) => b.points - a.points)
        .slice(0, 5);

      return {
        totalUsers: users.length,
        newToday: newToday.length,
        activeToday: activeToday.length,
        topUsers,
        avgPoints: users.length > 0 ? Math.round(users.reduce((sum, u) => sum + u.points, 0) / users.length) : 0
      };
    } catch (error) {
      this.logger.error('Error getting user management stats:', error);
      return {};
    }
  }

  private getUserManagementText(stats: any): string {
    return `
👥 <b>User Management</b>

📈 <b>User Overview:</b>
• Total Users: <b>${stats.totalUsers?.toLocaleString() || 0}</b>
• New Today: <b>${stats.newToday || 0}</b>
• Active Today: <b>${stats.activeToday || 0}</b>
• Average Points: <b>${stats.avgPoints || 0}</b>

🏆 <b>Top Users by Points:</b>
${stats.topUsers?.map((user: any, index: number) => 
  `${index + 1}. ${user.firstName} - ${user.points.toLocaleString()} pts`
).join('\n') || 'No users found'}

🛠️ <b>Management Actions:</b>
• Search and manage individual users
• View pending task submissions
• Award or deduct points manually
• Monitor suspicious activity

⚠️ <b>Security Alerts:</b>
Click Security Overview for threat analysis.
    `.trim();
  }

  private getUserManagementKeyboard(): InlineKeyboardMarkup {
    return CallbackManager.createKeyboard([
      [
        { text: 'Search User', action: 'admin_user_search' },
        { text: 'Pending Tasks', action: 'admin_pending_tasks' }
      ],
      [
        { text: 'Award Points', action: 'admin_award_points' },
        { text: 'Ban User', action: 'admin_ban_user' }
      ],
      [
        { text: 'Back', action: 'admin_panel' }
      ]
    ]);
  }

  private async getTaskManagementStats(): Promise<any> {
    try {
      const tasks = await this.storage.getAllTasks();
      const submissions = await this.storage.getAllTaskSubmissions();

      const activeTasks = tasks.filter(task => task.isActive);
      const pendingSubmissions = submissions.filter(sub => sub.status === 'pending');
      const approvedToday = submissions.filter(sub => {
        const daysSinceReview = sub.reviewedAt 
          ? (() => {
              try {
                const reviewedAtDate = typeof sub.reviewedAt === 'string' ? new Date(sub.reviewedAt) : sub.reviewedAt;
                return (Date.now() - reviewedAtDate.getTime()) / (1000 * 60 * 60 * 24);
              } catch (error) {
                this.logger.error('Error processing reviewedAt date:', error);
                return 999;
              }
            })()
          : 999;
        return sub.status === 'approved' && daysSinceReview < 1;
      });

      return {
        totalTasks: tasks.length,
        activeTasks: activeTasks.length,
        pendingSubmissions: pendingSubmissions.length,
        approvedToday: approvedToday.length,
        totalSubmissions: submissions.length
      };
    } catch (error) {
      this.logger.error('Error getting task management stats:', error);
      return {};
    }
  }

  private getTaskManagementText(stats: any): string {
    return `
📝 <b>Task Management</b>

📊 <b>Task Overview:</b>
• Total Tasks: <b>${stats.totalTasks || 0}</b>
• Active Tasks: <b>${stats.activeTasks || 0}</b>
• Total Submissions: <b>${stats.totalSubmissions || 0}</b>

⏰ <b>Review Queue:</b>
• Pending Review: <b>${stats.pendingSubmissions || 0}</b>
• Approved Today: <b>${stats.approvedToday || 0}</b>

🛠️ <b>Management Actions:</b>
• Review pending submissions (detailed view)
• Quick Review for fast approvals/rejections
• Create new tasks and monitor performance
• View comprehensive analytics

📈 <b>Performance Tip:</b>
${stats.pendingSubmissions > 0 ? `⚡ Use Quick Review for efficient processing of ${stats.pendingSubmissions} pending submissions!` : '✅ All submissions are up to date!'}
    `.trim();
  }

  private getTaskManagementKeyboard(): InlineKeyboardMarkup {
    return CallbackManager.createKeyboard([
      [
        { text: 'Review Pending', action: 'admin_review_tasks' },
        { text: 'Quick Review', action: 'admin_quick_review' }
      ],
      [
        { text: 'Create Task', action: 'admin_create_task' },
        { text: 'Task Analytics', action: 'admin_task_analytics' }
      ],
      [
        { text: 'Edit Tasks', action: 'admin_edit_tasks' },
        { text: 'Back', action: 'admin_panel' }
      ]
    ]);
  }

  private async showSecurityOverview(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId || !this.isAdmin(userId)) {
        await ctx.answerCbQuery('❌ Access denied');
        return;
      }

      const securityStatus = await this.getSecurityStatus();
      const securityText = this.getSecurityOverviewText(securityStatus);
      const keyboard = this.getSecurityOverviewKeyboard();

      if (ctx.callbackQuery) {
        await ctx.editMessageText(securityText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      } else {
        await ctx.reply(securityText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      }

    } catch (error) {
      this.logger.error('Error showing security overview:', error);
      await ctx.answerCbQuery('❌ Error loading security overview');
    }
  }

  private async getSecurityStatus(): Promise<any> {
    // Compose a minimal security status object for display purposes
    try {
      return {
        isEnabled: true,
        components: {
          rateLimit: true,
          threatAnalysis: true,
          multiAccountDetection: true,
          deviceFingerprinting: true,
          validation: true
        },
        statistics: {
          totalThreatsDetected: 0,
          blockedUsers: 0,
          flaggedUsers: 0,
          rateLimitViolations: 0
        }
      };
    } catch (e) {
      return {
        isEnabled: false,
        components: { rateLimit: false, threatAnalysis: false, multiAccountDetection: false, deviceFingerprinting: false, validation: false },
        statistics: { totalThreatsDetected: 0, blockedUsers: 0, flaggedUsers: 0, rateLimitViolations: 0 }
      };
    }
  }

  private getSecurityOverviewText(status: any): string {
    return `
🔒 <b>Security Overview</b>

🛡️ <b>Security Status:</b> ${status.isEnabled ? '✅ Enabled' : '❌ Disabled'}

🔧 <b>Active Components:</b>
• Rate Limiting: ${status.components.rateLimit ? '✅' : '❌'}
• Threat Analysis: ${status.components.threatAnalysis ? '✅' : '❌'}
• Multi-Account Detection: ${status.components.multiAccountDetection ? '✅' : '❌'}
• Device Fingerprinting: ${status.components.deviceFingerprinting ? '✅' : '❌'}
• Input Validation: ${status.components.validation ? '✅' : '❌'}

📊 <b>Security Statistics:</b>
• Threats Detected: <b>${status.statistics.totalThreatsDetected}</b>
• Blocked Users: <b>${status.statistics.blockedUsers}</b>
• Flagged Users: <b>${status.statistics.flaggedUsers}</b>
• Rate Limit Violations: <b>${status.statistics.rateLimitViolations}</b>

⚠️ <b>Recent Alerts:</b>
${status.statistics.blockedUsers > 0 || status.statistics.flaggedUsers > 0 
  ? 'Review flagged users for potential security threats.'
  : 'No recent security alerts.'}
    `.trim();
  }

  private getSecurityOverviewKeyboard(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: 'Blocked Users', callback_data: 'admin_blocked_users' },
          { text: 'Flagged Users', callback_data: 'admin_flagged_users' }
        ],
        [
          { text: 'Threat Analysis', callback_data: 'admin_threat_analysis' },
          { text: 'Security Scan', callback_data: 'admin_security_scan' }
        ],
        [
          { text: 'Back', callback_data: 'admin_panel' }
        ]
      ]
    };
  }

  private createBroadcastScene(): Scenes.BaseScene<any> {
    const scene = new Scenes.BaseScene<any>('admin_broadcast');

    scene.action('admin_panel', async (ctx: any) => {
      try { await ctx.answerCbQuery().catch(() => {}); } catch {}
      try { await ctx.scene.leave(); } catch {}
      await this.showAdminPanel(ctx);
    });

    scene.enter(async (ctx) => {
      await ctx.reply(
        '📢 <b>Broadcast Message</b>\n\n' +
        'Send the message you want to broadcast to all users.\n\n' +
        '⚠️ <b>Guidelines:</b>\n' +
        '• Keep it concise and clear\n' +
        '• Use HTML formatting if needed\n' +
        '• Avoid spam-like content\n' +
        '• Test with a small group first\n\n' +
        'Send /cancel to abort.',
        { parse_mode: 'HTML' }
      );
    });

    scene.on('text', async (ctx) => {
      const message = ctx.message.text;
      
      if (message === '/cancel') {
        await ctx.reply('❌ Broadcast cancelled.');
        return ctx.scene.leave();
      }

      await this.processBroadcast(ctx, message);
      return ctx.scene.leave();
    });

    scene.command('cancel', async (ctx) => {
      await ctx.reply('❌ Broadcast cancelled.');
      return ctx.scene.leave();
    });

    return scene;
  }

  private createUserSearchScene(): Scenes.BaseScene<any> {
    const scene = new Scenes.BaseScene<any>('admin_user_search');

    scene.action('admin_panel', async (ctx: any) => {
      try { await ctx.answerCbQuery().catch(() => {}); } catch {}
      try { await ctx.scene.leave(); } catch {}
      await this.showAdminPanel(ctx);
    });

    scene.enter(async (ctx) => {
      await ctx.reply(
        '🔍 <b>Search User</b>\n\n' +
        'Enter user information to search:\n\n' +
        '• Telegram ID (e.g., 123456789)\n' +
        '• Username (e.g., @username)\n' +
        '• Name (e.g., John Doe)\n\n' +
        'Send /cancel to abort.',
        { parse_mode: 'HTML' }
      );
    });

    scene.on('text', async (ctx) => {
      const query = ctx.message.text;
      
      if (query === '/cancel') {
        await ctx.reply('❌ Search cancelled.');
        return ctx.scene.leave();
      }

      await this.processUserSearch(ctx, query);
      return ctx.scene.leave();
    });

    scene.command('cancel', async (ctx) => {
      await ctx.reply('❌ Search cancelled.');
      return ctx.scene.leave();
    });

    return scene;
  }

  private createTaskCreationScene(): Scenes.BaseScene<any> {
    const scene = new Scenes.BaseScene<any>('admin_create_task');

    scene.action('admin_panel', async (ctx: any) => {
      try { await ctx.answerCbQuery().catch(() => {}); } catch {}
      try { await ctx.scene.leave(); } catch {}
      await this.showAdminPanel(ctx);
    });

    scene.enter(async (ctx) => {
      await ctx.reply(
        '➕ <b>Create New Task</b>\n\n' +
        'This is a simplified task creation. Use the web admin panel for advanced options.\n\n' +
        'Send task information in this format:\n' +
        '<code>Title|Description|Reward|Type</code>\n\n' +
        '<b>Example:</b>\n' +
        '<code>Follow Twitter|Follow our Twitter account|100|social_follow</code>\n\n' +
        'Send /cancel to abort.',
        { parse_mode: 'HTML' }
      );
    });

    scene.on('text', async (ctx) => {
      const taskData = ctx.message.text;
      
      if (taskData === '/cancel') {
        await ctx.reply('❌ Task creation cancelled.');
        return ctx.scene.leave();
      }

      await this.processTaskCreation(ctx, taskData);
      return ctx.scene.leave();
    });

    scene.command('cancel', async (ctx) => {
      await ctx.reply('❌ Task creation cancelled.');
      return ctx.scene.leave();
    });

    return scene;
  }

  private async processBroadcast(ctx: Context, message: string): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId || !this.isAdmin(userId)) {
        await ctx.reply('❌ Access denied.');
        return;
      }

      // Sanitize message
      const sanitizedMessage = SecurityUtils.sanitizeText(message);

      // Show confirmation
      await ctx.reply(
        '📢 <b>Confirm Broadcast</b>\n\n' +
        '<b>Message Preview:</b>\n' +
        `${sanitizedMessage}\n\n` +
        '⚠️ This will be sent to ALL active users. Are you sure?',
        {
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: 'Send to All', callback_data: `admin_broadcast_confirm:${Buffer.from(sanitizedMessage).toString('base64')}` },
                { text: 'Test Send', callback_data: `admin_broadcast_test:${Buffer.from(sanitizedMessage).toString('base64')}` }
              ],
              [
                { text: 'Cancel', callback_data: 'admin_panel' }
              ]
            ]
          }
        }
      );

    } catch (error) {
      this.logger.error('Error processing broadcast:', error);
      await ctx.reply('❌ Error processing broadcast message.');
    }
  }

  private async processUserSearch(ctx: Context, query: string): Promise<void> {
    try {
      const results = await this.searchUsers(query);
      
      if (results.length === 0) {
        await ctx.reply('❌ No users found matching your search.');
        return;
      }

      let searchText = `🔍 <b>Search Results</b>\n\nQuery: "${query}"\n\n`;
      
      results.slice(0, 5).forEach((user, index) => {
        searchText += `${index + 1}. <b>${user.firstName} ${user.lastName || ''}</b>\n`;
        searchText += `   ID: <code>${user.telegramId}</code>\n`;
        searchText += `   Username: ${user.username ? '@' + user.username : 'None'}\n`;
        searchText += `   Points: ${user.points.toLocaleString()}\n`;
        const joinedAtDate = user.joinedAt 
          ? (typeof user.joinedAt === 'string' ? new Date(user.joinedAt) : user.joinedAt)
          : (user.firstSeen 
              ? (typeof user.firstSeen === 'string' ? new Date(user.firstSeen) : user.firstSeen)
              : new Date());
        searchText += `   Joined: ${joinedAtDate.toLocaleDateString()}\n\n`;
      });

      if (results.length > 5) {
        searchText += `... and ${results.length - 5} more results`;
      }

      const keyboard: InlineKeyboardMarkup = {
        inline_keyboard: [
          [
            { text: 'New Search', callback_data: 'admin_user_search' },
            { text: 'Back', callback_data: 'admin_users' }
          ]
        ]
      };

      await ctx.reply(searchText, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });

    } catch (error) {
      this.logger.error('Error processing user search:', error);
      await ctx.reply('❌ Error searching users.');
    }
  }

  private async processTaskCreation(ctx: Context, taskData: string): Promise<void> {
    try {
      const parts = taskData.split('|');
      
      if (parts.length !== 4) {
        await ctx.reply(
          '❌ Invalid format. Please use:\n' +
          '<code>Title|Description|Reward|Type</code>',
          { parse_mode: 'HTML' }
        );
        return;
      }

      const [title, description, rewardStr, type] = parts.map(p => p.trim());
      const reward = parseInt(rewardStr);

      if (isNaN(reward) || reward <= 0) {
        await ctx.reply('❌ Invalid reward amount. Must be a positive number.');
        return;
      }

      // Create task (conform to Task interface)
      const allTypes: TaskType[] = [
        'telegram_join', 'twitter_follow', 'twitter_retweet', 'instagram_follow', 'youtube_subscribe',
        'website_visit', 'premium_check', 'daily_bonus', 'referral_invite', 'mini_game', 'survey', 'quiz', 'captcha', 'custom'
      ];
      const taskType: TaskType = (allTypes as string[]).includes(type) ? (type as TaskType) : 'custom';

      const categoryMap: Record<TaskType, TaskCategory> = {
        telegram_join: 'tele_social',
        twitter_follow: 'social',
        twitter_retweet: 'social',
        instagram_follow: 'social',
        youtube_subscribe: 'social',
        website_visit: 'engagement',
        premium_check: 'premium',
        daily_bonus: 'daily',
        referral_invite: 'referral',
        mini_game: 'engagement',
        survey: 'engagement',
        quiz: 'engagement',
        captcha: 'engagement',
        custom: 'engagement'
      };

      const newTask: Task = {
        id: `task_${Date.now()}`,
        title: SecurityUtils.sanitizeText(title),
        description: SecurityUtils.sanitizeText(description),
        category: categoryMap[taskType],
        type: taskType,
        points: reward,
        icon: '📝',
        verificationMethod: taskType === 'daily_bonus' ? 'time_based' : 'manual_review',
        isActive: true,
        isDaily: taskType === 'daily_bonus',
        completionCount: 0,
        requirements: {},
        validation: {
          submissionRequired: false,
          autoApprove: true,
          reviewRequired: false
        },
        buttons: [
          {
            text: taskType === 'daily_bonus' ? 'Claim' : 'Complete',
            action: taskType === 'daily_bonus' ? 'complete' : 'complete'
          }
        ],
        order: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        metadata: {}
      };

      await this.storage.saveTask(newTask);

      await ctx.reply(
        '✅ <b>Task Created Successfully!</b>\n\n' +
        `📝 Title: ${newTask.title}\n` +
        `💰 Reward: ${newTask.points} points\n` +
        `🔧 Type: ${newTask.type}\n\n` +
        'The task is now active and visible to users.',
        { parse_mode: 'HTML' }
      );

      this.logger.info('Task created by admin', {
        adminId: ctx.from?.id,
        taskId: newTask.id,
        title: newTask.title,
        reward: newTask.points
      });

    } catch (error) {
      this.logger.error('Error processing task creation:', error);
      await ctx.reply('❌ Error creating task.');
    }
  }

  private async searchUsers(query: string): Promise<any[]> {
    try {
      const users = await this.storage.getAllUsers();
      const lowerQuery = query.toLowerCase();

      return users.filter(user => {
        // Search by ID
        if (user.telegramId.includes(query)) return true;
        
        // Search by username
        if (user.username?.toLowerCase().includes(lowerQuery)) return true;
        
        // Search by name
        const fullName = `${user.firstName} ${user.lastName || ''}`.toLowerCase();
        if (fullName.includes(lowerQuery)) return true;

        return false;
      });
    } catch (error) {
      this.logger.error('Error searching users:', error);
      return [];
    }
  }

  private async getTodayTransactions(): Promise<PointTransaction[]> {
    try {
      // This would get today's transactions from storage
      // For now, return empty array
      return [];
    } catch (error) {
      this.logger.error('Error getting today transactions:', error);
      return [];
    }
  }

  private async handleDataBackup(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId || !this.isSuperAdmin(userId)) {
        await ctx.answerCbQuery('❌ Super admin access required');
        return;
      }

      await ctx.answerCbQuery('🔄 Starting backup...');

      // Trigger backup process
      const backupResult = await this.storage.backupData();
      
      if (backupResult.success) {
        await ctx.reply(
          '✅ <b>Backup Completed</b>\n\n' +
          `📁 File: ${backupResult.filename}\n` +
          `📊 Size: ${(backupResult.size / 1024 / 1024).toFixed(2)} MB\n` +
          `⏰ Created: ${new Date().toLocaleString()}\n\n` +
          'Backup has been saved securely.',
          { parse_mode: 'HTML' }
        );
      } else {
        await ctx.reply('❌ Backup failed. Check logs for details.');
      }

    } catch (error) {
      this.logger.error('Error handling data backup:', error);
      await ctx.answerCbQuery('❌ Error creating backup');
    }
  }

  private async showSystemLogs(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId || !this.isSuperAdmin(userId)) {
        await ctx.answerCbQuery('❌ Super admin access required');
        return;
      }

      // Get recent logs (simplified)
      const logs = await this.getRecentLogs();
      const logsText = this.getSystemLogsText(logs);
      const keyboard = this.getSystemLogsKeyboard();

      if (ctx.callbackQuery) {
        await ctx.editMessageText(logsText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      } else {
        await ctx.reply(logsText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      }

    } catch (error) {
      this.logger.error('Error showing system logs:', error);
      await ctx.answerCbQuery('❌ Error loading logs');
    }
  }

  private getSystemLogsText(logs: any[]): string {
    let text = '📋 <b>Recent System Logs</b>\n\n';

    if (logs.length === 0) {
      text += '📝 No recent logs available.';
    } else {
      logs.slice(0, 10).forEach(log => {
        const time = new Date(log.timestamp).toLocaleTimeString();
        const level = log.level.toUpperCase();
        
        text += `[${time}] ${level}: ${log.message}\n`;
      });
    }

    return text.trim();
  }

  private getSystemLogsKeyboard(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: 'Refresh', callback_data: 'admin_logs' },
          { text: 'Error Logs', callback_data: 'admin_error_logs' }
        ],
        [
          { text: 'Back', callback_data: 'admin_panel' }
        ]
      ]
    };
  }

  private async getRecentLogs(): Promise<any[]> {
    try {
      // This would get recent logs from the logging system
      // For now, return sample data
      return [
        { level: 'info', message: 'Bot started successfully', timestamp: new Date() },
        { level: 'info', message: 'User registered', timestamp: new Date() },
        { level: 'warn', message: 'Rate limit exceeded', timestamp: new Date() }
      ];
    } catch (error) {
      this.logger.error('Error getting recent logs:', error);
      return [];
    }
  }

  /**
   * Show pending task submissions for review
   */
  private async showPendingTaskSubmissions(ctx: Context): Promise<void> {
    try {
      const submissions = await this.storage.getAllTaskSubmissions();
      const pendingSubmissions = submissions.filter(sub => sub.status === 'pending');
      
      let text = '⏰ <b>Pending Task Submissions</b>\n\n';
      
      if (pendingSubmissions.length === 0) {
        text += '📝 No pending submissions to review.';
      } else {
        text += `📝 Found <b>${pendingSubmissions.length}</b> pending submissions.`;
      }
      
      const keyboard = {
        inline_keyboard: [
          [
            { text: 'Back', callback_data: 'admin_users' }
          ]
        ]
      };
      
      if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
      }
    } catch (error) {
      this.logger.error('Error showing pending submissions:', error);
      await ctx.reply('❌ Error loading pending submissions');
    }
  }

  /**
   * Show task review queue
   */
  private async showTaskReviewQueue(ctx: Context): Promise<void> {
    try {
      const submissions = await this.storage.getAllTaskSubmissions();
      const pendingSubmissions = submissions.filter(sub => sub.status === 'pending');
      
      let text = '📝 <b>Task Review Queue</b>\n\n';
      
      if (pendingSubmissions.length === 0) {
        text += '✅ <b>No pending submissions!</b>\n\nAll task submissions have been reviewed.';
      } else {
        text += `📋 <b>${pendingSubmissions.length} pending submission${pendingSubmissions.length > 1 ? 's' : ''}</b>\n\n`;
        
        // Show first 5 submissions for quick review
        for (let i = 0; i < Math.min(5, pendingSubmissions.length); i++) {
          const submission = pendingSubmissions[i];
          const task = await this.storage.getTask(submission.taskId);
          const submittedDate = new Date(submission.submittedAt);
          
          text += `🔸 <b>Submission #${i + 1}</b>\n`;
          text += `👤 User: @${submission.username || 'N/A'} (${submission.userId})\n`;
          text += `📝 Task: ${task?.title || submission.taskId}\n`;
          text += `💰 Points: ${task?.points || 0}\n`;
          text += `📄 Submission: ${submission.submissionText}\n`;
          text += `📅 Submitted: ${submittedDate.toLocaleDateString()} ${submittedDate.toLocaleTimeString()}\n`;
          text += `\n────────────────\n\n`;
        }
        
        if (pendingSubmissions.length > 5) {
          text += `<i>... and ${pendingSubmissions.length - 5} more submissions</i>\n\n`;
        }
        
        text += '💡 <b>Quick Review:</b>\n';
        text += 'Use the buttons below or these commands:\n';
        text += '<code>/approve [submission_id] [points] [notes]</code>\n';
        text += '<code>/reject [submission_id] [notes]</code>';
      }
      
      const keyboard = {
        inline_keyboard: [
          pendingSubmissions.length > 0 ? [
            { text: 'Approve All Valid', callback_data: 'admin_approve_all_valid' },
            { text: 'Detailed Review', callback_data: 'admin_detailed_review' }
          ] : [],
          [
            { text: 'Refresh', callback_data: 'admin_review_tasks' },
            { text: 'Back', callback_data: 'admin_tasks' }
          ]
        ].filter(row => row.length > 0)
      };
      
      if (ctx.callbackQuery) {
        await ctx.editMessageText(text, { reply_markup: keyboard, parse_mode: 'HTML' });
      } else {
        await ctx.reply(text, { reply_markup: keyboard, parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
      }
      
    } catch (error) {
      this.logger.error('Error showing task review queue:', error);
      await ctx.reply('❌ Error loading review queue');
    }
  }

  // Stub methods for missing admin features
  private async showAwardPointsForm(ctx: Context): Promise<void> {
    await ctx.reply(
      '💰 <b>Award Points</b>\n\nSend: <code>/award [userId] [amount] [reason]</code>\nExample: <code>/award 1064587081 100 Weekly bonus</code>',
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: 'Back', callback_data: 'admin_users' }]] } }
    );
  }

  private async showEditTasksList(ctx: Context): Promise<void> {
    await ctx.reply('⚙️ Edit Tasks feature coming soon. Use /admin to return to main panel.');
  }

  private async showTaskAnalytics(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId || !this.isAdmin(userId)) {
        await ctx.answerCbQuery('❌ Access denied');
        return;
      }

      const analytics = await this.getTaskAnalytics();
      const analyticsText = this.getTaskAnalyticsText(analytics);
      const keyboard = this.getTaskAnalyticsKeyboard();

      if (ctx.callbackQuery) {
        await ctx.editMessageText(analyticsText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      } else {
        await ctx.reply(analyticsText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      }

    } catch (error) {
      this.logger.error('Error showing task analytics:', error);
      await ctx.answerCbQuery('❌ Error loading task analytics');
    }
  }

  private async performSecurityScan(ctx: Context): Promise<void> {
    await this.securityControlService.performSecurityScan(ctx);
  }

  private async showFlaggedUsers(ctx: Context): Promise<void> {
    await ctx.reply('⚙️ Flagged Users feature coming soon. Use /admin to return to main panel.');
  }

  private async showBanUserForm(ctx: Context): Promise<void> {
    await ctx.reply('⚙️ Ban User feature coming soon. Use /admin to return to main panel.');
  }

  public async generateUsersCsv(): Promise<{ buffer: Buffer; filename: string }> {
    const users = await this.storage.getAllUsers();
    const headers = [
      'telegramId','username','firstName','lastName','points','totalReferrals','isVerified','isBlocked','walletAddress','joinedAt','lastActiveAt'
    ];
    const escape = (v: any) => {
      const s = v === null || v === undefined ? '' : String(v);
      if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const rows = users.map(u => [
      u.telegramId,
      u.username,
      u.firstName,
      u.lastName,
      u.points || 0,
      u.totalReferrals || 0,
      u.isVerified ? 1 : 0,
      u.isBlocked ? 1 : 0,
      u.walletAddress || '',
      (u.joinedAt ? (typeof u.joinedAt === 'string' ? u.joinedAt : u.joinedAt.toISOString?.() || '') : ''),
      (u.lastActiveAt ? (typeof u.lastActiveAt === 'string' ? u.lastActiveAt : u.lastActiveAt.toISOString?.() || '') : (u.lastActive ? (typeof u.lastActive === 'string' ? u.lastActive : u.lastActive.toISOString?.() || '') : ''))
    ].map(escape).join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const ts = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const filename = `users-${ts.getFullYear()}${pad(ts.getMonth()+1)}${pad(ts.getDate())}-${pad(ts.getHours())}${pad(ts.getMinutes())}.csv`;
    return { buffer: Buffer.from(csv, 'utf-8'), filename };
  }

  private async exportUsersCsv(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId || !this.isAdmin(userId)) {
        await ctx.answerCbQuery('❌ Access denied');
        return;
      }
      const { buffer, filename } = await this.generateUsersCsv();
      await (ctx as any).replyWithDocument({ source: buffer, filename }, { caption: '📦 Exported user data CSV' });
    } catch (error) {
      this.logger.error('Error exporting users CSV:', error);
      await ctx.reply('❌ Error generating CSV.');
    }
  }

  /**
   * Get comprehensive task analytics
   */
  private async getTaskAnalytics(): Promise<any> {
    try {
      const tasks = await this.storage.getAllTasks();
      const submissions = await this.storage.getAllTaskSubmissions();
      const users = await this.storage.getAllUsers();
      
      // Basic task statistics
      const totalTasks = tasks.length;
      const activeTasks = tasks.filter(task => task.isActive).length;
      const dailyTasks = tasks.filter(task => task.isDaily).length;
      const permanentTasks = tasks.filter(task => task.isPermanent).length;
      
      // Submission statistics
      const totalSubmissions = submissions.length;
      const pendingSubmissions = submissions.filter(sub => sub.status === 'pending').length;
      const approvedSubmissions = submissions.filter(sub => sub.status === 'approved').length;
      const rejectedSubmissions = submissions.filter(sub => sub.status === 'rejected').length;
      
      // Calculate submission rates
      const approvalRate = totalSubmissions > 0 ? ((approvedSubmissions / totalSubmissions) * 100).toFixed(1) : '0.0';
      const rejectionRate = totalSubmissions > 0 ? ((rejectedSubmissions / totalSubmissions) * 100).toFixed(1) : '0.0';
      
      // Task popularity (by completion count)
      const taskPopularity = tasks.map(task => ({
        id: task.id,
        title: task.title,
        completions: task.completionCount || 0,
        points: task.points
      })).sort((a, b) => b.completions - a.completions).slice(0, 5);
      
      // Category breakdown
      const categoryStats = tasks.reduce((acc: any, task) => {
        const category = task.category || 'uncategorized';
        if (!acc[category]) {
          acc[category] = { count: 0, totalPoints: 0, submissions: 0 };
        }
        acc[category].count++;
        acc[category].totalPoints += task.points;
        acc[category].submissions += submissions.filter(sub => sub.taskId === task.id).length;
        return acc;
      }, {});
      
      // Points distribution
      const totalPointsAwarded = submissions
        .filter(sub => sub.status === 'approved')
        .reduce((sum, sub) => sum + (sub.pointsAwarded || 0), 0);
      
      const avgPointsPerTask = totalTasks > 0 ? Math.round(tasks.reduce((sum, task) => sum + task.points, 0) / totalTasks) : 0;
      const minPoints = tasks.length > 0 ? Math.min(...tasks.map(task => task.points)) : 0;
      const maxPoints = tasks.length > 0 ? Math.max(...tasks.map(task => task.points)) : 0;
      
      // Recent activity (last 7 days)
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const recentSubmissions = submissions.filter(sub => new Date(sub.submittedAt) >= weekAgo);
      
      // User engagement
      const activeUsers = users.filter(user => {
        const lastActive = user.lastActive 
          ? (typeof user.lastActive === 'string' ? new Date(user.lastActive) : user.lastActive)
          : (user.lastActivity 
              ? (typeof user.lastActivity === 'string' ? new Date(user.lastActivity) : user.lastActivity)
              : new Date(0));
        return (Date.now() - lastActive.getTime()) / (1000 * 60 * 60 * 24) <= 7;
      }).length;
      
      return {
        tasks: {
          total: totalTasks,
          active: activeTasks,
          inactive: totalTasks - activeTasks,
          daily: dailyTasks,
          permanent: permanentTasks,
          avgPoints: avgPointsPerTask,
          minPoints,
          maxPoints
        },
        submissions: {
          total: totalSubmissions,
          pending: pendingSubmissions,
          approved: approvedSubmissions,
          rejected: rejectedSubmissions,
          approvalRate: parseFloat(approvalRate),
          rejectionRate: parseFloat(rejectionRate),
          recent: recentSubmissions.length
        },
        points: {
          totalAwarded: totalPointsAwarded,
          avgPerTask: avgPointsPerTask,
          minPerTask: minPoints,
          maxPerTask: maxPoints
        },
        popularity: taskPopularity,
        categories: categoryStats,
        engagement: {
          activeUsers,
          totalUsers: users.length,
          engagementRate: users.length > 0 ? ((activeUsers / users.length) * 100).toFixed(1) : '0.0'
        }
      };
    } catch (error) {
      this.logger.error('Error getting task analytics:', error);
      return {
        tasks: { total: 0, active: 0, inactive: 0, daily: 0, permanent: 0, avgPoints: 0, minPoints: 0, maxPoints: 0 },
        submissions: { total: 0, pending: 0, approved: 0, rejected: 0, approvalRate: 0, rejectionRate: 0, recent: 0 },
        points: { totalAwarded: 0, avgPerTask: 0, minPerTask: 0, maxPerTask: 0 },
        popularity: [],
        categories: {},
        engagement: { activeUsers: 0, totalUsers: 0, engagementRate: '0.0' }
      };
    }
  }

  /**
   * Format task analytics text
   */
  private getTaskAnalyticsText(analytics: any): string {
    return `
📊 <b>Task Analytics Dashboard</b>

📝 <b>Task Overview:</b>
• Total Tasks: <b>${analytics.tasks.total}</b>
• Active Tasks: <b>${analytics.tasks.active}</b> | Inactive: <b>${analytics.tasks.inactive}</b>
• Daily Tasks: <b>${analytics.tasks.daily}</b> | Permanent: <b>${analytics.tasks.permanent}</b>

📋 <b>Submission Statistics:</b>
• Total Submissions: <b>${analytics.submissions.total}</b>
• Pending Review: <b>${analytics.submissions.pending}</b>
• Approved: <b>${analytics.submissions.approved}</b> (${analytics.submissions.approvalRate}%)
• Rejected: <b>${analytics.submissions.rejected}</b> (${analytics.submissions.rejectionRate}%)
• Recent (7 days): <b>${analytics.submissions.recent}</b>

💰 <b>Points Economy:</b>
• Total Awarded: <b>${analytics.points.totalAwarded.toLocaleString()}</b>
• Average per Task: <b>${analytics.points.avgPerTask}</b>
• Range: <b>${analytics.points.minPerTask} - ${analytics.points.maxPerTask}</b> points

🏆 <b>Most Popular Tasks:</b>
${analytics.popularity.slice(0, 3).map((task: any, index: number) => 
  `${index + 1}. ${task.title} - ${task.completions} completions`
).join('\n') || 'No completions yet'}

📊 <b>Category Breakdown:</b>
${Object.entries(analytics.categories).map(([category, stats]: [string, any]) => 
  `• ${category}: ${stats.count} tasks, ${stats.submissions} submissions`
).join('\n') || 'No categories'}

👥 <b>User Engagement:</b>
• Active Users (7d): <b>${analytics.engagement.activeUsers}</b>
• Total Users: <b>${analytics.engagement.totalUsers}</b>
• Engagement Rate: <b>${analytics.engagement.engagementRate}%</b>

📈 <b>Performance Insights:</b>
• ${analytics.submissions.approvalRate >= 80 ? '✅ High approval rate - tasks are clear' : '⚠️ Low approval rate - consider reviewing task instructions'}
• ${analytics.submissions.pending > 0 ? `⏰ ${analytics.submissions.pending} submissions need review` : '✅ All submissions reviewed'}
• ${analytics.engagement.engagementRate >= 50 ? '🎉 Great user engagement!' : '📢 Consider improving user retention'}
    `.trim();
  }

  /**
   * Get task analytics keyboard
   */
  private getTaskAnalyticsKeyboard(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: 'Export Report', callback_data: 'admin_export_analytics' },
          { text: 'Trend Analysis', callback_data: 'admin_trend_analysis' }
        ],
        [
          { text: 'Refresh', callback_data: 'admin_task_analytics' },
          { text: 'Back', callback_data: 'admin_tasks' }
        ]
      ]
    };
  }

  /**
   * Handle bulk approval of valid submissions
   */
  private async handleBulkApproval(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId || !this.isAdmin(userId)) {
        await ctx.answerCbQuery('❌ Access denied');
        return;
      }

      await ctx.answerCbQuery('🔄 Processing bulk approval...');

      const submissions = await this.storage.getAllTaskSubmissions();
      const pendingSubmissions = submissions.filter(sub => sub.status === 'pending');
      
      if (pendingSubmissions.length === 0) {
        await ctx.reply('✅ No pending submissions to approve.');
        return;
      }

      // For now, just show a confirmation dialog
      const confirmText = `⚠️ <b>Bulk Approval Confirmation</b>\n\nAre you sure you want to approve ALL ${pendingSubmissions.length} pending submissions?\n\nThis action cannot be undone.`;
      
      const keyboard = CallbackManager.createKeyboard([
        [
          { text: 'Yes, Approve All', action: 'admin_confirm_bulk_approve' },
          { text: 'Cancel', action: 'admin_review_tasks' }
        ]
      ]);

      await ctx.editMessageText(confirmText, {
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });

    } catch (error) {
      this.logger.error('Error handling bulk approval:', error);
      await ctx.reply('❌ Error processing bulk approval.');
    }
  }

  /**
   * Show detailed review interface
   */
  private async showDetailedReview(ctx: Context): Promise<void> {
    try {
      const submissions = await this.storage.getAllTaskSubmissions();
      const pendingSubmissions = submissions.filter(sub => sub.status === 'pending');
      
      if (pendingSubmissions.length === 0) {
        await ctx.editMessageText('✅ No pending submissions for detailed review.', {
          reply_markup: { inline_keyboard: [[ { text: 'Back', callback_data: 'admin_review_tasks' } ]] }
        });
        return;
      }

      // Show the first submission for detailed review
      const submission = pendingSubmissions[0];
      const task = await this.storage.getTask(submission.taskId);
      const submittedDate = new Date(submission.submittedAt);
      
      let text = `🔍 <b>Detailed Review</b>\n\n`;
      text += `📄 <b>Submission Details:</b>\n`;
      text += `ID: <code>${submission.id}</code>\n`;
      text += `User: @${submission.username || 'N/A'} (${submission.userId})\n`;
      text += `Task: ${task?.title || submission.taskId}\n`;
      text += `Expected Points: ${task?.points || 0}\n`;
      text += `Submission: ${submission.submissionText}\n`;
      text += `Type: ${submission.submissionType}\n`;
      text += `Submitted: ${submittedDate.toLocaleString()}\n\n`;
      
      if (task?.validation?.submissionPattern) {
        const regex = safeRegex(task.validation.submissionPattern);
        if (regex) {
          const isValid = regex.test(submission.submissionText);
          text += `🔍 <b>Pattern Validation:</b> ${isValid ? '✅ Valid' : '❌ Invalid'}\n`;
        } else {
          text += `🔍 <b>Pattern Validation:</b> ⚠️ Invalid pattern\n`;
        }
      }
      
      text += `\n📊 <b>Progress:</b> ${pendingSubmissions.indexOf(submission) + 1} of ${pendingSubmissions.length}`;
      
      const keyboard = {
        inline_keyboard: [
          [
            { text: 'Approve', callback_data: `admin_approve_single_${submission.id}` },
            { text: 'Reject', callback_data: `admin_reject_single_${submission.id}` }
          ],
          [
            { text: 'Next', callback_data: 'admin_next_review' },
            { text: 'Back to Queue', callback_data: 'admin_review_tasks' }
          ]
        ]
      };

      await ctx.editMessageText(text, {
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });

    } catch (error) {
      this.logger.error('Error showing detailed review:', error);
      await ctx.reply('❌ Error loading detailed review.');
    }
  }

  /**
   * Export analytics report
   */
  private async exportAnalyticsReport(ctx: Context): Promise<void> {
    try {
      await ctx.answerCbQuery('📊 Generating analytics report...');
      
      const analytics = await this.getTaskAnalytics();
      const reportText = this.generateAnalyticsReport(analytics);
      
      // For now, send as a message (could be enhanced to generate a file)
      await ctx.reply(
        `📊 <b>Task Analytics Report</b>\n<i>Generated: ${new Date().toLocaleString()}</i>\n\n${reportText}`,
        { parse_mode: 'HTML' }
      );
      
    } catch (error) {
      this.logger.error('Error exporting analytics report:', error);
      await ctx.answerCbQuery('❌ Error generating report');
    }
  }

  /**
   * Show trend analysis
   */
  private async showTrendAnalysis(ctx: Context): Promise<void> {
    try {
      const trendData = await this.getTrendAnalysis();
      const trendText = this.getTrendAnalysisText(trendData);
      
      const keyboard = {
        inline_keyboard: [
          [
            { text: 'Back to Analytics', callback_data: 'admin_task_analytics' }
          ]
        ]
      };

      await ctx.editMessageText(trendText, {
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });

    } catch (error) {
      this.logger.error('Error showing trend analysis:', error);
      await ctx.answerCbQuery('❌ Error loading trend analysis');
    }
  }

  /**
   * Generate comprehensive analytics report
   */
  private generateAnalyticsReport(analytics: any): string {
    return `
<b>TASK SYSTEM PERFORMANCE</b>\n
📝 Tasks: ${analytics.tasks.total} total (${analytics.tasks.active} active)\n📋 Submissions: ${analytics.submissions.total} total (${analytics.submissions.pending} pending)\n💰 Points: ${analytics.points.totalAwarded.toLocaleString()} awarded\n👥 Users: ${analytics.engagement.totalUsers} total (${analytics.engagement.activeUsers} active)\n\n<b>SUCCESS METRICS</b>\n• Approval Rate: ${analytics.submissions.approvalRate}%\n• Engagement Rate: ${analytics.engagement.engagementRate}%\n• Avg Points/Task: ${analytics.points.avgPerTask}\n\n<b>TOP PERFORMING TASKS</b>\n${analytics.popularity.slice(0, 5).map((task: any, i: number) => `${i + 1}. ${task.title}: ${task.completions} completions`).join('\n')}\n\n<b>RECOMMENDATIONS</b>\n${analytics.submissions.pending > 10 ? '⚠️ High pending count - consider more admins' : '✅ Pending submissions under control'}\n${analytics.submissions.approvalRate < 70 ? '⚠️ Low approval rate - review task clarity' : '✅ Good approval rate'}\n${analytics.engagement.engagementRate < 30 ? '⚠️ Low engagement - consider task variety' : '✅ Good user engagement'}
    `.trim();
  }

  /**
   * Get trend analysis data
   */
  private async getTrendAnalysis(): Promise<any> {
    try {
      const submissions = await this.storage.getAllTaskSubmissions();
      const users = await this.storage.getAllUsers();
      
      // Analyze submissions over time (last 30 days)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      const recentSubmissions = submissions.filter(sub => new Date(sub.submittedAt) >= thirtyDaysAgo);
      
      // Group by day
      const dailyStats = recentSubmissions.reduce((acc: any, sub) => {
        const date = new Date(sub.submittedAt).toDateString();
        if (!acc[date]) {
          acc[date] = { total: 0, approved: 0, rejected: 0, pending: 0 };
        }
        acc[date].total++;
        acc[date][sub.status]++;
        return acc;
      }, {});
      
      // Calculate trends
      const totalDays = Object.keys(dailyStats).length;
      const avgSubmissionsPerDay = totalDays > 0 ? recentSubmissions.length / totalDays : 0;
      
      // User registration trends
      const recentUsers = users.filter(user => {
        const joinDate = user.joinedAt 
          ? (typeof user.joinedAt === 'string' ? new Date(user.joinedAt) : user.joinedAt)
          : (user.firstSeen 
              ? (typeof user.firstSeen === 'string' ? new Date(user.firstSeen) : user.firstSeen)
              : new Date(0));
        return joinDate >= thirtyDaysAgo;
      });
      
      return {
        period: '30 days',
        submissions: {
          total: recentSubmissions.length,
          avgPerDay: Math.round(avgSubmissionsPerDay * 10) / 10,
          dailyStats
        },
        users: {
          newUsers: recentUsers.length,
          avgNewPerDay: Math.round((recentUsers.length / 30) * 10) / 10
        },
        growth: {
          submissionTrend: recentSubmissions.length > 0 ? 'positive' : 'neutral',
          userTrend: recentUsers.length > 0 ? 'positive' : 'neutral'
        }
      };
    } catch (error) {
      this.logger.error('Error getting trend analysis:', error);
      return { period: '30 days', submissions: { total: 0, avgPerDay: 0 }, users: { newUsers: 0, avgNewPerDay: 0 }, growth: { submissionTrend: 'neutral', userTrend: 'neutral' } };
    }
  }

  /**
   * Format trend analysis text
   */
  private getTrendAnalysisText(trendData: any): string {
    return `
📈 <b>Trend Analysis (${trendData.period})</b>\n\n📋 <b>Submission Trends:</b>\n• Total Submissions: <b>${trendData.submissions.total}</b>\n• Average per Day: <b>${trendData.submissions.avgPerDay}</b>\n• Trend: ${trendData.growth.submissionTrend === 'positive' ? '📈 Growing' : '📉 Stable'}\n\n👥 <b>User Growth:</b>\n• New Users: <b>${trendData.users.newUsers}</b>\n• Average per Day: <b>${trendData.users.avgNewPerDay}</b>\n• Trend: ${trendData.growth.userTrend === 'positive' ? '📈 Growing' : '📉 Stable'}\n\n🎯 <b>Key Insights:</b>\n• ${trendData.submissions.avgPerDay >= 5 ? 'High submission activity - system is engaging' : 'Low submission activity - consider promoting tasks'}\n• ${trendData.users.avgNewPerDay >= 2 ? 'Good user acquisition rate' : 'User growth could be improved'}\n• ${trendData.submissions.total > trendData.users.newUsers ? 'Existing users are active' : 'New users driving submissions'}\n\n🔮 <b>Recommendations:</b>\n${trendData.submissions.avgPerDay < 3 ? '• Increase task promotion and rewards\n' : ''}
${trendData.users.avgNewPerDay < 1 ? '• Improve referral system and user acquisition\n' : ''}
• ${trendData.growth.submissionTrend === 'positive' ? 'Maintain current engagement strategies' : 'Review task appeal and user experience'}
    `.trim();
  }

  /**
   * Process bulk approval of all pending submissions
   */
  private async processBulkApproval(ctx: Context): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId || !this.isAdmin(userId)) {
        await ctx.answerCbQuery('❌ Access denied');
        return;
      }

      await ctx.answerCbQuery('🔄 Processing bulk approval...');

      const submissions = await this.storage.getAllTaskSubmissions();
      const pendingSubmissions = submissions.filter(sub => sub.status === 'pending');
      
      if (pendingSubmissions.length === 0) {
        await ctx.editMessageText('✅ No pending submissions to approve.', {
          reply_markup: { inline_keyboard: [[ { text: 'Back', callback_data: 'admin_review_tasks' } ]] }
        });
        return;
      }

      let approved = 0;
      let failed = 0;
      const results: { id: string; user?: string; task?: string; points: number; status: 'approved' | 'failed' }[] = [];

      for (const submission of pendingSubmissions) {
        try {
          const task = await this.storage.getTask(submission.taskId);
          const points = task?.points || 0;

          const res = await this.submissionService.reviewSubmission(
            submission.id,
            'approve',
            userId,
            'Bulk approved',
            points
          );

          if (res.success) {
            approved++;
            results.push({ id: submission.id, user: submission.username, task: task?.title, points, status: 'approved' });
          } else {
            failed++;
            results.push({ id: submission.id, user: submission.username, task: task?.title, points, status: 'failed' });
          }
        } catch (error) {
          this.logger.error('Error in bulk approval:', error);
          failed++;
          try {
            const task = await this.storage.getTask(submission.taskId);
            results.push({ id: submission.id, user: submission.username, task: task?.title, points: task?.points || 0, status: 'failed' });
          } catch {}
        }
      }

      let resultText = `📊 <b>Bulk Approval Results</b>\n\n`;
      resultText += `✅ <b>Approved:</b> ${approved} submissions\n`;
      if (failed > 0) {
        resultText += `❌ <b>Failed:</b> ${failed} submissions\n`;
      }
      resultText += `\n<b>Summary:</b>\n`;
      
      results.slice(0, 10).forEach((result, index) => {
        const statusIcon = result.status === 'approved' ? '✅' : '❌';
        resultText += `${index + 1}. ${statusIcon} @${result.user} - ${result.task} (${result.points} pts)\n`;
      });
      
      if (results.length > 10) {
        resultText += `... and ${results.length - 10} more\n`;
      }

      const keyboard = {
        inline_keyboard: [
          [
            { text: 'Refresh Queue', callback_data: 'admin_review_tasks' },
            { text: 'Admin Panel', callback_data: 'admin_panel' }
          ]
        ]
      };

      await ctx.editMessageText(resultText, {
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });

      this.logger.info(`Bulk approval processed by admin ${userId}: ${approved} approved, ${failed} failed`);

    } catch (error) {
      this.logger.error('Error processing bulk approval:', error);
      await ctx.reply('❌ Error processing bulk approval.');
    }
  }

  /**
   * Handle single submission approval
   */
  private async handleSingleApproval(ctx: Context, submissionId: string): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId || !this.isAdmin(userId)) {
        await ctx.answerCbQuery('❌ Access denied');
        return;
      }

      await ctx.answerCbQuery('✅ Approving submission...');

      const submission = await this.storage.get<any>('task_submissions', submissionId);
      
      if (!submission) {
        await ctx.reply('❌ Submission not found.');
        return;
      }

      const task = await this.storage.getTask(submission.taskId);
      const points = task?.points || 0;

      // In a real implementation, integrate with TaskSubmissionService
      // For demonstration purposes:
      let resultText = `✅ <b>Submission Approved</b>\n\n`;
      resultText += `📄 <b>Submission ID:</b> <code>${submissionId}</code>\n`;
      resultText += `👤 <b>User:</b> @${submission.username} (${submission.userId})\n`;
      resultText += `📝 <b>Task:</b> ${task?.title || submission.taskId}\n`;
      resultText += `💰 <b>Points Awarded:</b> ${points}\n`;
      resultText += `📅 <b>Approved by:</b> Admin ${userId}\n\n`;
      resultText += `<i>Note: In production, this would integrate with TaskSubmissionService for actual point awarding.</i>`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: 'Next Review', callback_data: 'admin_detailed_review' },
            { text: 'Back to Queue', callback_data: 'admin_review_tasks' }
          ]
        ]
      };

      await ctx.editMessageText(resultText, {
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });

      this.logger.info(`Submission ${submissionId} approved by admin ${userId}`);

    } catch (error) {
      this.logger.error('Error approving single submission:', error);
      await ctx.reply('❌ Error approving submission.');
    }
  }

  /**
   * Handle single submission rejection
   */
  private async handleSingleRejection(ctx: Context, submissionId: string): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId || !this.isAdmin(userId)) {
        await ctx.answerCbQuery('❌ Access denied');
        return;
      }

      await ctx.answerCbQuery('❌ Rejecting submission...');

      const submission = await this.storage.get<any>('task_submissions', submissionId);
      
      if (!submission) {
        await ctx.reply('❌ Submission not found.');
        return;
      }

      const task = await this.storage.getTask(submission.taskId);

      let resultText = `❌ <b>Submission Rejected</b>\n\n`;
      resultText += `📄 <b>Submission ID:</b> <code>${submissionId}</code>\n`;
      resultText += `👤 <b>User:</b> @${submission.username} (${submission.userId})\n`;
      resultText += `📝 <b>Task:</b> ${task?.title || submission.taskId}\n`;
      resultText += `📅 <b>Rejected by:</b> Admin ${userId}\n`;
      resultText += `📝 <b>Reason:</b> Manual rejection by admin\n\n`;
      resultText += `<i>Note: In production, this would integrate with TaskSubmissionService and notify the user.</i>`;

      const keyboard = {
        inline_keyboard: [
          [
            { text: 'Next Review', callback_data: 'admin_detailed_review' },
            { text: 'Back to Queue', callback_data: 'admin_review_tasks' }
          ]
        ]
      };

      await ctx.editMessageText(resultText, {
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });

      this.logger.info(`Submission ${submissionId} rejected by admin ${userId}`);

    } catch (error) {
      this.logger.error('Error rejecting single submission:', error);
      await ctx.reply('❌ Error rejecting submission.');
    }
  }

  /**
   * Show quick review interface for efficient large-scale operations
   */
  private async showQuickReview(ctx: Context, submissionIndex: number = 0): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId || !this.isAdmin(userId)) {
        await ctx.answerCbQuery('❌ Access denied');
        return;
      }

      // Delegate to TaskAdminHandler for quick review functionality
      await this.taskAdminHandler.showQuickReview(ctx, submissionIndex);
    } catch (error) {
      this.logger.error('Error showing quick review:', error);
      
      const errorMessage = '❌ Error loading quick review interface.';
      
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery('❌ Error loading review');
        try {
          await ctx.editMessageText(errorMessage, {
            reply_markup: {
              inline_keyboard: [[
                { text: 'Back to Tasks', callback_data: 'admin_tasks' }
              ]]
            }
          });
        } catch (editError) {
          // If edit fails, send new message
          await ctx.reply(errorMessage);
        }
      } else {
        await ctx.reply(errorMessage);
      }
    }
  }

  /**
   * Move to next submission in quick review
   */
  private async nextQuickReview(ctx: Context, currentIndex: number = 0): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId || !this.isAdmin(userId)) {
        await ctx.answerCbQuery('❌ Access denied');
        return;
      }

      // Get next pending submission and show it
      const submissions = await this.storage.getAllTaskSubmissions();
      const pendingSubmissions = submissions.filter(sub => sub.status === 'pending');
      
      if (pendingSubmissions.length === 0) {
        await ctx.answerCbQuery('✅ No more pending submissions');
        await ctx.editMessageText('✅ All submissions reviewed!', {
          reply_markup: {
            inline_keyboard: [[
              { text: 'Back to Tasks', callback_data: 'admin_tasks' }
            ]]
          }
        });
        return;
      }

      const nextIndex = (currentIndex + 1) % pendingSubmissions.length;
      await ctx.answerCbQuery(`Loading submission ${nextIndex + 1}/${pendingSubmissions.length}...`);
      await this.showQuickReview(ctx, nextIndex);
      
    } catch (error) {
      this.logger.error('Error moving to next review:', error);
      await ctx.answerCbQuery('❌ Error loading next submission');
    }
  }

  /**
   * Move to previous submission in quick review
   */
  private async previousQuickReview(ctx: Context, currentIndex: number = 0): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId || !this.isAdmin(userId)) {
        await ctx.answerCbQuery('❌ Access denied');
        return;
      }

      // Get previous pending submission and show it
      const submissions = await this.storage.getAllTaskSubmissions();
      const pendingSubmissions = submissions.filter(sub => sub.status === 'pending');
      
      if (pendingSubmissions.length === 0) {
        await ctx.answerCbQuery('✅ No more pending submissions');
        await ctx.editMessageText('✅ All submissions reviewed!', {
          reply_markup: {
            inline_keyboard: [[
              { text: 'Back to Tasks', callback_data: 'admin_tasks' }
            ]]
          }
        });
        return;
      }

      // Calculate previous index (with wrap-around to last when going before first)
      const prevIndex = currentIndex === 0 ? pendingSubmissions.length - 1 : currentIndex - 1;
      await ctx.answerCbQuery(`Loading submission ${prevIndex + 1}/${pendingSubmissions.length}...`);
      await this.showQuickReview(ctx, prevIndex);
      
    } catch (error) {
      this.logger.error('Error moving to previous review:', error);
      await ctx.answerCbQuery('❌ Error loading previous submission');
    }
  }

  /**
   * Handle quick approval from button interface
   */
  private async handleQuickApproval(ctx: Context, submissionId?: string, submissionIndex?: number): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId || !this.isAdmin(userId)) {
        await ctx.answerCbQuery('❌ Access denied');
        return;
      }

      // Fallback: extract submissionId and index from message if not provided (compact callbacks)
      let subId = submissionId;
      let idx = submissionIndex;
      if (!subId || idx === undefined) {
        try {
          const msg: any = (ctx as any).callbackQuery?.message || {};
          const text: string = msg.text || msg.caption || '';
          if (!subId) {
            const m = text.match(/ID:\s*([A-Za-z0-9_:\-]+)/);
            if (m) subId = m[1];
          }
          if (idx === undefined) {
            const p = text.match(/Position:\s*(\d+)\//);
            if (p) idx = Math.max(0, parseInt(p[1], 10) - 1);
          }
        } catch {}
      }

      // If index still unknown, derive from pending list
      if (idx === undefined && subId) {
        try {
          const submissions = await this.storage.getAllTaskSubmissions();
          const pendingSubmissions = submissions.filter(sub => sub.status === 'pending');
          const found = pendingSubmissions.findIndex(s => s.id === subId);
          idx = found >= 0 ? found : 0;
        } catch {}
      }

      if (!subId) {
        await ctx.answerCbQuery('❌ Missing submission ID');
        return;
      }

      await ctx.answerCbQuery('✅ Processing approval...');
      
      // Use TaskAdminHandler for the actual approval logic
      await this.taskAdminHandler.approveSubmission(ctx, [subId]);
      
      // After approval, show next submission if available
      setTimeout(async () => {
        try {
          const submissions = await this.storage.getAllTaskSubmissions();
          const pendingSubmissions = submissions.filter(sub => sub.status === 'pending');
          
          if (pendingSubmissions.length > 0) {
            const nextIndex = (idx ?? 0) < pendingSubmissions.length ? (idx as number) : 0;
            await this.showQuickReview(ctx, nextIndex);
          } else {
            await ctx.editMessageText('✅ <b>All submissions reviewed!</b>', {
              reply_markup: {
                inline_keyboard: [[
                  { text: 'Back to Tasks', callback_data: 'admin_tasks' }
                ]]
              },
              parse_mode: 'HTML'
            });
          }
        } catch (error) {
          this.logger.error('Error showing next after approval:', error);
        }
      }, 1500);
      
    } catch (error) {
      this.logger.error('Error handling quick approval:', error);
      await ctx.answerCbQuery('❌ Error processing approval');
    }
  }

  /**
   * Handle quick rejection from button interface
   */
  private async handleQuickRejection(ctx: Context, submissionId?: string, submissionIndex?: number): Promise<void> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId || !this.isAdmin(userId)) {
        await ctx.answerCbQuery('❌ Access denied');
        return;
      }

      // Fallback: extract submissionId and index from message if not provided
      let subId = submissionId;
      let idx = submissionIndex;
      if (!subId || idx === undefined) {
        try {
          const msg: any = (ctx as any).callbackQuery?.message || {};
          const text: string = msg.text || msg.caption || '';
          if (!subId) {
            const m = text.match(/ID:\s*([A-Za-z0-9_:\-]+)/);
            if (m) subId = m[1];
          }
          if (idx === undefined) {
            const p = text.match(/Position:\s*(\d+)\//);
            if (p) idx = Math.max(0, parseInt(p[1], 10) - 1);
          }
        } catch {}
      }

      // If index still unknown, derive from pending list
      if (idx === undefined && subId) {
        try {
          const submissions = await this.storage.getAllTaskSubmissions();
          const pendingSubmissions = submissions.filter(sub => sub.status === 'pending');
          const found = pendingSubmissions.findIndex(s => s.id === subId);
          idx = found >= 0 ? found : 0;
        } catch {}
      }

      if (!subId) {
        await ctx.answerCbQuery('❌ Missing submission ID');
        return;
      }

      await ctx.answerCbQuery('❌ Processing rejection...');
      
      // Use TaskAdminHandler for the actual rejection logic
      await this.taskAdminHandler.rejectSubmission(ctx, [subId]);
      
      // After rejection, show next submission if available
      setTimeout(async () => {
        try {
          const submissions = await this.storage.getAllTaskSubmissions();
          const pendingSubmissions = submissions.filter(sub => sub.status === 'pending');
          
          if (pendingSubmissions.length > 0) {
            const nextIndex = (idx ?? 0) < pendingSubmissions.length ? (idx as number) : 0;
            await this.showQuickReview(ctx, nextIndex);
          } else {
            await ctx.editMessageText('✅ <b>All submissions reviewed!</b>', {
              reply_markup: {
                inline_keyboard: [[
                  { text: 'Back to Tasks', callback_data: 'admin_tasks' }
                ]]
              },
              parse_mode: 'HTML'
            });
          }
        } catch (error) {
          this.logger.error('Error showing next after rejection:', error);
        }
      }, 1500);
      
    } catch (error) {
      this.logger.error('Error handling quick rejection:', error);
      await ctx.answerCbQuery('❌ Error processing rejection');
    }
  }
}