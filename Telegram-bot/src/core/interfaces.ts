/**
 * Core Service Interfaces for Dependency Injection
 * Defines contracts for all major services to enable proper abstraction
 */

import { Context, Telegraf, Scenes } from 'telegraf';
import { BotCommand } from 'telegraf/typings/core/types/typegram';

// Common types
export interface ServiceResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  metadata?: Record<string, any>;
}

export interface PaginatedResponse<T> extends ServiceResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}

export interface UIComponents {
  text: string;
  keyboard?: any;
  options?: any;
}

// =============================================================================
// CORE SERVICE INTERFACES
// =============================================================================

export interface ILogger {
  info(message: string, metadata?: any): void;
  error(message: string, error?: any): void;
  warn(message: string, metadata?: any): void;
  debug(message: string, metadata?: any): void;
}

export interface IConfig {
  bot: {
    token: string;
    webhookUrl?: string;
  };
  security: {
    adminJwtSecret: string;
    refreshTokenSecret: string;
    strictIpBinding?: boolean;
  };
  storage: {
    type: 'file' | 'mongodb';
    connectionString?: string;
  };
}

export interface IStorageManager {
  get<T>(namespace: string, key: string): Promise<T | null>;
  set<T>(namespace: string, data: T, key?: string): Promise<void>;
  update<T>(namespace: string, updates: Partial<T>, key: string): Promise<void>;
  delete(namespace: string, key: string): Promise<void>;
  list(namespace: string): Promise<string[]>;
  getAll<T>(namespace: string): Promise<T[]>;
}

export interface ISecurityManager {
  validateUser(userId: string, context: any): Promise<boolean>;
  checkMultiAccount(userId: string, fingerprint: any): Promise<{ isValid: boolean; reason?: string }>;
  logSecurityEvent(event: any): Promise<void>;
}

// =============================================================================
// BOT SERVICE INTERFACES
// =============================================================================

export interface IBotLifecycleService {
  initializeBot(bot: Telegraf): Promise<void>;
  startBot(): Promise<void>;
  stopBot(): Promise<void>;
  setupMiddleware(): Promise<void>;
  setupErrorHandling(): Promise<void>;
}

export interface ICommandRegistrationService {
  registerCommands(bot: Telegraf): Promise<void>;
  registerBotCommands(commands: BotCommand[]): Promise<void>;
  getAvailableCommands(userId?: string): Promise<BotCommand[]>;
}

export interface IRequestRoutingService {
  routeCallback(ctx: Context, callbackData: string): Promise<void>;
  routeTextMessage(ctx: Context): Promise<void>;
  routeDocument(ctx: Context): Promise<void>;
  routeWebAppData(ctx: Context): Promise<void>;
  handleUnknownRoute(ctx: Context): Promise<void>;
}

export interface IUserRegistrationService {
  registerNewUser(ctx: Context): Promise<{ success: boolean; user?: any; error?: string }>;
  validateUserExists(userId: string): Promise<boolean>;
  processReferralCode(userId: string, referralCode: string): Promise<void>;
  sendWelcomeMessage(ctx: Context, userData: any): Promise<void>;
}

export interface IUserSessionService {
  createSession(userId: string, context: any): Promise<string>;
  getSession(sessionId: string): Promise<any>;
  updateSession(sessionId: string, data: any): Promise<void>;
  invalidateSession(sessionId: string): Promise<void>;
  cleanupExpiredSessions(): Promise<number>;
}

export interface ICaptchaOrchestrationService {
  shouldRequireCaptcha(userId: string): Promise<boolean>;
  initiateCaptchaFlow(ctx: Context, userId: string): Promise<void>;
  handleCaptchaResponse(ctx: Context, response: any): Promise<{ verified: boolean; reason?: string }>;
  completeCaptchaFlow(ctx: Context, userId: string): Promise<void>;
}

export interface IBotMonitoringService {
  collectStatistics(): Promise<any>;
  performHealthCheck(): Promise<{ healthy: boolean; checks: any[] }>;
  getPerformanceMetrics(): Promise<any>;
  reportMetric(name: string, value: number, tags?: Record<string, string>): Promise<void>;
}

