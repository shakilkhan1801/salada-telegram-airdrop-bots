/**
 * Admin Authentication Service
 * Handles admin role verification and permissions
 * Extracted from monolithic AdminHandler class
 */

import { BaseService, ServiceIdentifiers } from '../../core/container';
import { IAdminAuthService, ILogger, IStorageManager, IConfig } from '../../core/interfaces';
import { AdminUser, AdminRole, AdminPermission } from '../../types/admin.types';
import { MemoryManager, ManagedCache } from '../memory-manager.service';

export interface AdminSession {
  adminId: string;
  role: AdminRole;
  permissions: AdminPermission[];
  loginTime: Date;
  lastActivity: Date;
  ipAddress?: string;
  deviceFingerprint?: string;
}

export class AdminAuthService extends BaseService implements IAdminAuthService {
  private readonly logger: ILogger;
  private readonly storage: IStorageManager;
  private readonly config: IConfig;
  private readonly memoryManager = MemoryManager.getInstance();
  private readonly adminCache: ManagedCache<string, AdminUser>;
  private readonly sessionCache: ManagedCache<string, AdminSession>;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  constructor() {
    super();
    this.logger = this.resolve<ILogger>(ServiceIdentifiers.Logger);
    this.storage = this.resolve<IStorageManager>(ServiceIdentifiers.Storage);
    this.config = this.resolve<IConfig>(ServiceIdentifiers.Config);
    
    // Initialize LRU caches instead of unbounded Maps
    this.adminCache = this.memoryManager.createCache<string, AdminUser>(
      'admin-auth-cache',
      'Admin user cache with LRU eviction',
      {
        max: 1000, // Max 1000 admin users cached
        ttl: this.CACHE_TTL
      }
    );
    
    this.sessionCache = this.memoryManager.createCache<string, AdminSession>(
      'admin-session-cache',
      'Admin session cache with LRU eviction',
      {
        max: 5000, // Max 5000 concurrent admin sessions
        ttl: 60 * 60 * 1000 // 1 hour TTL for sessions
      }
    );
  }

  /**
   * Check if user is an admin (any level)
   */
  public async isAdmin(userId: string): Promise<boolean> {
    try {
      const adminUser = await this.getAdminUser(userId);
      return adminUser !== null && adminUser.isActive;
    } catch (error) {
      this.logger.error('Error checking admin status:', error);
      return false;
    }
  }

  /**
   * Check if user is a super admin
   */
  public async isSuperAdmin(userId: string): Promise<boolean> {
    try {
      const adminUser = await this.getAdminUser(userId);
      return adminUser !== null && adminUser.isActive && adminUser.role === 'super_admin';
    } catch (error) {
      this.logger.error('Error checking super admin status:', error);
      return false;
    }
  }

  /**
   * Get admin role for user
   */
  public async getAdminRole(userId: string): Promise<AdminRole | null> {
    try {
      const adminUser = await this.getAdminUser(userId);
      return adminUser?.isActive ? adminUser.role : null;
    } catch (error) {
      this.logger.error('Error getting admin role:', error);
      return null;
    }
  }

  /**
   * Validate admin permission
   */
  public async validateAdminPermission(userId: string, permission: AdminPermission): Promise<boolean> {
    try {
      const adminUser = await this.getAdminUser(userId);
      
      if (!adminUser || !adminUser.isActive) {
        return false;
      }

      // Super admin has all permissions
      if (adminUser.role === 'super_admin') {
        return true;
      }

      // Check if user has 'all' permission
      if (adminUser.permissions.includes('all')) {
        return true;
      }

      // Check specific permission
      return adminUser.permissions.includes(permission);
      
    } catch (error) {
      this.logger.error('Error validating admin permission:', error);
      return false;
    }
  }

  /**
   * Get admin user details
   */
  public async getAdminUserDetails(userId: string): Promise<AdminUser | null> {
    try {
      return await this.getAdminUser(userId);
    } catch (error) {
      this.logger.error('Error getting admin user details:', error);
      return null;
    }
  }

  /**
   * Get all admin permissions for user
   */
  public async getAdminPermissions(userId: string): Promise<AdminPermission[]> {
    try {
      const adminUser = await this.getAdminUser(userId);
      
      if (!adminUser || !adminUser.isActive) {
        return [];
      }

      // Super admin gets all permissions
      if (adminUser.role === 'super_admin') {
        return this.getAllPermissions();
      }

      return adminUser.permissions;
      
    } catch (error) {
      this.logger.error('Error getting admin permissions:', error);
      return [];
    }
  }

  /**
   * Check multiple permissions at once
   */
  public async validateMultiplePermissions(
    userId: string, 
    permissions: AdminPermission[]
  ): Promise<{ [key in AdminPermission]?: boolean }> {
    try {
      const result: { [key in AdminPermission]?: boolean } = {};
      
      for (const permission of permissions) {
        result[permission] = await this.validateAdminPermission(userId, permission);
      }
      
      return result;
      
    } catch (error) {
      this.logger.error('Error validating multiple permissions:', error);
      return {};
    }
  }

  /**
   * Create admin session
   */
  public async createAdminSession(
    userId: string,
    ipAddress?: string,
    deviceFingerprint?: string
  ): Promise<AdminSession | null> {
    try {
      const adminUser = await this.getAdminUser(userId);
      
      if (!adminUser || !adminUser.isActive) {
        return null;
      }

      const session: AdminSession = {
        adminId: userId,
        role: adminUser.role,
        permissions: adminUser.permissions,
        loginTime: new Date(),
        lastActivity: new Date(),
        ipAddress,
        deviceFingerprint
      };

      this.sessionCache.set(userId, session);
      
      this.logger.info(`Admin session created for ${adminUser.username}`, {
        adminId: userId,
        role: adminUser.role,
        ipAddress
      });

      return session;
      
    } catch (error) {
      this.logger.error('Error creating admin session:', error);
      return null;
    }
  }

