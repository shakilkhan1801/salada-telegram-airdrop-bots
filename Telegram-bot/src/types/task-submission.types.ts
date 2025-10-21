export interface TaskSubmission {
  id: string;
  userId: string;
  username?: string;
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

// Real-time Telegram verification interface
export interface TelegramVerificationResult {
  success: boolean;
  userId: string;
  channelId: string;
  memberStatus: 'member' | 'administrator' | 'creator' | 'restricted' | 'left' | 'kicked';
  joinedAt?: string;
  isPremium?: boolean;
  error?: string;
}

// Task completion tracking
export interface TaskCompletion {
  id: string;
  userId: string;
  username?: string;
  taskId: string;
  completedAt: string;
  pointsEarned: number;
  verificationMethod: string;
  verificationData?: any;
  submissionId?: string;
  status: 'completed' | 'pending' | 'failed';
  metadata?: Record<string, any>;
}

// Enhanced user interface with task tracking
export interface UserTaskStats {
  userId: string;
  totalTasksCompleted: number;
  totalPointsEarned: number;
  completedTasks: string[];
  pendingSubmissions: string[];
  failedTasks: string[];
  dailyCheckInStreak: number;
  lastCheckIn?: string;
  referralCount: number;
  isPremiumMember: boolean;
  joinedChannels: string[];
}