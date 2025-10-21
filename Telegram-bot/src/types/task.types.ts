export interface Task {
  id: string;
  title: string;
  description: string;
  category: TaskCategory;
  type: TaskType;
  points: number;
  icon: string;
  verificationMethod: TaskVerificationMethod;
  isActive: boolean;
  isDaily: boolean;
  cooldownHours?: number;
  maxCompletions?: number;
  completionCount: number;
  requirements?: TaskRequirements;
  validation?: TaskValidation;
  buttons: TaskButton[];
  order: number;
  validFrom?: string;
  validTo?: string;
  createdAt: string;
  updatedAt: string;
  metadata: TaskMetadata;
  isPermanent?: boolean;
  requiresSubmission?: boolean;
}

export type TaskCategory = 
  | 'tele_social' 
  | 'social' 
  | 'premium' 
  | 'daily' 
  | 'engagement' 
  | 'referral';

export type TaskType = 
  | 'telegram_join' 
  | 'twitter_follow' 
  | 'twitter_retweet' 
  | 'instagram_follow' 
  | 'youtube_subscribe' 
  | 'website_visit' 
  | 'premium_check' 
  | 'daily_bonus' 
  | 'referral_invite'
  | 'mini_game'
  | 'survey'
  | 'quiz'
  | 'captcha'
  | 'custom';

export type TaskVerificationMethod = 
  | 'telegram_api' 
  | 'user_submission' 
  | 'telegram_premium' 
  | 'time_based' 
  | 'referral_count' 
  | 'trust_based' 
  | 'manual_review';

export interface TaskRequirements {
  minimumTasks?: number;
  verificationRequired?: boolean;
  walletRequired?: boolean;
  premiumRequired?: boolean;
  referralRequired?: boolean;
  cooldownHours?: number;
  maxPerDay?: number;
  requiredCountry?: string[];
  blockedCountry?: string[];
  minimumAccountAge?: number;
}

export interface TaskValidation {
  submissionRequired: boolean;
  submissionPattern?: string;
  submissionExample?: string;
  submissionInstructions?: string;
  autoApprove: boolean;
  reviewRequired: boolean;
  timeoutMinutes?: number;
}

export interface TaskButton {
  text: string;
  action: TaskButtonAction;
  url?: string;
  callback?: string;
  style?: 'primary' | 'secondary' | 'success' | 'warning' | 'danger';
  requiresSubmission?: boolean;
  showForStatus?: TaskCompletionStatus[];
}

export type TaskButtonAction = 
  | 'complete' 
  | 'submit' 
  | 'verify' 
  | 'open_url' 
  | 'request_submission' 
  | 'check_status' 
  | 'refresh';

export type TaskCompletionStatus = 
  | 'not_started' 
  | 'in_progress' 
  | 'submitted' 
  | 'under_review' 
  | 'completed' 
  | 'failed' 
  | 'expired';

export interface TaskMetadata {
  targetUrl?: string;
  channelId?: string;
  channelUsername?: string;
  twitterUsername?: string;
  instagramUsername?: string;
  youtubeChannelId?: string;
  requiredAction?: string;
  verificationInstructions?: string;
  successMessage?: string;
  failureMessage?: string;
  requiredReferrals?: number;
  customData?: Record<string, any>;
}

export interface TaskSubmission {
  id: string;
  userId: string;
  taskId: string;
  submissionText: string;
  submissionType: 'text' | 'url' | 'screenshot' | 'video' | 'other';
  status: TaskSubmissionStatus;
  submittedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
  reviewNotes?: string;
  pointsAwarded?: number;
  metadata: TaskSubmissionMetadata;
}

export type TaskSubmissionStatus = 
  | 'pending' 
  | 'under_review' 
  | 'approved' 
  | 'rejected' 
  | 'requires_clarification';

export interface TaskSubmissionMetadata {
  ipAddress?: string;
  userAgent?: string;
  deviceFingerprint?: string;
  submissionMethod: 'direct' | 'url' | 'upload';
  validationResults?: ValidationResult[];
  autoValidated: boolean;
  reviewPriority: 'low' | 'normal' | 'high' | 'urgent';
  screenshots?: string[];
  attachments?: string[];
  customData?: Record<string, any>;
}

export interface ValidationResult {
  validator: string;
  passed: boolean;
  message: string;
  confidence: number;
  timestamp: string;
}

export interface UserTaskProgress {
  userId: string;
  taskId: string;
  status: TaskCompletionStatus;
  startedAt?: string;
  completedAt?: string;
  submissionId?: string;
  attempts: number;
  lastAttemptAt?: string;
  pointsEarned: number;
  metadata: UserTaskMetadata;
}

export interface UserTaskMetadata {
  verificationData?: any;
  submissionData?: any;
  reviewHistory?: TaskReviewRecord[];
  cooldownUntil?: string;
  customProgress?: Record<string, any>;
}

export interface TaskReviewRecord {
  reviewedAt: string;
  reviewedBy: string;
  action: 'approved' | 'rejected' | 'clarification_requested';
  notes?: string;
  pointsAwarded?: number;
}

export interface TaskStats {
  totalTasks: number;
  activeTasks: number;
  dailyTasks: number;
  socialTasks: number;
  premiumTasks: number;
  totalCompletions: number;
  totalPointsAwarded: number;
  averageCompletionTime: number;
  popularTasks: Array<{
    taskId: string;
    title: string;
    completions: number;
    successRate: number;
  }>;
  recentActivity: Array<{
    userId: string;
    taskId: string;
    action: string;
    timestamp: string;
  }>;
}

export interface TaskFilter {
  category?: TaskCategory;
  type?: TaskType;
  isActive?: boolean;
  isDaily?: boolean;
  minPoints?: number;
  maxPoints?: number;
  verificationMethod?: TaskVerificationMethod;
  hasRequirements?: boolean;
  search?: string;
}

export interface DailyTaskProgress {
  taskId: string;
  userId: string;
  date: string;
  completed: boolean;
  completedAt?: string;
  pointsEarned: number;
  streakCount: number;
}

export interface TaskAnalytics {
  completionRates: Record<string, number>;
  averageCompletionTime: Record<string, number>;
  userEngagement: Record<string, number>;
  pointsDistribution: Record<string, number>;
  popularCategories: Array<{
    category: TaskCategory;
    completions: number;
    percentage: number;
  }>;
  timeBasedStats: {
    hourly: Record<string, number>;
    daily: Record<string, number>;
    weekly: Record<string, number>;
    monthly: Record<string, number>;
  };
}