import { Context } from 'telegraf';
import { InlineKeyboardMarkup } from 'telegraf/typings/core/types/typegram';

/**
 * Interface for admin authorization
 */
export interface IAdminAuthorizationService {
  isAdmin(userId: string): boolean;
  isSuperAdmin(userId: string): boolean;
  checkAdminAccess(ctx: Context, requireSuperAdmin?: boolean): Promise<boolean>;
  getAdminLevel(userId: string): 'none' | 'admin' | 'super_admin';
}

/**
 * Interface for system statistics
 */
export interface ISystemStatsService {
  getSystemStats(): Promise<any>;
  getSystemStatsText(stats: any): string;
  getSystemStatsKeyboard(): InlineKeyboardMarkup;
  getUserStats(): Promise<any>;
  getTaskStats(): Promise<any>;
  getSecurityStats(): Promise<any>;
  getClaimStats(): Promise<any>;
  getPerformanceMetrics(): Promise<any>;
}

/**
 * Interface for user management operations
 */
export interface IUserManagementService {
  showUserManagement(ctx: Context): Promise<void>;
  showUserList(ctx: Context, page?: number): Promise<void>;
  showUserDetails(ctx: Context, userId: string): Promise<void>;
  banUser(ctx: Context, userId: string, reason?: string): Promise<void>;
  unbanUser(ctx: Context, userId: string): Promise<void>;
  adjustUserPoints(ctx: Context, userId: string, amount: number, reason?: string): Promise<void>;
  deleteUser(ctx: Context, userId: string): Promise<void>;
  searchUsers(ctx: Context, query: string): Promise<void>;
  exportUserData(ctx: Context): Promise<void>;
}

/**
 * Interface for task management operations
 */
export interface ITaskManagementService {
  showTaskManagement(ctx: Context): Promise<void>;
  createTask(ctx: Context): Promise<void>;
  editTask(ctx: Context, taskId: string): Promise<void>;
  deleteTask(ctx: Context, taskId: string): Promise<void>;
  toggleTaskStatus(ctx: Context, taskId: string): Promise<void>;
  showTaskSubmissions(ctx: Context, taskId?: string): Promise<void>;
  approveSubmission(ctx: Context, submissionId: string): Promise<void>;
  rejectSubmission(ctx: Context, submissionId: string, reason?: string): Promise<void>;
  getTaskAnalytics(ctx: Context): Promise<void>;
}

/**
 * Interface for security control operations
 */
export interface ISecurityControlService {
  showSecurityPanel(ctx: Context): Promise<void>;
  viewSecurityLogs(ctx: Context): Promise<void>;
  blockIpAddress(ctx: Context, ipAddress: string): Promise<void>;
  unblockIpAddress(ctx: Context, ipAddress: string): Promise<void>;
  showSuspiciousActivity(ctx: Context): Promise<void>;
  performSecurityScan(ctx: Context): Promise<void>;
  updateSecuritySettings(ctx: Context): Promise<void>;
  exportSecurityReport(ctx: Context): Promise<void>;
}

/**
 * Interface for admin UI generation
 */
export interface IAdminUIService {
  getAdminPanelText(): Promise<string>;
  getAdminPanelKeyboard(isSuperAdmin: boolean): InlineKeyboardMarkup;
  getUserManagementKeyboard(page?: number): InlineKeyboardMarkup;
  getTaskManagementKeyboard(): InlineKeyboardMarkup;
  getSecurityPanelKeyboard(): InlineKeyboardMarkup;
  getUserActionKeyboard(userId: string): InlineKeyboardMarkup;
  getTaskActionKeyboard(taskId: string): InlineKeyboardMarkup;
  formatUserInfo(user: any): string;
  formatTaskInfo(task: any): string;
  formatSecurityEvent(event: any): string;
}