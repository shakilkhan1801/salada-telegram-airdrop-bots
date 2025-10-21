import { Request } from 'express';

export interface AdminUser {
  id: string;
  telegramId?: string;
  username: string;
  hashedPassword: string;
  firstName?: string;
  email?: string;
  role: AdminRole;
  permissions: AdminPermission[];
  isActive: boolean;
  createdAt: string;
  lastLoginAt?: string | null;
  sessionToken?: string;
  sessionExpiresAt?: string;
  lastSessionRegeneration?: string | null;
  metadata: AdminUserMetadata;
}

// Express Request with authentication
export interface AuthenticatedRequest extends Request {
  user: AdminUser;
  sessionId: string;
  ip: string;
  body: any;
  params: any;
  query: any;
}

// Admin user without sensitive data for responses
export interface SafeAdminUser extends Omit<AdminUser, 'hashedPassword' | 'sessionToken'> {
  // All properties except hashedPassword and sessionToken
}

export type AdminRole = 'super_admin' | 'admin' | 'moderator' | 'support' | 'viewer';

export interface AdminPasswordChangeRequest {
  adminId: string;
  currentPassword: string;
  newPassword: string;
  timestamp: string;
}

export interface AdminLoginAttempt {
  ip: string;
  username: string;
  timestamp: Date;
  success: boolean;
  reason?: string;
  deviceFingerprint?: string;
}

export interface AdminAccountLockout {
  attempts: number;
  lockedUntil?: Date;
  lastAttempt: Date;
  reason?: string;
}

export type AdminPermission = 
  | 'all' // Super admin permission
  | 'users.read'
  | 'users.write'
  | 'users.view'
  | 'users.edit'
  | 'users.block'
  | 'users.unblock'
  | 'users.delete'
  | 'tasks.read'
  | 'tasks.write'
  | 'tasks.view'
  | 'tasks.create'
  | 'tasks.edit'
  | 'tasks.delete'
  | 'submissions.view'
  | 'submissions.approve'
  | 'submissions.reject'
  | 'broadcasts.view'
  | 'broadcasts.send'
  | 'analytics.view'
  | 'security.read'
  | 'security.view'
  | 'security.manage'
  | 'settings.view'
  | 'settings.edit'
  | 'system.backup'
  | 'system.restore';

export interface AdminUserMetadata {
  createdBy?: string;
  deviceFingerprint?: string;
  ipAddress?: string;
  lastDeviceFingerprint?: string;
  lastIpAddress?: string;
  loginCount: number;
  lastPasswordChange?: string;
  securityFlags?: AdminSecurityFlags;
  customData?: Record<string, any>;
}

export interface AdminSecurityFlags {
  requirePasswordChange?: boolean;
  mfaEnabled?: boolean;
  sessionRegeneratedAt?: string;
  suspiciousActivity?: boolean;
  temporaryLockout?: boolean;
  lastSecurityAudit?: string;
  roleChanged?: boolean;
  roleChangeTimestamp?: string;
  roleChangedBy?: string;
  forcedLogoutAt?: string;
  forcedLogoutReason?: string;
  forcedLogoutBy?: string;
}

export interface BroadcastMessage {
  id: string;
  title: string;
  content: string;
  mediaType?: 'none' | 'photo' | 'video' | 'document' | 'audio';
  mediaUrl?: string;
  targetAudience: BroadcastAudience;
  customFilters?: BroadcastFilter;
  status: BroadcastStatus;
  scheduledAt?: string;
  sentAt?: string;
  completedAt?: string;
  createdBy: string;
  recipientCount: number;
  deliveredCount: number;
  failedCount: number;
  metadata: BroadcastMetadata;
}

export type BroadcastAudience = 
  | 'all'
  | 'verified'
  | 'active'
  | 'premium'
  | 'wallet_connected'
  | 'task_completers'
  | 'custom';

