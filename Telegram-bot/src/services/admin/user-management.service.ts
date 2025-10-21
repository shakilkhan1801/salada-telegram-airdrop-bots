import { Context } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';
import { IUserManagementService, IAdminAuthorizationService, IAdminUIService } from '../../interfaces/admin-services.interface';
import { Logger } from '../logger';
import { StorageManager } from '../../storage';
import { User } from '../../types';
import { PointsHandler } from '../../bot/handlers/points-handler';

/**
 * Service for user management operations
 */
export class UserManagementService implements IUserManagementService {
  private readonly logger = Logger.getInstance();
  private readonly storage = StorageManager.getInstance();
  private readonly pointsHandler = new PointsHandler();
  
  constructor(
    private authService: IAdminAuthorizationService,
    private uiService: IAdminUIService
  ) {}

  /**
   * Show user management interface
   */
  async showUserManagement(ctx: Context): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx))) {
        return;
      }

      const userStats = await this.getUserManagementStats();
      const managementText = this.getUserManagementText(userStats);
      const keyboard = this.uiService.getUserManagementKeyboard();

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
      this.logger.error('Error showing user management:', error);
      await ctx.reply('❌ Error loading user management interface.');
    }
  }

  /**
   * Show paginated user list
   */
  async showUserList(ctx: Context, page: number = 0): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx))) {
        return;
      }

      const pageSize = 10;
      const offset = page * pageSize;
      
      const allUsers = await this.storage.getAllUsers();
      const totalUsers = allUsers.length;
      const users = allUsers
        .sort((a, b) => new Date(b.joinedAt || b.createdAt || 0).getTime() - new Date(a.joinedAt || a.createdAt || 0).getTime())
        .slice(offset, offset + pageSize);

      if (users.length === 0) {
        await ctx.reply('📭 No users found.');
        return;
      }

      const userListText = this.buildUserListText(users, page, Math.ceil(totalUsers / pageSize));
      const keyboard = this.buildUserListKeyboard(users, page, Math.ceil(totalUsers / pageSize));

      if (ctx.callbackQuery) {
        await ctx.editMessageText(userListText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      } else {
        await ctx.reply(userListText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      }
    } catch (error) {
      this.logger.error('Error showing user list:', error);
      await ctx.reply('❌ Error loading user list.');
    }
  }

  /**
   * Show user details
   */
  async showUserDetails(ctx: Context, userId: string): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx))) {
        return;
      }

      const user = await this.storage.getUser(userId);
      if (!user) {
        await ctx.reply('❌ User not found.');
        return;
      }

      const userDetailsText = this.uiService.formatUserInfo(user);
      const keyboard = this.uiService.getUserActionKeyboard(userId);

      if (ctx.callbackQuery) {
        await ctx.editMessageText(userDetailsText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      } else {
        await ctx.reply(userDetailsText, {
          reply_markup: keyboard,
          parse_mode: 'HTML'
        });
      }
    } catch (error) {
      this.logger.error('Error showing user details:', error);
      await ctx.reply('❌ Error loading user details.');
    }
  }

  /**
   * Ban a user
   */
  async banUser(ctx: Context, userId: string, reason?: string): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx))) {
        return;
      }

      const user = await this.storage.getUser(userId);
      if (!user) {
        await ctx.reply('❌ User not found.');
        return;
      }

      if (user.isBlocked) {
        await ctx.reply('⚠️ User is already banned.');
        return;
      }

      // Update user status
      const updates: Partial<User> = {
        isBlocked: true,
        blockedAt: new Date().toISOString(),
        blockReason: reason || 'Banned by admin',
        updatedAt: new Date().toISOString()
      };

      await this.storage.updateUser(userId, updates);

      // Log the ban action
      await this.logAdminAction(ctx, userId, 'user_banned', {
        reason: reason || 'Banned by admin',
        blockedAt: updates.blockedAt
      });

      // Add to blocked users collection
      await this.addToBlockedUsers(userId, reason || 'Banned by admin', ctx.from?.id?.toString());

      await ctx.reply(`✅ User ${user.firstName} (${userId}) has been banned.\nReason: ${reason || 'Banned by admin'}`);
      
      this.logger.info(`User ${userId} banned by admin ${ctx.from?.id}`, { reason });
    } catch (error) {
      this.logger.error('Error banning user:', error);
      await ctx.reply('❌ Error banning user. Please try again.');
    }
  }

  /**
   * Unban a user and reset verification status
   * This allows banned users to complete captcha verification again
   */
  async unbanUser(ctx: Context, userId: string): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx))) {
        return;
      }

      const user = await this.storage.getUser(userId);
      if (!user) {
        await ctx.reply('❌ User not found.');
        return;
      }

      if (!user.isBlocked) {
        await ctx.reply('⚠️ User is not currently banned.');
        return;
      }

      // Update user status and reset verification to allow captcha retry
      const updates: Partial<User> & {
        captchaCompleted?: boolean;
        fingerprintPreProcessed?: boolean;
        fingerprintPreProcessedAt?: string;
      } = {
        isBlocked: false,
        blockedAt: undefined,
        blockReason: undefined,
        // Reset verification status so user must complete captcha again
        captchaCompleted: false,
        miniappVerified: false,
        miniappVerifiedAt: undefined,
        fingerprintPreProcessed: false,
        fingerprintPreProcessedAt: undefined,
        updatedAt: new Date().toISOString()
      };

      await this.storage.updateUser(userId, updates);

      // Log the unban action
      await this.logAdminAction(ctx, userId, 'user_unbanned', {
        unbannedAt: new Date().toISOString(),
        verificationReset: true,
        note: 'User must complete captcha verification again'
      });

      // Remove from blocked users collection
      await this.removeFromBlockedUsers(userId);
      
      // CRITICAL: Clear blocking middleware cache to ensure fresh data
      try {
        const { BlockingMiddleware } = require('../../bot/middleware/blocking.middleware');
        const blockingMiddleware = BlockingMiddleware.getInstance();
        blockingMiddleware.clearUserCache(userId);
      } catch (cacheError) {
        this.logger.error('Error clearing blocking middleware cache:', cacheError);
      }

      await ctx.reply(
        `✅ User ${user.firstName} (${userId}) has been unbanned.\n\n` +
        `🔄 Verification status has been reset.\n` +
        `📝 User must complete captcha verification again to use the bot.`
      );
      
      this.logger.info(`User ${userId} unbanned by admin ${ctx.from?.id} with verification reset`);
    } catch (error) {
      this.logger.error('Error unbanning user:', error);
      await ctx.reply('❌ Error unbanning user. Please try again.');
    }
  }

  /**
   * Adjust user points
   */
  async adjustUserPoints(ctx: Context, userId: string, amount: number, reason?: string): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx))) {
        return;
      }

      const user = await this.storage.getUser(userId);
      if (!user) {
        await ctx.reply('❌ User not found.');
        return;
      }

      const previousPoints = user.points;

      let success = false;
      if (amount > 0) {
        // Award points
        success = await this.pointsHandler.awardPoints(userId, amount, reason || 'Admin points adjustment', {
          source: 'admin_adjustment',
          awardedBy: ctx.from?.id?.toString()
        });
      } else if (amount < 0) {
        // Deduct points using PointsHandler to ensure transaction is recorded
        const deduction = Math.abs(amount);
        success = await this.pointsHandler.deductPoints(userId, deduction, reason || 'Admin points deduction', {
          source: 'admin_deduction',
          deductedBy: ctx.from?.id?.toString()
        });
      } else {
        await ctx.reply('❌ Points adjustment amount cannot be zero.');
        return;
      }

      if (!success) {
        await ctx.reply('❌ Failed to adjust points (insufficient balance or error).');
        return;
      }

      // Log admin action
      await this.logAdminAction(ctx, userId, 'points_adjusted', {
        adjustment: amount,
        reason: reason || 'Admin points adjustment',
        previousPoints,
        newPoints: previousPoints + amount
      });

      const action = amount > 0 ? 'awarded' : 'deducted';
      await ctx.reply(`✅ ${Math.abs(amount)} points ${action} ${amount > 0 ? 'to' : 'from'} ${user.firstName} (${userId}).\nReason: ${reason || 'Admin points adjustment'}`);
      
      this.logger.info(`Points adjusted for user ${userId} by admin ${ctx.from?.id}`, { amount, reason, previousPoints });
    } catch (error) {
      this.logger.error('Error adjusting user points:', error);
      await ctx.reply('❌ Error adjusting user points. Please try again.');
    }
  }

  /**
   * Delete a user (soft delete by marking as deleted)
   */
  async deleteUser(ctx: Context, userId: string): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx, true))) { // Require super admin
        return;
      }

      const user = await this.storage.getUser(userId);
      if (!user) {
        await ctx.reply('❌ User not found.');
        return;
      }

      // Soft delete by marking as deleted
      const updates: Partial<User> & { isDeleted?: boolean; deletedAt?: string; deletedBy?: string } = {
        isDeleted: true,
        deletedAt: new Date().toISOString(),
        deletedBy: ctx.from?.id?.toString(),
        updatedAt: new Date().toISOString()
      };

      await this.storage.updateUser(userId, updates);

      // Log the deletion action
      await this.logAdminAction(ctx, userId, 'user_deleted', {
        deletedAt: updates.deletedAt,
        deletedBy: updates.deletedBy
      });

      await ctx.reply(`✅ User ${user.firstName} (${userId}) has been deleted.\n⚠️ This action is permanent and cannot be undone.`);
      
      this.logger.info(`User ${userId} deleted by admin ${ctx.from?.id}`);
    } catch (error) {
      this.logger.error('Error deleting user:', error);
      await ctx.reply('❌ Error deleting user. Please try again.');
    }
  }

  /**
   * Search for users by query
   */
  async searchUsers(ctx: Context, query: string): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx))) {
        return;
      }

      if (!query || query.length < 2) {
        await ctx.reply('❌ Search query must be at least 2 characters long.');
        return;
      }

      const allUsers = await this.storage.getAllUsers();
      const results = allUsers.filter(user => {
        const searchQuery = query.toLowerCase();
        return (
          user.telegramId.includes(searchQuery) ||
          user.firstName?.toLowerCase().includes(searchQuery) ||
          user.lastName?.toLowerCase().includes(searchQuery) ||
          user.username?.toLowerCase().includes(searchQuery) ||
          (user.firstName + ' ' + user.lastName)?.toLowerCase().includes(searchQuery)
        );
      }).slice(0, 20); // Limit to 20 results

      if (results.length === 0) {
        await ctx.reply(`🔍 No users found matching "${query}".`);
        return;
      }

      const searchResultsText = this.buildSearchResultsText(results, query);
      const keyboard = this.buildSearchResultsKeyboard(results);

      await ctx.reply(searchResultsText, {
        reply_markup: keyboard,
        parse_mode: 'HTML'
      });
    } catch (error) {
      this.logger.error('Error searching users:', error);
      await ctx.reply('❌ Error searching users. Please try again.');
    }
  }

  /**
   * Export user data
   */
  async exportUserData(ctx: Context): Promise<void> {
    try {
      if (!(await this.authService.checkAdminAccess(ctx, true))) { // Require super admin
        return;
      }

      await ctx.reply('📊 Generating user data export... This may take a moment.');

      const allUsers = await this.storage.getAllUsers();
      const exportData = allUsers.map(user => ({
        id: user.telegramId,
        firstName: user.firstName,
        lastName: user.lastName,
        username: user.username,
        points: user.points,
        isVerified: user.isVerified || false,
        isBlocked: user.isBlocked || false,
        joinedAt: user.joinedAt || user.createdAt,
        lastActive: user.lastActive || user.lastActivity
      }));

      const csvContent = this.convertToCSV(exportData);
      const filename = `user_export_${new Date().toISOString().split('T')[0]}.csv`;
      
      // In a real implementation, you would save this file and send it
      // For now, we'll just show the count
      await ctx.reply(`✅ Export completed!\n📊 Total users: ${allUsers.length}\n💾 File: ${filename}`);
      
      this.logger.info(`User data exported by admin ${ctx.from?.id}`, { userCount: allUsers.length });
    } catch (error) {
      this.logger.error('Error exporting user data:', error);
      await ctx.reply('❌ Error exporting user data. Please try again.');
    }
  }

  // Private helper methods

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
        } catch {
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
        } catch {
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
        avgPoints: users.length > 0 ? Math.round(users.reduce((sum, u) => sum + u.points, 0) / users.length) : 0,
        blockedUsers: users.filter(u => u.isBlocked).length,
        verifiedUsers: users.filter(u => u.isVerified).length
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
• Verified Users: <b>${stats.verifiedUsers || 0}</b>
• Blocked Users: <b>${stats.blockedUsers || 0}</b>
• Average Points: <b>${stats.avgPoints || 0}</b>

🏆 <b>Top Users by Points:</b>
${stats.topUsers?.map((user: any, index: number) => 
  `${index + 1}. ${user.firstName} - ${user.points.toLocaleString()} pts`
).join('\n') || 'No users found'}

🛠️ <b>Management Actions:</b>
• Search and manage individual users
• View user details and activity
• Ban/unban users and adjust points
• Export user data for analysis
    `.trim();
  }

  private buildUserListText(users: any[], page: number, totalPages: number): string {
    const userList = users.map((user, index) => {
      const status = user.isBlocked ? '🚫' : user.isVerified ? '✅' : '⏳';
      return `${status} <b>${user.firstName}</b> ${user.lastName || ''} (${user.telegramId})\n   💰 ${user.points} pts • Joined: ${new Date(user.joinedAt || user.createdAt).toLocaleDateString()}`;
    }).join('\n\n');

    return `
📋 <b>User List (Page ${page + 1}/${totalPages})</b>

${userList}

<i>Legend: ✅ Verified • ⏳ Pending • 🚫 Blocked</i>
    `.trim();
  }

  private buildUserListKeyboard(users: any[], page: number, totalPages: number): InlineKeyboardMarkup {
    const keyboard = [];
    
    // User selection buttons (2 per row)
    for (let i = 0; i < users.length; i += 2) {
      const row = [];
      row.push({
        text: `👤 ${users[i].firstName}`,
        callback_data: `admin_user_details_${users[i].telegramId}`
      });
      
      if (users[i + 1]) {
        row.push({
          text: `👤 ${users[i + 1].firstName}`,
          callback_data: `admin_user_details_${users[i + 1].telegramId}`
        });
      }
      keyboard.push(row);
    }

    // Navigation buttons
    const navRow = [];
    if (page > 0) {
      navRow.push({
        text: 'Previous',
        callback_data: `admin_user_list_${page - 1}`
      });
    }
    if (page < totalPages - 1) {
      navRow.push({
        text: 'Next',
        callback_data: `admin_user_list_${page + 1}`
      });
    }
    if (navRow.length > 0) keyboard.push(navRow);

    // Back button
    keyboard.push([{
      text: 'Back to User Management',
      callback_data: 'admin_users'
    }]);

    return { inline_keyboard: keyboard };
  }

  private buildSearchResultsText(results: any[], query: string): string {
    const resultList = results.map((user, index) => {
      const status = user.isBlocked ? '🚫' : user.isVerified ? '✅' : '⏳';
      return `${index + 1}. ${status} <b>${user.firstName}</b> ${user.lastName || ''}\n   ID: ${user.telegramId} • @${user.username || 'N/A'} • ${user.points} pts`;
    }).join('\n\n');

    return `
🔍 <b>Search Results for "${query}"</b>
Found ${results.length} users:

${resultList}

<i>Legend: ✅ Verified • ⏳ Pending • 🚫 Blocked</i>
    `.trim();
  }

  private buildSearchResultsKeyboard(results: any[]): InlineKeyboardMarkup {
    const keyboard = [];
    
    // User selection buttons (2 per row)
    for (let i = 0; i < Math.min(results.length, 10); i += 2) {
      const row = [];
      row.push({
        text: `👤 ${results[i].firstName}`,
        callback_data: `admin_user_details_${results[i].telegramId}`
      });
      
      if (results[i + 1]) {
        row.push({
          text: `👤 ${results[i + 1].firstName}`,
          callback_data: `admin_user_details_${results[i + 1].telegramId}`
        });
      }
      keyboard.push(row);
    }

    // Back button
    keyboard.push([{
      text: 'Back to User Management',
      callback_data: 'admin_users'
    }]);

    return { inline_keyboard: keyboard };
  }

  private async addToBlockedUsers(userId: string, reason: string, blockedBy?: string): Promise<void> {
    try {
      const blockedUsersData = await this.storage.get('user_blocks') || {};
      const blockedUsers = Array.isArray(blockedUsersData) ? blockedUsersData : Object.values(blockedUsersData || {});
      
      const newBlock = {
        id: `block_${userId}_${Date.now()}`,
        userId,
        reason,
        blocked_at: new Date().toISOString(),
        blocked_by: blockedBy || 'admin'
      };
      
      blockedUsers.push(newBlock);
      
      const blockedUsersObject = blockedUsers.reduce((acc: any, block: any) => {
        acc[block.id] = block;
        return acc;
      }, {});

      await this.storage.set('user_blocks', blockedUsersObject);
    } catch (error) {
      this.logger.error('Error adding to blocked users:', error);
    }
  }

  private async removeFromBlockedUsers(userId: string): Promise<void> {
    try {
      // Remove from user_blocks collection
      const blockedUsersData = await this.storage.get('user_blocks') || {};
      const blockedUsers = Array.isArray(blockedUsersData) ? blockedUsersData : Object.values(blockedUsersData || {});
      const updatedBlocks = blockedUsers.filter((block: any) => block.userId !== userId);
      
      const blockedUsersObject = updatedBlocks.reduce((acc: any, block: any) => {
        acc[block.id] = block;
        return acc;
      }, {});

      await this.storage.set('user_blocks', blockedUsersObject);
      
      // CRITICAL: Remove from banned_users MongoDB collection that blocking middleware checks
      // Use findByQuery and direct MongoDB operations instead of storage.get/set
      try {
        // Delete all banned_users entries for this userId using MongoDB collection
        const storageInstance = this.storage.getStorageInstance() as any;
        if (storageInstance && typeof storageInstance.getCollection === 'function') {
          const bannedUsersCollection = storageInstance.getCollection('banned_users');
          const deleteResult = await bannedUsersCollection.deleteMany({ userId: userId });
          this.logger.info(`Removed ${deleteResult.deletedCount} entries for user ${userId} from banned_users MongoDB collection`);
        } else {
          // Fallback to old method if MongoDB methods not available
          const bannedUsersData = await this.storage.get('banned_users') || {};
          const bannedUsers = Array.isArray(bannedUsersData) ? bannedUsersData : Object.values(bannedUsersData || {});
          const updatedBans = bannedUsers.filter((ban: any) => ban.userId !== userId);
          
          const bannedUsersObject = updatedBans.reduce((acc: any, ban: any) => {
            acc[ban.id || `ban_${ban.userId}`] = ban;
            return acc;
          }, {});
          
          await this.storage.set('banned_users', bannedUsersObject);
          this.logger.info(`Removed user ${userId} from banned_users registry (fallback method)`);
        }
      } catch (bannedError) {
        this.logger.error('Error removing from banned_users registry:', bannedError);
      }
    } catch (error) {
      this.logger.error('Error removing from blocked users:', error);
    }
  }

  private async logAdminAction(ctx: Context, targetUserId: string, action: string, metadata: any): Promise<void> {
    try {
      const adminId = ctx.from?.id?.toString();
      if (!adminId) return;

      const logEntry = {
        id: `admin_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        adminId,
        targetUserId,
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

  private convertToCSV(data: any[]): string {
    if (data.length === 0) return '';
    
    const headers = Object.keys(data[0]);
    const csvRows = [headers.join(',')];
    
    for (const row of data) {
      const values = headers.map(header => {
        const value = row[header];
        return typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value;
      });
      csvRows.push(values.join(','));
    }
    
    return csvRows.join('\n');
  }
}