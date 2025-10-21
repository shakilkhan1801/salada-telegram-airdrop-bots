import { Request, Response } from 'express';
import { AdminUser, AdminPermission } from './admin.types';

export type DateRange = {
  start: Date | string;
  end: Date | string;
};

export interface AuthenticatedRequest extends Request {
  admin?: AdminUser;
  adminId?: string;
  sessionId?: string;
  isAuthenticated?: boolean;
  sessionRegenerated?: boolean;
  newSessionId?: string;
  permissions?: AdminPermission[];
  rateLimit?: {
    limit: number;
    remaining: number;
    resetTime: number;
  };
}

export interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  handler: (req: AuthenticatedRequest, res: Response) => Promise<void>;
  middleware?: any[];
  permissions?: AdminPermission[];
  rateLimit?: {
    maxRequests: number;
    windowMs: number;
  };
  validation?: any;
  description?: string;
}

export interface ApiRoute {
  prefix: string;
  endpoints: ApiEndpoint[];
  middleware?: any[];
  permissions?: AdminPermission[];
}

export interface AdminApiRequest {
  endpoint: string;
  method: string;
  data?: any;
  params?: Record<string, string>;
  query?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface AdminApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  pagination?: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  metadata?: Record<string, any>;
  timestamp: string;
}

export interface UserApiData {
  id: string;
  telegramId: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  isVerified: boolean;
  isBlocked: boolean;
  blockReason?: string;
  points: number;
  tasksCompleted: number;
  totalReferrals: number;
  walletAddress?: string;
  registeredAt: string;
  lastActiveAt: string;
  country?: string;
  isPremium: boolean;
  deviceFingerprint?: string;
  riskScore?: number;
}

export interface TaskApiData {
  id: string;
  title: string;
  description: string;
  category: string;
  type: string;
  points: number;
  icon: string;
  isActive: boolean;
  isDaily: boolean;
  completionCount: number;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface TaskSubmissionApiData {
  id: string;
  userId: string;
  taskId: string;
  taskTitle: string;
  userName?: string;
  submissionText: string;
  status: string;
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNotes?: string;
  pointsAwarded?: number;
}

export interface BroadcastApiData {
  id: string;
  title: string;
  content: string;
  mediaType?: string;
  mediaUrl?: string;
  targetAudience: string;
  status: string;
  scheduledAt?: string;
  sentAt?: string;
  createdBy: string;
  recipientCount: number;
  deliveredCount: number;
  failedCount: number;
}

export interface AnalyticsApiData {
  period: 'daily' | 'weekly' | 'monthly' | 'yearly';
  metrics: {
    users: Record<string, number>;
    tasks: Record<string, number>;
    referrals: Record<string, number>;
    security: Record<string, number>;
    wallet: Record<string, number>;
  };
  trends: {
    userGrowth: TrendData[];
    taskCompletions: TrendData[];
    pointsDistribution: TrendData[];
    securityIncidents: TrendData[];
  };
}

export interface TrendData {
  date: string;
  value: number;
  change: number;
  changePercentage: number;
}

export interface ExportRequest {
  type: 'users' | 'tasks' | 'submissions' | 'broadcasts' | 'analytics';
  format: 'json' | 'csv' | 'excel';
  filters?: Record<string, any>;
  dateRange?: DateRange;
  fields?: string[];
}

export interface ExportResult {
  success: boolean;
  filename?: string;
  downloadUrl?: string;
  size?: number;
  recordCount?: number;
  error?: string;
  expiresAt?: string;
}

export interface ImportRequest {
  type: 'users' | 'tasks' | 'settings';
  format: 'json' | 'csv';
  file: Buffer;
  options?: {
    overwriteExisting?: boolean;
    validateData?: boolean;
    backupBefore?: boolean;
  };
}

export interface ImportResult {
  success: boolean;
  imported: number;
  skipped: number;
  errors: ImportError[];
  backupFile?: string;
  duration: number;
}

export interface ImportError {
  line?: number;
  field?: string;
  value?: any;
  message: string;
  type: 'validation' | 'duplicate' | 'system';
}

export interface WebhookEvent {
  id: string;
  type: string;
  data: any;
  timestamp: string;
  source: string;
  processed: boolean;
  processedAt?: string;
  error?: string;
  retryCount: number;
}

export interface ApiMetrics {
  endpoint: string;
  method: string;
  requestCount: number;
  averageResponseTime: number;
  errorRate: number;
  lastError?: string;
  successRate: number;
}

export interface RateLimitConfig {
  endpoint: string;
  maxRequests: number;
  windowMs: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  keyGenerator?: string;
}