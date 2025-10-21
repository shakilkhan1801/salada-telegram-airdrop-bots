import { Logger } from './logger';
import { storage } from '../storage/index';
import { User } from '../types/user.types';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import TelegramBot from 'node-telegram-bot-api';

export interface UserExportData {
  id: string;
  telegramId: string;
  username: string;
  firstName: string;
  lastName: string;
  isVerified: boolean;
  isBlocked: boolean;
  blockReason?: string;
  currentPoints: number;
  totalEarnedPoints: number;
  spentPoints: number;
  tasksCompleted: number;
  totalReferrals: number;
  walletAddress?: string;
  registeredAt: string;
  lastActiveAt: string;
  country?: string;
  isPremium: boolean;
  riskScore?: number;
}

export interface ExportStats {
  totalUsers: number;
  verifiedUsers: number;
  blockedUsers: number;
  activeUsers: number;
  premiumUsers: number;
  usersWithWallet: number;
  averagePoints: number;
  topCountries: { country: string; count: number }[];
  exportedAt: string;
}

/**
 * Service for automated user data export and admin notification
 */
export class UserDataExportService {
  private static instance: UserDataExportService;
  private readonly logger = Logger.getInstance();
  private botToken?: string;
  private adminChatId?: string;

  private constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN;
    this.adminChatId = process.env.ADMIN_CHAT_ID || process.env.ADMIN_TELEGRAM_ID;
  }

  static getInstance(): UserDataExportService {
    if (!UserDataExportService.instance) {
      UserDataExportService.instance = new UserDataExportService();
    }
    return UserDataExportService.instance;
  }

  /**
   * Main method to export user data and send to admin
   */
  async exportAndSendUserData(): Promise<{ success: boolean; message: string; stats?: ExportStats }> {
    return await this.exportAndSendUserDataStreaming();
  }

  private async exportAndSendUserDataStreaming(): Promise<{ success: boolean; message: string; stats?: ExportStats }> {
    try {
      this.logger.info('🔄 Starting automated user data export (streaming)...');

      const fileName = `user_data_export_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
      const filePath = path.join(process.cwd(), 'exports', fileName);
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      const stream = fsSync.createWriteStream(filePath, { encoding: 'utf8' });
      const headers = [
        'id','telegramId','username','firstName','lastName','isVerified','isBlocked','blockReason','currentPoints','totalEarnedPoints','spentPoints','tasksCompleted','totalReferrals','walletAddress','registeredAt','lastActiveAt','country','isPremium','riskScore'
      ];
      stream.write(headers.join(',') + '\n');

      const { storage } = await import('../storage');
      const ids = await storage.list('users');
      if (!ids || ids.length === 0) {
        const message = 'No users found to export';
        this.logger.warn(message);
        stream.end();
        return { success: false, message };
      }

      let totalUsers = 0;
      let verifiedUsers = 0;
      let blockedUsers = 0;
      let premiumUsers = 0;
      let usersWithWallet = 0;
      let totalPoints = 0;
      const countryCount: Record<string, number> = {};

      const chunkSize = 1000;
      for (let i = 0; i < ids.length; i += chunkSize) {
        const slice = ids.slice(i, i + chunkSize);
        for (const id of slice) {
          try {
            const user = await storage.get<any>('users', id);
            if (!user) continue;
            const row = this.convertToExportFormat(user);

            totalUsers += 1;
            if (row.isVerified) verifiedUsers += 1;
            if (row.isBlocked) blockedUsers += 1;
            if (row.isPremium) premiumUsers += 1;
            if (row.walletAddress) usersWithWallet += 1;
            totalPoints += row.currentPoints || 0;
            if (row.country) countryCount[row.country] = (countryCount[row.country] || 0) + 1;

            const vals = [
              row.id,
              row.telegramId,
              row.username,
              row.firstName,
              row.lastName,
              String(row.isVerified),
              String(row.isBlocked),
              row.blockReason || '',
              String(row.currentPoints ?? 0),
              String(row.totalEarnedPoints ?? 0),
              String(row.spentPoints ?? 0),
              String(row.tasksCompleted ?? 0),
              String(row.totalReferrals ?? 0),
              row.walletAddress || '',
              row.registeredAt,
              row.lastActiveAt,
              row.country || '',
              String(row.isPremium ?? false),
              row.riskScore !== undefined ? String(row.riskScore) : ''
            ].map((v) => {
              const s = String(v ?? '');
              return (s.includes(',') || s.includes('"')) ? '"' + s.replace(/"/g, '""') + '"' : s;
            });
            stream.write(vals.join(',') + '\n');
          } catch {}
        }
      }

      const averagePoints = totalUsers > 0 ? Math.round(totalPoints / totalUsers) : 0;
      const topCountries = Object.entries(countryCount)
        .sort((a,b) => b[1]-a[1])
        .slice(0, 10)
        .map(([country, count]) => ({ country, count }));

      const stats: ExportStats = {
        totalUsers,
        verifiedUsers,
        blockedUsers,
        activeUsers: 0,
        premiumUsers,
        usersWithWallet,
        averagePoints,
        topCountries,
        exportedAt: new Date().toISOString()
      };

      await new Promise<void>((resolve, reject) => {
        stream.end(() => resolve());
        stream.on('error', reject);
      });

      const sendResult = await this.sendToAdmin(filePath, fileName, stats);
      if (!sendResult.success) {
        this.logger.error('Failed to send export to admin:', sendResult.error);
        return { success: false, message: `Export created but failed to send: ${sendResult.error}`, stats };
      }

      try { await fs.unlink(filePath); } catch {}

      const message = `Successfully exported ${totalUsers} users and sent to admin`;
      this.logger.info(message, { totalUsers, fileName });
      return { success: true, message, stats };

    } catch (error) {
      const errorMessage = `Failed to export user data: ${error instanceof Error ? error.message : 'Unknown error'}`;
      this.logger.error(errorMessage, error);
      return { success: false, message: errorMessage };
    }
  }



  /**
   * Convert user to export format
   */
  private convertToExportFormat(user: User): UserExportData {
    // Calculate spent points from points history
    let spentPoints = 0;
    let totalEarnedFromHistory = 0;
    
    if (user.pointsHistory && Array.isArray(user.pointsHistory)) {
      for (const transaction of user.pointsHistory) {
        if (transaction.type === 'spent') {
          spentPoints += Math.abs(transaction.amount);
        } else if (transaction.type === 'earned' || transaction.type === 'bonus' || transaction.type === 'referral') {
          totalEarnedFromHistory += Math.abs(transaction.amount);
        }
      }
    }
    
    // Use totalEarned from user if available, otherwise use calculated from history
    const totalEarnedPoints = user.totalEarned || totalEarnedFromHistory || 0;
    
    // If no spent points in history, try to calculate from totalEarned - currentPoints
    if (spentPoints === 0 && totalEarnedPoints > 0 && user.points < totalEarnedPoints) {
      spentPoints = totalEarnedPoints - user.points;
    }
    
    return {
      id: user.id,
      telegramId: user.telegramId.toString(),
      username: user.username || '',
      firstName: user.firstName || '',
      lastName: user.lastName || '',
      isVerified: user.isVerified,
      isBlocked: user.isBlocked,
      blockReason: user.blockReason,
      currentPoints: user.points,
      totalEarnedPoints: totalEarnedPoints,
      spentPoints: spentPoints,
      tasksCompleted: user.tasksCompleted || 0,
      totalReferrals: user.totalReferrals || 0,
      walletAddress: user.walletAddress,
      registeredAt: user.registeredAt,
      lastActiveAt: user.lastActiveAt || user.registeredAt,
      country: user.country,
      isPremium: user.isPremium || false,
      riskScore: user.riskScore
    };
  }





  /**
   * Send CSV file to admin via Telegram
   */
  private async sendToAdmin(filePath: string, fileName: string, stats: ExportStats): Promise<{ success: boolean; error?: string }> {
    if (!this.botToken || !this.adminChatId) {
      return { success: false, error: 'Bot token (TELEGRAM_BOT_TOKEN/BOT_TOKEN) or ADMIN_CHAT_ID not configured' };
    }

    try {
      const bot = new TelegramBot(this.botToken);

      // Create stats message
      const statsMessage = `
📊 **User Data Export Report**

📅 Export Time: ${new Date(stats.exportedAt).toLocaleString()}
👥 Total Users: ${stats.totalUsers}
✅ Verified Users: ${stats.verifiedUsers}
🚫 Blocked Users: ${stats.blockedUsers}
🔥 Active Users (7 days): ${stats.activeUsers}
⭐ Premium Users: ${stats.premiumUsers}
💳 Users with Wallet: ${stats.usersWithWallet}
💰 Average Points: ${stats.averagePoints}

🌍 **Top Countries:**
${stats.topCountries.map(c => `${c.country}: ${c.count} users`).join('\n')}

📁 CSV file attached below.
`.trim();

      // Send stats message first
      await bot.sendMessage(this.adminChatId, statsMessage, { parse_mode: 'Markdown' });

      // Send CSV file
      await bot.sendDocument(this.adminChatId, filePath, {
        caption: `User Data Export - ${fileName}`
      });

      return { success: true };

    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error sending to admin' 
      };
    }
  }



  /**
   * Health check method
   */
  async healthCheck(): Promise<{ healthy: boolean; message: string; lastExport?: string }> {
    try {
      const exportsDir = path.join(process.cwd(), 'exports');
      let lastExport: string | undefined;

      try {
        const files = await fs.readdir(exportsDir);
        const csvFiles = files.filter(f => f.endsWith('.csv')).sort().reverse();
        if (csvFiles.length > 0) {
          lastExport = csvFiles[0];
        }
      } catch (dirError) {
        // Directory doesn't exist yet, that's ok
      }

      const hasRequiredConfig = !!(this.botToken && this.adminChatId);
      
      return {
        healthy: hasRequiredConfig,
        message: hasRequiredConfig ? 
          'User data export service is configured and ready' : 
          'Missing bot token or admin chat ID configuration',
        lastExport
      };
    } catch (error) {
      return {
        healthy: false,
        message: `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
      };
    }
  }
}

// Export singleton instance
export default UserDataExportService.getInstance();