export interface IBroadcastService {
  sendBroadcast(
    message: string,
    targetUsers: string[],
    options?: { batchSize?: number; delay?: number }
  ): Promise<{ sent: number; failed: number; errors: any[] }>;
  getBroadcastStatus(broadcastId: string): Promise<any>;
}

// =============================================================================
// ADMIN SERVICE INTERFACES
// =============================================================================

export interface IAdminAuthService {
  isAdmin(userId: string): Promise<boolean>;
  isSuperAdmin(userId: string): Promise<boolean>;
  getAdminRole(userId: string): Promise<string | null>;
  validateAdminPermission(userId: string, permission: string): Promise<boolean>;
}

export interface IAdminUIService {
  generateAdminPanel(adminId: string): Promise<UIComponents>;
  generateSystemStats(): Promise<UIComponents>;
  generateUserManagement(): Promise<UIComponents>;
  generateTaskManagement(): Promise<UIComponents>;
  generateSecurityOverview(): Promise<UIComponents>;
  generateKeyboard(type: string, options?: any): any;
}

export interface IAdminAnalyticsService {
  getTaskAnalytics(dateRange?: { from: Date; to: Date }): Promise<any>;
  getUserAnalytics(dateRange?: { from: Date; to: Date }): Promise<any>;
  getPerformanceAnalytics(): Promise<any>;
  generateReport(type: 'tasks' | 'users' | 'performance', options?: any): Promise<any>;
  exportData(type: string, format: 'csv' | 'json'): Promise<Buffer>;
}

export interface IAdminStatsService {
  getSystemStats(): Promise<{
    users: { total: number; active: number; new: number };
    tasks: { total: number; completed: number; pending: number };
    system: { uptime: number; memory: any; performance: any };
  }>;
  getUserStats(): Promise<any>;
  getTaskStats(): Promise<any>;
  getCacheStatistics(): Promise<any>;
}

export interface IAdminSecurityService {
  getSecurityOverview(): Promise<{
    threats: { level: string; count: number }[];
    blockedUsers: number;
    flaggedAccounts: number;
    recentEvents: any[];
  }>;
  performSecurityScan(): Promise<{ findings: any[]; recommendations: string[] }>;
  getFlaggedUsers(): Promise<any[]>;
  banUser(userId: string, reason: string, duration?: number): Promise<void>;
  unbanUser(userId: string): Promise<void>;
}

export interface IAdminTaskReviewService {
  getTaskReviewQueue(page?: number, limit?: number): Promise<PaginatedResponse<any>>;
  approveTask(taskId: string, adminId: string, notes?: string): Promise<void>;
  rejectTask(taskId: string, adminId: string, reason: string): Promise<void>;
  bulkApproval(taskIds: string[], adminId: string): Promise<{ approved: number; failed: number }>;
  getTaskDetails(taskId: string): Promise<any>;
}

export interface ISystemAdminService {
  performBackup(): Promise<{ success: boolean; backupId: string; size: number }>;
  getSystemLogs(level?: string, limit?: number): Promise<any[]>;
  clearCache(cacheType?: string): Promise<void>;
  restartService(serviceName: string): Promise<void>;
  getSystemHealth(): Promise<any>;
}

export interface IAdminSceneService {
  getAdminScenes(): Scenes.Stage<any>;
  createBroadcastScene(): Scenes.WizardScene<any>;
  createUserSearchScene(): Scenes.WizardScene<any>;
  createTaskCreationScene(): Scenes.WizardScene<any>;
  createBulkOperationScene(): Scenes.WizardScene<any>;
}

export interface IAdminUserService {
  searchUsers(query: string, filters?: any): Promise<PaginatedResponse<any>>;
  getUserDetails(userId: string): Promise<any>;
  updateUser(userId: string, updates: any): Promise<void>;
  suspendUser(userId: string, reason: string, duration?: number): Promise<void>;
  unsuspendUser(userId: string): Promise<void>;
  getUserActivity(userId: string, limit?: number): Promise<any[]>;
}

export interface IAdminRouterService {
  routeAdminCallback(ctx: Context, callbackData: string): Promise<void>;
  registerAdminRoute(pattern: string, handler: (ctx: Context, data: any) => Promise<void>): void;
  getRegisteredRoutes(): string[];
}