export interface BroadcastFilter {
  minTasks?: number;
  maxTasks?: number;
  minPoints?: number;
  maxPoints?: number;
  hasWallet?: boolean;
  isPremium?: boolean;
  isVerified?: boolean;
  registeredAfter?: string;
  registeredBefore?: string;
  lastActiveAfter?: string;
  lastActiveBefore?: string;
  countries?: string[];
  excludeCountries?: string[];
  referredBy?: string;
  customQuery?: Record<string, any>;
}

export type BroadcastStatus = 
  | 'draft'
  | 'scheduled'
  | 'sending'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface BroadcastMetadata {
  estimatedRecipients: number;
  actualRecipients: number;
  sendRate: number;
  errors: BroadcastError[];
  deliveryReport: BroadcastDeliveryReport;
  customData?: Record<string, any>;
}

export interface BroadcastError {
  userId: string;
  error: string;
  timestamp: string;
  retryCount: number;
}

export interface BroadcastDeliveryReport {
  delivered: number;
  failed: number;
  blocked: number;
  rate: number;
  startTime: string;
  endTime?: string;
  duration?: number;
}

export interface DashboardStats {
  users: {
    total: number;
    verified: number;
    active: number;
    blocked: number;
    newToday: number;
    newThisWeek: number;
    newThisMonth: number;
  };
  tasks: {
    total: number;
    active: number;
    completions: number;
    submissions: number;
    pendingReview: number;
  };
  security: {
    blockedIPs: number;
    suspiciousActivity: number;
    multiAccountViolations: number;
    captchaSuccessRate: number;
  };
  wallet: {
    connected: number;
    totalWithdrawals: number;
    totalTokensDistributed: string;
    pendingWithdrawals: number;
  };
  referrals: {
    total: number;
    active: number;
    conversionRate: number;
    totalBonuses: number;
  };
  system: {
    uptime: number;
    memoryUsage: number;
    cpuUsage: number;
    storageUsage: number;
    activeConnections: number;
  };
}

export interface AdminAction {
  id: string;
  adminId: string;
  action: AdminActionType;
  targetType: 'user' | 'task' | 'broadcast' | 'system' | 'security';
  targetId?: string;
  description: string;
  metadata: AdminActionMetadata;
  timestamp: string;
}

export type AdminActionType = 
  | 'user_blocked'
  | 'user_unblocked'
  | 'user_verified'
  | 'user_points_adjusted'
  | 'task_created'
  | 'task_updated'
  | 'task_deleted'
  | 'submission_approved'
  | 'submission_rejected'
  | 'broadcast_sent'
  | 'broadcast_cancelled'
  | 'security_ip_blocked'
  | 'security_device_blocked'
  | 'system_backup_created'
  | 'system_settings_updated';

export interface AdminActionMetadata {
  reason?: string;
  previousValue?: any;
  newValue?: any;
  affectedUsers?: number;
  automated: boolean;
  ipAddress?: string;
  deviceFingerprint?: string;
  customData?: Record<string, any>;
}

export interface SystemHealth {
  status: 'healthy' | 'warning' | 'critical';
  components: {
    database: ComponentHealth;
    bot: ComponentHealth;
    api: ComponentHealth;
    captcha: ComponentHealth;
    security: ComponentHealth;
    wallet: ComponentHealth;
  };
  metrics: SystemMetrics;
  lastChecked: string;
}

export interface ComponentHealth {
  status: 'healthy' | 'warning' | 'critical' | 'down';
  responseTime: number;
  errorRate: number;
  lastError?: string;
  uptime: number;
}

export interface SystemMetrics {
  memory: {
    total: number;
    used: number;
    free: number;
    percentage: number;
  };
  cpu: {
    usage: number;
    load: number[];
  };
  storage: {
    total: number;
    used: number;
    free: number;
    percentage: number;
  };
  network: {
    connections: number;
    bandwidth: {
      incoming: number;
      outgoing: number;
    };
  };
}

// Alias for audit log entries
export type AuditLogEntry = AdminAction;