export interface Referral {
  id: string;
  referrerId: string;
  referredUserId: string;
  referralCode: string;
  registeredAt: string;
  isActive: boolean;
  tasksCompleted: number;
  pointsEarned: number;
  bonusAwarded: boolean;
  bonusAwardedAt?: string;
  status: ReferralStatus;
  metadata: ReferralMetadata;
}

export type ReferralStatus = 
  | 'pending' 
  | 'active' 
  | 'bonus_eligible' 
  | 'bonus_awarded' 
  | 'inactive' 
  | 'blocked';

export interface ReferralMetadata {
  registrationSource: 'direct' | 'social_share' | 'custom_link';
  conversionTime?: number;
  firstTaskCompletedAt?: string;
  lastActivityAt?: string;
  deviceFingerprint?: string;
  ipAddress?: string;
  customData?: Record<string, any>;
}

export interface ReferralStats {
  totalReferrals: number;
  activeReferrals: number;
  pendingReferrals: number;
  bonusEligibleReferrals: number;
  bonusAwardedReferrals: number;
  totalPointsEarned: number;
  totalBonusAwarded: number;
  conversionRate: number;
  averageTasksPerReferral: number;
  topReferrers: Array<{
    userId: string;
    username?: string;
    firstName?: string;
    referralCount: number;
    totalEarnings: number;
  }>;
  recentActivity: Array<{
    type: 'registration' | 'task_completion' | 'bonus_awarded';
    referrerId: string;
    referredUserId: string;
    timestamp: string;
    points?: number;
  }>;
}

export interface ReferralAnalytics {
  period: 'daily' | 'weekly' | 'monthly' | 'yearly';
  registrations: Record<string, number>;
  conversions: Record<string, number>;
  earnings: Record<string, number>;
  topPerformers: Array<{
    userId: string;
    metrics: ReferralPerformanceMetrics;
  }>;
}

export interface ReferralPerformanceMetrics {
  totalReferrals: number;
  successfulConversions: number;
  conversionRate: number;
  totalEarnings: number;
  averageTimeToConversion: number;
  retentionRate: number;
}

export interface ReferralLink {
  code: string;
  userId: string;
  url: string;
  shortUrl?: string;
  clickCount: number;
  registrationCount: number;
  conversionRate: number;
  createdAt: string;
  lastUsedAt?: string;
  isActive: boolean;
  customParameters?: Record<string, string>;
}