  /**
   * Get admin session
   */
  public async getAdminSession(userId: string): Promise<AdminSession | null> {
    try {
      const session = this.sessionCache.get(userId);
      
      if (session) {
        // Update last activity
        session.lastActivity = new Date();
        return session;
      }
      
      return null;
      
    } catch (error) {
      this.logger.error('Error getting admin session:', error);
      return null;
    }
  }

  /**
   * Invalidate admin session
   */
  public async invalidateAdminSession(userId: string): Promise<void> {
    try {
      this.sessionCache.delete(userId);
      
      this.logger.info(`Admin session invalidated for ${userId}`);
      
    } catch (error) {
      this.logger.error('Error invalidating admin session:', error);
    }
  }

  /**
   * Check if admin role can perform action on target role
   */
  public canManageRole(adminRole: AdminRole, targetRole: AdminRole): boolean {
    const roleHierarchy: { [key in AdminRole]: number } = {
      'viewer': 1,
      'support': 2,
      'moderator': 3,
      'admin': 4,
      'super_admin': 5
    };

    return roleHierarchy[adminRole] > roleHierarchy[targetRole];
  }

  /**
   * Get admin statistics
   */
  public async getAdminStats(): Promise<{
    totalAdmins: number;
    activeAdmins: number;
    roleDistribution: { [key in AdminRole]: number };
    recentLogins: number;
  }> {
    try {
      const allAdmins = await this.getAllAdmins();
      
      const stats = {
        totalAdmins: allAdmins.length,
        activeAdmins: allAdmins.filter(admin => admin.isActive).length,
        roleDistribution: {
          'viewer': 0,
          'support': 0,
          'moderator': 0,
          'admin': 0,
          'super_admin': 0
        } as { [key in AdminRole]: number },
        recentLogins: 0
      };

      // Calculate role distribution
      for (const admin of allAdmins) {
        if (admin.isActive) {
          stats.roleDistribution[admin.role]++;
        }
      }

      // Calculate recent logins (last 24 hours)
      const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      stats.recentLogins = allAdmins.filter(admin => 
        admin.lastLoginAt && new Date(admin.lastLoginAt) > dayAgo
      ).length;

      return stats;
      
    } catch (error) {
      this.logger.error('Error getting admin stats:', error);
      return {
        totalAdmins: 0,
        activeAdmins: 0,
        roleDistribution: {
          'viewer': 0,
          'support': 0,
          'moderator': 0,
          'admin': 0,
          'super_admin': 0
        },
        recentLogins: 0
      };
    }
  }

  /**
   * Cleanup expired cache entries
   */
  public cleanupExpiredCache(): void {
    try {
      const now = Date.now();
      
      // Admin cache uses TTL-based eviction; no manual cleanup needed here.

      // Cleanup session cache (sessions older than 24 hours)
      const sessionTTL = 24 * 60 * 60 * 1000; // 24 hours
      for (const [userId, session] of this.sessionCache.entries()) {
        if ((now - session.lastActivity.getTime()) > sessionTTL) {
          this.sessionCache.delete(userId);
        }
      }

      this.logger.debug('Cache cleanup completed');
      
    } catch (error) {
      this.logger.error('Error during cache cleanup:', error);
    }
  }

  // Private helper methods

  private async getAdminUser(userId: string): Promise<AdminUser | null> {
    try {
      // Check LRU cache first - TTL is handled automatically
      const cached = this.adminCache.get(userId);
      if (cached) {
        return cached;
      }

      // Find admin by user ID or telegram ID
      const adminUsers = await this.storage.list('admin_users');
      
      for (const adminId of adminUsers) {
        const admin = await this.storage.get<AdminUser>('admin_users', adminId);
        if (admin && (admin.id === userId || admin.telegramId === userId)) {
          // Cache the result - TTL is handled automatically
          this.adminCache.set(userId, admin);
          return admin;
        }
      }
      
      return null;
      
    } catch (error) {
      this.logger.error('Error retrieving admin user:', error);
      return null;
    }
  }

  private async getAllAdmins(): Promise<AdminUser[]> {
    try {
      const adminIds = await this.storage.list('admin_users');
      const admins: AdminUser[] = [];
      
      for (const adminId of adminIds) {
        const admin = await this.storage.get<AdminUser>('admin_users', adminId);
        if (admin) {
          admins.push(admin);
        }
      }
      
      return admins;
      
    } catch (error) {
      this.logger.error('Error getting all admins:', error);
      return [];
    }
  }

  private getAllPermissions(): AdminPermission[] {
    return [
      'all',
      'users.read',
      'users.write',
      'users.view',
      'users.edit',
      'users.block',
      'users.unblock',
      'users.delete',
      'tasks.read',
      'tasks.write',
      'tasks.view',
      'tasks.create',
      'tasks.edit',
      'tasks.delete',
      'submissions.view',
      'submissions.approve',
      'submissions.reject',
      'broadcasts.view',
      'broadcasts.send',
      'analytics.view',
      'security.read',
      'security.view',
      'security.manage',
      'settings.view',
      'settings.edit',
      'system.backup',
      'system.restore'
    ];
  }

  /**
   * Dispose of resources
   */
  public async dispose(): Promise<void> {
    this.adminCache.clear();
    this.sessionCache.clear();
  }
}