import { Context } from 'telegraf';
import { IAdminAuthorizationService } from '../../interfaces/admin-services.interface';
import { Logger } from '../logger';
import { getConfig } from '../../config';

/**
 * Service for admin authorization and access control
 */
export class AdminAuthorizationService implements IAdminAuthorizationService {
  private readonly logger = Logger.getInstance();
  private readonly config = getConfig();

  /**
   * Check if user is admin
   */
  isAdmin(userId: string): boolean {
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
  isSuperAdmin(userId: string): boolean {
    try {
      const superAdmins = this.config.admin.superAdmins || [];
      return superAdmins.includes(userId);
    } catch (error) {
      this.logger.error('Error checking super admin status:', error);
      return false;
    }
  }

  /**
   * Check admin access for context with optional super admin requirement
   */
  async checkAdminAccess(ctx: Context, requireSuperAdmin: boolean = false): Promise<boolean> {
    try {
      const userId = ctx.from?.id?.toString();
      if (!userId) {
        await ctx.reply('❌ Access denied. User identification required.');
        return false;
      }

      if (requireSuperAdmin) {
        if (!this.isSuperAdmin(userId)) {
          await ctx.reply('❌ Access denied. Super admin privileges required.');
          return false;
        }
      } else {
        if (!this.isAdmin(userId)) {
          await ctx.reply('❌ Access denied. Admin privileges required.');
          return false;
        }
      }

      return true;
    } catch (error) {
      this.logger.error('Error checking admin access:', error);
      await ctx.reply('❌ An error occurred while checking access permissions.');
      return false;
    }
  }

  /**
   * Get admin level for user
   */
  getAdminLevel(userId: string): 'none' | 'admin' | 'super_admin' {
    try {
      if (this.isSuperAdmin(userId)) {
        return 'super_admin';
      } else if (this.isAdmin(userId)) {
        return 'admin';
      }
      return 'none';
    } catch (error) {
      this.logger.error('Error getting admin level:', error);
      return 'none';
    }
  }
}