// =============================================================================
// HANDLER INTERFACES (Legacy - to be gradually replaced)
// =============================================================================

export interface IMenuHandler {
  showMenu(ctx: Context): Promise<void>;
  handleMenuCallback(ctx: Context, data: string): Promise<void>;
}

export interface ITaskHandler {
  showTasks(ctx: Context): Promise<void>;
  handleTaskCallback(ctx: Context, data: string): Promise<void>;
  submitTask(ctx: Context, taskData: any): Promise<void>;
}

export interface IWalletHandler {
  showWallet(ctx: Context): Promise<void>;
  handleWalletCallback(ctx: Context, data: string): Promise<void>;
  connectWallet(ctx: Context, walletType: string): Promise<void>;
}

export interface IReferralHandler {
  showReferrals(ctx: Context): Promise<void>;
  handleReferralCallback(ctx: Context, data: string): Promise<void>;
  processReferral(userId: string, referrerId: string): Promise<void>;
}

export interface IPointsHandler {
  showPoints(ctx: Context): Promise<void>;
  handlePointsCallback(ctx: Context, data: string): Promise<void>;
  awardPoints(userId: string, amount: number, reason: string): Promise<void>;
}

export interface ICaptchaService {
  generateCaptcha(type: string): Promise<{ id: string; challenge: any }>;
  validateCaptcha(id: string, response: any): Promise<boolean>;
  cleanupExpiredCaptchas(): Promise<number>;
}

export interface IErrorHandlerService {
  handleError(error: Error, context?: any): Promise<void>;
  reportError(error: Error, metadata?: any): Promise<void>;
  getErrorStats(): Promise<any>;
}

export interface IAccountProtectionService {
  checkAccountSecurity(userId: string): Promise<{ secure: boolean; issues: string[] }>;
  flagSuspiciousActivity(userId: string, activity: any): Promise<void>;
  getProtectionStatus(userId: string): Promise<any>;
}

export interface IUserFactory {
  createUser(userData: any): Promise<any>;
  validateUserData(data: any): Promise<{ valid: boolean; errors: string[] }>;
  getUserTemplate(): any;
}

// =============================================================================
// EVENT INTERFACES (Future Enhancement)
// =============================================================================

export interface IBotEvent {
  type: string;
  timestamp: Date;
  userId?: string;
  data: any;
}

export interface IEventBus {
  emit(event: IBotEvent): Promise<void>;
  subscribe(eventType: string, handler: (event: IBotEvent) => Promise<void>): void;
  unsubscribe(eventType: string, handler: Function): void;
}

// =============================================================================
// SERVICE FACTORY INTERFACES
// =============================================================================

export interface IServiceFactory<T> {
  create(...args: any[]): T;
  createWithDependencies(dependencies: any): T;
}

export interface IServiceProvider {
  getService<T>(identifier: symbol): T;
  getServices<T>(identifiers: symbol[]): T[];
  isServiceRegistered(identifier: symbol): boolean;
}

// =============================================================================
// CONFIGURATION INTERFACES
// =============================================================================

export interface IBotConfiguration {
  // Bot settings
  token: string;
  webhookUrl?: string;
  polling?: boolean;
  
  // Feature flags
  features: {
    captchaEnabled: boolean;
    adminPanelEnabled: boolean;
    analyticsEnabled: boolean;
    broadcastEnabled: boolean;
  };
  
  // Performance settings
  performance: {
    maxConcurrentUsers: number;
    messageRateLimit: number;
    sessionTimeout: number;
  };
  
  // Security settings
  security: {
    strictMode: boolean;
    multiAccountDetection: boolean;
    ipWhitelist?: string[];
  };
}

// =============================================================================
// UTILITY INTERFACES
// =============================================================================

export interface ICache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
  keys(pattern?: string): Promise<string[]>;
}

export interface IValidator {
  validate<T>(data: any, schema: any): { valid: boolean; errors: string[]; data?: T };
  validateRequired(data: any, fields: string[]): { valid: boolean; missing: string[] };
}

export interface IMetrics {
  increment(name: string, tags?: Record<string, string>): void;
  gauge(name: string, value: number, tags?: Record<string, string>): void;
  histogram(name: string, value: number, tags?: Record<string, string>): void;
  timer(name: string): { end: () => void };
}