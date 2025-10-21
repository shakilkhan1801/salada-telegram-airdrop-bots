import { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { IAdminUIService } from '../../interfaces/admin-services.interface';
import { Logger } from '../logger';
import { CallbackManager } from '../../utils/callback-manager';

export class AdminUIService implements IAdminUIService {
  private readonly logger = Logger.getInstance();

  async getAdminPanelText(): Promise<string> {
    const currentTime = new Date().toLocaleString();
    return `🔧 *Admin Panel*
    
Welcome to the administration panel.
Choose an option below:

🕐 Current Time: ${currentTime}`;
  }

  getAdminPanelKeyboard(isSuperAdmin: boolean): InlineKeyboardMarkup {
    const buttons = [
      [
        { text: 'User Management', action: 'admin_users' },
        { text: 'Task Management', action: 'admin_tasks' }
      ],
      [
        { text: 'System Stats', action: 'admin_stats' },
        { text: 'Security Panel', action: 'admin_security' }
      ],
      [
        { text: 'Broadcasts', action: 'admin_broadcasts' },
        { text: 'Analytics', action: 'admin_analytics' }
      ],
      [
        { text: 'Export Users CSV', action: 'admin_export_users_csv' }
      ]
    ];

    if (isSuperAdmin) {
      buttons.push([
        { text: 'System Settings', action: 'admin_settings' },
        { text: 'Backup & Restore', action: 'admin_backup' }
      ]);
    }

    buttons.push([{ text: 'Close Panel', action: 'admin_close' }]);
    return CallbackManager.createKeyboard(buttons);
  }

  getUserManagementKeyboard(page: number = 1): InlineKeyboardMarkup {
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
        { text: 'Back to Admin Panel', action: 'admin_panel' }
      ]
    ]);
  }

  getTaskManagementKeyboard(): InlineKeyboardMarkup {
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
        { text: 'Back to Admin Panel', action: 'admin_panel' }
      ]
    ]);
  }

  getSecurityPanelKeyboard(): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: 'Security Logs', callback_data: 'admin_security_logs' },
          { text: 'Blocked IPs', callback_data: 'admin_security_blocked' }
        ],
        [
          { text: 'Suspicious Activity', callback_data: 'admin_security_suspicious' },
          { text: 'Security Scan', callback_data: 'admin_security_scan' }
        ],
        [
          { text: 'Security Settings', callback_data: 'admin_security_settings' },
          { text: 'Security Report', callback_data: 'admin_security_report' }
        ],
        [{ text: 'Back to Admin Panel', callback_data: 'admin_panel' }]
      ]
    };
  }

  getUserActionKeyboard(userId: string): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: 'View Details', callback_data: `admin_user_details_${userId}` },
          { text: 'User Stats', callback_data: `admin_user_stats_${userId}` }
        ],
        [
          { text: 'Adjust Points', callback_data: `admin_user_points_${userId}` },
          { text: 'Reset Progress', callback_data: `admin_user_reset_${userId}` }
        ],
        [
          { text: 'Ban User', callback_data: `admin_user_ban_${userId}` },
          { text: '❌ Delete User', callback_data: `admin_user_delete_${userId}` }
        ],
        [{ text: 'Back to Users', callback_data: 'admin_users' }]
      ]
    };
  }

  getTaskActionKeyboard(taskId: string): InlineKeyboardMarkup {
    return {
      inline_keyboard: [
        [
          { text: 'View Task', callback_data: `admin_task_view_${taskId}` },
          { text: 'Edit Task', callback_data: `admin_task_edit_${taskId}` }
        ],
        [
          { text: 'Toggle Status', callback_data: `admin_task_toggle_${taskId}` },
          { text: 'Submissions', callback_data: `admin_task_submissions_${taskId}` }
        ],
        [
          { text: 'Analytics', callback_data: `admin_task_analytics_${taskId}` },
          { text: 'Delete Task', callback_data: `admin_task_delete_${taskId}` }
        ],
        [{ text: 'Back to Tasks', callback_data: 'admin_tasks' }]
      ]
    };
  }

  formatUserInfo(user: any): string {
    const joinDate = new Date(user.joinedAt).toLocaleDateString();
    const status = user.isActive ? '✅ Active' : '❌ Inactive';
    const verification = user.isVerified ? '✅ Verified' : '❌ Unverified';
    
    return `👤 *User Information*

🆔 ID: \`${user.id}\`
👤 Name: ${user.firstName || 'Unknown'} ${user.lastName || ''}
📱 Username: @${user.username || 'None'}
💰 Points: ${user.points || 0}
📅 Joined: ${joinDate}
🔄 Status: ${status}
✅ Verified: ${verification}
🔗 Referrals: ${user.referralCount || 0}

${user.walletAddress ? `💳 Wallet: \`${user.walletAddress.substring(0, 10)}...\`` : '💳 No wallet connected'}`;
  }

  formatTaskInfo(task: any): string {
    const status = task.isActive ? '✅ Active' : '❌ Inactive';
    const createdDate = new Date(task.createdAt).toLocaleDateString();
    
    return `📋 *Task Information*

🆔 ID: \`${task.id}\`
📝 Title: ${task.title}
📄 Description: ${task.description}
💰 Points: ${task.points}
🔄 Status: ${status}
📊 Completions: ${task.completionCount || 0}
📅 Created: ${createdDate}
📂 Category: ${task.category || 'General'}`;
  }

  formatSecurityEvent(event: any): string {
    const timestamp = new Date(event.timestamp).toLocaleString();
    const severity = event.severity === 'high' ? '🔴' : 
                    event.severity === 'medium' ? '🟡' : '🟢';
    
    return `🔒 *Security Event*

${severity} Severity: ${event.severity}
🎯 Action: ${event.action}
👤 User: ${event.userId || 'Unknown'}
🌐 IP: ${event.ipAddress || 'Unknown'}
📝 Details: ${event.details || 'No details'}
🕐 Time: ${timestamp}`;
  }
}